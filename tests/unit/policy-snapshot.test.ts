import { describe, it, expect } from 'vitest'
import { effectiveStopGate, effectiveExecutionPolicy, AUTO_APPROVE_OF, type StopGate } from '../../scripts/req/lib/config'
import { classifyPolicyDrift, ticketIdOf, runChecks, type DoctorInputs } from '../../scripts/req/req-doctor'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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

/**
 * REQ-2026-134 — **두 축을 한 해소에서** 낸다.
 *
 * 🔴 REQ-2026-129는 `stopGate`만 동결했고 파생 축(phase 자동승인)은 config에서 왔다. 그래서
 *    스냅샷=`merge` · config=`phase` 인 티켓은 게이트(`req:commit`)는 통과시키는데
 *    안내(`req:next`)는 멈추라고 하는 **모순**이 났다 — 한 티켓이 두 정책으로 판정됐다.
 */
describe('[REQ-2026-134] effectiveExecutionPolicy — 두 축 동시 해소', () => {
  const cfgBoth = (stopGate: StopGate, autoApprove: 'never' | 'low-only') => ({
    stopGate,
    phaseCommit: { autoApprove },
  })

  it('🔴 스냅샷이 있으면 파생 축도 스냅샷에서 계산된다(config 무시)', () => {
    const state = { policy_snapshot: { stop_gate: 'merge' } } as unknown as WorkflowState
    // config 는 phase(=never) 인데 스냅샷이 merge 이므로 파생은 low-only 여야 한다.
    expect(effectiveExecutionPolicy(state, cfgBoth('phase', 'never'))).toEqual({
      stopGate: 'merge',
      phaseCommitAutoApprove: 'low-only',
    })
  })

  it('🔴 반대 방향도 같다 — 스냅샷 phase 는 config 가 merge 여도 never', () => {
    const state = { policy_snapshot: { stop_gate: 'phase' } } as unknown as WorkflowState
    expect(effectiveExecutionPolicy(state, cfgBoth('merge', 'low-only'))).toEqual({
      stopGate: 'phase',
      phaseCommitAutoApprove: 'never',
    })
  })

  /** 파생 규칙은 새로 만들지 않는다 — REQ-2026-063이 정한 번역표가 그대로 SSOT다. */
  it('파생은 AUTO_APPROVE_OF 를 따른다(세 값 전부)', () => {
    for (const sg of ['phase', 'req', 'merge'] as const) {
      const state = { policy_snapshot: { stop_gate: sg } } as unknown as WorkflowState
      expect(effectiveExecutionPolicy(state, cfgBoth('phase', 'never')).phaseCommitAutoApprove, sg).toBe(AUTO_APPROVE_OF[sg])
    }
  })

  it('legacy(스냅샷 없음)는 config 두 축을 그대로 쓴다 — 무회귀', () => {
    expect(effectiveExecutionPolicy({} as WorkflowState, cfgBoth('merge', 'low-only'))).toEqual({
      stopGate: 'merge',
      phaseCommitAutoApprove: 'low-only',
    })
    expect(effectiveExecutionPolicy(null, cfgBoth('phase', 'never'))).toEqual({
      stopGate: 'phase',
      phaseCommitAutoApprove: 'never',
    })
  })

  it('손상 스냅샷도 legacy 와 같이 config 로 폴백한다', () => {
    const state = { policy_snapshot: { stop_gate: 'all' } } as unknown as WorkflowState
    expect(effectiveExecutionPolicy(state, cfgBoth('req', 'low-only'))).toEqual({
      stopGate: 'req',
      phaseCommitAutoApprove: 'low-only',
    })
  })

  /** 두 함수가 갈라지면 소비자가 보는 값이 달라진다. */
  it('effectiveStopGate 와 항상 같은 stopGate 를 낸다', () => {
    for (const snap of ['phase', 'req', 'merge', 'all', undefined] as const) {
      const state = (snap === undefined ? {} : { policy_snapshot: { stop_gate: snap } }) as unknown as WorkflowState
      const cfg = cfgBoth('req', 'low-only')
      expect(effectiveExecutionPolicy(state, cfg).stopGate, String(snap)).toBe(effectiveStopGate(state, cfg))
    }
  })

  /**
   * 🔴 **값 비교만으로는 부족하다** — 두 축이 우연히 같은 설정에서는 config 를 직접 읽어도 통과한다.
   *    그래서 "읽지 않는다"를 소스에서 고정한다(이 저장소가 배선 끊김에 쓴 것과 같은 수단).
   */
  it('🔴 req:next 가 config 의 파생 축을 직접 읽지 않는다(소스 0건)', () => {
    const src = readFileSync(join(import.meta.dirname, '..', '..', 'scripts', 'req', 'req-next.ts'), 'utf8')
    expect(src.match(/cfg\.phaseCommit/g) ?? [], 'req-next.ts 가 config 파생 축을 직접 읽는다').toEqual([])
    // 오라클 자기검증: 이 파일이 실제로 정책 해소를 쓰고 있어야 위 단언이 의미를 가진다.
    expect(src).toContain('effectiveExecutionPolicy(state, cfg)')
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
      reviewBudget: { autoBudget: 5, hardCap: 8, onSoftLimit: 'ask' as const },
      phaseCommitAutoApprove: 'low-only',
      stopGate: effectiveStopGate(state, cfg('merge')),
      deliveryGate: null,
    })
    expect(a.kind).toBe('AWAIT_HUMAN')
    expect(a.controlPoint).toBe('통합(feature→main)')
  })
})

/**
 * D32(REQ-2026-129 DEC-4) — 드리프트 **가시성**. 게이트는 이미 스냅샷을 쓰므로 판정은 일관하다.
 * 사용자에게 필요한 것은 차단이 아니라 "이 티켓은 config 와 다른 정책으로 돈다"는 사실이다.
 */
describe('[policy-snapshot] D32 — 드리프트 진단', () => {
  it('네 경우를 구분한다', () => {
    expect(classifyPolicyDrift({ policy_snapshot: { stop_gate: 'req' } }, 'req')).toEqual({ kind: 'aligned', effective: 'req' })
    expect(classifyPolicyDrift({}, 'merge')).toEqual({ kind: 'legacy', config: 'merge' })
    expect(classifyPolicyDrift({ policy_snapshot: { stop_gate: 'all' } }, 'req')).toEqual({
      kind: 'corrupt',
      raw: 'all',
      config: 'req',
    })
    expect(classifyPolicyDrift({ policy_snapshot: { stop_gate: 'phase' } }, 'merge')).toEqual({
      kind: 'drift',
      effective: 'phase',
      config: 'merge',
    })
  })

  const base: DoctorInputs = {
    state: { id: 'REQ-2026-129', branch: 'feat/req-2026-129-x', commit_allowed: false } as never,
    currentBranch: 'feat/req-2026-129-x',
    branchExists: true,
    branchPrefix: 'feat/req-',
    stagedTree: 'TREE',
    statusEntries: [],
    scratch: [],
    responseVerdict: null,
    responseStructureOk: false,
    designApproved: false,
    designApprovedHash: null,
    currentDesignHash: null,
    ticketDocs: [],
    ticketRel: 'workflow/REQ-2026-129',
  }
  const d32 = (over: Partial<DoctorInputs>) => runChecks({ ...base, ...over }).find((c) => c.id === 'D32')

  /** 🔴 **FAIL 이 아니다** — 여기서 막으면 정책을 바꾼 사용자의 진행 중 티켓이 전부 교착한다. */
  it('🔴 드리프트는 WARN 이고 채택 명령을 실제 티켓 id 로 안내한다', () => {
    const c = d32({ policyDrift: { kind: 'drift', effective: 'phase', config: 'merge' } })
    expect(c?.level).toBe('WARN')
    expect(c?.msg).toContain('req:repolicy REQ-2026-129 --run')
  })

  it('손상 스냅샷도 조용하지 않다 — config 로 폴백한다는 사실을 말한다', () => {
    const c = d32({ policyDrift: { kind: 'corrupt', raw: 'all', config: 'req' } })
    expect(c?.level).toBe('WARN')
    expect(c?.msg).toContain('손상')
  })

  it('일치·legacy·미계산은 OK(진행을 막지 않는다)', () => {
    expect(d32({ policyDrift: { kind: 'aligned', effective: 'req' } })?.level).toBe('OK')
    expect(d32({ policyDrift: { kind: 'legacy', config: 'merge' } })?.level).toBe('OK')
    expect(d32({})?.level).toBe('OK')
  })

  it('ticketIdOf 는 경로에서 id 를 뽑고, 모르면 지어내지 않는다', () => {
    expect(ticketIdOf('workflow/REQ-2026-129')).toBe('REQ-2026-129')
    expect(ticketIdOf(undefined)).toBe('<REQ>')
  })
})
