#!/usr/bin/env tsx
/**
 * commitgate integrate — **feature→trunk 로컬 통합 seam** (REQ-2026-126).
 *
 * 통합 직전 절차(전제 확인·strict 승인 증거 검증·GitHub CI 실행 opt-in·사람 최종 확인·로컬 merge)를
 * 소유한다. 판정·계획은 순수 코어(`scripts/req/lib/merge-gate.ts`)가 하고, 이 파일은 수집·질문·실행·
 * 감사 로그만 한다.
 *
 * 🔴 `delivery integrate`(feature→**delivery 브랜치**, delivery set 내부)와 층이 다르다 —
 *    이 verb는 trunk(`trunkBranch`) 병합이다.
 * 🔴 **항상 strict**: 미입증 커밋·manifest 문제가 있으면 병합하지 않는다(verify-range 보고 모드와 구별).
 * 🔴 **GitHub CI는 기본 실행하지 않는다.** 실행은 (a) `--run-github-ci` 명시, (b) config `githubCi`가
 *    있고 대화형 [y/N]에서 y일 때만. 생략은 정상 상태다. CI 실패·식별 불가면 병합하지 않는다.
 * 🔴 push·PR·자동 stash/reset·브랜치 삭제를 하지 않는다. 충돌 시 `merge --abort` 후 원래 브랜치 복귀.
 */
import { resolve, join, dirname } from 'node:path'
import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { loadConfig } from '../scripts/req/lib/config'
import { createGitAdapter, type GitAdapter } from '../scripts/req/lib/adapters'
import { isEntrypoint } from '../scripts/req/lib/cli-boundary'
import { verifyRangeDeep } from '../scripts/req/lib/verify-range'
import { readBlobsAtRef } from '../scripts/req/lib/git-batch'
import { planIntegration, decideCiRun, type IntegrationFacts, type IntegrationPlan } from '../scripts/req/lib/merge-gate'
import { awaitCiRun, createGhCiRunAdapter, type GithubCiRunPort, type CiRunResult } from '../scripts/req/lib/github-ci-run'
import { collectDeepInput, type RunDeps as VerifyRunDeps } from './verify-range'

// ───────────────────────────────── 인자 파싱(fail-closed) ──

export interface Opts {
  dir: string
  run: boolean
  /** true=`--run-github-ci` · false=`--no-github-ci` · null=미지정(config 있고 대화형이면 질문). */
  runGithubCi: boolean | null
}

export class HelpRequested extends Error {
  constructor() {
    super('help')
    this.name = 'HelpRequested'
  }
}

export function parseArgs(argv: string[]): Opts {
  let dir = process.cwd()
  let run = false
  let runGithubCi: boolean | null = null
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dir') {
      const v = argv[++i]
      if (v === undefined || v.startsWith('-')) throw new Error(`--dir 에 값이 필요합니다 (받음: ${v ?? '(없음)'})`)
      dir = v
    } else if (a === '--run') run = true
    else if (a === '--run-github-ci') {
      if (runGithubCi === false) throw new Error('--run-github-ci 와 --no-github-ci 는 함께 쓸 수 없습니다')
      runGithubCi = true
    } else if (a === '--no-github-ci') {
      if (runGithubCi === true) throw new Error('--run-github-ci 와 --no-github-ci 는 함께 쓸 수 없습니다')
      runGithubCi = false
    } else if (a === '-h' || a === '--help') throw new HelpRequested()
    else throw new Error(`알 수 없는 옵션: ${a}`)
  }
  return { dir: resolve(dir), run, runGithubCi }
}

// ───────────────────────────────── 질문 문구(고정 — 설계 DEC-5) ──

/** CI 실행 질문. 조회(verify-range의 CI_PROMPT)와 달리 **실행**이며 Actions 사용량이 발생할 수 있다. */
export const CI_RUN_PROMPT = 'GitHub CI workflow를 실행하시겠습니까? GitHub Actions 사용량 또는 비용이 발생할 수 있습니다. [y/N] '

export function finalMergePrompt(feature: string, trunk: string): string {
  return `${feature} 를 ${trunk} 에 병합합니다(로컬 merge — push 없음). 계속하시겠습니까? [y/N] `
}

/** y/Y만 긍정 — 그 외 전부 부정(기본 No). */
export function isYes(answer: string): boolean {
  return answer.trim().toLowerCase() === 'y'
}

// ───────────────────────────────── 감사 로그(설계 DEC-6) ──

export const INTEGRATE_RUN_LOG_REL = 'workflow/.integrate-runs.jsonl'

/** 1실행 = 1행. SHA·개수·CI 선택/결과뿐 — CI 출력 본문·커밋 메시지는 담지 않는다. */
export interface IntegrateRunRow {
  at: string
  trunk: string
  feature: string
  base: string | null
  head: string | null
  counts: { merge: number; bookkeeping: number; approved: number; unproven: number } | null
  manifest_problems: number | null
  /** null = dry-run(실행 안 함). */
  ci: 'skipped' | 'run-ok' | 'run-fail' | null
  ci_run_id: number | null
  ci_conclusion: string | null
  merged: boolean
  merge_sha: string | null
  exit: 0 | 1
}

/** 로그 파일이 gitignore돼 있을 때만 쓴다(verify-range 관례 — 미동기화 소비자에서 D10 차단 방지). */
export function makeAppendLog(rootAbs: string, git: GitAdapter, warn: (line: string) => void): (row: IntegrateRunRow) => void {
  return (row) => {
    try {
      git.exec(['check-ignore', '-q', INTEGRATE_RUN_LOG_REL])
    } catch {
      warn(`⚠️ ${INTEGRATE_RUN_LOG_REL} 이 .gitignore 대상이 아니라 기록을 건너뜁니다 — \`npx commitgate sync --apply --gitignore\` 로 규칙을 백필할 수 있습니다`)
      return
    }
    const abs = join(rootAbs, ...INTEGRATE_RUN_LOG_REL.split('/'))
    mkdirSync(dirname(abs), { recursive: true })
    appendFileSync(abs, `${JSON.stringify(row)}\n`, 'utf8')
  }
}

// ───────────────────────────────── 실행(설계 DEC-2 — 순서는 이 함수 하나가 소유) ──

export interface ExecuteResult {
  merged: boolean
  mergeSha: string | null
  detail: string
}

/**
 * trunk 체크아웃 → merge --no-ff. 실패 시 `merge --abort`(시도) → 원래 브랜치 복귀(시도).
 * 자동 reset/stash는 하지 않는다 — 복귀까지 실패하면 상태를 그대로 두고 수동 안내를 담아 반환한다.
 */
export function executeIntegration(git: GitAdapter, trunk: string, feature: string): ExecuteResult {
  try {
    git.exec(['checkout', trunk])
  } catch (err) {
    return { merged: false, mergeSha: null, detail: `trunk 체크아웃 실패: ${msg(err)}` }
  }
  try {
    git.exec(['merge', '--no-ff', feature, '-m', `merge: ${feature} → ${trunk} (commitgate integrate)`])
  } catch (err) {
    const failure = msg(err)
    try {
      git.exec(['merge', '--abort'])
    } catch {
      /* abort 불가(충돌 전 실패 등) — 복귀 시도는 계속한다 */
    }
    try {
      git.exec(['checkout', feature])
      return { merged: false, mergeSha: null, detail: `병합 실패(원상 복구함 — ${feature} 로 복귀): ${failure}` }
    } catch {
      return {
        merged: false,
        mergeSha: null,
        detail: `병합 실패 + 원래 브랜치 복귀도 실패 — 현재 상태를 그대로 두었습니다. \`git status\`로 확인 후 수동 복구하세요: ${failure}`,
      }
    }
  }
  const sha = git.exec(['rev-parse', 'HEAD']).trim()
  return { merged: true, mergeSha: sha, detail: `병합 완료 — ${trunk} @ ${sha.slice(0, 8)} (push는 하지 않았습니다)` }
}

// ───────────────────────────────── 수집·오케스트레이션 ──

export interface RunDeps {
  git: GitAdapter
  ciPort: GithubCiRunPort
  ask: (q: string) => Promise<string>
  interactive: boolean
  appendLog: (row: IntegrateRunRow) => void
  log: (line: string) => void
  now: () => string
  nowMs: () => number
  sleep: (ms: number) => Promise<void>
  trunkBranch: string | null
  branchPrefix: string
  ticketRoot: string
  githubCi: { workflow: string; timeoutMinutes: number } | null
  /** `.git` 디렉터리 하위 존재 검사(merge/rebase 진행 판정). */
  gitStateExists: (name: string) => boolean
  /** head tree blob 배치 읽기(REQ-2026-127 — verify-range와 같은 심층 수집 공유). 테스트는 fake 주입. */
  readBlobs: VerifyRunDeps['readBlobs']
}

export function collectFacts(deps: RunDeps): { facts: IntegrationFacts; base: string | null; head: string | null } {
  const currentBranch = deps.git.exec(['rev-parse', '--abbrev-ref', 'HEAD']).trim()
  let trunkExists = false
  if (deps.trunkBranch !== null) {
    try {
      deps.git.exec(['rev-parse', '--verify', `refs/heads/${deps.trunkBranch}`])
      trunkExists = true
    } catch {
      trunkExists = false
    }
  }
  const worktreeClean = deps.git.exec(['status', '--porcelain']).trim() === ''
  const mergeInProgress = deps.gitStateExists('MERGE_HEAD')
  const rebaseInProgress =
    deps.gitStateExists('REBASE_HEAD') || deps.gitStateExists('rebase-merge') || deps.gitStateExists('rebase-apply')

  let verify: IntegrationFacts['verify'] = null
  let base: string | null = null
  let head: string | null = null
  if (deps.trunkBranch !== null && trunkExists && currentBranch !== deps.trunkBranch) {
    try {
      head = deps.git.exec(['rev-parse', '--verify', 'HEAD^{commit}']).trim()
      base = deps.git.exec(['merge-base', deps.trunkBranch, head]).trim()
      // REQ-2026-127: verify-range CLI와 **같은 심층 수집·분류**를 공유한다(수집 분기 방지 — 설계 리뷰 observation).
      const report = verifyRangeDeep(collectDeepInput(deps.git, deps.readBlobs, base, head, deps.ticketRoot))
      verify = {
        counts: report.counts,
        manifestProblems: report.manifestProblems,
        unproven: report.unproven,
        invalid: report.invalid,
      }
    } catch {
      verify = null // 계산 불가 — plan이 차단한다(추정 금지)
    }
  }

  return {
    facts: {
      currentBranch,
      trunkBranch: deps.trunkBranch,
      branchPrefix: deps.branchPrefix,
      worktreeClean,
      mergeInProgress,
      rebaseInProgress,
      trunkExists,
      verify,
    },
    base,
    head,
  }
}

export interface RunResult {
  exit: 0 | 1
  plan: IntegrationPlan
  merged: boolean
}

export async function runIntegrate(opts: Opts, deps: RunDeps): Promise<RunResult> {
  const { facts, base, head } = collectFacts(deps)
  const plan = planIntegration(facts)
  // 감사 로그 실패는 결과·exit를 바꾸지 않는다(R4 — phase-3 r01 P1). 경고만 남긴다.
  const safeAppend = (r: IntegrateRunRow): void => {
    try {
      deps.appendLog(r)
    } catch (err) {
      deps.log(`⚠️ 감사 로그 기록 실패(결과에는 영향 없음): ${msg(err)}`)
    }
  }
  const row = (over: Partial<IntegrateRunRow>): IntegrateRunRow => ({
    at: deps.now(),
    trunk: facts.trunkBranch ?? '(없음)',
    feature: facts.currentBranch,
    base,
    head,
    counts: facts.verify?.counts ?? null,
    manifest_problems: facts.verify?.manifestProblems ?? null,
    ci: null,
    ci_run_id: null,
    ci_conclusion: null,
    merged: false,
    exit: 1,
    merge_sha: null,
    ...over,
  })

  if (!plan.ok) {
    deps.log('commitgate integrate — 차단:')
    for (const p of plan.problems) deps.log(`  - ${p}`)
    safeAppend(row({ exit: 1 }))
    return { exit: 1, plan, merged: false }
  }

  deps.log(`commitgate integrate — ${facts.currentBranch} → ${facts.trunkBranch}`)
  if (facts.verify !== null) {
    const c = facts.verify.counts
    deps.log(
      `  증거: 승인 소비 ${c.approved} · 도구 부기 ${c.bookkeeping} · 머지 ${c.merge} · attested ${c.attested} · 미입증 ${c.unproven} (strict 통과)`,
    )
  }
  deps.log('  실행 계획:')
  for (const s of plan.steps) deps.log(`    ${plan.steps.indexOf(s) + 1}. ${s}`)

  if (!opts.run) {
    deps.log('DRY-RUN — 병합하지 않았습니다. 실행하려면 --run 을 지정하세요.')
    // dry-run도 1실행 1행이다(DEC-6 — ci: null). 기본 명령의 실행 기록이 유실되면 안 된다(phase-3 r01 P1).
    safeAppend(row({ exit: 0 }))
    return { exit: 0, plan, merged: false }
  }

  // GitHub CI 실행 opt-in(설계 DEC-2·DEC-3). 생략은 정상 상태다.
  const decision = decideCiRun({ flag: opts.runGithubCi, configured: deps.githubCi !== null, interactive: deps.interactive })
  if (decision === 'fail-no-config') {
    deps.log('🔴 --run-github-ci 를 지정했지만 req.config.json 에 githubCi 설정이 없습니다 — CommitGate는 워크플로를 추측하지 않습니다.')
    deps.log('   예: "githubCi": { "workflow": "ci.yml", "timeoutMinutes": 30 }')
    safeAppend(row({ ci: 'run-fail', exit: 1 }))
    return { exit: 1, plan, merged: false }
  }
  let wantCi = decision === 'run'
  if (decision === 'ask') wantCi = isYes(await deps.ask(CI_RUN_PROMPT))

  let ci: IntegrateRunRow['ci'] = 'skipped'
  let ciResult: CiRunResult | null = null
  if (wantCi && deps.githubCi !== null && head !== null) {
    deps.log(`GitHub CI 실행: ${deps.githubCi.workflow} @ ${facts.currentBranch} (마감 ${deps.githubCi.timeoutMinutes}분)`)
    ciResult = await awaitCiRun(deps.ciPort, {
      workflow: deps.githubCi.workflow,
      ref: facts.currentBranch,
      expectedHeadSha: head,
      timeoutMinutes: deps.githubCi.timeoutMinutes,
      now: deps.nowMs,
      sleep: deps.sleep,
    })
    ci = ciResult.ok ? 'run-ok' : 'run-fail'
    if (!ciResult.ok) {
      deps.log(`🔴 GitHub CI 실행 확인 실패 — ${ciResult.reason}`)
      deps.log('   명시 요청한 CI 확인이 실패해 통합을 중단합니다(병합하지 않았습니다).')
      safeAppend(row({ ci, ci_run_id: ciResult.runId, ci_conclusion: ciResult.conclusion, exit: 1 }))
      return { exit: 1, plan, merged: false }
    }
    deps.log(`GitHub CI: run #${ciResult.runId} ${ciResult.conclusion} — 통과`)
  } else {
    deps.log('GitHub CI: 실행 생략(정상 — 로컬 검증만으로 계속합니다)')
  }

  // 사람의 최종 통합 확인(설계 DEC-5). 대화형은 [y/N] 기본 No, 비대화형은 --run 자체가 확정 동작.
  if (deps.interactive) {
    const ans = await deps.ask(finalMergePrompt(facts.currentBranch, facts.trunkBranch ?? ''))
    if (!isYes(ans)) {
      deps.log('통합을 취소했습니다(병합하지 않았습니다).')
      safeAppend(row({ ci, ci_run_id: ciResult?.runId ?? null, ci_conclusion: ciResult?.conclusion ?? null, exit: 0 }))
      return { exit: 0, plan, merged: false }
    }
  }

  const exec = executeIntegration(deps.git, facts.trunkBranch as string, facts.currentBranch)
  deps.log(exec.merged ? `✅ ${exec.detail}` : `🔴 ${exec.detail}`)
  const exit: 0 | 1 = exec.merged ? 0 : 1
  safeAppend(
    row({
      ci,
      ci_run_id: ciResult?.runId ?? null,
      ci_conclusion: ciResult?.conclusion ?? null,
      merged: exec.merged,
      merge_sha: exec.mergeSha,
      exit,
    }),
  )
  return { exit, plan, merged: exec.merged }
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// ───────────────────────────────── help ──

export function printHelp(): void {
  console.log(`commitgate integrate — feature→trunk 로컬 통합(전제 확인·strict 증거 검증·CI opt-in·사람 확인·merge)

사용법:
  npx commitgate integrate [--run] [--run-github-ci | --no-github-ci] [--dir <대상repo>]

동작(순서):
  1. 전제 확인 — feature 브랜치·clean worktree·진행 중 merge/rebase 없음·trunk 존재
  2. 로컬 승인 증거 검증(항상 strict) — merge-base(trunk, HEAD)..HEAD 분류, 미입증·손상 시 차단
  3. GitHub CI 실행 opt-in — 기본 실행하지 않음(아래 참조)
  4. 사람의 최종 확인([y/N] 기본 No — 비대화형은 --run 자체가 확정 동작)
  5. 로컬 merge --no-ff (충돌 시 원상 복구) — push는 하지 않습니다
  6. 감사 로그 1행(workflow/.integrate-runs.jsonl — gitignored)

옵션:
  --run             실제 통합 실행(기본은 dry-run — 계획만 출력)
  --run-github-ci   GitHub CI workflow 실행을 명시 요청(req.config.json githubCi 설정 필수)
  --no-github-ci    CI 실행을 명시 생략
  --dir <path>      대상 repo 루트(기본: 현재 디렉터리)
  -h, --help        도움말

GitHub CI는 기본 실행하지 않습니다:
  실행은 --run-github-ci 명시 또는(githubCi 설정이 있을 때) 대화형 [y/N]의 y 뿐입니다.
  설정이 없으면 질문하지 않고 생략합니다(생략은 정상 상태). 선택은 실행 단위이며 저장되지 않습니다.
  실행 전 원격 브랜치 SHA가 로컬 HEAD와 같아야 하며(자동 push 없음), dispatch한 run만 식별해
  완료를 확인합니다. 실패·timeout·식별 불가면 병합하지 않습니다.

참고: \`delivery integrate\` 는 delivery set 내부(feature→delivery 브랜치) 통합으로 이 명령과 층이 다릅니다.

exit: 0 = 성공(또는 dry-run 통과·사용자 취소) · 1 = 차단/실패/사용 오류.
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

export async function runCli(argv: string[]): Promise<void> {
  try {
    const opts = parseArgs(argv)
    const cfg = loadConfig({ root: opts.dir })
    const git = createGitAdapter(cfg.root)
    const gitDir = git.exec(['rev-parse', '--git-dir']).trim()
    const result = await runIntegrate(opts, {
      git,
      ciPort: createGhCiRunAdapter(cfg.root),
      ask: askViaReadline,
      interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
      appendLog: makeAppendLog(cfg.root, git, (l) => console.error(l)),
      log: (l) => console.error(l),
      now: () => new Date().toISOString(),
      nowMs: () => Date.now(),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      trunkBranch: cfg.trunkBranch,
      branchPrefix: cfg.branchPrefix,
      ticketRoot: cfg.ticketRoot,
      githubCi: cfg.githubCi,
      gitStateExists: (name) => existsSync(resolve(cfg.root, gitDir, name)),
      readBlobs: (ref, paths) => readBlobsAtRef(cfg.root, ref, paths),
    })
    if (result.exit !== 0) process.exitCode = result.exit
  } catch (err) {
    if (err instanceof HelpRequested) {
      printHelp()
      return
    }
    console.error(`commitgate integrate: ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
  }
}

const isMain = isEntrypoint(import.meta.url)
if (isMain) void runCli(process.argv.slice(2))
