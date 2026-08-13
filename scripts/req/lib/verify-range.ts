/**
 * verify-range 순수 코어 (REQ-2026-116) — **커밋 범위의 로컬 승인 증거 분류·판정**.
 *
 * "base..head의 각 커밋이 CommitGate 절차를 거쳤는가"를 로컬 git과 **head 트리에 커밋된 증거**만으로
 * 분류한다. D25/D30이 티켓 단위 trunk 도달을 보는 것과 축이 다르다 — 여기는 **커밋 단위**다.
 * 실제 소비자 감사에서 "consumed approval SHA·부기 trailer 어느 것으로도 입증 불가"인 커밋 범위가
 * 발견된 것이 이 모듈의 존재 이유다(00-requirement 배경 1).
 *
 * 🔴 순수 모듈 — fs·git·네트워크를 모른다. 커밋 메타와 manifest 본문은 호출부(bin/verify-range.ts)가
 *    포트로 수집한다(`lib/close-proof`·`lib/review-ledger`와 같은 태도). GitHub 인증·gh CLI와 무관하다.
 *
 * 경계(설계 DEC-2): squash/rebase로 재작성된 커밋은 소비 시점 SHA와 달라 `unproven`으로 나온다.
 * 이 모듈은 주어진 범위를 있는 그대로 검증할 뿐, "모든 우회를 잡는다"고 약속하지 않는다.
 */
import { BOOKKEEPING_TRAILER } from './bookkeeping'
import { validateManifest } from './evidence'
import type { AttestationRow } from './attestations'

/** 분류에 필요한 커밋 메타(호출부가 `git rev-list`/`git log`에서 수집). */
export interface CommitMeta {
  sha: string
  /** 부모 수 — 2 이상이면 merge 커밋. */
  parentCount: number
  /** 요약 줄(보고용 — 판정에는 쓰지 않는다). */
  subject: string
  /** 커밋 메시지 전문(trailer 포함). */
  message: string
}

/** git OID(SHA-1 40 / SHA-256 64 hex). 소비 SHA 추출·검증에 쓴다. */
const OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/

/** 메시지에 부기 trailer **줄**이 있는가 — 본문 산문에 섞인 언급은 부기가 아니다(줄 단위 일치). */
function hasBookkeepingTrailer(message: string): boolean {
  return message.split('\n').some((l) => l.trim() === BOOKKEEPING_TRAILER)
}

/** CI 선택 결과(설계 DEC-5의 감사 로그 어휘와 동일 — phase-2의 CLI가 이 값을 만든다). */
export type CiOutcome = 'skipped-default' | 'skipped-explicit' | 'checked-ok' | 'checked-fail'

/**
 * exit 계약(설계 DEC-1·DEC-7 + REQ-2026-127 R3, 순수):
 * - 기본은 0 — 미입증이 있어도 **보고**가 1차 역할이다(fail 기본은 규정된 워크플로 외 커밋에서 즉시 오탐).
 * - `--strict`이고 (미입증 + invalid-evidence) > 0 → 1. attested는 통과다.
 * - 명시 요청한 CI 확인 실패(`checked-fail`) → 1 — 요청된 CI 실패를 조용히 무시하지 않는다(정책 12).
 * `invalidCount`는 additive(기본 0) — 4범주 시절 호출부와 호환.
 */
export function computeExit(input: { unprovenCount: number; invalidCount?: number; strict: boolean; ci: CiOutcome }): 0 | 1 {
  if (input.ci === 'checked-fail') return 1
  if (input.strict && input.unprovenCount + (input.invalidCount ?? 0) > 0) return 1
  return 0
}

// ═══════════════════════════ 심층 검증 (REQ-2026-127) ═══════════════════════════
//
// 표시자 매칭(0.21의 4범주)을 증거 **검증**으로 확장한 6범주 분류다. 0.22에서 verify-range CLI·
// integrate·report가 전부 이쪽을 쓴다(REQ-2026-128에서 4범주 레거시 제거).

/** 심층 분류 6범주(설계 DEC-1 — 판정 순서 고정·invalid는 attestation으로 구제 불가). */
export type DeepCategory = 'merge' | 'bookkeeping' | 'approved' | 'attested' | 'invalid-evidence' | 'unproven'

export interface DeepCommitMeta extends CommitMeta {
  /** non-merge 커밋의 변경 경로(repo-상대·POSIX). merge 커밋은 빈 배열이어도 된다(판정에 안 씀). */
  changedPaths: readonly string[]
  /** merge 커밋의 `git diff-tree --cc` 산출 경로 — 비어 있지 않으면 conflict resolution/evil merge. */
  ccPaths: readonly string[]
}

export interface ManifestFile {
  /** repo-상대 경로(POSIX) — `<ticketRoot>/REQ-xxxx/responses/approvals.jsonl`. */
  path: string
  content: string
}

export interface DeepVerifyInput {
  commits: readonly DeepCommitMeta[]
  manifests: readonly ManifestFile[]
  /** repo-상대 ticketRoot(POSIX, 예: `workflow`) — bookkeeping 허용 경로 판정. */
  ticketRoot: string
  /** ticketRel(예: `workflow/REQ-2026-125`) → head tree state.json의 phases id 목록. null=읽기 실패(검사 축소). */
  statePhases: ReadonlyMap<string, readonly string[] | null>
  /** head tree attestations.jsonl의 **유효 행**(파서가 스키마 검증 완료). */
  attestations: readonly AttestationRow[]
  /** attestations.jsonl의 손상 행 수(notes 표기용). */
  attestationProblems: number
  /** sha → 그 커밋의 tree OID(attestation identity 대조 — 호출부가 수집). */
  commitTrees: ReadonlyMap<string, string>
  /** 아카이브 경로 → head tree blob 내용의 SHA-256(hex). null=읽기 실패(검증 불가 — invalid 단정 금지). */
  archiveSha256: ReadonlyMap<string, string | null>
}

export interface DeepVerifyReport {
  entries: { sha: string; subject: string; category: DeepCategory }[]
  counts: Record<DeepCategory, number>
  unproven: { sha: string; subject: string; note?: string }[]
  /** 손상 증거 — 문제 목록 동반(사람이 고칠 재료). */
  invalid: { sha: string; subject: string; problems: string[] }[]
  manifestProblems: number
  /** 검증 축소·손상 표기(위양성 방지의 짝 — 조용한 강도 저하 금지). */
  verificationNotes: string[]
}

/** manifest 경로에서 ticketRel(`workflow/REQ-xxxx`)을 뽑는다. */
function ticketRelOfManifestPath(path: string): string {
  return path.split('/').slice(0, 2).join('/')
}

export interface ConsumedRow {
  manifestPath: string
  ticketRel: string
  /** 원 행 텍스트(단독 재검증 입력). */
  line: string
  raw: Record<string, unknown>
}

/**
 * 매니페스트에서 **소비 행**(`consumed_by_commit_sha`)을 sha 별로 모은다.
 *
 * 🔴 **파서를 두 벌 두지 않으려고 export 한다**(REQ-2026-140 phase-4a). 병합 범위의 **티켓 귀속**도
 *    같은 매핑이 필요한데, 별도로 파싱하면 한쪽만 고쳐질 때 두 판정이 조용히 갈라진다 —
 *    이 저장소가 자산 skew 로 두 번 데인 자리다(REQ-2026-025·038).
 */
export function collectConsumedRows(manifests: readonly ManifestFile[]): {
  rows: Map<string, ConsumedRow[]>
  problems: number
} {
  let problems = 0
  const rows = new Map<string, ConsumedRow[]>()
  for (const mf of manifests) {
    for (const line of mf.content.split('\n')) {
      if (line.trim() === '') continue
      let raw: unknown
      try {
        raw = JSON.parse(line)
      } catch {
        problems++
        continue
      }
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        problems++
        continue
      }
      const sha = (raw as { consumed_by_commit_sha?: unknown }).consumed_by_commit_sha
      if (sha === undefined) continue // rebind 등 정당한 비소비 행
      if (typeof sha !== 'string' || !OID_RE.test(sha)) {
        problems++
        continue
      }
      const list = rows.get(sha) ?? []
      list.push({ manifestPath: mf.path, ticketRel: ticketRelOfManifestPath(mf.path), line, raw: raw as Record<string, unknown> })
      rows.set(sha, list)
    }
  }
  return { rows, problems }
}

/** 심층 분류(순수). 입력 수집은 전부 호출부 몫 — 이 함수는 프로세스를 모른다. */
export function verifyRangeDeep(input: DeepVerifyInput): DeepVerifyReport {
  const notes: string[] = []
  if (input.attestationProblems > 0) notes.push(`attestations.jsonl 손상 행 ${input.attestationProblems}건 — 해당 행만 무시했습니다`)

  // 1) 소비 행 수집(관대) — sha → 행 목록. malformed는 manifestProblems.
  const { rows: consumedRows, problems: manifestProblems } = collectConsumedRows(input.manifests)

  // 2) 커밋별 분류.
  const counts: Record<DeepCategory, number> = { merge: 0, bookkeeping: 0, approved: 0, attested: 0, 'invalid-evidence': 0, unproven: 0 }
  const unproven: DeepVerifyReport['unproven'] = []
  const invalid: DeepVerifyReport['invalid'] = []
  const attestedShas = new Set(
    input.attestations.filter((a) => input.commitTrees.get(a.sha) === a.tree).map((a) => a.sha),
  )
  // tree 불일치 attestation은 무효 — 조용히 버리지 않고 표기한다.
  for (const a of input.attestations)
    if (input.commitTrees.has(a.sha) && input.commitTrees.get(a.sha) !== a.tree)
      notes.push(`attestation 무효(${a.sha.slice(0, 8)}): 기록된 tree가 커밋의 실제 tree와 다릅니다`)

  const ticketPrefix = `${input.ticketRoot}/`
  /** validPhaseIds 검사가 축소된 티켓(state.json phases 부재) — 위양성 대신 축소를 표기한다. */
  const reducedTickets = new Set<string>()

  const entries = input.commits.map((c) => {
    let category: DeepCategory
    let note: string | undefined
    let problems: string[] = []

    if (c.parentCount >= 2) {
      if (c.ccPaths.length === 0) category = 'merge'
      else if (attestedShas.has(c.sha)) category = 'attested'
      else {
        category = 'unproven'
        note = `merge에 conflict resolution 변경 ${c.ccPaths.length}경로 — 정당하면 \`commitgate attest\`로 승인하세요`
      }
    } else if (hasBookkeepingTrailer(c.message)) {
      const foreign = c.changedPaths.filter((p) => !p.startsWith(ticketPrefix))
      if (foreign.length === 0) category = 'bookkeeping'
      else {
        category = 'invalid-evidence'
        problems = [`부기 trailer가 있는데 허용 밖 경로를 변경: ${foreign.slice(0, 3).join(', ')}${foreign.length > 3 ? ` 외 ${foreign.length - 3}건` : ''}`]
      }
    } else if (consumedRows.has(c.sha)) {
      const rows = consumedRows.get(c.sha) as ConsumedRow[]
      problems = deepApprovedProblems(rows, input, reducedTickets)
      if (problems.length === 0) category = 'approved'
      else if (problems.length === 1 && (problems[0] as string).startsWith('검증 불가:')) {
        category = 'unproven'
        note = problems[0] as string
        problems = []
      } else category = 'invalid-evidence'
    } else if (attestedShas.has(c.sha)) {
      category = 'attested'
    } else {
      category = 'unproven'
    }

    counts[category]++
    if (category === 'unproven') unproven.push(note === undefined ? { sha: c.sha, subject: c.subject } : { sha: c.sha, subject: c.subject, note })
    if (category === 'invalid-evidence') invalid.push({ sha: c.sha, subject: c.subject, problems })
    return { sha: c.sha, subject: c.subject, category }
  })

  for (const t of [...reducedTickets].sort())
    notes.push(`검증 축소(${t}): head tree에서 state.json phases를 읽지 못해 phase_id 유효성 검사를 생략했습니다`)
  return { entries, counts, unproven, invalid, manifestProblems, verificationNotes: notes }
}

/**
 * 소비 행 심층 검증(설계 DEC-1 순서 3). 문제 목록 반환(빈 배열=approved).
 * blob 읽기 실패는 `검증 불가:` 접두 단일 문제로 반환 — 호출부가 unproven 강등한다(손상 단정 금지).
 */
function deepApprovedProblems(rows: ConsumedRow[], input: DeepVerifyInput, reducedTickets: Set<string>): string[] {
  if (rows.length > 1)
    return [`같은 커밋을 소비한 승인 행이 ${rows.length}개(${rows.map((r) => r.manifestPath).join(', ')}) — 중복 소비 기록`]
  const row = rows[0] as ConsumedRow

  // validPhaseIds: head tree state.json phases[]. 읽기 실패면 manifest 자신의 phase_id로 vacuous(검사 축소 — 표기 동반).
  const statePhases = input.statePhases.get(row.ticketRel)
  const stateMissing = statePhases === null || statePhases === undefined
  if (stateMissing) reducedTickets.add(row.ticketRel)
  const ownPhaseId = typeof row.raw.phase_id === 'string' ? [row.raw.phase_id] : []
  const validPhaseIds = stateMissing ? ownPhaseId : [...statePhases]

  // 행 단독 재검증 — 파일 전체 문제를 이 커밋에 전가하지 않는다(행 귀속).
  const rowProblems = validateManifest(row.line, { ticketRel: row.ticketRel, validPhaseIds }).map(
    (p) => `${row.manifestPath}: ${p.replace(/^line 1: /, '')}`,
  )
  if (rowProblems.length > 0) return rowProblems

  const respPath = row.raw.response_path as string
  if (!input.archiveSha256.has(respPath)) return [`응답 아카이브가 head tree에 없습니다: ${respPath}`]
  const actual = input.archiveSha256.get(respPath)
  if (actual === null || actual === undefined) return [`검증 불가: 아카이브 blob을 읽지 못했습니다(${respPath}) — 손상 단정 대신 미입증으로 둡니다`]
  if (actual !== row.raw.response_sha256) return [`아카이브 SHA-256 불일치: ${respPath} (manifest ${String(row.raw.response_sha256).slice(0, 12)}… ≠ 실제 ${actual.slice(0, 12)}…)`]
  return []
}
