import { describe, it, expect } from 'vitest'
import {
  claimCommitProblem,
  delegationGate,
  readTicketFacts,
  runIntegrate,
  type RunDeps,
} from '../../bin/integrate'
import { makeDeps, integrateOpts, fakeGit, fakeReadBlobs, BASE, HEAD, SRC, TRUNK } from '../support/integrate-fakes'
import { DELEGATION_LEDGER_REL, type DelegationIssued, type DelegationRow } from '../../scripts/req/lib/delegation'
import type { GitAdapter } from '../../scripts/req/lib/adapters'
import type { PreparedIntegration } from '../../scripts/req/lib/integration-coordinator'

/**
 * REQ-2026-140 phase-4b-1 — `integrate` 의 사전 위임 게이트.
 *
 * 🔴 **이 배선의 존재 이유**: `integrate --run` 은 비대화형 세션에서 **오늘도 질문 없이 병합한다**
 *    (`deps.interactive` 분기). 지금까지 그것을 막은 것은 `AGENTS.md` 계약이지 도구가 아니었다.
 *    `auto` 는 그 자리에 **처음으로 도구 게이트**를 건다 — 푸는 게 아니라 잠근다.
 *
 * 🔴 **무회귀가 첫 번째 오라클이다**: `auto` 가 아니면 이 축은 아무것도 하지 않아야 한다.
 */

const TICKET = 'REQ-2026-001'
const FEATURE_001 = 'feat/req-2026-001-x'

const ISSUED = (over: Partial<DelegationIssued> = {}): DelegationIssued => ({
  kind: 'issued',
  id: 'D1',
  at: '2026-08-09T00:00:00.000Z',
  scope: { kind: 'ticket', req_id: TICKET },
  trunk_branch: TRUNK,
  trunk_sha: BASE,
  source_branch: FEATURE_001,
  base_sha: HEAD,
  expires_at: '2026-08-11T00:00:00.000Z',
  permissions: { local_merge: true, origin_push: false, bypass_protection: false },
  high_risk_ack: false,
  approval_sentence: '통합을 사전 위임합니다',
  ...over,
})

const ledgerOf = (...rows: DelegationRow[]): string => rows.map((r) => JSON.stringify(r)).join('\n') + '\n'

/** LOW 위험 · 열린 리뷰 없음 — 정상 통과 상태의 티켓 state. */
const OK_STATE = JSON.stringify({
  id: TICKET,
  risk_level: 'LOW',
  review_series: [{ series_id: 'phase:p1#1', attempts: 1, closed_reason: 'approved' }],
})

const prepared = (over: Partial<PreparedIntegration> = {}): PreparedIntegration =>
  ({
    featureBranch: FEATURE_001,
    trunkBranch: TRUNK,
    featureHeadSha: HEAD,
    trunkHeadSha: BASE,
    verificationSummary: { counts: {} },
    ...over,
  }) as PreparedIntegration

function gateDeps(over: Omit<Partial<RunDeps>, 'git'> = {}): Parameters<typeof delegationGate>[0] {
  const d = makeDeps({
    git: fakeGit({ branch: FEATURE_001 }),
    readBlobs: fakeReadBlobs({ [`workflow/${TICKET}/state.json`]: OK_STATE }),
    now: () => '2026-08-10T00:00:00.000Z',
    ...over,
  })
  return d
}

const FACTS_OK = { riskLevel: 'LOW', budgetHardCapReached: false, reviewInconclusive: false }

describe('[REQ-2026-140] delegationGate — auto 가 아니면 아무것도 하지 않는다', () => {
  it('🔴 phase·req·merge 는 not-required 다(무회귀)', () => {
    for (const sg of ['phase', 'req', 'merge'] as const) {
      const g = delegationGate(gateDeps({ stopGate: sg, readDelegationLedger: () => null }), prepared(), FACTS_OK)
      expect(g.kind, sg).toBe('not-required')
    }
  })
})

describe('[REQ-2026-140] delegationGate — auto', () => {
  it('🔴 위임이 없으면 거부하고 발급 방법을 알려준다', () => {
    const g = delegationGate(gateDeps({ stopGate: 'auto', readDelegationLedger: () => null }), prepared(), FACTS_OK)
    expect(g.kind).toBe('denied')
    if (g.kind === 'denied') {
      expect(g.lines.join('\n')).toContain('absent')
      expect(g.lines.join('\n')).toContain('req:delegate')
    }
  })

  it('유효한 위임이면 허용하고 id 를 돌려준다', () => {
    const g = delegationGate(
      gateDeps({ stopGate: 'auto', readDelegationLedger: () => ledgerOf(ISSUED()) }),
      prepared(),
      FACTS_OK,
    )
    expect(g.kind).toBe('allowed')
    if (g.kind === 'allowed') expect(g.delegationId).toBe('D1')
  })

  it('🔴 trunk 가 움직였으면 거부한다', () => {
    const g = delegationGate(
      gateDeps({ stopGate: 'auto', readDelegationLedger: () => ledgerOf(ISSUED({ trunk_sha: 'f'.repeat(40) })) }),
      prepared(),
      FACTS_OK,
    )
    expect(g.kind).toBe('denied')
    if (g.kind === 'denied') expect(g.lines.join('\n')).toContain('trunk-moved')
  })

  it('🔴 다른 브랜치의 위임은 쓰이지 않는다', () => {
    const g = delegationGate(
      gateDeps({ stopGate: 'auto', readDelegationLedger: () => ledgerOf(ISSUED({ source_branch: 'feat/req-2026-002-y' })) }),
      prepared(),
      FACTS_OK,
    )
    expect(g.kind).toBe('denied')
    if (g.kind === 'denied') expect(g.lines.join('\n')).toContain('source-mismatch')
  })

  it('🔴 소비된 위임은 다시 쓰이지 않는다', () => {
    const consumed: DelegationRow = {
      kind: 'consumed',
      id: 'D1',
      at: '2026-08-09T12:00:00.000Z',
      verified_sha: HEAD,
      performed: { local_merge: true, origin_push: false, bypass_protection: false },
      outcome: 'merged',
      detail: '',
    }
    const g = delegationGate(
      gateDeps({ stopGate: 'auto', readDelegationLedger: () => ledgerOf(ISSUED(), consumed) }),
      prepared(),
      FACTS_OK,
    )
    expect(g.kind).toBe('denied')
    if (g.kind === 'denied') expect(g.lines.join('\n')).toContain('consumed')
  })

  it('🔴 HIGH·hardCap·BLOCKED 는 위임이 있어도 막는다', () => {
    const deps = gateDeps({ stopGate: 'auto', readDelegationLedger: () => ledgerOf(ISSUED()) })
    const cases = [
      [{ ...FACTS_OK, riskLevel: 'HIGH' }, 'high-risk-unacked'],
      [{ ...FACTS_OK, budgetHardCapReached: true }, 'budget-hardcap'],
      [{ ...FACTS_OK, reviewInconclusive: true }, 'review-inconclusive'],
    ] as const
    for (const [facts, reason] of cases) {
      const g = delegationGate(deps, prepared(), facts)
      expect(g.kind, reason).toBe('denied')
      if (g.kind === 'denied') expect(g.lines.join('\n')).toContain(reason)
    }
  })

  it('HIGH 는 --high-risk 위임이면 통과한다', () => {
    const g = delegationGate(
      gateDeps({ stopGate: 'auto', readDelegationLedger: () => ledgerOf(ISSUED({ high_risk_ack: true })) }),
      prepared(),
      { ...FACTS_OK, riskLevel: 'HIGH' },
    )
    expect(g.kind).toBe('allowed')
  })

  it('🔴 브랜치에서 대상을 판정할 수 없으면 거부한다', () => {
    const g = delegationGate(
      gateDeps({ stopGate: 'auto', readDelegationLedger: () => ledgerOf(ISSUED()) }),
      prepared({ featureBranch: 'hotfix/thing' }),
      FACTS_OK,
    )
    expect(g.kind).toBe('denied')
    if (g.kind === 'denied') expect(g.lines.join('\n')).toContain('판정할 수 없')
  })

  /** delivery 배선은 4b-2 다 — 반쪽 판정으로 통합하느니 멈춘다. */
  it('🔴 delivery 묶음은 아직 거부한다(반쪽 판정 금지)', () => {
    const g = delegationGate(
      gateDeps({ stopGate: 'auto', readDelegationLedger: () => ledgerOf(ISSUED()) }),
      prepared({ featureBranch: 'delivery/0.23.0' }),
      FACTS_OK,
    )
    expect(g.kind).toBe('denied')
  })
})

describe('[REQ-2026-140] readTicketFacts — 못 읽으면 fail-closed', () => {
  it('state.json 이 없으면 HIGH·미결로 본다', () => {
    const f = readTicketFacts(fakeReadBlobs(), HEAD, 'workflow', TICKET, 8)
    expect(f).toEqual({ riskLevel: 'HIGH', budgetHardCapReached: false, reviewInconclusive: true })
  })

  it('손상 JSON 도 같은 취급이다', () => {
    const f = readTicketFacts(fakeReadBlobs({ [`workflow/${TICKET}/state.json`]: '{oops' }), HEAD, 'workflow', TICKET, 8)
    expect(f.riskLevel).toBe('HIGH')
    expect(f.reviewInconclusive).toBe(true)
  })

  it('정상 state 는 그대로 읽는다', () => {
    const f = readTicketFacts(fakeReadBlobs({ [`workflow/${TICKET}/state.json`]: OK_STATE }), HEAD, 'workflow', TICKET, 8)
    expect(f).toEqual({ riskLevel: 'LOW', budgetHardCapReached: false, reviewInconclusive: false })
  })

  it('🔴 hardCap 도달을 읽는다', () => {
    const st = JSON.stringify({ risk_level: 'LOW', review_series: [{ attempts: 8, closed_reason: 'approved' }] })
    const f = readTicketFacts(fakeReadBlobs({ [`workflow/${TICKET}/state.json`]: st }), HEAD, 'workflow', TICKET, 8)
    expect(f.budgetHardCapReached).toBe(true)
  })
})

/** DEC-5 불변식 — 검증된 `V` 와 병합할 `C` 사이에 소비 커밋 하나만. */
describe('[REQ-2026-140] claimCommitProblem', () => {
  const V = 'a'.repeat(40)
  const C = 'b'.repeat(40)
  const stub = (revList: string, show: string): GitAdapter => ({
    exec: (args) => (args[0] === 'rev-list' ? revList : args[0] === 'show' ? show : ''),
  })

  it('소비 커밋 하나 · 원장만 변경 → 통과', () => {
    expect(claimCommitProblem(stub(`${C}\n`, `${DELEGATION_LEDGER_REL}\n`), V, C, BASE, BASE)).toBeNull()
  })

  it('🔴 trunk 가 움직였으면 거부', () => {
    expect(claimCommitProblem(stub(`${C}\n`, `${DELEGATION_LEDGER_REL}\n`), V, C, BASE, SRC)).toContain('trunk')
  })

  it('🔴 소비 커밋이 안 만들어졌으면 거부', () => {
    expect(claimCommitProblem(stub('', ''), V, V, BASE, BASE)).toContain('만들어지지')
  })

  it('🔴 사이에 다른 커밋이 있으면 거부', () => {
    expect(claimCommitProblem(stub(`${C}\n${SRC}\n`, `${DELEGATION_LEDGER_REL}\n`), V, C, BASE, BASE)).toContain('다른 커밋')
  })

  it('🔴 원장 밖을 바꿨으면 거부', () => {
    expect(claimCommitProblem(stub(`${C}\n`, `${DELEGATION_LEDGER_REL}\nsrc/app.ts\n`), V, C, BASE, BASE)).toContain('src/app.ts')
  })

  it('🔴 git 호출이 실패하면 거부한다(통과가 아니다)', () => {
    const bad: GitAdapter = {
      exec: () => {
        throw new Error('boom')
      },
    }
    expect(claimCommitProblem(bad, V, C, BASE, BASE)).toContain('확인하지 못했')
  })
})

describe('[REQ-2026-140] runIntegrate 배선 — 순수 테스트가 못 잡는 자리', () => {
  it('🔴 auto + 위임 없음 → 병합하지 않고 exit 1', async () => {
    const deps = makeDeps({
      git: fakeGit({ branch: FEATURE_001 }),
      readBlobs: fakeReadBlobs({ [`workflow/${TICKET}/state.json`]: OK_STATE }),
      stopGate: 'auto',
      readDelegationLedger: () => null,
    })
    const r = await runIntegrate(integrateOpts({ run: true }), deps)
    expect(r.merged).toBe(false)
    expect(r.exit).toBe(1)
    expect(deps.logs.join('\n')).toContain('사전 위임')
    // 🔴 병합을 시도조차 하지 않았다.
    expect(deps.git.calls.some((c) => c[0] === 'merge')).toBe(false)
  })

  it('🔴 stopGate 가 auto 가 아니면 위임 원장을 읽지도 않는다(무회귀)', async () => {
    let read = 0
    const deps = makeDeps({
      git: fakeGit({ branch: FEATURE_001 }),
      stopGate: 'merge',
      readDelegationLedger: () => {
        read++
        return null
      },
    })
    await runIntegrate(integrateOpts({ run: false }), deps)
    expect(read).toBe(0)
  })
})
