import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { terminalIntegrationAction, resolveNext, type NextInput } from '../../scripts/req/req-next'
import { highRiskCarriedByDelegation, type StopGate } from '../../scripts/req/lib/config'
import { delegationVerdict, type DelegationCheckInput } from '../../scripts/req/lib/delegation'

/**
 * REQ-2026-174 — **HIGH 승인의 자리를 하나로 정한다**.
 *
 * 🔴 `auto` + 티켓 scope 에서는 `user_commit_confirmed` 를 **집행하는 게이트가 없다**
 *    (`userConfirmGate` 는 `defersToIntegration` 이면 즉시 통과). 실제로 HIGH 를 막는 것은
 *    위임의 `high_risk_ack` 다. 그래서 그 경로에서만 `req:confirm` 정지를 없앤다.
 *
 * 🔴 **승인이 사라지는 것이 아니라 옮겨진다** — 그 사실을 오라클 두 방향으로 고정한다:
 *    ① `auto` 에서 확인을 요구하지 않는다  ② `--high-risk` 없는 위임은 **여전히 막힌다**
 */

const BRANCH = 'feat/req-2026-174-high-confirm-absorb'

const terminalInput = (over: Partial<NextInput> = {}, stateOver: Record<string, unknown> = {}): NextInput =>
  ({
    target: { kind: 'id', id: 'REQ-2026-174' },
    packageManager: 'npm',
    state: {
      id: 'REQ-2026-174',
      branch: BRANCH,
      risk_level: 'HIGH',
      phases: [{ id: 'p1', title: 'p1', status: 'approved' }],
      review_series_model_version: 1,
      ...stateOver,
    },
    stopGate: 'auto',
    phaseCommitAutoApprove: 'low-only',
    completesReq: true,
    worktreeReviewClean: true,
    designApproved: true,
    ...over,
  }) as unknown as NextInput

/** 종단 안내(묶음 없음 분기와 같은 인자). */
const terminal = (sg: StopGate, stateOver: Record<string, unknown> = {}) =>
  terminalIntegrationAction(terminalInput({ stopGate: sg }, stateOver), {
    requireHighConfirm: !highRiskCarriedByDelegation(sg),
  })

describe('[REQ-2026-174] highRiskCarriedByDelegation — 판단 지점은 하나', () => {
  it('🔴 auto 에서만 위임이 HIGH 승인을 담는다', () => {
    expect(highRiskCarriedByDelegation('auto')).toBe(true)
  })

  /**
   * 🔴 **`defersToIntegration` 로 대신하면 안 된다.** `merge` 에는 위임이 없어 담을 곳이
   *    `user_commit_confirmed` 뿐이다 — 거기서 정지를 없애면 승인이 **사라진다**.
   */
  it('🔴 merge 는 아니다(위임이 없어 담을 곳이 없다)', () => {
    for (const sg of ['phase', 'req', 'merge'] as const)
      expect(highRiskCarriedByDelegation(sg), sg).toBe(false)
  })
})

describe('[REQ-2026-174] auto + 티켓 scope 종단의 HIGH 확인', () => {
  it('🔴 auto + HIGH → req:confirm 을 요구하지 않는다', () => {
    const a = terminal('auto')
    expect(a.command ?? '', JSON.stringify(a)).not.toContain('req:confirm')
    expect(a.controlPoint).toContain('사전 위임')
  })

  it('🔴 안내가 --high-risk 를 담는다', () => {
    expect(terminal('auto').command ?? '').toContain('--high-risk')
  })

  /** 🔴 **감춰진 완화 금지** — 확인이 하나로 모였다는 사실을 안내가 말해야 한다(DEC-3). */
  it('🔴 안내가 "이것이 유일한 사람 확인"이라고 말한다', () => {
    expect(terminal('auto').detail).toContain('유일한 사람 확인')
  })

  /** 🔴 **무회귀** — `merge` 는 그대로 `req:confirm` 을 요구한다. */
  it('🔴 merge + HIGH → 여전히 req:confirm 을 요구한다', () => {
    const a = terminal('merge')
    expect(a.command ?? '', JSON.stringify(a)).toContain('req:confirm')
    expect(a.controlPoint).toContain('HIGH 사람 확인')
  })

  it('LOW 티켓은 어느 값에서도 이 확인을 받지 않는다', () => {
    expect(terminal('merge', { risk_level: 'LOW' }).command ?? '').not.toContain('req:confirm')
  })
})

/**
 * 🔴 **호출부를 검증한다.** 위 `terminal()` 헬퍼는 `requireHighConfirm` 을 **스스로 계산**하므로,
 *    `resolveNext` 안의 실제 파생을 `defersToIntegration` 으로 되돌려도 전부 green 이다
 *    (변이 검사로 확인했다 — 이 저장소가 이번 세션에만 다섯 번 만난 "배선 끊김").
 *    그래서 `resolveNext` 를 **종단까지 태워** 안내를 본다.
 */
describe('[REQ-2026-174] resolveNext 종단 — 실제 호출부', () => {
  /** 종단(모든 phase 소비 · staged 없음 · 워킹트리 clean)에 도달하는 완전한 입력. */
  const atTerminal = (sg: StopGate, riskLevel = 'HIGH'): NextInput =>
    ({
      target: { kind: 'req', reqId: '2026-174' },
      packageManager: 'npm',
      state: {
        id: 'REQ-2026-174',
        branch: BRANCH,
        risk_level: riskLevel,
        phases: [{ id: 'p1', title: 'p1', status: 'approved' }],
        consumed_approvals: [{ phase_id: 'p1' }],
        review_series_model_version: 1,
        approval_evidence_required: true,
        current_phase: null,
        design_approved: true,
        design_approved_hash: 'd'.repeat(64),
      },
      currentDesignHash: 'd'.repeat(64),
      stopGate: sg,
      phaseCommitAutoApprove: 'low-only',
      completesReq: true,
      worktreeReviewClean: true,
      hasStagedChanges: false,
      designDocsInIndex: true,
      designApproved: true,
      designEvidenceDurability: { required: false, durable: true, reason: 'legacy — 점검 불요' },
      deliveryGate: null,
      reviewBudget: { autoBudget: 5, hardCap: 8, onSoftLimit: 'auto' },
    }) as unknown as NextInput

  it('🔴 auto → req:confirm 을 요구하지 않고 위임 발급으로 간다', () => {
    const a = resolveNext(atTerminal('auto'))
    expect(a.kind, JSON.stringify(a)).toBe('AWAIT_HUMAN')
    expect(a.controlPoint ?? '').toContain('사전 위임')
    expect(a.command ?? '').not.toContain('req:confirm')
  })

  /** 🔴 **무회귀** — `merge` 는 호출부에서도 그대로 확인을 요구한다. */
  it('🔴 merge → 여전히 req:confirm 을 요구한다', () => {
    const a = resolveNext(atTerminal('merge'))
    expect(a.kind, JSON.stringify(a)).toBe('AWAIT_HUMAN')
    expect(a.controlPoint ?? '').toContain('HIGH 사람 확인')
    expect(a.command ?? '').toContain('req:confirm')
  })

  it('LOW 는 어느 값에서도 이 확인을 받지 않는다', () => {
    expect(resolveNext(atTerminal('merge', 'LOW')).command ?? '').not.toContain('req:confirm')
  })
})

/**
 * 🔴 **묶음 있음 경로는 바뀌지 않는다.**
 *
 * `commitgate delivery approve` 가 멤버의 `user_commit_confirmed` 를 **실제로 읽으므로**
 * (`bin/delivery.ts`) 그 확인은 집행된다 — 이 REQ 가 없애는 것은 **집행되지 않는** 정지뿐이다.
 *
 * 🔴 이 변경은 `resolveNext` 의 **묶음 없음 분기 한 줄**만 건드린다. 묶음 분기는 그 앞에서
 *    `return` 하므로 도달하지 않는다. 그 분기의 동작은 `req-next.test.ts`·`next-policy-guidance.test.ts`
 *    가 이미 고정하고 있고, **그 단정들을 한 줄도 고치지 않는 것**이 이 REQ 의 무회귀 오라클이다.
 *    (여기서 `resolveNext` 를 다시 태우려면 종단 도달 전제를 통째로 재현해야 하는데,
 *     그것은 그 파일들이 이미 하는 일을 두 벌로 만드는 것이다.)
 */

/**
 * 🔴 **집행 게이트 무회귀** — 안내에서 확인이 사라져도 `--high-risk` 없는 위임은 여전히 막힌다.
 *    이 단정이 없으면 "승인이 옮겨졌다"가 아니라 "승인이 사라졌다"가 된다.
 */
describe('[REQ-2026-174] HIGH 게이트는 그대로다', () => {
  const base = (highRiskAck: boolean): DelegationCheckInput => ({
    ledgerText: JSON.stringify({
      kind: 'issued',
      id: 'D1',
      at: '2026-08-22T00:00:00.000Z',
      scope: { kind: 'ticket', req_id: 'REQ-2026-174' },
      trunk_branch: 'main',
      trunk_sha: 'a'.repeat(40),
      source_branch: BRANCH,
      base_sha: 'b'.repeat(40),
      expires_at: '2126-01-01T00:00:00.000Z',
      permissions: { local_merge: true, origin_push: false, bypass_protection: false },
      high_risk_ack: highRiskAck,
      attested_ack: false,
      approval_sentence: '승인',
    }),
    scope: { kind: 'ticket', req_id: 'REQ-2026-174' },
    now: '2026-08-22T01:00:00.000Z',
    trunkBranch: 'main',
    trunkSha: 'a'.repeat(40),
    sourceBranch: BRANCH,
    requested: { local_merge: true, origin_push: false, bypass_protection: false },
    riskLevel: 'HIGH',
    budgetHardCapReached: false,
    reviewInconclusive: false,
    evidenceOk: true,
    rangeAttribution: { tickets: ['REQ-2026-174'], unattributable: 0, unattributableAttested: 0, deliveries: [] },
    deliveryMembers: null,
    compositionChanged: false,
  })

  it('🔴 --high-risk 없는 위임은 high-risk-unacked 로 막힌다', () => {
    const v = delegationVerdict(base(false))
    expect(v.ok).toBe(false)
    if (v.ok) return
    expect(v.reason).toBe('high-risk-unacked')
  })

  it('--high-risk 가 있으면 통과한다(승인이 옮겨진 자리)', () => {
    expect(delegationVerdict(base(true)).ok).toBe(true)
  })
})

/** 🔴 계약 문서가 같은 사실을 말한다(DEC-4) — 코드만 고치면 에이전트는 옛 문서를 읽는다. */
describe('[REQ-2026-174] 계약 문서 정합', () => {
  const ROOT = join(import.meta.dirname, '..', '..')
  const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8')

  it('🔴 AGENTS 템플릿이 auto 의 예외를 적는다', () => {
    const md = read('AGENTS.template.md')
    expect(md).toContain('`stopGate: "auto"`이고 delivery 묶음이 없으면')
    expect(md).toContain('high-risk-unacked')
  })

  it('🔴 HIGH 확인 지점 표에 auto 행이 있다(빠져 있었다)', () => {
    const md = read('docs/workflow.md')
    expect(md).toContain('| `auto` (묶음 없음) |')
    expect(md).toContain('| `auto` (묶음에 속함) |')
  })

  it('영어 문서도 같은 사실을 적는다', () => {
    const md = read('docs/workflow.en.md')
    expect(md).toContain('| `auto` (no delivery set) |')
    expect(md).toContain('high-risk-unacked')
  })
})
