/**
 * 커밋되는 **리뷰 예외 부여 원장** (REQ-2026-055·DEC-RE3).
 *
 * needs-exception 구간에서 사람이 부여한 예외의 **구조화 rationale**을 durable하게 남긴다. `review_exception_confirmed`
 * (state.json scratch)는 소비 후 null이 되지만 이 파일은 남아 "왜 예산을 넘겼나"의 감사가 된다.
 *
 * 🔴 **B1 review-ledger 스키마를 건드리지 않는다**(전용 sibling 파일) — 릴리스된 원장에 필수 키를 더하면 기존
 *    커밋 원장이 "필수 키 누락"으로 D5 fail-closed된다(B1 자체 경고). 이 파일은 자체 스키마다.
 * 🔴 review-ledger가 본문을 뺀 것과 달리 이 파일은 rationale **본문을 담는다** — 이 파일의 목적이 그 내용이다.
 *
 * 순수 모듈 — fs·git을 모른다. 부작용은 호출부가 낸다(`lib/review-ledger`·`lib/close-proof`와 같은 태도).
 */
import { isValidIsoInstant } from './evidence'
import type { ReviewKind } from './review-types'

/** 예외 부여 파일의 basename. `review-ledger.jsonl`·`ticket-close.jsonl`과 같은 `responses/` 디렉터리. */
export const EXCEPTION_BASENAME = 'review-exceptions.jsonl'

/** 티켓 `responses/` 기준 예외 원장의 repo-상대 경로. */
export function exceptionsPath(ticketRel: string): string {
  return `${ticketRel.replace(/\\/g, '/').replace(/\/+$/, '')}/responses/${EXCEPTION_BASENAME}`
}

/** 구조화 rationale 4섹션(전부 비어있지 않아야 함). */
export interface Rationale {
  prev_findings: string
  changes: string
  unresolved: string
  retry_justification: string
}
export const RATIONALE_KEYS = ['prev_findings', 'changes', 'unresolved', 'retry_justification'] as const

export interface ExceptionGrantRow {
  ticket_id: string
  review_kind: ReviewKind
  phase_id: string | null
  series_id: string
  /** 이 예외가 유효한 회차(= consumeReviewException의 for_attempt·checkReviewBudget의 attempt). */
  for_attempt: number
  /** 받은 승인 문장 그대로. */
  method: string
  confirmed_at: string
  rationale: Rationale
  /** 사후 복원 행인지(원본과 구별). 정상 부여는 false. */
  reconstructed: boolean
}

/** 직렬화 키 순서(고정) + 허용키 화이트리스트. */
export const EXCEPTION_KEYS = [
  'ticket_id',
  'review_kind',
  'phase_id',
  'series_id',
  'for_attempt',
  'method',
  'confirmed_at',
  'rationale',
  'reconstructed',
] as const

/** 한 줄 직렬화(JSONL): 고정 키 순서(rationale 내부도 고정) + 끝 개행. */
export function serializeExceptionGrantRow(row: ExceptionGrantRow): string {
  const rationale: Record<string, unknown> = {}
  for (const k of RATIONALE_KEYS) rationale[k] = row.rationale[k]
  const o: Record<string, unknown> = {}
  for (const k of EXCEPTION_KEYS) o[k] = k === 'rationale' ? rationale : row[k]
  return `${JSON.stringify(o)}\n`
}

/** 자연키 구분자 — US(0x1F). 식별자에 나타날 수 없는 제어문자(review-ledger와 같은 기법·소스에 리터럴 금지). */
const KEY_SEP = String.fromCharCode(31)

/** 자연키 — `(ticket, series, for_attempt)`. 한 series의 한 회차에 예외 1개. */
export function exceptionGrantRowKey(row: Pick<ExceptionGrantRow, 'ticket_id' | 'series_id' | 'for_attempt'>): string {
  return [row.ticket_id, row.series_id, String(row.for_attempt)].join(KEY_SEP)
}

/** rationale 객체 형식 문제(순수). 빈 배열=정상. 4섹션 전부 비어있지 않은 문자열. */
function rationaleProblems(raw: unknown): string[] {
  const p: string[] = []
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ['rationale가 객체가 아님']
  const r = raw as Record<string, unknown>
  const allowed = new Set<string>(RATIONALE_KEYS)
  for (const k of Object.keys(r)) if (!allowed.has(k)) p.push(`rationale 알 수 없는 키: ${k}`)
  for (const k of RATIONALE_KEYS) {
    const v = r[k]
    if (typeof v !== 'string' || v.trim() === '') p.push(`rationale.${k}가 비어 있음`)
  }
  return p
}

/** 행 하나의 형식 문제 목록(순수). 빈 배열 = 정상. 모르는 top-level 키는 거부(주입 방어). */
export function exceptionGrantRowProblems(raw: unknown): string[] {
  const p: string[] = []
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ['객체가 아님']
  const r = raw as Record<string, unknown>
  const allowed = new Set<string>(EXCEPTION_KEYS)
  for (const k of Object.keys(r)) if (!allowed.has(k)) p.push(`알 수 없는 키: ${k}`)
  for (const k of EXCEPTION_KEYS) if (!(k in r)) p.push(`필수 키 누락: ${k}`)
  if (p.length) return p

  if (typeof r.ticket_id !== 'string' || r.ticket_id === '') p.push('ticket_id가 비어 있음')
  if (r.review_kind !== 'design' && r.review_kind !== 'phase') p.push(`review_kind 부적합: ${String(r.review_kind)}`)
  if (r.phase_id !== null && (typeof r.phase_id !== 'string' || r.phase_id === '')) p.push('phase_id는 null이거나 비지 않은 문자열')
  if (typeof r.series_id !== 'string' || r.series_id === '') p.push('series_id가 비어 있음')
  if (typeof r.for_attempt !== 'number' || !Number.isInteger(r.for_attempt) || r.for_attempt < 1) p.push('for_attempt는 1 이상 정수')
  if (typeof r.method !== 'string' || r.method.trim() === '') p.push('method가 비어 있음')
  if (!isValidIsoInstant(r.confirmed_at)) p.push('confirmed_at이 ISO instant가 아님')
  if (typeof r.reconstructed !== 'boolean') p.push('reconstructed는 boolean')
  p.push(...rationaleProblems(r.rationale))
  return p
}

export interface ParsedExceptions {
  rows: ExceptionGrantRow[]
  problems: string[]
}

/** 본문 파싱(순수). 빈 줄 무시, 파싱 불가·형식 위반·자연키 중복은 problems로 드러낸다(조용히 건너뛰지 않음). */
export function parseExceptions(content: string): ParsedExceptions {
  const rows: ExceptionGrantRow[] = []
  const problems: string[] = []
  const seen = new Set<string>()
  content.split('\n').forEach((line, i) => {
    if (line.trim() === '') return
    let raw: unknown
    try {
      raw = JSON.parse(line)
    } catch {
      problems.push(`line ${i + 1}: JSON 파싱 실패`)
      return
    }
    const ps = exceptionGrantRowProblems(raw)
    if (ps.length) {
      problems.push(...ps.map((m) => `line ${i + 1}: ${m}`))
      return
    }
    const row = raw as ExceptionGrantRow
    const key = exceptionGrantRowKey(row)
    if (seen.has(key)) problems.push(`line ${i + 1}: 자연키 중복(${row.series_id} for_attempt=${row.for_attempt})`)
    seen.add(key)
    rows.push(row)
  })
  return { rows, problems }
}

/** material 동일성(순수) — method + rationale만 비교(confirmed_at 제외). 재실행 멱등 판정용. */
export function materialEqual(a: ExceptionGrantRow, b: ExceptionGrantRow): boolean {
  if (a.method !== b.method) return false
  return RATIONALE_KEYS.every((k) => a.rationale[k] === b.rationale[k])
}

/** 자연키로 기존 부여 행 조회(순수). 없으면 null. 호출부가 confirmed_at 재사용에 쓴다(재실행 복구). */
export function findExistingGrant(content: string, key: Pick<ExceptionGrantRow, 'ticket_id' | 'series_id' | 'for_attempt'>): ExceptionGrantRow | null {
  const parsed = parseExceptions(content)
  if (parsed.problems.length) return null // 손상은 append 단계가 conflict로 처리한다.
  const k = exceptionGrantRowKey(key)
  return parsed.rows.find((r) => exceptionGrantRowKey(r) === k) ?? null
}

export type ExceptionAppendOutcome = 'appended' | 'duplicate' | 'conflict'
export interface ExceptionAppendResult {
  outcome: ExceptionAppendOutcome
  content: string
  problems: string[]
}

/**
 * 멱등 append(순수 — 새 본문 반환만). 🔴 **material 멱등**(DEC-RE3): 같은 자연키 + method·rationale 같으면
 * duplicate(confirmed_at 달라도), material 다르면 conflict(같은 회차 다른 예외 — 덮지 않음·fail-closed).
 * 기존 본문 손상이면 그대로 올리고 append하지 않는다(D5 태도).
 */
export function appendExceptionGrant(existingContent: string, row: ExceptionGrantRow): ExceptionAppendResult {
  const rowProblems = exceptionGrantRowProblems(row)
  if (rowProblems.length) return { outcome: 'conflict', content: existingContent, problems: rowProblems }

  const parsed = parseExceptions(existingContent)
  if (parsed.problems.length) return { outcome: 'conflict', content: existingContent, problems: parsed.problems }

  const key = exceptionGrantRowKey(row)
  const prior = parsed.rows.find((r) => exceptionGrantRowKey(r) === key)
  if (prior) {
    return materialEqual(prior, row)
      ? { outcome: 'duplicate', content: existingContent, problems: [] }
      : {
          outcome: 'conflict',
          content: existingContent,
          problems: [`같은 회차(${row.series_id} #${row.for_attempt})에 다른 예외가 이미 있음 — 덮지 않는다`],
        }
  }
  const base = existingContent === '' || existingContent.endsWith('\n') ? existingContent : `${existingContent}\n`
  return { outcome: 'appended', content: base + serializeExceptionGrantRow(row), problems: [] }
}

// ───────────────────────────────── rationale 파일 파서(순수) ──

/** rationale 마크다운 섹션 헤더 → 필드. */
const RATIONALE_SECTIONS: ReadonlyArray<{ header: string; field: keyof Rationale }> = [
  { header: '직전 findings', field: 'prev_findings' },
  { header: '이번 변경', field: 'changes' },
  { header: '미해결', field: 'unresolved' },
  { header: '재시도 근거', field: 'retry_justification' },
]

export type RationaleParse = { ok: true; rationale: Rationale } | { ok: false; problems: string[] }

/**
 * rationale 마크다운 파싱(순수). `## <헤더>` 4섹션의 본문을 뽑아 전부 비어있지 않으면 ok.
 * 형식은 자유(마크다운) — 존재·비-빔만 강제한다. 누락·빈 섹션은 어느 것인지 알린다.
 */
export function parseRationale(text: string): RationaleParse {
  const lines = text.split('\n')
  const bodies = new Map<keyof Rationale, string[]>()
  let current: keyof Rationale | null = null
  for (const line of lines) {
    const m = /^##\s+(.+?)\s*$/.exec(line)
    if (m) {
      const sec = RATIONALE_SECTIONS.find((s) => m[1] === s.header)
      current = sec ? sec.field : null // 알 수 없는 헤더는 어느 섹션에도 안 담는다.
      if (current && !bodies.has(current)) bodies.set(current, [])
      continue
    }
    if (current) bodies.get(current)!.push(line)
  }
  const problems: string[] = []
  const rationale = {} as Rationale
  for (const { header, field } of RATIONALE_SECTIONS) {
    const body = (bodies.get(field) ?? []).join('\n').trim()
    if (body === '') problems.push(`rationale 섹션 "## ${header}"가 없거나 비어 있음`)
    rationale[field] = body
  }
  return problems.length ? { ok: false, problems } : { ok: true, rationale }
}
