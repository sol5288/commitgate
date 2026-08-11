/**
 * 로컬 관측 요약 집계 (REQ-2026-124) — `.doctor-runs` · `.review-calls` · `.verify-runs` 세 로그의
 * **순수 집계기**. 관측은 이미 쌓이는데 요약 수단이 없어 매번 손집계였던 공백을 메운다.
 *
 * 🔴 순수 모듈 — fs·git·config를 모른다. 로그 본문·verify-range 결과는 호출부(bin/report.ts)가 넘긴다.
 * 🔴 **추정 금지**: 원천이 없으면 섹션 자체가 부재다(0으로 단언하지 않는다). 손상 행은 건너뛰되
 *    파일별 개수를 드러낸다(침묵 무시 금지 — 기존 관측 소비 관례).
 * 🔴 정직한 명명: review 분포는 "시리즈당"이 아니라 **대상당 총 호출**이다(`archive_round`는 시리즈
 *    리셋이 없다 — 가설 폴더 M-7 정정). "검사별 적용 가능 수"는 로그에 없으므로 제공하지 않는다.
 */
import type { DeepVerifyReport } from './verify-range'

// ───────────────────────────── 공용: 관대 JSONL 파서 ──

function parseJsonl(content: string): { rows: Record<string, unknown>[]; skipped: number } {
  const rows: Record<string, unknown>[] = []
  let skipped = 0
  for (const line of content.split('\n')) {
    if (line.trim() === '') continue
    try {
      const v = JSON.parse(line) as unknown
      if (v && typeof v === 'object' && !Array.isArray(v)) rows.push(v as Record<string, unknown>)
      else skipped++
    } catch {
      skipped++
    }
  }
  return { rows, skipped }
}

/** 정확 분위수(정렬 후 인덱스 — 보간 없음·소표본에서 과장하지 않는 쪽). */
function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return sorted[idx] ?? null
}

// ───────────────────────────── 섹션 구조 ──

export interface DoctorSection {
  runs: number
  tickets: number
  warnOnlyRuns: number
  /** 검사별 발화(비-OK)·FAIL 수. */
  checks: { id: string; fired: number; fail: number }[]
  /**
   * 해소 관측(REQ-2026-117 subjects가 연 축): 과거에 발화한 (검사, subject) 쌍 중 **그 발화 이후의
   * 실행이 존재하고 최신 실행에서 같은 쌍이 비발화**인 것. subjects 없는 검사는 이 축에서 제외된다
   * — `resolvableChecks`가 그 경계를 드러낸다(낙관 추정 금지).
   */
  resolved: number
  openSubjects: number
  resolvableChecks: string[]
  /**
   * REQ-2026-129(스키마 v2가 연 축): 검사별 적용 가능 분모·발화율·차단 수. v2 행(evaluations 보유)만
   * 집계 — v1 행에서는 계산 불가라 `v1Rows`로 그 사실을 표기한다(추정 금지).
   */
  v2: {
    rows: number
    v1Rows: number
    checks: { id: string; applicable: number; notApplicable: number; fired: number; fail: number; blocked: number }[]
    reasonCodes: Record<string, number>
  } | null
}

export interface ReviewSection {
  calls: number
  /** (ticket, kind, phase) 대상 수와 대상당 총 호출 분포 — "시리즈당"이 아니다(정직한 명명). */
  targets: number
  callsPerTargetMedian: number | null
  callsPerTargetMax: number | null
  outcomes: Record<string, number>
  /** design 호출 중 delta_mode=true 비율(신규 필드 보유 행 한정 — 분모 함께 표기). */
  deltaDesignCalls: number
  deltaDesignWithField: number
  fullReviewReasons: Record<string, number>
  promptBytesP50: number | null
  promptBytesP95: number | null
  durationMsP50: number | null
  durationMsP95: number | null
}

export interface CiSection {
  runs: number
  byChoice: Record<string, number>
}

export interface EvidenceRange {
  base: string
  head: string
  /** 범위 결정 방식 — merge-base(기본) | explicit(--base/--head) | last(--last N). */
  source: 'merge-base' | 'explicit' | 'last'
  /** base==head — trunk 위 기본 실행 등. 0건은 "검증할 것이 없음"이지 "전부 정상"이 아니다. */
  empty: boolean
  /** 이 요약을 계산한 시각(로그 재사용이 아니라 지금 계산했음을 명시). */
  generatedAt: string
}

export interface EvidenceSection {
  /** verify-range **심층** 요약(REQ-2026-127 6범주 — 호출부가 산출·계산 불가면 섹션 부재). */
  range: EvidenceRange
  counts: DeepVerifyReport['counts']
  unproven: { sha: string; subject: string; note?: string }[]
  invalid: { sha: string; subject: string; problems: string[] }[]
  verificationNotes: string[]
  manifestProblems: number
  /** doctor 최신 실행의 D25/D30 subjects(재실행 없음 — 관측 시점은 그 행의 at). */
  latestDoctorAt: string | null
  d25Subjects: string[]
  d30Subjects: string[]
}

export interface Report {
  doctor?: DoctorSection
  review?: ReviewSection
  ci?: CiSection
  evidence?: EvidenceSection
  /**
   * evidence 섹션을 계산했는가(0.22.0 RC 보완 — **additive**).
   *
   * 🔴 예전에는 수집 실패를 그냥 null로 삼켜 `evidence` 섹션이 사라졌고, 사람이 보는 화면에는
   *    "분모 계산 불가"만 남았다 — **왜** 계산할 수 없었는지가 어디에도 없었다(trunk 미설정인지,
   *    base ref가 없는지, 수집이 터졌는지 구별 불가).
   * 🔴 기존 필드는 건드리지 않는다: 계산 실패 시 `evidence`가 부재하는 동작은 그대로다.
   *    이 두 필드는 **추가**될 뿐이므로 기존 JSON 소비자는 영향받지 않는다.
   * 🔴 필드명이 snake_case인 것은 의도적이다 — 소비자 계약으로 이름이 고정된 값이다.
   */
  verification_available: boolean
  /** 계산 불가 사유(기계 소비용 안정 문자열). 계산됐으면 null. 예: `base ref not found: v9.9.9`. */
  verification_unavailable_reason: string | null
  /** 파일별 건너뛴 손상 행 수(0이어도 원천이 있으면 기록 — "손상 없음"도 정보다). */
  problems: { file: string; skipped: number }[]
}

// ───────────────────────────── 집계 ──

interface NonOk {
  id?: unknown
  level?: unknown
  subjects?: unknown
}

function doctorSection(content: string, problems: Report['problems']): DoctorSection {
  const { rows, skipped } = parseJsonl(content)
  problems.push({ file: '.doctor-runs.jsonl', skipped })
  const tickets = new Set<string>()
  let warnOnly = 0
  const byCheck = new Map<string, { fired: number; fail: number }>()
  /** subject 상태 추적: key=`id subject` → 마지막으로 본 실행 인덱스와 발화 여부. */
  const lastFiredAt = new Map<string, number>()
  const resolvable = new Set<string>()
  rows.forEach((r, runIdx) => {
    if (typeof r.ticket_id === 'string') tickets.add(r.ticket_id)
    const nonok = Array.isArray(r.nonok) ? (r.nonok as NonOk[]) : []
    let hasFail = false
    let hasWarn = false
    for (const c of nonok) {
      const id = typeof c.id === 'string' ? c.id : '?'
      const e = byCheck.get(id) ?? { fired: 0, fail: 0 }
      e.fired++
      if (c.level === 'FAIL') {
        e.fail++
        hasFail = true
      } else hasWarn = true
      byCheck.set(id, e)
      if (Array.isArray(c.subjects)) {
        resolvable.add(id)
        for (const s of c.subjects) if (typeof s === 'string') lastFiredAt.set(`${id} ${s}`, runIdx)
      }
    }
    if (!hasFail && hasWarn) warnOnly++
  })
  // REQ-2026-129: v2 행(evaluations)만으로 분모·발화율·차단·reason 분포를 집계한다.
  interface Ev { id?: unknown; applicable?: unknown; outcome?: unknown; blocked?: unknown; reason_code?: unknown }
  let v2Rows = 0
  const v2ByCheck = new Map<string, { applicable: number; notApplicable: number; fired: number; fail: number; blocked: number }>()
  const reasonCodes: Record<string, number> = {}
  for (const r of rows) {
    if (!Array.isArray(r.evaluations)) continue
    v2Rows++
    for (const raw of r.evaluations as Ev[]) {
      const id = typeof raw.id === 'string' ? raw.id : '?'
      const e = v2ByCheck.get(id) ?? { applicable: 0, notApplicable: 0, fired: 0, fail: 0, blocked: 0 }
      if (raw.applicable === false) e.notApplicable++
      else e.applicable++
      if (raw.outcome === 'warn' || raw.outcome === 'fail') e.fired++
      if (raw.outcome === 'fail') e.fail++
      if (raw.blocked === true) e.blocked++
      v2ByCheck.set(id, e)
      if (typeof raw.reason_code === 'string') reasonCodes[raw.reason_code] = (reasonCodes[raw.reason_code] ?? 0) + 1
    }
  }
  // 해소 = 마지막 발화 이후의 실행이 존재(같은 쌍이 그 뒤 실행들에서 다시 안 나타남 — lastFiredAt이 곧 마지막 발화).
  let resolved = 0
  let open = 0
  for (const idx of lastFiredAt.values()) idx < rows.length - 1 ? resolved++ : open++
  return {
    runs: rows.length,
    tickets: tickets.size,
    v2:
      v2Rows === 0
        ? null
        : {
            rows: v2Rows,
            v1Rows: rows.length - v2Rows,
            checks: [...v2ByCheck.entries()]
              .map(([id, e]) => ({ id, ...e }))
              .sort((a, b) => b.fired - a.fired || a.id.localeCompare(b.id)),
            reasonCodes,
          },
    warnOnlyRuns: warnOnly,
    checks: [...byCheck.entries()].map(([id, v]) => ({ id, ...v })).sort((a, b) => b.fired - a.fired),
    resolved,
    openSubjects: open,
    resolvableChecks: [...resolvable].sort(),
  }
}

function reviewSection(content: string, problems: Report['problems']): ReviewSection {
  const { rows, skipped } = parseJsonl(content)
  problems.push({ file: '.review-calls.jsonl', skipped })
  const byTarget = new Map<string, number>()
  const outcomes: Record<string, number> = {}
  const reasons: Record<string, number> = {}
  const promptBytes: number[] = []
  const durations: number[] = []
  let deltaWithField = 0
  let deltaTrue = 0
  for (const r of rows) {
    const key = `${String(r.ticket_id ?? '?')} ${String(r.review_kind ?? '?')} ${String(r.phase_id ?? '')}`
    byTarget.set(key, (byTarget.get(key) ?? 0) + 1)
    const outcome = typeof r.outcome === 'string' ? r.outcome : '?'
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1
    if (r.review_kind === 'design' && 'delta_mode' in r) {
      deltaWithField++
      if (r.delta_mode === true) deltaTrue++
    }
    if (typeof r.full_review_reason === 'string') reasons[r.full_review_reason] = (reasons[r.full_review_reason] ?? 0) + 1
    if (typeof r.prompt_bytes === 'number') promptBytes.push(r.prompt_bytes)
    if (typeof r.review_duration_ms === 'number') durations.push(r.review_duration_ms)
  }
  const counts = [...byTarget.values()].sort((a, b) => a - b)
  promptBytes.sort((a, b) => a - b)
  durations.sort((a, b) => a - b)
  return {
    calls: rows.length,
    targets: byTarget.size,
    callsPerTargetMedian: percentile(counts, 50),
    callsPerTargetMax: counts.length ? counts[counts.length - 1]! : null,
    outcomes,
    deltaDesignCalls: deltaTrue,
    deltaDesignWithField: deltaWithField,
    fullReviewReasons: reasons,
    promptBytesP50: percentile(promptBytes, 50),
    promptBytesP95: percentile(promptBytes, 95),
    durationMsP50: percentile(durations, 50),
    durationMsP95: percentile(durations, 95),
  }
}

function ciSection(content: string, problems: Report['problems']): CiSection {
  const { rows, skipped } = parseJsonl(content)
  problems.push({ file: '.verify-runs.jsonl', skipped })
  const byChoice: Record<string, number> = {}
  for (const r of rows) {
    const c = typeof r.ci === 'string' ? r.ci : '?'
    byChoice[c] = (byChoice[c] ?? 0) + 1
  }
  return { runs: rows.length, byChoice }
}

function latestDoctorSubjects(content: string): Pick<EvidenceSection, 'latestDoctorAt' | 'd25Subjects' | 'd30Subjects'> {
  const { rows } = parseJsonl(content)
  const last = rows[rows.length - 1]
  if (!last) return { latestDoctorAt: null, d25Subjects: [], d30Subjects: [] }
  const nonok = Array.isArray(last.nonok) ? (last.nonok as NonOk[]) : []
  const of = (id: string): string[] => {
    const c = nonok.find((x) => x.id === id)
    return Array.isArray(c?.subjects) ? (c!.subjects as unknown[]).filter((s): s is string => typeof s === 'string') : []
  }
  return { latestDoctorAt: typeof last.at === 'string' ? last.at : null, d25Subjects: of('D25'), d30Subjects: of('D30') }
}

/**
 * verify-range 수집 결과. 실패는 **사유를 들고** 온다 — 호출부가 null로 삼키지 않게 하려는 것이
 * 이 타입의 존재 이유다(0.22.0 RC 보완).
 */
export type VerifyRangeOutcome =
  | { ok: true; report: DeepVerifyReport; range: EvidenceRange }
  | { ok: false; reason: string }

export interface BuildReportInput {
  doctorRuns: string | null
  reviewCalls: string | null
  verifyRuns: string | null
  verifyRange: VerifyRangeOutcome
}

export function buildReport(input: BuildReportInput): Report {
  const problems: Report['problems'] = []
  const report: Report = {
    verification_available: input.verifyRange.ok,
    verification_unavailable_reason: input.verifyRange.ok ? null : input.verifyRange.reason,
    problems,
  }
  if (input.doctorRuns !== null) report.doctor = doctorSection(input.doctorRuns, problems)
  if (input.reviewCalls !== null) report.review = reviewSection(input.reviewCalls, problems)
  if (input.verifyRuns !== null) report.ci = ciSection(input.verifyRuns, problems)
  if (input.verifyRange.ok) {
    const latest = input.doctorRuns !== null ? latestDoctorSubjects(input.doctorRuns) : { latestDoctorAt: null, d25Subjects: [], d30Subjects: [] }
    const { report: deep, range } = input.verifyRange
    report.evidence = {
      range,
      counts: deep.counts,
      unproven: deep.unproven.slice(0, 8),
      invalid: deep.invalid.slice(0, 8),
      verificationNotes: deep.verificationNotes,
      manifestProblems: deep.manifestProblems,
      ...latest,
    }
  }
  return report
}
