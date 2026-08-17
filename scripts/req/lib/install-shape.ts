/**
 * 설치 **형태** 판정 (REQ-2026-165 phase-1 — `req-doctor` 에서 leaf 로 내림).
 *
 * 🔴 **왜 옮겼나**: `commitgate check` 가 업그레이드 축을 보고하려면 이 두 술어가 필요한데,
 *    그러자고 `req-doctor`(2119줄)를 통째로 import 하면 `check → doctor` 간선이 생긴다.
 *    두 술어는 **순수**하고 doctor 와 무관한 성격이라 leaf 가 제자리다.
 *    (`successorSlug` 를 `lib/nonconvergence` 로 내릴 때와 같은 방식 — `req-doctor` 가 re-export 해
 *    기존 호출부·테스트를 그대로 둔다.)
 *
 * 🔴 **동작 변경 0.** 본문은 옮기기만 했다.
 */

/** 설치 모드(REQ-2026-014 D19 진단). `req:*` 스크립트 **값의 형태**로만 판정한다. */
export type InstallMode = 'stage-a' | 'stage-b' | 'mixed' | 'none' | 'custom'

/**
 * 진단 대상 `req:*` 키.
 *
 * 설치 축의 SSOT는 `bin/init.ts`의 `REQ_SCRIPTS`지만 여기서 import하지 않는다(아래 `classifyInstallMode` 주석 — 레이어 역전).
 * 키가 늘면 이 목록도 늘려야 한다. 드리프트가 나도 이 검사는 **advisory(WARN 상한)** 라 게이트를 깨지 않는다.
 */
const REQ_SCRIPT_KEYS = ['req:new', 'req:next', 'req:review-codex', 'req:doctor', 'req:commit'] as const

/** Stage A 형태: `tsx scripts/req/<file>.ts` (과거 vendored scaffold가 주입하던 모양). */
const STAGE_A_SCRIPT_RE = /^tsx\s+scripts\/req\/[A-Za-z0-9._-]+\.ts$/
/** Stage B 형태: `commitgate <verb>` (설치된 패키지 bin dispatch). */
const STAGE_B_SCRIPT_RE = /^commitgate\s+req:[A-Za-z0-9-]+$/

/**
 * 설치 모드 진단(REQ-2026-014 D19 — doctor D19, 순수).
 *
 * **`package.json`의 `req:*` 값 형태만** 본다. manifest·lockfile·node_modules·버전에 의존하지 않는다.
 *
 * ⚠️ **`bin/init.ts`를 import하지 않는다**(레이어 역전 방지). init.ts는 cross-spawn·semver·git spawn을 끌고 오는
 * ~1250줄 설치 CLI이고, 매 커밋 게이트로 도는 이 스크립트가 그것을 로드해선 안 된다. 그래서 바이트 일치(`REQ_SCRIPTS`)가
 * 아니라 **shape**로 판정한다 — 요구(R7)도 "script 형태를 기준으로"다.
 *
 * ⚠️ **migrate와의 비대칭은 의도적이다**: `bin/migrate.ts`의 전환은 **쓰기**라 `REQ_SCRIPTS` 바이트 정확 일치를
 * 요구한다(사용자 값을 덮지 않기 위해). 이 진단은 **읽기 전용 advisory**라 shape로 충분하다. 강도를 바꿔야 하는 쪽은 migrate다.
 *
 * @param scripts `package.json`의 `scripts` 맵. `undefined`/`null`이면 판정 불가 → 호출부가 '점검 불요'.
 */
export function classifyInstallMode(scripts: Record<string, string>): InstallMode {
  const values = REQ_SCRIPT_KEYS.map((k) => scripts[k]).filter((v): v is string => typeof v === 'string')
  if (values.length === 0) return 'none'
  const a = values.filter((v) => STAGE_A_SCRIPT_RE.test(v)).length
  const b = values.filter((v) => STAGE_B_SCRIPT_RE.test(v)).length
  if (a > 0 && b > 0) return 'mixed'
  if (a > 0 && a === values.length) return 'stage-a'
  if (b > 0 && b === values.length) return 'stage-b'
  // Stage A/B 형태가 하나도 없거나(전부 사용자 값), 일부만 kit 형태이고 나머지는 사용자 값.
  return 'custom'
}

/**
 * D22(REQ-2026-047): repo-root 런타임 스크래치 중 **ignore도 tracked도 아닌** 경로.
 *
 * 판정은 **로컬 git 상태 그대로**다(전역 excludes 포함) — D10이 보는 `git status`와 같은 기준이어야
 * "다음 review 뒤 D10이 막는다"는 예측이 맞는다. 파일이 아직 없어도 `check-ignore`는 패턴 매칭이라
 * 동작한다(그래서 **첫 리뷰 전에 미리** 경고할 수 있다 — 이 검사의 존재 이유).
 *
 * 읽기 전용 advisory라 어떤 오류도 삼킨다(조회 실패 = 보호됨으로 간주 → WARN 안 냄. fail-safe: 게이트를 막지 않는다).
 */
export function unprotectedRepoRootScratch(paths: readonly string[], gitFn: (a: string[]) => string): string[] {
  const out: string[] = []
  for (const p of paths) {
    let ignored = false
    let tracked = false
    try {
      gitFn(['check-ignore', '-q', '--', p])
      ignored = true
    } catch {
      ignored = false
    }
    if (!ignored) {
      try {
        tracked = gitFn(['ls-files', '--', p]).trim() !== ''
      } catch {
        tracked = true // 조회 불가 → 보호됨으로 간주(경고하지 않음)
      }
    }
    if (!ignored && !tracked) out.push(p)
  }
  return out
}

/** D19 메시지용 라벨. */
export const INSTALL_MODE_LABEL: Record<InstallMode, string> = {
  'stage-a': 'Stage A(vendored — scripts/req/** 를 직접 실행)',
  'stage-b': 'Stage B(런타임 패키지 — commitgate <verb> dispatch)',
  mixed: 'mixed',
  none: 'req:* 스크립트 없음',
  custom: '사용자 정의 req:* 값(kit 형태 아님)',
}
