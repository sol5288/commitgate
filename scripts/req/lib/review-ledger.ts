/**
 * 커밋되는 **append-only 리뷰 원장** (REQ-2026-051).
 *
 * 왜 존재하나: `state.json`은 scratch로 설계돼 커밋되지 않는다(`req-commit.ts` — "state.json은 scratch 유지").
 * 그래서 런타임 원장이 미커밋으로 남고, 다음 티켓의 `req:new`가 clean tree를 요구하는 순간 폐기된다.
 * 소비자 저장소에서 실제로 한 REQ의 원장(설계 승인 + phase 3건 승인 이력)이 통째로 사라졌고,
 * 이 저장소의 REQ-2026-049도 같은 상태다(`phases: []`·`review_series: 0`).
 *
 * 🔴 **`approvals.jsonl`을 중복하지 않는다.** 그쪽 `archive_inventory`가 아카이브된 전 라운드를
 *    `response_path`+`sha256`으로 이미 담는다. 이 원장은 **아카이브가 보여줄 수 없는 것만** 담는다:
 *      1. 아카이브를 남기지 않은 시도(호출 실패·무효 응답) — attempt는 호출 **전**에 확정되고
 *         아카이브는 유효 응답에만 생기므로, 그 차이가 어디에도 안 남는다.
 *      2. 사람 예외 소비 — `review_exception_confirmed`는 소비 후 `null`로 지워진다.
 *      3. series 종결 사유 · 4. lineage · 5. 재구성 여부.
 *
 * 🔴 **프롬프트·응답 본문을 저장하지 않는다.** 해시까지만. 응답 본문은 이미 아카이브에 있고
 *    `archive_sha256`이 그것을 가리킨다. 허용키 화이트리스트가 본문이 들어갈 자리 자체를 막는다.
 *
 * 이 모듈은 **순수**하다 — fs·git을 모른다. 부작용은 호출부가 낸다(`lib/evidence`와 같은 태도).
 */
import { isValidIsoInstant } from './evidence'
import type { ReviewKind } from '../review-codex'

/** 원장 파일의 티켓-상대 경로. `approvals.jsonl`과 같은 디렉터리 — 기존 내구화 경로 2곳을 그대로 재사용한다. */
export const LEDGER_BASENAME = 'review-ledger.jsonl'

/** 티켓 `responses/` 기준 원장의 repo-상대 경로. */
export function ledgerPath(ticketRel: string): string {
  return `${ticketRel.replace(/\\/g, '/').replace(/\/+$/, '')}/responses/${LEDGER_BASENAME}`
}

/**
 * 이벤트 2종 (D2).
 *
 * attempt는 외부 호출 **전**에 확정되고 결과는 **후**에 나온다. 한 행에 담으면 나중에 그 행을 고쳐야 하는데
 * 그것은 append-only가 아니다. 그래서 나눈다.
 *
 * 부수 효과가 이 설계의 핵심 이득이다: `attempt-opened`만 있고 `attempt-closed`가 없는 attempt가 곧
 * **"예산은 깎였는데 완료되지 않은 호출"**이다. 별도 필드 없이 원장 **구조 자체로** 관측된다.
 */
export type LedgerEvent = 'attempt-opened' | 'attempt-closed'

/** 완료된 attempt의 판정. 미완(`attempt-opened`)이면 null. */
export type LedgerOutcome = 'approved' | 'needs-fix' | 'blocked' | 'invalid'

export interface LedgerRow {
  ticket_id: string
  series_id: string
  review_kind: ReviewKind
  phase_id: string | null
  attempt: number
  event: LedgerEvent
  /**
   * 호출 수명주기. **이 REQ는 `completed`만 쓴다.** `pre_dispatch_failed`·`dispatch_confirmed`·
   * `dispatched_unknown` 및 예산 차감 규칙 변경은 후속 REQ 소관이다.
   * `attempt-opened`에서는 null.
   */
  lifecycle: string | null
  outcome: LedgerOutcome | null
  /** 이 attempt가 autoBudget 초과라 사람 예외를 소비했는지. scratch에서 지워지는 유일한 사실이라 여기서만 살아남는다. */
  exception_consumed: boolean
  // 🔴 **archive path·sha256을 담지 않는다**(phase-2 리뷰 P1). 아카이브된 라운드의 경로·해시는 이미
  //    `approvals.jsonl`의 `archive_inventory`가 단일 출처로 보관한다. 원장이 그걸 복제하면 두 사본이
  //    갈라질 수 있고, 이 REQ의 헤드라인 원칙("approvals.jsonl을 중복하지 않는다")을 스스로 어긴다.
  //    아카이브 존재 여부는 `outcome`이 이미 알려 준다(approved/needs-fix=아카이브됨, blocked/invalid=아님).
  /** 🔴 프롬프트 **해시만**. 본문은 원장에 들어가지 않는다. */
  prompt_sha256: string | null
  at: string
  /** 사후 복원한 기록인지. 원본과 구별할 수단이 없으면 재구성본이 원본으로 위장한다. */
  reconstructed: boolean
}

/**
 * 직렬화 키 순서(고정 — deterministic). `serializeManifestLine`과 같은 방식.
 * 허용키 화이트리스트로도 쓰인다 — 여기 없는 top-level 키는 오염 신호로 거부한다.
 *
 * 🔴 **릴리스 후 스키마 변경은 additive-only여야 한다.** 키를 **제거**하면, 옛 스키마로 커밋된 기존 원장이
 *    새 검증기에서 "알 수 없는 키"로 거부되고 D5 fail-closed가 그 티켓의 모든 리뷰를 막는다(실제로 이
 *    REQ의 phase-2 개발 중 dogfood에서 발생했다 — 미커밋 원장이라 재생성으로 해결). 이 REQ는 **릴리스 전**이라
 *    archive_path·archive_sha256을 제거해도 야생에 옛 원장이 없어 안전하다. 릴리스 후에는 키 추가만 하고,
 *    값 확장은 forward-compatible하게(모르는 값은 거부 안 함, `lifecycle` 참조).
 */
export const LEDGER_KEYS = [
  'ticket_id',
  'series_id',
  'review_kind',
  'phase_id',
  'attempt',
  'event',
  'lifecycle',
  'outcome',
  'exception_consumed',
  'prompt_sha256',
  'at',
  'reconstructed',
] as const

const OUTCOMES: readonly string[] = ['approved', 'needs-fix', 'blocked', 'invalid']
const EVENTS: readonly string[] = ['attempt-opened', 'attempt-closed']

/** 한 줄 직렬화(JSONL): 고정 키 순서 JSON + 끝 개행. */
export function serializeLedgerRow(row: LedgerRow): string {
  const o: Record<string, unknown> = {}
  for (const k of LEDGER_KEYS) o[k] = row[k]
  return `${JSON.stringify(o)}\n`
}

/**
 * 자연키 구분자 — **US(0x1F, unit separator)**.
 *
 * 왜 제어문자인가: 티켓 id·series id·phase id 어디에도 나타날 수 없어야 구분자 충돌로 서로 다른
 * attempt가 같은 키로 접히지 않는다. 가시 문자(공백·`|`·`:`)는 series id(`design:-#1`)나 장래의
 * phase id에 나타날 수 있다.
 *
 * 🔴 **소스에 제어문자 리터럴을 넣지 않는다** — `String.fromCharCode`로 만든다. 이 phase에서 실제로
 *    원시 NUL 바이트가 소스에 박혀 git이 파일을 **binary로 취급**했고 grep·diff·리뷰가 전부 깨졌다.
 *    테스트(`제어문자 리터럴 없음`)가 이 재발을 잠근다.
 */
const KEY_SEP = String.fromCharCode(31) // US(unit separator)

/** 자연키 — 멱등 판정의 단위(D5). */
export function ledgerRowKey(row: Pick<LedgerRow, 'ticket_id' | 'series_id' | 'attempt' | 'event'>): string {
  return [row.ticket_id, row.series_id, String(row.attempt), row.event].join(KEY_SEP)
}

/**
 * 행 하나의 형식 문제 목록(순수). 빈 배열 = 정상.
 *
 * 🔴 **비대칭이 의도다**(D3): 모르는 `lifecycle` **값**은 거부하지 않고(forward-compatible — 후속 REQ가
 *    값을 늘리는 것이 정상 경로다), 모르는 top-level **키**는 거부한다(주입·오염 신호).
 */
export function ledgerRowProblems(raw: unknown): string[] {
  const p: string[] = []
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ['객체가 아님']
  const r = raw as Record<string, unknown>

  const allowed = new Set<string>(LEDGER_KEYS)
  for (const k of Object.keys(r)) if (!allowed.has(k)) p.push(`알 수 없는 키: ${k}`)
  for (const k of LEDGER_KEYS) if (!(k in r)) p.push(`필수 키 누락: ${k}`)
  if (p.length) return p

  if (typeof r.ticket_id !== 'string' || r.ticket_id === '') p.push('ticket_id가 비어 있음')
  if (typeof r.series_id !== 'string' || r.series_id === '') p.push('series_id가 비어 있음')
  if (r.review_kind !== 'design' && r.review_kind !== 'phase') p.push(`review_kind 부적합: ${String(r.review_kind)}`)
  if (r.phase_id !== null && (typeof r.phase_id !== 'string' || r.phase_id === '')) p.push('phase_id는 null이거나 비지 않은 문자열')
  if (typeof r.attempt !== 'number' || !Number.isInteger(r.attempt) || r.attempt < 1) p.push('attempt는 1 이상 정수')
  if (typeof r.event !== 'string' || !EVENTS.includes(r.event)) p.push(`event 부적합: ${String(r.event)}`)
  if (typeof r.exception_consumed !== 'boolean') p.push('exception_consumed는 boolean')
  if (typeof r.reconstructed !== 'boolean') p.push('reconstructed는 boolean')
  if (!isValidIsoInstant(r.at)) p.push('at이 ISO instant가 아님')
  if (r.lifecycle !== null && typeof r.lifecycle !== 'string') p.push('lifecycle은 null이거나 문자열')
  if (r.prompt_sha256 !== null && typeof r.prompt_sha256 !== 'string') p.push('prompt_sha256는 null이거나 문자열')

  if (r.outcome !== null && (typeof r.outcome !== 'string' || !OUTCOMES.includes(r.outcome)))
    p.push(`outcome 부적합: ${String(r.outcome)}`)

  // 🔴 `attempt-opened`는 결과를 알 수 없는 시점이다 — 결과 필드가 채워져 있으면 순서가 뒤집힌 기록이다.
  if (r.event === 'attempt-opened') {
    for (const k of ['outcome', 'lifecycle'] as const) if (r[k] !== null) p.push(`attempt-opened인데 ${k}가 채워져 있음`)
  }

  // 🔴 `attempt-closed`는 판정이 끝난 시점이다 — 최소한 outcome·lifecycle은 있어야 한다(design 리뷰 observation).
  //    이게 없으면 outcome=null인 closed 행이 통과해 "완료됐지만 판정 불명"이라는 자기모순 상태가 원장에 남는다.
  if (r.event === 'attempt-closed') {
    if (r.outcome === null) p.push('attempt-closed인데 outcome이 null')
    if (r.lifecycle === null) p.push('attempt-closed인데 lifecycle이 null')
  }
  return p
}

export interface ParsedLedger {
  rows: LedgerRow[]
  /** 파싱·검증 문제. 비어 있지 않으면 손상 — 조용히 건너뛰지 않는다(D5). */
  problems: string[]
}

/** 원장 본문 파싱(순수). 빈 줄은 무시하고, 파싱 불가·형식 위반은 problems로 드러낸다. */
export function parseLedger(content: string): ParsedLedger {
  const rows: LedgerRow[] = []
  const problems: string[] = []
  const lines = content.split('\n')
  const seen = new Set<string>()
  lines.forEach((line, i) => {
    if (line.trim() === '') return
    let raw: unknown
    try {
      raw = JSON.parse(line)
    } catch {
      problems.push(`line ${i + 1}: JSON 파싱 실패`)
      return
    }
    const ps = ledgerRowProblems(raw)
    if (ps.length) {
      problems.push(...ps.map((m) => `line ${i + 1}: ${m}`))
      return
    }
    const row = raw as LedgerRow
    const key = ledgerRowKey(row)
    if (seen.has(key)) problems.push(`line ${i + 1}: 자연키 중복(${row.series_id} attempt=${row.attempt} ${row.event})`)
    seen.add(key)
    rows.push(row)
  })
  return { rows, problems }
}

/** 멱등 append 결과. `appended`=신규 기록, `duplicate`=동일 내용 재기록(no-op), `conflict`=같은 키 다른 내용(fail-closed). */
export type AppendOutcome = 'appended' | 'duplicate' | 'conflict'

export interface AppendResult {
  outcome: AppendOutcome
  /** append 후 본문. `duplicate`·`conflict`면 입력과 동일하다(쓰기 금지). */
  content: string
  problems: string[]
}

/**
 * 멱등 append(순수 — 새 본문을 **반환**만 한다. 쓰기는 호출부).
 *
 * - 같은 자연키 + 동일 내용 → `duplicate`(행 수 불변). crash 후 재실행이 중복을 만들지 않는다.
 * - 같은 자연키 + 다른 내용 → `conflict`. **append하지도 덮지도 않는다.** 조용한 덮어쓰기는
 *   append-only 원장의 신뢰를 무너뜨린다.
 * - 기존 본문이 손상이면 그 문제를 그대로 올리고 append하지 않는다.
 */
export function appendLedgerRow(existingContent: string, row: LedgerRow): AppendResult {
  const rowProblems = ledgerRowProblems(row)
  if (rowProblems.length) return { outcome: 'conflict', content: existingContent, problems: rowProblems }

  const parsed = parseLedger(existingContent)
  if (parsed.problems.length) return { outcome: 'conflict', content: existingContent, problems: parsed.problems }

  const key = ledgerRowKey(row)
  const prior = parsed.rows.find((r) => ledgerRowKey(r) === key)
  if (prior) {
    const same = serializeLedgerRow(prior) === serializeLedgerRow(row)
    return same
      ? { outcome: 'duplicate', content: existingContent, problems: [] }
      : {
          outcome: 'conflict',
          content: existingContent,
          problems: [`같은 자연키의 기존 행과 내용이 다름(${row.series_id} attempt=${row.attempt} ${row.event}) — 덮어쓰지 않는다`],
        }
  }

  const base = existingContent === '' || existingContent.endsWith('\n') ? existingContent : `${existingContent}\n`
  return { outcome: 'appended', content: base + serializeLedgerRow(row), problems: [] }
}

/**
 * `attempt-opened`만 있고 대응하는 `attempt-closed`가 없는 attempt (요구사항 #1).
 *
 * 이것이 곧 **"예산은 깎였는데 완료되지 않은 호출"**이다 — 외부 호출 실패나 응답 처리 실패로
 * 아카이브도 측정 로그도 남지 않은 시도. 소비자 저장소에서 실측 1건(attempts 4 vs 아카이브 3)이 있었다.
 */
export function unclosedAttempts(rows: readonly LedgerRow[]): LedgerRow[] {
  const closed = new Set(rows.filter((r) => r.event === 'attempt-closed').map((r) => [r.series_id, String(r.attempt)].join(KEY_SEP)))
  return rows.filter((r) => r.event === 'attempt-opened' && !closed.has([r.series_id, String(r.attempt)].join(KEY_SEP)))
}
