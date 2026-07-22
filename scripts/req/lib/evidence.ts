/**
 * 승인 증거(evidence) 정본 — `approvals.jsonl` 매니페스트 모델·검증과 그 보조 술어의 **단일 지점** (REQ-2026-048 DEC-1).
 *
 * **왜 별도 모듈인가**: design 승인 경로(`review-codex`)와 커밋 경로(`req-commit`)가 **같은 증거 내구화 로직**을
 * 써야 하는데, 기존엔 그 로직이 `req-commit`에 있고 `req-commit → review-codex` 방향 import가 이미 있었다.
 * `review-codex`가 `req-commit`을 부르면 **런타임 순환**이 된다. 그래서 공통 부분을 leaf로 내린다.
 *
 * 🔴 **이 파일은 leaf여야 한다.** 런타임 import는 `./scratch`(그 자신도 leaf) 하나뿐이고, `review-codex`에서는
 *    **타입만**(`import type` — 컴파일 시 소거) 가져온다. 여기에 `../review-codex`·`../req-doctor`·`../req-commit`의
 *    **값(런타임) import를 추가하는 순간 순환이 되살아난다** — `tests/unit/evidence-module.test.ts`가 이를 고정한다.
 *
 * ⚠️ 원래 위치에서 **이동**해 온 것들이며 동작은 바뀌지 않았다. 기존 호출부·테스트가 깨지지 않도록
 *    `review-codex`(`archiveBaseName`·`isValidIsoInstant`)·`req-doctor`(`isConfinedArchivePath`)·
 *    `req-commit`(나머지)이 각각 **re-export**한다.
 */
import { isArchiveFileName } from './scratch'
import type { ApprovalEvidence, ReviewKind } from '../review-codex'

// ─────────────────────────────────────────────────────── 공통 형식 술어 ──

const SHA256_RE = /^[0-9a-f]{64}$/i
const GIT_OID_RE = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i // git OID: 40(SHA-1) 또는 64(SHA-256)
const REVIEW_ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * ISO instant 유효성(REQ-2026-028 D2). **형식 + 달력 유효성 둘 다**(design-r02·r03).
 * `REVIEW_ISO_RE`만으론 `2026-99-99T99:99:99Z`가 통과하므로, 재파싱해 성분(연·월·일·시·분·초)이 보존되는지 확인.
 * 밀리초 표기 차(`08Z` vs `08.000Z`)는 비교에서 무시 — 성분이 맞으면 유효.
 */
export function isValidIsoInstant(s: unknown): boolean {
  if (typeof s !== 'string' || !REVIEW_ISO_RE.test(s)) return false
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return false
  // 재직렬화 후 초까지 성분 비교(밀리초 절단). `2026-99-99...`는 여기서 불일치로 걸린다.
  const canon = (x: string): string => x.replace(/\.\d+Z$/, 'Z').replace(/Z$/, '')
  return canon(d.toISOString()) === canon(s)
}

/** 아카이브 base(round namespace): design은 'design'(phaseId 무시), phase는 phaseId(없으면 'phase'=레거시). */
export function archiveBaseName(kind: ReviewKind, phaseId: string | null): string {
  return kind === 'design' ? 'design' : phaseId && phaseId.length > 0 ? phaseId : 'phase'
}

/**
 * evidence `response_path`가 **현재 티켓 `responses/` 직계 아카이브**인지(D-016 confinement).
 * 절대경로·`..`·다른 티켓·중첩경로·`approvals.jsonl` 등 비아카이브는 거부. ticketRel 미지정 시 false(fail-closed).
 */
export function isConfinedArchivePath(p: string, ticketRel: string | undefined): boolean {
  if (!ticketRel || typeof p !== 'string' || !p) return false
  const norm = p.replace(/\\/g, '/')
  if (norm.includes('..') || norm.startsWith('/') || /^[a-zA-Z]:\//.test(norm)) return false
  const prefix = `${ticketRel.replace(/\\/g, '/').replace(/\/+$/, '')}/responses/`
  if (!norm.startsWith(prefix)) return false
  const name = norm.slice(prefix.length)
  if (!name || name.includes('/')) return false
  return isArchiveFileName(name)
}

// ───────────────────────────────── approvals.jsonl 매니페스트 모델 (B1) ──

/** HIGH 사람확인 감사 기록(암호학적 증명 아님 — D-016-8). */
export interface UserCommitConfirmed {
  confirmed: boolean
  method: string
  confirmed_at: string
  note?: string
}

/** approvals.jsonl 한 줄(D-016-3b). kind 격리: phase=approved_tree, design=design_hash. */
export interface ManifestEntry {
  kind: ReviewKind
  phase_id: string | null
  response_path: string
  response_sha256: string
  review_base_sha: string
  approved_tree?: string
  design_hash?: string
  approved_at: string
  consumed_at: string
  consumed_by_commit_sha: string
  user_commit_confirmed: UserCommitConfirmed | null
}

/** approvals.jsonl 엔트리 허용 top-level 키(이 외 = 주입/오염 → fail). */
const MANIFEST_KEYS = new Set([
  'kind',
  'phase_id',
  'response_path',
  'response_sha256',
  'review_base_sha',
  'approved_tree',
  'design_hash',
  'approved_at',
  'consumed_at',
  'consumed_by_commit_sha',
  'user_commit_confirmed',
])

/**
 * user_commit_confirmed 감사 기록 형식 검증(순수). 유효하면 null, 아니면 사유.
 * 요구: confirmed===true · method(공백 아닌 문자열) · confirmed_at(ISO).
 * ⚠️ 위조불가 증명이 아니다 — Claude가 생성 가능한 플래그. 가장 강한 보장 = 사용자가 직접 `req:commit` 실행.
 */
export function userConfirmProblem(ucc: unknown): string | null {
  if (!ucc || typeof ucc !== 'object') return '기록 없음'
  const c = ucc as { confirmed?: unknown; method?: unknown; confirmed_at?: unknown }
  if (c.confirmed !== true) return 'confirmed=true 아님'
  if (typeof c.method !== 'string' || !c.method.trim()) return 'method(공백 아닌 문자열) 필요'
  if (!isValidIsoInstant(c.confirmed_at)) return 'confirmed_at(ISO) 필요'
  return null
}

/**
 * 승인 증거(state pin)와 소비 정보로 매니페스트 엔트리 생성(순수, 고정 필드·키 순서).
 * kind 격리: phase→approved_tree만, design→design_hash만(반대 kind 필드 미포함).
 */
export function buildManifestEntry(
  ev: ApprovalEvidence,
  consume: { consumedAt: string; consumedByCommitSha: string; userCommitConfirmed: UserCommitConfirmed | null },
): ManifestEntry {
  const base: ManifestEntry = {
    kind: ev.review_kind,
    phase_id: ev.phase_id ?? null,
    response_path: ev.response_path,
    response_sha256: ev.response_sha256,
    review_base_sha: ev.review_base_sha,
    approved_at: ev.approved_at,
    consumed_at: consume.consumedAt,
    consumed_by_commit_sha: consume.consumedByCommitSha,
    user_commit_confirmed: consume.userCommitConfirmed,
  }
  // fail-fast: kind별 필수 바인딩 필드(phase=approved_tree, design=design_hash). 반대 kind 필드는 미포함.
  if (ev.review_kind === 'design') {
    const designHash = ev.design_hash
    if (typeof designHash !== 'string' || !designHash)
      throw new Error('buildManifestEntry: design evidence에 design_hash 누락(fail-fast)')
    return { ...base, phase_id: null, design_hash: designHash }
  }
  const approvedTree = ev.approved_tree
  if (typeof approvedTree !== 'string' || !approvedTree)
    throw new Error('buildManifestEntry: phase evidence에 approved_tree 누락(fail-fast)')
  return { ...base, approved_tree: approvedTree }
}

/** 매니페스트 한 줄 직렬화(JSONL): JSON + 끝 개행. 고정 키 순서라 deterministic. */
export function serializeManifestLine(entry: ManifestEntry): string {
  return `${JSON.stringify(entry)}\n`
}

/**
 * approvals.jsonl 내용 검증(순수, fail-closed). 문제 목록 반환(빈 배열=정상).
 * 검사: malformed JSONL · response_path confinement(현재 티켓 responses/ 직계) · SHA-256 형식 ·
 *   phase kind의 phase_id 유효성 · (kind,phase_id,sha) 중복/주입.
 */
export function validateManifest(content: string, opts: { ticketRel: string; validPhaseIds: string[] }): string[] {
  const problems: string[] = []
  const seenKey = new Set<string>()
  const seenPath = new Set<string>()
  const lines = content.split('\n').map((l) => l.trim()).filter(Boolean)
  for (let i = 0; i < lines.length; i++) {
    const ln = i + 1
    let e: Record<string, unknown>
    try {
      e = JSON.parse(lines[i] as string) as Record<string, unknown>
    } catch {
      problems.push(`line ${ln}: malformed JSON`)
      continue
    }
    if (!e || typeof e !== 'object' || Array.isArray(e)) {
      problems.push(`line ${ln}: object 아님`)
      continue
    }
    // 예상 외 extra field 금지(주입 차단).
    for (const k of Object.keys(e)) if (!MANIFEST_KEYS.has(k)) problems.push(`line ${ln}: 예상 외 필드: ${k}`)
    const kind = e.kind
    if (kind !== 'phase' && kind !== 'design') problems.push(`line ${ln}: kind 비유효: ${String(kind)}`)
    // 공통: 경로 confinement, sha/OID/ISO 형식.
    const respPath = typeof e.response_path === 'string' ? e.response_path : ''
    if (!isConfinedArchivePath(respPath, opts.ticketRel)) problems.push(`line ${ln}: response_path 비confined: ${respPath}`)
    // B1-P2-1: manifest 행(=소비된 승인)의 response_path basename은 그 행의 kind/phase_id **승인본**(-approved)이어야.
    // (design→phase 아카이브·타 phase·needs-fix 가리키는 주입/변조 차단. expectedArchivePaths[chore 대상]는 needs-fix 포함 별개.)
    if (kind === 'phase' || kind === 'design') {
      const expBase = archiveBaseName(kind, kind === 'phase' && typeof e.phase_id === 'string' ? e.phase_id : null)
      const name = respPath.split('/').pop() ?? ''
      if (!new RegExp(`^${escapeRegExp(expBase)}-r\\d{2,}-approved\\.json$`).test(name))
        problems.push(`line ${ln}: response_path가 ${expBase}-rNN-approved.json 아님: ${name}`)
    }
    if (typeof e.response_sha256 !== 'string' || !SHA256_RE.test(e.response_sha256)) problems.push(`line ${ln}: response_sha256 형식 오류(64hex)`)
    if (typeof e.review_base_sha !== 'string' || !GIT_OID_RE.test(e.review_base_sha)) problems.push(`line ${ln}: review_base_sha 비-OID`)
    if (typeof e.consumed_by_commit_sha !== 'string' || !GIT_OID_RE.test(e.consumed_by_commit_sha)) problems.push(`line ${ln}: consumed_by_commit_sha 비-OID`)
    if (!isValidIsoInstant(e.approved_at)) problems.push(`line ${ln}: approved_at 비-ISO`)
    if (!isValidIsoInstant(e.consumed_at)) problems.push(`line ${ln}: consumed_at 비-ISO`)
    // kind별 strict 바인딩(반대 kind 필드 금지).
    if (kind === 'phase') {
      if (typeof e.phase_id !== 'string' || !e.phase_id || !opts.validPhaseIds.includes(e.phase_id))
        problems.push(`line ${ln}: phase_id 비유효: ${String(e.phase_id)}`)
      if (typeof e.approved_tree !== 'string' || !GIT_OID_RE.test(e.approved_tree)) problems.push(`line ${ln}: approved_tree 비-OID`)
      if ('design_hash' in e) problems.push(`line ${ln}: phase entry에 design_hash 금지`)
    } else if (kind === 'design') {
      if (e.phase_id !== null) problems.push(`line ${ln}: design entry는 phase_id=null이어야`)
      if (typeof e.design_hash !== 'string' || !SHA256_RE.test(e.design_hash)) problems.push(`line ${ln}: design_hash 비-64hex`)
      if ('approved_tree' in e) problems.push(`line ${ln}: design entry에 approved_tree 금지`)
    }
    // user_commit_confirmed: null 또는 유효 감사 기록(confirmed=true·method·ISO confirmed_at)만. (B2-block3)
    const ucc = e.user_commit_confirmed
    if (ucc !== null) {
      const p = userConfirmProblem(ucc)
      if (p) problems.push(`line ${ln}: user_commit_confirmed ${p}(null 또는 confirmed=true·method·ISO confirmed_at)`)
    }
    // 중복: (kind/phase/sha) + response_path 두 기준 모두.
    const key = `${String(kind)}:${String(e.phase_id)}:${String(e.response_sha256)}`
    if (seenKey.has(key)) problems.push(`line ${ln}: 중복 entry(kind/phase/sha): ${key}`)
    seenKey.add(key)
    if (respPath) {
      if (seenPath.has(respPath)) problems.push(`line ${ln}: 중복 response_path: ${respPath}`)
      seenPath.add(respPath)
    }
  }
  return problems
}

/**
 * 이번 target(kind/phaseId)의 **예상 응답 아카이브 repo-경로만** 반환(blanket `git add responses/` 금지).
 * archiveNames(responses/ 디렉터리 파일명)에서 해당 base의 rNN 아카이브만 필터 → 현재 티켓 responses/ 경로로.
 * needs-fix + approved 모두 포함(evidence chore는 실패 라운드까지 영속화) — 매니페스트 행 검증(approved만)과 별개.
 */
export function expectedArchivePaths(
  archiveNames: string[],
  kind: ReviewKind,
  phaseId: string | null,
  ticketRel: string,
): string[] {
  const base = archiveBaseName(kind, phaseId)
  const re = new RegExp(`^${escapeRegExp(base)}-r(\\d{2,})-(approved|needs-fix)\\.json$`)
  const dir = `${ticketRel.replace(/\\/g, '/').replace(/\/+$/, '')}/responses`
  // readdir 순서 비의존 — round(rNN) 오름차순 정렬(deterministic).
  return archiveNames
    .map((n) => ({ n, m: isArchiveFileName(n) ? re.exec(n) : null }))
    .filter((x): x is { n: string; m: RegExpExecArray } => x.m !== null)
    .sort((a, b) => Number.parseInt(a.m[1] ?? '0', 10) - Number.parseInt(b.m[1] ?? '0', 10))
    .map((x) => `${dir}/${x.n}`)
}

/**
 * approvals.jsonl에 **이 evidence가** 이미 finalize된 엔트리가 있는지(순수, 멱등 finalize용).
 * ⚠️ B3-R2: consumed_by_commit_sha만으로는 부족 — 같은 source SHA를 쓰는 design-finalize row 등에 오인될 수 있음.
 *   sourceSha **+ evidence identity(kind·phase_id·response_sha256)** 전부 일치해야 동일 엔트리로 판정.
 */
export function manifestHasConsumed(
  content: string,
  sourceSha: string,
  identity: { reviewKind: ReviewKind; phaseId: string | null; responseSha256: string },
): boolean {
  for (const line of content.split('\n').map((l) => l.trim()).filter(Boolean)) {
    try {
      const e = JSON.parse(line) as { consumed_by_commit_sha?: unknown; kind?: unknown; phase_id?: unknown; response_sha256?: unknown }
      if (
        e &&
        typeof e === 'object' &&
        e.consumed_by_commit_sha === sourceSha &&
        e.kind === identity.reviewKind &&
        (e.phase_id ?? null) === identity.phaseId &&
        e.response_sha256 === identity.responseSha256
      )
        return true
    } catch {
      // malformed 줄은 무시(무결성은 validateManifest 담당)
    }
  }
  return false
}
