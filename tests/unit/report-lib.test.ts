/**
 * 로컬 관측 요약 집계(REQ-2026-124 phase-1) — fixture 로그의 손계산 기대값 대조.
 */
import { describe, it, expect } from 'vitest'
import { buildReport } from '../../scripts/req/lib/report'


const doctorLog = [
  // run0: D30이 REQ-A·REQ-B 발화(WARN) + D10 FAIL
  { ticket_id: 'REQ-1', at: '2026-08-01T00:00:00.000Z', verdict: 'FAIL', evaluated: 24, nonok: [
    { id: 'D30', level: 'WARN', subjects: ['REQ-A', 'REQ-B'] },
    { id: 'D10', level: 'FAIL' },
  ] },
  // run1: D30이 REQ-B만 발화 → REQ-A는 해소
  { ticket_id: 'REQ-1', at: '2026-08-02T00:00:00.000Z', verdict: 'PASS', evaluated: 24, nonok: [
    { id: 'D30', level: 'WARN', subjects: ['REQ-B'] },
  ] },
  // run2: 전부 OK → REQ-B도 해소
  { ticket_id: 'REQ-2', at: '2026-08-03T00:00:00.000Z', verdict: 'PASS', evaluated: 24, nonok: [] },
].map((r) => JSON.stringify(r)).join('\n') + '\n'

const reviewLog = [
  { ticket_id: 'REQ-1', review_kind: 'design', phase_id: null, archive_round: 1, outcome: 'needs-fix', findings_count: 2, observations_count: 0, timestamp: 't', policy_version: 'p', prompt_bytes: 100, review_duration_ms: 10, delta_mode: false, full_review_reason: 'no-baseline' },
  { ticket_id: 'REQ-1', review_kind: 'design', phase_id: null, archive_round: 2, outcome: 'approved', findings_count: 0, observations_count: 0, timestamp: 't', policy_version: 'p', prompt_bytes: 300, review_duration_ms: 30, delta_mode: true },
  { ticket_id: 'REQ-1', review_kind: 'phase', phase_id: 'p1', archive_round: 1, outcome: 'approved', findings_count: 0, observations_count: 0, timestamp: 't', policy_version: 'p', prompt_bytes: 200, review_duration_ms: 20 },
].map((r) => JSON.stringify(r)).join('\n') + '\n'

const verifyLog = [
  { at: 't', base: 'b', head: 'h', counts: { merge: 0, bookkeeping: 1, approved: 1, unproven: 0 }, manifest_problems: 0, strict: false, ci: 'skipped-default', exit: 0 },
  { at: 't', base: 'b', head: 'h', counts: { merge: 0, bookkeeping: 1, approved: 1, unproven: 0 }, manifest_problems: 0, strict: false, ci: 'checked-ok', exit: 0 },
].map((r) => JSON.stringify(r)).join('\n') + '\n'

const vr = {
  ok: true as const,
  report: {
    entries: [],
    counts: { merge: 1, bookkeeping: 5, approved: 2, attested: 0, 'invalid-evidence': 0, unproven: 1 },
    unproven: [{ sha: 'a'.repeat(40), subject: 'chore: setup' }],
    invalid: [],
    manifestProblems: 0,
    verificationNotes: [],
  },
  range: {
    base: 'b'.repeat(40),
    head: 'h'.repeat(8) + 'a'.repeat(32),
    source: 'merge-base' as const,
    empty: false,
    generatedAt: '2026-08-10T00:00:00.000Z',
  },
}

describe('[REQ-2026-124] buildReport — 섹션 산식(손계산 대조)', () => {
  const report = buildReport({ doctorRuns: doctorLog, reviewCalls: reviewLog, verifyRuns: verifyLog, verifyRange: vr })

  it('doctor: 실행·티켓·warnOnly·검사별 발화/FAIL', () => {
    expect(report.doctor).toMatchObject({ runs: 3, tickets: 2, warnOnlyRuns: 1 })
    expect(report.doctor!.checks).toEqual([
      { id: 'D30', fired: 2, fail: 0 },
      { id: 'D10', fired: 1, fail: 1 },
    ])
  })

  it('doctor 해소 관측: REQ-A(run0 이후 실행 존재)·REQ-B(run1 이후 실행 존재) 둘 다 해소·미해소 0', () => {
    expect(report.doctor!.resolved).toBe(2)
    expect(report.doctor!.openSubjects).toBe(0)
    // subjects를 낸 검사만 해소 축에 있다 — D10은 아니다(낙관 추정 금지 경계).
    expect(report.doctor!.resolvableChecks).toEqual(['D30'])
  })

  it('review: 대상당 총 호출("시리즈당" 아님)·outcome·delta 분모·reason·분위수', () => {
    const r = report.review!
    expect(r.calls).toBe(3)
    expect(r.targets).toBe(2) // (REQ-1,design)·(REQ-1,phase,p1)
    expect(r.callsPerTargetMedian).toBe(2) // [1,2] — 보간 없는 인덱스 분위(짝수 n은 상위측) 관례
    expect(r.callsPerTargetMax).toBe(2)
    expect(r.outcomes).toEqual({ 'needs-fix': 1, approved: 2 })
    expect(r.deltaDesignWithField).toBe(2) // design 중 delta_mode 키 보유 행
    expect(r.deltaDesignCalls).toBe(1)
    expect(r.fullReviewReasons).toEqual({ 'no-baseline': 1 })
    expect(r.promptBytesP50).toBe(200) // [100,200,300] idx=floor(1.5)=1
    expect(r.durationMsP95).toBe(30)
  })

  it('ci: 선택 분포', () => {
    expect(report.ci).toEqual({ runs: 2, byChoice: { 'skipped-default': 1, 'checked-ok': 1 } })
  })

  it('evidence: verify-range counts + 최신 doctor 행의 D25/D30 subjects', () => {
    const e = report.evidence!
    expect(e.counts.unproven).toBe(1)
    expect(e.unproven).toHaveLength(1)
    expect(e.latestDoctorAt).toBe('2026-08-03T00:00:00.000Z')
    expect(e.d30Subjects).toEqual([]) // 최신 실행은 전부 OK
  })

  it('problems: 원천별 skipped 기록(0이어도 — "손상 없음"도 정보)', () => {
    expect(report.problems).toEqual([
      { file: '.doctor-runs.jsonl', skipped: 0 },
      { file: '.review-calls.jsonl', skipped: 0 },
      { file: '.verify-runs.jsonl', skipped: 0 },
    ])
  })
})

describe('[REQ-2026-124] 부재·손상 — 추정 금지', () => {
  it('원천 null → 섹션 부재(0으로 단언하지 않는다)', () => {
    const r = buildReport({ doctorRuns: null, reviewCalls: null, verifyRuns: null, verifyRange: { ok: false, reason: 'trunk branch not configured (req.config.json trunkBranch)' } })
    expect(r.doctor).toBeUndefined()
    expect(r.review).toBeUndefined()
    expect(r.ci).toBeUndefined()
    expect(r.evidence).toBeUndefined()
    expect(r.problems).toEqual([])
  })

  it('손상 행은 건너뛰고 개수로 드러낸다 — 나머지 집계는 유효', () => {
    const dirty = 'not-json\n' + doctorLog + '[1,2]\n'
    const r = buildReport({ doctorRuns: dirty, reviewCalls: null, verifyRuns: null, verifyRange: { ok: false, reason: 'trunk branch not configured (req.config.json trunkBranch)' } })
    expect(r.problems).toEqual([{ file: '.doctor-runs.jsonl', skipped: 2 }])
    expect(r.doctor!.runs).toBe(3)
  })
})

describe('[REQ-2026-129] doctor v2 집계 — 분모·발화율·차단·reason 분포', () => {
  const v2Row = (evals: unknown[], over: Record<string, unknown> = {}): string =>
    JSON.stringify({ ticket_id: 'REQ-1', at: 't', verdict: 'PASS', evaluated: evals.length, nonok: [], schema_version: 2, evaluations: evals, ...over })
  const v1Row = JSON.stringify({ ticket_id: 'REQ-0', at: 't0', verdict: 'PASS', evaluated: 25, nonok: [] })

  it('v2 행만 분모로 집계하고 v1 행 수를 표기한다(추정 금지)', () => {
    const log = [
      v1Row,
      v2Row([
        { id: 'D30', applicable: true, outcome: 'warn', blocked: false, reason_code: 'stranded' },
        { id: 'D25', applicable: false, outcome: 'not-applicable', blocked: false },
        { id: 'D10', applicable: true, outcome: 'fail', blocked: true, reason_code: 'd10-fail' },
      ]),
      v2Row([
        { id: 'D30', applicable: true, outcome: 'pass', blocked: false },
        { id: 'D25', applicable: true, outcome: 'pass', blocked: false },
        { id: 'D10', applicable: true, outcome: 'pass', blocked: false },
      ]),
    ].join('\n') + '\n'
    const r = buildReport({ doctorRuns: log, reviewCalls: null, verifyRuns: null, verifyRange: { ok: false, reason: 'trunk branch not configured (req.config.json trunkBranch)' } })
    const v2 = r.doctor!.v2!
    expect(v2.rows).toBe(2)
    expect(v2.v1Rows).toBe(1)
    expect(v2.checks.find((c) => c.id === 'D30')).toEqual({ id: 'D30', applicable: 2, notApplicable: 0, fired: 1, fail: 0, blocked: 0 })
    expect(v2.checks.find((c) => c.id === 'D25')).toEqual({ id: 'D25', applicable: 1, notApplicable: 1, fired: 0, fail: 0, blocked: 0 })
    expect(v2.checks.find((c) => c.id === 'D10')).toEqual({ id: 'D10', applicable: 2, notApplicable: 0, fired: 1, fail: 1, blocked: 1 })
    expect(v2.reasonCodes).toEqual({ stranded: 1, 'd10-fail': 1 })
  })

  it('v2 행이 없으면 v2=null — 구버전 로그에서는 분모 계산 불가를 명시', () => {
    const r = buildReport({ doctorRuns: `${v1Row}\n`, reviewCalls: null, verifyRuns: null, verifyRange: { ok: false, reason: 'trunk branch not configured (req.config.json trunkBranch)' } })
    expect(r.doctor!.v2).toBeNull()
  })
})
