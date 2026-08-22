/**
 * `commitgate integrate` 오케스트레이션 테스트용 fake 배선 — **한 벌만 둔다**.
 *
 * 🔴 `tests/unit/integrate-verb.test.ts`(동작)와 `tests/unit/ci-workflow-policy.test.ts`(CI 정책)가
 *    같은 fake를 쓴다. 두 벌로 두면 포트 계약이 바뀔 때 한쪽만 갱신돼 조용히 거짓이 된다 —
 *    이 저장소가 자산 skew로 여러 번 데인 지점이다.
 * 🔴 이 파일은 `*.test.ts`가 아니므로 vitest가 수집하지 않는다(`include: tests/**\/*.test.ts`).
 * 🔴 실제 gh·네트워크·원격을 쓰지 않는다. git도 fake다 — 실 git CAS 증명은
 *    `tests/unit/integration-coordinator.test.ts`가 소유한다.
 */
import { createHash } from 'node:crypto'
import { createFakeCiRunPort, type RunInfo } from '../../scripts/req/lib/github-ci-run'
import { BOOKKEEPING_TRAILER } from '../../scripts/req/lib/bookkeeping'
import { DELEGATION_LEDGER_REL } from '../../scripts/req/lib/delegation'
import type { GitAdapter } from '../../scripts/req/lib/adapters'
import type { Opts, RunDeps, IntegrateRunRow } from '../../bin/integrate'

export const BASE = '1'.repeat(40)
export const HEAD = '2'.repeat(40)
export const SRC = '3'.repeat(40)
export const TREE = '6'.repeat(40)
export const MERGE_SHA = '9'.repeat(40)
export const FEATURE = 'feat/req-2026-999-x'
export const TRUNK = 'main'

export const MANIFEST_PATH = 'workflow/REQ-2026-001/responses/approvals.jsonl'
export const ARCHIVE_PATH = 'workflow/REQ-2026-001/responses/phase-1-r01-approved.json'
const ARCHIVE_CONTENT = '{"ok":1}'
const ARCHIVE_SHA256 = createHash('sha256').update(ARCHIVE_CONTENT).digest('hex')
const VALID_ROW = JSON.stringify({
  kind: 'phase',
  phase_id: 'phase-1',
  response_path: ARCHIVE_PATH,
  response_sha256: ARCHIVE_SHA256,
  review_base_sha: BASE,
  approved_tree: TREE,
  approved_at: '2026-08-10T00:00:00.000Z',
  consumed_at: '2026-08-10T00:00:01.000Z',
  consumed_by_commit_sha: SRC,
  user_commit_confirmed: null,
})

/**
 * 브랜치 `feat/req-2026-999-x` 가 가리키는 티켓의 `state.json`(REQ-2026-159).
 *
 * 🔴 **기본 fake 에 넣는다.** 실제 트리에는 `req:new` 시점부터 이 파일이 커밋돼 있고, 통합은 끝난
 *    티켓에서 돈다 — 없는 쪽이 비현실적이다. 없던 시절의 fake 로는 "정책 스냅샷을 읽는다"는
 *    새 경로가 **읽지 못함**으로만 관측돼, 무엇을 검사하는지 알 수 없게 된다.
 * 🔴 스냅샷은 **일부러 넣지 않는다** — legacy 티켓(= config 를 따름)이 기존 테스트들의 전제다.
 */
export const DEFAULT_TICKET_STATE_PATH = 'workflow/REQ-2026-999/state.json'
const DEFAULT_TICKET_STATE = JSON.stringify({ req_id: 'REQ-2026-999', risk_level: 'LOW', review_series: [] })
/**
 * 🔴 범위 귀속이 가리키는 티켓의 state 도 둔다(REQ-2026-159 phase-3). 기본 fake 의 매니페스트와
 *    부기 커밋 경로가 `REQ-2026-001` 을 가리키므로, 정책 대상은 브랜치의 `REQ-2026-999` 와
 *    **둘 다**다. 실제 트리에는 둘 다 있으므로 없는 fake 가 비현실적이다.
 */
const ATTRIBUTED_TICKET_STATE_PATH = 'workflow/REQ-2026-001/state.json'
const ATTRIBUTED_TICKET_STATE = JSON.stringify({ req_id: 'REQ-2026-001', risk_level: 'LOW', review_series: [] })

/** 정책 스냅샷이 박힌 티켓 state 를 만든다(REQ-2026-159 테스트용). */
export function ticketStateJson(stopGate: string | null, over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    req_id: 'REQ-2026-999',
    risk_level: 'LOW',
    review_series: [],
    ...(stopGate === null ? {} : { policy_snapshot: { stop_gate: stopGate } }),
    ...over,
  })
}

export function fakeReadBlobs(extra?: Record<string, string>): (ref: string, paths: readonly string[]) => Map<string, Buffer | null> {
  const known: Record<string, string> = {
    [MANIFEST_PATH]: `${VALID_ROW}\n`,
    [ARCHIVE_PATH]: ARCHIVE_CONTENT,
    [DEFAULT_TICKET_STATE_PATH]: DEFAULT_TICKET_STATE,
    [ATTRIBUTED_TICKET_STATE_PATH]: ATTRIBUTED_TICKET_STATE,
    ...extra,
  }
  return (_ref, paths) => new Map(paths.map((p) => [p, p in known ? Buffer.from(known[p] as string, 'utf8') : null]))
}

export interface FakeGitOpts {
  branch?: string
  porcelain?: string
  logOut?: string
  nameOnlyOut?: string
  trunkMissing?: boolean
  checkIgnoreOk?: boolean
  /** 재검증에서 돌려줄 ref 값(표류 시뮬레이션). */
  refs?: Record<string, string>
  /**
   * `git push` 응답(REQ-2026-140 phase-6). 배열이면 **호출 순서대로** 소비한다 —
   * 1차는 병합 push, 2차는 수행 기록 push 다. `Error` 면 그 호출이 실패한다.
   */
  pushResults?: (null | Error)[]
}

/**
 * fake git. 0.22.0 RC 보완의 실행 경로(detach → merge → rev-list --parents → update-ref → checkout)를
 * 그대로 응답한다. `refs/heads/<trunk>`와 `refs/heads/<feature>`를 **각각 다른 값**으로 답하는 것이
 * 요점이다 — 두 ref를 구별하지 않는 fake는 결속 회귀를 잡을 수 없다.
 */
export function fakeGit(over?: FakeGitOpts): GitAdapter & { calls: string[][] } {
  const calls: string[][] = []
  const branch = over?.branch ?? FEATURE
  const refs: Record<string, string> = { [`refs/heads/${TRUNK}`]: BASE, [`refs/heads/${branch}`]: HEAD, ...over?.refs }
  const pushQueue: (null | Error)[] = [...(over?.pushResults ?? [])]
  const logOut =
    over?.logOut ??
    [
      `${SRC}\x1f${TREE}\x1f${BASE}\x1ffeat: approved work\x00\n`,
      `${HEAD}\x1f${TREE}\x1f${SRC}\x1fchore(REQ-x): ledger\n\n${BOOKKEEPING_TRAILER}\x00\n`,
    ].join('')
  const nameOnlyOut =
    over?.nameOnlyOut ??
    [`\x01${SRC}\nsrc/app.ts\n`, `\x01${HEAD}\nworkflow/REQ-2026-001/responses/review-ledger.jsonl\n`].join('')
  return {
    calls,
    exec(args: string[]): string {
      calls.push(args)
      const cmd = args[0]
      if (cmd === 'rev-parse') {
        if (args[1] === '--abbrev-ref') return `${branch}\n`
        const ref = args[2] ?? ''
        if (ref.startsWith('refs/heads/')) {
          if (over?.trunkMissing && ref === `refs/heads/${TRUNK}`) throw new Error('unknown ref')
          const v = refs[ref]
          if (v === undefined) throw new Error(`unknown ref ${ref}`)
          return `${v}\n`
        }
        return `${HEAD}\n`
      }
      if (cmd === 'status') return `${over?.porcelain ?? ''}\n`
      if (cmd === 'merge-base') return `${BASE}\n`
      if (cmd === 'log') return args.includes('--name-only') ? nameOnlyOut : logOut
      if (cmd === 'diff-tree') return ''
      if (cmd === 'ls-tree') return `${MANIFEST_PATH}\n${ARCHIVE_PATH}\n`
      if (cmd === 'check-ignore') {
        if (over?.checkIgnoreOk === false) throw new Error('not ignored')
        return ''
      }
      if (cmd === 'rev-list') return `${MERGE_SHA} ${BASE} ${HEAD}\n` // --parents -n 1 HEAD
      if (cmd === 'push') {
        const next = pushQueue.shift()
        if (next instanceof Error) throw next
        return ''
      }
      // 소비 커밋 불변식 검사(`claimCommitProblem`)가 보는 경로 목록 — 원장만 바꿨다고 답한다.
      if (cmd === 'show') return `${DELEGATION_LEDGER_REL}\n`
      if (cmd === 'checkout' || cmd === 'merge' || cmd === 'update-ref') return ''
      throw new Error(`fakeGit: 예상 밖 호출 ${args.join(' ')}`)
    },
  }
}

export const runInfo = (over: Partial<RunInfo> = {}): RunInfo => ({
  id: 1,
  status: 'completed',
  conclusion: 'success',
  created_at: '2026-08-10T00:00:01.000Z',
  head_sha: HEAD,
  head_branch: FEATURE,
  event: 'workflow_dispatch',
  // 🔴 공식 응답과 같은 `path@ref` 형태로 둔다 — 정상 경로 테스트가 이 계약을 **항상** 지나게 한다.
  path: `.github/workflows/ci.yml@refs/heads/${FEATURE}`,
  ...over,
})

export type FakeDeps = RunDeps & {
  git: ReturnType<typeof fakeGit>
  logs: string[]
  rows: IntegrateRunRow[]
  asked: string[]
}

export function makeDeps(over?: Partial<RunDeps> & { git?: ReturnType<typeof fakeGit> }): FakeDeps {
  const logs: string[] = []
  const rows: IntegrateRunRow[] = []
  const asked: string[] = []
  const git = over?.git ?? fakeGit()
  let t = Date.parse('2026-08-10T00:00:00.000Z')
  return {
    git,
    ciPort: over?.ciPort ?? createFakeCiRunPort({ remoteSha: HEAD, runStates: [runInfo()] }),
    ask: over?.ask ?? (async (q) => (asked.push(q), '')),
    interactive: over?.interactive ?? false,
    appendLog: over?.appendLog ?? ((row) => rows.push(row)),
    log: (l) => logs.push(l),
    now: () => new Date(t).toISOString(),
    nowMs: () => t,
    sleep: async (ms) => {
      t += ms
    },
    trunkBranch: over?.trunkBranch === undefined ? TRUNK : over.trunkBranch,
    branchPrefix: 'feat/req-',
    ticketRoot: 'workflow',
    githubCi: over?.githubCi === undefined ? null : over.githubCi,
    gitStateExists: over?.gitStateExists ?? (() => false),
    readBlobs: over?.readBlobs ?? fakeReadBlobs(),
    // 🔴 REQ-2026-176: 이 fake 의 `ls-tree` 는 `--name-only` 형식(OID 없음)이므로 OID 경로는
    //    **쓰이면 안 된다**. 던지게 둬서 그 사실 자체를 오라클로 삼는다.
    readBlobsByOid: over?.readBlobsByOid ?? ((): never => {
      throw new Error('fake: OID 경로가 예상치 않게 쓰였다(ls-tree 가 OID 를 주지 않는다)')
    }),
    /**
     * 🔴 기본값은 **현행 동작**이다(REQ-2026-140). `auto` 가 아니면 사전 위임 축이 아무것도 하지 않으므로,
     *    기존 integrate 테스트가 그대로 유효하다 — 무회귀가 이 기본값에 걸려 있다.
     */
    stopGate: over?.stopGate ?? 'merge',
    reviewHardCap: over?.reviewHardCap ?? 8,
    readDelegationLedger: over?.readDelegationLedger ?? (() => null),
    appendDelegationRow: over?.appendDelegationRow ?? (() => {}),
    logs,
    rows,
    asked,
  }
}

export const integrateOpts = (over?: Partial<Opts>): Opts => ({ dir: '.', run: false, runGithubCi: null, ...over })
