import { describe, it, expect } from 'vitest'
import { effectiveStopGate, type StopGate } from '../../scripts/req/lib/config'
import { buildInitialState } from '../../scripts/req/req-new'
import { userConfirmGate } from '../../scripts/req/req-commit'
import { resolveNext } from '../../scripts/req/req-next'
import type { WorkflowState } from '../../scripts/req/review-codex'

/**
 * REQ-2026-129 — **정지 정책 스냅샷**.
 *
 * 🔴 이 REQ가 막는 것: 티켓 하나가 **여러 정책으로 진행**되는 것. 예전에는 게이트가 명령 실행 시점의
 *    `req.config.json`을 매번 다시 읽어, phase-1은 `phase`로 확인받고 중간에 설정을 바꾸면 나머지는
 *    확인 없이 자동 커밋됐다 — 이미 받은 확인의 의미가 사후에 바뀐다.
 */

const cfg = (stopGate: StopGate) => ({ stopGate })

describe('[policy-snapshot] effectiveStopGate — 해소 진리표', () => {
  it('스냅샷이 있으면 config 를 무시한다', () => {
    const state = { policy_snapshot: { stop_gate: 'phase' } } as unknown as WorkflowState
    expect(effectiveStopGate(state, cfg('merge'))).toBe('phase')
  })

  it('스냅샷이 없으면(legacy) config 를 본다 — 무회귀', () => {
    expect(effectiveStopGate({} as WorkflowState, cfg('merge'))).toBe('merge')
    expect(effectiveStopGate(null, cfg('req'))).toBe('req')
  })

  /**
   * 🔴 손상값으로 게이트를 판정하느니 현행 동작이 낫다. 조용히 넘어가는 것이 아니라 doctor 가 따로 말한다.
   */
  it('🔴 enum 밖 값은 무시하고 config 로 폴백한다', () => {
    for (const bogus of ['all', '', 'Phase', 42, null, undefined, {}]) {
      const state = { policy_snapshot: { stop_gate: bogus } } as unknown as WorkflowState
      expect(effectiveStopGate(state, cfg('req')), `bogus=${JSON.stringify(bogus)}`).toBe('req')
    }
  })

  it('policy_snapshot 자체가 형태가 아니면 config 로 폴백한다', () => {
    expect(effectiveStopGate({ policy_snapshot: 'merge' } as unknown as WorkflowState, cfg('phase'))).toBe('phase')
  })
})

describe('[policy-snapshot] req:new 가 해소값을 심는다', () => {
  it('생성된 state 에 스냅샷이 있다', () => {
    const s = buildInitialState('REQ-2026-999', 'feat/x', 'LOW', undefined, 'merge')
    expect(s.policy_snapshot).toEqual({ stop_gate: 'merge' })
  })

  /** 🔴 심은 값이 곧 게이트가 쓰는 값이어야 한다 — 기록과 판정이 갈라지면 스냅샷의 의미가 없다. */
  it('심은 값을 effectiveStopGate 가 그대로 쓴다', () => {
    const s = buildInitialState('REQ-2026-999', 'feat/x', 'LOW', undefined, 'phase')
    expect(effectiveStopGate(s, cfg('merge'))).toBe('phase')
  })
})

/**
 * 🔴 설계가 요구하는 것은 "다섯 소비자가 **같은 값**을 쓴다"이다. 일부만 전환하면 같은 티켓을
 *    두 정책으로 판정하는 상태가 남는다(설계 r01 P1이 지적한 그대로).
 */
describe('[policy-snapshot] 소비자 일관성 — 스냅샷 ≠ config', () => {
  const highState = (over: Partial<WorkflowState> = {}) =>
    ({
      id: 'REQ-2026-999',
      risk_level: 'HIGH',
      commit_allowed: false,
      design_approved: true,
      design_approved_hash: 'd'.repeat(64),
      review_series_model_version: 1,
      approval_evidence_required: true,
      phases: [{ id: 'p1', approved: true }],
      consumed_approvals: [{ phase_id: 'p1' }],
      policy_snapshot: { stop_gate: 'phase' },
      ...over,
    }) as unknown as WorkflowState

  /**
   * `req:commit` 게이트(= doctor D28이 표시하는 것과 **같은 함수**)가 스냅샷을 본다.
   * config 는 `merge`(커밋을 막지 않음)인데 스냅샷이 `phase`이므로 **막혀야** 한다.
   */
  it('🔴 userConfirmGate 는 스냅샷(phase)을 따라 막는다 — config(merge)를 따르지 않는다', () => {
    const state = highState()
    const gate = userConfirmGate(state, effectiveStopGate(state, cfg('merge')), false)
    expect(gate.blocked).toBe(true)
    expect(gate.reason ?? '').toContain('--scope phase')
  })

  /** 대조군: 스냅샷이 `merge` 면 같은 입력에서 막지 않는다(값이 실제로 판정을 바꾼다는 증명). */
  it('스냅샷이 merge 면 같은 상태에서 막지 않는다', () => {
    const state = highState({ policy_snapshot: { stop_gate: 'merge' } } as never)
    expect(userConfirmGate(state, effectiveStopGate(state, cfg('phase')), false).blocked).toBe(false)
  })

  /**
   * `req:next` 종단도 같은 값을 봐야 한다. config 는 `merge` 지만 스냅샷이 `req` 이므로
   * 묶음 조회 없이 `req` 종단(통합 AWAIT_HUMAN)이 나온다.
   */
  it('🔴 req:next 종단이 스냅샷을 따른다', () => {
    const state = highState({ risk_level: 'LOW', policy_snapshot: { stop_gate: 'req' } } as never)
    const a = resolveNext({
      target: { kind: 'req', reqId: '2026-999' },
      state,
      packageManager: 'npm',
      designDocsInIndex: true,
      currentDesignHash: 'd'.repeat(64),
      hasStagedChanges: false,
      worktreeReviewClean: true,
      currentIndexHash: 'a'.repeat(64),
      currentSemanticIdentity: 'a'.repeat(64),
      reviewBudget: { autoBudget: 5, hardCap: 8 },
      phaseCommitAutoApprove: 'low-only',
      stopGate: effectiveStopGate(state, cfg('merge')),
      deliveryGate: null,
    })
    expect(a.kind).toBe('AWAIT_HUMAN')
    expect(a.controlPoint).toBe('통합(feature→main)')
  })
})
