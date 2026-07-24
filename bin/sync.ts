#!/usr/bin/env tsx
/**
 * commitgate sync — 소비 repo의 vendored **스키마 축 계약**을 설치된 패키지 사본으로 재동기화 (REQ-2026-038).
 *
 * 왜: 런타임은 게이트 결정 스키마(`workflow/machine.schema.json`)를 **소비 repo의 vendored 사본**에서 읽는데
 *    (config.ts schemaPathAbs → codex --output-schema + 응답 검증), `pnpm update`는 node_modules만 바꿔
 *    vendored 사본을 stale로 남긴다. `machine_schema_version`이 minor 간 불변이면(0.7.0/0.8.1 둘 다 "1.1")
 *    버전으로는 감지 못 하고, stale 스키마가 신규 필드(full_review_requested)를 조용히 없애 delta 리뷰
 *    에스컬레이션이 죽는다. sync가 그 vendored 계약을 shipped 사본으로 되돌린다.
 *
 * 하는 일(비파괴·멱등):
 *   - **스키마 축(`KIT_SCHEMA_RELPATHS`)**: machine.schema.json + req.config.schema.json을 `PACKAGE_ROOT/<rel>` →
 *     `<targetRoot>/<rel>`로 복사한다(계약 = --force 축, 커스터마이즈 대상 아님). sha 동일이면 skip(멱등).
 *   - **페르소나(`--persona` opt-in)**: 기본은 파괴적 쓰기 0건. **부재 복원**(부재면 loadReviewPersona가 이미
 *     fail-closed로 리뷰를 멈추므로 복원이 순이득) + 내용이 다르면 **적용 전 실제 내용 diff 출력 후 미접촉**.
 *     REQ-2026-050부터 `--persona-apply`를 **함께** 주면 백업(.bak) 후 교체한다 — 그 전까지는 갱신 경로가
 *     아예 없어 배포된 리뷰 정책이 기존 프로젝트에 도달하지 못했다. 마커는 차단 조건이 아니라 **경고 강도**다
 *     (마커로 게이팅하면 pre-050 설치분 전체가 봉쇄된다; design-r02 P1). custom 경로·null은 unmanaged.
 *
 *   - **`workflow/.gitignore`(`--gitignore` opt-in, REQ-2026-047)**: 덮어쓰기 0건. kit 템플릿 규칙 중 **없는 행만**
 *     말미에 append한다(기존 행 미변경·미재정렬·미삭제). 파일 부재면 템플릿 전체로 생성(= 전 규칙 누락의 경계 사례).
 *     0.9.6 이하 설치본에는 review-call 로그 규칙이 없어 첫 리뷰 뒤 D10이 커밋을 막는다 — 그 백필 경로다.
 *     존재 판정은 Git 의미론을 보존한다(앞 공백은 패턴의 일부 — `normalizeIgnoreLine`).
 *
 * 안 하는 일: companion skills·package.json·req:*·req.config.json·에이전트 진입점 미접촉.
 *    `workflow/.gitignore`도 `--gitignore` 없이는 완전 미접촉(**기본 동작 불변**).
 *    캐럿 범위(`^0.x`)는 소비자 package.json에서 PM이 강제하므로 코드로 못 고친다 — 문서(업그레이드 절)가 안내.
 *
 * ⚠️ **confinement는 재구현하지 않는다.** 모든 쓰기가 `statWritableDest`(bin/init.ts) 단일 경로를 탄다 —
 *    두 번째 구현이 REQ-2026-024 symlink-escape 결함의 원인이었다(init.ts:433).
 *
 * ⚠️ **`--dir`(기본 cwd)로만 root 해소** + `targetRoot===PACKAGE_ROOT` 하드 거부. `loadConfig({root})`에 root를
 *    명시하므로 resolveRoot의 packageRoot fallback(config.ts:207)을 안 탄다 — migrate.ts:21-23이 경고하는 foot-gun.
 *
 * ⚠️ **동기 구현이어야 한다.** launcher(bin/commitgate.mjs)가 `mod.runCli(rest)`를 await 없이 호출한다 —
 *    async면 promise가 버려져 exit code가 소실된다(migrate.ts:18-19와 동일).
 */
import { existsSync, copyFileSync, mkdirSync, realpathSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, join, dirname, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadConfig, DEFAULT_REVIEW_PERSONA_RELPATH, type ResolvedConfig } from '../scripts/req/lib/config'
import { safeSpawnSyncStatus } from '../scripts/req/lib/adapters'
import {
  PACKAGE_ROOT,
  KIT_SCHEMA_RELPATHS,
  KIT_GITIGNORE,
  kitGitignoreRules,
  statWritableDest,
  sha256File,
  assertGitWorkTree,
} from './init'

export interface SyncOptions {
  dir: string
  /** 기본 false = plan(dry-run, 쓰기 0건). true면 스키마 축·페르소나 부재복원을 쓴다. */
  apply: boolean
  /** 페르소나 처리 opt-in. 없으면 페르소나는 완전 미접촉. */
  persona: boolean
  /**
   * `workflow/.gitignore` 규칙 보강 opt-in(REQ-2026-047). 없으면 완전 미접촉 — **기본 동작 불변**.
   * 생략 가능: 기존 호출부(3필드)를 깨지 않는다.
   */
  gitignore?: boolean
  /**
   * persona가 shipped와 다를 때 **교체**를 허용하는 opt-in(REQ-2026-050 D7). 없으면 기본 동작 그대로 미접촉.
   * 🔴 `persona`를 **함의하지 않는다** — 둘을 함께 줘야 한다(우발적 교체를 막는 의도적 중복).
   */
  personaApply?: boolean
}

/**
 * 자산 처리 상태.
 * - `new`: dest 부재 → 복사(스키마/페르소나 공통, 잃을 것 없음).
 * - `in-sync`: sha 동일 → skip.
 * - `stale`: 스키마가 shipped와 다름 → 덮음(계약 = --force 축).
 * - `managed-drift`: 기본 경로 페르소나가 shipped와 다르고 **kit 마커가 있음** → 기본 미접촉 + 적용 전 diff,
 *   `--persona-apply`로 백업 후 교체.
 * - `preserved-differs`: 위와 같으나 **마커가 없음**(직접 작성분일 수 있음) → 경로는 동일하고 **경고만 강하다**.
 * - `unmanaged-custom` / `unmanaged-null`: 페르소나 경로가 custom/null → 미접촉(교체 경로 없음).
 */
export type AssetStatus =
  | 'new'
  | 'in-sync'
  | 'stale'
  /** persona 축: kit 마커 有 · shipped와 다름 (REQ-2026-050 D4). 기본 미접촉, `--persona-apply`로 교체 가능. */
  | 'managed-drift'
  /** persona 축: kit 마커 無 · shipped와 다름. `managed-drift`와 동일 경로지만 **경고가 강하다**(사용자 작성분일 수 있음). */
  | 'preserved-differs'
  | 'unmanaged-custom'
  | 'unmanaged-null'
  /** gitignore 축: 파일은 있으나 kit 규칙 일부가 없음 → **누락 행만** 말미에 append(REQ-2026-047). */
  | 'rules-missing'

/** persona 본문이 kit 계보임을 표시하는 마커(REQ-2026-050 phase-1이 도입). 첫 줄에 온다. */
export const PERSONA_KIT_MARKER = '<!-- commitgate:persona v1 -->'

/** 마커 판정 — 선행 BOM·공백과 개행 형태(LF/CRLF)에 무관하게 **첫 줄**만 본다. */
export function hasPersonaKitMarker(body: string): boolean {
  const first = body.replace(/^﻿/, '').split(/\r?\n/)[0] ?? ''
  return first.trim() === PERSONA_KIT_MARKER
}

export interface AssetPlan {
  rel: string // 대상-상대 경로(표시용)
  axis: 'schema' | 'persona' | 'gitignore'
  status: AssetStatus
  note?: string
}

/** `workflow/.gitignore`에 덧붙일 누락 kit 규칙(REQ-2026-047). 기존 행은 건드리지 않는다. */
export interface GitignoreAppend {
  destRel: string
  /** kit 원문 그대로의 규칙 행들(순서 보존). */
  missing: string[]
}

/** persona 교체 직전 원본을 보존하는 백업(REQ-2026-050 D6). 실패하면 교체하지 않는다. */
export interface PersonaBackup {
  /** 백업 원본(대상 repo의 현재 persona) — 대상-상대. */
  srcRel: string
  /** 백업 대상 — 대상-상대. 직전 1세대만 보장(기존 파일은 덮어쓴다). */
  bakRel: string
}

export interface SyncPlan {
  targetRoot: string
  assets: AssetPlan[]
  /** apply 시 실제 복사할 항목(스키마 new/stale + 페르소나 부재복원 + gitignore 파일 부재 시 템플릿 전체). */
  writes: { srcAbs: string; destRel: string }[]
  /** apply 시 **행 단위 append**할 항목(gitignore 축 전용). 복사가 아니라 추가라 writes와 분리한다. */
  appends: GitignoreAppend[]
  /**
   * apply 시 writes **보다 먼저** 수행할 백업(REQ-2026-050 D6). 현재는 persona 교체 경로만 쓴다.
   * 백업이 실패하면 대응하는 write도 수행하지 않는다(fail-closed) — runSync가 강제한다.
   */
  backups: PersonaBackup[]
  /**
   * persona가 shipped와 달라 사용자 판단이 필요한 경우의 diff 대상(REQ-2026-050 D5).
   * `--apply` 여부와 무관하게 인쇄한다 — dry-run에서 봐야 적용 여부를 고를 수 있다.
   */
  personaDiff: { shippedAbs: string; targetAbs: string; targetRel: string; unmarked: boolean } | null
}

/**
 * gitignore 행 정규화(존재 판정용) — 🔴 **Git ignore 의미론을 보존한다**(design r01 P1).
 *
 * gitignore(5): **후행 공백은 무시되지만(백슬래시로 이스케이프한 경우 제외) 앞 공백은 패턴의 일부**다.
 * 따라서 후행 `\r`과 후행 공백만 제거하고 **앞 공백은 보존**한다.
 *
 * 결과적으로 ` /.review-calls.jsonl`(앞 공백)은 kit 규칙과 **다른 패턴**으로 판정되어 누락 취급되고,
 * 정확한 규칙이 append된다. 반대로 트림 비교를 쓰면 "이미 있다"고 오판해 append를 건너뛰지만 Git은
 * 그 파일을 무시하지 않아 다음 review 뒤 **D10 FAIL(P0)이 재발**한다.
 *
 * 방향은 **fail-safe**: 과(過)append는 무해(정확한 규칙이 추가되어 ignore가 성립)하고, 미(未)append는 P0 재발이다.
 */
export function normalizeIgnoreLine(line: string): string {
  // 후행 공백 제거 — 단 `\ `처럼 백슬래시로 이스케이프된 공백은 패턴의 일부라 보존한다.
  return line.replace(/\r+$/, '').replace(/(?<!\\)[ \t]+$/, '')
}

/**
 * 대상 `workflow/.gitignore` 본문에 없는 kit 규칙 행 목록(순수 — 테스트가 직접 구동한다).
 *
 * 비교는 `normalizeIgnoreLine`으로 하되 **kit 규칙 원문을 그대로 반환**한다(append되는 것은 정확한 kit 형태).
 * 주석·빈 줄은 kit 규칙 목록에 없으므로(`kitGitignoreRules`) 자연히 제외된다.
 */
export function missingKitIgnoreRules(existingContent: string, kitRules: readonly string[]): string[] {
  const present = new Set(existingContent.split('\n').map(normalizeIgnoreLine))
  return kitRules.filter((r) => !present.has(normalizeIgnoreLine(r)))
}

/**
 * 누락 규칙을 본문 말미에 덧붙인 새 본문(순수). 기존 행은 **한 글자도 바꾸지 않는다**.
 * 원본의 개행 관례(CRLF/LF)를 따르고, 마지막 줄에 개행이 없으면 먼저 채운다.
 */
export function appendIgnoreRules(existingContent: string, missing: readonly string[]): string {
  if (missing.length === 0) return existingContent
  const eol = existingContent.includes('\r\n') ? '\r\n' : '\n'
  const needsLeadingEol = existingContent.length > 0 && !/\r?\n$/.test(existingContent)
  return existingContent + (needsLeadingEol ? eol : '') + missing.join(eol) + eol
}

/** targetRoot·PACKAGE_ROOT 동일성 판정용 정규화(Windows 8.3·case·symlink 차이 흡수 — init.assertGitWorkTree와 동일 기법). */
function canonical(p: string): string {
  try {
    return resolve(realpathSync.native(p))
  } catch {
    return resolve(p)
  }
}

/**
 * 재동기화 계획 수립(순수 판정 — 쓰기 없음). statWritableDest로 confinement + leaf를 판정하고 sha로 멱등 skip.
 * `--persona` 없으면 페르소나는 계획에 넣지 않는다(완전 미접촉).
 */
export function planSync(
  targetRoot: string,
  cfg: ResolvedConfig,
  persona: boolean,
  gitignore = false,
  personaApply = false,
): SyncPlan {
  const assets: AssetPlan[] = []
  const writes: { srcAbs: string; destRel: string }[] = []
  const appends: GitignoreAppend[] = []
  const backups: PersonaBackup[] = []
  let personaDiff: SyncPlan['personaDiff'] = null

  // ── 스키마 축(무조건 재동기화 — 계약, --force 축) ──
  for (const rel of KIT_SCHEMA_RELPATHS) {
    const srcAbs = join(PACKAGE_ROOT, rel)
    const st = statWritableDest(targetRoot, rel) // confinement + leaf(symlink escape 거부)
    if (st === null) {
      assets.push({ rel, axis: 'schema', status: 'new' })
      writes.push({ srcAbs, destRel: rel })
    } else if (sha256File(srcAbs) === sha256File(join(targetRoot, rel))) {
      assets.push({ rel, axis: 'schema', status: 'in-sync' })
    } else {
      assets.push({ rel, axis: 'schema', status: 'stale' })
      writes.push({ srcAbs, destRel: rel })
    }
  }

  // ── 페르소나(opt-in — 파괴적 쓰기 0건) ──
  if (persona) {
    const personaRel = DEFAULT_REVIEW_PERSONA_RELPATH
    const defaultAbs = resolve(cfg.root, personaRel)
    if (cfg.reviewPersonaPathAbs === null) {
      assets.push({ rel: personaRel, axis: 'persona', status: 'unmanaged-null', note: 'reviewPersonaPath:null(비활성) — 미접촉' })
    } else if (cfg.reviewPersonaPathAbs !== defaultAbs) {
      // custom 경로(정규화 절대경로 기준 ≠기본) — kit 관리 자산 아님. 미접촉.
      const customRel = relative(cfg.root, cfg.reviewPersonaPathAbs).replace(/\\/g, '/')
      assets.push({ rel: customRel, axis: 'persona', status: 'unmanaged-custom', note: 'custom reviewPersonaPath — 미접촉' })
    } else {
      const srcAbs = join(PACKAGE_ROOT, personaRel)
      const st = statWritableDest(targetRoot, personaRel)
      if (st === null) {
        // 부재 복원(잃을 것 없음 — 부재면 리뷰가 이미 fail-closed로 멈춘다).
        assets.push({ rel: personaRel, axis: 'persona', status: 'new' })
        writes.push({ srcAbs, destRel: personaRel })
      } else if (sha256File(srcAbs) === sha256File(defaultAbs)) {
        assets.push({ rel: personaRel, axis: 'persona', status: 'in-sync' })
      } else {
        // 다름 → 기본은 여전히 **미접촉**. 다만 REQ-2026-050 D4부터 `--persona-apply` 명시 시 교체 경로가 열린다.
        //
        // 🔴 마커 유무로 **교체를 막지 않는다.** 마커는 0.9.9+ 가 깐 사본에만 있으므로, 마커를 게이트로 쓰면
        //    pre-050 설치분 **전체**의 갱신 경로가 봉쇄돼 정책이 기존 사용자에게 영영 도달하지 못한다(design-r02 P1).
        //    "kit 사본인가 사용자 작성분인가"의 판정은 도구가 아니라 **사용자**가 한다 — 그래서 적용 전 실제
        //    내용 diff(D5)를 보여주고, 이중 플래그를 요구하고, 교체 전 백업(D6)을 남긴다.
        //    마커가 하는 일은 **경고 강도**를 가르는 것뿐이다.
        const unmarked = !hasPersonaKitMarker(readFileSync(defaultAbs, 'utf8'))
        assets.push({
          rel: personaRel,
          axis: 'persona',
          status: unmarked ? 'preserved-differs' : 'managed-drift',
          note: unmarked
            ? '기본 persona가 shipped와 다르고 kit 마커가 없음 — **당신이 직접 쓴 파일일 수 있다**. diff 확인 후 --persona-apply 로만 교체'
            : 'kit 계보(마커 有)인데 shipped와 다름 — diff 확인 후 --persona-apply 로 교체 가능',
        })
        personaDiff = { shippedAbs: srcAbs, targetAbs: defaultAbs, targetRel: personaRel, unmarked }
        if (personaApply) {
          backups.push({ srcRel: personaRel, bakRel: `${personaRel}.bak` })
          writes.push({ srcAbs, destRel: personaRel })
        }
      }
    }
  }

  // ── workflow/.gitignore 규칙 보강(--gitignore opt-in — REQ-2026-047) ──
  // 🔴 이 파일은 git 관례상 **사용자 소유**다(init D12: 부재 시에만 생성, --force로도 미덮어씀).
  //    따라서 **additive append 전용** — 기존 행을 수정·삭제·재정렬하지 않는다. 덮어쓰기는 절대 없다.
  if (gitignore) {
    const rel = KIT_GITIGNORE.dest
    const st = statWritableDest(targetRoot, rel) // confinement + leaf(symlink escape 거부)
    if (st === null) {
      // 파일 부재 = "모든 kit 규칙이 누락된 상태"의 경계 사례 → 템플릿 전체로 생성(init의 seed와 동일 산출물).
      assets.push({ rel, axis: 'gitignore', status: 'new', note: '부재 — kit 템플릿 전체로 생성' })
      writes.push({ srcAbs: join(PACKAGE_ROOT, KIT_GITIGNORE.src), destRel: rel })
    } else {
      const missing = missingKitIgnoreRules(readFileSync(join(targetRoot, rel), 'utf8'), kitGitignoreRules())
      if (missing.length === 0) {
        assets.push({ rel, axis: 'gitignore', status: 'in-sync', note: 'kit 규칙 전부 존재' })
      } else {
        assets.push({
          rel,
          axis: 'gitignore',
          status: 'rules-missing',
          note: `누락 ${missing.length}행 → 말미에 추가(기존 행 미변경): ${missing.join(' , ')}`,
        })
        appends.push({ destRel: rel, missing })
      }
    }
  }

  return { targetRoot, assets, writes, appends, backups, personaDiff }
}

// ────────────────────────────────────────────── persona diff (D5) ──

/**
 * persona 차이의 **실제 내용 diff** 생산자(REQ-2026-050 D5). 실패는 throw — 호출자가 fail-closed로 처리한다.
 *
 * 🔴 손수 구현하지도, `diff` 라이브러리를 새로 넣지도 않는다. **git에 위임한다** — `bin/sync.ts`는 이미
 *    `assertGitWorkTree`로 git을 하드 전제로 두므로 새 의존성이 0이다. 손수 명세한 diff/oracle이 설계
 *    리뷰를 미수렴시킨 전례(REQ-2026-041→042)를 반복하지 않는다.
 */
export type PersonaDiffRunner = (shippedAbs: string, targetAbs: string) => string

/**
 * `runSync`의 주입 가능한 부작용 경계(REQ-2026-050 phase-2). 프로덕션 기본값은 실제 git·fs다.
 * 테스트는 여기에 stub을 넣어 **실제 `git`을 호출하지 않고** diff/백업 실패 분기와 호출 **순서**를 검증한다.
 */
export interface SyncDeps {
  diff?: PersonaDiffRunner
  backup?: (srcAbs: string, bakAbs: string) => void
  log?: (line: string) => void
}

/**
 * 기본 러너 — `git diff --no-index --no-color -- <shipped> <target>`.
 *
 * ⚠️ **exit 1은 정상이다**(내용이 다르다는 신호). 0·1만 받고 **2 이상만 오류**로 throw한다.
 *    기존 `createGitAdapter().exec`는 non-zero에서 throw하므로 이 용도에 쓸 수 없다 —
 *    exit code를 보존하는 `safeSpawnSyncStatus`를 쓴다(shell 없는 cross-spawn 경로는 동일).
 */
export const defaultPersonaDiffRunner: PersonaDiffRunner = (shippedAbs, targetAbs) => {
  const r = safeSpawnSyncStatus('git', ['diff', '--no-index', '--no-color', '--', shippedAbs, targetAbs])
  if (r.status !== 0 && r.status !== 1)
    throw new Error(`git diff --no-index 실패(exit=${r.status ?? 'null'}): ${r.stderr.trim()}`.trim())
  return r.stdout
}

/** diff 출력 상한(행). 초과분은 자르고 shipped 원본 절대경로를 안내해 사용자가 자기 도구로 전체를 본다. */
export const PERSONA_DIFF_MAX_LINES = 200

/**
 * diff 블록 렌더(순수). `text`가 비면 "차이 없음"이 아니라 **git이 빈 출력을 냈다**는 뜻이라 그대로 알린다.
 * 절단 시 남은 행 수와 shipped 절대경로를 반드시 함께 낸다 — 그래야 "정보에 기반한 선택"이 성립한다.
 */
export function renderPersonaDiff(
  text: string,
  d: NonNullable<SyncPlan['personaDiff']>,
  maxLines = PERSONA_DIFF_MAX_LINES,
): string[] {
  const L: string[] = ['', `── persona 차이 — ${d.targetRel} (좌: shipped / 우: 현재 파일) ──`]
  if (d.unmarked)
    L.push('  ⚠️  이 파일에는 kit 마커가 없습니다 — **당신이 직접 작성했을 수 있습니다.** 아래 diff를 반드시 확인하세요.')
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  if (lines.length === 0) {
    L.push('  (diff 출력이 비어 있습니다 — 내용은 다르지만 git이 표시할 텍스트 차이를 내지 않았습니다)')
  } else {
    for (const line of lines.slice(0, maxLines)) L.push(`  ${line}`)
    if (lines.length > maxLines) {
      L.push(`  … ${lines.length - maxLines}행 더 있음(출력 상한 ${maxLines}행에서 잘림)`)
      L.push(`  전체 비교: shipped 원본 = ${d.shippedAbs}`)
    }
  }
  L.push('')
  return L
}

/** 계획을 사람이 읽는 줄 배열로. shell 연산자 미사용(Windows PowerShell/cmd 호환 — DEC-011-8). */
export function renderPlan(plan: SyncPlan, apply: boolean, persona: boolean, gitignore = false): string[] {
  const L: string[] = []
  const GLYPH: Record<AssetStatus, string> = {
    new: '＋',
    'in-sync': '＝',
    stale: '～',
    'managed-drift': '！',
    'preserved-differs': '！',
    'unmanaged-custom': '·',
    'unmanaged-null': '·',
    'rules-missing': '＋',
  }
  L.push('')
  L.push(`[commitgate sync] vendored 계약 재동기화 ${apply ? '(--apply: 파일을 씁니다)' : '계획 (dry-run — 아무것도 쓰지 않습니다)'}`)
  L.push(`  대상: ${plan.targetRoot}`)
  L.push('')
  for (const a of plan.assets) {
    const label = STATUS_LABEL[a.status]
    L.push(`  ${GLYPH[a.status]} [${a.axis}] ${a.rel} — ${label}${a.note ? ` (${a.note})` : ''}`)
  }
  if (!persona) {
    L.push('')
    L.push('  ℹ️  페르소나는 미포함(--persona 로 opt-in). 스키마 축만 처리했습니다.')
  }
  if (!gitignore) {
    L.push('  ℹ️  workflow/.gitignore 는 미포함(--gitignore 로 opt-in). 기존 동작은 그대로입니다.')
  }
  L.push('')
  // 변경 건수 = 파일 복사(writes) + 행 추가(appends). 둘 다 없으면 "변경 없음".
  const changes = plan.writes.length + plan.appends.length
  const optIn = `${persona ? ' --persona' : ''}${gitignore ? ' --gitignore' : ''}`
  if (!apply) {
    if (changes > 0) {
      L.push(`  적용하려면: npx commitgate sync --apply${optIn}`)
      L.push(`  (변경 예정 ${changes}개. --apply 후 git diff 로 확인하고 스테이징·커밋하십시오.)`)
    } else {
      L.push('  변경 없음 — 이미 동기화되어 있습니다.')
    }
  } else if (changes > 0) {
    L.push(`  ✅ ${changes}개 파일 갱신. 다음: git diff 로 확인 후 커밋하십시오.`)
    for (const w of plan.writes) L.push(`     git add -- ${w.destRel}`)
    for (const a of plan.appends) L.push(`     git add -- ${a.destRel}`)
  } else {
    L.push('  변경 없음 — 이미 동기화되어 있습니다(쓰기 0건).')
  }
  return L
}

const STATUS_LABEL: Record<AssetStatus, string> = {
  new: '부재 → 복원',
  'in-sync': '최신(변경 없음)',
  stale: 'stale → 갱신',
  'managed-drift': 'kit 계보 · 차이 감지 → 기본 보존(--persona-apply 로 교체 가능)',
  'preserved-differs': '마커 없음 · 차이 감지 → 기본 보존(--persona-apply 로 교체 가능 — 직접 작성분일 수 있음)',
  'unmanaged-custom': 'custom 경로(unmanaged)',
  'unmanaged-null': '비활성(unmanaged)',
  'rules-missing': 'kit 규칙 누락 → 말미에 추가(기존 행 미변경)',
}

/**
 * 실행. 기본 plan(dry-run, 쓰기 0건), `--apply`에서만 쓴다.
 *
 * 🔴 packageRoot 가드: `targetRoot===PACKAGE_ROOT`면 어떤 쓰기 전에도 거부(fail-closed). CommitGate 패키지 자신을
 *    재작성하는 사고를 막는다. `loadConfig({root})` 명시로 resolveRoot fallback도 원천 차단(이중 방어).
 */
export function runSync(opts: SyncOptions, deps: SyncDeps = {}): SyncPlan {
  const log = deps.log ?? ((line: string) => console.log(line))
  const diffRunner = deps.diff ?? defaultPersonaDiffRunner
  const backupFile = deps.backup ?? ((srcAbs: string, bakAbs: string) => copyFileSync(srcAbs, bakAbs))

  const targetRoot = resolve(opts.dir)
  if (!existsSync(targetRoot)) throw new Error(`대상 디렉터리가 없음: ${targetRoot}`)
  assertGitWorkTree(targetRoot) // 실제 git probe(fake .git 마커 거부)
  if (canonical(targetRoot) === canonical(PACKAGE_ROOT))
    throw new Error('sync 대상이 CommitGate 패키지 자신입니다 — 소비 repo(commitgate를 devDependency로 설치한 곳)에서 실행하세요.')

  const cfg = loadConfig({ root: targetRoot }) // root 명시 → resolveRoot의 packageRoot fallback 안 탐
  const plan = planSync(targetRoot, cfg, opts.persona, opts.gitignore === true, opts.personaApply === true)

  // ── persona 차이의 실제 내용 diff — 🔴 **쓰기보다 먼저** 인쇄한다(REQ-2026-050 D5) ──
  // dry-run에서도 낸다. 사용자가 적용 여부를 고르려면 적용 전에 봐야 한다.
  if (plan.personaDiff) {
    const d = plan.personaDiff
    try {
      for (const line of renderPersonaDiff(diffRunner(d.shippedAbs, d.targetAbs), d)) log(line)
    } catch (err) {
      // 🔴 diff 생산 실패 = 교체 금지(fail-closed). 근거를 보여줄 수 없으면 선택을 받을 수 없다.
      const reason = err instanceof Error ? err.message : String(err)
      log('')
      log(`  ⚠️  persona diff를 생성하지 못했습니다 — ${reason}`)
      const dropped = plan.writes.length
      plan.writes = plan.writes.filter((w) => w.destRel !== d.targetRel)
      plan.backups = plan.backups.filter((b) => b.srcRel !== d.targetRel)
      if (dropped !== plan.writes.length)
        log('  ⛔ diff 없이는 교체하지 않습니다(fail-closed). persona는 미접촉으로 남깁니다.')
      log('')
    }
  }

  if (opts.apply) {
    // 백업이 writes보다 **먼저**다(D6). 실패하면 대응 write를 버리고 교체하지 않는다.
    for (const b of plan.backups) {
      const bakAbs = join(targetRoot, b.bakRel)
      try {
        statWritableDest(targetRoot, b.bakRel) // 백업 대상도 confinement 단일 경로를 탄다
        mkdirSync(dirname(bakAbs), { recursive: true })
        backupFile(join(targetRoot, b.srcRel), bakAbs)
        log(`  🗂  백업: ${b.bakRel} (직전 1세대만 보존 — 기존 백업은 덮어씀)`)
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        log(`  ⚠️  백업 실패 — ${reason}`)
        log('  ⛔ 백업 없이는 교체하지 않습니다(fail-closed).')
        plan.writes = plan.writes.filter((w) => w.destRel !== b.srcRel)
      }
    }
    for (const w of plan.writes) {
      // 쓰기 직전 confinement 재검증(planSync와 apply 사이 TOCTOU 최소화 — 단일 경로 재사용).
      statWritableDest(targetRoot, w.destRel)
      const destAbs = join(targetRoot, w.destRel)
      mkdirSync(dirname(destAbs), { recursive: true })
      copyFileSync(w.srcAbs, destAbs)
    }
    for (const a of plan.appends) {
      // 동일하게 쓰기 직전 confinement 재검증. append는 **읽고-덧붙여-쓰기**이므로 원본을 다시 읽는다.
      statWritableDest(targetRoot, a.destRel)
      const destAbs = join(targetRoot, a.destRel)
      writeFileSync(destAbs, appendIgnoreRules(readFileSync(destAbs, 'utf8'), a.missing), 'utf8')
    }
  }

  for (const line of renderPlan(plan, opts.apply, opts.persona, opts.gitignore === true)) log(line)
  if (plan.personaDiff && opts.personaApply !== true) {
    log('  ℹ️  persona 차이는 기본적으로 교체하지 않습니다 — 위 diff를 확인한 뒤')
    log('      `npx commitgate sync --apply --persona --persona-apply` 로만 교체됩니다(교체 전 .bak 백업).')
  }
  if (opts.personaApply === true && !opts.persona)
    log('  ℹ️  --persona-apply 는 --persona 를 함의하지 않습니다 — persona 축은 미접촉입니다(둘을 함께 주십시오).')
  return plan
}

/** CLI 파싱(fail-closed). `--flag=value` 미지원, 미지 토큰은 throw(init/migrate 관례). */
export function parseArgs(argv: string[]): SyncOptions {
  let dir = process.cwd()
  let apply = false
  let persona = false
  let gitignore = false
  let personaApply = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dir') {
      const v = argv[i + 1]
      if (v === undefined) throw new Error('--dir 값 누락')
      dir = v
      i++
    } else if (a === '--apply') {
      apply = true
    } else if (a === '--persona') {
      persona = true
    } else if (a === '--persona-apply') {
      personaApply = true
    } else if (a === '--gitignore') {
      gitignore = true
    } else if (a === '--dry-run') {
      apply = false // 기본값이지만 명시 허용
    } else if (a === '-h' || a === '--help') {
      printHelp()
      process.exit(0)
    } else {
      throw new Error(`알 수 없는 인자: ${a}`)
    }
  }
  return { dir: resolve(dir), apply, persona, gitignore, personaApply }
}

function printHelp(): void {
  console.log(`commitgate sync — vendored 스키마 축 계약을 설치된 패키지 사본으로 재동기화

사용법:
  npx commitgate sync [--dir <대상repo>]              계획만 출력(기본 — 아무것도 쓰지 않음)
  npx commitgate sync --apply [--dir <대상repo>]      스키마 축 재동기화
  npx commitgate sync --apply --persona               스키마 + 페르소나(부재 복원 · 차이 시 diff 표시) 재동기화
  npx commitgate sync --apply --persona --persona-apply   위 + 페르소나 차이를 shipped 로 교체(.bak 백업 후)
  npx commitgate sync --apply --gitignore             스키마 + workflow/.gitignore 누락 kit 규칙 보강

하는 일:
  workflow/machine.schema.json · workflow/req.config.schema.json 을 설치된 패키지 사본으로 되돌립니다.
  --persona: 페르소나가 부재면 복원합니다. 내용이 다르면 **적용 전에 실제 내용 diff 를 출력**하고
    기본적으로는 덮지 않습니다(dry-run 에서도 diff 를 봅니다).
  --persona-apply: 위 diff 를 확인한 뒤 교체하려면 --persona 와 **함께** 지정합니다.
    교체 전에 workflow/review-persona.md.bak 을 남깁니다(직전 1세대). 백업이나 diff 생성이
    실패하면 교체하지 않습니다(fail-closed). 마커가 없는 페르소나는 직접 작성분일 수 있어
    경고를 덧붙이지만, 교체 경로 자체는 동일합니다 — 판단은 사용자가 합니다.
  --gitignore: workflow/.gitignore 에 없는 kit 규칙 행만 말미에 추가합니다(기존 행은 미변경·미재정렬).
    파일이 없으면 kit 템플릿 전체로 생성합니다. 이미 있는 규칙은 건너뜁니다(멱등).
    0.9.6 이하 설치본은 review-call 로그 규칙이 없어 첫 리뷰 뒤 D10 이 커밋을 막습니다 — 이 옵션이 그 백필입니다.

하지 않는 일:
  companion skills · package.json · req:* · req.config.json 은 건드리지 않습니다.
  workflow/.gitignore 는 --gitignore 를 명시할 때만 손대며, 그때도 **덮어쓰지 않고 누락 행만 추가**합니다.
  캐럿 범위(^0.x)는 자동으로 못 넘깁니다 — 업그레이드(0.x) 문서(github.com/sol5288/commitgate/blob/main/docs/upgrade.md)를 참고해 범위를 먼저 올리세요.
`)
}

export function runCli(argv: string[]): void {
  try {
    runSync(parseArgs(argv))
  } catch (err) {
    console.error(`commitgate sync: ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
  }
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href
if (isMain) runCli(process.argv.slice(2))
