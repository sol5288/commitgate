/**
 * 커밋되는 **티켓 lifecycle close proof** (REQ-2026-052).
 *
 * 왜 원장과 별도인가: `review-ledger.jsonl`(B1)은 **attempt 단위**(opened/closed) 감사다. close proof는
 * **티켓/series 단위 lifecycle 전이**(replace·human-resolution 종결, 개발 완료)를 담는다. 요구가 "사람이
 * 실행하는 종결 경로는 ledger와 close proof를 **함께** 내구화"라 명시하므로 둘을 섞지 않는다.
 *
 * 🔴 **모든 판정은 HEAD-committed 아티팩트만** 입력이다 — 워킹 state·워킹 승인은 절대 쓰지 않는다.
 *    scratch state가 사라져도 HEAD만으로 티켓 상태·req:new 허용·재구성 여부를 판별할 수 있어야 한다.
 *
 * 🔴 **prompt·응답 본문·민감 데이터를 저장하지 않는다.** 허용키 화이트리스트가 자리 자체를 막는다.
 *
 * 순수 모듈 — fs·git을 모른다. 부작용은 호출부가 낸다(`lib/evidence`·`lib/review-ledger`와 같은 태도).
 */
import { isValidIsoInstant } from './evidence'

/** close proof 파일의 basename. `approvals.jsonl`·`review-ledger.jsonl`과 같은 `responses/` 디렉터리. */
export const CLOSE_PROOF_BASENAME = 'ticket-close.jsonl'

/** 티켓 `responses/` 기준 close proof의 repo-상대 경로. */
export function closeProofPath(ticketRel: string): string {
  return `${ticketRel.replace(/\\/g, '/').replace(/\/+$/, '')}/responses/${CLOSE_PROOF_BASENAME}`
}

/**
 * lifecycle 전이 종류(DEC-B).
 * - `series-terminal`: 사람이 한 series를 replace/human-resolution으로 종결(원장과 함께 커밋).
 * - `dev-complete`: 모든 phase 증거가 durable해진 시점(마지막 evidence-finalize 직후 방출).
 *
 * 🔴 `integrated`는 여기 없다 — git ancestry로 관측하는 오버레이이지 커밋되는 전이가 아니다(DEC-B).
 */
export type CloseProofEvent = 'series-terminal' | 'dev-complete'

/** series-terminal의 종결 사유(사람 결정). */
export type TerminalResolution = 'replace' | 'human-resolution'

export interface CloseProofRow {
  ticket_id: string
  event: CloseProofEvent
  /** `series-terminal`일 때 그 series의 id. `dev-complete`이면 null. */
  series_id: string | null
  /** `series-terminal`일 때 종결 사유. `dev-complete`이면 null. */
  resolution: TerminalResolution | null
  /**
   * 🔴 `dev-complete`일 때 **완료 대상으로 확정된 phase ID 목록**(정렬·중복 없음, DEC-B2). `series-terminal`이면 null.
   *    이것이 "무엇이 완료인가"의 정본이다 — 미래 HEAD verifier는 runtime `state.phases`가 아니라 이 목록을 본다.
   */
  phase_inventory: string[] | null
  /**
   * 🔴 `dev-complete`일 때 이 inventory가 묶인 **design 승인 참조**(= 발행 시점 committed design 승인의 design_hash).
   *    `series-terminal`이면 null. design 재승인으로 inventory가 달라지면 옛 design_ref와 섞인 proof는 무효(DEC-B2).
   */
  design_ref: string | null
  at: string
  /** 사후 복원 행인지(DEC-D). 복원본을 원본으로 위장하지 않는다. */
  reconstructed: boolean
  /**
   * 복원 행일 때 그 사실을 유도한 근거(어떤 아카이브·매니페스트). 원본(비복원) 행이면 null.
   * 🔴 본문이 아니라 **경로/식별자 목록**이다 — 민감 데이터를 담지 않는다.
   */
  evidence_basis: string[] | null
}

/** 직렬화 키 순서(고정 — deterministic) + 허용키 화이트리스트(여기 없는 top-level 키 = 오염 → 거부). */
export const CLOSE_PROOF_KEYS = [
  'ticket_id',
  'event',
  'series_id',
  'resolution',
  'phase_inventory',
  'design_ref',
  'at',
  'reconstructed',
  'evidence_basis',
] as const

const EVENTS: readonly string[] = ['series-terminal', 'dev-complete']
const RESOLUTIONS: readonly string[] = ['replace', 'human-resolution']

/** 한 줄 직렬화(JSONL): 고정 키 순서 JSON + 끝 개행. */
export function serializeCloseProofRow(row: CloseProofRow): string {
  const o: Record<string, unknown> = {}
  for (const k of CLOSE_PROOF_KEYS) o[k] = row[k]
  return `${JSON.stringify(o)}\n`
}

/**
 * 자연키(멱등 판정 단위). `series-terminal`은 `(ticket, event, series)`, `dev-complete`은 `(ticket, event)`.
 * 구분자는 US(0x1F) — 식별자에 나타날 수 없는 제어문자(원장과 동일 기법, 소스에 리터럴 금지).
 */
const KEY_SEP = String.fromCharCode(31)
/**
 * 자연키(멱등·supersede 단위).
 * - `series-terminal`: `(ticket, event, series_id)` — series별 1행.
 * - `dev-complete`: `(ticket, event, design_ref)` 🔴 **design_ref로 키잉한다**(phase-3a r02 P1). design 재승인으로
 *   design_ref가 바뀌면 **다른 자연키**가 되어 새 dev-complete 행이 append-only로 추가된다(옛 행은 supersede —
 *   삭제하지 않고, verifier가 현재 design_ref에 맞는 행만 고른다). design_ref로 키잉하지 않으면 재완료가
 *   자연키 충돌(conflict)로 영구 실패한다.
 */
export function closeProofRowKey(row: Pick<CloseProofRow, 'ticket_id' | 'event' | 'series_id' | 'design_ref'>): string {
  const discriminator = row.event === 'dev-complete' ? (row.design_ref ?? '') : (row.series_id ?? '')
  return [row.ticket_id, row.event, discriminator].join(KEY_SEP)
}

/**
 * 행 하나의 형식 문제 목록(순수). 빈 배열 = 정상.
 * 🔴 모르는 top-level 키는 거부(주입·오염 방어). `dev-complete`은 series/resolution이 null이어야 한다.
 */
export function closeProofRowProblems(raw: unknown): string[] {
  const p: string[] = []
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ['객체가 아님']
  const r = raw as Record<string, unknown>

  const allowed = new Set<string>(CLOSE_PROOF_KEYS)
  for (const k of Object.keys(r)) if (!allowed.has(k)) p.push(`알 수 없는 키: ${k}`)
  for (const k of CLOSE_PROOF_KEYS) if (!(k in r)) p.push(`필수 키 누락: ${k}`)
  if (p.length) return p

  if (typeof r.ticket_id !== 'string' || r.ticket_id === '') p.push('ticket_id가 비어 있음')
  if (typeof r.event !== 'string' || !EVENTS.includes(r.event)) p.push(`event 부적합: ${String(r.event)}`)
  if (typeof r.reconstructed !== 'boolean') p.push('reconstructed는 boolean')
  if (!isValidIsoInstant(r.at)) p.push('at이 ISO instant가 아님')

  if (r.event === 'series-terminal') {
    if (typeof r.series_id !== 'string' || r.series_id === '') p.push('series-terminal인데 series_id가 비어 있음')
    if (typeof r.resolution !== 'string' || !RESOLUTIONS.includes(r.resolution))
      p.push(`series-terminal인데 resolution 부적합: ${String(r.resolution)}`)
    if (r.phase_inventory !== null) p.push('series-terminal인데 phase_inventory가 null이 아님')
    if (r.design_ref !== null) p.push('series-terminal인데 design_ref가 null이 아님')
  } else if (r.event === 'dev-complete') {
    if (r.series_id !== null) p.push('dev-complete인데 series_id가 null이 아님')
    if (r.resolution !== null) p.push('dev-complete인데 resolution이 null이 아님')
    // 🔴 dev-complete는 self-verifying — phase_inventory(정렬·중복 없음)와 design_ref가 필수(DEC-B2).
    if (!Array.isArray(r.phase_inventory)) p.push('dev-complete인데 phase_inventory가 배열이 아님')
    else {
      if (r.phase_inventory.length === 0) p.push('dev-complete인데 phase_inventory가 비어 있음')
      if (!r.phase_inventory.every((x) => typeof x === 'string' && x !== '')) p.push('phase_inventory 항목은 비지 않은 문자열')
      const sorted = [...r.phase_inventory].sort()
      if (JSON.stringify(sorted) !== JSON.stringify(r.phase_inventory)) p.push('phase_inventory가 정렬돼 있지 않음')
      if (new Set(r.phase_inventory).size !== r.phase_inventory.length) p.push('phase_inventory에 중복 있음')
    }
    if (typeof r.design_ref !== 'string' || r.design_ref === '') p.push('dev-complete인데 design_ref가 비어 있음')
  }

  if (r.evidence_basis !== null) {
    if (!Array.isArray(r.evidence_basis)) p.push('evidence_basis는 null이거나 배열')
    else if (!r.evidence_basis.every((x) => typeof x === 'string')) p.push('evidence_basis 항목은 문자열')
  }
  // 🔴 복원 행이면 근거가 있어야 하고, 비복원 행이면 근거가 없어야 한다(원본과 복원의 명확한 구별).
  if (r.reconstructed === true && (r.evidence_basis === null || (Array.isArray(r.evidence_basis) && r.evidence_basis.length === 0)))
    p.push('reconstructed:true인데 evidence_basis가 비어 있음(근거 없는 복원 금지)')
  if (r.reconstructed === false && r.evidence_basis !== null) p.push('원본 행(reconstructed:false)인데 evidence_basis가 있음')
  return p
}

export interface ParsedCloseProof {
  rows: CloseProofRow[]
  problems: string[]
}

/** close proof 본문 파싱(순수). 빈 줄 무시, 파싱 불가·형식 위반·자연키 중복은 problems로 드러낸다. */
export function parseCloseProof(content: string): ParsedCloseProof {
  const rows: CloseProofRow[] = []
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
    const ps = closeProofRowProblems(raw)
    if (ps.length) {
      problems.push(...ps.map((m) => `line ${i + 1}: ${m}`))
      return
    }
    const row = raw as CloseProofRow
    const key = closeProofRowKey(row)
    if (seen.has(key)) problems.push(`line ${i + 1}: 자연키 중복(${row.event} ${row.series_id ?? ''})`)
    seen.add(key)
    rows.push(row)
  })
  return { rows, problems }
}

export type CloseProofAppendOutcome = 'appended' | 'duplicate' | 'conflict'
export interface CloseProofAppendResult {
  outcome: CloseProofAppendOutcome
  content: string
  problems: string[]
}

/**
 * 멱등 append(순수 — 새 본문 반환만, 쓰기는 호출부). 원장과 같은 규칙(DEC-A3):
 * 같은 자연키+동일 내용 → duplicate(no-op), 같은 자연키+다른 내용 → conflict(덮지 않음·fail-closed).
 * 기존 본문 손상이면 그대로 올리고 append하지 않는다(D5 태도).
 */
export function appendCloseProofRow(existingContent: string, row: CloseProofRow): CloseProofAppendResult {
  const rowProblems = closeProofRowProblems(row)
  if (rowProblems.length) return { outcome: 'conflict', content: existingContent, problems: rowProblems }

  const parsed = parseCloseProof(existingContent)
  if (parsed.problems.length) return { outcome: 'conflict', content: existingContent, problems: parsed.problems }

  const key = closeProofRowKey(row)
  const prior = parsed.rows.find((r) => closeProofRowKey(r) === key)
  if (prior) {
    const same = serializeCloseProofRow(prior) === serializeCloseProofRow(row)
    return same
      ? { outcome: 'duplicate', content: existingContent, problems: [] }
      : { outcome: 'conflict', content: existingContent, problems: [`같은 자연키의 기존 행과 내용이 다름(${row.event}) — 덮어쓰지 않는다`] }
  }
  const base = existingContent === '' || existingContent.endsWith('\n') ? existingContent : `${existingContent}\n`
  return { outcome: 'appended', content: base + serializeCloseProofRow(row), problems: [] }
}

// ───────────────────────────────── 상태 파생(DEC-B) — 순수 ──

/** 순수 파생기의 입력. 🔴 전부 **HEAD-committed 사실**만. 호출부가 포트로 채운다. runtime state 절대 미사용(DEC-B4). */
export interface CloseStateInput {
  /** HEAD scaffold state.json에 durability marker가 있는가(`isDurabilityRequired`). false면 legacy. */
  durabilityRequired: boolean
  /** HEAD close proof를 파싱한 행들(없으면 []). */
  closeProofRows: readonly CloseProofRow[]
  /**
   * HEAD durable 원장이 이 티켓에 **approved인 attempt-closed**를 담고 있는가.
   * needs-recovery 판정 입력 — 원장에 승인 흔적이 있는데 HEAD 증거가 불완전하면 recovery 필요.
   */
  ledgerHasApprovedClose: boolean
  /** HEAD 증거(approvals·아카이브)가 그 승인에 대해 완비됐는가(`verifyCommittedDesignEvidence` 계열). */
  committedEvidenceComplete: boolean
  /**
   * 🔴 HEAD `approvals.jsonl`에서 **현재 committed design_ref에 결속된**(`phase_design_ref === committedDesignRef`)
   *    phase evidence의 phase ID 집합. dev-complete self-verify 입력(DEC-B2/B5).
   *
   * 🔴 **design-bound 필터는 호출부(manifest 읽는 경계)가 이미 적용**한다 — 이 순수 판정기는 manifest를 파싱하지
   *    않는 leaf라 필터를 여기 넣으면 모듈 경계가 깨진다(`evidencedPhaseIdsFromManifest(content, designRef)`가
   *    필터 지점). 단순 phase_id 존재가 아니라 **결속된 증거만** 담겨야 D1 검토분이 D2 완료에 새지 않는다(phase-3a P1).
   *    dev-complete proof의 `phase_inventory`의 모든 phase가 이 집합에 있어야 dev-complete다.
   */
  evidencedPhaseIds: readonly string[]
  /**
   * 🔴 현재 HEAD의 committed design 승인 참조(design_hash). dev-complete proof의 `design_ref`와 일치해야 dev-complete다.
   *    design 재승인으로 값이 바뀌면 옛 design_ref proof는 무효(DEC-B2). 계산 불가면 null(→ dev-complete 아님).
   */
  committedDesignRef: string | null
}

/** 5개 기본 상태(배타·완결). */
export type CloseBaseState = 'legacy' | 'series-terminal' | 'dev-complete' | 'needs-recovery' | 'developing'

/**
 * 🔴 dev-complete self-verify(순수, DEC-B2). HEAD close proof의 dev-complete row가 **자기 완결적으로** 증명되는가:
 *   ① dev-complete row 존재 ② 그 row의 phase_inventory **모든 phase**가 HEAD 증거(evidencedPhaseIds)에 있음
 *   ③ row의 design_ref = 현재 committed design 참조. runtime state는 절대 안 본다.
 */
export function isDevCompleteVerified(input: CloseStateInput): boolean {
  if (input.committedDesignRef === null) return false
  // 🔴 **현재 design_ref에 맞는** dev-complete 행을 고른다(phase-3a r02 P1). design 재승인 후 옛 design_ref
  //    행은 무시(supersede)되고, 새 design_ref의 행이 있으면 그것으로 검증한다.
  const dc = input.closeProofRows.find((r) => r.event === 'dev-complete' && r.design_ref === input.committedDesignRef)
  if (!dc || !Array.isArray(dc.phase_inventory) || dc.phase_inventory.length === 0) return false
  const evidenced = new Set(input.evidencedPhaseIds)
  return dc.phase_inventory.every((p) => evidenced.has(p))
}

/**
 * 기본 상태 파생(순수·배타·완결 — 항상 정확히 하나). 우선순위:
 * `legacy` > `series-terminal` > `dev-complete` > `needs-recovery` > `developing`(기본값).
 *
 * 🔴 워킹 state·워킹 승인을 절대 입력으로 받지 않는다(design-r01 P1·B4). `integrated`는 여기서 내지 않는다
 *    — git ancestry 오버레이라 순수 파생 밖이다(design-r02 P1).
 */
export function deriveBaseState(input: CloseStateInput): CloseBaseState {
  if (!input.durabilityRequired) return 'legacy'
  const hasEvent = (e: CloseProofEvent): boolean => input.closeProofRows.some((r) => r.event === e)
  if (hasEvent('series-terminal')) return 'series-terminal'
  // 🔴 dev-complete는 self-verifying(DEC-B2): proof + committed evidence + design_ref로만 판정.
  if (isDevCompleteVerified(input)) return 'dev-complete'
  // 승인 흔적(원장)은 있으나 HEAD 증거가 불완전 = 복구 필요.
  if (input.ledgerHasApprovedClose && !input.committedEvidenceComplete) return 'needs-recovery'
  return 'developing'
}

/** `reconstructed` 오버레이(순수·blob). close proof에 복원 행이 하나라도 있으면 true. */
export function isReconstructed(rows: readonly CloseProofRow[]): boolean {
  return rows.some((r) => r.reconstructed === true)
}

/** req:new 게이트가 **차단**하는 기본 상태(DEC-C). 오버레이는 무관 — 기본 상태만 본다. */
export function baseStateBlocksIntake(state: CloseBaseState): boolean {
  return state === 'developing' || state === 'needs-recovery'
}
