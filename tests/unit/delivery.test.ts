import { describe, it, expect } from 'vitest'
import {
  DELIVERY_SCHEMA_VERSION,
  REQUIRED_RECORD_KEYS,
  OPTIONAL_MEMBER_KEYS,
  deliveryRecordProblems,
  serializeDeliveryRecord,
  activeMember,
  canBegin,
  canApprove,
  isTerminal,
  allMembersTerminal,
  deliveryGateVerdict,
  integrateTopologyProblems,
  newDeliveryRecord,
  nextOrder,
  type DeliveryRecord,
  type DeliveryMember,
  type SupersededEvidence,
} from '../../scripts/req/lib/delivery'

/**
 * REQ-2026-066 phase-1 — delivery set 순수 모델(설계 DEC-2c·DEC-4·DEC-6·DEC-8a).
 *
 * 🔴 이 파일의 헤드라인 단언 셋:
 *   1. **종결 판정은 재귀**다 — 순환과 `superseded`만의 체인을 terminal로 오인하면 묶음이
 *      끝나지 않았는데 통합 게이트가 뜬다.
 *   2. **닫힌 묶음에는 member를 못 넣는다** — 활성 member 유무만 보면 빈 묶음을 seal한 뒤
 *      `begin`이 통과해 "사용자가 닫는다"가 무너진다.
 *   3. **게이트 판정은 단일 함수**다 — 네 호출처가 각자 판정하면 갈라진다.
 */

const EVIDENCE: SupersededEvidence = {
  feature_ref: 'refs/heads/feat/req-2026-001-a',
  feature_head_sha: 'a'.repeat(40),
  close_proof_row: '{"event":"series-terminal"}',
  close_proof_blob_sha: 'b'.repeat(40),
  close_proof_row_sha: 'c'.repeat(40),
  verified_at: '2026-07-26T00:00:00.000Z',
  resolution: 'replace',
}

function member(over: Partial<DeliveryMember> & { req_id: string; order: number }): DeliveryMember {
  return {
    delivery_base_sha: 'd'.repeat(40),
    status: 'active',
    successor_of: null,
    integrated_at: null,
    superseded_evidence: null,
    ...over,
  }
}

function record(over: Partial<DeliveryRecord> = {}): DeliveryRecord {
  return {
    ...newDeliveryRecord({ slug: 'payment', branch: 'delivery/payment', targetBranch: 'main', at: '2026-07-26T00:00:00.000Z' }),
    ...over,
  }
}

describe('[delivery] 레코드 검증 — 손상을 조용히 넘기지 않는다(DEC-4)', () => {
  it('새 레코드는 검증을 통과한다', () => {
    expect(deliveryRecordProblems(record())).toEqual([])
    expect(record().schema_version).toBe(DELIVERY_SCHEMA_VERSION)
  })

  it('필수 키 누락 거부', () => {
    for (const k of REQUIRED_RECORD_KEYS) {
      const r = { ...record() } as Record<string, unknown>
      delete r[k]
      expect(deliveryRecordProblems(r)).toContain(`필수 키 누락: ${k}`)
    }
  })

  it('알 수 없는 키 거부(오염 방어)', () => {
    expect(deliveryRecordProblems({ ...record(), injected: 1 })).toContain('알 수 없는 키: injected')
  })

  // 🔴 REQ-2026-064가 원장에서 겪은 함정을 반복하지 않는다: 선택 키는 **없어도 통과**한다.
  it('🔴 member의 선택 키가 없어도 통과한다(옛 레코드 하위호환)', () => {
    const bare = { req_id: 'REQ-2026-001', order: 1, delivery_base_sha: 'd'.repeat(40), status: 'active' }
    expect(deliveryRecordProblems(record({ members: [bare as never] }))).toEqual([])
    for (const k of OPTIONAL_MEMBER_KEYS) expect(Object.prototype.hasOwnProperty.call(bare, k)).toBe(false)
  })

  it('선택 키가 있는데 타입이 틀리면 거부', () => {
    const bad = { req_id: 'R', order: 1, delivery_base_sha: 'x', status: 'active', successor_of: 42 }
    expect(deliveryRecordProblems(record({ members: [bad as never] })).length).toBeGreaterThan(0)
  })

  // 🔴 증거 없는 superseded 는 감사 불가다(DEC-5).
  it('🔴 superseded 인데 증거가 없으면 손상으로 본다', () => {
    const m = member({ req_id: 'R1', order: 1, status: 'superseded' })
    expect(deliveryRecordProblems(record({ members: [m] }))).toContain('members[0]는 superseded인데 superseded_evidence가 없음')
  })

  it('중복 req_id·order 거부', () => {
    const ms = [member({ req_id: 'R1', order: 1 }), member({ req_id: 'R1', order: 1 })]
    const p = deliveryRecordProblems(record({ members: ms }))
    expect(p).toContain('members에 중복 req_id: R1')
    expect(p).toContain('members에 중복 order: 1')
  })

  it('schema_version 불일치 거부', () => {
    expect(deliveryRecordProblems({ ...record(), schema_version: 99 }).length).toBeGreaterThan(0)
  })

  it('직렬화 결과가 스스로의 검증을 통과한다(round-trip)', () => {
    const out = serializeDeliveryRecord(record())
    expect(out.endsWith('\n')).toBe(true)
    expect(deliveryRecordProblems(JSON.parse(out))).toEqual([])
  })
})

describe('[delivery] canBegin — 열린 묶음 + 활성 member 없음(DEC-2c)', () => {
  it('빈 열린 묶음에서 가능', () => {
    expect(canBegin(record()).ok).toBe(true)
  })

  it('활성 member가 있으면 거부(순차 불변식)', () => {
    const v = canBegin(record({ members: [member({ req_id: 'R1', order: 1 })] }))
    expect(v.ok).toBe(false)
    expect(v.reason).toContain('R1')
  })

  /**
   * 🔴 활성 member 유무만 보면 **빈 묶음을 seal한 뒤 begin이 통과**한다 —
   * "사용자가 묶음을 닫는다"와 "닫힌 전체에 대해 통합 직전 정지"가 동시에 무너진다.
   */
  it('🔴 sealed 묶음에는 활성 member가 없어도 추가할 수 없다', () => {
    const v = canBegin(record({ state: 'sealed' }))
    expect(v.ok).toBe(false)
    expect(v.reason).toContain('reopen')
  })

  it('🔴 approved 묶음에도 추가할 수 없다(승인 내용이 사후에 바뀌면 안 된다)', () => {
    expect(canBegin(record({ state: 'approved' })).ok).toBe(false)
  })

  it('integrated 만 있는 열린 묶음에서는 가능', () => {
    const ms = [member({ req_id: 'R1', order: 1, status: 'integrated', integrated_at: 'x' })]
    expect(canBegin(record({ members: ms })).ok).toBe(true)
  })
})

describe('[delivery] isTerminal — 재귀 판정(DEC-6)', () => {
  it('integrated 는 terminal', () => {
    const r = record({ members: [member({ req_id: 'R1', order: 1, status: 'integrated' })] })
    expect(isTerminal(r, 'R1')).toBe(true)
  })

  it('active 는 terminal 이 아니다', () => {
    expect(isTerminal(record({ members: [member({ req_id: 'R1', order: 1 })] }), 'R1')).toBe(false)
  })

  it('정상 체인: superseded → integrated successor', () => {
    const r = record({
      members: [
        member({ req_id: 'R1', order: 1, status: 'superseded', superseded_evidence: EVIDENCE }),
        member({ req_id: 'R2', order: 2, status: 'integrated', successor_of: 'R1' }),
      ],
    })
    expect(isTerminal(r, 'R1')).toBe(true)
    expect(allMembersTerminal(r)).toBe(true)
  })

  // 🔴 "successor가 있다"만 보면 이것이 통과한다 — 묶음이 영원히 안 끝나는데 게이트가 뜬다.
  it('🔴 superseded 만 이어지는 체인은 terminal 이 아니다', () => {
    const r = record({
      members: [
        member({ req_id: 'R1', order: 1, status: 'superseded', superseded_evidence: EVIDENCE }),
        member({ req_id: 'R2', order: 2, status: 'superseded', successor_of: 'R1', superseded_evidence: EVIDENCE }),
      ],
    })
    expect(isTerminal(r, 'R1')).toBe(false)
    expect(allMembersTerminal(r)).toBe(false)
  })

  // 🔴 순환은 무한 재귀가 아니라 **거부**여야 한다.
  it('🔴 순환(R1→R2→R1)은 terminal 이 아니다(무한 재귀도 아니다)', () => {
    const r = record({
      members: [
        member({ req_id: 'R1', order: 1, status: 'superseded', successor_of: 'R2', superseded_evidence: EVIDENCE }),
        member({ req_id: 'R2', order: 2, status: 'superseded', successor_of: 'R1', superseded_evidence: EVIDENCE }),
      ],
    })
    expect(isTerminal(r, 'R1')).toBe(false)
    expect(isTerminal(r, 'R2')).toBe(false)
  })

  it('🔴 successor가 2개면 모호 — terminal 이 아니다', () => {
    const r = record({
      members: [
        member({ req_id: 'R1', order: 1, status: 'superseded', superseded_evidence: EVIDENCE }),
        member({ req_id: 'R2', order: 2, status: 'integrated', successor_of: 'R1' }),
        member({ req_id: 'R3', order: 3, status: 'integrated', successor_of: 'R1' }),
      ],
    })
    expect(isTerminal(r, 'R1')).toBe(false)
  })

  it('🔴 successor의 order가 앞서면 terminal 이 아니다(체인 방향)', () => {
    const r = record({
      members: [
        member({ req_id: 'R1', order: 2, status: 'superseded', superseded_evidence: EVIDENCE }),
        member({ req_id: 'R2', order: 1, status: 'integrated', successor_of: 'R1' }),
      ],
    })
    expect(isTerminal(r, 'R1')).toBe(false)
  })

  it('successor가 없는 superseded 는 terminal 이 아니다', () => {
    const r = record({ members: [member({ req_id: 'R1', order: 1, status: 'superseded', superseded_evidence: EVIDENCE })] })
    expect(isTerminal(r, 'R1')).toBe(false)
  })

  it('3단 체인도 leaf가 integrated 면 통과한다', () => {
    const r = record({
      members: [
        member({ req_id: 'R1', order: 1, status: 'superseded', superseded_evidence: EVIDENCE }),
        member({ req_id: 'R2', order: 2, status: 'superseded', successor_of: 'R1', superseded_evidence: EVIDENCE }),
        member({ req_id: 'R3', order: 3, status: 'integrated', successor_of: 'R2' }),
      ],
    })
    expect(allMembersTerminal(r)).toBe(true)
  })
})

describe('[delivery] deliveryGateVerdict — 단일 SSOT(DEC-8a)', () => {
  const done = () => record({ state: 'sealed', members: [member({ req_id: 'R1', order: 1, status: 'integrated' })] })

  it('open 이면 continue(다음 REQ를 열 수 있다)', () => {
    expect(deliveryGateVerdict(record()).kind).toBe('continue')
  })

  it('sealed 인데 미종결 member가 있으면 continue + 누가 남았는지 알려 준다', () => {
    const r = record({ state: 'sealed', members: [member({ req_id: 'R1', order: 1 })] })
    const v = deliveryGateVerdict(r)
    expect(v.kind).toBe('continue')
    expect(v.detail).toContain('R1')
  })

  it('🔴 sealed + 전부 종결이면 await-human(통합 정지)', () => {
    const v = deliveryGateVerdict(done())
    expect(v.kind).toBe('await-human')
    expect(v.detail).toContain('delivery/payment → main')
    expect(v.detail).toContain('I1/I2/B1')
  })

  it('이미 approved 면 다시 멈추지 않는다', () => {
    expect(deliveryGateVerdict({ ...done(), state: 'approved' }).kind).toBe('continue')
  })

  it('빈 sealed 묶음도 await-human(member 0건은 종결로 본다 — seal 판단은 사용자 몫)', () => {
    expect(deliveryGateVerdict(record({ state: 'sealed' })).kind).toBe('await-human')
  })
})

describe('[delivery] canApprove — sealed && 전부 종결(DEC-8)', () => {
  it('open 이면 거부', () => {
    expect(canApprove(record()).ok).toBe(false)
  })

  it('sealed 인데 미종결이면 거부 + 누가 남았는지', () => {
    const v = canApprove(record({ state: 'sealed', members: [member({ req_id: 'R1', order: 1 })] }))
    expect(v.ok).toBe(false)
    expect(v.reason).toContain('R1')
  })

  it('sealed + 전부 종결이면 허용', () => {
    const r = record({ state: 'sealed', members: [member({ req_id: 'R1', order: 1, status: 'integrated' })] })
    expect(canApprove(r).ok).toBe(true)
  })

  it('이미 approved 면 거부(중복 승인 금지)', () => {
    expect(canApprove(record({ state: 'approved' })).ok).toBe(false)
  })
})

describe('[delivery] integrateTopologyProblems — 위상 전제(DEC-2)', () => {
  const ok = {
    memberBaseSha: 'a'.repeat(40),
    deliveryHeadSha: 'a'.repeat(40),
    deliveryIsAncestorOfFeature: true,
    worktreeClean: true,
    noMergeInProgress: true,
  }

  it('정상이면 문제 없음', () => {
    expect(integrateTopologyProblems(ok)).toEqual([])
  })

  it('base 불일치 거부(순차 전제가 깨졌다)', () => {
    expect(integrateTopologyProblems({ ...ok, deliveryHeadSha: 'b'.repeat(40) }).length).toBe(1)
  })

  // 🔴 자동 rebase·충돌 해결은 하지 않는다 — 충돌 해결은 재검수 없는 새 코드다.
  it('🔴 조상이 아니면 거부하고 자동 해결을 시사하지 않는다', () => {
    const p = integrateTopologyProblems({ ...ok, deliveryIsAncestorOfFeature: false })
    expect(p).toHaveLength(1)
    expect(p[0]).toContain('자동 rebase·충돌 해결은 하지 않습니다')
  })

  it('dirty 트리·진행 중 merge 거부', () => {
    expect(integrateTopologyProblems({ ...ok, worktreeClean: false })).toHaveLength(1)
    expect(integrateTopologyProblems({ ...ok, noMergeInProgress: false })).toHaveLength(1)
  })
})

describe('[delivery] 보조', () => {
  it('activeMember / nextOrder', () => {
    const r = record({
      members: [member({ req_id: 'R1', order: 1, status: 'integrated' }), member({ req_id: 'R2', order: 2 })],
    })
    expect(activeMember(r)?.req_id).toBe('R2')
    expect(nextOrder(r)).toBe(3)
    expect(nextOrder(record())).toBe(1)
  })

  it('newDeliveryRecord 는 created 이벤트를 남긴다', () => {
    const r = newDeliveryRecord({ slug: 's', branch: 'delivery/s', targetBranch: 'main', at: 'T' })
    expect(r.state).toBe('open')
    expect(r.events).toEqual([{ event: 'created', at: 'T', confirmation: null }])
  })
})
