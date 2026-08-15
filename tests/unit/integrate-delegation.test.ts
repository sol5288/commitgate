import { describe, it, expect } from 'vitest'
import {
  claimCommitProblem,
  delegationGate,
  planPushActions,
  readDeliveryFacts,
  policyTargetIds,
  readTicketFacts,
  resolveIntegrationPolicy,
  runIntegrate,
  type AutoFacts,
  type RunDeps,
} from '../../bin/integrate'
import { makeDeps, integrateOpts, fakeGit, fakeReadBlobs, BASE, HEAD, MERGE_SHA, SRC, TRUNK } from '../support/integrate-fakes'
import {
  DELEGATION_LEDGER_REL,
  type DelegationIssued,
  type DelegationPermissions,
  type DelegationRow,
} from '../../scripts/req/lib/delegation'
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

const FACTS_OK: AutoFacts = {
  riskLevel: 'LOW',
  budgetHardCapReached: false,
  reviewInconclusive: false,
  deliveryMembers: null,
  compositionChanged: false,
  // REQ-2026-159: 정책 해소용 멤버 사실. 이 스위트는 `delegationGate` 자체를 보므로 빈 목록이면 충분하다.
  memberPolicies: [],
  policyMembersUnknown: false,
}

describe('[REQ-2026-140] delegationGate — auto 가 아니면 아무것도 하지 않는다', () => {
  it('🔴 phase·req·merge 는 not-required 다(무회귀)', () => {
    for (const sg of ['phase', 'req', 'merge'] as const) {
      const g = delegationGate(gateDeps({ stopGate: sg, readDelegationLedger: () => null }), prepared(), FACTS_OK, false)
      expect(g.kind, sg).toBe('not-required')
    }
  })
})

describe('[REQ-2026-140] delegationGate — auto', () => {
  it('🔴 위임이 없으면 거부하고 발급 방법을 알려준다', () => {
    const g = delegationGate(gateDeps({ stopGate: 'auto', readDelegationLedger: () => null }), prepared(), FACTS_OK, true)
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
      true,
    )
    expect(g.kind).toBe('allowed')
    if (g.kind === 'allowed') expect(g.delegationId).toBe('D1')
  })

  it('🔴 trunk 가 움직였으면 거부한다', () => {
    const g = delegationGate(
      gateDeps({ stopGate: 'auto', readDelegationLedger: () => ledgerOf(ISSUED({ trunk_sha: 'f'.repeat(40) })) }),
      prepared(),
      FACTS_OK,
      true,
    )
    expect(g.kind).toBe('denied')
    if (g.kind === 'denied') expect(g.lines.join('\n')).toContain('trunk-moved')
  })

  it('🔴 다른 브랜치의 위임은 쓰이지 않는다', () => {
    const g = delegationGate(
      gateDeps({ stopGate: 'auto', readDelegationLedger: () => ledgerOf(ISSUED({ source_branch: 'feat/req-2026-002-y' })) }),
      prepared(),
      FACTS_OK,
      true,
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
      authorized: { local_merge: true, origin_push: false, bypass_protection: false },
      outcome: 'merged',
      detail: '',
    }
    const g = delegationGate(
      gateDeps({ stopGate: 'auto', readDelegationLedger: () => ledgerOf(ISSUED(), consumed) }),
      prepared(),
      FACTS_OK,
      true,
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
      const g = delegationGate(deps, prepared(), facts, true)
      expect(g.kind, reason).toBe('denied')
      if (g.kind === 'denied') expect(g.lines.join('\n')).toContain(reason)
    }
  })

  it('HIGH 는 --high-risk 위임이면 통과한다', () => {
    const g = delegationGate(
      gateDeps({ stopGate: 'auto', readDelegationLedger: () => ledgerOf(ISSUED({ high_risk_ack: true })) }),
      prepared(),
      { ...FACTS_OK, riskLevel: 'HIGH' },
      true,
    )
    expect(g.kind).toBe('allowed')
  })

  it('🔴 브랜치에서 대상을 판정할 수 없으면 거부한다', () => {
    const g = delegationGate(
      gateDeps({ stopGate: 'auto', readDelegationLedger: () => ledgerOf(ISSUED()) }),
      prepared({ featureBranch: 'hotfix/thing' }),
      FACTS_OK,
      true,
    )
    expect(g.kind).toBe('denied')
    if (g.kind === 'denied') expect(g.lines.join('\n')).toContain('판정할 수 없')
  })

  /** 🔴 delivery 멤버를 읽지 못하면 거부한다(빈 목록으로 취급하지 않는다). */
  it('🔴 delivery 멤버를 못 읽으면 거부한다', () => {
    const g = delegationGate(
      gateDeps({
        stopGate: 'auto',
        readDelegationLedger: () => ledgerOf(ISSUED({ scope: { kind: 'delivery', slug: '0.23.0' }, source_branch: 'delivery/0.23.0' })),
      }),
      prepared({ featureBranch: 'delivery/0.23.0' }),
      { ...FACTS_OK, deliveryMembers: null },
      true,
    )
    expect(g.kind).toBe('denied')
  })

  it('🔴 delivery 구성이 바뀌었으면 거부한다', () => {
    const g = delegationGate(
      gateDeps({
        stopGate: 'auto',
        readDelegationLedger: () => ledgerOf(ISSUED({ scope: { kind: 'delivery', slug: '0.23.0' }, source_branch: 'delivery/0.23.0' })),
      }),
      prepared({ featureBranch: 'delivery/0.23.0' }),
      { ...FACTS_OK, deliveryMembers: [TICKET], compositionChanged: true },
      true,
    )
    expect(g.kind).toBe('denied')
    if (g.kind === 'denied') expect(g.lines.join('\n')).toContain('composition-changed')
  })

  it('delivery 묶음도 멤버·구성이 맞으면 통과한다', () => {
    const g = delegationGate(
      gateDeps({
        stopGate: 'auto',
        readDelegationLedger: () => ledgerOf(ISSUED({ scope: { kind: 'delivery', slug: '0.23.0' }, source_branch: 'delivery/0.23.0' })),
      }),
      prepared({ featureBranch: 'delivery/0.23.0' }),
      { ...FACTS_OK, deliveryMembers: [TICKET], compositionChanged: false },
      true,
    )
    expect(g.kind).toBe('allowed')
  })
})

describe('[REQ-2026-140] readTicketFacts — 못 읽으면 fail-closed', () => {
  it('state.json 이 없으면 HIGH·미결로 본다', () => {
    // 🔴 기본 fake 가 이제 `REQ-2026-001`·`REQ-2026-999` state 를 담으므로(현실적 트리),
    //    "없는 경우"를 보려면 **fake 에 없는 티켓 id** 를 써야 한다.
    const f = readTicketFacts(fakeReadBlobs(), HEAD, 'workflow', 'REQ-2026-777', 8)
    expect(f).toEqual({
      riskLevel: 'HIGH',
      budgetHardCapReached: false,
      reviewInconclusive: true,
      // 🔴 REQ-2026-159: 읽지 못한 것은 legacy 가 **아니다** — 어느 정책이 지배하는지 모른다는 뜻이다.
      snapshotStopGate: null,
      stateUnreadable: true,
    })
  })

  it('손상 JSON 도 같은 취급이다', () => {
    const f = readTicketFacts(fakeReadBlobs({ [`workflow/${TICKET}/state.json`]: '{oops' }), HEAD, 'workflow', TICKET, 8)
    expect(f.riskLevel).toBe('HIGH')
    expect(f.reviewInconclusive).toBe(true)
  })

  it('정상 state 는 그대로 읽는다', () => {
    const f = readTicketFacts(fakeReadBlobs({ [`workflow/${TICKET}/state.json`]: OK_STATE }), HEAD, 'workflow', TICKET, 8)
    expect(f).toEqual({
      riskLevel: 'LOW',
      budgetHardCapReached: false,
      reviewInconclusive: false,
      // 스냅샷이 없는 정상 state = legacy(= config 를 따름). `stateUnreadable` 과 구분된다.
      snapshotStopGate: null,
      stateUnreadable: false,
    })
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

/**
 * 🔴 push·bypass 는 **기본 불허**이고 서로 **독립**이다(요구 6).
 *    보호 설정을 로컬에서 읽을 수 없으므로 "CI 를 확인하지 않은 push = 우회"로 **보수적으로** 본다 —
 *    틀리는 방향이 더 강한 권한을 요구하는 쪽이라 안전하다.
 */
describe('[REQ-2026-140] planPushActions — push·bypass 분리', () => {
  const P = (over: Partial<DelegationPermissions> = {}): DelegationPermissions => ({
    local_merge: true,
    origin_push: false,
    bypass_protection: false,
    ...over,
  })

  it('push 를 위임하지 않았으면 로컬 병합까지만 한다(오류가 아니다)', () => {
    const r = planPushActions(P())
    expect(r.problem).toBeNull()
    expect(r.performed.origin_push).toBe(false)
  })

  it('🔴 push 위임인데 bypass 위임이 없으면 거부한다', () => {
    const r = planPushActions(P({ origin_push: true }))
    expect(r.problem).toContain('--allow-bypass')
    expect(r.performed.origin_push).toBe(false)
  })

  /**
   * 🔴 phase-4c 리뷰 r01 P1 — **CI 를 통과해도 우회는 우회다.**
   *    CI 는 feature SHA 에 결속되는데 trunk 로 올라가는 것은 소비 커밋과 CAS 병합으로 새로 만들어진
   *    **merge SHA** 다. 그 SHA 에 required check 가 돌아간 적은 없다.
   */
  it('🔴 CI 를 통과했어도 push 에는 bypass 위임이 필요하다(검사 대상이 다르다)', () => {
    const r = planPushActions(P({ origin_push: true }))
    expect(r.problem).not.toBeNull()
    expect(r.problem).toContain('merge SHA')
  })

  /**
   * 🔴 phase-4c 리뷰 r02 P1 — **`githubCi` 설정 유무로 판단하지 않는다.**
   *    그것은 CommitGate 가 CI 를 실행할지의 opt-in 일 뿐이고, 원격에 외부 CI 가 required check 로
   *    걸려 있을 수 있다. 원격 보호 상태는 로컬에서 알 수 없으므로 **push 자체를 우회로 본다.**
   */
  it('🔴 githubCi 설정이 없어도 push 에는 bypass 위임이 필요하다(원격 보호를 알 수 없다)', () => {
    const r = planPushActions(P({ origin_push: true }))
    expect(r.problem).not.toBeNull()
    expect(r.performed.origin_push).toBe(false)
  })

  it('🔴 bypass 를 위임했으면 진행하고 **우회했다는 사실을 남긴다**', () => {
    const r = planPushActions(P({ origin_push: true, bypass_protection: true }))
    expect(r.problem).toBeNull()
    expect(r.performed).toEqual({ local_merge: true, origin_push: true, bypass_protection: true })
  })

  it('🔴 bypass 만 위임하고 push 를 위임하지 않으면 push 하지 않는다(함의 없음)', () => {
    const r = planPushActions(P({ bypass_protection: true }))
    expect(r.performed.origin_push).toBe(false)
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

  /**
   * 🔴 **REQ-2026-159 에서 이 계약이 바뀌었다.** 예전에는 `stopGate` 가 `auto` 가 아니면 원장을
   *    읽지도 않았다. 그것이 바로 결함이었다: `auto` 로 만든 티켓이 나중에 `merge` config 를
   *    만나면 **아무것도 읽지 않고** 통과했다.
   *
   *    이제는 정책을 티켓 스냅샷에서 해소해야 하므로 사실을 **항상** 모은다(전부 read-only).
   *    지켜야 할 무회귀는 "읽지 않는다"가 아니라 **"판정이 `not-required` 이고 병합이 그대로 된다"**
   *    이다 — 아래가 그것을 본다.
   */
  it('🔴 legacy 티켓 + config merge 는 위임을 요구하지 않고 그대로 병합한다(무회귀)', async () => {
    const deps = makeDeps({
      git: fakeGit({ branch: FEATURE_001 }),
      stopGate: 'merge',
      readBlobs: fakeReadBlobs({ [`workflow/${TICKET}/state.json`]: OK_STATE }),
      readDelegationLedger: () => null,
    })
    const r = await runIntegrate(integrateOpts({ run: true }), deps)
    expect(r.merged, deps.logs.join(String.fromCharCode(10))).toBe(true)
    // 🔴 판정 근거까지 본다 — "위임을 요구하지 않았다"만이 아니라 **왜** 그런지가 보고돼야 한다.
    expect(deps.logs.join(String.fromCharCode(10))).toContain('사전 위임 불필요')
  })
})

/**
 * 🔴 phase-4c 리뷰 r04 P1 — 구성 비교는 **`order` 필드까지** 본다.
 *    배열 순서만 보면 같은 배열에서 `order` 값만 뒤바뀐 레코드를 동일하다고 읽는데,
 *    `order` 는 successor 체인의 방향을 정하므로 그것이 바뀐 묶음은 다른 묶음이다.
 */
describe('[REQ-2026-140] readDeliveryFacts — 구성 비교', () => {
  const REL = 'workflow/delivery/S.json'
  const rec = (members: { req_id: string; order: number }[]): string =>
    JSON.stringify({
      schema_version: 1,
      slug: 'S',
      branch: 'delivery/S',
      target_branch: TRUNK,
      state: 'open',
      events: [],
      members: members.map((m) => ({
        req_id: m.req_id,
        order: m.order,
        delivery_base_sha: BASE,
        status: 'active',
        successor_of: null,
        feature_ref: null,
        integrated_at: null,
        superseded_evidence: null,
      })),
    })

  /** ref 별로 다른 내용을 돌려주는 readBlobs. */
  const blobsByRef = (byRef: Record<string, string>) => (ref: string, paths: readonly string[]) =>
    new Map(paths.map((p) => [p, p === REL && byRef[ref] !== undefined ? Buffer.from(byRef[ref] as string, 'utf8') : null]))

  const A1B2 = rec([
    { req_id: 'REQ-2026-001', order: 1 },
    { req_id: 'REQ-2026-002', order: 2 },
  ])

  it('같은 구성이면 변화 없음', () => {
    const f = readDeliveryFacts(blobsByRef({ HEADREF: A1B2, BASEREF: A1B2 }), 'workflow', 'S', 'HEADREF', 'BASEREF')
    expect(f.members).toEqual(['REQ-2026-001', 'REQ-2026-002'])
    expect(f.compositionChanged).toBe(false)
  })

  it('🔴 배열은 그대로인데 order 값만 뒤바뀌면 구성 변화다', () => {
    const swapped = rec([
      { req_id: 'REQ-2026-001', order: 2 },
      { req_id: 'REQ-2026-002', order: 1 },
    ])
    const f = readDeliveryFacts(blobsByRef({ HEADREF: swapped, BASEREF: A1B2 }), 'workflow', 'S', 'HEADREF', 'BASEREF')
    expect(f.compositionChanged).toBe(true)
  })

  it('🔴 멤버가 늘면 구성 변화다', () => {
    const more = rec([
      { req_id: 'REQ-2026-001', order: 1 },
      { req_id: 'REQ-2026-002', order: 2 },
      { req_id: 'REQ-2026-003', order: 3 },
    ])
    const f = readDeliveryFacts(blobsByRef({ HEADREF: more, BASEREF: A1B2 }), 'workflow', 'S', 'HEADREF', 'BASEREF')
    expect(f.compositionChanged).toBe(true)
  })

  it('🔴 못 읽거나 손상이면 fail-closed', () => {
    expect(readDeliveryFacts(blobsByRef({}), 'workflow', 'S', 'HEADREF', 'BASEREF')).toEqual({
      members: null,
      compositionChanged: true,
    })
    const f = readDeliveryFacts(blobsByRef({ HEADREF: A1B2, BASEREF: '{oops' }), 'workflow', 'S', 'HEADREF', 'BASEREF')
    expect(f.compositionChanged).toBe(true)
  })
})

/**
 * REQ-2026-140 phase-6 — **`runIntegrate` 를 실제로 태우는 push 배선**(phase-4c 리뷰 관측).
 *
 * 🔴 순수 판정(`planPushActions`)만 있으면 "판정은 맞는데 아무도 그것을 쓰지 않는" 상태를 못 잡는다.
 *    이 저장소는 그 실패를 세 번 실증했다(REQ-2026-083·097·099).
 */
describe('[REQ-2026-140] runIntegrate — push·수행 기록 배선', () => {
  const DELEGATION = (perms: Partial<DelegationPermissions>): string =>
    ledgerOf(ISSUED({ permissions: { local_merge: true, origin_push: false, bypass_protection: false, ...perms } }))

  /**
   * 🔴 **소비 커밋이 tip 을 움직이는 것을 모사한다.** 공유 fake 는 ref 가 고정이라 `C === V` 가 되어
   *    CAS 불변식(`claimCommitProblem`)에서 정상 경로가 막힌다 — 그건 fake 의 한계이지 결함이 아니다.
   *    래퍼를 테스트 안에 두어 공유 fake 를 복잡하게 만들지 않는다.
   */
  const CLAIM_SHA = '7'.repeat(40)
  const gitWithClaim = (opts: Parameters<typeof fakeGit>[0] = {}) => {
    const inner = fakeGit({ branch: FEATURE_001, ...opts })
    let claimed = false
    const g: ReturnType<typeof fakeGit> = {
      calls: inner.calls,
      exec(args: string[]): string {
        /**
         * 소비 커밋 이후 **feature 쪽 SHA 는 전부 C** 다.
         * 🔴 `collect()` 는 브랜치 ref 가 아니라 `HEAD^{commit}` 을 읽는다 — ref 이름만 가로채면
         *    이 경로를 놓친다. trunk 를 가리키지 않는 `rev-parse` 를 전부 C 로 답한다.
         */
        if (claimed && args[0] === 'rev-parse' && args[1] !== '--abbrev-ref' && !(args[2] ?? '').includes(TRUNK)) {
          inner.calls.push(args)
          return `${CLAIM_SHA}\n`
        }
        // `rev-list <V>..<C>` 는 소비 커밋 하나만 돌려준다(`--parents -n 1` 형태와 구별).
        if (args[0] === 'rev-list' && args.some((a) => a.includes('..'))) {
          inner.calls.push(args)
          return `${CLAIM_SHA}\n`
        }
        // 병합 후 부모 확인(`rev-list --parents -n 1`)은 **C** 를 부모로 답해야 한다.
        if (claimed && args[0] === 'rev-list') {
          inner.calls.push(args)
          return `${MERGE_SHA} ${BASE} ${CLAIM_SHA}\n`
        }
        return inner.exec(args)
      },
    }
    return { git: g, claim: () => void (claimed = true) }
  }

  const autoDeps = (over: Omit<Partial<RunDeps>, 'git'> & { git: ReturnType<typeof fakeGit> }) =>
    makeDeps({
      readBlobs: fakeReadBlobs({ [`workflow/${TICKET}/state.json`]: OK_STATE }),
      now: () => '2026-08-10T00:00:00.000Z',
      stopGate: 'auto',
      ...over,
    })

  it('🔴 push 를 위임하지 않으면 병합만 하고 push 를 호출하지 않는다', async () => {
    const { git, claim } = gitWithClaim()
    const rows: DelegationRow[] = []
    const deps = autoDeps({
      git,
      readDelegationLedger: () => DELEGATION({}),
      appendDelegationRow: (r) => {
        rows.push(r)
        if (r.kind === 'consumed') claim()
      },
    })
    const r = await runIntegrate(integrateOpts({ run: true }), deps)
    expect(r.merged).toBe(true)
    expect(git.calls.some((c) => c[0] === 'push')).toBe(false)
    // 소비(인가) + 수행 기록 두 행이 남는다.
    expect(rows.map((x) => x.kind)).toEqual(['consumed', 'executed'])
    const executed = rows[1] as Extract<DelegationRow, { kind: 'executed' }>
    expect(executed.performed).toEqual({ local_merge: true, origin_push: false, bypass_protection: false })
  })

  it('🔴 push+bypass 위임이면 두 번 push 한다(병합 · 수행 기록)', async () => {
    const { git, claim } = gitWithClaim({ pushResults: [null, null] })
    const rows: DelegationRow[] = []
    const deps = autoDeps({
      git,
      readDelegationLedger: () => DELEGATION({ origin_push: true, bypass_protection: true }),
      appendDelegationRow: (r) => {
        rows.push(r)
        if (r.kind === 'consumed') claim()
      },
    })
    const r = await runIntegrate(integrateOpts({ run: true }), deps)
    expect(r.exit).toBe(0)
    expect(git.calls.filter((c) => c[0] === 'push')).toHaveLength(2)
    const executed = rows.find((x) => x.kind === 'executed') as Extract<DelegationRow, { kind: 'executed' }>
    expect(executed.performed).toEqual({ local_merge: true, origin_push: true, bypass_protection: true })
    // 🔴 우회 사실이 **최종 보고에도** 남는다.
    expect(deps.logs.join('\n')).toContain('required check')
  })

  it('🔴 1차 push 가 실패하면 exit 1 이고 수행 기록에 push=false 로 남는다', async () => {
    const { git, claim } = gitWithClaim({ pushResults: [new Error('protected branch')] })
    const rows: DelegationRow[] = []
    const deps = autoDeps({
      git,
      readDelegationLedger: () => DELEGATION({ origin_push: true, bypass_protection: true }),
      appendDelegationRow: (r) => {
        rows.push(r)
        if (r.kind === 'consumed') claim()
      },
    })
    const r = await runIntegrate(integrateOpts({ run: true }), deps)
    expect(r.exit).toBe(1)
    const executed = rows.find((x) => x.kind === 'executed') as Extract<DelegationRow, { kind: 'executed' }>
    // 🔴 하지 않은 일을 했다고 적지 않는다.
    expect(executed.performed.origin_push).toBe(false)
    expect(executed.performed.bypass_protection).toBe(false)
  })

  it('🔴 2차 push(수행 기록) 실패는 로컬이 앞선다고 알리고 exit 1 이다', async () => {
    const { git, claim } = gitWithClaim({ pushResults: [null, new Error('rejected')] })
    const deps = autoDeps({
      git,
      readDelegationLedger: () => DELEGATION({ origin_push: true, bypass_protection: true }),
      appendDelegationRow: (r) => {
        if (r.kind === 'consumed') claim()
      },
    })
    const r = await runIntegrate(integrateOpts({ run: true }), deps)
    expect(r.exit).toBe(1)
    expect(r.merged).toBe(true)
    expect(deps.logs.join('\n')).toContain('앞서 있습니다')
  })
})

/**
 * REQ-2026-159 — **티켓 정책 스냅샷이 최종 통합에도 적용된다.**
 *
 * 🔴 **왜 `runIntegrate` 를 태우는가**: 순수 함수만 검사하면 배선이 끊겨도 green 이다. 실제로
 *    `bin/integrate.ts` 는 `resolveIntegrationPolicy` 없이도 컴파일됐고, `cfg.stopGate` 를 직접
 *    넘기고 있었다 — 그것이 이 REQ 의 P1 이다.
 *
 * 🔴 **비대화형 + `--run`** 으로 돈다. 그 조합에서 최종 확인이 생략되므로(`deps.interactive` 분기)
 *    도구 게이트가 유일한 방어선이다.
 *
 * 🔴 **exit code 만 보지 않는다.** `merge` 호출 횟수까지 센다 — 병합한 뒤 실패한 경우와 구별된다.
 */
describe('[REQ-2026-159] runIntegrate — 정책은 티켓 스냅샷에서 해소된다', () => {
  const stateWith = (stopGate: string | null): string =>
    JSON.stringify({
      id: TICKET,
      risk_level: 'LOW',
      review_series: [{ series_id: 'phase:p1#1', attempts: 1, closed_reason: 'approved' }],
      ...(stopGate === null ? {} : { policy_snapshot: { stop_gate: stopGate } }),
    })

  const DELIVERY_SLUG = 'bundle'
  const DELIVERY_BRANCH = `delivery/${DELIVERY_SLUG}`
  const M1 = 'REQ-2026-001'
  const M2 = 'REQ-2026-002'
  const deliveryRecord = JSON.stringify({
    schema_version: 1,
    slug: DELIVERY_SLUG,
    branch: DELIVERY_BRANCH,
    target_branch: TRUNK,
    state: 'approved',
    members: [
      { req_id: M1, order: 1, delivery_base_sha: BASE, status: 'integrated' },
      { req_id: M2, order: 2, delivery_base_sha: BASE, status: 'integrated' },
    ],
    events: [],
    approval: { base_sha: BASE, at: '2026-08-10T00:00:00.000Z' },
  })

  const CLAIM_SHA = '7'.repeat(40)

  /**
   * 실행 한 벌. `blobs` 로 트리 내용을, `ledger` 로 위임 원장을 정한다.
   *
   * 🔴 `showRecord` — delivery 승인 결속 검사는 레코드를 `git show` 로 읽는다(트리는 `readBlobs`).
   *    실제 저장소에서는 둘이 같은 것을 보므로 fake 도 **양쪽에 같은 값**을 둔다.
   * 🔴 `withClaim` — 소비 커밋이 tip 을 움직이는 것을 모사한다. 공유 fake 는 ref 가 고정이라
   *    `C === V` 가 되어 CAS 불변식에서 정상 경로가 막힌다(fake 의 한계이지 결함이 아니다).
   */
  const run = async (over: {
    stopGate: RunDeps['stopGate']
    blobs: Record<string, string>
    ledger?: string | null
    branch?: string
    branchPrefix?: string
    showRecord?: string
    withClaim?: boolean
    /** 대화형 세션 모사 + 최종 확인 답변([y/N]). */
    interactive?: { answer: string }
  }): Promise<{ exit: number; merged: boolean; merges: number; logs: string }> => {
    const inner = fakeGit({ branch: over.branch ?? FEATURE_001 })
    let claimed = false
    const git: ReturnType<typeof fakeGit> = {
      calls: inner.calls,
      exec(args: string[]): string {
        if (over.showRecord !== undefined && args[0] === 'show') return over.showRecord
        // 승인 이후 커밋 조회(staleness). 이 스위트가 보는 것은 **정책 해소**이므로 깨끗하다고 답한다.
        if (over.showRecord !== undefined && args[0] === 'rev-list' && args.includes('--')) return ''
        if (claimed && args[0] === 'rev-parse' && args[1] !== '--abbrev-ref' && !(args[2] ?? '').includes(TRUNK)) {
          inner.calls.push(args)
          return `${CLAIM_SHA}\n`
        }
        if (claimed && args[0] === 'rev-list' && args.some((a) => a.includes('..'))) {
          inner.calls.push(args)
          return `${CLAIM_SHA}\n`
        }
        if (claimed && args[0] === 'rev-list') {
          inner.calls.push(args)
          return `${MERGE_SHA} ${BASE} ${CLAIM_SHA}\n`
        }
        return inner.exec(args)
      },
    }
    const deps = {
      ...makeDeps({
        git,
        stopGate: over.stopGate,
        readBlobs: fakeReadBlobs(over.blobs),
        readDelegationLedger: () => over.ledger ?? null,
        now: () => '2026-08-10T00:00:00.000Z',
        ...(over.withClaim === true
          ? { appendDelegationRow: (r: DelegationRow): void => void (r.kind === 'consumed' && (claimed = true)) }
          : {}),
        ...(over.interactive === undefined
          ? {}
          : { interactive: true, ask: async (): Promise<string> => over.interactive?.answer ?? 'n' }),
      }),
      ...(over.branchPrefix === undefined ? {} : { branchPrefix: over.branchPrefix }),
    }
    const r = await runIntegrate(integrateOpts({ run: true }), deps)
    return {
      exit: r.exit,
      merged: r.merged,
      merges: git.calls.filter((c) => c[0] === 'merge').length,
      logs: deps.logs.join(String.fromCharCode(10)),
    }
  }

  it('① 스냅샷 auto + config merge + 위임 없음 → 거부하고 병합하지 않는다', async () => {
    const r = await run({ stopGate: 'merge', blobs: { [`workflow/${TICKET}/state.json`]: stateWith('auto') } })
    expect(r.exit, r.logs).toBe(1)
    expect(r.merged).toBe(false)
    // 🔴 exit 만 보면 "병합한 뒤 실패"와 구분되지 않는다.
    expect(r.merges).toBe(0)
    expect(r.logs).toContain('사전 위임')
  })

  it('② 스냅샷 merge + config auto → 없던 위임 요구가 생기지 않는다(병합)', async () => {
    const r = await run({ stopGate: 'auto', blobs: { [`workflow/${TICKET}/state.json`]: stateWith('merge') } })
    expect(r.merged, r.logs).toBe(true)
    expect(r.logs).toContain('스냅샷 merge')
    expect(r.logs).toContain('사전 위임 불필요')
  })

  it('③ 스냅샷 auto + config merge + 유효 위임 → 통합된다', async () => {
    const r = await run({
      stopGate: 'merge',
      blobs: { [`workflow/${TICKET}/state.json`]: stateWith('auto') },
      ledger: ledgerOf(ISSUED()),
      withClaim: true,
    })
    expect(r.merged, r.logs).toBe(true)
    // 🔴 **근거를 보고한다**(phase-1 r01 P1) — 어느 티켓의 무엇이 위임을 요구했는지.
    expect(r.logs).toContain(`${TICKET}: 스냅샷 auto`)
    expect(r.logs).toContain('사전 위임 필요')
  })

  it('④ 묶음에 auto 티켓과 merge 티켓이 섞이면 위임 없이는 거부한다', async () => {
    const r = await run({
      stopGate: 'merge',
      branch: DELIVERY_BRANCH,
      branchPrefix: 'delivery/',
      blobs: {
        [`workflow/delivery/${DELIVERY_SLUG}.json`]: deliveryRecord,
        [`workflow/${M1}/state.json`]: stateWith('auto'),
        [`workflow/${M2}/state.json`]: stateWith('merge'),
      },
      showRecord: deliveryRecord,
    })
    expect(r.exit, r.logs).toBe(1)
    expect(r.merged).toBe(false)
    expect(r.merges).toBe(0)
  })

  it('⑤ legacy(스냅샷 없음) + config merge → 현재 config 동작 보존(병합)', async () => {
    const r = await run({ stopGate: 'merge', blobs: { [`workflow/${TICKET}/state.json`]: stateWith(null) } })
    expect(r.merged, r.logs).toBe(true)
  })

  /**
   * 🔴 **설계 r01 P1 의 회귀 오라클.** "그 외 → config" 로 접으면 유효한 `merge` 스냅샷이 버려져
   *    이 경우가 위임을 요구하게 된다 — 목표("생성 시 정책이 끝까지 간다")의 역방향 위반이다.
   */
  it('⑥ 묶음이 전부 merge 스냅샷 + config auto → 없던 위임 요구가 생기지 않는다(병합)', async () => {
    const r = await run({
      stopGate: 'auto',
      branch: DELIVERY_BRANCH,
      branchPrefix: 'delivery/',
      blobs: {
        [`workflow/delivery/${DELIVERY_SLUG}.json`]: deliveryRecord,
        [`workflow/${M1}/state.json`]: stateWith('merge'),
        [`workflow/${M2}/state.json`]: stateWith('merge'),
      },
      showRecord: deliveryRecord,
    })
    expect(r.merged, r.logs).toBe(true)
    // 🔴 r01 P1: 두 멤버의 스냅샷이 **각각** 근거로 보고된다.
    expect(r.logs).toContain(`${M1}: 스냅샷 merge`)
    expect(r.logs).toContain(`${M2}: 스냅샷 merge`)
    expect(r.logs).toContain('사전 위임 불필요')
  })

  /**
   * 🔴 **읽지 못함은 legacy 가 아니다.** 같은 입력을 못 읽으면 위험도는 이미 HIGH 로 되돌리면서
   *    정책만 "모르니까 통과"로 읽을 수는 없다.
   */
  it('⑦ 티켓 state 를 읽지 못하면 config 값과 무관하게 거부한다(fail-closed)', async () => {
    const r = await run({ stopGate: 'merge', blobs: { [`workflow/${TICKET}/state.json`]: '{oops' } })
    expect(r.exit, r.logs).toBe(1)
    expect(r.merged).toBe(false)
    expect(r.merges).toBe(0)
    expect(r.logs).toContain('판정할 수 없습니다')
    // 🔴 안내가 약속한 것과 실제 동작이 같아야 한다 — 이 문장이 있으면 아래 두 테스트가 그것을 증명한다.
    expect(r.logs).toContain('대화형 세션이라면')
  })

  /**
   * 🔴 **r02 P1 — 안내한 탈출구는 실제로 열려 있어야 한다.**
   *    "대화형이면 사람이 승인할 수 있다"고 적어 놓고 대화형에서도 즉시 멈추면, 이 저장소가 여러 번
   *    밟은 **실행 불가능한 안내**를 또 만드는 것이다.
   */
  it('⑧ 판정 불가 + 대화형 + 사람이 y → 통합된다', async () => {
    const r = await run({
      stopGate: 'merge',
      blobs: { [`workflow/${TICKET}/state.json`]: '{oops' },
      interactive: { answer: 'y' },
    })
    expect(r.merged, r.logs).toBe(true)
    expect(r.logs).toContain('정책 판정 불가')
  })

  it('⑨ 판정 불가 + 대화형 + 사람이 n → 병합하지 않는다(기본 No)', async () => {
    const r = await run({
      stopGate: 'merge',
      blobs: { [`workflow/${TICKET}/state.json`]: '{oops' },
      interactive: { answer: '' },
    })
    expect(r.merged).toBe(false)
    expect(r.merges).toBe(0)
  })
})

/**
 * REQ-2026-159 phase-3 — **브랜치 이름이 `auto` 정책을 약화시키는 통로가 되면 안 된다.**
 *
 * 🔴 우회 경로: `branchPrefix`(`feat/req-`)는 만족하지만 뒤에 REQ 번호 형식이 없는 브랜치
 *    (`feat/req-renamed`)는 `scopeOfBranch()` 가 `null` 이다. 이전 구현은 그때 정책 대상을 비우고
 *    **현재 config 로 폴백**했다 — config 가 `merge` 면 위임 검사가 꺼진다.
 *
 * 🔴 해소는 **정책 대상과 위임 대상을 분리**하는 것이다. 위임 권한은 그대로 브랜치 scope 만 쓰고,
 *    정책은 **결속된 범위의 커밋 귀속**에서도 티켓을 찾는다.
 */
describe('[REQ-2026-159] 브랜치 이름으로 정책을 약화시킬 수 없다', () => {
  const RENAMED = 'feat/req-renamed'
  const ATTRIBUTED = 'REQ-2026-001' // 기본 fake 의 매니페스트·부기 경로가 가리키는 티켓

  const runRenamed = async (
    stateJson: string,
    over: { interactive?: string } = {},
  ): Promise<{ exit: number; merged: boolean; merges: number; logs: string }> => {
    const git = fakeGit({ branch: RENAMED })
    const deps = makeDeps({
      git,
      stopGate: 'merge',
      readBlobs: fakeReadBlobs({ [`workflow/${ATTRIBUTED}/state.json`]: stateJson }),
      readDelegationLedger: () => null,
      ...(over.interactive === undefined ? {} : { interactive: true, ask: async (): Promise<string> => over.interactive as string }),
    })
    const r = await runIntegrate(integrateOpts({ run: true }), deps)
    return {
      exit: r.exit,
      merged: r.merged,
      merges: git.calls.filter((c) => c[0] === 'merge').length,
      logs: deps.logs.join(String.fromCharCode(10)),
    }
  }

  const auto = JSON.stringify({ id: ATTRIBUTED, risk_level: 'LOW', review_series: [], policy_snapshot: { stop_gate: 'auto' } })
  const legacy = JSON.stringify({ id: ATTRIBUTED, risk_level: 'LOW', review_series: [] })

  it('🔴 scope 를 못 읽어도 귀속으로 찾은 auto 스냅샷이 위임을 요구한다(비대화형 → 거부)', async () => {
    const r = await runRenamed(auto)
    expect(r.exit, r.logs).toBe(1)
    expect(r.merged).toBe(false)
    expect(r.merges).toBe(0)
    expect(r.logs).toContain('사전 위임')
  })

  it('🔴 귀속으로 찾은 티켓이 legacy 면 config 를 따른다(무회귀 — 병합)', async () => {
    const r = await runRenamed(legacy)
    expect(r.merged, r.logs).toBe(true)
  })

  /**
   * 🔴 **config 폴백이 사라졌다는 것**을 이 브랜치에서 직접 본다. 귀속으로 대상은 찾았지만 그 티켓의
   *    state 를 읽지 못하면, 예전 코드는 대상이 비어 `merge` 로 폴백해 **그대로 병합**했다.
   */
  it('🔴 귀속 대상의 state 를 읽지 못하면 비대화형은 거부한다(config 폴백 없음)', async () => {
    const r = await runRenamed('{broken')
    expect(r.exit, r.logs).toBe(1)
    expect(r.merged).toBe(false)
    expect(r.merges).toBe(0)
    expect(r.logs).toContain('판정할 수 없습니다')
  })

  it('🔴 같은 입력에서 대화형 y 면 사람 판단으로 통합된다', async () => {
    const r = await runRenamed('{broken', { interactive: 'y' })
    expect(r.merged, r.logs).toBe(true)
  })
})

/**
 * `policyTargetIds` — 정책 대상 확정(순수). 🔴 **"모름"과 "없음"을 구별한다.**
 * 대상이 하나도 없으면 빈 배열이고, 호출부(`resolveIntegrationPolicy`)가 그것을 판정 불가로 다룬다.
 */
describe('[REQ-2026-159] policyTargetIds', () => {
  const noDelivery = (): string[] | null => null

  it('🔴 귀속되지 않은 커밋이 하나라도 있으면 모름(null)이다', () => {
    expect(policyTargetIds({ tickets: ['REQ-2026-001'], unattributableCommits: [{}] }, null, noDelivery)).toBeNull()
  })

  it('브랜치 scope 와 귀속을 **합친다**(더 좁게 읽지 않는다)', () => {
    const ids = policyTargetIds(
      { tickets: ['REQ-2026-001'], unattributableCommits: [] },
      { kind: 'ticket', req_id: 'REQ-2026-999' },
      noDelivery,
    )
    expect(ids?.slice().sort()).toEqual(['REQ-2026-001', 'REQ-2026-999'])
  })

  it('🔴 묶음 멤버를 읽지 못하면 모름(null)이다', () => {
    expect(policyTargetIds({ tickets: [], deliveries: ['s'], unattributableCommits: [] }, null, noDelivery)).toBeNull()
  })

  it('대상이 없으면 빈 배열이다 — 호출부가 판정 불가로 다룬다', () => {
    expect(policyTargetIds({ tickets: [], unattributableCommits: [] }, null, noDelivery)).toEqual([])
  })
})

/**
 * `resolveIntegrationPolicy` — 🔴 **대상이 비면 config 로 폴백하지 않는다.**
 *
 * 변이 검사가 이 구멍을 드러냈다: `policyTargetIds` 가 `[]` 를 돌려주는 것만 검사하고 그 `[]` 가
 * **판정 불가로 이어지는지**는 아무도 보지 않아, 폴백을 되돌려도 전부 green 이었다.
 */
describe('[REQ-2026-159] resolveIntegrationPolicy — 대상이 비면 판정 불가', () => {
  const empty: AutoFacts = { ...FACTS_OK, memberPolicies: [], policyMembersUnknown: false }

  for (const sg of ['phase', 'req', 'merge', 'auto'] as const) {
    it(`🔴 config ${sg} 에서도 indeterminate 다(폴백 없음)`, () => {
      const p = resolveIntegrationPolicy(empty, sg)
      expect(p.kind, sg).toBe('indeterminate')
      if (p.kind === 'indeterminate') expect(p.lines.join(String.fromCharCode(10))).toContain('확정할 수 없습니다')
    })
  }

  it('대상이 있으면 정상 판정한다(대조군)', () => {
    const p = resolveIntegrationPolicy(
      { ...empty, memberPolicies: [{ id: 'REQ-2026-001', snapshotStopGate: 'auto', stateUnreadable: false }] },
      'merge',
    )
    expect(p.kind).toBe('resolved')
    if (p.kind === 'resolved') expect(p.delegationRequired).toBe(true)
  })
})
