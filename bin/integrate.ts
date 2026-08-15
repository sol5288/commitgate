#!/usr/bin/env tsx
/**
 * commitgate integrate — **feature→trunk 로컬 통합 seam** (REQ-2026-126 · 0.22.0 RC 보완).
 *
 * 이 파일은 **인자 파싱·질문·출력·감사 로그**만 한다:
 *  - 전제·strict 증거 판정 → `scripts/req/lib/merge-gate.ts`(순수 코어)
 *  - 준비 토큰·재검증·CAS 병합 → `scripts/req/lib/integration-coordinator.ts`
 *  - CI 실행·run 결속 → `scripts/req/lib/github-ci-run.ts`
 *
 * 🔴 `delivery integrate`(feature→**delivery 브랜치**, delivery set 내부)와 층이 다르다 —
 *    이 verb는 trunk(`trunkBranch`) 병합이다.
 * 🔴 **항상 strict**: 미입증 커밋·manifest 문제가 있으면 병합하지 않는다(verify-range 보고 모드와 구별).
 * 🔴 **GitHub CI는 기본 실행하지 않는다.** 실행은 (a) `--run-github-ci` 명시, (b) config `githubCi`가
 *    있고 대화형 [y/N]에서 y일 때만. 생략은 정상 상태다. CI 실패·식별 불가면 병합하지 않는다.
 * 🔴 **검증한 SHA만 병합한다.** CI 대기·사람 확인 중에 feature/trunk ref가 움직였으면 병합하지 않고
 *    재실행을 안내한다(상세: integration-coordinator.ts의 불변식).
 * 🔴 PR·자동 stash/reset·브랜치 삭제를 하지 않는다.
 * 🔴 **push 는 기본적으로 하지 않는다.** 예외는 `stopGate:"auto"` 에서 사전 위임이 `origin_push` 를
 *    명시 허용한 경우뿐이고, required check 를 건너뛰는 push 는 `bypass_protection` 까지 필요하다
 *    (REQ-2026-140). 그 외 모든 경로에서 이 명령은 로컬 병합까지만 한다.
 */
import { resolve, join, dirname } from 'node:path'
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { loadConfig } from '../scripts/req/lib/config'
import { createGitAdapter, type GitAdapter } from '../scripts/req/lib/adapters'
import { isEntrypoint } from '../scripts/req/lib/cli-boundary'
import { verifyRangeDeep } from '../scripts/req/lib/verify-range'
import { readBlobsAtRef } from '../scripts/req/lib/git-batch'
import { decideCiRun, type IntegrationPlan } from '../scripts/req/lib/merge-gate'
import {
  IntegrationCoordinator,
  type CoordinatorDeps,
  type PreparedIntegration,
  type VerifySummary,
} from '../scripts/req/lib/integration-coordinator'
import { awaitCiRun, createGhCiRunAdapter, type GithubCiRunPort, type CiRunResult } from '../scripts/req/lib/github-ci-run'
import { deliveryApprovalBlock, deliveryRecordProblems, type DeliveryRecord } from '../scripts/req/lib/delivery'
import { bookkeepingMessage } from '../scripts/req/lib/bookkeeping'
import { collectDeepInput, type RunDeps as VerifyRunDeps } from './verify-range'
import { attributeRange } from '../scripts/req/lib/range-attribution'
import {
  DELEGATION_LEDGER_REL,
  DENY_GUIDANCE,
  delegationVerdict,
  foldDelegations,
  parseDelegationLedger,
  scopeOfBranch,
  type DelegationIssued,
  type DelegationPermissions,
  type DelegationRow,
  type DelegationScope,
} from '../scripts/req/lib/delegation'
import { isStopGate, type StopGate } from '../scripts/req/lib/config'

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

/** y/Y만 긍정 — 그 외 전부 부정(기본 No). Enter·빈 문자열·n 모두 부정이다. */
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
  /** 🔴 결속 증거(0.22.0 RC 보완): 검증한 두 SHA와 실제 merge 부모를 남긴다. */
  feature_head_sha: string | null
  trunk_head_sha: string | null
  merge_parents: [string, string] | null
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

// ───────────────────────────────── 오케스트레이션 ──

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
  /**
   * 이 저장소의 정지 정책(REQ-2026-140). `'auto'` 일 때만 **사전 위임을 요구**한다.
   * 🔴 다른 값에서는 이 축이 아무것도 바꾸지 않는다 — 무회귀가 이 한 줄에 걸려 있다.
   */
  stopGate: StopGate
  /** 위임 원장 텍스트(없으면 `null`). */
  readDelegationLedger: () => string | null
  /** 원장에 한 행을 append 하고 그 파일만 부기 커밋한다(CAS 선점). */
  appendDelegationRow: (row: DelegationRow, subject: string) => void
  /** 리뷰 하드 상한 — 도달하면 위임이 있어도 통합을 막는다(설계 DEC-7). */
  reviewHardCap: number
}

/**
 * `RunDeps` → coordinator 의존성. verify는 **verify-range CLI와 같은 수집·분류**를 주입한다
 * (수집 분기 방지 — 설계 리뷰 observation).
 */
export function makeCoordinatorDeps(deps: RunDeps): CoordinatorDeps {
  return {
    git: deps.git,
    gitStateExists: deps.gitStateExists,
    trunkBranch: deps.trunkBranch,
    branchPrefix: deps.branchPrefix,
    verify: (base, head): VerifySummary | null => {
      const report = verifyRangeDeep(collectDeepInput(deps.git, deps.readBlobs, base, head, deps.ticketRoot))
      return { counts: report.counts, manifestProblems: report.manifestProblems, unproven: report.unproven, invalid: report.invalid }
    },
  }
}

export interface RunResult {
  exit: 0 | 1
  plan: IntegrationPlan
  merged: boolean
}

// ───────────────────────────────── 사전 위임 게이트 (REQ-2026-140 phase-4b) ──

/** 이번 통합에서 하려는 작업. 4b-1 은 로컬 병합만 한다(push·bypass 는 4b-2). */
const REQUESTED_LOCAL_ONLY: DelegationPermissions = {
  local_merge: true,
  origin_push: false,
  bypass_protection: false,
}

/** 원격 이름. 🔴 추측하지 않는다 — git 기본값이며, 다르면 push 자체가 실패해 조용히 넘어가지 않는다. */
export const PUSH_REMOTE = 'origin'

/**
 * 이번 실행에서 **실제로 할 작업**과 그 문제를 정한다 (REQ-2026-140 phase-4c).
 *
 * 🔴 **branch protection 을 읽지 않는다 — 읽을 수 없다.** 보호 설정은 서버 쪽 권한이라 로컬에서
 *    조회할 수단이 없다. 그래서 **보수적으로** 판단한다: `githubCi` 가 설정된 저장소에서 trunk push 는
 *    required check 를 건너뛰는 것으로 본다. 틀리는 방향이 "더 강한 권한을 요구하는" 쪽이라 안전하다.
 *
 * 🔴 **`githubCi` 설정 유무로 판단하지 않는다**(r02 P1) — 그것은 CommitGate 가 CI 를 실행할지의
 *    opt-in 일 뿐이고, 원격에 외부 CI 가 required check 로 걸려 있을 수 있다. 원격 보호 상태는 로컬에서
 *    알 수 없으므로 **push 자체가 우회**다.
 * 🔴 **CI 를 실행해 통과했어도 마찬가지다**(r01 P1). CI 는 **feature SHA** 에 결속되는데,
 *    trunk 로 올라가는 것은 소비 커밋과 CAS 병합으로 **새로 만들어진 merge SHA** 다 — 그 SHA 에 대해
 *    required check 가 돌아간 적은 없다. "CI 를 봤으니 우회가 아니다"는 검사 대상을 혼동한 것이다.
 *
 * 🔴 두 권한은 **독립**이다. push 를 위임했다고 우회까지 위임한 것이 아니다.
 */
export function planPushActions(granted: DelegationPermissions): { performed: DelegationPermissions; problem: string | null } {
  const wantPush = granted.origin_push
  // 🔴 원격 보호 상태를 **알 수 없으므로 항상 우회로 본다**(r02 P1). `githubCi` 는 CommitGate 가 CI 를
  //    실행할지의 opt-in 일 뿐, required check 가 있는지와 무관하다 — 외부 CI 가 required 일 수 있다.
  const bypasses = wantPush
  if (bypasses && !granted.bypass_protection)
    return {
      performed: REQUESTED_LOCAL_ONLY,
      problem:
        'origin push 가 required check 를 건너뜁니다(병합으로 만들어진 merge SHA 는 검사된 적이 없습니다) — ' +
        '`--allow-bypass` 로 위임했을 때만 진행합니다. 위임하지 않았다면 로컬 병합까지만 하고 push 는 사람이 하세요.',
    }
  return {
    performed: { local_merge: true, origin_push: wantPush, bypass_protection: bypasses },
    problem: null,
  }
}

export type DelegationGateResult =
  | { kind: 'not-required' }
  | { kind: 'allowed'; delegationId: string; permissions: DelegationPermissions }
  | { kind: 'denied'; lines: string[] }

/**
 * `stopGate: "auto"` 에서 **사전 위임을 요구**한다.
 *
 * 🔴 **다른 값에서는 아무것도 하지 않는다**(`not-required`) — `phase`·`req`·`merge` 무회귀가 여기 걸려 있다.
 * 🔴 **오늘 이 경로에 도구 게이트가 없다**는 사실이 이 함수의 존재 이유다: `integrate --run` 은
 *    비대화형 세션에서 질문 없이 병합한다(`deps.interactive` 분기). 지금까지 그것을 막은 것은
 *    `AGENTS.md` 계약이지 도구가 아니었다. `auto` 는 그 자리에 **처음으로** 도구 게이트를 건다.
 */
export interface AutoFacts {
  riskLevel: string | null
  budgetHardCapReached: boolean
  reviewInconclusive: boolean
  /** delivery scope 일 때의 멤버(`null` = 읽지 못함 → scope 검사가 거부). ticket scope 면 `null`. */
  deliveryMembers: string[] | null
  compositionChanged: boolean
  /**
   * 정책 해소용 멤버별 사실(REQ-2026-159). ticket scope 면 원소 하나, delivery scope 면 구성 전체.
   * 🔴 `deliveryMembers` 와 **다른 경로로 읽는다** — 저쪽은 유효 위임의 `base_sha` 가 있어야
   *    채워지므로(구성 변경 비교용), 위임이 없는 `merge` 경로에서는 항상 `null` 이다.
   *    정책 판정을 거기에 묶으면 위임 없는 묶음 통합이 전부 막힌다.
   */
  memberPolicies: { id: string; snapshotStopGate: StopGate | null; stateUnreadable: boolean }[]
  /** 🔴 delivery scope 인데 **묶음 레코드 자체**를 읽지 못했다 → 정책 판정 불가(fail-closed). */
  policyMembersUnknown: boolean
}

/**
 * `auto` 판정에 필요한 사실을 모은다.
 *
 * 🔴 **위임의 `base_sha` 가 필요해 원장을 먼저 접는다.** 유효 위임이 정확히 하나가 아니면 그 자체가
 *    거부 사유이므로(`absent`·`ambiguous-active`), 여기서는 보수적 기본값을 돌려주고 판정은 verdict 에 맡긴다.
 */
export function collectAutoFacts(
  deps: Pick<RunDeps, 'readDelegationLedger' | 'ticketRoot' | 'readBlobs' | 'reviewHardCap'>,
  prepared: PreparedIntegration,
  scope: DelegationScope,
): AutoFacts {
  const { rows } = parseDelegationLedger(deps.readDelegationLedger())
  const active = foldDelegations(rows, scope).active
  const baseSha = active.length === 1 ? (active[0] as DelegationIssued).base_sha : null

  if (scope.kind === 'ticket') {
    const t = readTicketFacts(deps.readBlobs, prepared.featureHeadSha, deps.ticketRoot, scope.req_id, deps.reviewHardCap)
    return {
      ...t,
      deliveryMembers: null,
      compositionChanged: false,
      memberPolicies: [{ id: scope.req_id, snapshotStopGate: t.snapshotStopGate, stateUnreadable: t.stateUnreadable }],
      policyMembersUnknown: false,
    }
  }

  /**
   * 🔴 정책 판정용 멤버 목록은 **위임과 무관하게** 읽는다. `readDeliveryFacts` 는 구성 변경 비교를
   *    위해 `base_sha` 를 요구하므로 위임이 없으면 `null` 이고, 거기에 정책을 묶으면 `merge` 경로의
   *    묶음 통합이 전부 막힌다.
   */
  const policyMembers = readDeliveryMembersAt(deps.readBlobs, deps.ticketRoot, scope.slug, prepared.featureHeadSha)

  const d =
    baseSha === null
      ? { members: null, compositionChanged: true }
      : readDeliveryFacts(deps.readBlobs, deps.ticketRoot, scope.slug, prepared.featureHeadSha, baseSha)
  /**
   * 🔴 **멤버 전체를 보수적으로 합친다** — 하나라도 HIGH·hardCap·미결이면 묶음 전체가 그렇다.
   *    멤버를 못 읽으면 `null` 이라 scope 검사가 먼저 거부한다.
   */
  const members = d.members ?? []
  const each = members.map((id) => readTicketFacts(deps.readBlobs, prepared.featureHeadSha, deps.ticketRoot, id, deps.reviewHardCap))
  const policyEach = (policyMembers ?? []).map((id) => ({
    id,
    ...readTicketFacts(deps.readBlobs, prepared.featureHeadSha, deps.ticketRoot, id, deps.reviewHardCap),
  }))
  return {
    riskLevel: each.some((f) => f.riskLevel === 'HIGH') ? 'HIGH' : 'LOW',
    budgetHardCapReached: each.some((f) => f.budgetHardCapReached),
    reviewInconclusive: each.some((f) => f.reviewInconclusive),
    deliveryMembers: d.members,
    compositionChanged: d.compositionChanged,
    memberPolicies: policyEach.map((f) => ({ id: f.id, snapshotStopGate: f.snapshotStopGate, stateUnreadable: f.stateUnreadable })),
    policyMembersUnknown: policyMembers === null,
  }
}

export function delegationGate(
  deps: Pick<RunDeps, 'readDelegationLedger' | 'now' | 'branchPrefix' | 'ticketRoot' | 'git' | 'readBlobs'>,
  prepared: PreparedIntegration,
  ticketFacts: AutoFacts,
  /**
   * 🔴 **`deps.stopGate` 를 읽지 않는다**(REQ-2026-159). 값은 `resolveIntegrationPolicy` 가
   *    **티켓 스냅샷**에서 해소한 것이다 — config 를 나중에 바꿔도 판정이 바뀌면 안 된다.
   *    `deps` 의 `Pick` 에서 `stopGate` 를 뺀 것이 핵심이다: 다시 읽으면 tsc 가 잡는다.
   */
  delegationRequired: boolean,
): DelegationGateResult {
  if (!delegationRequired) return { kind: 'not-required' }

  const scope = scopeOfBranch(prepared.featureBranch, deps.branchPrefix)
  if (scope === null)
    return {
      kind: 'denied',
      lines: [
        `사전 위임 대상을 브랜치 이름에서 판정할 수 없습니다: ${prepared.featureBranch}`,
        `  stopGate:"auto" 는 위임 대상이 확정돼야 진행합니다 — 사람 확인으로 통합하세요.`,
      ],
    }
  // 범위 귀속(DEC-4a) — `verifyRangeDeep` 과 **같은 입력**으로 계산한다(분류기 이원화 금지).
  const deepInput = collectDeepInput(deps.git, deps.readBlobs, prepared.trunkHeadSha, prepared.featureHeadSha, deps.ticketRoot)
  const report = verifyRangeDeep(deepInput)
  const attribution = attributeRange({
    commits: deepInput.commits,
    entries: report.entries,
    manifests: deepInput.manifests,
    ticketRoot: deps.ticketRoot,
  })

  const verdict = delegationVerdict({
    ledgerText: deps.readDelegationLedger(),
    scope,
    now: deps.now(),
    trunkBranch: prepared.trunkBranch,
    trunkSha: prepared.trunkHeadSha,
    sourceBranch: prepared.featureBranch,
    requested: REQUESTED_LOCAL_ONLY,
    riskLevel: ticketFacts.riskLevel,
    budgetHardCapReached: ticketFacts.budgetHardCapReached,
    reviewInconclusive: ticketFacts.reviewInconclusive,
    evidenceOk: true, // strict 는 이 지점 **전에** 이미 통과했다(plan.ok) — 그 사실을 그대로 넘긴다.
    rangeAttribution: attribution,
    deliveryMembers: ticketFacts.deliveryMembers,
    compositionChanged: ticketFacts.compositionChanged,
  })

  if (verdict.ok) return { kind: 'allowed', delegationId: verdict.row.id, permissions: verdict.row.permissions }
  const lines = [`사전 위임이 이 통합을 허용하지 않습니다 (${verdict.reason}): ${verdict.detail}`, `  → ${DENY_GUIDANCE[verdict.reason]}`]
  for (const u of attribution.unattributableCommits.slice(0, 3))
    lines.push(`  · 판정 불가: ${u.sha.slice(0, 8)} ${u.subject} — ${u.why}`)
  return { kind: 'denied', lines }
}

/**
 * DEC-5 불변식 — **검증된 `V` 와 병합할 `C` 사이에 소비 커밋 하나만 허용**한다.
 *
 * 1. `rev-list V..C` 가 정확히 `[C]`
 * 2. `C` 가 바꾼 경로가 위임 원장 하나뿐
 * 3. trunk 가 그대로
 *
 * 🔴 이 검사가 없으면 "검증한 SHA만 병합한다"가 소비 커밋 때문에 조용히 깨진다. 문제가 있으면
 *    **병합하지 않는다** — 위임은 이미 소진됐고, 그것이 이 방향의 트레이드오프다.
 */
/** 실제 수행 결과를 원장에 덧붙인다. 🔴 기록 실패가 결과를 바꾸지 않는다 — 경고만 남긴다. */
function recordExecution(
  deps: Pick<RunDeps, 'appendDelegationRow' | 'now' | 'log'>,
  gate: DelegationGateResult,
  exec: { merged: boolean; mergeSha: string | null },
  performed: DelegationPermissions,
  detail: string,
): void {
  if (gate.kind !== 'allowed') return
  try {
    deps.appendDelegationRow(
      { kind: 'executed', id: gate.delegationId, at: deps.now(), merge_sha: exec.mergeSha, performed, detail },
      `delegate — ${gate.delegationId.slice(0, 8)} 수행 기록`,
    )
  } catch (err) {
    deps.log(`⚠️ 수행 기록을 원장에 남기지 못했습니다(결과에는 영향 없음): ${msg(err)}`)
  }
}

export function claimCommitProblem(
  git: GitAdapter,
  verifiedSha: string,
  claimedSha: string,
  trunkBefore: string,
  trunkNow: string,
): string | null {
  if (trunkNow !== trunkBefore) return `소비 커밋 사이에 trunk 가 움직였습니다(${trunkBefore.slice(0, 8)} → ${trunkNow.slice(0, 8)})`
  if (claimedSha === verifiedSha) return '소비 커밋이 만들어지지 않았습니다'
  let between: string[]
  let paths: string[]
  try {
    between = git
      .exec(['rev-list', `${verifiedSha}..${claimedSha}`])
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
    paths = git
      .exec(['show', '--name-only', '--format=', claimedSha])
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
  } catch (err) {
    return `소비 커밋을 확인하지 못했습니다: ${msg(err)}`
  }
  if (between.length !== 1 || between[0] !== claimedSha)
    return `검증한 SHA 와 병합할 SHA 사이에 다른 커밋이 있습니다(${between.length}건)`
  const foreign = paths.filter((p) => p !== DELEGATION_LEDGER_REL)
  if (foreign.length > 0)
    return `소비 커밋이 위임 원장 밖을 바꿨습니다: ${foreign.slice(0, 3).join(', ')}`
  return null
}

/**
 * delivery 묶음의 **멤버**와 **구성 변화**를 읽는다 (REQ-2026-140 phase-4c).
 *
 * 🔴 **구성 변화를 위임 레코드에 저장하지 않는다.** 대신 위임이 박아 둔 `base_sha` 시점의 레코드와
 *    현재 레코드를 **둘 다 git 에서 읽어** 비교한다 — 스냅샷을 레코드에 넣으면 그 값이 실제와 갈라질
 *    자리를 새로 만드는 셈이다(REQ-2026-129 가 스냅샷에 `stop_gate` 하나만 둔 것과 같은 이유).
 *
 * 🔴 어느 쪽이든 읽지 못하거나 손상이면 **fail-closed**: 멤버는 `null`(= scope 검사가 거부),
 *    구성은 바뀐 것으로 본다.
 */
/**
 * 묶음 레코드의 멤버 키(`<req_id>#<order>`)를 한 ref 에서 읽는다. 읽지 못하면 `null`(fail-closed).
 *
 * 🔴 **`order` 필드까지 포함한다**(phase-4c 리뷰 r04 P1). 배열 순서만 보면 같은 배열에서 `order`
 *    값만 뒤바뀐 레코드를 동일하다고 읽는다 — `order` 는 successor 체인의 방향을 정하므로
 *    그것이 바뀐 묶음은 **다른 묶음**이다.
 */
function deliveryMemberKeysAt(
  readBlobs: VerifyRunDeps['readBlobs'],
  ticketRoot: string,
  slug: string,
  ref: string,
): string[] | null {
  const rel = `${ticketRoot}/delivery/${slug}.json`
  try {
    const buf = readBlobs(ref, [rel]).get(rel)
    if (buf === null || buf === undefined) return null
    const raw: unknown = JSON.parse(buf.toString('utf8'))
    if (deliveryRecordProblems(raw).length > 0) return null
    return (raw as DeliveryRecord).members.map((m) => `${m.req_id}#${m.order}`)
  } catch {
    return null
  }
}

/**
 * 정책 판정용 **멤버 티켓 id** 목록(REQ-2026-159). `order` 는 떼고 돌려준다.
 * 🔴 `readDeliveryFacts` 와 달리 `base_sha` 를 요구하지 않는다 — 위임이 없는 경로에서도 읽어야 한다.
 */
export function readDeliveryMembersAt(
  readBlobs: VerifyRunDeps['readBlobs'],
  ticketRoot: string,
  slug: string,
  ref: string,
): string[] | null {
  const keys = deliveryMemberKeysAt(readBlobs, ticketRoot, slug, ref)
  return keys === null ? null : keys.map((k) => k.split('#')[0] as string)
}

export function readDeliveryFacts(
  readBlobs: VerifyRunDeps['readBlobs'],
  ticketRoot: string,
  slug: string,
  headRef: string,
  baseSha: string,
): { members: string[] | null; compositionChanged: boolean } {
  const membersAt = (ref: string): string[] | null => deliveryMemberKeysAt(readBlobs, ticketRoot, slug, ref)
  const now = membersAt(headRef)
  if (now === null) return { members: null, compositionChanged: true }
  const then = membersAt(baseSha)
  const changed = then === null || then.length !== now.length || then.some((k, i) => k !== now[i])
  // scope 검사에는 티켓 id 만 넘긴다(`order` 는 구성 비교 전용).
  return { members: now.map((k) => k.split('#')[0] as string), compositionChanged: changed }
}

/**
 * 티켓 `state.json` 에서 위험도·예산·리뷰 상태를 읽는다(head tree 기준).
 *
 * 🔴 읽지 못하면 **fail-closed** 로 되돌린다: 위험도 미상은 `HIGH` 로, 리뷰 상태는 미결로 본다.
 *    자율 통합의 입력을 "모르니까 통과"로 읽으면 그것이 곧 구멍이다.
 */
export function readTicketFacts(
  readBlobs: VerifyRunDeps['readBlobs'],
  ref: string,
  ticketRoot: string,
  reqId: string,
  hardCap: number,
): {
  riskLevel: string | null
  budgetHardCapReached: boolean
  reviewInconclusive: boolean
  /**
   * 이 티켓의 **정책 스냅샷**(REQ-2026-159). `null` = state 는 읽었지만 스냅샷이 없거나 손상
   * (= legacy → config 폴백). `effectiveStopGate` 와 **같은 기준**이다.
   */
  snapshotStopGate: StopGate | null
  /**
   * 🔴 **state 자체를 읽지 못했다**(부재·JSON 깨짐). legacy 와 **구분**해야 한다 —
   *    legacy 는 "읽었고 스냅샷이 없다"이고, 이쪽은 **어느 정책이 지배하는지 모른다**이다.
   */
  stateUnreadable: boolean
} {
  const rel = `${ticketRoot}/${reqId}/state.json`
  const unknown = {
    riskLevel: 'HIGH',
    budgetHardCapReached: false,
    reviewInconclusive: true,
    snapshotStopGate: null,
    stateUnreadable: true,
  }
  let text: string
  try {
    const buf = readBlobs(ref, [rel]).get(rel)
    if (buf === null || buf === undefined) return unknown
    text = buf.toString('utf8')
  } catch {
    return unknown
  }
  let st: { risk_level?: unknown; review_series?: unknown; policy_snapshot?: unknown }
  try {
    st = JSON.parse(text) as typeof st
  } catch {
    return unknown
  }
  // 🔴 스냅샷 해석은 **정본 resolver 와 같은 기준**이어야 한다 — 규칙을 두 벌 만들면 갈라진다.
  //    `effectiveStopGate` 는 config 폴백까지 하므로, 여기서는 "스냅샷 자체"만 꺼낸다.
  const snapRaw = st.policy_snapshot
  const pinned =
    snapRaw !== null && typeof snapRaw === 'object' ? (snapRaw as { stop_gate?: unknown }).stop_gate : undefined
  const snapshotStopGate: StopGate | null = isStopGate(pinned) ? pinned : null
  const series = Array.isArray(st.review_series) ? (st.review_series as { attempts?: unknown; closed_reason?: unknown }[]) : []
  return {
    riskLevel: typeof st.risk_level === 'string' ? st.risk_level : 'HIGH',
    budgetHardCapReached: series.some((s) => typeof s.attempts === 'number' && s.attempts >= hardCap),
    reviewInconclusive: series.some((s) => s.closed_reason === null),
    snapshotStopGate,
    stateUnreadable: false,
  }
}

/**
 * 이 통합에 **위임이 필요한지**를 해소한다(REQ-2026-159 DEC-2·DEC-3, 순수).
 *
 * 🔴 **`cfg.stopGate` 를 그대로 쓰지 않는다.** REQ-2026-129 는 `stopGate` 를 티켓에 동결했지만
 *    `integrate` 만 정본 resolver 를 쓰지 않아, `auto` 로 시작한 티켓이 나중 config 변경으로
 *    **위임 없이 병합**될 수 있었다(비대화형은 최종 확인도 묻지 않는다).
 *
 * 🔴 **합치기 규칙을 따로 만들지 않는다**(설계 r01 P1). 멤버마다 `effectiveStopGate` 를 적용하고
 *    그 결과만 합친다 — "그 외 → config" 식으로 접으면 **유효한 `merge` 스냅샷이 버려져**
 *    없던 위임 요구가 생긴다. ticket scope 는 멤버가 하나인 경우다.
 *
 * 🔴 결과가 `StopGate` 가 아니라 `boolean` 인 이유: `phase`·`req`·`merge` 는 이 통제점에서
 *    **구별되지 않는다**(셋 다 위임을 요구하지 않는다). 없는 구별을 타입으로 지어내지 않는다.
 */
export type IntegrationPolicy =
  | { kind: 'indeterminate'; lines: string[] }
  | { kind: 'resolved'; delegationRequired: boolean; basis: string }

/**
 * **정책 대상**(어느 티켓의 스냅샷을 읽을 것인가)을 정한다 — REQ-2026-159 phase-3.
 *
 * 🔴 **정책 대상과 위임 대상을 분리한다.**
 *  - **위임 권한** 판정은 지금까지처럼 **브랜치에서 확정한 scope** 만 쓴다(`scopeOfBranch`).
 *    원장을 뒤져 "이 브랜치를 가리키는 위임"을 고르게 하면 그 선택이 곧 권한 확대다.
 *  - **정책** 판정은 **결속된 범위의 커밋 귀속**에서도 티켓을 얻는다. 브랜치 이름은 사람이 언제든
 *    바꿀 수 있고, 그것이 `auto` 스냅샷을 약화시키는 통로가 되면 안 된다.
 *
 * 🔴 확정할 수 없으면 **`null`(= 판정 불가)** 이다. 귀속되지 않은 커밋이 하나라도 있으면 이 범위가
 *    무엇을 담고 있는지 모르는 것이므로 "없음"으로 읽지 않는다.
 */
export function policyTargetIds(
  attribution: { tickets: readonly string[]; deliveries?: readonly string[]; unattributableCommits: readonly unknown[] },
  scope: DelegationScope | null,
  deliveryMembersOf: (slug: string) => string[] | null,
): string[] | null {
  if (attribution.unattributableCommits.length > 0) return null
  const ids = new Set<string>(attribution.tickets)
  const slugs = new Set<string>(attribution.deliveries ?? [])
  // 🔴 브랜치에서 확정된 대상도 **합친다** — 귀속이 놓친 티켓을 잃지 않기 위해서다(더 좁게 읽지 않는다).
  if (scope !== null && scope.kind === 'ticket') ids.add(scope.req_id)
  if (scope !== null && scope.kind === 'delivery') slugs.add(scope.slug)
  for (const slug of slugs) {
    const members = deliveryMembersOf(slug)
    if (members === null) return null
    for (const m of members) ids.add(m)
  }
  return [...ids]
}

export function resolveIntegrationPolicy(facts: AutoFacts, cfgStopGate: StopGate): IntegrationPolicy {
  // 🔴 묶음의 **멤버 목록 자체**를 결속된 SHA 에서 읽지 못하면 어느 티켓들이 들어가는지 모른다.
  //    "모르니까 통과"로 읽으면 그것이 곧 구멍이다.
  if (facts.policyMembersUnknown)
    return {
      kind: 'indeterminate',
      lines: [
        '묶음(delivery) 레코드를 결속된 SHA 에서 읽지 못해 구성 티켓의 정책을 판정할 수 없습니다.',
        '  통합은 되돌리기 비싼 단계라 판정 불가에서 진행하지 않습니다(fail-closed).',
        '  해소: 묶음 레코드(`<ticketRoot>/delivery/<slug>.json`)가 통합 대상 SHA 의 트리에 있어야 합니다.',
        '    레코드를 커밋한 뒤 다시 실행하세요.',
        // 🔴 **안내는 실행 가능한 것만 적는다**(r01·r02 P1). 대화형 승인 경로는 아래 배선이 **실제로**
        //    제공한다 — 없는 탈출구를 적으면 안 되고, 있는 탈출구를 감춰서도 안 된다.
        '    대화형 세션이라면 아래 최종 확인에서 사람이 직접 승인할 수 있습니다(기본 No).',
      ],
    }

  const unreadable = facts.memberPolicies.filter((m) => m.stateUnreadable)
  if (unreadable.length > 0)
    return {
      kind: 'indeterminate',
      lines: [
        `티켓 state 를 결속된 SHA 에서 읽지 못했습니다: ${unreadable.map((m) => m.id).join(', ')}`,
        '  어느 정지 정책이 이 티켓을 지배하는지 판정할 수 없습니다 — 진행하지 않습니다(fail-closed).',
        '  🔴 같은 입력을 읽지 못하면 위험도는 이미 HIGH 로 되돌립니다. 정책만 "모르니까 통과"로',
        '     읽을 수는 없습니다.',
        '  해소: 해당 티켓의 `state.json` 이 통합 대상 SHA 의 트리에 있어야 합니다.',
        '    커밋되지 않았다면 커밋하고, 손상됐다면 고친 뒤 다시 실행하세요.',
        '    대화형 세션이라면 아래 최종 확인에서 사람이 직접 승인할 수 있습니다(기본 No).',
      ],
    }

  // 멤버별 유효 정책 = `effectiveStopGate` 와 같은 규칙(스냅샷 유효 → 그 값 · 그 외 → config).
  const autoMembers = facts.memberPolicies.filter((m) => (m.snapshotStopGate ?? cfgStopGate) === 'auto')
  if (autoMembers.length > 0)
    return {
      kind: 'resolved',
      delegationRequired: true,
      basis: autoMembers
        .map((m) => `${m.id}: ${m.snapshotStopGate === null ? `config auto(legacy 티켓)` : '스냅샷 auto'}`)
        .join(' · '),
    }

  /**
   * 🔴 **대상이 하나도 없으면 config 로 폴백하지 않는다**(REQ-2026-159 phase-3 P1).
   *
   *    예전에는 여기서 `cfgStopGate === 'auto'` 로 답했다 — "오늘 동작 그대로"라는 이유였는데,
   *    그 자리가 정확히 **우회 경로**였다: `branchPrefix` 만 만족하고 REQ 번호 형식이 아닌 브랜치
   *    (`feat/req-renamed`)는 대상이 비고, config 가 `merge` 면 위임 검사가 꺼진다.
   *    **브랜치 이름을 바꾸는 것이 `auto` 정책을 약화시키는 통로가 되면 안 된다.**
   */
  if (facts.memberPolicies.length === 0)
    return {
      kind: 'indeterminate',
      lines: [
        '이 통합이 어느 티켓의 정책을 따라야 하는지 확정할 수 없습니다.',
        '  브랜치 이름과 범위 귀속 어느 쪽에서도 대상 티켓·묶음이 나오지 않았습니다.',
        '  통합은 되돌리기 비싼 단계라 판정 불가에서 진행하지 않습니다(fail-closed).',
        `  해소: 브랜치 이름을 표준 형식(\`<branchPrefix><연도>-<번호>-...\` 또는 \`delivery/<slug>\`)으로 두거나,`,
        '    티켓 증거가 이 범위의 커밋에 남아 있어야 합니다.',
        '    대화형 세션이라면 아래 최종 확인에서 사람이 직접 승인할 수 있습니다(기본 No).',
      ],
    }

  return {
    kind: 'resolved',
    delegationRequired: false,
    basis: facts.memberPolicies
      .map((m) => `${m.id}: ${m.snapshotStopGate === null ? `config ${cfgStopGate}(legacy 티켓)` : `스냅샷 ${m.snapshotStopGate}`}`)
      .join(' · '),
  }
}

export async function runIntegrate(opts: Opts, deps: RunDeps, coordinator?: IntegrationCoordinator): Promise<RunResult> {
  const coord = coordinator ?? new IntegrationCoordinator(makeCoordinatorDeps(deps))
  const { facts, plan, prepared, base, head } = coord.collect()

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
    feature_head_sha: prepared?.featureHeadSha ?? null,
    trunk_head_sha: prepared?.trunkHeadSha ?? null,
    merge_parents: null,
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

  if (!plan.ok || prepared === null) {
    deps.log('commitgate integrate — 차단:')
    for (const p of plan.problems) deps.log(`  - ${p}`)
    if (plan.ok && prepared === null) deps.log('  - 통합 계획을 결속할 SHA를 확정하지 못했습니다(내부 상태 불일치) — 다시 실행하세요')
    safeAppend(row({ exit: 1 }))
    return { exit: 1, plan, merged: false }
  }

  /**
   * 🔴 REQ-2026-130 DEC-4: 병합 소스가 delivery 묶음이면 **그 묶음의 승인이 병합 인가**다.
   *    승인 이후 레코드 밖 커밋이 들어왔다면 승인한 것과 병합될 것이 다르므로 여기서 멈춘다 —
   *    `req:next`·`delivery status`가 같은 사실을 안내만 하는 것과 달리, 이 지점은 실제로 trunk를 바꾼다.
   *
   * 🔴 기본 `branchPrefix`에서는 delivery 브랜치가 전제에서 걸러지지만, `branchPrefix: "delivery/"`는
   *    **지원되는 설정**이고 그때는 여기까지 온다(설계 r04 P1). 소스 이름으로 판정한다.
   */
  const approvalBlock = deliveryApprovalBlock(prepared.featureBranch, deps.ticketRoot, (args) => deps.git.exec(args))
  if (approvalBlock !== null) {
    deps.log('commitgate integrate — 차단:')
    deps.log(`  - ${approvalBlock}`)
    safeAppend(row({ exit: 1 }))
    return { exit: 1, plan, merged: false }
  }

  /**
   * 🔴 사전 위임 게이트(REQ-2026-140). `auto` 가 아니면 `not-required` 라 아무것도 바뀌지 않는다.
   *    dry-run 에서도 판정한다 — 실행할 때 무엇이 막히는지 **미리** 보여야 한다.
   */
  const scopeForFacts = scopeOfBranch(prepared.featureBranch, deps.branchPrefix)
  /**
   * 🔴 **config 가 `auto` 가 아니어도 사실을 모은다**(REQ-2026-159). 예전에는 `deps.stopGate === 'auto'`
   *    일 때만 읽어서, `auto` 로 만든 티켓이 나중에 `merge` config 를 만나면 아무것도 읽지 않고
   *    통과했다. 읽기는 전부 read-only 다.
   */
  const ticketFacts: AutoFacts =
    scopeForFacts !== null
      ? collectAutoFacts(deps, prepared, scopeForFacts)
      : {
          riskLevel: null,
          budgetHardCapReached: false,
          reviewInconclusive: false,
          deliveryMembers: null,
          compositionChanged: false,
          memberPolicies: [],
          policyMembersUnknown: false,
        }
  /**
   * 🔴 **정책 대상은 브랜치 이름에 의존하지 않는다**(phase-3 P1). `branchPrefix` 만 만족하고 REQ 번호
   *    형식이 아닌 브랜치(`feat/req-renamed`)에서 `scopeOfBranch` 가 `null` 이면 예전에는 대상이 비어
   *    config 로 폴백했고, 그것이 `auto` 스냅샷을 약화시키는 우회로였다.
   *    이제 **결속된 범위의 커밋 귀속**에서도 대상을 찾는다(위임 권한 판정은 그대로 브랜치 scope 만).
   */
  const policyIds = ((): string[] | null => {
    const deepInput = collectDeepInput(deps.git, deps.readBlobs, prepared.trunkHeadSha, prepared.featureHeadSha, deps.ticketRoot)
    const report = verifyRangeDeep(deepInput)
    const att = attributeRange({
      commits: deepInput.commits,
      entries: report.entries,
      manifests: deepInput.manifests,
      ticketRoot: deps.ticketRoot,
    })
    return policyTargetIds(att, scopeForFacts, (slug) =>
      readDeliveryMembersAt(deps.readBlobs, deps.ticketRoot, slug, prepared.featureHeadSha),
    )
  })()
  const policyFacts: AutoFacts =
    policyIds === null
      ? { ...ticketFacts, policyMembersUnknown: true }
      : {
          ...ticketFacts,
          memberPolicies: policyIds.map((id) => {
            const f = readTicketFacts(deps.readBlobs, prepared.featureHeadSha, deps.ticketRoot, id, deps.reviewHardCap)
            return { id, snapshotStopGate: f.snapshotStopGate, stateUnreadable: f.stateUnreadable }
          }),
          policyMembersUnknown: ticketFacts.policyMembersUnknown,
        }
  const policy = resolveIntegrationPolicy(policyFacts, deps.stopGate)
  /**
   * 🔴 **판정 불가는 자동 진행을 막을 뿐, 사람 판단까지 막지는 않는다**(phase-1 r02 P1).
   *
   *  - **비대화형**: 승인할 주체가 없다 → fail-closed 로 거부한다. 여기서 통과시키면 `auto` 로
   *    시작한 티켓이 정책을 읽지 못한 채 병합되는 원래 결함이 그대로 남는다.
   *  - **대화형**: 아래 **최종 통합 확인**([y/N] 기본 No)으로 넘긴다 — 사람이 사유를 읽고 판단한다.
   *    안내가 "대화형이면 승인할 수 있다"고 적으므로 그 경로가 **실제로 존재해야** 한다.
   */
  if (policy.kind === 'indeterminate') {
    deps.log(deps.interactive ? 'commitgate integrate — 정책 판정 불가:' : 'commitgate integrate — 차단:')
    for (const l of policy.lines) deps.log(`  ${l}`)
    if (!deps.interactive) {
      safeAppend(row({ exit: 1 }))
      return { exit: 1, plan, merged: false }
    }
  }
  /**
   * 🔴 **판정 근거를 보고한다**(phase-1 r01 P1). 계산해 놓고 쓰지 않으면 사용자는 "왜 위임이
   *    필요한가"를 스스로 추론해야 하고, 다음 사람은 그 이유를 **다시 계산**한다.
   */
  if (policy.kind === 'resolved')
    deps.log(`정책: ${policy.basis} → 사전 위임 ${policy.delegationRequired ? '필요' : '불필요'}`)
  /**
   * 🔴 판정 불가 + 대화형이면 위임 게이트를 **평가하지 않는다** — 평가할 입력이 없기 때문이다.
   *    `not-required` 로 두면 아래 최종 확인이 반드시 돈다(`gate.kind !== 'allowed'` 조건).
   */
  const gate: DelegationGateResult =
    policy.kind === 'indeterminate'
      ? { kind: 'not-required' }
      : delegationGate(deps, prepared, ticketFacts, policy.delegationRequired)
  if (gate.kind === 'denied') {
    deps.log('commitgate integrate — 차단:')
    for (const l of gate.lines) deps.log(`  ${l}`)
    safeAppend(row({ exit: 1 }))
    return { exit: 1, plan, merged: false }
  }

  deps.log(`commitgate integrate — ${prepared.featureBranch} → ${prepared.trunkBranch}`)
  if (gate.kind === 'allowed') deps.log(`  사전 위임: ${gate.delegationId} (사람 확인 없이 진행합니다 — 소비는 1회)`)
  const c = prepared.verificationSummary.counts
  deps.log(`  증거: 승인 소비 ${c.approved} · 도구 부기 ${c.bookkeeping} · 머지 ${c.merge} · attested ${c.attested} · 미입증 ${c.unproven} (strict 통과)`)
  deps.log(`  결속: feature ${prepared.featureHeadSha.slice(0, 8)} · trunk ${prepared.trunkHeadSha.slice(0, 8)} (이 두 SHA가 그대로일 때만 병합합니다)`)
  deps.log('  실행 계획:')
  plan.steps.forEach((s, i) => deps.log(`    ${i + 1}. ${s}`))

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
  if (wantCi && deps.githubCi !== null) {
    deps.log(`GitHub CI 실행: ${deps.githubCi.workflow} @ ${prepared.featureBranch} (마감 ${deps.githubCi.timeoutMinutes}분)`)
    // 🔴 CI가 검사하는 대상은 **결속된 feature SHA**다 — 브랜치 tip이 아니다.
    ciResult = await awaitCiRun(deps.ciPort, {
      workflow: deps.githubCi.workflow,
      ref: prepared.featureBranch,
      expectedHeadSha: prepared.featureHeadSha,
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
    deps.log(`GitHub CI: run #${ciResult.runId} ${ciResult.conclusion} — 통과${ciResult.runHtmlUrl === null ? '' : ` (${ciResult.runHtmlUrl})`}`)
  } else {
    deps.log('GitHub CI: 실행 생략(정상 — 로컬 검증만으로 계속합니다)')
  }

  // 사람의 최종 통합 확인(설계 DEC-5). 대화형은 [y/N] 기본 No, 비대화형은 --run 자체가 확정 동작.
  // 🔴 유효한 사전 위임이 있으면 **이 자리를 묻지 않는다** — 그것이 위임의 목적이다(REQ-2026-140).
  if (deps.interactive && gate.kind !== 'allowed') {
    const ans = await deps.ask(finalMergePrompt(prepared.featureBranch, prepared.trunkBranch))
    if (!isYes(ans)) {
      deps.log('통합을 취소했습니다(병합하지 않았습니다).')
      safeAppend(row({ ci, ci_run_id: ciResult?.runId ?? null, ci_conclusion: ciResult?.conclusion ?? null, exit: 0 }))
      return { exit: 0, plan, merged: false }
    }
  }

  /**
   * 🔴 **CAS 선점**(설계 DEC-5). 위임을 먼저 소진하고 병합한다. 반대로 하면 병합과 기록 사이의
   *    중단에서 권한이 두 번 쓰일 수 있다 — 소진은 되돌릴 수 있고(사람이 다시 발급) 이중 사용은 아니다.
   *
   * 소비 커밋 `C` 는 `V`(검증된 SHA) 위에 얹히므로 병합 대상이 `V` 에서 `C` 로 바뀐다.
   * 두 SHA 를 하나로 만들려던 것이 설계 리뷰가 잡은 모순이었고, 답은 **그 차이를 계약으로 못 박는 것**이다.
   */
  let target = prepared
  let performed: DelegationPermissions = REQUESTED_LOCAL_ONLY
  if (gate.kind === 'allowed') {
    // 🔴 push·bypass 판정은 **CI 결정 이후**다 — 우회 여부가 CI 실행에 달려 있다.
    const push = planPushActions(gate.permissions)
    if (push.problem !== null) {
      deps.log(`🔴 ${push.problem}`)
      deps.log('   병합하지 않았습니다(위임은 소비되지 않았습니다).')
      safeAppend(row({ ci, ci_run_id: ciResult?.runId ?? null, ci_conclusion: ciResult?.conclusion ?? null, exit: 1 }))
      return { exit: 1, plan, merged: false }
    }
    performed = push.performed
    const verified = prepared.featureHeadSha
    deps.appendDelegationRow(
      {
        kind: 'consumed',
        id: gate.delegationId,
        at: deps.now(),
        verified_sha: verified,
        authorized: performed,
        outcome: 'merged',
        detail: `${prepared.featureBranch} → ${prepared.trunkBranch}`,
      },
      `delegate — ${gate.delegationId.slice(0, 8)} 소비(통합)`,
    )
    const re = coord.collect()
    const problem =
      re.prepared === null
        ? '소비 커밋 뒤 통합 계획을 다시 결속하지 못했습니다'
        : claimCommitProblem(deps.git, verified, re.prepared.featureHeadSha, prepared.trunkHeadSha, re.prepared.trunkHeadSha)
    if (problem !== null || re.prepared === null) {
      deps.log(`🔴 ${problem ?? '재결속 실패'} — 병합하지 않았습니다(위임은 소비됐습니다).`)
      safeAppend(row({ ci, ci_run_id: ciResult?.runId ?? null, ci_conclusion: ciResult?.conclusion ?? null, exit: 1 }))
      return { exit: 1, plan, merged: false }
    }
    target = re.prepared
    deps.log(`  소비 기록: ${verified.slice(0, 8)} → ${target.featureHeadSha.slice(0, 8)} (부기 1커밋만 얹혔습니다)`)
  }

  // 🔴 재검증 + CAS 병합 — CI 대기·사람 확인 사이에 상태가 바뀌었으면 여기서 멈춘다.
  const exec = coord.merge(target)
  deps.log(exec.merged ? `✅ ${exec.detail}` : `🔴 ${exec.detail}`)

  /**
   * 🔴 **push 는 위임이 허용했을 때만** 한다(기본 불허). 우회를 썼다면 **최종 보고에 남긴다** —
   *    보고에서 빠지면 우회가 조용해진다(요구 6).
   */
  let pushed = false
  if (exec.merged && performed.origin_push) {
    try {
      deps.git.exec(['push', PUSH_REMOTE, target.trunkBranch])
      pushed = true
      deps.log(`✅ push: ${PUSH_REMOTE}/${target.trunkBranch}`)
      if (performed.bypass_protection)
        deps.log(`⚠️ 이 push 는 원격 branch protection 의 required check 를 건너뛰었습니다(위임이 명시 허용). 원장에 기록합니다.`)
    } catch (err) {
      deps.log(`🔴 push 실패(병합은 로컬에 남아 있습니다): ${msg(err)}`)
      recordExecution(deps, gate, exec, { local_merge: exec.merged, origin_push: false, bypass_protection: false }, 'push 실패')
      safeAppend(
        row({
          ci,
          ci_run_id: ciResult?.runId ?? null,
          ci_conclusion: ciResult?.conclusion ?? null,
          merged: exec.merged,
          merge_sha: exec.mergeSha,
          merge_parents: exec.mergeParents,
          exit: 1,
        }),
      )
      return { exit: 1, plan, merged: exec.merged }
    }
  }
  /**
   * 🔴 **실제 수행을 영속 기록한다**(r02 P1). `authorized` 는 실행 **전에** 쓰인 인가라 "무엇을 했는가"를
   *    담을 수 없고, 콘솔·gitignored 로그는 감사에 남지 않는다. bypass 를 실제로 썼다면 여기 남는다.
   *
   * 🔴 **기록은 push 뒤에 만들어지므로 한 번 더 push 한다**(r05 P1). 그러지 않으면 로컬 trunk 만
   *    한 커밋 앞서고, **우회를 실제로 썼다는 사실이 원격 원장에는 없다** — 감사가 로컬에만 남는다.
   */
  if (gate.kind === 'allowed') {
    recordExecution(
      deps,
      gate,
      exec,
      { local_merge: exec.merged, origin_push: pushed, bypass_protection: pushed && performed.bypass_protection },
      exec.merged ? '통합 완료' : '병합 실패',
    )
    if (pushed) {
      try {
        deps.git.exec(['push', PUSH_REMOTE, target.trunkBranch])
      } catch (err) {
        deps.log(`🔴 수행 기록 push 실패 — 로컬 ${target.trunkBranch} 가 ${PUSH_REMOTE} 보다 앞서 있습니다: ${msg(err)}`)
        deps.log(`   \`git push ${PUSH_REMOTE} ${target.trunkBranch}\` 로 맞춰 주세요(병합·push 자체는 성공했습니다).`)
        safeAppend(
          row({
            ci,
            ci_run_id: ciResult?.runId ?? null,
            ci_conclusion: ciResult?.conclusion ?? null,
            merged: exec.merged,
            merge_sha: exec.mergeSha,
            merge_parents: exec.mergeParents,
            exit: 1,
          }),
        )
        return { exit: 1, plan, merged: exec.merged }
      }
    }
  }
  const exit: 0 | 1 = exec.merged ? 0 : 1
  safeAppend(
    row({
      ci,
      ci_run_id: ciResult?.runId ?? null,
      ci_conclusion: ciResult?.conclusion ?? null,
      merged: exec.merged,
      merge_sha: exec.mergeSha,
      merge_parents: exec.mergeParents,
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
     → 통과하면 feature/trunk 두 SHA를 **결속**한다(이후 절차는 이 SHA만 대상으로 한다)
  3. GitHub CI 실행 opt-in — 기본 실행하지 않음(아래 참조)
  4. 사람의 최종 확인([y/N] 기본 No — 비대화형은 --run 자체가 확정 동작)
  5. 재검증 + 병합 — 결속한 두 SHA가 그대로일 때만, 그 SHA를 정확히 merge --no-ff 하고
     trunk ref를 비교·교환(update-ref CAS)으로 갱신한다. push는 하지 않습니다
  6. (stopGate:"auto" + 위임이 origin_push 를 허용한 경우에만) origin push — 기본은 하지 않습니다
  7. 감사 로그 1행(workflow/.integrate-runs.jsonl — gitignored)

옵션:
  --run             실제 통합 실행(기본은 dry-run — 계획만 출력)
  --run-github-ci   GitHub CI workflow 실행을 명시 요청(req.config.json githubCi 설정 필수)
  --no-github-ci    CI 실행을 명시 생략
  --dir <path>      대상 repo 루트(기본: 현재 디렉터리)
  -h, --help        도움말

GitHub CI는 기본 실행하지 않습니다:
  실행은 --run-github-ci 명시 또는(githubCi 설정이 있을 때) 대화형 [y/N]의 y 뿐입니다.
  설정이 없으면 질문하지 않고 생략합니다(생략은 정상 상태). 선택은 실행 단위이며 저장되지 않습니다.
  실행 전 원격 브랜치 SHA가 결속한 feature SHA와 같아야 하며(자동 push 없음), dispatch 응답이 준
  run id로만 그 실행을 확인합니다(목록 추정 없음). success 이외의 결과·timeout·식별 불가면 병합하지 않습니다.

검증한 것만 병합합니다:
  CI 대기·사람 확인 중에 feature/trunk ref가 움직이거나 워킹트리가 더러워지면 병합하지 않고
  재실행을 안내합니다. 병합은 브랜치 이름이 아니라 결속한 SHA로 하며, 만들어진 merge commit의
  부모가 그 두 SHA인지 확인한 뒤에야 trunk ref를 갱신합니다.

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
      stopGate: cfg.stopGate,
      reviewHardCap: cfg.reviewBudget.hardCap,
      readDelegationLedger: () => {
        const abs = join(cfg.root, ...DELEGATION_LEDGER_REL.split('/'))
        return existsSync(abs) ? readFileSync(abs, 'utf8') : null
      },
      appendDelegationRow: (delegationRow, subject) => {
        const abs = join(cfg.root, ...DELEGATION_LEDGER_REL.split('/'))
        mkdirSync(dirname(abs), { recursive: true })
        appendFileSync(abs, `${JSON.stringify(delegationRow)}\n`, 'utf8')
        git.exec(['add', DELEGATION_LEDGER_REL])
        git.exec(['commit', '-m', bookkeepingMessage(subject)])
      },
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

export type { PreparedIntegration }
