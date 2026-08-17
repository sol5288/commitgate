import { describe, it, expect } from 'vitest'
import {
  policyTargetIds,
  policyUnknownLines,
  resolveIntegrationPolicy,
  type AutoFacts,
  type PolicyUnknown,
} from '../../bin/integrate'
import type { UnattributableCommit } from '../../scripts/req/lib/range-attribution'

/**
 * REQ-2026-168 — 판정 불가의 **사유**를 사실대로 말한다.
 *
 * 🔴 **소비자 리포트(meallo)**: delivery 묶음을 쓰지 않는(디렉터리 자체가 없는) 저장소에서
 *    `integrate` 가 *"묶음(delivery) 레코드를 읽지 못해 …"* 로 막혔다. 실제 사유는 범위에 들어 있던
 *    **attested 커밋 1건**이었다. 없는 묶음의 레코드를 만들 수 없으니 **실행 불가능한 안내**였다.
 *
 * 🔴 **거부 자체는 옳다.** 이 파일은 통과/차단을 바꾸지 않는다 — 바뀌는 것은 **왜 막혔는가**뿐이다.
 */

const commit = (over: Partial<UnattributableCommit> = {}): UnattributableCommit => ({
  sha: 'abc12345def',
  subject: 'chore(commitgate): 런타임을 0.25.2 로 올림',
  why: 'attested(정식 리뷰 없이 예외 승인된 커밋) — 자율 통합 대상이 아니다',
  category: 'attested',
  ...over,
})

const FACTS: AutoFacts = {
  riskLevel: 'LOW',
  budgetHardCapReached: false,
  reviewInconclusive: false,
  deliveryMembers: null,
  compositionChanged: false,
  memberPolicies: [{ id: 'REQ-2026-266', snapshotStopGate: 'auto', stateUnreadable: false }],
  policyUnknown: null,
}

const linesOf = (unknown: PolicyUnknown): string => {
  const p = resolveIntegrationPolicy({ ...FACTS, policyUnknown: unknown }, 'auto')
  expect(p.kind).toBe('indeterminate')
  return p.kind === 'indeterminate' ? p.lines.join('\n') : ''
}

describe('[integrate] 🔴 G3 — 묶음을 쓰지 않으면 묶음을 조회조차 하지 않는다', () => {
  it('🔴 리포트 재현: 귀속 불가만 있고 delivery 는 없다 → deliveryMembersOf 가 호출되지 않는다', () => {
    // 호출되면 실패하도록 던진다 — "조회하지 않는다"를 말이 아니라 동작으로 고정한다.
    const boom = (): string[] | null => {
      throw new Error('deliveryMembersOf 가 호출되면 안 된다')
    }
    const r = policyTargetIds(
      { tickets: ['REQ-2026-266'], deliveries: [], unattributableCommits: [commit()] },
      { kind: 'ticket', req_id: 'REQ-2026-266' },
      boom,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.unknown.reason).toBe('unattributable')
  })
})

describe('[integrate] 🔴 G1 — 귀속 불가 안내가 사실을 말한다', () => {
  const body = linesOf({ reason: 'unattributable', commits: [commit()] })

  it('🔴 delivery 를 지목하지 않는다 — 이것이 리포트의 결함이었다', () => {
    expect(body).not.toContain('delivery')
    expect(body).not.toContain('묶음')
  })

  it('막은 커밋의 SHA·범주·제목을 나열한다', () => {
    expect(body).toContain('abc12345')
    expect(body).toContain('attested')
    expect(body).toContain('런타임을 0.25.2 로 올림')
  })

  it('🔴 attested 가 왜 자율 통합 대상이 아닌지 말한다(의도된 설계)', () => {
    expect(body).toContain('의도적으로')
  })

  it('있는 탈출구를 감추지 않는다 — 대화형 확인 안내는 남는다', () => {
    expect(body).toContain('대화형')
  })

  it('🔴 attested 가 아닌 사유에는 attested 설명을 붙이지 않는다', () => {
    const other = linesOf({
      reason: 'unattributable',
      commits: [commit({ category: 'unproven', why: 'unproven — 승인 증거로 귀속을 판정할 수 없다' })],
    })
    expect(other).toContain('unproven')
    expect(other).not.toContain('의도적으로')
  })

  it('🔴 잘라낸 커밋 수를 숨기지 않는다 — 조용한 절단은 "전부 봤다"로 읽힌다', () => {
    const many = Array.from({ length: 9 }, (_, i) => commit({ sha: `sha${i}0000000` }))
    const body9 = linesOf({ reason: 'unattributable', commits: many })
    expect(body9).toContain('9건')
    expect(body9).toContain('외 4건')
  })
})

describe('[integrate] 🔴 G2 — 묶음 안내는 실제로 그럴 때만 나온다', () => {
  const body = linesOf({ reason: 'delivery-unreadable', slug: 'payment' })

  it('슬러그를 이름으로 말한다 — 어느 레코드인지 알 수 있다', () => {
    expect(body).toContain('payment')
    expect(body).toContain('delivery/payment.json')
  })

  it('레코드를 커밋하라는 안내는 이때만 나온다', () => {
    expect(body).toContain('레코드를 커밋한 뒤 다시 실행하세요')
    // 반대 방향: 귀속 불가 사유에는 그 안내가 없다.
    expect(linesOf({ reason: 'unattributable', commits: [commit()] })).not.toContain('레코드를 커밋한 뒤')
  })
})

describe('[integrate] 판정 자체는 바뀌지 않았다(무회귀)', () => {
  it('🔴 사유가 무엇이든 indeterminate 다 — 해상도만 올렸다', () => {
    for (const u of [
      { reason: 'unattributable', commits: [commit()] },
      { reason: 'delivery-unreadable', slug: 's' },
    ] as PolicyUnknown[])
      expect(resolveIntegrationPolicy({ ...FACTS, policyUnknown: u }, 'auto').kind).toBe('indeterminate')
  })

  it('policyUnknown 이 null 이면 정상 판정으로 간다(대조군 — 오라클이 공허하지 않다)', () => {
    expect(resolveIntegrationPolicy(FACTS, 'auto').kind).not.toBe('indeterminate')
  })

  it('policyUnknownLines 는 순수하다 — 같은 입력에 같은 출력', () => {
    const u: PolicyUnknown = { reason: 'unattributable', commits: [commit()] }
    expect(policyUnknownLines(u)).toEqual(policyUnknownLines(u))
  })
})
