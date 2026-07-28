import { describe, it, expect } from 'vitest'
import {
  classifyDispatchFailure,
  refundAttempt,
  voidAttempt,
  openSeriesAttempts,
  openSeriesProductiveAttempts,
  budgetCounts,
  recordAttempt,
  checkReviewBudget,
  type SeriesRecord,
} from '../../scripts/req/review-codex'
import type { WorkflowState } from '../../scripts/req/review-codex'
import { ReviewCallError, makeCodexRunner, type StatusSpawn } from '../../scripts/req/lib/adapters'

/**
 * REQ-2026-054 phase-1 — lifecycle 분류·예산 환불·타입 오류(순수·adapters). fs·git 무의존.
 */
const st = (series: SeriesRecord[]): WorkflowState => ({ id: 'REQ-2026-054', review_series: series }) as unknown as WorkflowState
const openDesign = (attempts: number, refunded?: number): SeriesRecord => ({
  series_id: 'design:-#1',
  review_kind: 'design',
  phase_id: null,
  attempts,
  closed_reason: null,
  ...(refunded !== undefined ? { refunded_attempts: refunded } : {}),
})
const BUDGET = { autoBudget: 5, hardCap: 8 }

describe('[REQ-2026-054] ReviewCallError(DEC-C1)', () => {
  it('⑤ dispatchPhase 보존 · Error 서브클래스', () => {
    const e = new ReviewCallError('pre-dispatch', 'x')
    expect(e).toBeInstanceOf(Error)
    expect(e.dispatchPhase).toBe('pre-dispatch')
    expect(new ReviewCallError('dispatched', 'y').dispatchPhase).toBe('dispatched')
  })
})

describe('[REQ-2026-054] makeCodexRunner 분류(DEC-C1)', () => {
  it('⑥ spawn 실패(throw) → ReviewCallError(pre-dispatch)', () => {
    const spawn: StatusSpawn = () => {
      throw new Error('spawn codex ENOENT')
    }
    try {
      makeCodexRunner(spawn)(['exec'], 'prompt', '/tmp')
      expect.unreachable('throw했어야 함')
    } catch (e) {
      expect(e).toBeInstanceOf(ReviewCallError)
      expect((e as ReviewCallError).dispatchPhase).toBe('pre-dispatch')
    }
  })
  it('⑥ non-zero exit → ReviewCallError(dispatched)', () => {
    const spawn: StatusSpawn = () => ({ status: 1, stdout: '', stderr: 'boom' })
    try {
      makeCodexRunner(spawn)(['exec'], 'prompt', '/tmp')
      expect.unreachable('throw했어야 함')
    } catch (e) {
      expect(e).toBeInstanceOf(ReviewCallError)
      expect((e as ReviewCallError).dispatchPhase).toBe('dispatched')
    }
  })
  it('⑥ exit 0 → stdout 반환', () => {
    const spawn: StatusSpawn = () => ({ status: 0, stdout: 'OUT', stderr: '' })
    expect(makeCodexRunner(spawn)(['exec'], 'prompt', '/tmp')).toBe('OUT')
  })
})

describe('[REQ-2026-054] classifyDispatchFailure(DEC-C2)', () => {
  it('④ ReviewCallError(pre-dispatch) → pre_dispatch_failed(확인 여부 무관)', () => {
    expect(classifyDispatchFailure(new ReviewCallError('pre-dispatch', 'x'), false)).toBe('pre_dispatch_failed')
    expect(classifyDispatchFailure(new ReviewCallError('pre-dispatch', 'x'), true)).toBe('pre_dispatch_failed')
  })
  it('④ dispatchConfirmed=true → dispatch_confirmed', () => {
    expect(classifyDispatchFailure(new Error('post-tamper'), true)).toBe('dispatch_confirmed')
    expect(classifyDispatchFailure(new ReviewCallError('dispatched', 'x'), true)).toBe('dispatch_confirmed')
  })
  it('④ 확인 전 dispatched / 일반 오류 → dispatched_unknown(fail-closed 차감)', () => {
    expect(classifyDispatchFailure(new ReviewCallError('dispatched', 'x'), false)).toBe('dispatched_unknown')
    expect(classifyDispatchFailure(new Error('generic'), false)).toBe('dispatched_unknown')
    expect(classifyDispatchFailure('not-an-error', false)).toBe('dispatched_unknown')
  })
})

describe('[REQ-2026-054] 예산 환불(DEC-C3)', () => {
  it('① refundAttempt: 열린 series refunded_attempts +1(없던 필드 → 1)', () => {
    const s = refundAttempt(st([openDesign(3)]), 'design', null)
    expect((s.review_series as SeriesRecord[])[0]!.refunded_attempts).toBe(1)
    // 재환불 → 2. attempts는 불변.
    const s2 = refundAttempt(s, 'design', null)
    expect((s2.review_series as SeriesRecord[])[0]!.refunded_attempts).toBe(2)
    expect((s2.review_series as SeriesRecord[])[0]!.attempts).toBe(3)
  })
  it('① refundAttempt: 열린 series 없으면 no-op', () => {
    const closed = { ...openDesign(3), closed_reason: 'approved' as const }
    const s = refundAttempt(st([closed]), 'design', null)
    expect((s.review_series as SeriesRecord[])[0]!.refunded_attempts).toBeUndefined()
  })
  it('② openSeriesAttempts = attempts - refunded(부재 → attempts)', () => {
    expect(openSeriesAttempts(st([openDesign(3, 1)]), 'design', null)).toBe(2)
    expect(openSeriesAttempts(st([openDesign(3)]), 'design', null)).toBe(3) // 하위호환
    expect(openSeriesAttempts(st([]), 'design', null)).toBe(0)
  })
  it('③ 예산 게이트: 환불이 유효회차를 낮춰 needs-exception→allow', () => {
    // attempts=5·refunded=1 → 유효4 → allow. 환불 없으면 유효5 → needs-exception.
    // REQ-2026-084: 계수 추출은 budgetCounts 단일 출처. pre-dispatch 환불은 **두 축 모두**에서 빠진다(R7).
    expect(checkReviewBudget(budgetCounts(st([openDesign(5, 1)]), 'design', null), BUDGET).kind).toBe('allow')
    expect(checkReviewBudget(budgetCounts(st([openDesign(5)]), 'design', null), BUDGET).kind).toBe('needs-exception')
  })

  // ── REQ-2026-084: void_attempts(호출됨·판정 없음)는 refunded_attempts(호출 안 됨)와 의미가 다르다 ──
  it('[REQ-084 R7] refundAttempt는 dispatched·productive를 함께 낮춘다 — 기존 의미 불변', () => {
    const s = st([openDesign(5, 1)])
    expect(openSeriesAttempts(s, 'design', null)).toBe(4)
    expect(openSeriesProductiveAttempts(s, 'design', null)).toBe(4)
  })

  it('[REQ-084 DEC-4] voidAttempt는 productive만 낮추고 dispatched는 그대로 둔다', () => {
    const s = voidAttempt(st([openDesign(5)]), 'design', null)
    expect((s.review_series as SeriesRecord[])[0]!.void_attempts).toBe(1)
    expect((s.review_series as SeriesRecord[])[0]!.attempts).toBe(5) // 단조 유지(DEC-6 — 원장 자연키 충돌 회피)
    expect(openSeriesAttempts(s, 'design', null)).toBe(5) // 호출은 실제로 나갔다
    expect(openSeriesProductiveAttempts(s, 'design', null)).toBe(4) // 판정은 없었다
    // 그 결과 autoBudget 판정만 완화된다.
    expect(checkReviewBudget(budgetCounts(s, 'design', null), BUDGET).kind).toBe('allow')
  })

  it('[REQ-084 R6] void가 쌓여도 dispatched가 hardCap에 도달하면 차단된다', () => {
    let s = st([openDesign(8)])
    for (let i = 0; i < 8; i++) s = voidAttempt(s, 'design', null)
    expect(openSeriesProductiveAttempts(s, 'design', null)).toBe(0)
    expect(openSeriesAttempts(s, 'design', null)).toBe(8)
    expect(checkReviewBudget(budgetCounts(s, 'design', null), BUDGET).kind).toBe('hard-blocked')
  })

  it('[REQ-084 R8] void_attempts 부재 state는 두 계수가 같다 — 판정이 REQ-084 이전과 동일', () => {
    for (const n of [0, 4, 5, 7, 8]) {
      const s = st([openDesign(n)])
      expect(openSeriesProductiveAttempts(s, 'design', null)).toBe(openSeriesAttempts(s, 'design', null))
      expect(checkReviewBudget(budgetCounts(s, 'design', null), BUDGET).kind).toBe(
        n < 5 ? 'allow' : n < 8 ? 'needs-exception' : 'hard-blocked',
      )
    }
  })

  it('[REQ-084 DEC-4] voidAttempt: 열린 series 없으면 no-op', () => {
    const closed = { ...openDesign(3), closed_reason: 'approved' as const }
    const s = voidAttempt(st([closed]), 'design', null)
    expect((s.review_series as SeriesRecord[])[0]!.void_attempts).toBeUndefined()
  })
  it('⑦ recordAttempt는 refunded_attempts 불변·attempts 단조 증가(재시도 새 키)', () => {
    const s = recordAttempt(st([openDesign(5, 1)]), 'design', null)
    const rec = (s.review_series as SeriesRecord[])[0]!
    expect(rec.attempts).toBe(6) // 단조 증가 → 원장 자연키 #6(충돌 없음)
    expect(rec.refunded_attempts).toBe(1) // 환불은 refundAttempt만
    expect(openSeriesAttempts(s, 'design', null)).toBe(5) // 유효 = 6-1 = 실패 전 위치
  })
})
