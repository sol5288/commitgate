import { describe, it, expect } from 'vitest'
import {
  serializeExceptionGrantRow,
  parseExceptions,
  appendExceptionGrant,
  exceptionGrantRowProblems,
  exceptionGrantRowKey,
  findExistingGrant,
  materialEqual,
  parseRationale,
  type ExceptionGrantRow,
} from '../../scripts/req/lib/review-exception'
import { planReviewException } from '../../scripts/req/req-review-exception'
import type { WorkflowState, SeriesRecord } from '../../scripts/req/review-codex'

/** REQ-2026-055 phase-1 — 예외 grant 스키마·rationale·planReviewException(순수). fs·git 무의존. */
const grant = (over: Partial<ExceptionGrantRow> = {}): ExceptionGrantRow => ({
  ticket_id: 'REQ-2026-001',
  review_kind: 'design',
  phase_id: null,
  series_id: 'design:-#1',
  for_attempt: 6,
  method: '사람이 6회차 승인함',
  confirmed_at: '2026-07-25T05:00:00.000Z',
  rationale: { prev_findings: 'P1 두 건', changes: '경계 조건 수정', unresolved: '없음', retry_justification: '반례 해소돼 재리뷰 정당' },
  reconstructed: false,
  ...over,
})
const BUDGET = { autoBudget: 5, hardCap: 8, onSoftLimit: 'ask' } as const
const st = (series: SeriesRecord[]): WorkflowState => ({ id: 'REQ-2026-001', review_series: series }) as unknown as WorkflowState
const openDesign = (attempts: number, extra: Partial<SeriesRecord> = {}): SeriesRecord => ({
  series_id: 'design:-#1', review_kind: 'design', phase_id: null, attempts, closed_reason: null, ...extra,
})

describe('[review-exception] 스키마 검증·직렬화', () => {
  it('① 정상 round-trip', () => {
    const parsed = parseExceptions(serializeExceptionGrantRow(grant()))
    expect(parsed.problems).toEqual([])
    expect(parsed.rows).toEqual([grant()])
  })
  it('① 빈 method → 거부', () => {
    expect(exceptionGrantRowProblems(grant({ method: '  ' })).join(' ')).toContain('method가 비어 있음')
  })
  it('① rationale 섹션 비면 거부', () => {
    expect(exceptionGrantRowProblems(grant({ rationale: { ...grant().rationale, unresolved: '' } })).join(' ')).toContain('rationale.unresolved')
  })
  it('① 알 수 없는 top-level 키 거부', () => {
    expect(exceptionGrantRowProblems({ ...grant(), prompt: 'x' }).join(' ')).toContain('알 수 없는 키: prompt')
  })
  it('① for_attempt는 1 이상 정수', () => {
    expect(exceptionGrantRowProblems(grant({ for_attempt: 0 })).join(' ')).toContain('for_attempt는 1 이상 정수')
  })
})

describe('[review-exception] material 멱등(DEC-RE3·r02 P1)', () => {
  it('② 같은 자연키·material 같음(confirmed_at만 다름) → duplicate', () => {
    const existing = serializeExceptionGrantRow(grant({ confirmed_at: '2026-07-25T05:00:00.000Z' }))
    const r = appendExceptionGrant(existing, grant({ confirmed_at: '2026-07-25T09:00:00.000Z' }))
    expect(r.outcome).toBe('duplicate') // confirmed_at 달라도 method+rationale 같으면 멱등
  })
  it('② 같은 자연키·material 다름 → conflict(덮지 않음)', () => {
    const existing = serializeExceptionGrantRow(grant())
    const r = appendExceptionGrant(existing, grant({ method: '다른 승인' }))
    expect(r.outcome).toBe('conflict')
    expect(r.content).toBe(existing)
  })
  it('② 다른 회차 → appended(새 행)', () => {
    const existing = serializeExceptionGrantRow(grant({ for_attempt: 6 }))
    expect(appendExceptionGrant(existing, grant({ for_attempt: 7 })).outcome).toBe('appended')
  })
  it('materialEqual: method·rationale만 비교(confirmed_at 무시)', () => {
    expect(materialEqual(grant({ confirmed_at: 'a'.repeat(0) + '2026-07-25T05:00:00.000Z' }), grant({ confirmed_at: '2026-07-25T09:00:00.000Z' }))).toBe(true)
    expect(materialEqual(grant(), grant({ method: 'x' }))).toBe(false)
  })
  it('findExistingGrant: 자연키로 기존 행 반환(confirmed_at 재사용용)', () => {
    const existing = serializeExceptionGrantRow(grant({ confirmed_at: '2026-07-25T05:00:00.000Z' }))
    const found = findExistingGrant(existing, { ticket_id: 'REQ-2026-001', series_id: 'design:-#1', for_attempt: 6 })
    expect(found?.confirmed_at).toBe('2026-07-25T05:00:00.000Z')
    expect(findExistingGrant(existing, { ticket_id: 'REQ-2026-001', series_id: 'design:-#1', for_attempt: 7 })).toBeNull()
  })
  it('자연키: (ticket, series, for_attempt)', () => {
    const sep = String.fromCharCode(31)
    expect(exceptionGrantRowKey(grant()).split(sep)).toEqual(['REQ-2026-001', 'design:-#1', '6'])
  })
})

describe('[review-exception] parseRationale(DEC-RE2)', () => {
  const good = '## 직전 findings\nP1 두 건\n\n## 이번 변경\n경계 수정\n\n## 미해결\n없음\n\n## 재시도 근거\n정당함\n'
  it('③ 4섹션 다 있으면 ok', () => {
    const r = parseRationale(good)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.rationale.retry_justification).toBe('정당함')
  })
  it('③ 한 섹션 비면 어느 것인지 알린다', () => {
    const r = parseRationale(good.replace('없음', ''))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.problems.join(' ')).toContain('미해결')
  })
  it('③ 섹션 자체 누락도 문제', () => {
    const r = parseRationale('## 직전 findings\nx\n## 이번 변경\ny\n## 미해결\nz\n')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.problems.join(' ')).toContain('재시도 근거')
  })
})

describe('[review-exception] planReviewException(DEC-RE1)', () => {
  it('④ needs-exception(유효5·autoBudget5) → ok·for_attempt=6', () => {
    const p = planReviewException(st([openDesign(5)]), 'design', null, BUDGET)
    expect(p).toEqual({ ok: true, seriesId: 'design:-#1', forAttempt: 6 })
  })
  it('⑤ allow(유효4<autoBudget) → 거부', () => {
    const p = planReviewException(st([openDesign(4)]), 'design', null, BUDGET)
    expect(p.ok).toBe(false)
    if (!p.ok) expect(p.reason).toContain('아직 예외 불요')
  })
  it('⑥ hard-blocked(유효8≥hardCap) → 거부', () => {
    const p = planReviewException(st([openDesign(8)]), 'design', null, BUDGET)
    expect(p.ok).toBe(false)
    if (!p.ok) expect(p.reason).toContain('예외로도 불가')
  })
  it('⑦ 열린 series 없음 → 거부', () => {
    const p = planReviewException(st([]), 'design', null, BUDGET)
    expect(p.ok).toBe(false)
    if (!p.ok) expect(p.reason).toContain('열린 series가 없음')
  })
  it('⑧ terminal series → 거부(대체 REQ 안내)', () => {
    const terminal = openDesign(6, { closed_reason: 'human-resolution', human_resolution: { decision: 'terminate', method: 'm', decided_at: '2026-07-24T00:00:00.000Z' } })
    const p = planReviewException(st([terminal]), 'design', null, BUDGET)
    expect(p.ok).toBe(false)
    if (!p.ok) expect(p.hint).toContain('대체 REQ')
  })
  it('⑨ REQ-2026-054 상호작용: attempts=6·refunded=1 → 유효5 → needs-exception·for_attempt=6', () => {
    const p = planReviewException(st([openDesign(6, { refunded_attempts: 1 })]), 'design', null, BUDGET)
    expect(p).toEqual({ ok: true, seriesId: 'design:-#1', forAttempt: 6 })
  })
})
