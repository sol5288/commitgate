import { describe, it, expect } from 'vitest'
import {
  orphanPhaseSeries,
  inconclusiveSeries,
  hasInconclusiveSeries,
  phaseIds,
  type StateLike,
} from '../../scripts/req/lib/review-series'
import { readTicketFacts } from '../../bin/integrate'

/**
 * REQ-2026-163 phase-1 — orphan series 판정.
 *
 * 🔴 헤드라인 단언 둘:
 *   1. **orphan 은 미판정으로 세지 않는다** — `phases[]` 에 없는 phase 의 열린 series 는 현재 phase 들이
 *      검수됐는지에 대해 아무것도 말하지 않는다. 세면 리뷰 지적을 따른 개명이 자율 통합을 영구 차단한다.
 *   2. **좁게만 뺀다** — `design:` series, 정상 phase 의 열린 series, 예산 축은 **그대로**다.
 */

/** REQ-2026-161 이 실제로 막혔던 형태(개명 전 series 가 열린 채 남음). */
const REQ_161_SHAPE: StateLike = {
  phases: [
    { id: 'phase-1-command-surface-predicate' },
    { id: 'phase-2-sync-scripts-optin' },
    { id: 'phase-3-check-c6' },
  ],
  review_series: [
    { series_id: 'design:-#1', review_kind: 'design', phase_id: null, closed_reason: 'approved' },
    { series_id: 'phase:phase-1-command-surface-predicate#1', review_kind: 'phase', phase_id: 'phase-1-command-surface-predicate', closed_reason: 'approved' },
    // 🔴 개명으로 사라진 phase — attempt 는 전부 닫혔는데 series 만 열려 있다.
    { series_id: 'phase:phase-2-check-c6#1', review_kind: 'phase', phase_id: 'phase-2-check-c6', closed_reason: null },
    { series_id: 'phase:phase-3-check-c6#1', review_kind: 'phase', phase_id: 'phase-3-check-c6', closed_reason: 'approved' },
  ],
}

describe('[review-series] orphanPhaseSeries — 사라진 phase 의 열린 series', () => {
  it('🔴 REQ-2026-161 형태: 개명으로 사라진 phase 의 series 를 orphan 으로 집는다', () => {
    expect(orphanPhaseSeries(REQ_161_SHAPE)).toEqual([
      { seriesId: 'phase:phase-2-check-c6#1', phaseId: 'phase-2-check-c6' },
    ])
  })

  it('phases[] 에 있는 phase 의 열린 series 는 orphan 이 아니다', () => {
    const st: StateLike = {
      phases: [{ id: 'phase-1-x' }],
      review_series: [{ series_id: 'phase:phase-1-x#1', review_kind: 'phase', phase_id: 'phase-1-x', closed_reason: null }],
    }
    expect(orphanPhaseSeries(st)).toEqual([])
  })

  it('🔴 design series 는 대상이 아니다 — phases[] 와 무관하므로 열려 있으면 그대로 미판정', () => {
    const st: StateLike = {
      phases: [{ id: 'phase-1-x' }],
      review_series: [{ series_id: 'design:-#1', review_kind: 'design', phase_id: null, closed_reason: null }],
    }
    expect(orphanPhaseSeries(st)).toEqual([])
    expect(hasInconclusiveSeries(st)).toBe(true)
  })

  it('이미 닫힌 series 는 orphan 이 아니다(열린 것만 본다)', () => {
    const st: StateLike = {
      phases: [],
      review_series: [{ series_id: 'phase:gone#1', review_kind: 'phase', phase_id: 'gone', closed_reason: 'orphaned' }],
    }
    expect(orphanPhaseSeries(st)).toEqual([])
  })

  it('🔴 phase_id 를 읽지 못하면 orphan 으로 보지 않는다 — 모르는 것을 "없는 phase"로 읽지 않는다', () => {
    const st: StateLike = {
      phases: [{ id: 'phase-1-x' }],
      review_series: [
        { series_id: 'phase:?#1', review_kind: 'phase', phase_id: null, closed_reason: null },
        { series_id: 'phase:?#2', review_kind: 'phase', closed_reason: null },
        { series_id: 'phase:?#3', review_kind: 'phase', phase_id: 42, closed_reason: null },
      ],
    }
    expect(orphanPhaseSeries(st)).toEqual([])
    expect(hasInconclusiveSeries(st)).toBe(true) // 판정 불가는 통과 사유가 아니다
  })

  it('🔴 series_id 를 파싱하지 않는다 — phase id 에 # 가 있어도 옳다', () => {
    const st: StateLike = {
      phases: [{ id: 'phase-1-a#b' }],
      review_series: [
        { series_id: 'phase:phase-1-a#b#1', review_kind: 'phase', phase_id: 'phase-1-a#b', closed_reason: null },
        { series_id: 'phase:gone#c#1', review_kind: 'phase', phase_id: 'gone#c', closed_reason: null },
      ],
    }
    expect(orphanPhaseSeries(st)).toEqual([{ seriesId: 'phase:gone#c#1', phaseId: 'gone#c' }])
  })

  it('형태가 깨진 원소는 조용히 건너뛴다(판정을 던지지 않는다)', () => {
    const st = { phases: [null, { id: '' }, 'x', { id: 'ok' }], review_series: [null, 'x', 7] } as unknown as StateLike
    expect(phaseIds(st)).toEqual(new Set(['ok']))
    expect(orphanPhaseSeries(st)).toEqual([])
    expect(hasInconclusiveSeries(st)).toBe(false)
  })

  it('phases·review_series 부재도 판정 가능하다', () => {
    expect(orphanPhaseSeries({})).toEqual([])
    expect(hasInconclusiveSeries({})).toBe(false)
  })
})

describe('[review-series] inconclusiveSeries — orphan 만 뺀다', () => {
  it('🔴 REQ-2026-161 형태에서 미판정이 0 이 된다(= 통합이 풀린다)', () => {
    expect(inconclusiveSeries(REQ_161_SHAPE)).toEqual([])
    expect(hasInconclusiveSeries(REQ_161_SHAPE)).toBe(false)
  })

  it('🔴 정상 phase 의 열린 series 는 그대로 미판정이다 — 좁게만 뺀다', () => {
    const st: StateLike = {
      phases: [{ id: 'live' }],
      review_series: [
        { series_id: 'phase:live#1', review_kind: 'phase', phase_id: 'live', closed_reason: null },
        { series_id: 'phase:gone#1', review_kind: 'phase', phase_id: 'gone', closed_reason: null },
      ],
    }
    expect(inconclusiveSeries(st)).toEqual(['phase:live#1'])
    expect(hasInconclusiveSeries(st)).toBe(true)
  })

  it('열린 것이 없으면 빈 배열', () => {
    const st: StateLike = {
      phases: [{ id: 'a' }],
      review_series: [{ series_id: 'phase:a#1', review_kind: 'phase', phase_id: 'a', closed_reason: 'approved' }],
    }
    expect(inconclusiveSeries(st)).toEqual([])
  })
})

/**
 * 🔴 **예산 축 불변**(설계 DEC-2). 이 모듈은 `attempts` 를 보지 않는다 — 개명으로 리뷰 예산이
 *    리셋되면 hardCap 이 우회로가 된다. `integrate` 의 `budgetHardCapReached` 는 orphan 도 그대로 센다.
 */
describe('[review-series] 예산 축을 건드리지 않는다', () => {
  it('orphan 이어도 attempts 는 이 술어의 관심사가 아니다', () => {
    const st: StateLike = {
      phases: [],
      review_series: [{ series_id: 'phase:gone#1', review_kind: 'phase', phase_id: 'gone', attempts: 8, closed_reason: null } as never],
    }
    // 미판정에서는 빠지지만…
    expect(hasInconclusiveSeries(st)).toBe(false)
    // …attempts 는 그대로 남아 있어 integrate 의 예산 판정이 계속 센다.
    const raw = (st.review_series as { attempts?: number }[])[0]
    expect(raw?.attempts).toBe(8)
  })
})

/**
 * 🔴 **배선 회귀**(phase-1 r01 P1). 순수 술어만 테스트하면 `bin/integrate.ts` 의 호출을 옛
 *    `series.some(s => s.closed_reason === null)` 로 되돌려도 위 테스트가 전부 통과한다 —
 *    그리고 REQ-2026-161 형태의 `auto` 통합은 다시 영구 차단된다.
 *    그래서 **실제 `readTicketFacts` 경로**로 고정한다(호출을 되돌리면 red).
 */
describe('[review-series] integrate 배선 — readTicketFacts 실경로', () => {
  const TICKET = 'REQ-2026-161'
  const STATE_PATH = `workflow/${TICKET}/state.json`
  const HARD_CAP = 8

  const readBlobsWith = (state: unknown) => (_ref: string, paths: readonly string[]) =>
    new Map(paths.map((p) => [p, p === STATE_PATH ? Buffer.from(JSON.stringify(state), 'utf8') : null]))

  /** 개명으로 사라진 phase 의 series 가 열린 채 남은 실제 형태. */
  const orphanState = {
    req_id: TICKET,
    risk_level: 'LOW',
    phases: [{ id: 'phase-3-check-c6' }],
    review_series: [
      { series_id: 'phase:phase-2-check-c6#1', review_kind: 'phase', phase_id: 'phase-2-check-c6', attempts: 2, closed_reason: null },
      { series_id: 'phase:phase-3-check-c6#1', review_kind: 'phase', phase_id: 'phase-3-check-c6', attempts: 1, closed_reason: 'approved' },
    ],
  }

  it('🔴 REQ-2026-161 형태에서 reviewInconclusive=false — 자율 통합이 풀린다', () => {
    const f = readTicketFacts(readBlobsWith(orphanState), 'HEADSHA', 'workflow', TICKET, HARD_CAP)
    expect(f.stateUnreadable).toBe(false)
    expect(f.reviewInconclusive).toBe(false)
  })

  it('🔴 정상 phase 의 열린 series 는 실경로에서도 여전히 막는다(과잉 완화 아님)', () => {
    const live = {
      ...orphanState,
      review_series: [{ series_id: 'phase:phase-3-check-c6#1', review_kind: 'phase', phase_id: 'phase-3-check-c6', attempts: 1, closed_reason: null }],
    }
    expect(readTicketFacts(readBlobsWith(live), 'HEADSHA', 'workflow', TICKET, HARD_CAP).reviewInconclusive).toBe(true)
  })

  it('🔴 예산 축은 orphan 도 그대로 센다 — 개명이 hardCap 우회로가 되지 않는다', () => {
    const spent = {
      ...orphanState,
      review_series: [{ series_id: 'phase:gone#1', review_kind: 'phase', phase_id: 'gone', attempts: HARD_CAP, closed_reason: null }],
    }
    const f = readTicketFacts(readBlobsWith(spent), 'HEADSHA', 'workflow', TICKET, HARD_CAP)
    expect(f.reviewInconclusive).toBe(false) // 미판정에서는 빠지지만
    expect(f.budgetHardCapReached).toBe(true) // 예산은 그대로 센다
  })

  it('design series 가 열려 있으면 실경로에서도 미판정이다', () => {
    const d = { ...orphanState, review_series: [{ series_id: 'design:-#1', review_kind: 'design', phase_id: null, attempts: 1, closed_reason: null }] }
    expect(readTicketFacts(readBlobsWith(d), 'HEADSHA', 'workflow', TICKET, HARD_CAP).reviewInconclusive).toBe(true)
  })
})
