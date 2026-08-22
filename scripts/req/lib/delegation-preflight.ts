/**
 * 위임 **발급 시점** preflight (REQ-2026-172).
 *
 * ## 무엇을 푸는가
 * `req:delegate` 는 지금까지 **아무것도 검증하지 않고** 행을 썼다. 범위 귀속·`attested`·HIGH·미판정
 * 리뷰는 전부 `commitgate integrate` 에서야 평가돼, **발급 → 실패 → 철회 → 재발급**이 정형 패턴이 됐다
 * (소비자 실측: REQ 1개당 사람 승인 문장 **1.54회**, 재발급 필요 scope 33%).
 *
 * ## 🔴 새 술어를 만들지 않는다 (DEC-1)
 * 후보 `issued` 행을 **실제로 만들어** 원장 뒤에 붙이고 `delegationVerdict` 를 **그대로** 돌린다.
 * 발급 시점 검사를 따로 쓰면 그것이 두 번째 술어가 되고, 갈라지는 순간
 * *"발급은 됐는데 통합이 막힌다"* 또는 더 나쁘게 *"발급을 막았는데 사실은 통합됐을 것"* 이 된다.
 *
 * ## 🔴 사유는 하나씩 나온다 (DEC-7)
 * `delegationVerdict` 는 **첫 거부 하나**만 돌려준다. `--allow-attested` 를 알려 주고 재발급하면 이번엔
 * `high-risk-unacked` 가 나와 **왕복이 한 번 더 는다** — 이 모듈이 없애려는 그 패턴이다.
 * 그래서 같은 함수를 **반복 호출해** 필요한 ack 를 한 번에 전부 모은다.
 *
 * ## 🔴 이 모듈은 게이트를 열지 않는다
 * 탐색은 *"사람이 무엇을 명시해야 하는지"* 를 알아낼 뿐이다. 플래그를 **켜는 것은 사람**이고,
 * 여기서 찾은 ack 는 **안내 문자열**로만 나간다 — 원장에 쓰지 않는다.
 */
import {
  delegationVerdict,
  ledgerWithCandidate,
  DELEGATION_DENY_REASONS,
  type DelegationDenyReason,
  type DelegationIssued,
  type DelegationPermissions,
  type DelegationScope,
  type RangeAttribution,
} from './delegation'

/** 발급 시점에 그 사유를 어떻게 다룰 것인가(DEC-2). */
export type PreflightClass =
  /** 지금 참이다 — 발급해도 그대로 막힌다. */
  | 'block'
  /** 발급 시점에는 성립할 수 없다(방금 만든 행·지금 읽은 trunk). */
  | 'not-yet-knowable'
  /** 이번에 무엇을 요청하느냐에 달렸다 — 통합 시점에 정해진다. */
  | 'request-dependent'

/**
 * 🔴 `Record<DelegationDenyReason, …>` 다 — 사유가 늘면 **컴파일이 강제**해 사각지대가 생기지 않는다.
 *    `DENY_GUIDANCE` 가 이미 같은 기법을 쓴다.
 *
 * 🔴 `not-yet-knowable` 을 "막지 않는다"로 두는 것이 **핵심 안전 장치**다. 예컨대 `trunk-moved` 로 막으면
 *    발급 순간의 trunk 는 늘 "현재"이므로 **정상 발급이 전부 거부된다.**
 */
export const PREFLIGHT_CLASS: Record<DelegationDenyReason, PreflightClass> = {
  'ledger-corrupt': 'block',
  absent: 'not-yet-knowable', // 후보 행을 넣고 판정하므로 성립할 수 없다
  'ambiguous-active': 'block', // 이미 살아 있는 위임이 있으면 지금 참이다
  revoked: 'not-yet-knowable',
  consumed: 'not-yet-knowable',
  expired: 'not-yet-knowable', // 방금 만든 만료 시각이다
  'trunk-branch-mismatch': 'block',
  'trunk-moved': 'not-yet-knowable', // 지금 읽은 SHA 를 그대로 넣는다
  'source-mismatch': 'block',
  'scope-out-of-range': 'block', // 🔴 단, attested-only 면 ack 로 열린다(ACK_FOR)
  'composition-changed': 'block',
  'evidence-mismatch': 'block',
  'high-risk-unacked': 'block', // 🔴 ack 로 열린다
  'budget-hardcap': 'block',
  'review-inconclusive': 'block',
  'permission-denied': 'request-dependent',
}

/** 사람이 명시하면 열리는 사유 → 그 ack 이름. 그 밖은 `null`(플래그로 열리지 않는다). */
export const ACK_FOR: Record<DelegationDenyReason, keyof PreflightAcks | null> = {
  'ledger-corrupt': null,
  absent: null,
  'ambiguous-active': null,
  revoked: null,
  consumed: null,
  expired: null,
  'trunk-branch-mismatch': null,
  'trunk-moved': null,
  'source-mismatch': null,
  /**
   * 🔴 **열릴 수도, 안 열릴 수도 있다.** 귀속 불가가 **전부 `attested`** 면 `--allow-attested` 로 열리고
   *    (`attestedOnlyAndAcked`), 다른 티켓이 섞였거나 `unproven` 이 있으면 열리지 않는다.
   *    **사유 이름만으로는 알 수 없으므로** 탐색이 실제로 시험한다 — 켜 봐서 사유가 그대로면 못 여는 것이다.
   */
  'scope-out-of-range': 'attestedAck',
  'composition-changed': null,
  'evidence-mismatch': null,
  'high-risk-unacked': 'highRiskAck',
  'budget-hardcap': null,
  'review-inconclusive': null,
  'permission-denied': null,
}

export interface PreflightAcks {
  attestedAck: boolean
  highRiskAck: boolean
}

/** 후보 행을 만들 재료 + 판정에 필요한 사실. `delegationGate` 가 모으는 것과 **같은 집합**이다. */
export interface PreflightInput {
  /** 기존 원장 본문(`null` = 파일 없음). */
  ledgerText: string | null
  candidate: DelegationIssued
  now: string
  trunkSha: string
  requested: DelegationPermissions
  riskLevel: string | null
  budgetHardCapReached: boolean
  reviewInconclusive: boolean
  evidenceOk: boolean
  rangeAttribution: RangeAttribution
  deliveryMembers: string[] | null
  compositionChanged: boolean
}

export type PreflightResult =
  /** 지금 이 조합으로 통합이 열린다. */
  | { kind: 'ok' }
  /** 사람이 플래그를 더 명시하면 열린다. `acks` 가 **필요한 전부**다. */
  | { kind: 'needs-acks'; acks: PreflightAcks; reasons: DelegationDenyReason[] }
  /** 지금 상태로는 열리지 않는다 — 플래그로도. */
  | { kind: 'blocked'; reason: DelegationDenyReason; detail: string }
  /**
   * 🔴 발급 시점에 성립할 수 없다고 분류한 사유가 **실제로 났다** — 모델이 틀렸다는 뜻이다.
   *    막지는 않되(그 사유로 막으면 정상 발급이 죽는다) **조용히 넘기지도 않는다.**
   */
  | { kind: 'inconclusive'; reason: DelegationDenyReason; detail: string }

/** ack 탐색 상한. ack 는 둘뿐이라 3회차면 반드시 끝난다(각 회차마다 켜지거나 사유가 반복된다). */
export const MAX_ACK_PROBES = 4

/**
 * 필요한 ack 를 **한 번에 전부** 찾는다(DEC-7).
 *
 * 🔴 종료 보장: 매 회차마다 ack 가 새로 켜지거나(유한), 사유가 직전과 같다(= 그 ack 로 안 열린다 → 중단).
 */
export function preflightDelegation(input: PreflightInput): PreflightResult {
  const requested: PreflightAcks = {
    attestedAck: input.candidate.attested_ack,
    highRiskAck: input.candidate.high_risk_ack,
  }
  let acks: PreflightAcks = { ...requested }
  const discovered: DelegationDenyReason[] = []
  let lastReason: DelegationDenyReason | null = null

  for (let probe = 0; probe < MAX_ACK_PROBES; probe++) {
    const row: DelegationIssued = {
      ...input.candidate,
      attested_ack: acks.attestedAck,
      high_risk_ack: acks.highRiskAck,
    }
    const verdict = delegationVerdict({
      // 🔴 후보 행을 **원장에 실제로 있는 것처럼** 이어 붙인다 — 발급 후 상태와 같은 입력이어야 한다.
      //    직렬화는 `req:delegate` 의 append 와 **같은 함수**를 쓴다(갈라지면 판정이 갈라진다).
      ledgerText: ledgerWithCandidate(input.ledgerText, row),
      scope: row.scope,
      now: input.now,
      trunkBranch: row.trunk_branch,
      trunkSha: input.trunkSha,
      sourceBranch: row.source_branch,
      requested: input.requested,
      riskLevel: input.riskLevel,
      budgetHardCapReached: input.budgetHardCapReached,
      reviewInconclusive: input.reviewInconclusive,
      evidenceOk: input.evidenceOk,
      rangeAttribution: input.rangeAttribution,
      deliveryMembers: input.deliveryMembers,
      compositionChanged: input.compositionChanged,
    })

    if (verdict.ok)
      return discovered.length === 0 ? { kind: 'ok' } : { kind: 'needs-acks', acks, reasons: discovered }

    const cls = PREFLIGHT_CLASS[verdict.reason]
    if (cls !== 'block') return { kind: 'inconclusive', reason: verdict.reason, detail: verdict.detail }

    const ackName = ACK_FOR[verdict.reason]
    if (ackName === null || verdict.reason === lastReason)
      // ack 가 없거나, 켜 봤는데 같은 사유가 또 났다 = 그 플래그로 열리지 않는다.
      return { kind: 'blocked', reason: verdict.reason, detail: verdict.detail }

    lastReason = verdict.reason
    acks = { ...acks, [ackName]: true }
    discovered.push(verdict.reason)
  }
  /**
   * 🔴 여기 도달하면 **탐색이 수렴하지 않았다**. ack 가 둘뿐이라 일어날 수 없지만, 일어난다면
   *    "모른다"이지 "괜찮다"가 아니다 — 통과시키지 않는다.
   */
  return {
    kind: 'blocked',
    reason: 'ledger-corrupt',
    detail: `preflight 탐색이 ${MAX_ACK_PROBES}회 안에 수렴하지 않았다 — 판정할 수 없다`,
  }
}

/** 등록부 전수 검사용(테스트가 손으로 세지 않게). */
export const ALL_DENY_REASONS: readonly DelegationDenyReason[] = DELEGATION_DENY_REASONS
