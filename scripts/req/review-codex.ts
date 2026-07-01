#!/usr/bin/env tsx
/**
 * req:review-codex — AI REQ 워크플로우 1차 (단계 2: 조립·바인딩 캡처 + 기반 검증 로직)
 *
 * SSOT 설계: palm-kiosk/docs/evaluation/ai-req-workflow-design.md
 *   §9.5 호출 문법 · §8.4 staged tree OID 바인딩 · §9.6 구조화 응답·도메인 검증
 * 0차 실측: palm-kiosk-app/workflow/00-spike/00-spike-report.md
 * 리뷰 반영(Codex, 2단계): schema 버전 필드·STATUS↔COMMIT 모순 검증·state 부재 명확화·Review Context·AJV(단계3)
 *
 * 단계 2(완료): 조립(handoff·Review Context·request·staged diff) + git 바인딩(staged tree OID) + dry-run 미리보기,
 *   순수 도메인 검증 `validateVerdict`, `loadState`(부재 fail-closed).
 * 단계 3A(현재): AJV 구조검증 `validateResponseStructure` + 승인 반영 `applyVerdict` + `processResponse`(fail-closed) + `writeState`(BOM 없음).
 *   codex 실제 호출과 분리(mockable) — 입력은 이미 존재하는 codex-response.json.
 * 단계 3B(다음): codex exec/resume 실제 호출(thread_id 파싱) + --output-last-message 캡처 + processResponse 배선 +
 *   resume 후 `git status --porcelain` clean 검사 + machine_schema_version emit 재확인.
 *
 * 사용:
 *   pnpm req:review-codex <REQ-id>          # workflow/REQ-<id>/ 대상
 *   pnpm req:review-codex --ticket <dir>    # 임의 티켓 디렉터리
 *   옵션: --handoff <path>  (기본: ../palm-kiosk/docs/evaluation/project-memory/ai-handoff.md, 없으면 생략)
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { resolve, join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import Ajv from 'ajv'
import { loadConfig, packageRoot, DEFAULTS, type ResolvedConfig } from './lib/config'
import {
  createGitAdapter,
  createCodexReviewerAdapter,
  type GitAdapter,
  type ReviewerAdapter,
} from './lib/adapters'

// codex JSONL thread 파싱은 어댑터 모듈 정본(re-export로 기존 import 호환).
export { parseThreadId } from './lib/adapters'

// git·codex(reviewer) 경계 = 어댑터(Phase 3, D-017-3/4). main()이 loadConfig 후 config.root로 재생성(기본 = packageRoot — config 부재 시 현재 동작 보존).
let gitAdapter: GitAdapter = createGitAdapter(packageRoot())
// reviewer는 main에서 재할당 없음(기본 codex). 테스트 주입 이음새는 callReviewer 파라미터.
const reviewer: ReviewerAdapter = createCodexReviewerAdapter()

/** 구조화 응답 스키마 버전 (machine.schema.json과 동기). */
export const MACHINE_SCHEMA_VERSION = '1.1'

/** 리뷰 종류 (DEC-WF-027): design=설계문서 권위, phase=staged diff 권위. */
export type ReviewKind = 'design' | 'phase'

/** design 리뷰 권위 아티팩트 = 티켓 설계 문서 본문 3종. */
export interface DesignDocs {
  requirement: string
  design: string
  plan: string
}

type GitFn = (args: string[]) => string

// 모든 git 호출은 GitAdapter 경유(D-017-3). gitFn 주입점·plumbing 로직 불변.
const git: GitFn = (args) => gitAdapter.exec(args)

// ──────────────────────────────────────────────────────────── 조립 ──

export interface ReviewContext {
  branch: string
  reviewBaseSha: string
  reviewTree: string
  phase: string
  previousResult: string
}

export interface ReviewPromptInput {
  handoff?: string | null
  reviewContext?: ReviewContext | null
  reviewBaseSha: string
  requestBody: string
  reviewKind?: ReviewKind
  stagedDiff?: string
  designDocs?: DesignDocs | null
}

/**
 * 순수 함수: 리뷰 프롬프트 조립 (§9.5).
 * 순서 = [handoff?] → [Review Context?] → REVIEW_BASE_SHA → REVIEW_KIND → codex-request 본문 → 권위 아티팩트.
 * 권위 아티팩트: kind=phase → staged diff(현행), kind=design → 설계 문서 00/01/02 본문(DEC-WF-027 결정#3).
 * handoff·reviewContext는 선택. 빈 request는 fail-closed로 거부. kind 기본값 phase(하위호환).
 */
export function assembleReviewPrompt(input: ReviewPromptInput): string {
  const { handoff, reviewContext, reviewBaseSha, requestBody, stagedDiff, designDocs } = input
  const kind: ReviewKind = input.reviewKind ?? 'phase'
  if (!reviewBaseSha) throw new Error('reviewBaseSha 필요')
  if (!requestBody || !requestBody.trim()) throw new Error('codex-request.md 본문이 비어 있음')
  const blocks: string[] = []
  if (handoff && handoff.trim()) blocks.push(handoff.trim())
  if (reviewContext) {
    blocks.push(
      [
        '# Review Context',
        `- branch: ${reviewContext.branch}`,
        `- review_base_sha: ${reviewContext.reviewBaseSha}`,
        `- review_tree: ${reviewContext.reviewTree}`,
        `- phase: ${reviewContext.phase}`,
        `- previous_codex_result: ${reviewContext.previousResult}`,
      ].join('\n'),
    )
  }
  blocks.push(`---\nREVIEW_BASE_SHA: ${reviewBaseSha}`)
  blocks.push(`---\nREVIEW_KIND: ${kind} (응답 review_kind가 동일해야 함)`)
  blocks.push(`---\n${requestBody.trim()}`)
  if (kind === 'design') {
    if (!designDocs) throw new Error('design 리뷰 권위 아티팩트(00/01/02 designDocs) 필요')
    blocks.push(
      [
        '---\n# 권위 아티팩트 = 설계 문서 00/01/02 (리뷰 대상 = 바인딩 대상)',
        '## 00-requirement.md',
        designDocs.requirement,
        '## 01-design.md',
        designDocs.design,
        '## 02-plan.md',
        designDocs.plan,
      ].join('\n'),
    )
  } else {
    blocks.push(`---\n# 권위 아티팩트 = staged diff (리뷰 대상 = 바인딩 대상)\n${stagedDiff ?? ''}`)
  }
  return blocks.join('\n')
}

/**
 * git 바인딩 캡처 (§8.4): diff '텍스트'가 아니라 staged **tree OID**(git write-tree)를 바인딩.
 * gitFn 주입 가능(테스트용).
 */
export function captureGitBinding(gitFn: GitFn = git): { reviewBaseSha: string; reviewTree: string } {
  const reviewBaseSha = gitFn(['rev-parse', 'HEAD'])
  const reviewTree = gitFn(['write-tree'])
  return { reviewBaseSha, reviewTree }
}

/** 티켓 설계 문서 3종의 repo-relative 경로. shorthand 금지 — 각 경로를 티켓 디렉터리로 정규화. 파일명은 config(designDocs) 주입. */
export function designDocPaths(ticketRelDir: string, designDocs: DesignDocs): [string, string, string] {
  const dir = ticketRelDir.replace(/\\/g, '/').replace(/\/+$/, '')
  return [`${dir}/${designDocs.requirement}`, `${dir}/${designDocs.design}`, `${dir}/${designDocs.plan}`]
}

/**
 * design 바인딩 캡처 (DEC-WF-027 결정#4): 티켓 00/01/02의 **세 full repo-relative 경로**를
 * `git ls-files -s -- <3경로>`에 전달 → 출력 라인 정렬 → SHA256. (subset이라 write-tree 불가)
 * **엔트리가 정확히 3개가 아니면 fail-closed**(git에 추적되지 않은 문서 = 미승인 취급). gitFn 주입 가능.
 */
export function captureDesignBinding(
  ticketRelDir: string,
  gitFn: GitFn = git,
  designDocs: DesignDocs = DEFAULTS.designDocs,
): { designHash: string; paths: string[] } {
  const paths = designDocPaths(ticketRelDir, designDocs)
  const out = gitFn(['ls-files', '-s', '--', ...paths])
  const lines = out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  if (lines.length !== 3)
    throw new Error(
      `design 바인딩 실패: 00/01/02 중 git 추적되지 않은 문서 존재(기대 3, 실제 ${lines.length}). 누락=미승인(fail-closed).`,
    )
  const designHash = createHash('sha256').update([...lines].sort().join('\n')).digest('hex')
  return { designHash, paths }
}

/**
 * 설계 문서 3종 본문을 git **인덱스**에서 읽는다(`git show :<path>`) — Codex P2.
 * 프롬프트 본문(리뷰 대상)과 design 바인딩 해시(`captureDesignBinding`, 인덱스 기반)가 **동일 대상**을 가리키게 하여
 * "리뷰 대상 = 바인딩 대상"(결정#3)을 워킹트리 dirty 여부와 무관하게 보장한다.
 * 인덱스에 없는 문서는 **어느 파일인지 명확한 에러**(fail-closed). gitFn 주입 가능.
 */
export function readDesignDocsFromIndex(
  ticketRelDir: string,
  gitFn: GitFn = git,
  designDocs: DesignDocs = DEFAULTS.designDocs,
): DesignDocs {
  const [reqP, designP, planP] = designDocPaths(ticketRelDir, designDocs)
  const read = (p: string): string => {
    try {
      return gitFn(['show', `:${p}`])
    } catch {
      throw new Error(`--kind design 리뷰 불가: 설계 문서가 git 인덱스에 없음 — ${p} (req:new 스캐폴드 후 git add 필요)`)
    }
  }
  return { requirement: read(reqP), design: read(designP), plan: read(planP) }
}

// ─────────────────────────────────────────── 응답(verdict) 도메인 검증 ──
// 구조(필수 키·enum)는 단계 3에서 AJV(machine.schema.json)로 강제.
// 여기서는 AJV가 표현 못 하는 교차필드 모순·버전·git 바인딩을 fail-closed로 검사(§9.6 rule 2~3).

/** 리뷰 지적 항목 (machine.schema.json 1.1 findings[]). file은 nullable(전역 지적 등). */
export interface Finding {
  severity?: string
  detail?: string
  file?: string | null
}

export interface Verdict {
  machine_schema_version?: string
  review_base_sha?: string
  status?: string
  commit_approved?: string
  merge_ready?: string
  risk_level?: string
  review_kind?: string
  findings?: Finding[]
  next_action?: string
}

const STATUS_VALUES = ['NEEDS_FIX', 'STEP_COMPLETE', 'COMPLETE']
const YESNO = ['yes', 'no']
const RISK_VALUES = ['LOW', 'HIGH']
const REVIEW_KIND_VALUES = ['design', 'phase']

export function validateVerdict(
  v: Verdict,
  opts: { schemaVersion?: string; reviewBaseSha?: string } = {},
): { ok: boolean; errors: string[] } {
  const errors: string[] = []
  const want = opts.schemaVersion ?? MACHINE_SCHEMA_VERSION

  if (v.machine_schema_version !== want)
    errors.push(`machine_schema_version 불일치(기대 ${want}, 실제 ${v.machine_schema_version})`)
  if (!STATUS_VALUES.includes(v.status ?? '')) errors.push(`status 비유효: ${v.status}`)
  if (!YESNO.includes(v.commit_approved ?? '')) errors.push(`commit_approved 비유효: ${v.commit_approved}`)
  if (!YESNO.includes(v.merge_ready ?? '')) errors.push(`merge_ready 비유효: ${v.merge_ready}`)
  if (!RISK_VALUES.includes(v.risk_level ?? '')) errors.push(`risk_level 비유효: ${v.risk_level}`)

  if (!v.review_base_sha) errors.push('review_base_sha 누락')
  else if (opts.reviewBaseSha && v.review_base_sha !== opts.reviewBaseSha)
    errors.push(`review_base_sha 불일치(state ${opts.reviewBaseSha} ≠ resp ${v.review_base_sha})`)

  // review_kind enum (1.1) — design|phase 만 허용
  if (!REVIEW_KIND_VALUES.includes(v.review_kind ?? '')) errors.push(`review_kind 비유효: ${v.review_kind}`)

  // D15 도메인(1.1): NEEDS_FIX면 findings·next_action이 actionable 해야 함.
  // 타입 가드 필수 — 악성/파손 응답(next_action:1 등)이 .trim()에서 throw하면 fail-closed가 깨진다(Codex P2).
  if (v.status === 'NEEDS_FIX') {
    if (!Array.isArray(v.findings) || v.findings.length === 0)
      errors.push('NEEDS_FIX인데 findings가 비어 있음(지적 1건 이상 필요)')
    if (typeof v.next_action !== 'string' || !v.next_action.trim())
      errors.push('NEEDS_FIX인데 next_action이 비어 있음')
  }

  // 교차필드 모순 (§9.6 rule3) — STATUS와 COMMIT/MERGE를 함께 검증
  if (v.commit_approved === 'yes' && v.status === 'NEEDS_FIX')
    errors.push('모순: commit_approved=yes 인데 status=NEEDS_FIX')
  if (v.merge_ready === 'yes' && v.status !== 'COMPLETE')
    errors.push('모순: merge_ready=yes 인데 status≠COMPLETE')
  if (v.merge_ready === 'yes' && v.commit_approved !== 'yes')
    errors.push('모순: merge_ready=yes 인데 commit_approved≠yes')

  return { ok: errors.length === 0, errors }
}

// ───────────────────────────────────────────────────────── state.json ──

/** phases[] 항목(DEC-WF-027 phase 추적). 티켓 저자가 state.json/02-plan에 정의(req-new은 빈 배열로 초기화). */
export interface PhaseEntry {
  id: string
  approved: boolean
}

/**
 * 승인 증거 핀(REQ-016 A1, D-016-2). 승인 시 state.json에 기록되는 런타임 핀.
 * 내구 audit은 커밋된 아카이브(D-016-1)/매니페스트(Phase B). kind 격리: phase=approved_tree, design=design_hash.
 */
export interface ApprovalEvidence {
  response_path: string
  response_sha256: string
  review_kind: ReviewKind
  phase_id: string | null
  review_base_sha: string
  approved_tree?: string
  design_hash?: string | null
  codex_thread_id: string
  machine_schema_version: string
  status: string
  commit_approved: string
  approved_at: string
}

export interface WorkflowState {
  id: string
  phase: string
  branch?: string
  review_base_sha?: string | null
  design_approved?: boolean
  design_approved_hash?: string | null
  current_phase?: string | null
  phases?: PhaseEntry[]
  // REQ-016 A1: 승인 증거 핀(kind 격리) + grandfathering 트리거. 반대 kind 증거는 미오염.
  approval_evidence?: ApprovalEvidence
  design_approval_evidence?: ApprovalEvidence
  approval_evidence_required?: boolean
  [k: string]: unknown
}

/** state.phases를 안전하게 PhaseEntry[]로 읽음(부재/비배열→[], id 문자열 항목만). */
export function readPhases(state: WorkflowState): PhaseEntry[] {
  const raw = (state as { phases?: unknown }).phases
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (p): p is PhaseEntry => !!p && typeof p === 'object' && typeof (p as { id?: unknown }).id === 'string',
  )
}

/**
 * phase 리뷰 대상 해소(순수, Phase 4 — "엉뚱한 phase 승인" 차단).
 * - kind=design → 대상 없음(phaseId=null).
 * - kind=phase + phases[] 비어있음 → 레거시 하위호환(phase 추적 없이 기존 동작, phaseId=null).
 * - kind=phase + phases[] 있음 + `--phase` 누락 → FAIL(대상 모호).
 * - kind=phase + phases[] 있음 + id 불일치(exact) → FAIL(append 금지).
 * - kind=phase + phases[] 있음 + id 일치 → phaseId 반환(이미 승인된 phase여도 허용=멱등).
 */
export function resolvePhaseTarget(
  state: WorkflowState,
  kind: ReviewKind,
  phaseOpt: string | null,
): { ok: boolean; phaseId: string | null; error?: string } {
  if (kind !== 'phase') return { ok: true, phaseId: null }
  // 레거시 판정은 **raw 배열 길이**로 — readPhases(필터) 길이로 하면 malformed 비-빈 phases[]가 레거시로 강등되어
  // --phase 없이 phase 승인되는 우회가 생긴다(Codex P2). 진짜 빈 배열/부재만 레거시 하위호환.
  const raw = (state as { phases?: unknown }).phases
  const rawLen = Array.isArray(raw) ? raw.length : 0
  if (rawLen === 0) return { ok: true, phaseId: null } // 레거시(빈 배열/부재)
  if (!phaseOpt) return { ok: false, phaseId: null, error: 'phases[]가 정의된 티켓은 --phase <id> 필수(대상 모호)' }
  const ids = readPhases(state).map((p) => p.id)
  if (!ids.includes(phaseOpt))
    return {
      ok: false,
      phaseId: null,
      error: `--phase "${phaseOpt}" 가 state.phases[].id와 불일치(유효 id: ${ids.join(', ') || '(없음)'})`,
    }
  return { ok: true, phaseId: phaseOpt }
}

/** state.json 로드. 부재/파손은 **명확한 에러**(자동 생성·애매한 fallback 금지 — Codex 리뷰 P1). */
export function loadState(ticketDir: string): WorkflowState {
  const p = join(ticketDir, 'state.json')
  if (!existsSync(p))
    throw new Error(`state.json 없음: ${p}\n  → req:new으로 티켓을 먼저 생성하세요(자동 생성하지 않음).`)
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(p, 'utf8'))
  } catch (e) {
    throw new Error(`state.json 파싱 실패: ${p} — ${(e as Error).message}`)
  }
  const s = raw as WorkflowState
  if (!s || typeof s !== 'object' || !s.id || !s.phase)
    throw new Error(`state.json 필수 필드(id, phase) 누락: ${p}`)
  return s
}

function readPreviousResult(ticketDir: string): string {
  const p = join(ticketDir, 'codex-response.json')
  if (!existsSync(p)) return 'none'
  try {
    const v = JSON.parse(readFileSync(p, 'utf8')) as Verdict
    return v.status ?? 'unknown'
  } catch {
    return 'unparseable'
  }
}

// ─────────────────────────── 응답 구조검증(AJV) + 상태 반영 (단계 3A) ──
// 구조(필수·enum·additionalProperties)는 AJV(machine.schema.json), 교차필드·바인딩은 validateVerdict.
// codex 실제 호출(단계 3B)과 분리 — 본 함수들은 이미 존재하는 codex-response.json을 입력으로 받음(mockable).

/** 정본 스키마 기본 경로(config 부재 시 fallback). 현재 동작 보존: packageRoot/workflow/machine.schema.json. */
export const MACHINE_SCHEMA_PATH = resolve(packageRoot(), 'workflow', 'machine.schema.json')

/** 구조 검증(AJV): 정본 스키마(필수·enum·additionalProperties)로 codex-response 형식 강제. schemaPath 주입 필수(config 배선). */
export function validateResponseStructure(
  obj: unknown,
  schemaPath: string,
): { ok: boolean; errors: string[] } {
  const ajv = new Ajv({ allErrors: true })
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as object
  const validate = ajv.compile(schema)
  const ok = validate(obj)
  const errors = ok
    ? []
    : (validate.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message ?? ''}`.trim())
  return { ok, errors }
}

export interface Binding {
  reviewBaseSha: string
  reviewTree: string
}

/**
 * 승인 판정 반영(순수).
 * **전제: `validateResponseStructure`(AJV) + `validateVerdict`(도메인) + expectedKind(요청 kind==응답 review_kind)를
 * 이미 통과한 verdict에만 사용**한다(expectedKind 게이트는 `processResponse`가 담당 — 여기선 재검사 안 함).
 * 검증을 건너뛰고 직접 호출하지 말 것 — 오용 시 fail-closed 보장이 깨진다. 정상 경로는 `processResponse`가 호출.
 * 승인은 commit_approved=yes & status∈{STEP_COMPLETE,COMPLETE}일 때만.
 * kind-aware(결정#8): kind=design → design_approved/_hash만, kind=phase → approved_diff_hash/commit_allowed만.
 * 반대 kind 필드는 base에서 보존(한 kind 갱신이 다른 kind 승인을 미변경). 기본 kind=phase(하위호환).
 */
export function applyVerdict(args: {
  base: WorkflowState
  binding: Binding
  verdict: Verdict
  kind?: ReviewKind
  designHash?: string | null
  phaseId?: string | null
}): WorkflowState {
  const { base, binding, verdict } = args
  const kind: ReviewKind = args.kind ?? 'phase'
  const approvable =
    verdict.commit_approved === 'yes' &&
    (verdict.status === 'STEP_COMPLETE' || verdict.status === 'COMPLETE')

  if (kind === 'design') {
    // design 승인은 non-null designHash(freshness anchor) 필수 — 누락 시 approved=true/hash=null 깨진 상태 금지(Codex P3, fail-closed).
    const hashOk = typeof args.designHash === 'string' && args.designHash.trim().length > 0
    return approvable && hashOk
      ? { ...base, design_approved: true, design_approved_hash: args.designHash }
      : { ...base, design_approved: false, design_approved_hash: null }
  }

  const approvedState: WorkflowState = {
    ...base,
    approved_diff_hash: approvable ? binding.reviewTree : null,
    commit_allowed: approvable,
  }
  // Phase 4: 승인 + 추적 phase(phaseId)면 해당 phase만 approved=true·current_phase=id (자동 advance 없음).
  // 미승인이거나 레거시(phaseId 없음)면 phases/current_phase 미변경.
  // 원본 배열을 보존하며 **일치 항목만** 토글 — 계약 외(malformed) 항목도 그대로 유지(state 무손실, Codex P3).
  if (approvable && typeof args.phaseId === 'string' && args.phaseId.length > 0) {
    const phaseId = args.phaseId
    const rawPhases = (base as { phases?: unknown }).phases
    const phases = (Array.isArray(rawPhases) ? rawPhases : []).map((p) =>
      p && typeof p === 'object' && (p as { id?: unknown }).id === phaseId ? { ...(p as object), approved: true } : p,
    ) as PhaseEntry[]
    return { ...approvedState, phases, current_phase: phaseId }
  }
  return approvedState
}

/**
 * codex-response.json을 검증하고 다음 state를 계산(파일 읽기만, 부수효과 없음).
 * 검증 = AJV 구조 + validateVerdict 도메인 + **expectedKind**(응답 review_kind == 요청 kind, 결정#7 — 교차오염 차단).
 * 실패 시 fail-closed(승인 미부여). kind 기본값 phase(하위호환).
 * kind-aware 기록(결정#8):
 *   - phase: review_base_sha/review_diff_hash·codex_thread_id 항상 갱신, 승인 시 approved_diff_hash/commit_allowed.
 *   - design: codex_thread_id만 갱신(phase 바인딩 필드 미변경), 승인 시 design_approved/_hash. 실패 시 design 승인 무효(fail-closed).
 */
export function processResponse(args: {
  ticketDir: string
  state: WorkflowState
  binding: Binding
  threadId: string
  kind?: ReviewKind
  designHash?: string | null
  phaseId?: string | null
  designValid?: boolean
  schemaPath?: string
  // REQ-016 A1: 승인 시 증거 핀 정본(아카이브 경로+sha). 미제공 시 evidence 미부착(하위호환).
  archive?: { path: string; sha256: string }
  approvedAt?: string
}): { ok: boolean; errors: string[]; nextState: WorkflowState } {
  const { ticketDir, state, binding, threadId, designHash, schemaPath } = args
  const kind: ReviewKind = args.kind ?? 'phase'
  const respPath = join(ticketDir, 'codex-response.json')
  if (!existsSync(respPath)) throw new Error(`codex-response.json 없음: ${respPath}`)
  let verdict: Verdict
  try {
    verdict = JSON.parse(readFileSync(respPath, 'utf8')) as Verdict
  } catch (e) {
    throw new Error(`codex-response.json 파싱 실패: ${respPath} — ${(e as Error).message}`)
  }

  const struct = validateResponseStructure(verdict, schemaPath ?? MACHINE_SCHEMA_PATH)
  const domain = validateVerdict(verdict, { reviewBaseSha: binding.reviewBaseSha })
  const kindMismatch = verdict.review_kind !== kind
  // design 승인엔 non-null designHash 필수(freshness anchor) — 누락은 fail-closed(Codex P3).
  const designHashMissing = kind === 'design' && !(typeof designHash === 'string' && designHash.trim().length > 0)
  // Phase 4: 추적 phase(phaseId 있음)는 유효 design 승인 전제(D13 동일) 없으면 fail-closed(#6).
  const tracked = kind === 'phase' && typeof args.phaseId === 'string' && args.phaseId.length > 0
  const designBlocked = tracked && args.designValid !== true
  const errors = [...struct.errors, ...domain.errors]
  if (kindMismatch) errors.push(`review_kind 불일치(요청 ${kind} ≠ 응답 ${String(verdict.review_kind)})`)
  if (designHashMissing) errors.push('design 리뷰인데 designHash(바인딩 해시) 누락 — 승인 불가(fail-closed)')
  if (designBlocked) errors.push('phase 승인 전제: 유효 design 승인 필요(design_approved=true + freshness 일치)')
  const ok = struct.ok && domain.ok && !kindMismatch && !designHashMissing && !designBlocked

  if (kind === 'design') {
    // A1-P2-1: 같은 kind(design)의 기존 증거는 항상 stale로 보고 제거(base에서 omit). 반대 kind(phase)는 보존.
    const { design_approval_evidence: _staleDesignEv, ...stateRest } = state
    const base: WorkflowState = { ...stateRest, codex_thread_id: threadId }
    const nextState = ok
      ? applyVerdict({ base, binding, verdict, kind, designHash })
      : { ...base, design_approved: false, design_approved_hash: null }
    // A1(D-016-2): design 승인 + archive 제공 시에만 design_approval_evidence 재부착(fresh). 그 외엔 위 omit으로 미부착.
    if (ok && nextState.design_approved === true && args.archive) {
      nextState.design_approval_evidence = buildApprovalEvidence({
        kind,
        verdict,
        binding,
        phaseId: null,
        designHash: designHash ?? null,
        threadId,
        archive: args.archive,
        approvedAt: args.approvedAt ?? new Date().toISOString(),
      })
    }
    return { ok, errors, nextState }
  }

  // A1-P2-1: 같은 kind(phase)의 기존 증거는 항상 stale로 보고 제거(base에서 omit). 반대 kind(design)는 보존.
  const { approval_evidence: _stalePhaseEv, ...stateRest } = state
  const base: WorkflowState = {
    ...stateRest,
    codex_thread_id: threadId,
    review_base_sha: binding.reviewBaseSha,
    review_diff_hash: binding.reviewTree,
  }
  const nextState = ok
    ? applyVerdict({ base, binding, verdict, kind, phaseId: args.phaseId })
    : { ...base, approved_diff_hash: null, commit_allowed: false }

  // A1(D-016-2): phase 승인 + archive 제공 시에만 approval_evidence 재부착(fresh). 그 외엔 위 omit으로 미부착.
  if (ok && nextState.commit_allowed === true && args.archive) {
    nextState.approval_evidence = buildApprovalEvidence({
      kind,
      verdict,
      binding,
      phaseId: args.phaseId ?? null,
      designHash: null,
      threadId,
      archive: args.archive,
      approvedAt: args.approvedAt ?? new Date().toISOString(),
    })
  }

  return { ok, errors, nextState }
}

/** state.json 기록 — UTF-8(BOM 없음), 2-space + 끝 개행. */
export function writeState(ticketDir: string, state: WorkflowState): void {
  writeFileSync(join(ticketDir, 'state.json'), `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

// parseThreadId는 lib/adapters로 이동(codex CLI 전용 로직) — 상단에서 re-export.

/**
 * 허용 스크래치(현재 티켓의 **정확한 repo-relative 경로**) 제외, worktree dirty(Y≠' ') 또는 untracked(X='?')인
 * `git status --porcelain` 라인 반환. status-line "diff"가 아닌 **절대 검사** — 호출 전부터 dirty였던 파일의
 * 추가 수정도 감지(S2 보강). allowedScratch는 basename/substring이 아닌 **exact path** 매칭(Codex P1: D10 hard gate —
 * `src/codex-response.json.ts`·다른 티켓·`.bak` 변형 오인 방지). 비어 있어야 "리뷰용 클린".
 */
export function findUnstagedOrUntracked(
  statusLines: string[],
  allowedScratch: string[],
  ticketRel?: string,
): string[] {
  const allowed = new Set(allowedScratch.map((p) => p.replace(/\\/g, '/')))
  const respPrefix = ticketRel
    ? `${ticketRel.replace(/\\/g, '/').replace(/\/+$/, '')}/responses/`
    : null
  return statusLines.filter((l) => {
    if (l.length < 3) return false
    const x = l[0]
    const y = l[1]
    const body = l.slice(3).replace(/\\/g, '/')
    // rename/copy(`R`/`C`)는 "old -> new" — src·dest 둘 다 검사(A2-P2-1: dest로 responses/ 주입 우회 차단).
    const arrow = body.indexOf(' -> ')
    if (arrow < 0 && allowed.has(body)) return false
    const paths = arrow >= 0 ? [body.slice(0, arrow), body.slice(arrow + 4)] : [body]
    // REQ-016 A1/D-016-4: 현재 티켓 responses/ 하위(src 또는 dest)는 **untracked 단일 아카이브만** 스크래치 허용.
    // approvals.jsonl·tracked 수정/삭제/리네임/카피는 무조건 flag(커밋된 증거 변조/주입 차단).
    if (respPrefix && paths.some((p) => p.startsWith(respPrefix))) return !isAllowedResponsesScratch(l, ticketRel as string)
    return x === '?' || y !== ' '
  })
}

// ───────────────────────────────── 승인 증거 아카이브/스크래치 (REQ-016 A1) ──

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 아카이브 파일명 패턴: `<base>-rNN-(approved|needs-fix).json`(NN≥2자리). approvals.jsonl 등은 불일치. */
const ARCHIVE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9-]*-r\d{2,}-(approved|needs-fix)\.json$/
export function isArchiveFileName(name: string): boolean {
  return ARCHIVE_NAME_RE.test(name)
}

/** 아카이브 base(round namespace): design은 'design'(phaseId 무시), phase는 phaseId(없으면 'phase'=레거시). */
export function archiveBaseName(kind: ReviewKind, phaseId: string | null): string {
  return kind === 'design' ? 'design' : phaseId && phaseId.length > 0 ? phaseId : 'phase'
}

/** 아카이브 파일명 — r 2자리 zero-pad. */
export function archiveFileName(base: string, round: number, status: 'approved' | 'needs-fix'): string {
  return `${base}-r${String(round).padStart(2, '0')}-${status}.json`
}

/** 다음 round(deterministic): base의 기존 아카이브(approved·needs-fix 공유) max round + 1. design/phase base 분리. */
export function nextArchiveRound(existingNames: string[], base: string): number {
  const re = new RegExp(`^${escapeRegExp(base)}-r(\\d{2,})-(approved|needs-fix)\\.json$`)
  let max = 0
  for (const n of existingNames) {
    const m = re.exec(n)
    if (!m) continue
    const r = Number.parseInt(m[1] ?? '', 10)
    if (Number.isFinite(r) && r > max) max = r
  }
  return max + 1
}

/**
 * 스크래치 허용 판정(D-016-4): **현재 티켓 `responses/` 직계 + untracked(`??`) + 아카이브 파일명 패턴**만 true.
 * `approvals.jsonl`·tracked(수정/삭제/리네임)·다른 티켓·중첩경로는 false(=리뷰/doctor에서 flag).
 */
export function isAllowedResponsesScratch(statusLine: string, ticketRel: string): boolean {
  if (statusLine.length < 3) return false
  const x = statusLine[0]
  const y = statusLine[1]
  if (x !== '?' || y !== '?') return false // untracked만
  const path = statusLine.slice(3).replace(/\\/g, '/')
  const prefix = `${ticketRel.replace(/\\/g, '/').replace(/\/+$/, '')}/responses/`
  if (!path.startsWith(prefix)) return false
  const name = path.slice(prefix.length)
  if (name.includes('/')) return false // 직계만
  return isArchiveFileName(name)
}

/**
 * 승인 증거 객체 생성(순수, D-016-2). 정본=아카이브 파일(`archive.path`/`sha256`).
 * kind 격리: phase→approved_tree(=reviewTree), design→design_hash(=designApprovedHash). approvedAt은 주입(테스트 deterministic).
 */
export function buildApprovalEvidence(args: {
  kind: ReviewKind
  verdict: Verdict
  binding: Binding
  phaseId: string | null
  designHash: string | null
  threadId: string
  archive: { path: string; sha256: string }
  approvedAt: string
}): ApprovalEvidence {
  const { kind, verdict, binding, phaseId, designHash, threadId, archive, approvedAt } = args
  const ev: ApprovalEvidence = {
    response_path: archive.path,
    response_sha256: archive.sha256,
    review_kind: kind,
    phase_id: kind === 'phase' ? phaseId ?? null : null,
    review_base_sha: binding.reviewBaseSha,
    codex_thread_id: threadId,
    machine_schema_version: verdict.machine_schema_version ?? '',
    status: verdict.status ?? '',
    commit_approved: verdict.commit_approved ?? '',
    approved_at: approvedAt,
  }
  return kind === 'design' ? { ...ev, design_hash: designHash ?? null } : { ...ev, approved_tree: binding.reviewTree }
}

/**
 * A2-P2-2: **검증된 processResponse 결과**로 아카이브 suffix 결정(순수).
 * result.ok=false(무효·kind 불일치·모순) → null(아카이브 미생성 — round/finalize 오염 방지).
 * 유효 + 승인(phase=commit_allowed·design=design_approved) → 'approved', 그 외(유효 NEEDS_FIX) → 'needs-fix'.
 */
export function archiveDecision(
  result: { ok: boolean; nextState: WorkflowState },
  kind: ReviewKind,
): 'approved' | 'needs-fix' | null {
  if (!result.ok) return null
  const approved =
    kind === 'phase' ? result.nextState.commit_allowed === true : result.nextState.design_approved === true
  return approved ? 'approved' : 'needs-fix'
}

// ──────────────────────────────────────────────────────────────── CLI ──

export interface Opts {
  ticket: string | null
  reqId: string | null
  handoff: string | null
  run: boolean
  kind: ReviewKind
  phase: string | null
  root: string | null
}

/** CLI 파싱. `--kind design|phase`(기본 phase, 하위호환)·`--phase <id>`(phase kind 대상). 잘못된 --kind/--phase 값은 fail-closed throw. */
export function parseArgs(argv: string[]): Opts {
  const opts: Opts = { ticket: null, reqId: null, handoff: null, run: false, kind: 'phase', phase: null, root: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === undefined) continue
    if (a === '--ticket') opts.ticket = argv[++i] ?? null
    else if (a === '--handoff') opts.handoff = argv[++i] ?? null
    else if (a === '--root') {
      const v = argv[++i]
      if (v === undefined) throw new Error('--root 값 필요')
      opts.root = v
    }
    else if (a === '--kind') {
      const v = argv[++i]
      if (v !== 'design' && v !== 'phase')
        throw new Error(`--kind 값은 design 또는 phase여야 함 (받음: ${v ?? '(없음)'})`)
      opts.kind = v
    } else if (a === '--phase') {
      const v = argv[++i]
      if (v === undefined || v.startsWith('-')) throw new Error(`--phase <id> 값 필요 (받음: ${v ?? '(없음)'})`)
      opts.phase = v
    } else if (a === '--run') opts.run = true // 라이브 codex 호출(미지정 시 dry-run 미리보기)
    else if (a === '--dry-run') opts.run = false
    else if (!a.startsWith('-')) opts.reqId = a
  }
  return opts
}

function resolveTicketDir(opts: Opts, cfg: ResolvedConfig): string {
  if (opts.ticket) return resolve(opts.ticket)
  if (opts.reqId) {
    const id = opts.reqId.replace(/^REQ-/, '')
    return join(cfg.workflowDirAbs, `REQ-${id}`)
  }
  throw new Error('REQ id 또는 --ticket <dir> 필요 (예: pnpm req:review-codex 2026-001)')
}

function gitStatusLines(): string[] {
  // core.quotePath=false: 비-ASCII 경로 octal 이스케이프 방지(exact 매칭 정합).
  // --untracked-files=all: untracked 디렉터리 collapse(`?? responses/`) 방지 — responses/ 아카이브를 **개별 파일**로 봐야 스크래치 매처가 동작(A2-P2 후속).
  return git(['-c', 'core.quotePath=false', 'status', '--porcelain', '--untracked-files=all']).split('\n').filter(Boolean)
}

/**
 * 리뷰어 호출 + 응답 캡처(Phase 3 이음새). ReviewerAdapter.review로 codex(exec/resume)를 추상화하고
 * lastMessage를 respPath에 기록(현행 `--output-last-message respPath`와 동일 효과 — respPath는 SCRATCH라 사후 무수정 검증 허용).
 * thread_id 부재(exec에서 thread.started 없음)면 fail-closed throw. rv 주입 가능(default codex, 테스트=FakeReviewerAdapter).
 */
export function callReviewer(
  rv: ReviewerAdapter,
  opts: { prompt: string; schemaPath: string; resumeThreadId: string | null; cwd: string; respPath: string },
): { threadId: string } {
  const { lastMessage, threadId } = rv.review({
    prompt: opts.prompt,
    schemaPath: opts.schemaPath,
    resumeThreadId: opts.resumeThreadId,
    cwd: opts.cwd,
  })
  if (!threadId) throw new Error('thread_id 파싱 실패 (codex exec --json에 thread.started 없음)')
  writeFileSync(opts.respPath, lastMessage, 'utf8')
  return { threadId }
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2))
  const cfg = loadConfig({ root: opts.root })
  gitAdapter = createGitAdapter(cfg.root) // 모든 git 호출 cwd = config.root
  const ticketDir = resolveTicketDir(opts, cfg)
  const state = loadState(ticketDir) // 부재 시 명확한 에러

  const requestPath = join(ticketDir, 'codex-request.md')
  if (!existsSync(requestPath)) throw new Error(`codex-request.md 없음: ${requestPath}`)
  const requestBody = readFileSync(requestPath, 'utf8')

  // handoff: --handoff 우선, 없으면 cfg.handoffPathAbs(null=비활성 — 부재 시 생략, 현재 동작 보존).
  const handoffPath = opts.handoff ? resolve(opts.handoff) : cfg.handoffPathAbs
  const handoff = handoffPath && existsSync(handoffPath) ? readFileSync(handoffPath, 'utf8') : null

  const { reviewBaseSha, reviewTree } = captureGitBinding()
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'])
  const ticketRel = relative(cfg.root, ticketDir).replace(/\\/g, '/')

  // Phase 4: phase 리뷰 대상 해소(엉뚱한 phase 승인 차단). design/레거시(phases[] 빈)는 대상 없음(phaseId=null).
  const phaseTarget = resolvePhaseTarget(state, opts.kind, opts.phase)
  if (!phaseTarget.ok) throw new Error(`phase 대상 오류: ${phaseTarget.error}`)
  const phaseId = phaseTarget.phaseId

  // 추적 phase(phaseId)는 유효 design 승인(D13 동일: design_approved + freshness) 전제.
  let designValid = false
  if (phaseId) {
    const approvedHash = typeof state.design_approved_hash === 'string' ? state.design_approved_hash : null
    let currentHash: string | null = null
    try {
      currentHash = captureDesignBinding(ticketRel, git, cfg.designDocs).designHash
    } catch {
      currentHash = null
    }
    designValid = state.design_approved === true && approvedHash !== null && approvedHash === currentHash
  }

  // kind별 권위 아티팩트: phase=staged diff, design=설계 문서 00/01/02 + design 바인딩 해시(결정#3·#4).
  let stagedDiff: string | undefined
  let designDocs: DesignDocs | undefined
  let designHash: string | undefined
  if (opts.kind === 'design') {
    // 리뷰 본문·바인딩 해시 모두 git 인덱스에서 — "리뷰 대상 = 바인딩 대상"(결정#3, Codex P2). 누락 문서는 각 함수가 fail-closed.
    designDocs = readDesignDocsFromIndex(ticketRel, git, cfg.designDocs)
    designHash = captureDesignBinding(ticketRel, git, cfg.designDocs).designHash
  } else {
    stagedDiff = git(['diff', '--cached'])
  }

  const reviewContext: ReviewContext = {
    branch,
    reviewBaseSha,
    reviewTree,
    phase: state.phase,
    previousResult: readPreviousResult(ticketDir),
  }
  const prompt = assembleReviewPrompt({
    handoff,
    reviewContext,
    reviewBaseSha,
    requestBody,
    reviewKind: opts.kind,
    stagedDiff,
    designDocs,
  })
  const previewPath = join(ticketDir, '.review-preview.txt')
  writeFileSync(previewPath, prompt, 'utf8')

  if (!opts.run) {
    console.log('[req:review-codex] DRY-RUN (--run 지정 시 라이브 호출)')
    console.log(
      `  ticket=${ticketDir}  REQ=${state.id} phase=${state.phase} branch=${branch} kind=${opts.kind} phaseId=${phaseId ?? '(none)'}`,
    )
    console.log(
      `  review_base_sha=${reviewBaseSha}  review_tree=${reviewTree}${designHash ? `  design_hash=${designHash}` : ''}${phaseId ? `  design_valid=${String(designValid)}` : ''}`,
    )
    console.log(`  prompt ${prompt.length}자 → ${previewPath}`)
    return
  }

  // ── LIVE (단계 3B) ──
  const respPath = join(ticketDir, 'codex-response.json')
  const repoRel = (abs: string) => relative(cfg.root, abs).replace(/\\/g, '/')
  // 워크플로 도구가 쓰는 메타데이터(응답·프리뷰·state)는 리뷰 대상 아님 → exact 경로로 허용(precondition/무수정검증 제외).
  // 특히 state.json은 직전 라운드 writeState로 unstaged가 되므로 resume(2회차) precondition 통과에 필수(4C e2e 발견).
  const SCRATCH = [repoRel(respPath), repoRel(previewPath), repoRel(join(ticketDir, 'state.json'))]
  const isResume = typeof state.codex_thread_id === 'string' && state.codex_thread_id.length > 0

  // Phase 4: 추적 phase는 유효 design 승인 전제(D13 동일) — 미충족 시 호출 전 fail-closed(불필요 codex 호출 방지).
  if (phaseId && !designValid)
    throw new Error(
      'phase 리뷰 전 유효 design 승인 필요(design_approved=true + 현재 00/01/02 해시 일치) — 설계 재승인 후 진행하세요.',
    )

  // D10 precondition: 리뷰 전 워킹트리는 staged + 스크래치만 (사후 무수정 검증의 전제 — Codex P1).
  // A2: ticketRel 전달 → 직전 라운드 untracked 아카이브(responses/)는 스크래치 허용, tracked 변조·approvals.jsonl은 flag.
  const preDirty = findUnstagedOrUntracked(gitStatusLines(), SCRATCH, ticketRel)
  if (preDirty.length)
    throw new Error(
      `리뷰 전 워킹트리에 unstaged/untracked 존재(D10) — 의도 변경은 git add, 그 외 정리 필요:\n  ${preDirty.join('\n  ')}`,
    )

  console.warn(`⚠️  codex 실제 호출 (${isResume ? 'resume' : 'exec'}) — 호출 1회 발생 (DEC-WF-026: 호출 직전 확인)`)

  // ReviewerAdapter 경유(Phase 3). exec/resume 분기·--output-last-message·thread 파싱은 어댑터가 담당.
  // resumeThreadId 있으면 resume(thread 상속), 없으면 exec(--sandbox read-only) → thread.started 파싱.
  const { threadId } = callReviewer(reviewer, {
    prompt,
    schemaPath: cfg.schemaPathAbs,
    resumeThreadId: isResume ? (state.codex_thread_id as string) : null,
    cwd: cfg.root,
    respPath,
  })

  // 사후 리뷰어 무수정 검증: worktree 절대검사 + index(staged tree OID) 불변 (content 기반)
  const postDirty = findUnstagedOrUntracked(gitStatusLines(), SCRATCH, ticketRel)
  if (postDirty.length)
    throw new Error(`리뷰 호출 후 워킹트리 변경(리뷰어 수정?):\n  ${postDirty.join('\n  ')}`)
  const afterTree = git(['write-tree'])
  if (afterTree !== reviewTree)
    throw new Error(`리뷰 호출 후 staged tree 변경(리뷰어 index 수정?): ${reviewTree} → ${afterTree}`)

  // A2(D-016-1 · A2-P2-2): reviewer 무수정 검증 이후, **검증 먼저(아카이브 없이)** → archiveDecision으로 suffix/생략 결정 → 기록.
  // 무효(kind 불일치·모순 등)면 아카이브를 남기지 않는다(round/finalize 오염 방지). 유효 NEEDS_FIX는 보존, 승인은 evidence 핀 부착.
  const approvedAt = new Date().toISOString()
  const baseArgs = {
    ticketDir,
    state,
    binding: { reviewBaseSha, reviewTree },
    threadId,
    kind: opts.kind,
    designHash,
    phaseId,
    designValid,
    schemaPath: cfg.schemaPathAbs,
  }
  const probe = processResponse(baseArgs) // 아카이브 없이 검증(진짜 승인 여부·유효성)
  const decision = archiveDecision(probe, opts.kind) // null=아카이브 안 함(무효), 'approved'|'needs-fix'
  let archiveDesc: { path: string; sha256: string } | undefined
  if (decision) {
    try {
      const respBytes = readFileSync(respPath)
      const base = archiveBaseName(opts.kind, phaseId)
      const responsesDir = join(ticketDir, 'responses')
      mkdirSync(responsesDir, { recursive: true })
      const existing = readdirSync(responsesDir).filter((n) => isArchiveFileName(n))
      const archiveAbs = join(responsesDir, archiveFileName(base, nextArchiveRound(existing, base), decision))
      writeFileSync(archiveAbs, respBytes)
      archiveDesc = { path: repoRel(archiveAbs), sha256: createHash('sha256').update(respBytes).digest('hex') }
    } catch {
      // 아카이브 기록 실패 — evidence 미부착(probe 결과 사용)
    }
  }
  // 승인 + 아카이브가 있을 때만 evidence 핀 부착 위해 재호출, 아니면 검증된 probe 결과 사용.
  const result =
    decision === 'approved' && archiveDesc
      ? processResponse({ ...baseArgs, archive: archiveDesc, approvedAt })
      : probe
  writeState(ticketDir, result.nextState)

  console.log(`[req:review-codex] ${result.ok ? 'OK' : 'FAIL(fail-closed)'}  thread=${threadId}`)
  console.log(
    `  commit_allowed=${String(result.nextState.commit_allowed)}  approved=${String(result.nextState.approved_diff_hash ?? 'null')}`,
  )
  if (!result.ok) {
    for (const e of result.errors) console.error(`   - ${e}`)
    process.exit(1)
  }
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href
if (isMain) main()
