import { describe, it, expect } from 'vitest'
import {
  DELEGATION_DENY_REASONS,
  DENY_GUIDANCE,
  delegationVerdict,
  foldDelegations,
  missingPermissions,
  parseDelegationLedger,
  parseInstantMs,
  scopeRangeProblem,
  type DelegationCheckInput,
  type DelegationDenyReason,
  type DelegationIssued,
  type DelegationPermissions,
  type DelegationRow,
} from '../../scripts/req/lib/delegation'

/**
 * REQ-2026-140 phase-2 — 위임 레코드 모델(순수).
 *
 * 🔴 **이 파일의 오라클은 "각 거부 사유가 실제로 발화하는가" 다.** 사유를 선언만 하고 도달 불가로
 *    두면 그 위험 축은 **막히지 않은 채 목록에만 있다** — 이 저장소가 D-체크에서 겪은 "죽은 항목"과
 *    같은 실패다. 그래서 등록부를 순회하며 **전수** 확인한다.
 */

const PERMS = (over: Partial<DelegationPermissions> = {}): DelegationPermissions => ({
  local_merge: true,
  origin_push: false,
  bypass_protection: false,
  ...over,
})

const ISSUED = (over: Partial<DelegationIssued> = {}): DelegationIssued => ({
  kind: 'issued',
  id: 'D1',
  at: '2026-08-13T00:00:00.000Z',
  scope: { kind: 'ticket', req_id: 'REQ-2026-140' },
  trunk_branch: 'main',
  trunk_sha: 'a'.repeat(40),
  source_branch: 'feat/x',
  base_sha: 'b'.repeat(40),
  expires_at: '2026-08-14T00:00:00.000Z',
  permissions: PERMS(),
  high_risk_ack: false,
  approval_sentence: '통합 승인합니다',
  ...over,
})

const ledger = (...rows: DelegationRow[]): string => rows.map((r) => JSON.stringify(r)).join('\n') + '\n'

/** 모든 항이 통과하는 기준 입력. 각 테스트는 **한 축만** 틀어서 그 사유를 만든다. */
const BASE = (over: Partial<DelegationCheckInput> = {}): DelegationCheckInput => ({
  ledgerText: ledger(ISSUED()),
  scope: { kind: 'ticket', req_id: 'REQ-2026-140' },
  now: '2026-08-13T12:00:00.000Z',
  trunkBranch: 'main',
  trunkSha: 'a'.repeat(40),
  sourceBranch: 'feat/x',
  requested: PERMS(),
  riskLevel: 'LOW',
  budgetHardCapReached: false,
  reviewInconclusive: false,
  evidenceOk: true,
  rangeAttribution: { tickets: ['REQ-2026-140'], unattributable: 0 },
  deliveryMembers: null,
  compositionChanged: false,
  ...over,
})

describe('[REQ-2026-140] 기준 입력은 통과한다(오라클이 살아 있다)', () => {
  it('모든 항이 통과하면 ok 이고 발급 행을 돌려준다', () => {
    const v = delegationVerdict(BASE())
    expect(v.ok).toBe(true)
    if (v.ok) expect(v.row.id).toBe('D1')
  })

  /** 🔴 기준이 통과하지 않으면 아래 모든 "한 축만 틀었다"가 무의미해진다. */
  it('기준 입력이 통과하지 않으면 이 파일의 나머지가 무의미하다', () => {
    expect(delegationVerdict(BASE()).ok, '기준 입력이 이미 거부되고 있다').toBe(true)
  })
})

/**
 * 🔴 **전수 발화**. 등록부의 모든 사유가 실제 입력으로 재현된다.
 *    사유를 추가하고 여기에 입력을 안 만들면 이 테스트가 red 다(도달 불가 사유 방지).
 */
describe('[REQ-2026-140] 거부 사유 전수 — 각 사유가 실제로 발화한다', () => {
  const producers: Record<DelegationDenyReason, () => DelegationCheckInput> = {
    'ledger-corrupt': () => BASE({ ledgerText: '{"kind":"issued"\n' }),
    absent: () => BASE({ ledgerText: null }),
    'ambiguous-active': () => BASE({ ledgerText: ledger(ISSUED(), ISSUED({ id: 'D2' })) }),
    revoked: () =>
      BASE({ ledgerText: ledger(ISSUED(), { kind: 'revoked', id: 'D1', at: '2026-08-13T01:00:00.000Z', reason: 'r' }) }),
    consumed: () =>
      BASE({
        ledgerText: ledger(ISSUED(), {
          kind: 'consumed',
          id: 'D1',
          at: '2026-08-13T01:00:00.000Z',
          verified_sha: 'c'.repeat(40),
          performed: PERMS(),
          outcome: 'merged',
          detail: '',
        }),
      }),
    expired: () => BASE({ now: '2026-08-15T00:00:00.000Z' }),
    'trunk-branch-mismatch': () => BASE({ trunkBranch: 'release' }),
    'trunk-moved': () => BASE({ trunkSha: 'f'.repeat(40) }),
    'source-mismatch': () => BASE({ sourceBranch: 'feat/other' }),
    'scope-out-of-range': () =>
      BASE({ rangeAttribution: { tickets: ['REQ-2026-140', 'REQ-2026-141'], unattributable: 0 } }),
    'composition-changed': () => BASE({ compositionChanged: true }),
    'evidence-mismatch': () => BASE({ evidenceOk: false }),
    'high-risk-unacked': () => BASE({ riskLevel: 'HIGH' }),
    'budget-hardcap': () => BASE({ budgetHardCapReached: true }),
    'review-inconclusive': () => BASE({ reviewInconclusive: true }),
    'permission-denied': () => BASE({ requested: PERMS({ origin_push: true }) }),
  }

  it('등록부에 빠진 사유가 없다(입력을 안 만들면 red)', () => {
    expect(Object.keys(producers).sort()).toEqual([...DELEGATION_DENY_REASONS].sort())
  })

  for (const reason of DELEGATION_DENY_REASONS) {
    it(`${reason} 이 발화한다`, () => {
      const v = delegationVerdict((producers[reason] as () => DelegationCheckInput)())
      expect(v.ok).toBe(false)
      if (!v.ok) {
        expect(v.reason).toBe(reason)
        expect(v.detail.length).toBeGreaterThan(0)
      }
    })
  }

  it('모든 사유에 해소 안내가 있다', () => {
    for (const reason of DELEGATION_DENY_REASONS) {
      expect(DENY_GUIDANCE[reason], reason).toBeTruthy()
      expect(DENY_GUIDANCE[reason].length, reason).toBeGreaterThan(10)
    }
  })
})

/**
 * 🔴 설계 리뷰 r02 P1 — 이름과 SHA 는 **다른 것을 막는다.** 하나로 합치면
 *    `main` 과 `release` 가 같은 커밋을 가리키는 순간 이름 검사가 사라진다.
 */
describe('[REQ-2026-140] trunk 이름과 SHA 는 독립으로 발화한다', () => {
  it('같은 SHA · 다른 이름 → trunk-branch-mismatch (SHA 검사만으로는 못 잡는다)', () => {
    const v = delegationVerdict(BASE({ trunkBranch: 'release', trunkSha: 'a'.repeat(40) }))
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toBe('trunk-branch-mismatch')
  })

  it('같은 이름 · 다른 SHA → trunk-moved', () => {
    const v = delegationVerdict(BASE({ trunkBranch: 'main', trunkSha: '9'.repeat(40) }))
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toBe('trunk-moved')
  })
})

/**
 * 🔴 설계 리뷰 r02 P1(DEC-4a) — scope 가 **병합 범위를 실제로 제한**하는가.
 *    이 검사가 없으면 티켓 A 로 받은 위임이 같은 브랜치에 쌓인 B 까지 통합한다.
 */
describe('[REQ-2026-140 DEC-4a] scope 는 병합 범위를 제한한다', () => {
  it('범위가 위임 티켓뿐이면 통과', () => {
    expect(scopeRangeProblem({ kind: 'ticket', req_id: 'A' }, { tickets: ['A'], unattributable: 0 }, null)).toBeNull()
  })

  it('🔴 범위에 다른 티켓이 섞이면 거부하고 어느 티켓인지 말한다', () => {
    const p = scopeRangeProblem({ kind: 'ticket', req_id: 'A' }, { tickets: ['A', 'B'], unattributable: 0 }, null)
    expect(p).not.toBeNull()
    expect(p).toContain('B')
  })

  /** 🔴 차단 지점에서 "모르겠음"은 통과가 아니다. 한 건이면 충분하다. */
  it('🔴 귀속 판정 불가가 단 1건이어도 거부한다', () => {
    expect(scopeRangeProblem({ kind: 'ticket', req_id: 'A' }, { tickets: ['A'], unattributable: 1 }, null)).not.toBeNull()
  })

  it('delivery 는 멤버 집합 안이면 통과하고 밖이면 거부한다', () => {
    const scope = { kind: 'delivery', slug: 'S' } as const
    expect(scopeRangeProblem(scope, { tickets: ['A', 'B'], unattributable: 0 }, ['A', 'B'])).toBeNull()
    expect(scopeRangeProblem(scope, { tickets: ['A', 'C'], unattributable: 0 }, ['A', 'B'])).toContain('C')
  })

  it('🔴 delivery 멤버 목록을 못 읽으면 거부한다(빈 목록으로 취급하지 않는다)', () => {
    expect(scopeRangeProblem({ kind: 'delivery', slug: 'S' }, { tickets: [], unattributable: 0 }, null)).not.toBeNull()
  })
})

describe('[REQ-2026-140] 원장 파싱 — 손상은 통과하지 않는다', () => {
  it('빈 줄은 무시한다', () => {
    expect(parseDelegationLedger(`${JSON.stringify(ISSUED())}\n\n`).problems).toEqual([])
  })

  it('🔴 JSON 이 깨지면 problem 이다', () => {
    expect(parseDelegationLedger('{oops').problems.length).toBe(1)
  })

  it('🔴 미지의 kind 를 조용히 건너뛰지 않는다', () => {
    const p = parseDelegationLedger(JSON.stringify({ kind: 'granted', id: 'X' })).problems
    expect(p.length).toBe(1)
    expect(p[0]).toContain('granted')
  })

  it('🔴 필드가 빠진 issued 는 통과하지 않는다(부분 레코드로 권한이 생기지 않는다)', () => {
    const { permissions, ...noPerms } = ISSUED()
    expect(permissions).toBeTruthy()
    expect(parseDelegationLedger(JSON.stringify(noPerms)).problems.length).toBe(1)
  })

  it('🔴 permissions 가 boolean 이 아니면 거부한다(문자열 "false" 로 권한이 켜지지 않는다)', () => {
    const bad = { ...ISSUED(), permissions: { local_merge: 'true', origin_push: false, bypass_protection: false } }
    expect(parseDelegationLedger(JSON.stringify(bad)).problems.length).toBe(1)
  })
})

describe('[REQ-2026-140] fold — 종결 상태', () => {
  const scope = { kind: 'ticket', req_id: 'REQ-2026-140' } as const

  it('종결 행이 없으면 active', () => {
    const f = foldDelegations(parseDelegationLedger(ledger(ISSUED())).rows, scope)
    expect(f.active).toHaveLength(1)
    expect(f.terminated).toHaveLength(0)
  })

  it('id 가 다른 종결 행은 이 발급을 종결시키지 않는다', () => {
    const rows = parseDelegationLedger(
      ledger(ISSUED(), { kind: 'revoked', id: 'OTHER', at: '2026-08-13T01:00:00.000Z', reason: 'r' }),
    ).rows
    expect(foldDelegations(rows, scope).active).toHaveLength(1)
  })

  it('다른 scope 의 발급은 섞이지 않는다', () => {
    const rows = parseDelegationLedger(ledger(ISSUED({ id: 'D9', scope: { kind: 'delivery', slug: 'S' } }))).rows
    expect(foldDelegations(rows, scope).active).toHaveLength(0)
    expect(foldDelegations(rows, { kind: 'delivery', slug: 'S' }).active).toHaveLength(1)
  })
})

describe('[REQ-2026-140] 만료는 주입된 시각으로만 판정된다', () => {
  it('만료 직전은 통과, 만료 시각 이상은 거부(경계)', () => {
    const expires = '2026-08-14T00:00:00.000Z'
    expect(delegationVerdict(BASE({ now: '2026-08-13T23:59:59.999Z' })).ok).toBe(true)
    const at = delegationVerdict(BASE({ now: expires }))
    expect(at.ok).toBe(false)
    if (!at.ok) expect(at.reason).toBe('expired')
  })
})

/**
 * 🔴 phase-2 리뷰 r01 P1 — **손상된 시각이 만료 검사를 우회하던 fail-closed 구멍.**
 *
 * 예전에는 `now >= expires_at` 로 **사전순** 비교를 했다. 그래서:
 *  - `expires_at: "not-a-date"` → `"2026-…Z" >= "not-a-date"` 가 false → **만료가 영영 오지 않는다**
 *  - `+12:00` 오프셋 → 실제로는 지난 시각인데 사전순으로는 미래라 **살아 있는 것으로 읽힌다**
 *
 * 지금은 두 축으로 막는다: 파싱 단계에서 instant 가 아니면 **손상**이고, 비교는 **epoch ms 수치**다.
 */
describe('[REQ-2026-140] 시각 손상이 만료를 우회하지 못한다', () => {
  it('🔴 expires_at 이 시각이 아니면 원장 손상이다(무기한 유효가 아니다)', () => {
    const v = delegationVerdict(BASE({ ledgerText: ledger(ISSUED({ expires_at: 'not-a-date' } as never)) }))
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toBe('ledger-corrupt')
  })

  it('🔴 at·revoked.at 도 같은 검증을 받는다', () => {
    expect(parseDelegationLedger(JSON.stringify(ISSUED({ at: '2026-13-45T99:99:99Z' } as never))).problems).toHaveLength(1)
    expect(
      parseDelegationLedger(JSON.stringify({ kind: 'revoked', id: 'D1', at: 'yesterday', reason: 'r' })).problems,
    ).toHaveLength(1)
  })

  it('🔴 타임존 없는 값은 받지 않는다(비교 기준이 없다)', () => {
    expect(parseInstantMs('2026-08-13T00:00:00')).toBeNull()
    expect(parseInstantMs('2026-08-13')).toBeNull()
  })

  /**
   * 🔴 phase-2 리뷰 r02 P1 — **`Date.parse` 는 날짜 오버플로를 정규화한다.**
   *    `2026-02-30` 을 3월 2일로 조용히 읽으면, 존재하지 않는 만료일이 유효한 위임이 된다.
   *    형식 검사만으로는 못 잡고 **왕복 대조**가 필요하다.
   */
  it('🔴 실재하지 않는 날짜는 거부한다(2/30 이 3/2 로 정규화되지 않는다)', () => {
    expect(Number.isFinite(Date.parse('2026-02-30T00:00:00Z'))).toBe(true) // Date.parse 는 받아들인다
    expect(parseInstantMs('2026-02-30T00:00:00Z')).toBeNull() // 우리는 거부한다
    expect(parseInstantMs('2026-04-31T00:00:00Z')).toBeNull()
    expect(parseInstantMs('2025-02-29T00:00:00Z')).toBeNull() // 평년
    expect(parseInstantMs('2024-02-29T00:00:00Z')).not.toBeNull() // 윤년은 실재한다
  })

  it('🔴 범위를 벗어난 시·분·초·월도 거부한다', () => {
    for (const bad of ['2026-13-01T00:00:00Z', '2026-08-13T24:00:00Z', '2026-08-13T00:60:00Z', '2026-08-13T00:00:60Z'])
      expect(parseInstantMs(bad), bad).toBeNull()
  })

  it('🔴 실재하지 않는 만료일이 담긴 원장은 손상이다', () => {
    const v = delegationVerdict(BASE({ ledgerText: ledger(ISSUED({ expires_at: '2026-02-30T00:00:00Z' })) }))
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toBe('ledger-corrupt')
  })

  it('오프셋 부호를 올바로 적용한다(-05:00 은 UTC 보다 뒤)', () => {
    expect(parseInstantMs('2026-08-13T00:00:00-05:00')).toBe(Date.UTC(2026, 7, 13, 5, 0, 0))
    expect(parseInstantMs('2026-08-13T00:00:00+09:00')).toBe(Date.UTC(2026, 7, 12, 15, 0, 0))
  })

  /**
   * 🔴 **사전순이면 통과하지만 수치로는 만료**인 조합. 이 테스트가 옛 구현을 정확히 잡는다:
   *    `"2026-08-13T12:00:00.000Z" >= "2026-08-14T00:00:00+12:00"` 는 사전순으로 false(=미만료)지만,
   *    `+12:00` 을 UTC 로 환산하면 만료는 08-13T12:00Z 로 **현재와 같아** 만료다.
   */
  it('🔴 오프셋 표기를 UTC 로 환산해 비교한다', () => {
    const v = delegationVerdict(
      BASE({ ledgerText: ledger(ISSUED({ expires_at: '2026-08-14T00:00:00+12:00' })), now: '2026-08-13T12:00:00.000Z' }),
    )
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toBe('expired')
    // 같은 두 문자열의 사전순 비교는 반대 답을 낸다 — 옛 구현이 통과시켰다는 증거.
    expect('2026-08-13T12:00:00.000Z' >= '2026-08-14T00:00:00+12:00').toBe(false)
  })

  /** `now` 가 계약 위반이면 판정으로 흡수하지 않는다 — 시계를 못 읽었는데 통과할 수 없다. */
  it('🔴 now 가 instant 가 아니면 throw 한다', () => {
    expect(() => delegationVerdict(BASE({ now: 'now' }))).toThrow('ISO instant')
  })
})

/** 🔴 세 권한은 독립이다 — push 허용이 bypass 허용을 함의하지 않는다. */
describe('[REQ-2026-140] 권한 분리', () => {
  it('요청하지 않은 권한은 문제가 되지 않는다', () => {
    expect(missingPermissions(PERMS(), PERMS())).toEqual([])
  })

  it('🔴 push 를 허용해도 bypass 는 따라오지 않는다', () => {
    const granted = PERMS({ origin_push: true })
    expect(missingPermissions(granted, PERMS({ origin_push: true }))).toEqual([])
    expect(missingPermissions(granted, PERMS({ bypass_protection: true }))).toHaveLength(1)
  })

  it('🔴 발급 자체가 local_merge 다(DEC-5a) — 정상 병합이 권한 부족으로 막히지 않는다', () => {
    expect(delegationVerdict(BASE({ requested: PERMS({ local_merge: true }) })).ok).toBe(true)
  })
})
