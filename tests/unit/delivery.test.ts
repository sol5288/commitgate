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
  postApprovalRevListArgs,
  parseRevList,
  deliverySlugOfBranch,
  deliveryApprovalBlock,
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
    feature_ref: null,
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

  /**
   * REQ-2026-130 — 승인은 **그 시점 묶음 내용**에 결속된다. 승인 뒤 레코드 밖을 건드린 커밋이 들어오면
   * 병합될 것은 승인받은 것과 다르다.
   */
  describe('승인 staleness(REQ-2026-130)', () => {
    const approved = () => ({ ...done(), state: 'approved' as const, approval: { base_sha: 'a'.repeat(40), at: 'T' } })

    it('🔴 승인 이후 레코드 밖 커밋이 있으면 다시 await-human(재승인)', () => {
      const v = deliveryGateVerdict(approved(), { postApprovalCommits: ['c'.repeat(40)] })
      expect(v.kind).toBe('await-human')
      expect(v.detail).toContain('delivery approve')
      expect(v.detail).toContain('cccccccc')
    })

    /**
     * 🔴 **자기 무효화 회귀 가드**(설계 r01 P1). `approve`는 레코드 커밋을 하나 더 만든다. 그 커밋을
     *    staleness로 세면 방금 받은 승인이 즉시 무효가 되고 재승인도 같은 일을 반복해 **정상 경로가
     *    완료 불가**가 된다. 호출부가 레코드 경로를 exclude하므로 여기 목록은 비어 있어야 한다.
     */
    it('🔴 레코드 밖 커밋이 없으면 continue — 승인이 자기 자신을 무효화하지 않는다', () => {
      expect(deliveryGateVerdict(approved(), { postApprovalCommits: [] }).kind).toBe('continue')
    })

    it('🔴 판정 불가(null)는 "달라졌다"가 아니다 — git 실패로 승인이 무효가 되면 안 된다', () => {
      expect(deliveryGateVerdict(approved(), { postApprovalCommits: null }).kind).toBe('continue')
      expect(deliveryGateVerdict(approved(), {}).kind).toBe('continue')
    })

    it('결속이 없는 옛 레코드는 커밋이 있어도 continue(무회귀 — 소급 요구 금지)', () => {
      const legacy = { ...done(), state: 'approved' as const }
      expect(deliveryGateVerdict(legacy, { postApprovalCommits: ['c'.repeat(40)] }).kind).toBe('continue')
    })

    it('ctx 를 주지 않는 기존 호출부는 현행 그대로다', () => {
      expect(deliveryGateVerdict(approved()).kind).toBe('continue')
    })
  })

  it('빈 sealed 묶음도 await-human(member 0건은 종결로 본다 — seal 판단은 사용자 몫)', () => {
    expect(deliveryGateVerdict(record({ state: 'sealed' })).kind).toBe('await-human')
  })
})

describe('[delivery] postApprovalRevListArgs — 판정 명령의 SSOT(REQ-2026-130)', () => {
  it('결속이 없으면 null(판정 대상 아님)', () => {
    expect(postApprovalRevListArgs(record({ state: 'approved' }), 'workflow')).toBeNull()
  })

  /**
   * 🔴 `:(exclude)` 가 빠지면 승인 레코드 커밋이 목록에 들어와 승인이 즉시 자기 자신을 무효화한다.
   *    인자를 리터럴로 고정한다(expected 를 SUT 로 구성하지 않는다).
   */
  it('🔴 레코드 경로를 제외한 rev-list 인자를 만든다', () => {
    const r = { ...record({ state: 'approved' }), approval: { base_sha: 'b'.repeat(40), at: 'T' } }
    expect(postApprovalRevListArgs(r, 'workflow')).toEqual([
      'rev-list',
      `${'b'.repeat(40)}..delivery/payment`,
      '--',
      ':(exclude)workflow/delivery/*',
    ])
  })

  it('parseRevList 는 공백·빈 줄을 버린다', () => {
    expect(parseRevList('aaa\n\n  bbb  \n')).toEqual(['aaa', 'bbb'])
  })
})

describe('[delivery] deliverySlugOfBranch', () => {
  it('delivery 브랜치에서만 slug 를 낸다', () => {
    expect(deliverySlugOfBranch('delivery/payment')).toBe('payment')
    expect(deliverySlugOfBranch('feat/req-2026-130-x')).toBeNull()
    expect(deliverySlugOfBranch('delivery/')).toBeNull()
  })
})

/**
 * REQ-2026-130 DEC-4 — `commitgate integrate` 차단 사유. 안내 층과 **같은 함수**로 판정하되 막는다.
 */
describe('[delivery] deliveryApprovalBlock — 병합 차단', () => {
  const approvedRec = () => ({
    ...record({ state: 'approved', members: [member({ req_id: 'R1', order: 1, status: 'integrated' })] }),
    approval: { base_sha: 'b'.repeat(40), at: 'T' },
  })
  const fakeGit = (recordJson: string | null, postCommits: string[]) => (args: string[]): string => {
    if (args[0] === 'show') {
      if (recordJson === null) throw new Error('no such path')
      return recordJson
    }
    if (args[0] === 'rev-list') return postCommits.join('\n')
    throw new Error(`unexpected git ${args.join(' ')}`)
  }

  it('delivery 브랜치가 아니거나 레코드가 없으면 막지 않는다', () => {
    expect(deliveryApprovalBlock('feat/x', 'workflow', fakeGit(null, []))).toBeNull()
    expect(deliveryApprovalBlock('delivery/payment', 'workflow', fakeGit(null, []))).toBeNull()
  })

  it('🔴 승인 이후 레코드 밖 커밋이 있으면 막고, 실행 가능한 재승인 순서를 안내한다', () => {
    const blocked = deliveryApprovalBlock('delivery/payment', 'workflow', fakeGit(JSON.stringify(approvedRec()), ['c'.repeat(40)]))
    expect(blocked).toContain('delivery reopen')
    expect(blocked).toContain('delivery approve')
  })

  it('승인 이후 변경이 없으면 통과한다', () => {
    expect(deliveryApprovalBlock('delivery/payment', 'workflow', fakeGit(JSON.stringify(approvedRec()), []))).toBeNull()
  })

  it('🔴 레코드가 손상됐으면 막는다(fail-closed)', () => {
    expect(deliveryApprovalBlock('delivery/payment', 'workflow', fakeGit(JSON.stringify({ slug: 'payment' }), []))).toContain('손상')
  })

  /**
   * 🔴 r01 P1-b: 읽기 실패(=파일 없음)와 파싱 실패는 다르다. 한 `try` 로 묶으면 깨진 JSON 이
   *    "관리되는 묶음이 아님"으로 흡수돼 그대로 병합된다.
   */
  it('🔴 JSON 이 깨졌으면 "레코드 없음"이 아니라 차단이다', () => {
    expect(deliveryApprovalBlock('delivery/payment', 'workflow', fakeGit('{not json', []))).toContain('파싱 실패')
  })

  /**
   * 🔴 r01 P1-a: `deliveryGateVerdict` 의 `continue` 에는 `open` 과 "sealed인데 member 남음"도 있다.
   *    그것을 통과로 읽으면 **한 번도 승인되지 않은 묶음**이 병합된다. 질문은 "게이트가 조용한가"가
   *    아니라 "이 병합이 인가됐는가"다.
   */
  it('🔴 승인되지 않은 묶음은 막는다(open · sealed-미종결)', () => {
    const open = record({ state: 'open', members: [member({ req_id: 'R1', order: 1 })] })
    expect(deliveryApprovalBlock('delivery/payment', 'workflow', fakeGit(JSON.stringify(open), []))).toContain('승인되지 않았습니다')
    const sealedPending = record({ state: 'sealed', members: [member({ req_id: 'R1', order: 1 })] })
    expect(deliveryApprovalBlock('delivery/payment', 'workflow', fakeGit(JSON.stringify(sealedPending), []))).toContain(
      '승인되지 않았습니다',
    )
  })

  /** 결속이 없는 옛 approved 레코드는 통과한다(무회귀 — 소급 요구 금지). */
  it('legacy approved(결속 없음)는 통과한다', () => {
    const legacy = record({ state: 'approved', members: [member({ req_id: 'R1', order: 1, status: 'integrated' })] })
    expect(deliveryApprovalBlock('delivery/payment', 'workflow', fakeGit(JSON.stringify(legacy), []))).toBeNull()
  })

  /**
   * 🔴 r02 P1-a: **차단 지점에서는 "확인 불가"가 "통과"가 아니다.** `base_sha` 를 없는 SHA 로 손상시키면
   *    `rev-list` 가 실패하는데, 그것을 통과로 읽으면 손상이 곧 우회 수단이 된다.
   *    (안내 지점은 반대로 무판정이 옳다 — 위 `deliveryGateVerdict` 테스트가 그것을 고정한다.)
   */
  it('🔴 승인 결속을 확인할 수 없으면 막는다', () => {
    const g = (args: string[]): string => {
      if (args[0] === 'show') return JSON.stringify(approvedRec())
      throw new Error('fatal: bad revision')
    }
    expect(deliveryApprovalBlock('delivery/payment', 'workflow', g)).toContain('확인할 수 없습니다')
  })

  /**
   * 🔴 r02 P1-b: 레코드가 자기 브랜치를 다르게 선언하면 staleness 조회가 **엉뚱한 범위**를 본다.
   *    payment 레코드의 branch 를 other 로 바꾸면 빈 범위가 나와 미승인 tip 이 통과한다.
   */
  it('🔴 레코드 branch 가 병합 소스와 다르면 막는다', () => {
    const wrong = { ...approvedRec(), branch: 'delivery/other' }
    expect(deliveryApprovalBlock('delivery/payment', 'workflow', fakeGit(JSON.stringify(wrong), []))).toContain('다릅니다')
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
    deliveryHeadSha: 'b'.repeat(40),
    deliveryDivergedOnlyByRecord: true,
    deliveryNonRecordPaths: [],
    featureChangedRecordPaths: [],
    baseIsAncestorOfDeliveryHead: true,
    worktreeClean: true,
    noMergeInProgress: true,
  }

  it('정상이면 문제 없음', () => {
    expect(integrateTopologyProblems(ok)).toEqual([])
  })

  /**
   * 🔴 design r07 P1: delivery 쪽만 보면 무충돌이 아니다. delivery 는 member 등록으로 레코드를 바꾸고,
   * feature 가 분기 시점 사본을 편집하면 **정확히 그 파일에서** 병합 충돌이 난다.
   */
  it('🔴 feature 가 delivery 레코드를 수정했으면 거부', () => {
    const p = integrateTopologyProblems({ ...ok, featureChangedRecordPaths: ['workflow/delivery/payment.json'] })
    expect(p.some((x) => x.includes('delivery 레코드를 수정'))).toBe(true)
    // 삭제 유도 금지 — delete/modify 충돌이라 같은 문제다.
    expect(p.some((x) => x.includes('삭제하지 마세요'))).toBe(true)
  })

  /**
   * 🔴 design r02 정정의 회귀 가드. 초안은 `base === delivery HEAD`를 요구했는데, `begin`이 member 레코드를
   * delivery에 커밋해야 하므로 그 커밋이 delivery HEAD를 base 너머로 민다 — 동일성과 조상 관계는 **동시에
   * 성립할 수 없었고**, 그 조건이 정상 경로를 막았다. 실측: base=c16a04b · delivery HEAD=274aa86 · ancestry=YES.
   */
  it('🔴 base와 delivery HEAD가 달라도, 이력 선상이면 통과한다(동일성을 요구하지 않는다)', () => {
    expect(integrateTopologyProblems({ ...ok, memberBaseSha: 'a'.repeat(40), deliveryHeadSha: 'c'.repeat(40) })).toEqual([])
  })

  it('base가 delivery HEAD의 이력 선상에 없으면 거부(손으로 고친 레코드)', () => {
    const p = integrateTopologyProblems({ ...ok, baseIsAncestorOfDeliveryHead: false })
    expect(p).toHaveLength(1)
    expect(p[0]).toContain('이력 선상에 없습니다')
  })

  /**
   * 🔴 design r03 회귀 가드 — 무충돌 보장의 실제 조건.
   * 분기 이후 delivery에서 **레코드 외** 변경이 있었다면 코드가 움직였다는 뜻이고, 그때는 거부한다.
   * (ancestry는 이 성질의 충분조건일 뿐이었고 membership 기록과 양립 불가였다.)
   */
  it('🔴 delivery에 레코드 외 변경이 있으면 거부하고 자동 해결을 시사하지 않는다', () => {
    const p = integrateTopologyProblems({
      ...ok,
      deliveryDivergedOnlyByRecord: false,
      deliveryNonRecordPaths: ['src/app.ts'],
    })
    expect(p).toHaveLength(1)
    expect(p[0]).toContain('src/app.ts')
    expect(p[0]).toContain('자동 rebase·충돌 해결은 하지 않습니다')
  })

  it('레코드 파일만 움직였으면 통과한다(begin 이 member 를 기록한 정상 경로)', () => {
    expect(integrateTopologyProblems({ ...ok, deliveryDivergedOnlyByRecord: true })).toEqual([])
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
