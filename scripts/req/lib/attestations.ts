/**
 * attestation 기록 (REQ-2026-127 DEC-3) — **정당한 예외의 명시 승인**, append-only 감사 기록.
 *
 * release·setup·수동 충돌 정정처럼 CommitGate 승인 증거가 없는 것이 정상인 커밋을, 사람이 이유와 함께
 * 명시적으로 승인한다. verify-range/integrate가 head tree의 이 파일을 읽어 `attested`로 분류한다.
 *
 * 🔴 이것은 서명이 아니다 — `attested_by`는 로컬 git identity일 뿐 위조 방지 장치가 없다.
 *    가치는 "누가 언제 무슨 이유로 승인했는지가 **커밋된 기록**으로 남는다"에 있다(감사 전제 P-C).
 * 🔴 attestation은 invalid-evidence(손상 증거)를 구제하지 않는다 — 손상은 수정이 답이지 면제가 아니다.
 */

export const ATTESTATIONS_BASENAME = 'attestations.jsonl'

/** repo-상대 경로(POSIX). 티켓 소속이 아닌 저장소 수준 기록이라 ticketRoot 직계에 둔다. */
export function attestationsPath(ticketRoot: string): string {
  return `${ticketRoot}/${ATTESTATIONS_BASENAME}`
}

export interface AttestationRow {
  schema_version: 1
  /** 대상 커밋(풀 OID — 축약 입력은 verb가 해석해 풀로 기록). */
  sha: string
  /** 그 커밋의 tree OID — identity 결속(검증 시 실제 tree와 대조). */
  tree: string
  reason: string
  attested_at: string
  /** 로컬 git identity(`name <email>`) — 주체의 로컬 식별자(서명 아님). */
  attested_by: string
}

const OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/
const KEYS = ['schema_version', 'sha', 'tree', 'reason', 'attested_at', 'attested_by'] as const

/** 행 스키마 검증(순수) — 문제 목록 반환(빈 배열=유효). 미지 키는 거부(주입 차단·매니페스트 관례). */
export function attestationRowProblems(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ['object 아님']
  const e = raw as Record<string, unknown>
  const problems: string[] = []
  for (const k of Object.keys(e)) if (!(KEYS as readonly string[]).includes(k)) problems.push(`예상 외 필드: ${k}`)
  if (e.schema_version !== 1) problems.push(`schema_version 비유효: ${String(e.schema_version)}`)
  if (typeof e.sha !== 'string' || !OID_RE.test(e.sha)) problems.push('sha 비-OID')
  if (typeof e.tree !== 'string' || !OID_RE.test(e.tree)) problems.push('tree 비-OID')
  if (typeof e.reason !== 'string' || e.reason.trim() === '') problems.push('reason 비어 있음')
  if (typeof e.attested_at !== 'string' || !ISO_RE.test(e.attested_at)) problems.push('attested_at 비-ISO')
  if (typeof e.attested_by !== 'string' || e.attested_by.trim() === '') problems.push('attested_by 비어 있음')
  return problems
}

/**
 * JSONL 파싱(관대) — 유효 행만 반환하고 손상 행은 센다. 손상 하나가 파일 전체를 죽이지 않는다
 * (verify-range의 감사 보고 태도 — 카운트는 verificationNotes로 표기된다).
 */
export function parseAttestations(content: string): { rows: AttestationRow[]; problems: number } {
  const rows: AttestationRow[] = []
  let problems = 0
  for (const line of content.split('\n')) {
    if (line.trim() === '') continue
    let raw: unknown
    try {
      raw = JSON.parse(line)
    } catch {
      problems++
      continue
    }
    if (attestationRowProblems(raw).length > 0) {
      problems++
      continue
    }
    rows.push(raw as unknown as AttestationRow)
  }
  return { rows, problems }
}

/** 직렬화(고정 키순 — 멱등 비교·감사 가독성). */
export function serializeAttestationRow(row: AttestationRow): string {
  const ordered: Record<string, unknown> = {}
  for (const k of KEYS) ordered[k] = row[k]
  return `${JSON.stringify(ordered)}\n`
}
