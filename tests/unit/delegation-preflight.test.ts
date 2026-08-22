import { describe, it, expect } from 'vitest'
import {
  preflightDelegation,
  PREFLIGHT_CLASS,
  ACK_FOR,
  ALL_DENY_REASONS,
  MAX_ACK_PROBES,
  type PreflightInput,
} from '../../scripts/req/lib/delegation-preflight'
import {
  serializeDelegationRow,
  ledgerWithCandidate,
  DELEGATION_DENY_REASONS,
  DENY_GUIDANCE,
  type DelegationIssued,
  type RangeAttribution,
} from '../../scripts/req/lib/delegation'

/**
 * REQ-2026-172 phase-2 — 발급 시점 preflight(순수).
 *
 * 🔴 오라클의 핵심은 **두 가지**다:
 *    ① `not-yet-knowable` 로 분류한 사유가 **정상 발급을 막지 않는다**(과잉 차단이 더 나쁘다).
 *    ② 필요한 ack 를 **한 번에 전부** 찾는다 — 하나씩 알려 주면 왕복이 줄지 않는다(DEC-7).
 */

const ISO = '2026-08-22T00:00:00.000Z'
const LATER = '2026-08-22T12:00:00.000Z'
const TRUNK = 'a'.repeat(40)

function candidate(over: Partial<DelegationIssued> = {}): DelegationIssued {
  return {
    kind: 'issued',
    id: 'ID-1',
    at: ISO,
    scope: { kind: 'ticket', req_id: 'REQ-2026-001' },
    trunk_branch: 'main',
    trunk_sha: TRUNK,
    source_branch: 'feat/req-2026-001-x',
    base_sha: 'b'.repeat(40),
    expires_at: LATER,
    permissions: { local_merge: true, origin_push: false, bypass_protection: false },
    high_risk_ack: false,
    attested_ack: false,
    approval_sentence: '통합을 사전 위임합니다',
    ...over,
  }
}

const CLEAN_ATTRIBUTION: RangeAttribution = {
  tickets: ['REQ-2026-001'],
  unattributable: 0,
  unattributableAttested: 0,
  deliveries: [],
}

function input(over: Partial<PreflightInput> = {}): PreflightInput {
  return {
    ledgerText: null,
    candidate: candidate(),
    now: ISO,
    trunkSha: TRUNK,
    requested: { local_merge: true, origin_push: false, bypass_protection: false },
    riskLevel: 'LOW',
    budgetHardCapReached: false,
    reviewInconclusive: false,
    evidenceOk: true,
    rangeAttribution: CLEAN_ATTRIBUTION,
    deliveryMembers: null,
    compositionChanged: false,
    ...over,
  }
}

// ───────────────────────────── 등록부 전수(사각지대 금지) ──

describe('[REQ-2026-172 DEC-2] 사유 분류표가 등록부를 빠짐없이 덮는다', () => {
  it('🔴 목록을 손으로 세지 않는다 — 등록부에서 파생해 대조한다', () => {
    expect(Object.keys(PREFLIGHT_CLASS).sort()).toEqual([...DELEGATION_DENY_REASONS].sort())
    expect(Object.keys(ACK_FOR).sort()).toEqual([...DELEGATION_DENY_REASONS].sort())
    expect([...ALL_DENY_REASONS].sort()).toEqual([...DELEGATION_DENY_REASONS].sort())
  })

  it('🔴 ack 가 붙은 사유는 반드시 `block` 이다(무시할 것에 ack 를 달면 의미가 없다)', () => {
    for (const [reason, ack] of Object.entries(ACK_FOR))
      if (ack !== null) expect(PREFLIGHT_CLASS[reason as keyof typeof PREFLIGHT_CLASS], reason).toBe('block')
  })

  it('모든 사유에 해소 안내가 있다(거부하면서 무엇을 할지 안 알려 주면 막다른 길이다)', () => {
    for (const r of DELEGATION_DENY_REASONS) expect(DENY_GUIDANCE[r].length, r).toBeGreaterThan(5)
  })
})

// ───────────────────────────── 정상 경로 ──

describe('[REQ-2026-172] 정상 발급은 막지 않는다', () => {
  it('깨끗한 범위 → ok', () => {
    expect(preflightDelegation(input())).toEqual({ kind: 'ok' })
  })

  /**
   * 🔴 **과잉 차단이 더 나쁘다.** `trunk-moved`·`expired`·`absent` 를 `block` 으로 두면
   *    발급 순간의 값이 늘 "현재"라 **정상 발급이 전부 거부된다.**
   */
  it('🔴 발급 시점에 성립할 수 없는 사유는 분류가 not-yet-knowable 이다', () => {
    for (const r of ['absent', 'trunk-moved', 'expired', 'consumed', 'revoked'] as const)
      expect(PREFLIGHT_CLASS[r], r).toBe('not-yet-knowable')
  })

  it('후보 행을 넣으므로 `absent` 가 나지 않는다(원장이 비어 있어도)', () => {
    expect(preflightDelegation(input({ ledgerText: null })).kind).toBe('ok')
    expect(preflightDelegation(input({ ledgerText: '' })).kind).toBe('ok')
  })

  it('🔴 기존 원장이 개행으로 끝나지 않아도 두 줄이 붙지 않는다', () => {
    const prior = serializeDelegationRow(candidate({ id: 'OLD' })).replace(/\n$/, '')
    const merged = ledgerWithCandidate(prior, candidate({ id: 'NEW' }))
    expect(merged.split('\n').filter(Boolean)).toHaveLength(2)
  })
})

// ───────────────────────────── ack 탐색(DEC-7) ──

describe('[REQ-2026-172 DEC-7] 필요한 ack 를 한 번에 전부 찾는다', () => {
  const ATTESTED_ONLY: RangeAttribution = {
    tickets: ['REQ-2026-001'],
    unattributable: 2,
    unattributableAttested: 2, // 전부 attested → --allow-attested 로 열린다
    deliveries: [],
  }

  it('attested-only → --allow-attested 하나가 필요하다', () => {
    const r = preflightDelegation(input({ rangeAttribution: ATTESTED_ONLY }))
    expect(r.kind).toBe('needs-acks')
    if (r.kind !== 'needs-acks') return
    expect(r.acks).toEqual({ attestedAck: true, highRiskAck: false })
    expect(r.reasons).toEqual(['scope-out-of-range'])
  })

  it('HIGH 티켓 → --high-risk 하나가 필요하다', () => {
    const r = preflightDelegation(input({ riskLevel: 'HIGH' }))
    expect(r.kind).toBe('needs-acks')
    if (r.kind !== 'needs-acks') return
    expect(r.acks).toEqual({ attestedAck: false, highRiskAck: true })
  })

  /**
   * 🔴 **이 케이스가 이 REQ 의 존재 이유다.** `delegationVerdict` 는 사유를 하나씩만 내므로,
   *    탐색이 없으면 `--allow-attested` 만 알려 주고 → 재발급 → 이번엔 `--high-risk` → **왕복이 는다**.
   */
  it('🔴 HIGH + attested-only → **두 ack 를 한 번에** 찾는다', () => {
    const r = preflightDelegation(input({ riskLevel: 'HIGH', rangeAttribution: ATTESTED_ONLY }))
    expect(r.kind).toBe('needs-acks')
    if (r.kind !== 'needs-acks') return
    expect(r.acks).toEqual({ attestedAck: true, highRiskAck: true })
    expect(r.reasons.sort()).toEqual(['high-risk-unacked', 'scope-out-of-range'])
  })

  it('사람이 이미 명시한 ack 는 다시 요구하지 않는다', () => {
    const r = preflightDelegation(
      input({ riskLevel: 'HIGH', candidate: candidate({ high_risk_ack: true }) }),
    )
    expect(r.kind).toBe('ok')
  })

  it('탐색 상한이 ack 수보다 크다(수렴 여유)', () => {
    expect(MAX_ACK_PROBES).toBeGreaterThan(2)
  })
})

// ───────────────────────────── 열리지 않는 것 ──

describe('[REQ-2026-172] 플래그로 열리지 않는 것은 명령을 내지 않는다', () => {
  it('🔴 범위에 다른 티켓이 섞이면 --allow-attested 로도 열리지 않는다', () => {
    const r = preflightDelegation(
      input({
        rangeAttribution: { tickets: ['REQ-2026-001', 'REQ-2026-002'], unattributable: 0, unattributableAttested: 0, deliveries: [] },
      }),
    )
    expect(r.kind).toBe('blocked')
    if (r.kind !== 'blocked') return
    expect(r.reason).toBe('scope-out-of-range')
    expect(r.detail).toContain('REQ-2026-002')
  })

  it('🔴 귀속 불가가 attested 만이 아니면 열리지 않는다(unproven 이 섞였다)', () => {
    const r = preflightDelegation(
      input({ rangeAttribution: { tickets: ['REQ-2026-001'], unattributable: 3, unattributableAttested: 1, deliveries: [] } }),
    )
    expect(r.kind).toBe('blocked')
  })

  it('🔴 `unattributableAttested` 가 부재(모름)면 열리지 않는다 — 0 이 아니라 모름이다', () => {
    const r = preflightDelegation(
      input({ rangeAttribution: { tickets: ['REQ-2026-001'], unattributable: 1, deliveries: [] } }),
    )
    expect(r.kind).toBe('blocked')
  })

  for (const [label, over] of [
    ['hardCap 도달', { budgetHardCapReached: true }],
    ['미판정 리뷰', { reviewInconclusive: true }],
    ['strict 미통과', { evidenceOk: false }],
  ] as const) {
    it(`🔴 ${label} → 차단(ack 없음)`, () => {
      const r = preflightDelegation(input(over as Partial<PreflightInput>))
      expect(r.kind).toBe('blocked')
      if (r.kind !== 'blocked') return
      expect(ACK_FOR[r.reason]).toBeNull()
    })
  }

  it('🔴 같은 scope 에 살아 있는 위임이 이미 있으면 차단(ambiguous-active)', () => {
    const prior = serializeDelegationRow(candidate({ id: 'OLD' }))
    const r = preflightDelegation(input({ ledgerText: prior }))
    expect(r.kind).toBe('blocked')
    if (r.kind !== 'blocked') return
    expect(r.reason).toBe('ambiguous-active')
  })

  it('🔴 원장이 손상됐으면 차단(발급으로 덮지 않는다)', () => {
    const r = preflightDelegation(input({ ledgerText: '{쓰레기\n' }))
    expect(r.kind).toBe('blocked')
    if (r.kind !== 'blocked') return
    expect(r.reason).toBe('ledger-corrupt')
  })
})
