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
 *   - **페르소나(`--persona` opt-in)**: 파괴적 쓰기 0건. **부재 복원만** 한다(부재면 loadReviewPersona가 이미
 *     fail-closed로 리뷰를 멈추므로 복원이 순이득). 내용이 다르면 사용자 편집일 수 있어 **덮지 않고 report-only**
 *     (manifest 없이 stale-kit↔사용자편집 구별 불가 → 편집 보존 방향; design-r02 P1). custom 경로·null은 unmanaged.
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
}

/**
 * 자산 처리 상태.
 * - `new`: dest 부재 → 복사(스키마/페르소나 공통, 잃을 것 없음).
 * - `in-sync`: sha 동일 → skip.
 * - `stale`: 스키마가 shipped와 다름 → 덮음(계약 = --force 축).
 * - `preserved-differs`: 기본 경로 페르소나가 shipped와 다름 → **미접촉**(사용자 편집 보존, report-only).
 * - `unmanaged-custom` / `unmanaged-null`: 페르소나 경로가 custom/null → 미접촉.
 */
export type AssetStatus =
  | 'new'
  | 'in-sync'
  | 'stale'
  | 'preserved-differs'
  | 'unmanaged-custom'
  | 'unmanaged-null'
  /** gitignore 축: 파일은 있으나 kit 규칙 일부가 없음 → **누락 행만** 말미에 append(REQ-2026-047). */
  | 'rules-missing'

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

export interface SyncPlan {
  targetRoot: string
  assets: AssetPlan[]
  /** apply 시 실제 복사할 항목(스키마 new/stale + 페르소나 부재복원 + gitignore 파일 부재 시 템플릿 전체). */
  writes: { srcAbs: string; destRel: string }[]
  /** apply 시 **행 단위 append**할 항목(gitignore 축 전용). 복사가 아니라 추가라 writes와 분리한다. */
  appends: GitignoreAppend[]
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
export function planSync(targetRoot: string, cfg: ResolvedConfig, persona: boolean, gitignore = false): SyncPlan {
  const assets: AssetPlan[] = []
  const writes: { srcAbs: string; destRel: string }[] = []
  const appends: GitignoreAppend[] = []

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
        // 🔴 다름 → 절대 덮지 않는다(사용자 편집 보존). manifest 없이 stale-kit과 편집을 구별 못 함(design-r02 P1).
        assets.push({
          rel: personaRel,
          axis: 'persona',
          status: 'preserved-differs',
          note: '기본 persona가 shipped와 다름 — 사용자 편집이면 유지, stale면 직접 교체(미접촉)',
        })
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

  return { targetRoot, assets, writes, appends }
}

/** 계획을 사람이 읽는 줄 배열로. shell 연산자 미사용(Windows PowerShell/cmd 호환 — DEC-011-8). */
export function renderPlan(plan: SyncPlan, apply: boolean, persona: boolean, gitignore = false): string[] {
  const L: string[] = []
  const GLYPH: Record<AssetStatus, string> = {
    new: '＋',
    'in-sync': '＝',
    stale: '～',
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
  'preserved-differs': '차이 감지 → 보존(수동 확인)',
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
export function runSync(opts: SyncOptions): SyncPlan {
  const targetRoot = resolve(opts.dir)
  if (!existsSync(targetRoot)) throw new Error(`대상 디렉터리가 없음: ${targetRoot}`)
  assertGitWorkTree(targetRoot) // 실제 git probe(fake .git 마커 거부)
  if (canonical(targetRoot) === canonical(PACKAGE_ROOT))
    throw new Error('sync 대상이 CommitGate 패키지 자신입니다 — 소비 repo(commitgate를 devDependency로 설치한 곳)에서 실행하세요.')

  const cfg = loadConfig({ root: targetRoot }) // root 명시 → resolveRoot의 packageRoot fallback 안 탐
  const plan = planSync(targetRoot, cfg, opts.persona, opts.gitignore === true)

  if (opts.apply) {
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

  for (const line of renderPlan(plan, opts.apply, opts.persona, opts.gitignore === true)) console.log(line)
  return plan
}

/** CLI 파싱(fail-closed). `--flag=value` 미지원, 미지 토큰은 throw(init/migrate 관례). */
export function parseArgs(argv: string[]): SyncOptions {
  let dir = process.cwd()
  let apply = false
  let persona = false
  let gitignore = false
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
  return { dir: resolve(dir), apply, persona, gitignore }
}

function printHelp(): void {
  console.log(`commitgate sync — vendored 스키마 축 계약을 설치된 패키지 사본으로 재동기화

사용법:
  npx commitgate sync [--dir <대상repo>]              계획만 출력(기본 — 아무것도 쓰지 않음)
  npx commitgate sync --apply [--dir <대상repo>]      스키마 축 재동기화
  npx commitgate sync --apply --persona               스키마 + 페르소나(부재 복원만) 재동기화
  npx commitgate sync --apply --gitignore             스키마 + workflow/.gitignore 누락 kit 규칙 보강

하는 일:
  workflow/machine.schema.json · workflow/req.config.schema.json 을 설치된 패키지 사본으로 되돌립니다.
  --persona: 페르소나가 부재면 복원합니다. 내용이 다르면(사용자 편집 가능성) 덮지 않고 보존만 합니다.
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
