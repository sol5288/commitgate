#!/usr/bin/env tsx
/**
 * req:commit — AI REQ 워크플로우 Phase B (REQ-2026-016). 승인된 phase를 커밋하는 래퍼.
 *
 * SSOT 설계: ../palm-kiosk/docs/evaluation/ai-req-workflow-design.md / 본 티켓 01-design.md D-016-3·3b·7·8·9.
 * 책임(전체): req:doctor 통과 게이트 → HIGH 사람확인 게이트 → source 커밋(승인 코드만) →
 *   commit_allowed 소비 → evidence-finalize(approvals.jsonl 매니페스트 append + responses chore 커밋) → 2-커밋.
 *   복구/finalize 모드(pending_evidence_for)·design-finalize 포함.
 *
 * **B1: 순수 기반/매니페스트 모델**. **B2(현재): 정상 flow** — doctor 게이트→HIGH→source 커밋→evidence-finalize→소비(2-커밋).
 *   복구/finalize 모드(pending_evidence_for)·design-finalize는 **B3**. main()은 `--run` 없으면 dry-run(부작용 없음).
 *   ⚠️ B2 도구 자체 커밋은 부트스트랩 수기(req:commit dogfood는 Phase C부터).
 */
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve, join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  loadState,
  writeState,
  readPhases,
  archiveBaseName,
  isArchiveFileName,
  type ApprovalEvidence,
  type ReviewKind,
  type WorkflowState,
} from './review-codex'
import { isConfinedArchivePath } from './req-doctor'
import { loadConfig, packageRoot, buildScriptInvocation, DEFAULTS, type PackageManager, type ResolvedConfig } from './lib/config'
import { createGitAdapter, type GitAdapter } from './lib/adapters'

// git=GitAdapter 경유(D-017-3), 패키지매니저=config. runDoctor(pnpm/npm 실행)는 cwd=gitRoot 필요(비-git 호출). main()이 loadConfig 후 config.root로 설정.
let gitRoot = packageRoot()
let pkgManager: PackageManager = DEFAULTS.packageManager
let gitAdapter: GitAdapter = createGitAdapter(packageRoot())
const SHA256_RE = /^[0-9a-f]{64}$/i
const GIT_OID_RE = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i // git OID: 40(SHA-1) 또는 64(SHA-256)
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/ // new Date().toISOString() 형식
// evidencePreflight 구조 사전검증용 placeholder(실제 sourceSha/consumedAt는 source 커밋 후 채움). valid OID/ISO 형식.
const PREFLIGHT_PLACEHOLDER_OID = '0'.repeat(40)
const PREFLIGHT_PLACEHOLDER_ISO = '2000-01-01T00:00:00.000Z'
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

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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
export function validateManifest(
  content: string,
  opts: { ticketRel: string; validPhaseIds: string[] },
): string[] {
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
    if (typeof e.approved_at !== 'string' || !ISO_RE.test(e.approved_at)) problems.push(`line ${ln}: approved_at 비-ISO`)
    if (typeof e.consumed_at !== 'string' || !ISO_RE.test(e.consumed_at)) problems.push(`line ${ln}: consumed_at 비-ISO`)
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

// ─────────────────────────────────────── B2: HIGH 게이트 / 소비 / preflight(순수) ──

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
  if (typeof c.confirmed_at !== 'string' || !ISO_RE.test(c.confirmed_at)) return 'confirmed_at(ISO) 필요'
  return null
}

/**
 * HIGH 사람확인 게이트(D-016-8, 순수). HIGH인데 유효한 `user_commit_confirmed`(confirmed=true·method·ISO confirmed_at)가 없으면 차단.
 */
export function userConfirmGate(state: WorkflowState): { blocked: boolean; reason?: string } {
  if (state.risk_level !== 'HIGH') return { blocked: false }
  const problem = userConfirmProblem(state.user_commit_confirmed)
  if (!problem) return { blocked: false }
  return {
    blocked: true,
    reason: `HIGH risk: user_commit_confirmed ${problem} — req:commit 차단(감사 기록이며 위조불가 증명 아님; 가장 강한 보장=사용자가 직접 실행).`,
  }
}

/**
 * 승인 소비(D-016-9, 순수). **evidence 커밋 성공 후 마지막**에만 호출.
 * commit_allowed=false · approved_diff_hash=null · consumed_approvals[] append · user_commit_confirmed 초기화 · approval_evidence 핀 제거.
 */
export function consumeState(state: WorkflowState, opts: { sourceCommitSha: string; consumedAt: string }): WorkflowState {
  const rawPrev = (state as { consumed_approvals?: unknown }).consumed_approvals
  const prev = Array.isArray(rawPrev) ? rawPrev : []
  const entry = {
    approved_tree: typeof state.approved_diff_hash === 'string' ? state.approved_diff_hash : null,
    phase_id: typeof state.current_phase === 'string' ? state.current_phase : null,
    consumed_by_commit_sha: opts.sourceCommitSha,
    approval_consumed_at: opts.consumedAt,
  }
  // approval_evidence(현재 pending 승인 핀) + pending_evidence_for(복구 마커)는 소비와 함께 제거(다음 리뷰가 재부착).
  const { approval_evidence: _consumed, pending_evidence_for: _pending, ...rest } = state
  return {
    ...rest,
    commit_allowed: false,
    approved_diff_hash: null,
    consumed_approvals: [...prev, entry],
    user_commit_confirmed: null,
  }
}

// ─────────────────────────────────────────────── B3: 복구/finalize(순수) ──

/**
 * 복구 마커 부착(순수, B3). **source 커밋 직후·evidence-finalize 전**에 기록 → 이후 중단 시 finalize로 복구.
 * approval_evidence는 그대로(소비 전), pending_evidence_for.source_commit_sha로 "source 커밋됨, evidence 미완"을 표시.
 */
export function markPendingEvidence(state: WorkflowState, sourceCommitSha: string): WorkflowState {
  return { ...state, pending_evidence_for: { source_commit_sha: sourceCommitSha } }
}

/** state.pending_evidence_for.source_commit_sha 추출(순수). 없으면 null. */
export function pendingSourceSha(state: WorkflowState): string | null {
  const pending = (state as { pending_evidence_for?: unknown }).pending_evidence_for
  if (!pending || typeof pending !== 'object') return null
  const sha = (pending as { source_commit_sha?: unknown }).source_commit_sha
  return typeof sha === 'string' && sha ? sha : null
}

/**
 * `req:commit --finalize` 적용 가능성 사전판정(순수, B3). source 미커밋 등 비-복구 상태에서 finalize 오용 차단.
 * ⚠️ B3-P1: HEAD가 아니라 **pending_evidence_for.source_commit_sha의 source 커밋 tree**를 approved와 대조.
 *   (evidence 커밋 후엔 HEAD=evidence 커밋이라 HEAD^{tree}≠approved → consume-only 복구창을 막아버리던 결함 수정.)
 * valid 조건: pending 마커 존재 · commit_allowed===true · approval_evidence 존재 · approved_diff_hash 문자열 · **sourceCommitTree == approved_diff_hash**.
 */
export function recoveryClassify(state: WorkflowState, sourceCommitTree: string | null): { valid: boolean; reason: string } {
  if (!pendingSourceSha(state)) return { valid: false, reason: 'pending_evidence_for.source_commit_sha 없음 — 복구할 미완 작업 없음' }
  if (state.commit_allowed !== true) return { valid: false, reason: 'commit_allowed=true 아님 — 복구할 미완 승인 없음' }
  if (!state.approval_evidence) return { valid: false, reason: 'approval_evidence 없음' }
  const approved = typeof state.approved_diff_hash === 'string' ? state.approved_diff_hash : null
  if (!approved) return { valid: false, reason: 'approved_diff_hash 없음' }
  if (sourceCommitTree !== approved)
    return { valid: false, reason: `source 커밋 tree(${String(sourceCommitTree)}) != approved(${approved}) — 잘못된 복구 대상` }
  return { valid: true, reason: 'finalize 유효: source 커밋 tree == approved, evidence/consume 복구 가능(HEAD는 source/evidence 무관)' }
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

export interface PreflightInput {
  existingManifest: string // 현재 approvals.jsonl 내용('' = 없음)
  approvalEvidence: ApprovalEvidence | null
  archiveNames: string[] // readdir(responses).filter(isArchiveFileName)
  ticketRel: string
  validPhaseIds: string[]
  responsePathExists: boolean // existsSync(approval_evidence.response_path)
  userCommitConfirmed: unknown // state.user_commit_confirmed (후보 entry 구성용)
  placeholderCommitSha: string // 구조 사전검증용 valid OID(실제 sourceSha는 source 후)
  placeholderConsumedAt: string // 구조 사전검증용 valid ISO
}

/**
 * **source 커밋 전** evidence preflight(순수, B2-block1/2). 커밋 없이 잡을 수 있는 모든 evidence 실패를 먼저 수집.
 * 빈 배열 = 통과. 하나라도 있으면 git commit을 절대 실행하지 않는다(= source 후 실패 창 최소화).
 * 검사: (a) 기존 매니페스트 무결성 · (b) approval_evidence 존재/형식 · (c) expected 아카이브에 approved≥1 & 전부 confined ·
 *       (d) response_path가 expected에 포함 · (e) response_path 파일 실제 존재 ·
 *       (f) placeholder sourceSha로 후보 entry 빌드+전체 매니페스트 재검증(중복/구조 사전 차단).
 */
export function evidencePreflight(inp: PreflightInput): string[] {
  const problems: string[] = []
  const opts = { ticketRel: inp.ticketRel, validPhaseIds: inp.validPhaseIds }
  // (a) 기존 approvals.jsonl 무결성
  if (inp.existingManifest.trim()) {
    const p = validateManifest(inp.existingManifest, opts)
    if (p.length) problems.push(`기존 approvals.jsonl 무결성 실패: ${p.join('; ')}`)
  }
  // (b) approval_evidence 존재/형식
  const ev = inp.approvalEvidence
  if (!ev) {
    problems.push('approval_evidence 없음')
    return problems
  }
  if (ev.review_kind !== 'phase' && ev.review_kind !== 'design')
    problems.push(`approval_evidence.review_kind 비유효: ${String(ev.review_kind)}`)
  if (typeof ev.response_path !== 'string' || !ev.response_path) {
    problems.push('approval_evidence.response_path 없음')
    return problems
  }
  // (c) expected 아카이브(target 한정)
  const expected = expectedArchivePaths(inp.archiveNames, ev.review_kind, ev.phase_id ?? null, inp.ticketRel)
  if (!expected.some((p) => /-r\d{2,}-approved\.json$/.test(p)))
    problems.push('expectedArchivePaths에 approved 아카이브 없음(needs-fix만 존재 가능)')
  for (const p of expected) if (!isConfinedArchivePath(p, inp.ticketRel)) problems.push(`archive 경로 비confined: ${p}`)
  // (d) response_path가 expected에 포함
  if (!expected.includes(ev.response_path)) problems.push(`approval_evidence.response_path가 expectedArchivePaths에 없음: ${ev.response_path}`)
  // (e) response_path 파일 실제 존재
  if (!inp.responsePathExists) problems.push(`approval_evidence.response_path 파일 부재: ${ev.response_path}`)
  // (f) placeholder sourceSha로 후보 entry 빌드 + 전체 매니페스트 재검증(source 후 실패 최소화)
  try {
    const candidate = buildManifestEntry(ev, {
      consumedAt: inp.placeholderConsumedAt,
      consumedByCommitSha: inp.placeholderCommitSha,
      userCommitConfirmed: (inp.userCommitConfirmed as UserCommitConfirmed | null) ?? null,
    })
    const p = validateManifest(inp.existingManifest + serializeManifestLine(candidate), opts)
    if (p.length) problems.push(`후보 manifest entry 검증 실패: ${p.join('; ')}`)
  } catch (e) {
    problems.push(`buildManifestEntry 실패: ${(e as Error).message}`)
  }
  return problems
}

// ─────────────────────────────────────────── CLI (B2: 정상 req:commit flow) ──

export interface CommitArgs {
  ticket: string | null
  reqId: string | null
  run: boolean
  message: string | null
  messageFile: string | null // REQ-018: --message-file <path>(→ git commit -F). multi-line 메시지를 argv 거치지 않고 전달
  finalize: boolean // B3: source 재커밋 없이 evidence/consume만 복구
  finalizeDesign: boolean // B3: design 승인을 approvals.jsonl에 기록(source/consume 없음)
  root: string | null // config 탐색 루트(--root)
}

/** CLI 파싱(fail-closed). `--ticket`·`--run`·`--message/-m`·`--message-file`·`--finalize`·`--finalize-design`·`--root <dir>`. 값 누락·알 수 없는 옵션은 throw(메시지 상호배타/필수는 resolveMessageSource). */
export function parseArgs(argv: string[]): CommitArgs {
  let ticket: string | null = null
  let reqId: string | null = null
  let run = false
  let message: string | null = null
  let messageFile: string | null = null
  let finalize = false
  let finalizeDesign = false
  let root: string | null = null
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === undefined) continue
    if (a === '--ticket') ticket = argv[++i] ?? null
    else if (a === '--run') run = true
    else if (a === '--message' || a === '-m') message = argv[++i] ?? null
    else if (a === '--message-file') {
      const v = argv[++i]
      if (v === undefined) throw new Error('--message-file 값 필요')
      messageFile = v
    } else if (a === '--finalize') finalize = true
    else if (a === '--finalize-design') finalizeDesign = true
    else if (a === '--root') {
      const v = argv[++i]
      if (v === undefined) throw new Error('--root 값 필요')
      root = v
    } else if (a.startsWith('-')) throw new Error(`알 수 없는 옵션: ${a}`)
    else reqId = a
  }
  if (finalize && finalizeDesign) throw new Error('--finalize 와 --finalize-design 동시 사용 불가')
  if (!ticket && !reqId) throw new Error('REQ id 또는 --ticket <dir> 필요')
  return { ticket, reqId, run, message, messageFile, finalize, finalizeDesign, root }
}

/**
 * 커밋 메시지 출처 해소(순수, REQ-018 D-018-3). **정상 source-커밋 flow 직전에만** 호출.
 * env fallback(CLI 둘 다 없을 때만 REQ_COMMIT_MESSAGE_FILE) → 상호배타·필수 → **절대경로 정규화** → 존재검증.
 * ⚠️ messageFile은 `resolve()`로 절대경로화: existsFn(=existsSync)은 process.cwd 기준, git `-F`는 cwd=gitRoot라
 *    상대경로면 검증 위치와 git 읽기 위치가 어긋난다(CLI/env 동일 처리). existsFn 주입(테스트=fake).
 */
export function resolveMessageSource(
  opts: { message: string | null; messageFile: string | null },
  env: string | undefined,
  existsFn: (p: string) => boolean,
): { message: string | null; messageFile: string | null } {
  const { message } = opts
  let messageFile = opts.messageFile
  if (message === null && messageFile === null && env !== undefined && env !== '') messageFile = env // env fallback(CLI 우선)
  if (message !== null && messageFile !== null)
    throw new Error('-m/--message 와 --message-file/REQ_COMMIT_MESSAGE_FILE 동시 지정 불가')
  if (message === null && messageFile === null)
    throw new Error('커밋 메시지 필요 — -m <msg> 또는 --message-file <path>(또는 REQ_COMMIT_MESSAGE_FILE)')
  if (messageFile !== null) {
    const abs = resolve(messageFile) // 절대경로 정규화(existsFn↔git cwd 위치 일관)
    if (!existsFn(abs)) throw new Error(`--message-file 경로 없음: ${abs}`)
    messageFile = abs
  }
  return { message, messageFile }
}

/**
 * source 커밋 git args 빌더(순수, REQ-018 D-018-3). messageFile→`-F`(메시지 내용이 argv에 없음), message→`-m`.
 * 둘 다/둘 다 아님 → throw(방어 — 정상 경로는 resolveMessageSource가 보장).
 */
export function buildCommitArgs(opts: { message: string | null; messageFile: string | null }): string[] {
  if (opts.message !== null && opts.messageFile !== null)
    throw new Error('buildCommitArgs: message·messageFile 동시 불가(방어)')
  if (opts.messageFile !== null) return ['commit', '-F', opts.messageFile]
  if (opts.message !== null) return ['commit', '-m', opts.message]
  throw new Error('buildCommitArgs: message 또는 messageFile 필요')
}

/**
 * 티켓 디렉터리 + req:doctor 인자 해소(순수, config.workflowDirAbs 기준).
 * doctorArgs에 **--root cfg.root 전파** — 자식 req:doctor가 부모와 동일 root를 쓰도록(일관).
 */
export function resolveCommitTarget(opts: CommitArgs, cfg: ResolvedConfig): { ticketDir: string; doctorArgs: string[] } {
  const rootArgs = ['--root', cfg.root]
  if (opts.ticket) {
    const ticketDir = resolve(opts.ticket)
    return { ticketDir, doctorArgs: ['--ticket', ticketDir, ...rootArgs] }
  }
  const norm = (opts.reqId as string).replace(/^REQ-/, '')
  return { ticketDir: join(cfg.workflowDirAbs, `REQ-${norm}`), doctorArgs: [norm, ...rootArgs] }
}

/** git 실행(GitAdapter 경유, config.root 기준). 실패 시 throw(fail-closed). */
function git(args: string[]): string {
  return gitAdapter.exec(args)
}

/** req:doctor 게이트 — 별도 프로세스로 실행, exit≠0이면 throw(통과 못 하면 커밋 진입 불가). 패키지매니저별 argv는 buildScriptInvocation(npm은 `run --`). */
function runDoctor(doctorArgs: string[]): void {
  const [cmd, ...rest] = buildScriptInvocation(pkgManager, 'req:doctor', doctorArgs)
  if (!cmd) throw new Error('buildScriptInvocation: 빈 호출(패키지매니저 설정 오류)')
  execFileSync(cmd, rest, { cwd: gitRoot, stdio: 'inherit', shell: true })
}

/** `git diff --cached --name-only`를 정규화 경로 배열로. */
function stagedNames(): string[] {
  return git(['diff', '--cached', '--name-only'])
    .split('\n')
    .map((p) => p.trim().replace(/\\/g, '/'))
    .filter(Boolean)
}

interface FinalizeCtx {
  ticketDir: string
  ticketRel: string
  responsesDir: string
  manifestPath: string
  state: WorkflowState
  ev: ApprovalEvidence
  existing: string
  archiveNames: string[]
  validPhaseIds: string[]
  sourceSha: string
}

/**
 * evidence-finalize(**멱등**) + 소비 — 정상 flow와 `--finalize` 복구가 공유.
 * 이미 sourceSha가 매니페스트에 있으면(=evidence 커밋은 됐고 consume만 못 함) append/chore를 skip하고 소비만 수행.
 * 소비는 항상 마지막. state.json은 scratch 유지(커밋 안 함).
 */
function finalizeEvidenceAndConsume(ctx: FinalizeCtx): void {
  // B3-R2: skip(소비-only) 경로 포함 — 변조된 매니페스트 위에서 consume 금지. 기존 무결성 먼저(복구 모드엔 preflight가 없으므로 필수).
  if (ctx.existing.trim()) {
    const ep = validateManifest(ctx.existing, { ticketRel: ctx.ticketRel, validPhaseIds: ctx.validPhaseIds })
    if (ep.length) throw new Error(`기존 approvals.jsonl 무결성 실패(fail-closed): ${ep.join('; ')}`)
  }
  const already = manifestHasConsumed(ctx.existing, ctx.sourceSha, {
    reviewKind: ctx.ev.review_kind,
    phaseId: ctx.ev.phase_id ?? null,
    responseSha256: ctx.ev.response_sha256,
  })
  if (!already) {
    const entry = buildManifestEntry(ctx.ev, {
      consumedAt: new Date().toISOString(),
      consumedByCommitSha: ctx.sourceSha,
      userCommitConfirmed: (ctx.state.user_commit_confirmed as UserCommitConfirmed | null) ?? null,
    })
    const newContent = ctx.existing + serializeManifestLine(entry)
    const reproblems = validateManifest(newContent, { ticketRel: ctx.ticketRel, validPhaseIds: ctx.validPhaseIds })
    if (reproblems.length)
      throw new Error(`(예상외) 매니페스트 검증 실패: ${reproblems.join('; ')} — source=${ctx.sourceSha} 커밋됨, --finalize로 복구`)
    mkdirSync(ctx.responsesDir, { recursive: true })
    writeFileSync(ctx.manifestPath, newContent, 'utf8')
    const archivePaths = expectedArchivePaths(ctx.archiveNames, ctx.ev.review_kind, ctx.ev.phase_id ?? null, ctx.ticketRel)
    git(['add', ...archivePaths, `${ctx.ticketRel}/responses/approvals.jsonl`])
    const choreLeak = stagedNames().filter((p) => !p.startsWith(`${ctx.ticketRel}/responses/`))
    if (choreLeak.length) throw new Error(`evidence 커밋에 responses 외 staged 금지(코드/state 누수): ${choreLeak.join(', ')}`)
    git(['commit', '-m', `chore(${ctx.state.id}): evidence-finalize — ${ctx.ev.review_kind} ${ctx.ev.phase_id ?? ''} 아카이브·approvals.jsonl`])
  } else {
    console.log('[req:commit] evidence 이미 finalize됨(멱등 skip) — 소비만 수행')
  }
  // 소비(마지막) — commit_allowed=false·approved_diff_hash=null·pending 마커 제거.
  writeState(ctx.ticketDir, consumeState(ctx.state, { sourceCommitSha: ctx.sourceSha, consumedAt: new Date().toISOString() }))
}

/**
 * design-finalize(B3) — design 승인을 approvals.jsonl에 audit 기록(source 커밋·commit_allowed 소비 없음).
 * 멱등: 동일 design 엔트리(kind/sha 중복)면 skip. doctor는 정상 실행(우회 아님).
 */
function designFinalize(args: {
  ticketDir: string
  ticketRel: string
  responsesDir: string
  manifestPath: string
  doctorArgs: string[]
  state: WorkflowState
  validPhaseIds: string[]
}): void {
  const dev = (args.state.design_approval_evidence as ApprovalEvidence | undefined) ?? null
  if (!dev) throw new Error('design_approval_evidence 없음 — design 승인 후 실행')
  if (dev.review_kind !== 'design') throw new Error(`design_approval_evidence.review_kind != design: ${String(dev.review_kind)}`)
  runDoctor(args.doctorArgs) // design-finalize도 doctor 우회 금지(정상)
  const opts = { ticketRel: args.ticketRel, validPhaseIds: args.validPhaseIds }
  const existing = existsSync(args.manifestPath) ? readFileSync(args.manifestPath, 'utf8') : ''
  // B3-P2: 기존 매니페스트 단독 무결성 먼저(중복+다른 오염 시 묵인 금지 — 오염이면 여기서 fail-closed).
  if (existing.trim()) {
    const existingProblems = validateManifest(existing, opts)
    if (existingProblems.length) throw new Error(`기존 approvals.jsonl 무결성 실패(fail-closed): ${existingProblems.join('; ')}`)
  }
  const headSha = git(['rev-parse', 'HEAD'])
  const entry = buildManifestEntry(dev, { consumedAt: new Date().toISOString(), consumedByCommitSha: headSha, userCommitConfirmed: null })
  const newContent = existing + serializeManifestLine(entry)
  const problems = validateManifest(newContent, opts)
  // 기존이 이미 클린이므로 newContent의 문제는 후보(candidate) 때문. **오직 중복뿐**일 때만 멱등 skip, 하나라도 다른 문제면 fail.
  if (problems.length) {
    if (problems.every((p) => p.includes('중복'))) {
      console.log('[req:commit] design 승인 이미 기록됨(멱등 skip)')
      return
    }
    throw new Error(`design-finalize 매니페스트 검증 실패: ${problems.join('; ')}`)
  }
  const responsePath = typeof dev.response_path === 'string' ? dev.response_path : ''
  mkdirSync(args.responsesDir, { recursive: true })
  writeFileSync(args.manifestPath, newContent, 'utf8')
  git(['add', responsePath, `${args.ticketRel}/responses/approvals.jsonl`])
  const leak = stagedNames().filter((p) => !p.startsWith(`${args.ticketRel}/responses/`))
  if (leak.length) throw new Error(`design-finalize 커밋에 responses 외 staged 금지: ${leak.join(', ')}`)
  git(['commit', '-m', `chore(${args.state.id}): design-finalize — design 승인 approvals.jsonl 기록`])
  console.log('[req:commit] ✅ design-finalize 완료 — approvals.jsonl 기록')
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2))
  const cfg = loadConfig({ root: opts.root })
  gitRoot = cfg.root // runDoctor(pnpm/npm) cwd
  pkgManager = cfg.packageManager
  gitAdapter = createGitAdapter(cfg.root)
  const { ticketDir, doctorArgs } = resolveCommitTarget(opts, cfg)
  const { run, message, messageFile, finalize, finalizeDesign } = opts
  const state = loadState(ticketDir)
  const ticketRel = relative(cfg.root, ticketDir).replace(/\\/g, '/')
  const responsesDir = join(ticketDir, 'responses')
  const manifestPath = join(responsesDir, 'approvals.jsonl')
  const ev = (state.approval_evidence as ApprovalEvidence | undefined) ?? null
  const validPhaseIds = readPhases(state).map((p) => p.id)

  // ── DRY-RUN(부작용 없음): 게이트/계획 미리보기 ──
  if (!run) {
    const gate = userConfirmGate(state)
    const mode = finalizeDesign ? 'finalize-design' : finalize ? 'finalize(복구)' : '정상'
    console.log(`[req:commit] DRY-RUN (모드=${mode}; 실제 실행은 --run)`)
    console.log(`  ticket=${ticketRel} commit_allowed=${String(state.commit_allowed)} risk=${String(state.risk_level)}`)
    console.log(`  HIGH 게이트: ${gate.blocked ? `차단 — ${gate.reason}` : 'OK(또는 비-HIGH)'}`)
    if (finalize) {
      const sha = pendingSourceSha(state)
      let sourceTree: string | null = null
      if (sha) {
        try {
          sourceTree = git(['rev-parse', `${sha}^{tree}`])
        } catch {
          sourceTree = null
        }
      }
      const rc = recoveryClassify(state, sourceTree)
      console.log(`  finalize 적용 가능성: ${rc.valid ? 'valid' : `invalid — ${rc.reason}`}`)
    }
    if (ev) {
      const archiveNames = existsSync(responsesDir) ? readdirSync(responsesDir).filter(isArchiveFileName) : []
      const expected = expectedArchivePaths(archiveNames, ev.review_kind, ev.phase_id ?? null, ticketRel)
      console.log(`  approval_evidence: ${ev.review_kind} ${ev.phase_id ?? ''} → evidence-finalize 아카이브 ${expected.length}건`)
    } else {
      console.log('  approval_evidence 없음(review-codex 승인 후 실행)')
    }
    if (existsSync(manifestPath)) {
      const problems = validateManifest(readFileSync(manifestPath, 'utf8'), { ticketRel, validPhaseIds })
      console.log(`  approvals.jsonl: ${problems.length ? `문제 ${problems.length} — ${problems.join('; ')}` : 'OK'}`)
    }
    return
  }

  // ── B3: design-finalize(source/consume 없음) ──
  if (finalizeDesign) {
    designFinalize({ ticketDir, ticketRel, responsesDir, manifestPath, doctorArgs, state, validPhaseIds })
    return
  }

  const existing = existsSync(manifestPath) ? readFileSync(manifestPath, 'utf8') : ''
  const archiveNames = existsSync(responsesDir) ? readdirSync(responsesDir).filter(isArchiveFileName) : []

  // ── B3: finalize(복구) — source 재커밋 없이 evidence/consume만 복구 ──
  if (finalize) {
    // B3-P1: source SHA는 pending 마커에서. HEAD는 source/evidence 커밋 어느 쪽이든 가능(consume-only 복구창 포함).
    const sourceSha = pendingSourceSha(state)
    if (!sourceSha) throw new Error('finalize 거부: pending_evidence_for.source_commit_sha 없음 — 복구할 미완 작업 없음')
    const sourceTree = git(['rev-parse', `${sourceSha}^{tree}`])
    const rc = recoveryClassify(state, sourceTree)
    if (!rc.valid) throw new Error(`finalize 거부: ${rc.reason}`)
    if (!ev) throw new Error('approval_evidence 없음') // rc.valid가 보장하나 TS narrowing
    // doctor --finalize: D9를 source 커밋 tree로 교체(우회 아님), 나머지 검사 정상.
    runDoctor([...doctorArgs, '--finalize'])
    const gate = userConfirmGate(state)
    if (gate.blocked) throw new Error(gate.reason)
    finalizeEvidenceAndConsume({ ticketDir, ticketRel, responsesDir, manifestPath, state, ev, existing, archiveNames, validPhaseIds, sourceSha })
    console.log(`[req:commit] ✅ finalize 복구 완료 — source=${sourceSha.slice(0, 8)} · evidence/consume 복구`)
    return
  }

  // ── LIVE (B2 정상 flow) — ⚠️ B2 도구 자체 커밋엔 쓰지 않음(부트스트랩). Phase C부터 dogfood. ──
  const responsePathExists = !!ev && typeof ev.response_path === 'string' && existsSync(resolve(cfg.root, ev.response_path))

  // 1) doctor 게이트(fail-closed)
  runDoctor(doctorArgs)
  // 2) HIGH 사람확인 게이트
  const gate = userConfirmGate(state)
  if (gate.blocked) throw new Error(gate.reason)
  // 3) 전제: 승인 존재 + staged tree == approved_diff_hash + staged=코드만(state/responses 금지)
  if (state.commit_allowed !== true) throw new Error('commit_allowed=true 아님 — 승인된 phase 없음(req:review-codex 승인 필요)')
  if (!ev) throw new Error('approval_evidence 없음 — 승인 증거 미기록')
  if (typeof state.approved_diff_hash !== 'string') throw new Error('approved_diff_hash 없음')
  const stagedTree = git(['write-tree'])
  if (stagedTree !== state.approved_diff_hash)
    throw new Error(`staged tree(${stagedTree}) != approved_diff_hash(${state.approved_diff_hash}) — stale 승인, 재리뷰 필요`)
  const srcStaged = stagedNames()
  if (srcStaged.length === 0) throw new Error('staged 변경 없음 — 승인 코드를 stage 후 실행')
  const nonCode = srcStaged.filter((p) => p === `${ticketRel}/state.json` || p.startsWith(`${ticketRel}/responses/`))
  if (nonCode.length) throw new Error(`source 커밋에 비-코드 staged 금지(state/responses): ${nonCode.join(', ')}`)
  // REQ-018: 메시지 출처 해소(-m 또는 --message-file/env) — 정상 source-커밋 flow에서만. fail-closed(상호배타·필수·존재검증).
  const msgSource = resolveMessageSource({ message, messageFile }, process.env.REQ_COMMIT_MESSAGE_FILE, existsSync)
  // 3b) evidence preflight(B2-block1/2) — source 커밋 전 잡을 수 있는 evidence 실패 전부 차단. 실패 시 git commit 안 함.
  const pre = evidencePreflight({
    existingManifest: existing,
    approvalEvidence: ev,
    archiveNames,
    ticketRel,
    validPhaseIds,
    responsePathExists,
    userCommitConfirmed: (state.user_commit_confirmed as unknown) ?? null,
    placeholderCommitSha: PREFLIGHT_PLACEHOLDER_OID,
    placeholderConsumedAt: PREFLIGHT_PLACEHOLDER_ISO,
  })
  if (pre.length) throw new Error(`evidence preflight 실패(source 커밋 안 함): ${pre.join('; ')}`)
  // 4) source 커밋(승인 코드만) — 여기서부터 부작용. preflight 통과로 source 후 실패 창 최소화.
  // REQ-018: -m(메시지) 또는 -F(파일). messageFile 경로는 pnpm/Windows argv newline 이스케이프를 회피.
  git(buildCommitArgs(msgSource))
  const sourceSha = git(['rev-parse', 'HEAD'])
  // 4b) B3 복구 마커 — source 커밋됨, evidence 미완. 이후 중단 시 `req:commit <id> --finalize --run`으로 복구.
  writeState(ticketDir, markPendingEvidence(state, sourceSha))
  // 5) evidence-finalize(멱등) + 소비(마지막).
  finalizeEvidenceAndConsume({ ticketDir, ticketRel, responsesDir, manifestPath, state, ev, existing, archiveNames, validPhaseIds, sourceSha })
  console.log(`[req:commit] ✅ 완료 — source=${sourceSha.slice(0, 8)} · evidence-finalize · commit_allowed 소비됨`)
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href
if (isMain) main()
