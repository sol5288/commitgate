import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { delegationGate, runIntegrate, type AutoFacts } from '../../bin/integrate'
import { makeDeps, integrateOpts, fakeGit, fakeReadBlobs, BASE, HEAD, SRC, TREE, MERGE_SHA, TRUNK } from '../support/integrate-fakes'
import { BOOKKEEPING_TRAILER } from '../../scripts/req/lib/bookkeeping'
import { readBlobsAtRef } from '../../scripts/req/lib/git-batch'
import {
  serializeDelegationRow,
  type DelegationIssued,
  type DelegationRow,
} from '../../scripts/req/lib/delegation'
import type { GitAdapter } from '../../scripts/req/lib/adapters'
import type { PreparedIntegration } from '../../scripts/req/lib/integration-coordinator'

/**
 * REQ-2026-173 phase-2 — **`integrate` 가 인가된 trunk 이동을 실제로 받아들이는가**(실 git).
 *
 * 🔴 `trunk-advance.test.ts` 는 판정 함수만 본다. `delegationGate` 가 그것을 **계산해 넘기지 않으면**
 *    판정은 아무 데서도 돌지 않는 죽은 코드이고, 그 테스트들은 전부 green 이다 —
 *    이 저장소가 REQ-2026-172 에서 **두 phase 연속으로** 만든 "배선 끊김"이다.
 *
 * 🔴 그래서 오라클은 **동작 대비**다: 인가된 이동은 통과하고, 손으로 민 커밋이 끼면 거부된다.
 */

const TICKET = 'REQ-2026-001'
const FEATURE = 'feat/req-2026-001-x'

const OK_STATE = JSON.stringify({
  id: TICKET,
  risk_level: 'LOW',
  review_series: [{ series_id: 'phase:p1#1', attempts: 1, closed_reason: 'approved' }],
})

const FACTS_OK: AutoFacts = {
  riskLevel: 'LOW',
  budgetHardCapReached: false,
  reviewInconclusive: false,
  deliveryMembers: null,
  compositionChanged: false,
  memberPolicies: [],
  policyUnknown: null,
}

function g(dir: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
}

/** 티켓 경로 + 부기 trailer 커밋 하나(분류가 `bookkeeping` 이 되도록). */
function bookkeepingCommit(dir: string, name: string, subject: string): void {
  mkdirSync(join(dir, 'workflow', TICKET), { recursive: true })
  writeFileSync(join(dir, 'workflow', TICKET, name), `${name}\n`)
  g(dir, 'add', '.')
  g(dir, 'commit', '-q', '-m', `${subject}\n\nCommitGate-Bookkeeping: true`)
}

/**
 * 시나리오: T0 에서 위임을 발급한 뒤 **다른 REQ 를 먼저 통합**해 trunk 가 움직인 상태.
 * 이것이 소비자 실측에서 재발급을 강요하던 그 상황이다.
 */
function scenario(): { dir: string; issuedTrunk: string; mergeSha: string; state: string } {
  const dir = mkdtempSync(join(tmpdir(), 'cg-int-trunkadv-'))
  g(dir, 'init', '-q', '-b', 'main')
  g(dir, 'config', 'user.email', 't@example.com')
  g(dir, 'config', 'user.name', 'T')
  writeFileSync(join(dir, 'base.txt'), 'base\n')
  g(dir, 'add', '.')
  g(dir, 'commit', '-q', '-m', 'base')
  const issuedTrunk = g(dir, 'rev-parse', 'HEAD').trim()

  // 이 위임의 소스 브랜치(아직 병합하지 않는다).
  g(dir, 'checkout', '-q', '-b', FEATURE)
  bookkeepingCommit(dir, 'mine.txt', 'chore: my work')
  g(dir, 'checkout', '-q', 'main')

  // 앞선 다른 REQ 가 먼저 통합됐다 — 인가된 병합 + 수행 기록 부기.
  g(dir, 'checkout', '-q', '-b', 'feat/req-2026-002-y')
  bookkeepingCommit(dir, 'other.txt', 'chore: other work')
  g(dir, 'checkout', '-q', 'main')
  g(dir, 'merge', '-q', '--no-ff', '-m', 'merge other', 'feat/req-2026-002-y')
  const mergeSha = g(dir, 'rev-parse', 'HEAD').trim()
  bookkeepingCommit(dir, 'exec.txt', 'chore: 수행 기록')

  return { dir, issuedTrunk, mergeSha, state: OK_STATE }
}

const issuedRow = (over: Partial<DelegationIssued>): DelegationIssued => ({
  kind: 'issued',
  id: 'D-MINE',
  at: '2026-08-22T00:00:00.000Z',
  scope: { kind: 'ticket', req_id: TICKET },
  trunk_branch: 'main',
  trunk_sha: 'x'.repeat(40),
  source_branch: FEATURE,
  base_sha: 'y'.repeat(40),
  expires_at: '2126-01-01T00:00:00.000Z',
  permissions: { local_merge: true, origin_push: false, bypass_protection: false },
  high_risk_ack: false,
  attested_ack: false,
  approval_sentence: '통합을 사전 위임합니다',
  ...over,
})

/** 앞선 통합의 인가 기록(발급 + 수행) — 이 원장이 그 병합을 인가했다는 물증. */
const priorIntegration = (mergeSha: string): DelegationRow[] => [
  issuedRow({ id: 'D-OTHER', scope: { kind: 'ticket', req_id: 'REQ-2026-002' }, source_branch: 'feat/req-2026-002-y' }),
  {
    kind: 'executed',
    id: 'D-OTHER',
    at: '2026-08-22T00:00:00.000Z',
    merge_sha: mergeSha,
    performed: { local_merge: true, origin_push: false, bypass_protection: false },
    detail: '',
  },
]

function gateFor(dir: string, ledger: DelegationRow[], featureHeadSha: string, trunkHeadSha: string) {
  const git: GitAdapter = { exec: (args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }) }
  const deps = {
    readDelegationLedger: () => ledger.map(serializeDelegationRow).join(''),
    now: () => '2026-08-22T06:00:00.000Z',
    branchPrefix: 'feat/req-',
    ticketRoot: 'workflow',
    git,
    readBlobs: (ref: string, paths: readonly string[]) => readBlobsAtRef(dir, ref, paths),
  }
  const prepared = {
    featureBranch: FEATURE,
    trunkBranch: 'main',
    featureHeadSha,
    trunkHeadSha,
    verificationSummary: { counts: {} },
  } as unknown as PreparedIntegration
  return delegationGate(deps as unknown as Parameters<typeof delegationGate>[0], prepared, FACTS_OK, true)
}

describe('[REQ-2026-173] integrate — 인가된 trunk 이동(실 git 배선)', () => {
  /** 🔴 **이 REQ 의 목적**: 앞 REQ 를 먼저 통합해도 내 위임을 다시 발급하지 않는다. */
  it('🔴 인가된 병합으로만 움직였으면 통과하고, 그 사실을 결과에 담는다', () => {
    const { dir, issuedTrunk, mergeSha } = scenario()
    const trunkHead = g(dir, 'rev-parse', 'HEAD').trim()
    const featureHead = g(dir, 'rev-parse', FEATURE).trim()
    const ledger = [issuedRow({ trunk_sha: issuedTrunk }), ...priorIntegration(mergeSha)]

    const gate = gateFor(dir, ledger, featureHead, trunkHead)
    expect(gate.kind, JSON.stringify(gate)).toBe('allowed')
    if (gate.kind !== 'allowed') return
    // 🔴 감춰진 완화 금지 — 무엇이 인가했는지 결과가 들고 있어야 한다(DEC-4).
    expect(gate.trunkAdvance, 'trunk 이동 사실이 결과에 없다').toBeDefined()
    expect(gate.trunkAdvance?.mergeShas).toEqual([mergeSha])
  })

  /** 🔴 **이 REQ 의 안전**: 인가되지 않은 것이 끼면 종전대로 막힌다. */
  it('🔴 trunk 에 손으로 민 커밋이 있으면 거부한다', () => {
    const { dir, issuedTrunk, mergeSha } = scenario()
    writeFileSync(join(dir, 'hand.txt'), 'x\n')
    g(dir, 'add', '.')
    g(dir, 'commit', '-q', '-m', 'hand-pushed')
    const trunkHead = g(dir, 'rev-parse', 'HEAD').trim()
    const featureHead = g(dir, 'rev-parse', FEATURE).trim()
    const ledger = [issuedRow({ trunk_sha: issuedTrunk }), ...priorIntegration(mergeSha)]

    const gate = gateFor(dir, ledger, featureHead, trunkHead)
    expect(gate.kind).toBe('denied')
  })

  /** 🔴 앞선 병합이 **원장에 없으면**(인가 기록 없음) 종전대로 거부다. */
  it('🔴 인가 기록이 없는 병합으로 움직였으면 거부한다', () => {
    const { dir, issuedTrunk } = scenario()
    const trunkHead = g(dir, 'rev-parse', 'HEAD').trim()
    const featureHead = g(dir, 'rev-parse', FEATURE).trim()
    const ledger = [issuedRow({ trunk_sha: issuedTrunk })] // 앞선 통합 기록 없음

    const gate = gateFor(dir, ledger, featureHead, trunkHead)
    expect(gate.kind).toBe('denied')
    if (gate.kind !== 'denied') return
    expect(gate.lines.join('\n')).toContain('trunk-moved')
  })

  it('trunk 가 그대로면 이 축을 계산하지 않는다(결과에 trunkAdvance 없음)', () => {
    const { dir, mergeSha } = scenario()
    const trunkHead = g(dir, 'rev-parse', 'HEAD').trim()
    const featureHead = g(dir, 'rev-parse', FEATURE).trim()
    const ledger = [issuedRow({ trunk_sha: trunkHead }), ...priorIntegration(mergeSha)]

    const gate = gateFor(dir, ledger, featureHead, trunkHead)
    expect(gate.kind, JSON.stringify(gate)).toBe('allowed')
    if (gate.kind !== 'allowed') return
    expect(gate.trunkAdvance).toBeUndefined()
  })
})

/**
 * REQ-2026-173 phase-2 r01 P1 — **DEC-4 정직한 기록**이 정상 경로에서 실제로 남는가.
 *
 * 🔴 위 테스트들은 `delegationGate()` 에서 멈추므로 로그·원장 append 를 보지 않는다 —
 *    그 표식을 지워도 전부 green 이다(리뷰가 지적한 그대로다).
 *    그래서 `runIntegrate()` 를 태워 **출력 한 줄**과 **consumed.detail** 을 함께 단정한다.
 *
 * 🔴 감춰진 완화는 완화가 아니라 구멍이다: 나중에 이력을 읽는 사람이
 *    "발급 시점 trunk 그대로였다"고 오해하면 안 된다.
 */
describe('[REQ-2026-173] runIntegrate — 인가된 trunk 이동의 정직한 기록(DEC-4)', () => {
  const TICKET_999 = 'REQ-2026-999'
  const OTHER_TRUNK_SHA = '7'.repeat(40)

  /** 범위: 인가된 머지(MERGE_SHA, 부모 2개) + 부기 커밋 하나. */
  const logOut = [
    `${MERGE_SHA}\x1f${TREE}\x1f${BASE} ${SRC}\x1fmerge other\x00\n`,
    `${HEAD}\x1f${TREE}\x1f${MERGE_SHA}\x1fchore(REQ-x): 수행 기록\n\n${BOOKKEEPING_TRAILER}\x00\n`,
  ].join('')
  // 🔴 부기 커밋의 경로가 **위임 대상 티켓**을 가리켜야 범위 귀속이 그 티켓 하나가 된다.
  const nameOnlyOut = `\x01${HEAD}\nworkflow/REQ-2026-999/responses/review-ledger.jsonl\n`

  const ledgerRows = (): DelegationRow[] => [
    // 내 위임 — 발급 시점 trunk 는 지금과 다르다.
    issuedRow({ id: 'D-MINE', trunk_sha: OTHER_TRUNK_SHA, source_branch: 'feat/req-2026-999-x', scope: { kind: 'ticket', req_id: TICKET_999 } }),
    // 앞선 통합의 인가 기록.
    issuedRow({ id: 'D-PRIOR', trunk_sha: OTHER_TRUNK_SHA, source_branch: 'feat/req-2026-002-y', scope: { kind: 'ticket', req_id: 'REQ-2026-002' } }),
    {
      kind: 'executed',
      id: 'D-PRIOR',
      at: '2026-08-22T00:00:00.000Z',
      merge_sha: MERGE_SHA,
      performed: { local_merge: true, origin_push: false, bypass_protection: false },
      detail: '',
    },
  ]

  it('🔴 통과하면 로그와 consumed.detail 에 그 사실이 남는다', async () => {
    const appended: { row: DelegationRow; subject: string }[] = []
    const deps = makeDeps({
      git: fakeGit({ logOut, nameOnlyOut }),
      readBlobs: fakeReadBlobs({
        'workflow/REQ-2026-999/state.json': JSON.stringify({ req_id: TICKET_999, risk_level: 'LOW', review_series: [] }),
        'workflow/REQ-2026-001/state.json': JSON.stringify({ req_id: 'REQ-2026-001', risk_level: 'LOW', review_series: [] }),
      }),
      stopGate: 'auto',
      readDelegationLedger: () => ledgerRows().map((r) => JSON.stringify(r)).join('\n') + '\n',
      appendDelegationRow: (row, subject) => appended.push({ row, subject }),
    })

    await runIntegrate(integrateOpts({ run: true }), deps)

    /**
     * 🔴 **여기서 보는 것은 두 표식이다**(DEC-4). 이 fake 하네스의 `appendDelegationRow` 는 실제로
     *    커밋하지 않으므로 CAS 소비 커밋이 없어 병합 자체는 완료되지 않는다 — 병합 경로는
     *    `integrate-verb.test.ts` 가 이미 덮는다. 이 테스트의 주장은 *"trunk 이동이 인가돼 진행했고,
     *    그 사실이 출력과 원장에 남는다"* 이고, 두 표식은 소비 기록 **전에** 만들어진다.
     */
    // ① 출력 표식
    expect(
      deps.logs.some((l) => l.includes('인가된 병합')),
      `trunk 이동 표식이 출력에 없다:\n${deps.logs.join('\n')}`,
    ).toBe(true)
    // ② 원장 표식 — consumed 행의 detail
    const consumed = appended.find((a) => a.row.kind === 'consumed')
    expect(consumed, '소비 행이 없다').toBeDefined()
    expect((consumed?.row as { detail?: string }).detail).toContain('trunk 이동을 인가된 병합')
  })
})
