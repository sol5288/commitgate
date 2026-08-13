import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkReviewBudget, budgetAllowsDispatch, type BudgetDecision } from '../../scripts/req/review-codex'
import { loadConfig, DEFAULTS, type ReviewBudget } from '../../scripts/req/lib/config'
import { planReviewException } from '../../scripts/req/req-review-exception'
import { resolveNext } from '../../scripts/req/req-next'
import { ledgerRowProblems, OPTIONAL_LEDGER_KEYS, type LedgerRow } from '../../scripts/req/lib/review-ledger'
import type { WorkflowState } from '../../scripts/req/review-codex'

/**
 * REQ-2026-132 — 소프트 예산(`autoBudget`) 초과 처리의 **설정화**.
 *
 * 🔴 이 정지는 **비용 통제**이지 안전 게이트가 아니다. `hardCap`(절대 호출 상한)은 두 값 모두에서
 *    그대로이며, 리뷰 승인·증거·통합 통제점은 아무것도 바뀌지 않는다.
 */

const budget = (onSoftLimit: 'ask' | 'auto', autoBudget = 5, hardCap = 8): ReviewBudget => ({
  autoBudget,
  hardCap,
  onSoftLimit,
})

describe('[REQ-2026-132] checkReviewBudget — onSoftLimit 진리표', () => {
  const at = (dispatched: number, productive = dispatched) => ({ dispatched, productive })

  it('예산 안이면 두 값 모두 allow', () => {
    for (const p of ['ask', 'auto'] as const) expect(checkReviewBudget(at(4), budget(p)).kind).toBe('allow')
  })

  it('🔴 소프트 초과: ask=needs-exception · auto=soft-auto', () => {
    expect(checkReviewBudget(at(5), budget('ask'))).toEqual({ kind: 'needs-exception', attempt: 6 })
    expect(checkReviewBudget(at(5), budget('auto'))).toEqual({ kind: 'soft-auto', attempt: 6 })
    // 8회차(dispatched=7)도 같다 — hardCap 직전까지는 정책이 지배한다.
    expect(checkReviewBudget(at(7), budget('auto')).kind).toBe('soft-auto')
  })

  /** 🔴 `auto`는 무한 재시도가 아니다. 절대 상한은 설정 축과 무관하다. */
  it('🔴 hardCap 도달은 두 값 모두 hard-blocked', () => {
    for (const p of ['ask', 'auto'] as const) expect(checkReviewBudget(at(8), budget(p))).toEqual({ kind: 'hard-blocked', attempt: 9 })
  })

  /**
   * 🔴 소비자는 **진행 가능 집합**을 쓴다. `!== 'allow'` 같은 부정으로 적으면 판정 종류가 늘 때마다
   *    새 값이 조용히 "정지" 쪽에 붙는다 — 이 REQ가 정확히 그 사례였다.
   */
  it('🔴 budgetAllowsDispatch: allow·soft-auto만 진행 가능', () => {
    const cases: Array<[BudgetDecision, boolean]> = [
      [{ kind: 'allow' }, true],
      [{ kind: 'soft-auto', attempt: 6 }, true],
      [{ kind: 'needs-exception', attempt: 6 }, false],
      [{ kind: 'hard-blocked', attempt: 9 }, false],
    ]
    for (const [d, expected] of cases) expect(budgetAllowsDispatch(d), d.kind).toBe(expected)
  })
})

describe('[REQ-2026-132] config — 기본 ask · 부분 설정 병합', () => {
  const withConfig = (raw: unknown): ReviewBudget => {
    const root = mkdtempSync(join(tmpdir(), 'cg-soft-'))
    writeFileSync(join(root, 'req.config.json'), JSON.stringify(raw))
    return loadConfig({ root }).reviewBudget
  }

  it('기본값은 ask', () => {
    expect(DEFAULTS.reviewBudget.onSoftLimit).toBe('ask')
    expect(withConfig({}).onSoftLimit).toBe('ask')
  })

  /**
   * 🔴 이 REQ의 이행 계약(설계 r01 P1). 로더가 `reviewBudget`을 **객체 통째로** 교체하던 시절에는
   *    기존 정상 설정에서 새 키가 `undefined`가 되어 "미지정 = ask"가 성립하지 않았다.
   */
  it('🔴 기존 부분 설정 {autoBudget,hardCap}이 그대로 유효하고 onSoftLimit는 ask로 채워진다', () => {
    const b = withConfig({ reviewBudget: { autoBudget: 3, hardCap: 6 } })
    expect(b).toEqual({ autoBudget: 3, hardCap: 6, onSoftLimit: 'ask' })
  })

  it('명시하면 그 값이 쓰인다', () => {
    expect(withConfig({ reviewBudget: { autoBudget: 5, hardCap: 8, onSoftLimit: 'auto' } }).onSoftLimit).toBe('auto')
  })

  it('🔴 enum 밖 값은 스키마가 거부한다', () => {
    expect(() => withConfig({ reviewBudget: { autoBudget: 5, hardCap: 8, onSoftLimit: 'always' } })).toThrow()
  })
})

/**
 * 🔴 `auto`에서 예외를 부여하면 도구가 스스로 "auto는 사람 승인을 만들지 않는다"를 어긴다 —
 *    쓰이지도 않을 사람 승인 기록만 남는다.
 */
describe('[REQ-2026-132] req:review-exception — auto에서는 부여하지 않는다', () => {
  const openSeries = (attempts: number): WorkflowState =>
    ({
      id: 'REQ-2026-132',
      review_series_model_version: 1,
      review_series: [{ series_id: 'design:-#1', review_kind: 'design', phase_id: null, attempts, closed_reason: null }],
    }) as unknown as WorkflowState

  it('ask + 소프트 초과 → 부여 가능(현행)', () => {
    const plan = planReviewException(openSeries(5), 'design', null, budget('ask'))
    expect(plan.ok).toBe(true)
  })

  it('🔴 auto + 같은 상태 → 거부하고 이유·해결을 말한다', () => {
    const plan = planReviewException(openSeries(5), 'design', null, budget('auto'))
    expect(plan.ok).toBe(false)
    expect(plan.ok === false && plan.reason).toContain('onSoftLimit')
    expect(plan.ok === false && plan.hint).toContain('"ask"')
  })

  it('hardCap 도달은 두 값 모두 거부(무회귀)', () => {
    for (const p of ['ask', 'auto'] as const) expect(planReviewException(openSeries(8), 'design', null, budget(p)).ok).toBe(false)
  })
})

/**
 * 🔴 화면과 동작이 갈라지면 안내가 거짓이 된다. `auto`에서 예산 때문에 `AWAIT_HUMAN`이 나오면
 *    사용자는 존재하지 않는 정지를 안내받는다(REQ-2026-071 phase-4 r01과 같은 종류의 결함).
 */
describe('[REQ-2026-132] req:next — auto 는 예산으로 멈추지 않는다', () => {
  const state = (attempts: number): WorkflowState =>
    ({
      id: 'REQ-2026-132',
      branch: 'feat/req-2026-132-x',
      commit_allowed: false,
      design_approved: false,
      design_approved_hash: null,
      phases: [],
      approval_evidence_required: true,
      review_series_model_version: 1,
      review_series: [{ series_id: 'design:-#1', review_kind: 'design', phase_id: null, attempts, closed_reason: null }],
    }) as unknown as WorkflowState

  const next = (attempts: number, onSoftLimit: 'ask' | 'auto') =>
    resolveNext({
      target: { kind: 'req', reqId: '2026-132' },
      state: state(attempts),
      packageManager: 'npm',
      designDocsInIndex: true,
      currentDesignHash: 'd'.repeat(64),
      hasStagedChanges: false,
      worktreeReviewClean: true,
      currentIndexHash: 'a'.repeat(64),
      currentSemanticIdentity: 'a'.repeat(64),
      reviewBudget: budget(onSoftLimit),
      phaseCommitAutoApprove: 'never',
    })

  it('ask + 소프트 초과 → AWAIT_HUMAN(현행 무회귀)', () => {
    const a = next(5, 'ask')
    expect(a.kind).toBe('AWAIT_HUMAN')
    expect(a.controlPoint).toContain('review 예산')
  })

  it('🔴 auto + 같은 상태 → 예산으로 멈추지 않는다', () => {
    const a = next(5, 'auto')
    expect(a.kind).not.toBe('AWAIT_HUMAN')
    expect(a.controlPoint ?? '').not.toContain('review 예산')
  })

  it('🔴 hardCap 도달은 두 값 모두 멈춘다', () => {
    for (const p of ['ask', 'auto'] as const) {
      const a = next(8, p)
      expect(a.kind, p).toBe('AWAIT_HUMAN')
      expect(a.detail, p).toContain('하드 상한')
    }
  })
})

describe('[REQ-2026-132] 원장 — soft_limit_resolution', () => {
  const row = (over: Partial<LedgerRow> = {}): LedgerRow =>
    ({
      ticket_id: 'REQ-2026-132',
      series_id: 'design:-#1',
      review_kind: 'design',
      phase_id: null,
      attempt: 6,
      event: 'attempt-closed',
      lifecycle: 'completed',
      outcome: 'approved',
      exception_consumed: false,
      prompt_sha256: null,
      at: '2026-08-13T00:00:00.000Z',
      reconstructed: false,
      ...over,
    }) as LedgerRow

  /** 🔴 optional 이어야 한다 — 필수로 넣으면 이미 커밋된 모든 옛 원장 행이 거부되고 D5가 리뷰를 막는다. */
  it('🔴 선택 키다 — 부재해도 유효(옛 행 무회귀)', () => {
    expect(OPTIONAL_LEDGER_KEYS).toContain('soft_limit_resolution')
    expect(ledgerRowProblems(row())).toEqual([])
  })

  it('두 값과 null 을 받는다', () => {
    for (const v of ['exception', 'policy', null] as const)
      expect(ledgerRowProblems(row({ soft_limit_resolution: v })), String(v)).toEqual([])
  })

  /** 🔴 일반 string 검증만으로는 손상 행이 정상으로 위장한다(감사 필드는 의미가 제한돼 있다). */
  it('🔴 열거 밖 문자열은 손상이다', () => {
    expect(ledgerRowProblems(row({ soft_limit_resolution: 'auto' as never }))).toContain('soft_limit_resolution 부적합: auto')
  })

  /**
   * 🔴 `exception_consumed`의 의미를 넓히지 않았는지. `policy`일 때 그 값이 `true`가 되면
   *    **정책 통과가 사람 승인으로 위장**한다 — 이 REQ가 가장 피해야 할 결과다.
   */
  it('🔴 policy 행은 exception_consumed=false 와 공존한다(의미가 다른 두 사실)', () => {
    expect(ledgerRowProblems(row({ soft_limit_resolution: 'policy', exception_consumed: false }))).toEqual([])
  })
})

/**
 * 🔴 **배선 끊김은 순수 테스트가 못 잡는다**(이 저장소에서 반복 실증 — 이 REQ의 phase-1 r01이 정확히
 *    그 결함이었다: 값을 만들고 원장 append에 넣지 않아 감사 사실이 사라졌다).
 *    그래서 판정→기록의 **연결**을 소스에서 직접 검사한다.
 */
describe('[REQ-2026-132] 판정이 실제로 원장 행에 실린다(배선)', () => {
  const source = readFileSync(join(import.meta.dirname, '..', '..', 'scripts', 'req', 'review-codex.ts'), 'utf8')

  it('🔴 세 append 지점(opened · 실패 closed · 성공 closed) 모두가 값을 싣는다', () => {
    const wired = source.match(/soft_limit_resolution: attemptInfo\.soft_limit_resolution/g) ?? []
    expect(wired.length, '원장 append 지점 3곳 중 누락이 있다').toBe(3)
  })

  /** 판정 → AttemptInfo 로 옮기는 자리도 살아 있어야 한다(둘 중 하나만 있으면 값이 항상 null 이다). */
  it('🔴 판정에서 값을 만드는 자리가 있다', () => {
    expect(source).toContain("decision.kind === 'soft-auto' ? 'policy' : null")
  })
})
