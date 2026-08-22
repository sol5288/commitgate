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
import { createHash } from 'node:crypto'
import { BOOKKEEPING_TRAILER } from './bookkeeping'
import { validateManifest } from './evidence'
import type { AttestationRow } from './attestations'
import { attestationsPath, parseAttestations } from './attestations'
import type { GitAdapter } from './adapters'

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

// ───────────────────────── 심층 수집 (REQ-2026-127 · REQ-2026-172 로 lib 이관) ──
//
// 🔴 **왜 lib 인가**(REQ-2026-172 DEC-3): `bin/integrate.ts` 만 쓰던 시절엔 `bin/verify-range.ts` 에
//    있어도 됐다. 그러나 `req:delegate` 의 발급 시점 preflight 가 **같은 범위 사실**을 필요로 하면서,
//    scripts CLI 가 bin CLI 를 끌어오는 모양이 된다. 공유되는 것은 lib 에 둔다.
//    동작은 한 줄도 바뀌지 않았다 — 위치와 `readBlobs` 타입 표기만 바뀌었다.

/** blob 배치 읽기 포트. `lib/git-batch` 의 `readBlobsAtRef` 가 이 모양이다. */
export type ReadBlobsPort = (ref: string, paths: readonly string[]) => Map<string, Buffer | null>

/**
 * **OID 로** blob 을 읽는 포트(REQ-2026-176). 반환 Map 의 키는 요청한 oid.
 * `lib/git-batch` 의 `readBlobsByOid` 가 이 모양이다.
 */
export type ReadBlobsByOidPort = (oids: readonly string[]) => Map<string, Buffer | null>


// ───────────────────────── 심층 수집(REQ-2026-127 — 프로세스 수 상한 계약) ──
//
// git 프로세스: log×2(메타·name-only) + ls-tree×1 + diff-tree×(merge 수) + readBlobs 배치 ≤2회.
// manifest·아카이브 수 N에 비례한 프로세스를 만들지 않는다(완료 기준 7 — fake 호출 기록 오라클).

export function collectDeepInput(
  git: GitAdapter,
  readBlobs: ReadBlobsPort,
  base: string,
  head: string,
  ticketRoot: string,
  /**
   * 🔴 **필수**다(REQ-2026-176 DEC-2). 선택 인자로 두면 `(ref, paths) => …` 람다가 조용히
   *    떨어뜨린다 — 이 저장소가 최근 작업에서만 다섯 번 만든 사각지대다.
   *    필수면 tsc 가 호출부 전부에서 멈춘다: 컴파일러가 배선 검사를 대신한다.
   */
  readByOid: ReadBlobsByOidPort,
): DeepVerifyInput {
  // 1) 커밋 메타(+tree — attestation identity 대조용).
  const raw = git.exec(['log', `--format=%H%x1f%T%x1f%P%x1f%B%x00`, `${base}..${head}`])
  const metas: (DeepCommitMeta & { tree: string; changedPaths: string[]; ccPaths: string[] })[] = raw
    .split('\0')
    .map((r) => r.replace(/^\n+/, ''))
    .filter((r) => r !== '')
    .map((rec) => {
      const i1 = rec.indexOf('\x1f')
      const i2 = rec.indexOf('\x1f', i1 + 1)
      const i3 = rec.indexOf('\x1f', i2 + 1)
      const sha = rec.slice(0, i1)
      const tree = rec.slice(i1 + 1, i2)
      const parents = rec.slice(i2 + 1, i3).trim()
      const message = rec.slice(i3 + 1)
      return {
        sha,
        tree,
        parentCount: parents === '' ? 0 : parents.split(' ').length,
        subject: message.split('\n')[0] ?? '',
        message,
        changedPaths: [],
        ccPaths: [],
      }
    })
  const bySha = new Map(metas.map((m) => [m.sha, m]))

  // 2) non-merge 변경 경로 — name-only 1회(merge는 기본 diff 미출력 → 빈 목록 유지).
  const nameOnly = git.exec(['log', `--format=%x01%H`, '--name-only', `${base}..${head}`])
  for (const block of nameOnly.split('\x01')) {
    const lines = block.split('\n').map((l) => l.trim())
    const sha = lines[0] ?? ''
    const m = bySha.get(sha)
    if (m === undefined) continue
    m.changedPaths = lines.slice(1).filter(Boolean)
  }

  // 3) merge의 conflict resolution/evil-merge 경로 — merge 커밋당 diff-tree --cc 1회(소수).
  for (const m of metas) {
    if (m.parentCount < 2) continue
    const cc = git.exec(['diff-tree', '--cc', '--name-only', m.sha])
    m.ccPaths = cc
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '' && l !== m.sha)
  }

  // 4) head tree 목록 1회 → manifest·state·attestations·아카이브 실재 판정의 공통 원천.
  //
  // 🔴 REQ-2026-176: `--name-only` 를 **뗐다**. `<mode> <type> <oid>\t<path>` 가 나오므로
  //    같은 한 번의 호출에서 **경로와 OID 를 함께** 얻는다 — git 프로세스는 늘지 않는다.
  //    OID 로 요청하면 `cat-file --batch` 가 트리를 되짚지 않는다(이 저장소 실측 6.6배 · 콜드 17.9배).
  //    파싱 규칙은 종전 그대로다(`-z` 아님) — 바꾸면 `treePaths` 판정이 움직여 게이트가 달라진다.
  const oidByPath = new Map<string, string>()
  const treePaths = new Set<string>()
  for (const line of git.exec(['ls-tree', '-r', head, '--', ticketRoot]).split('\n')) {
    // 🔴 탭이 없는 줄도 **경로로 받는다**. `treePaths` 는 실재 판정의 원천이고, 한 줄이라도
    //    빠지면 있는 증거가 '트리에 없음 = invalid' 로 뒤집힌다. OID 만 없는 것으로 취급하고
    //    읽기는 폴백이 책임진다(DEC-3) — 느려질 뿐 판정은 종전과 같다.
    const tab = line.indexOf('\t')
    const path = (tab === -1 ? line : line.slice(tab + 1)).trim()
    if (path === '') continue
    treePaths.add(path)
    if (tab === -1) continue
    const oid = line.slice(0, tab).split(' ')[2]
    if (oid !== undefined && oid !== '') oidByPath.set(path, oid)
  }

  /**
   * 경로 목록을 **OID 로** 읽고 결과를 다시 **경로 키**로 돌려준다(반환 모양은 종전과 동일).
   *
   * 🔴 OID 를 못 얻은 경로는 **옛 경로 요청으로 반드시 읽는다**(DEC-3). 빠뜨리면 그 blob 이 조용히
   *    `null` 이 되고, `null` 은 "읽기 실패 = 검증 불가"로 해석돼 **정상 커밋이 미입증으로 떨어진다**.
   *    읽지 못한 것을 사실로 쓰지 않는다(REQ-2026-160).
   */
  const readByPathViaOid = (paths: readonly string[]): Map<string, Buffer | null> => {
    if (paths.length === 0) return new Map()
    const withOid: string[] = []
    const withoutOid: string[] = []
    for (const p of paths) (oidByPath.has(p) ? withOid : withoutOid).push(p)
    const out = new Map<string, Buffer | null>()
    if (withOid.length > 0) {
      const byOid = readByOid(withOid.map((p) => oidByPath.get(p) as string))
      for (const p of withOid) out.set(p, byOid.get(oidByPath.get(p) as string) ?? null)
    }
    if (withoutOid.length > 0) for (const [p, buf] of readBlobs(head, withoutOid)) out.set(p, buf)
    return out
  }
  const manifestPaths = [...treePaths].filter((p) => p.endsWith('/responses/approvals.jsonl'))
  const ticketRels = manifestPaths.map((p) => p.split('/').slice(0, 2).join('/'))
  const statePaths = ticketRels.map((t) => `${t}/state.json`).filter((p) => treePaths.has(p))
  const attPath = attestationsPath(ticketRoot)
  const wantAtt = treePaths.has(attPath)

  // 5) 배치 1회차: manifest + state + attestations.
  const batch1 = readByPathViaOid([...manifestPaths, ...statePaths, ...(wantAtt ? [attPath] : [])])
  const manifests = manifestPaths.map((p) => ({ path: p, content: batch1.get(p)?.toString('utf8') ?? '' }))

  const statePhases = new Map<string, readonly string[] | null>()
  for (const t of ticketRels) {
    const buf = batch1.get(`${t}/state.json`)
    if (buf === undefined || buf === null) {
      statePhases.set(t, null)
      continue
    }
    try {
      const st = JSON.parse(buf.toString('utf8')) as { phases?: { id?: unknown }[] }
      const ids = Array.isArray(st.phases)
        ? st.phases.map((ph) => ph.id).filter((id): id is string => typeof id === 'string')
        : null
      statePhases.set(t, ids)
    } catch {
      statePhases.set(t, null)
    }
  }

  const attParsed = wantAtt ? parseAttestations(batch1.get(attPath)?.toString('utf8') ?? '') : { rows: [], problems: 0 }

  // 6) 배치 2회차: 소비 행이 참조하는 아카이브만 읽어 SHA-256 산출. 실재 여부는 treePaths가 판정
  //    (map에 없음=트리 부재=invalid · 값 null=읽기 실패=검증 불가).
  const rangeShas = new Set(metas.map((m) => m.sha))
  const referenced = new Set<string>()
  for (const mf of manifests) {
    for (const line of mf.content.split('\n')) {
      if (line.trim() === '') continue
      try {
        const row = JSON.parse(line) as { consumed_by_commit_sha?: unknown; response_path?: unknown }
        if (
          typeof row.consumed_by_commit_sha === 'string' &&
          rangeShas.has(row.consumed_by_commit_sha) &&
          typeof row.response_path === 'string'
        )
          referenced.add(row.response_path)
      } catch {
        /* 손상 행은 코어가 센다 */
      }
    }
  }
  const inTree = [...referenced].filter((p) => treePaths.has(p))
  const batch2 = inTree.length > 0 ? readByPathViaOid(inTree) : new Map<string, Buffer | null>()
  const archiveSha256 = new Map<string, string | null>()
  for (const p2 of inTree) {
    const buf = batch2.get(p2)
    archiveSha256.set(p2, buf === null || buf === undefined ? null : createHash('sha256').update(buf).digest('hex'))
  }

  return {
    commits: metas,
    manifests,
    ticketRoot,
    statePhases,
    attestations: attParsed.rows,
    attestationProblems: attParsed.problems,
    commitTrees: new Map(metas.map((m) => [m.sha, m.tree])),
    archiveSha256,
  }
}
