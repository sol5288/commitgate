#!/usr/bin/env tsx
/**
 * commitgate verify-range — **머지 직전 로컬 승인 증거 검증 + GitHub CI opt-in** (REQ-2026-116).
 *
 * base..head 범위의 커밋을 로컬 git과 head 트리의 커밋된 approvals.jsonl만으로 분류해
 * (merge/bookkeeping/approved/**unproven**) 통합 통제점(I1/B1)의 사람 승인자에게 판단 재료를 준다.
 * 분류·판정은 순수 코어(`scripts/req/lib/verify-range.ts`)가 하고, 이 파일은 수집·프롬프트·출력만 한다.
 *
 * 🔴 **GitHub CI는 기본 비활성이다.** CI 확인은 (a) 대화형 [y/N]에서 y, (b) `--check-github-ci` 명시일
 *    때만 수행되고, 그것도 **조회**(head SHA의 check-runs 1회)이지 워크플로 트리거가 아니다(설계 DEC-3).
 *    CI를 요청하지 않은 경로는 gh CLI·GitHub 인증·네트워크에 일절 의존하지 않는다.
 * 🔴 **읽기 전용 + 로컬 관측 로그뿐이다.** 어떤 게이트에도 배선되지 않고(check.ts와 같은 지위),
 *    미입증 커밋이 있어도 기본 exit 0(보고 우선 — 설계 DEC-1). `--strict`만 게이트화한다.
 */
import { resolve, join, dirname } from 'node:path'
import { appendFileSync, mkdirSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { loadConfig } from '../scripts/req/lib/config'
import { createGitAdapter, safeSpawnSync, assertNotTestEnv, type GitAdapter } from '../scripts/req/lib/adapters'
import { isEntrypoint } from '../scripts/req/lib/cli-boundary'
import {
  verifyRangeDeep,
  collectDeepInput,
  computeExit,
  type CiOutcome,
  type DeepCommitMeta,
  type DeepVerifyInput,
  type DeepVerifyReport,
} from '../scripts/req/lib/verify-range'
import { attestationsPath, parseAttestations } from '../scripts/req/lib/attestations'
import { readBlobsAtRef, readBlobsByOid } from '../scripts/req/lib/git-batch'
import { createHash } from 'node:crypto'

// ───────────────────────────────── 인자 파싱(fail-closed — check.ts 관례) ──

export interface Opts {
  dir: string
  json: boolean
  strict: boolean
  base: string | null
  head: string | null
  /** true=`--check-github-ci` · false=`--no-check-github-ci` · null=미지정(대화형이면 질문, 아니면 생략). */
  githubCi: boolean | null
  /** deprecated alias 사용 시 호출부가 stderr로 낼 안내(순수 파서는 출력하지 않는다). */
  deprecations: string[]
}

export class HelpRequested extends Error {
  constructor() {
    super('help')
    this.name = 'HelpRequested'
  }
}

/** deprecated alias 안내(고정 문구 — REQ-2026-125 DEC-2). 의미는 동일(조회)·조용한 의미 변경 금지. */
export const CI_FLAG_DEPRECATION =
  '⚠️ --github-ci/--no-github-ci 는 --check-github-ci/--no-check-github-ci 로 이름이 바뀌었습니다(동작 동일 — 기존 결과 조회). 다음 릴리스에서 제거될 수 있습니다'

export function parseArgs(argv: string[]): Opts {
  let dir = process.cwd()
  let json = false
  let strict = false
  let base: string | null = null
  let head: string | null = null
  let githubCi: boolean | null = null
  const deprecations: string[] = []
  const takeValue = (flag: string, v: string | undefined): string => {
    // 값 자리에 온 옵션을 값으로 삼키지 않는다(check.ts phase-1 r01 P1과 같은 규칙).
    if (v === undefined || v.startsWith('-')) throw new Error(`${flag} 에 값이 필요합니다 (받음: ${v ?? '(없음)'})`)
    return v
  }
  // 충돌 검사는 alias 해석 **후** 공통 지점에서 한다(설계 DEC-2) — 교차 지정(--github-ci --no-check-github-ci)도 잡는다.
  const setCi = (value: boolean) => {
    if (githubCi === !value) throw new Error('--check-github-ci 와 --no-check-github-ci 는 함께 쓸 수 없습니다(alias 포함)')
    githubCi = value
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dir') dir = takeValue(a, argv[++i])
    else if (a === '--base') base = takeValue(a, argv[++i])
    else if (a === '--head') head = takeValue(a, argv[++i])
    else if (a === '--json') json = true
    else if (a === '--strict') strict = true
    else if (a === '--check-github-ci') setCi(true)
    else if (a === '--no-check-github-ci') setCi(false)
    else if (a === '--github-ci') {
      if (!deprecations.includes(CI_FLAG_DEPRECATION)) deprecations.push(CI_FLAG_DEPRECATION)
      setCi(true)
    } else if (a === '--no-github-ci') {
      if (!deprecations.includes(CI_FLAG_DEPRECATION)) deprecations.push(CI_FLAG_DEPRECATION)
      setCi(false)
    } else if (a === '-h' || a === '--help') throw new HelpRequested()
    else throw new Error(`알 수 없는 옵션: ${a}`)
  }
  return { dir: resolve(dir), json, strict, base, head, githubCi, deprecations }
}

// ───────────────────────────────── GitHub CI 포트(설계 DEC-3) ──

export interface CiCheckResult {
  ok: boolean
  detail: string
}

export interface GithubCiPort {
  check(headSha: string): CiCheckResult
}

/**
 * check-runs 응답 판정(순수 — 설계 DEC-3). 🔴 **부분 결과를 성공으로 판정하지 않는다**(설계 리뷰 r01 P1):
 * `total_count`가 수신 수보다 크면 미조회 run에 red가 있을 수 있으므로 확인 실패다.
 */
export function judgeCheckRunsPayload(raw: unknown): CiCheckResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, detail: 'check-runs 응답이 객체가 아닙니다' }
  const total = (raw as { total_count?: unknown }).total_count
  const runs = (raw as { check_runs?: unknown }).check_runs
  if (typeof total !== 'number' || !Array.isArray(runs)) return { ok: false, detail: 'check-runs 응답 형식이 다릅니다(total_count/check_runs 부재)' }
  if (total === 0) return { ok: false, detail: '이 SHA에 대한 CI 실행이 없습니다 — push 전이거나 CI 미구성' }
  if (total > runs.length) return { ok: false, detail: `부분 결과(수신 ${runs.length}/전체 ${total}) — 미조회 check-run이 있어 판정할 수 없습니다` }
  const bad: string[] = []
  for (const r of runs) {
    const name = String((r as { name?: unknown })?.name ?? '(이름 없음)')
    const status = (r as { status?: unknown })?.status
    const conclusion = (r as { conclusion?: unknown })?.conclusion
    if (status !== 'completed') bad.push(`${name}: 미완료(${String(status)})`)
    else if (conclusion !== 'success' && conclusion !== 'neutral' && conclusion !== 'skipped') bad.push(`${name}: ${String(conclusion)}`)
  }
  if (bad.length > 0) return { ok: false, detail: `실패한 check-run: ${bad.join(' · ')}` }
  return { ok: true, detail: `check-run ${runs.length}개 전부 green` }
}

/** gh CLI 어댑터. 폴링하지 않는다 — 1회 조회(비인증 rate limit 이력). 실패 사유는 그대로 표출한다. */
export function createGhCiAdapter(cwd: string, spawn: typeof safeSpawnSync = safeSpawnSync): GithubCiPort {
  // kill switch는 기본(실제) spawn일 때만 — 주입 spawn은 테스트 seam이다(REQ-2026-130).
  const isRealSpawn = spawn === safeSpawnSync
  return {
    check(headSha: string): CiCheckResult {
      if (isRealSpawn) assertNotTestEnv('gh(GitHub API 조회)')
      let out: string
      try {
        out = spawn('gh', ['api', `repos/{owner}/{repo}/commits/${headSha}/check-runs?per_page=100`], { cwd })
      } catch (err) {
        return { ok: false, detail: `gh 호출 실패(미설치·미인증·네트워크 포함): ${err instanceof Error ? err.message : String(err)}` }
      }
      try {
        return judgeCheckRunsPayload(JSON.parse(out))
      } catch {
        return { ok: false, detail: 'check-runs 응답을 JSON으로 파싱할 수 없습니다' }
      }
    },
  }
}

// ───────────────────────────────── CI opt-in 결정(설계 DEC-4, 순수) ──

/** 확정 정책의 질문 문구(고정). 기본은 No — Enter/n은 생략이다. 🔴 조회다 — 워크플로 실행이 아니다(REQ-2026-125). */
export const CI_PROMPT = '기존 GitHub CI 결과를 조회하시겠습니까? 워크플로를 실행하지 않습니다(GitHub API 조회 1회). [y/N] '

export type CiMode = 'check' | 'skip-explicit' | 'skip-default' | 'ask'

/** 플래그 > 대화형 질문 > 기본 생략. `--json`은 기계 소비라 질문하지 않는다. */
export function decideCiMode(opts: Pick<Opts, 'githubCi' | 'json'>, interactive: boolean): CiMode {
  if (opts.githubCi === true) return 'check'
  if (opts.githubCi === false) return 'skip-explicit'
  if (opts.json || !interactive) return 'skip-default'
  return 'ask'
}

/** 대화형 답변 해석(순수). `y`/`Y`만 실행 — 그 외 전부 생략(기본 No). `n`은 명시 생략으로 기록한다. */
export function ciModeFromAnswer(answer: string): Exclude<CiMode, 'ask'> {
  const a = answer.trim().toLowerCase()
  if (a === 'y') return 'check'
  if (a === 'n') return 'skip-explicit'
  return 'skip-default'
}

// ───────────────────────────────── 감사 로그(설계 DEC-5) ──

export const VERIFY_RUN_LOG_REL = 'workflow/.verify-runs.jsonl'

/** 1실행 = 1행. SHA·개수·선택뿐 — 커밋 메시지·파일 내용·프롬프트 본문은 담지 않는다. */
export interface VerifyRunRow {
  at: string
  base: string
  head: string
  /** REQ-2026-127: 6범주(additive — 구행은 4키·report의 관대 파서가 부재 키를 0으로 본다). */
  counts: DeepVerifyReport['counts']
  manifest_problems: number
  strict: boolean
  ci: CiOutcome
  exit: 0 | 1
}

// ───────────────────────────────── 오케스트레이션(포트 주입 — 테스트가 fake로 구동) ──

export interface RunDeps {
  git: GitAdapter
  ci: GithubCiPort
  /** 대화형 질문(CiMode 'ask'에서만 호출). */
  ask: (question: string) => Promise<string>
  interactive: boolean
  /** 감사 로그 append. throw는 경고로 흡수된다 — 관측이 판정을 바꾸면 안 된다(설계 DEC-5). */
  appendLog: (row: VerifyRunRow) => void
  log: (line: string) => void
  now: () => string
  trunkBranch: string | null
  ticketRoot: string
  /** head tree blob 배치 읽기(REQ-2026-127 — cat-file --batch 1프로세스). 테스트는 fake 주입. */
  readBlobs: (ref: string, paths: readonly string[]) => Map<string, Buffer | null>
  /** 🔴 REQ-2026-176: 같은 blob 을 **OID 로** 읽는 경로(경로 요청은 트리를 되짚어 비싸다). */
  readBlobsByOid: (oids: readonly string[]) => Map<string, Buffer | null>
}
// 🔴 REQ-2026-172 DEC-3: `collectDeepInput` 은 `lib/verify-range` 로 이관됐다(공유 대상).
//    `req:delegate` 의 발급 시점 preflight 가 같은 범위 사실을 필요로 하는데, scripts CLI 가
//    bin CLI 를 끌어오는 모양을 만들지 않기 위해서다. 여기 re-export 는 기존 import 경로
//    (`bin/integrate.ts`·테스트)를 깨지 않기 위한 것이다 — 동작은 바뀌지 않았다.
export { collectDeepInput }

export interface RunResult {
  exit: 0 | 1
  report: DeepVerifyReport
  ci: CiOutcome
  base: string
  head: string
}

export async function runVerifyRange(opts: Opts, deps: RunDeps): Promise<RunResult> {
  const headRef = opts.head ?? 'HEAD'
  const headSha = deps.git.exec(['rev-parse', '--verify', `${headRef}^{commit}`]).trim()

  let baseSha: string
  if (opts.base !== null) {
    baseSha = deps.git.exec(['rev-parse', '--verify', `${opts.base}^{commit}`]).trim()
  } else {
    if (deps.trunkBranch === null)
      throw new Error('trunkBranch가 null입니다 — --base <ref>를 명시하세요')
    baseSha = deps.git.exec(['merge-base', deps.trunkBranch, headSha]).trim()
  }

  // 1. 로컬 검증 — CI 선택과 무관하게 **항상** 수행한다(완료 기준 8). REQ-2026-127: 심층 6범주.
  const report = verifyRangeDeep(collectDeepInput(deps.git, deps.readBlobs, baseSha, headSha, deps.ticketRoot, deps.readBlobsByOid))

  // 2. GitHub CI opt-in — 선택은 이번 실행에만 유효하고 저장하지 않는다(설계 DEC-4).
  let mode = decideCiMode(opts, deps.interactive)
  if (mode === 'ask') mode = ciModeFromAnswer(await deps.ask(CI_PROMPT))

  let ci: CiOutcome
  if (mode === 'check') {
    const result = deps.ci.check(headSha)
    ci = result.ok ? 'checked-ok' : 'checked-fail'
    deps.log(result.ok ? `GitHub CI: 조회 성공 — ${result.detail}` : `🔴 GitHub CI: 조회 실패 — ${result.detail}`)
  } else {
    ci = mode === 'skip-explicit' ? 'skipped-explicit' : 'skipped-default'
    // 생략은 **정상 상태**다 — 실패처럼 보이면 안 된다(정책 9).
    deps.log('GitHub CI: 생략(정상 — 로컬 검증만으로 계속합니다)')
  }

  const exit = computeExit({
    unprovenCount: report.counts.unproven,
    invalidCount: report.counts['invalid-evidence'],
    strict: opts.strict,
    ci,
  })

  // 3. 감사 로그 — 쓰기 실패는 경고만, 판정·exit 불변(설계 DEC-5).
  try {
    deps.appendLog({
      at: deps.now(),
      base: baseSha,
      head: headSha,
      counts: report.counts,
      manifest_problems: report.manifestProblems,
      strict: opts.strict,
      ci,
      exit,
    })
  } catch (err) {
    deps.log(`⚠️ 감사 로그 기록 실패(판정에는 영향 없음): ${err instanceof Error ? err.message : String(err)}`)
  }

  return { exit, report, ci, base: baseSha, head: headSha }
}

// ───────────────────────────────── 렌더링(--json과 같은 결과에서 파생 — check.ts DEC-5 관례) ──

export function renderHuman(r: RunResult, strict: boolean): string {
  const lines: string[] = []
  const c = r.report.counts
  lines.push(`verify-range ${r.base.slice(0, 8)}..${r.head.slice(0, 8)} — 커밋 ${r.report.entries.length}개 (심층 검증)`)
  lines.push(
    `  승인 소비 ${c.approved} · 도구 부기 ${c.bookkeeping} · 머지 ${c.merge} · attested ${c.attested} · 손상 증거 ${c['invalid-evidence']} · 미입증 ${c.unproven}`,
  )
  if (r.report.manifestProblems > 0)
    lines.push(`  ⚠️ approvals.jsonl 파싱 문제 ${r.report.manifestProblems}행(건너뜀 — 손상을 숨기지 않되 검증은 계속)`)
  for (const n of r.report.verificationNotes) lines.push(`  ℹ️ ${n}`)
  for (const inv of r.report.invalid) {
    lines.push(`  ✗ ${inv.sha.slice(0, 8)} ${inv.subject}`)
    for (const p of inv.problems) lines.push(`      ${p}`)
  }
  for (const u of r.report.unproven) lines.push(`  ? ${u.sha.slice(0, 8)} ${u.subject}${u.note !== undefined ? ` — ${u.note}` : ''}`)
  if (c.unproven > 0)
    lines.push(
      `  미입증 = 승인 소비 기록·부기 trailer가 없는 커밋입니다. 규정된 워크플로 외 커밋(설치 스캐폴드·릴리스 등)일 수 있습니다 — 정당하면 \`commitgate attest <sha> --reason "..."\`로 예외 승인을 기록하세요.`,
    )
  if (c['invalid-evidence'] > 0)
    lines.push(`  손상 증거 = 승인 기록이 있으나 검증에 실패한 커밋입니다. attest로 구제되지 않습니다 — 증거를 수정하세요.`)
  lines.push(
    r.exit === 0
      ? `PASS — ${strict ? 'strict' : '보고'} 기준 통과`
      : `FAIL — ${strict && c.unproven + c['invalid-evidence'] > 0 ? `미입증 ${c.unproven}건·손상 ${c['invalid-evidence']}건(--strict)` : '명시 요청한 GitHub CI 조회 실패'}`,
  )
  return lines.join('\n')
}

export function renderJson(r: RunResult): string {
  return JSON.stringify(
    {
      base: r.base,
      head: r.head,
      counts: r.report.counts,
      unproven: r.report.unproven,
      invalid: r.report.invalid,
      verification_notes: r.report.verificationNotes,
      manifest_problems: r.report.manifestProblems,
      ci: r.ci,
      exit: r.exit,
    },
    null,
    2,
  )
}

export function printHelp(): void {
  console.log(`commitgate verify-range — 머지 직전 로컬 승인 증거 검증(읽기 전용) + GitHub CI opt-in

사용법:
  npx commitgate verify-range [--base <ref>] [--head <ref>] [--strict] [--json]
                              [--check-github-ci | --no-check-github-ci] [--dir <대상repo>]

동작:
  base..head 커밋을 로컬 증거만으로 분류합니다 — 승인 소비(approvals.jsonl의
  consumed_by_commit_sha) · 도구 부기(trailer) · 머지 · 미입증. GitHub 인증·네트워크 불필요.

옵션:
  --base <ref>     비교 기준(기본: req.config.json trunkBranch와의 merge-base)
  --head <ref>     검증 대상(기본: HEAD)
  --strict         미입증 커밋이 있으면 exit 1 (기본은 보고만 — exit 0)
  --check-github-ci     기존 GitHub CI 결과를 명시 조회(head SHA의 check-runs 1회 — 워크플로를 실행하지 않습니다)
  --no-check-github-ci  GitHub CI 조회를 명시 생략
  --github-ci / --no-github-ci   위 옵션의 deprecated alias(동작 동일 — 다음 릴리스에서 제거될 수 있음)
  --json           기계용 JSON 출력(질문하지 않음)
  --dir <path>     대상 repo 루트(기본: 현재 디렉터리)
  -h, --help       도움말

GitHub CI는 기본 비활성입니다:
  대화형에서는 "[y/N]"로 매번 묻고(기본 No), 비대화형·--json 에서는 플래그 없이는 생략합니다.
  조회는 기존 check-run 결과를 읽을 뿐 워크플로를 실행하지 않습니다(Actions 사용량을 새로
  발생시키지 않음 — GitHub API 조회 1회). 선택은 이번 실행에만 적용되며 저장되지 않습니다.
  생략은 정상 상태입니다. 명시 요청한 조회가 실패하면 exit 1 로 명확히 실패합니다.

exit: 0 = 검증 수행(기본) · 1 = --strict 미입증 / 명시 CI 확인 실패 / 사용 오류.
`)
}

// ───────────────────────────────── CLI 진입점 ──

function askViaReadline(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((res) =>
    rl.question(question, (answer) => {
      rl.close()
      res(answer)
    }),
  )
}

/** 로그 파일이 gitignore돼 있을 때만 쓴다 — 미동기화 소비자에서 untracked 로그가 D10을 막는 것을 방지(설계 §하위호환). */
export function makeAppendLog(rootAbs: string, git: GitAdapter, warn: (line: string) => void): (row: VerifyRunRow) => void {
  return (row) => {
    try {
      git.exec(['check-ignore', '-q', VERIFY_RUN_LOG_REL])
    } catch {
      warn(`⚠️ ${VERIFY_RUN_LOG_REL} 이 .gitignore 대상이 아니라 기록을 건너뜁니다 — \`npx commitgate sync --apply --gitignore\` 로 규칙을 백필할 수 있습니다`)
      return
    }
    const abs = join(rootAbs, ...VERIFY_RUN_LOG_REL.split('/'))
    mkdirSync(dirname(abs), { recursive: true })
    appendFileSync(abs, `${JSON.stringify(row)}\n`, 'utf8')
  }
}

export async function runCli(argv: string[]): Promise<void> {
  try {
    const opts = parseArgs(argv)
    for (const d of opts.deprecations) console.error(d)
    const cfg = loadConfig({ root: opts.dir })
    const git = createGitAdapter(cfg.root)
    const result = await runVerifyRange(opts, {
      git,
      ci: createGhCiAdapter(cfg.root),
      ask: askViaReadline,
      interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
      appendLog: makeAppendLog(cfg.root, git, (l) => console.error(l)),
      log: (l) => console.error(l),
      now: () => new Date().toISOString(),
      trunkBranch: cfg.trunkBranch,
      ticketRoot: cfg.ticketRoot,
      readBlobs: (ref, paths) => readBlobsAtRef(cfg.root, ref, paths),
      readBlobsByOid: (oids) => readBlobsByOid(cfg.root, oids),
    })
    console.log(opts.json ? renderJson(result) : renderHuman(result, opts.strict))
    if (result.exit !== 0) process.exitCode = result.exit
  } catch (err) {
    if (err instanceof HelpRequested) {
      printHelp()
      return
    }
    console.error(`commitgate verify-range: ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
  }
}

const isMain = isEntrypoint(import.meta.url)
if (isMain) void runCli(process.argv.slice(2))
