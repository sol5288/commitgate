/**
 * 설치본의 **`req:*` 명령 표면** 판정 (REQ-2026-161 phase-1).
 *
 * 🔴 **무엇을 푸는가**: 릴리스가 새 verb 를 추가해도 기존 설치본의 `package.json` 에는 그 스크립트가
 *    생기지 않는다. `init` 이 주입하지만 문서화된 업그레이드 절차는 `init` 재실행을 부르지 않고
 *    (`설치 → sync --apply → quickstart --apply → migrate`), `sync` 는 설계상 `package.json` 을
 *    건드리지 않는다. 그래서 **`req:next` 가 안내한 명령이 실행 시점에 없는** 상태가 만들어진다.
 *    실측(0.23.1 설치본): `pnpm req:delegate` → `Command "req:delegate" not found`.
 *
 * 🔴 **왜 D19 가 못 잡는가**: `classifyInstallMode`는 5개 표본 키의 **값 형태**만 본다. 부재 키는
 *    `filter(isString)` 에서 조용히 떨어져 나가므로, 5개가 Stage B 형태이면 나머지가 없어도 `stage-b`
 *    다. 그 판정 자체는 옳다 — **묻는 질문이 다르다**(모드 vs 집합). 그래서 D19 를 고치지 않고
 *    이 모듈을 따로 둔다(설계 DEC-2).
 *
 * 🔴 **하드코딩 목록이 없다**(설계 DEC-6). 기대 집합은 `bin/dispatch.mjs` 의 `VERB_MODULES` 에서
 *    파생한다 — `bin/init.ts` 의 `STAGE_B_REQ_VERBS` 와 **같은 원천**이다. dispatch 에 verb 를
 *    추가하면 진단·복구가 자동으로 따라오고, 이 파일을 고칠 일이 없다.
 *
 * 🔴 **`bin/init.ts` 를 import 하지 않는다.** `req-doctor.ts` 가 레이어 역전으로 금지한 것이 그것이다
 *    (~1250줄 · cross-spawn·semver·git spawn). `bin/dispatch.mjs` 는 **import 0 의 순수 모듈 맵**이라
 *    그 금지에 걸리지 않는다.
 *
 * 🔴 **판정과 입력 획득을 같은 모듈에 둔다**(설계 DEC-1 · design r02 observation). 술어만 공유하고
 *    입력을 소비자가 각자 읽으면, 한쪽이 `scripts` 부재·비객체를 다르게 다루는 순간 C6 와 D33 의
 *    판정이 갈라진다(REQ-2026-094 가 같은 결론에 도달했다: 술어만으로는 부족하다).
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { VERB_MODULES } from '../../../bin/dispatch.mjs'

/** BOM 제거 — `lib/config` 와 같은 이유(Windows 편집기가 붙인다). */
function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s
}

/**
 * 기대되는 `req:*` 스크립트 맵. 키는 dispatch 표면에서 **파생**하고 값은 Stage B 주입값이다.
 *
 * `bin/init.ts` 의 `STAGE_B_REQ_SCRIPTS` 와 같은 규칙으로 만들어지지만 **거기서 import 하지 않는다**
 * (위 레이어 주석). 두 곳이 같은 집합임은 회귀 테스트가 고정한다.
 */
export function expectedReqScripts(): Record<string, string> {
  return Object.fromEntries(
    Object.keys(VERB_MODULES)
      .filter((v) => v.startsWith('req:'))
      .sort()
      .map((v) => [v, `commitgate ${v}`]),
  )
}

/**
 * 설치본에 **없는** `req:*` 키(정렬). `[]` = 부족 없음.
 *
 * 🔴 **판정 불가는 "부족"이 아니다.** `scripts` 가 `null`·`undefined`·비객체면 `[]` 를 낸다 —
 *    읽지 못한 것을 결함으로 말하면 거짓 사유가 되고, 소비자는 같은 원인을 두 번 센다
 *    (C1 실패 시 C4 가 '점검 불요'로 남기는 것과 같은 규율).
 *
 * 🔴 **값은 보지 않는다.** 사용자가 `req:new` 를 자기 래퍼로 바꿔 뒀을 수 있고 그것은 `init` 이
 *    Stage A 시절부터 보존해 온 정당한 상태다. 이 판정은 **부재**만 다룬다.
 */
export function missingReqScripts(scripts: unknown): string[] {
  if (typeof scripts !== 'object' || scripts === null || Array.isArray(scripts)) return []
  const have = scripts as Record<string, unknown>
  return Object.keys(expectedReqScripts()).filter((k) => !(k in have))
}

/**
 * 대상 repo `package.json` 의 `scripts` 맵. 읽지 못하면 `null`(= 판정 불가).
 *
 * 🔴 **소비자가 각자 읽지 않는다**(DEC-1). 파일 부재·파싱 실패·`scripts` 비객체를 여기서 한 번만
 *    `null` 로 접어, C6 와 D33 이 같은 입력을 본다.
 */
export function readPackageScripts(root: string): Record<string, string> | null {
  const p = join(resolve(root), 'package.json')
  if (!existsSync(p)) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(stripBom(readFileSync(p, 'utf8')))
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const s = (parsed as { scripts?: unknown }).scripts
  if (typeof s !== 'object' || s === null || Array.isArray(s)) return null
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(s as Record<string, unknown>)) if (typeof v === 'string') out[k] = v
  return out
}

/**
 * 해소 안내 **한 문장**(설계 DEC-4).
 *
 * 🔴 C6 · D33 · `sync` 계획 출력이 **같은 문자열**을 쓴다. 세 곳에 손으로 적으면 정책이 바뀔 때
 *    한쪽만 갱신된다 — `lib/control-points.ts` 가 존재하는 이유와 같다.
 */
export function commandSurfaceGuidance(missing: readonly string[]): string {
  return (
    `설치된 CommitGate 가 제공하는 ${missing.length}개 명령이 package.json 에 없습니다(${missing.join(' · ')}) — ` +
    '`npx commitgate sync --apply --scripts` 로 없는 키만 채우십시오(기존 값은 덮지 않습니다).'
  )
}

/** 진단 메시지 본문(부족 없음/있음 공통). 소비자는 level 만 정한다. */
export function commandSurfaceMessage(missing: readonly string[]): string {
  return missing.length === 0
    ? `req:* 명령 표면이 설치된 패키지와 일치(${Object.keys(expectedReqScripts()).length}개)`
    : commandSurfaceGuidance(missing)
}
