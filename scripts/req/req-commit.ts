#!/usr/bin/env tsx
/**
 * req:commit — AI REQ 워크플로우 Phase B (REQ-2026-016). 승인된 phase를 커밋하는 래퍼.
 *
 * 설계 근거: 본 티켓 01-design.md D-016-3·3b·7·8·9.
 * 책임(전체): req:doctor 통과 게이트 → HIGH 사람확인 게이트 → source 커밋(승인 코드만) →
 *   commit_allowed 소비 → evidence-finalize(approvals.jsonl 매니페스트 append + responses chore 커밋) → 2-커밋.
 *   복구/finalize 모드(pending_evidence_for)·design-finalize 포함.
 *
 * **B1: 순수 기반/매니페스트 모델**. **B2(현재): 정상 flow** — doctor 게이트→HIGH→source 커밋→evidence-finalize→소비(2-커밋).
 *   복구/finalize 모드(pending_evidence_for)·design-finalize는 **B3**. main()은 `--run` 없으면 dry-run(부작용 없음).
 *   ⚠️ B2 도구 자체 커밋은 부트스트랩 수기(req:commit dogfood는 Phase C부터).
 */
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, join, relative } from 'node:path'
import {
  loadState,
  writeState,
  readPhases,
  appendCloseProofRowToDisk,
  // REQ-2026-092 r02 P1: staged 경로 획득을 phase 게이트와 **같은 인자**로 맞춘다(같은 바이트를 봐야 한다).
  STAGED_NAMES_Z_ARGS,
  type ApprovalEvidence,
  type ReviewKind,
  type WorkflowState,
} from './review-codex'
// REQ-2026-092 DEC-1: `sourceCommitForbiddenStaged`는 이 명령과 `req:review-codex`가 **공유하는** 술어다.
// 여기서만 인라인으로 다시 쓰면 리뷰가 승인한 tree를 커밋이 거부하는 상태가 재발한다.
import { isArchiveFileName, sourceCommitForbiddenStaged } from './lib/scratch'
// REQ-2026-085: 도구가 만든 부기 커밋 표식(leaf — 순환 없음).
import { bookkeepingMessage } from './lib/bookkeeping'
// REQ-2026-057: 소비된 상태를 durable checkpoint로 커밋(leaf — 순환 없음).
import { parseStatusZ, STATUS_Z_ARGS } from './lib/porcelain'
import { commitStateCheckpoint } from './lib/state-checkpoint'
import {
  planEvidenceRecovery,
  executeEvidenceRecovery,
  buildRecoveryFacts,
  RECOVERY_GUIDANCE,
  type RecoveryIo,
} from './lib/evidence-recovery'
import { LEDGER_BASENAME } from './lib/review-ledger'
import { CLOSE_PROOF_BASENAME, parseCloseProof, deriveBaseState } from './lib/close-proof'
import { requiredConfirmScope, effectiveConfirmScope } from './lib/evidence'
import { defersToIntegration, type StopGate } from './lib/config'
import { createEvidencePorts } from './lib/evidence-ports' // 아카이브 파일명 판정의 정본은 scratch(leaf)
// REQ-2026-048 phase-1: 매니페스트 모델·검증과 그 보조 술어는 leaf `lib/evidence.ts`가 정본.
// 여기서 **재수출**해 기존 import 경로(`from './req-commit'`)를 쓰던 호출부·테스트를 그대로 둔다.
import {
  archiveBaseName,
  buildArchiveInventory,
  designEvidenceStagePaths,
  durableDesignEvidence,
  isConfinedArchivePath,
  isValidIsoInstant,
  buildManifestEntry,
  expectedArchivePaths,
  manifestHasConsumed,
  serializeManifestLine,
  userConfirmProblem,
  validateManifest,
  designHashFromManifest,
  evidencedPhaseIdsFromManifest,
  verifyCommittedEvidenceIntegrity,
  type ManifestEntry,
  type UserCommitConfirmed,
} from './lib/evidence'
export {
  buildArchiveInventory,
  buildManifestEntry,
  designEvidenceStagePaths,
  expectedArchivePaths,
  manifestHasConsumed,
  serializeManifestLine,
  userConfirmProblem,
  validateManifest,
  type ManifestEntry,
  type UserCommitConfirmed,
  type ArchiveInventoryItem,
} from './lib/evidence'
import { loadConfig, packageRoot, buildScriptInvocation, DEFAULTS, effectiveStopGate, type PackageManager, type ResolvedConfig } from './lib/config'
import { createGitAdapter, quietGitRunner, safeSpawnSync, type GitAdapter } from './lib/adapters'
import { assertSetupComplete } from './lib/setup-gate'
import { makeRunCli, isEntrypoint } from './lib/cli-boundary'

// git=GitAdapter 경유(D-017-3), 패키지매니저=config. runDoctor(pnpm/npm 실행)는 cwd=gitRoot 필요(비-git 호출). main()이 loadConfig 후 config.root로 설정.
let gitRoot = packageRoot()
let pkgManager: PackageManager = DEFAULTS.packageManager
let gitAdapter: GitAdapter = createGitAdapter(packageRoot())
/**
 * **부재가 정상인 HEAD 조회 전용** 어댑터(REQ-2026-058 F-5). `gitAdapter`와 같은 root를 따라간다.
 * 일반 호출에는 쓰지 않는다 — 진짜 오류의 진단이 사라진다.
 */
let quietGitAdapter: GitAdapter = createGitAdapter(packageRoot(), quietGitRunner)

/**
 * repo-상대 경로 파일의 sha256(hex). `lib/evidence`는 fs를 모르는 순수 모듈이라 여기서 주입한다.
 * 🔴 `gitRoot`는 `main()`이 `cfg.root`로 세팅한 뒤에만 유효하다 — designFinalize는 그 이후에만 호출된다.
 */
function repoRelSha256(repoRel: string): string {
  return createHash('sha256').update(readFileSync(join(gitRoot, ...repoRel.split('/')))).digest('hex')
}
// evidencePreflight 구조 사전검증용 placeholder(실제 sourceSha/consumedAt는 source 커밋 후 채움). valid OID/ISO 형식.
const PREFLIGHT_PLACEHOLDER_OID = '0'.repeat(40)
const PREFLIGHT_PLACEHOLDER_ISO = '2000-01-01T00:00:00.000Z'


// ───────────────────────────────── approvals.jsonl 매니페스트 모델 (B1) ──






// ─────────────────────────────────────── B2: HIGH 게이트 / 소비 / preflight(순수) ──


/**
 * HIGH 사람확인 게이트(D-016-8, 순수). HIGH인데 유효한 `user_commit_confirmed`(confirmed=true·method·ISO confirmed_at)가 없으면 차단.
 */
export function userConfirmGate(
  state: WorkflowState,
  stopGate: StopGate = 'phase',
  completesReq = false,
): { blocked: boolean; reason?: string } {
  if (state.risk_level !== 'HIGH') return { blocked: false }

  /**
   * 🔴 차단 지점은 `stopGate`가 정한다(REQ-2026-071 DEC-1·DEC-2).
   *
   * | stopGate | 차단 |
   * |---|---|
   * | `phase`  | 매 커밋(현행 그대로) |
   * | `req`    | **이 커밋이 REQ를 완성시킬 때만** — 그 커밋이 `dev-complete`를 발행하므로 도구가 막을 수 있다 |
   * | `merge`  | 커밋에서는 안 막는다 — `delivery integrate` 자격이 요구한다 |
   * | `auto`   | `merge`와 동일(REQ-2026-140 DEC-2) — 다른 것은 통합 지점 하나뿐이다 |
   *
   * 🔴 `req`에서 중간 phase를 막으면 **REQ 종료에 도달할 수 없다**(설계 r01 P1).
   */
  if (defersToIntegration(stopGate)) return { blocked: false }
  if (stopGate === 'req' && !completesReq) return { blocked: false }

  /**
   * 🔴 위의 `merge` 조기 반환 덕분에 여기 `stopGate` 는 `'phase' | 'req'` 로 좁혀져 있다 —
   *    그 두 값은 묶음 맥락과 무관하므로 `requiredConfirmScope` 의 단일 인자 오버로드를 쓴다.
   *    조기 반환이 사라지면 이 호출은 **타입 에러**가 된다(REQ-2026-128 DEC-2 — 조용한 오답 방지).
   */
  const required = requiredConfirmScope(stopGate)
  const problem = userConfirmProblem(state.user_commit_confirmed)
  if (problem)
    return {
      blocked: true,
      reason:
        `HIGH risk: user_commit_confirmed ${problem} — req:commit 차단(감사 기록이며 위조불가 증명 아님; 가장 강한 보장=사용자가 직접 실행). ` +
        `기록: npx commitgate req:confirm <REQ> --scope ${required} --method "<승인 문장>" --run`,
    }
  /**
   * 🔴 scope는 **크기 순서가 아니라 진술**이다(DEC-4b) — 정확히 일치해야 한다.
   *    "넓으면 통과"로 두면 `stopGate:'phase'`에서 `req` 확인 하나가 이후 모든 phase를 무확인으로
   *    통과시켜(넓은 scope는 커밋마다 소비되지 않으므로), 그 값이 보장하려던 "매 phase 신선한 확인"이
   *    **정상 경로로** 사라진다.
   */
  const got = effectiveConfirmScope(state.user_commit_confirmed as UserCommitConfirmed | null)
  if (got !== required)
    return {
      blocked: true,
      reason:
        `HIGH risk: 확인 범위 불일치 — stopGate="${stopGate}"는 scope="${required}" 확인을 요구하는데 기록된 것은 "${got}"입니다. ` +
        `범위는 크기 순서가 아니라 무엇을 승인했는지에 대한 진술이라 정확히 일치해야 합니다. ` +
        `기록: npx commitgate req:confirm <REQ> --scope ${required} --method "<승인 문장>" --run`,
    }
  return { blocked: false }
}

/**
 * 승인 소비(D-016-9, 순수). **evidence 커밋 성공 후 마지막**에만 호출.
 * commit_allowed=false · approved_diff_hash=null · consumed_approvals[] append · user_commit_confirmed 초기화 · approval_evidence 핀 제거.
 */
export function consumeState(
  state: WorkflowState,
  opts: { sourceCommitSha: string; consumedAt: string; completesReq?: boolean },
): WorkflowState {
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
  /**
   * 🔴 확인 소비는 **그 범위가 닫힐 때**다(REQ-2026-071 DEC-6).
   *
   * `scope:'phase'`는 커밋마다 소비한다(현행 — 매 phase 신선한 확인이 그 값의 계약이다).
   * 더 넓은 scope(`req`·`delivery`)는 **남긴다** — 커밋마다 지우면 첫 커밋에서 사라져 결국
   * 매 phase 확인이 되고, 확인 지점을 옮긴다는 이 REQ가 무의미해진다.
   * (`req`는 `dev-complete` 발행 시, `delivery`는 `delivery approve`에서 소비한다 — phase-3.)
   */
  const scope = effectiveConfirmScope(state.user_commit_confirmed as UserCommitConfirmed | null)
  // 🔴 `req` scope 는 **REQ 가 닫힐 때**(dev-complete 발행) 소비한다 — 그 커밋이 곧 범위의 끝이다.
  //    `delivery` scope 는 묶음이 닫힐 때(`delivery approve`)까지 남는다.
  const keepConfirm = scope === 'delivery' || (scope === 'req' && !opts.completesReq)
  return {
    ...rest,
    commit_allowed: false,
    approved_diff_hash: null,
    consumed_approvals: [...prev, entry],
    user_commit_confirmed: keepConfirm ? state.user_commit_confirmed : null,
  }
}

/**
 * REQ-2026-142: 복구 사실 조립 입력. 🔴 `buildRecoveryFacts` 를 통해 **`req:doctor` 와 같은 조립**을 쓴다 —
 * D10 을 평가하는 쪽과 실행하는 쪽이 다른 사실을 보면 "doctor 는 통과, commit 은 거부"라는 새 교착이 생긴다.
 */
function recoveryIo(root: string, ticketRel: string, state: WorkflowState): ReturnType<typeof buildRecoveryFacts> {
  const io: RecoveryIo = {
    ticketRel,
    state,
    headText: (rel) => createEvidencePorts(root, `${ticketRel}/responses`).headText(rel),
    dirtyPaths: () => parseStatusZ(git([...STATUS_Z_ARGS])).flatMap((e) => (e.origPath === undefined ? [e.path] : [e.origPath, e.path])),
    revParse: (rev) => {
      try {
        return git(['rev-parse', rev])
      } catch {
        return null
      }
    },
    fileSha: (rel) => {
      try {
        return createHash('sha256').update(readFileSync(join(root, rel))).digest('hex')
      } catch {
        return null
      }
    },
    hashUtf8: (str) => createHash('sha256').update(str, 'utf8').digest('hex'),
  }
  return buildRecoveryFacts(io)
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
  return recoveryCoreValid(state, sourceCommitTree)
}

/**
 * 복구 유효성 코어(순수, pending 마커 유무와 무관): commit_allowed·approval_evidence·approved_diff_hash·**sourceCommitTree == approved_diff_hash**.
 * recoveryClassify(마커 필수)와 resolveRecoverySource(orphan 복구)가 공용으로 쓴다.
 */
export function recoveryCoreValid(state: WorkflowState, sourceCommitTree: string | null): { valid: boolean; reason: string } {
  if (state.commit_allowed !== true) return { valid: false, reason: 'commit_allowed=true 아님 — 복구할 미완 승인 없음' }
  if (!state.approval_evidence) return { valid: false, reason: 'approval_evidence 없음' }
  const approved = typeof state.approved_diff_hash === 'string' ? state.approved_diff_hash : null
  if (!approved) return { valid: false, reason: 'approved_diff_hash 없음' }
  if (sourceCommitTree !== approved)
    return { valid: false, reason: `source 커밋 tree(${String(sourceCommitTree)}) != approved(${approved}) — 잘못된 복구 대상` }
  return { valid: true, reason: 'finalize 유효: source 커밋 tree == approved, evidence/consume 복구 가능' }
}

/**
 * finalize 복구 대상 source SHA 해소(순수, P2-a — marker 기록 전 crash 복구창).
 * ① pending 마커 있으면 그 SHA(viaOrphan=false).
 * ② 마커 없어도 HEAD가 승인 source(head.tree == approved_diff_hash + commit_allowed + approval_evidence)면 orphaned source로 HEAD 복구(viaOrphan=true).
 *    ⚠️ 승인 tree 대조라 **승인 우회 아님** — source 커밋 성공 후 markPendingEvidence 전에 죽은 상태만 복구한다.
 */
export function resolveRecoverySource(
  state: WorkflowState,
  head: { sha: string; tree: string } | null,
): { sourceSha: string | null; viaOrphan: boolean; reason: string } {
  const pending = pendingSourceSha(state)
  if (pending) return { sourceSha: pending, viaOrphan: false, reason: 'pending 마커' }
  if (!head) return { sourceSha: null, viaOrphan: false, reason: 'pending 마커 없음 + HEAD 미상 — 복구할 미완 작업 없음' }
  const approved = typeof state.approved_diff_hash === 'string' ? state.approved_diff_hash : null
  if (state.commit_allowed === true && !!state.approval_evidence && approved !== null && head.tree === approved)
    return { sourceSha: head.sha, viaOrphan: true, reason: 'orphaned source(HEAD tree == approved) 복구' }
  return { sourceSha: null, viaOrphan: false, reason: 'pending 마커 없음 + HEAD가 승인 source 아님 — 복구할 미완 작업 없음' }
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
    // bare `--`는 POSIX end-of-options 마커(DEC-011-3). ⚠️ 이후 인자도 계속 옵션으로 파싱해야 한다 —
    // 전부 위치인자로 삼키면 `req:commit <id> -- --run`이 조용히 dry-run으로 끝난다(가장 나쁜 실패).
    if (a === '--') continue
    else if (a === '--ticket') ticket = argv[++i] ?? null
    else if (a === '--run') run = true
    else if (a === '--message' || a === '-m') message = argv[++i] ?? null
    // REQ-2026-095 DEC-3: `-F`는 `git commit -F`와 같은 규약의 별칭이다(학습 비용 0).
    // 동작·검증은 전부 `resolveMessageSource` 재사용 — 여기서는 같은 자리에 담기만 한다.
    else if (a === '--message-file' || a === '-F') {
      const v = argv[++i]
      if (v === undefined) throw new Error(`${a} 값 필요`)
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
  // shell 없이 안전 실행(P1): pkg manager는 Windows에서 .cmd라 과거 shell:true였고 doctorArgs(reqId·root 경로)의 메타문자로 주입 가능했음.
  safeSpawnSync(cmd, rest, { cwd: gitRoot, stdio: 'inherit' })
}

/**
 * 🔴 **한 줄로 붕괴한 메시지로 의심되는가**(REQ-2026-095 DEC-4, 순수).
 *
 * 조건은 **둘 다**여야 한다: (1) 리터럴 두 글자 `\n`을 포함하고 (2) **실제 개행이 하나도 없다**.
 * 이것이 `pnpm <script> -m "…"`가 argv를 재직렬화한 흔적이다.
 *
 * 🔴 **자동 복원하지 않는다.** 리터럴 `\n`을 개행으로 되돌리면 대부분 맞겠지만, 본문에 정말 `\n`이라고
 *    적은 경우(이 저장소의 CHANGELOG·문서가 실제로 그런다)를 **조용히 망가뜨린다.**
 *    "대부분 맞음"보다 "절대 망가뜨리지 않음"을 택한다 — 커밋 메시지는 감사 기록이다.
 *
 * 🔴 **이 판정은 반쪽이다.** npm·npx는 개행 **이후를 통째로 버리므로** 흔적이 남지 않는다 —
 *    받은 문자열이 그냥 짧을 뿐이라 원리적으로 탐지할 수 없다. 경고가 없다고 안전한 것이 아니다.
 */
export function looksLikeCollapsedMessage(message: string | null): boolean {
  if (typeof message !== 'string' || message === '') return false
  if (message.includes('\n')) return false // 실제 개행이 있으면 정상적으로 전달된 것이다
  return message.includes('\\n')
}

/** 붕괴 의심 경고 문구(순수). 탐지의 한계를 함께 적어 "경고 없음 = 안전"으로 읽히지 않게 한다. */
export function collapsedMessageWarning(): string {
  return [
    '⚠️  커밋 메시지에 리터럴 `\\n`이 있고 실제 개행이 없습니다 — 여러 줄 메시지가 한 줄로 붕괴했을 수 있습니다.',
    '   npm·pnpm·npx는 argv의 개행을 잘라내거나 `\\n`으로 바꿉니다(Windows). 여러 줄이면 파일로 넘기세요:',
    '     req:commit <REQ> --run --message-file <경로>   (또는 -F <경로>)',
    '   의도한 것이라면 이 경고는 무시해도 됩니다 — 도구는 메시지를 고치지 않습니다.',
    '   ※ npm·npx는 개행 뒤를 조용히 버려 흔적이 남지 않습니다. 이 경고가 없어도 안전하다는 뜻은 아닙니다.',
  ].join('\n')
}

/**
 * source 커밋 금지 staged 안내(REQ-2026-092, 순수).
 *
 * 🔴 **위반 경로를 전부 나열한다** — 사용자가 무엇을 unstage해야 하는지 알아야 한다. 개수만 알리거나
 *    첫 항목만 보이면 여러 번 왕복하게 된다. 리뷰 측 `forbiddenStagedMessage`와 같은 취지다.
 */
export function forbiddenSourceStagedMessage(paths: readonly string[]): string {
  return `source 커밋에 비-코드 staged 금지(state/responses): ${paths.join(', ')}`
}

/**
 * staged 변경 경로를 정규화 배열로 (`git diff --cached --name-only -z`).
 *
 * 🔴 **`-z`와 공백 보존이 정확성 요구다** (REQ-2026-092 phase-1 r02 P1). 예전엔 `-z` 없이 개행 split +
 *    `trim()`이었고, 그것이 `req:review-codex`의 phase 게이트(`-z` 원문 보존)와 **갈라졌다**. 갈라지면
 *    이 REQ가 없애려는 교착이 정확히 재현된다:
 *
 *      ① 다른 파일인 ` workflow/REQ-x/state.json`(선행 공백)을 코드와 함께 stage한다.
 *      ② phase 게이트는 `-z` 원문을 보므로 현재 티켓 경로가 **아니라고** 판정 → 통과·승인(tree에 포함).
 *      ③ `req:commit`은 trim해서 `workflow/REQ-x/state.json`으로 **오인** → 금지.
 *      ④ unstage하면 승인 tree와 달라져 (a)가 깨진다 → 커밋 불가 = 교착.
 *
 *    두 호출부는 **같은 바이트**를 봐야 한다. 그래서 획득 방식까지 맞춘다(술어만 공유해서는 부족하다).
 *
 *    🔴 예전 구현에는 **독립된 두 오류 원인**이 있었다(설계 r02 observation · phase-2 r01·r02 P1).
 *       하나로 뭉뚱그리면 서술이 반드시 틀린다 — 원인이 다르기 때문이다.
 *
 *      ① **`trim()`** — git 출력은 원본 그대로였는데 **코드가** 바꿨다.
 *         앞뒤 공백이 든 경로가 대상. ` <t>/state.json`은 Git에서 다른 파일인데 금지 경로로 오인한다.
 *      ② **`-z` 부재** — **git 출력 자체가** 원본이 아니었다.
 *         Git이 C-인용하는 경로가 대상: 큰따옴표 `"`, 역슬래시 `\`, 개행·탭 등 제어문자, 그리고
 *         `core.quotePath=true` 기본값에서 비ASCII. `"a\"b.ts"`·`"…\355\225\234…"`처럼 표시 문자열로
 *         들어와 접두사 비교가 빗나가 **위반을 놓친다(fail-open)**. 개행은 split 자체를 쪼갠다.
 *         🔴 `"`·`\`는 `core.quotePath`와 **무관하게** 항상 인용된다 — 비ASCII만의 문제가 아니다.
 *
 *    `-z` + 공백 보존이 ①②를 한꺼번에 없앤다.
 */
export function stagedNames(): string[] {
  return git([...STAGED_NAMES_Z_ARGS])
    .split('\0')
    .map((p) => p.replace(/\\/g, '/'))
    .filter((p) => p.length > 0)
}

// 🔴 REQ-2026-052 phase-3b: 매니페스트 순수 파서(parseManifestEntries·evidencedPhaseIdsFromManifest·
//    designHashFromManifest)는 **매니페스트 모델의 정본인 `lib/evidence`(leaf)로 이동**했다. req:new intake
//    스캔(leaf `lib/intake`)이 req-commit(top-level command)에 의존하지 않고 같은 파서를 쓰기 위함이다.
//    기존 호출부·테스트 호환을 위해 여기서 re-export한다(경로 무변경).
export { parseManifestEntries, evidencedPhaseIdsFromManifest, designHashFromManifest } from './lib/evidence'

/**
 * 🔴 **dev-complete 발행 결정(순수, DEC-B3)** — 이 phase 커밋이 마지막 phase를 완료시키면 발행할 proof row를,
 *    아니면 null을 낸다. runtime `state.phases`는 **inventory 산출 입력으로만** 쓴다(DEC-B4).
 *
 * @param phaseIds  `state.phases`의 phase id들(inventory 원천 — 정렬·중복 제거는 여기서).
 * @param reviewKind 이 finalize의 kind(design이면 null — dev-complete 아님).
 * @param manifestContent 이 phase 엔트리를 **포함한** 매니페스트(발행 전 prospective 검증 대상).
 * @param nowIso 발행 시각.
 * @returns 발행할 dev-complete `CloseProofRow` 또는 null(마지막 phase 아님/미분해/design).
 * @throws design_ref(커밋된 design 승인)가 없으면 — 마지막 phase인데 design 증거가 없다(fail-closed).
 */
/**
 * 🔴 **완료 판정의 단일 지점**(REQ-2026-071 phase-1). `computeDevCompleteProof`와 HIGH 게이트가
 *    같은 함수를 쓴다 — 두 곳에 두면 "게이트는 막는데 proof는 안 나오는"(혹은 반대) 상태가 생긴다.
 *
 * @param pending 이 커밋이 추가할 phase(아직 매니페스트에 없다). 없으면 현재 매니페스트만 본다.
 */
export function wouldCompleteReq(args: {
  phaseIds: readonly string[]
  manifestContent: string
  pending?: { phaseId: string; designRef: string | null } | null
}): { complete: boolean; designRef: string | null; inventory: string[] } {
  const inventory = [...new Set(args.phaseIds)].sort()
  const designRef = designHashFromManifest(args.manifestContent)
  if (inventory.length === 0 || !designRef) return { complete: false, designRef, inventory }
  const evidenced = new Set(evidencedPhaseIdsFromManifest(args.manifestContent, designRef))
  // pending phase 는 **현재 design 에 결속될 때만** 산입한다 — 결속이 다르면 어차피 완료가 아니다.
  if (args.pending && args.pending.designRef === designRef) evidenced.add(args.pending.phaseId)
  return { complete: inventory.every((id) => evidenced.has(id)), designRef, inventory }
}

export function computeDevCompleteProof(args: {
  ticketId: string
  phaseIds: readonly string[]
  reviewKind: ReviewKind
  manifestContent: string
  nowIso: string
}): import('./lib/close-proof').CloseProofRow | null {
  if (args.reviewKind !== 'phase') return null
  const inventory = [...new Set(args.phaseIds)].sort()
  if (inventory.length === 0) return null
  const designRef = designHashFromManifest(args.manifestContent)
  if (!designRef) throw new Error('dev-complete 발행 전 검증 실패: 커밋된 design 승인(design_hash)이 없다')
  // 🔴 DEC-B5: **design-bound** 완전성 — 각 inventory phase가 **현재 design_ref에 결속된** 증거를 가져야 마지막
  //    phase다. 단순 phase_id 존재로는 부족(D1 검토분이 D2 완료에 새는 P1). 결속 없는(레거시) 행은 불산입.
  // 🔴 판정은 `wouldCompleteReq` 하나를 쓴다 — HIGH 게이트가 같은 함수를 보므로 갈라지지 않는다.
  if (!wouldCompleteReq({ phaseIds: args.phaseIds, manifestContent: args.manifestContent }).complete) return null
  return {
    ticket_id: args.ticketId,
    event: 'dev-complete',
    series_id: null,
    resolution: null,
    phase_inventory: inventory,
    design_ref: designRef,
    at: args.nowIso,
    reconstructed: false,
    evidence_basis: null,
  }
}

/**
 * 🔴 REQ-2026-052 phase-3a(DEC-B3): 이 phase 커밋이 **마지막 phase**를 완료시키면 self-verifying dev-complete
 *    proof를 발행하고, 같은 커밋에 실을 close-proof 경로를 반환한다. 아니면 `[]`.
 *
 * - **입력**: `state.phases`(inventory 산출 — DEC-B4: **입력으로만**) + `newContent`(이 phase 엔트리 포함 매니페스트).
 * - **prospective 검증(발행 전)**: inventory의 모든 phase가 newContent에 phase 증거로 있고, design_ref가 커밋된
 *   design 승인과 일치하는지 확인. 하나라도 어긋나면 발행하지 않는다(마지막 phase가 아니거나 증거 불완전).
 * - **멱등**: close proof가 이미 dev-complete row를 갖고 있으면 append가 duplicate → `[]` 반환(중복 방지)이 아니라
 *   **경로는 반환**하되 파일 내용이 그대로라 커밋에 diff가 없다(재시도 안전). 실제 중복 행은 자연키 멱등이 막는다.
 */
function emitDevCompleteIfLastPhase(ctx: FinalizeCtx, newContent: string): string[] {
  const proof = computeDevCompleteProof({
    ticketId: String(ctx.state.id ?? ''),
    phaseIds: readPhases(ctx.state).map((p) => p.id),
    reviewKind: ctx.ev.review_kind,
    manifestContent: newContent,
    nowIso: new Date().toISOString(),
  })
  if (!proof) return []
  appendCloseProofRowToDisk(ctx.rootForClose, ctx.ticketRel, proof) // 멱등: 이미 있으면 duplicate(no-op)
  return [`${ctx.ticketRel}/responses/${CLOSE_PROOF_BASENAME}`]
}

/**
 * 🔴 발행 후 HEAD-only 재검증(DEC-B3 step 4). HEAD blob만 읽어 dev-complete가 성립하는지 확인 —
 *    close proof inventory의 모든 phase evidence + design_ref 일치. 어긋나면 fail-closed.
 */
function verifyDevCompleteAtHead(ctx: FinalizeCtx): void {
  const cpRel = `${ctx.ticketRel}/responses/${CLOSE_PROOF_BASENAME}`
  const mfRel = `${ctx.ticketRel}/responses/approvals.jsonl`
  const cpText = headBlobText(cpRel)
  const mfText = headBlobText(mfRel)
  if (cpText === null || mfText === null) throw new Error('dev-complete HEAD 재검증 실패: close proof·매니페스트가 HEAD에 없다')
  const parsed = parseCloseProof(cpText)
  if (parsed.problems.length) throw new Error(`dev-complete HEAD 재검증 실패: close proof 손상 — ${parsed.problems.join('; ')}`)
  // 🔴 DEC-B6·B7(phase-3b2·3b3): intake와 **동일한** committed 증거(design+phase) 무결성 규칙(공유
  //    verifyCommittedEvidenceIntegrity). 발행 후에도 design 승인 archive+inventory·모든 phase archive가 HEAD에
  //    존재하고 SHA가 일치해야 한다 — 아니면 fail-closed(intake의 corrupt와 대칭).
  const integrity = verifyCommittedEvidenceIntegrity({ ticketRel: ctx.ticketRel, manifestText: mfText, ports: createEvidencePorts(gitRoot, `${ctx.ticketRel}/responses`) })
  if (integrity.problems.length)
    throw new Error(`dev-complete HEAD 재검증 실패: committed 증거 손상 — ${integrity.problems.join('; ')}`)
  const committedDesignRef = designHashFromManifest(mfText)
  const state = deriveBaseState({
    durabilityRequired: true,
    closeProofRows: parsed.rows,
    ledgerHasApprovedClose: false,
    committedEvidenceComplete: true,
    // 🔴 DEC-B5: HEAD 재검증도 design-bound — 현재 committed design_ref에 결속된 phase evidence만 산입.
    evidencedPhaseIds: evidencedPhaseIdsFromManifest(mfText, committedDesignRef),
    committedDesignRef,
  })
  if (state !== 'dev-complete')
    throw new Error(`dev-complete HEAD 재검증 실패: 발행 후 파생 상태가 dev-complete가 아니다(${state})`)
}

/**
 * `HEAD:<repoRel>` blob 텍스트(없으면 null).
 * 🔴 부재가 정상이므로 quiet 어댑터를 쓴다 — git의 `fatal: … does not exist in 'HEAD'`가 정상 경로에서
 *    사용자 화면에 뜨지 않게 한다(REQ-2026-058 F-5). 판정(`catch → null`)은 그대로다.
 */
function headBlobText(repoRel: string): string | null {
  try {
    return quietGitAdapter.exec(['show', `HEAD:${repoRel}`])
  } catch {
    return null
  }
}

interface FinalizeCtx {
  ticketDir: string
  ticketRel: string
  responsesDir: string
  manifestPath: string
  /** REQ-2026-052: close proof append용 repo root(디스크 경로 해소). */
  rootForClose: string
  state: WorkflowState
  ev: ApprovalEvidence
  archiveNames: string[]
  validPhaseIds: string[]
  sourceSha: string
}

/**
 * evidence-finalize(**멱등**) + 소비 — 정상 flow와 `--finalize` 복구가 공유.
 * 이미 sourceSha가 매니페스트에 있으면(=evidence 커밋은 됐고 consume만 못 함) append/chore를 skip하고 소비만 수행.
 * 소비는 항상 마지막. state.json은 scratch 유지(커밋 안 함).
 */
/** 🔴 테스트 전용: git 경계·gitRoot를 실제 저장소로 주입한다(finalizeEvidenceAndConsume 격리 테스트용). */
export function __setGitForTest(root: string): void {
  gitRoot = root
  gitAdapter = createGitAdapter(root)
  quietGitAdapter = createGitAdapter(root, quietGitRunner) // 같은 root를 따라가야 HEAD 조회가 엉뚱한 저장소를 보지 않는다
}

export function finalizeEvidenceAndConsume(ctx: FinalizeCtx): void {
  // 🔴 REQ-2026-052 phase-3a P1(리뷰 반영): finalize 멱등성을 **HEAD 기준**으로 판정한다 — 워킹 매니페스트가
  //    아니라. 이전엔 `ctx.existing`(워킹트리 파일)을 base·멱등 판정에 썼는데, evidence commit이 실패하면
  //    디스크엔 이미 매니페스트가 쓰였으므로 재시도가 그걸 "이미 finalize됨"으로 오판해 **HEAD에 증거가 없는데
  //    완료로 진행**했다(dev-complete proof·archive·ledger 미커밋). HEAD blob만 base로 삼아 "커밋 성공 여부"가
  //    아니라 "HEAD에 실제 존재하는지"로 판정한다.
  const manifestRel = `${ctx.ticketRel}/responses/approvals.jsonl`
  // 🔴 `git show`(gitAdapter)가 후행 개행을 제거하므로 복원한다 — 없으면 append 시 두 JSON이 한 줄로 붙어 손상된다.
  const headManifestRaw = headBlobText(manifestRel) ?? ''
  const headManifest = headManifestRaw && !headManifestRaw.endsWith('\n') ? `${headManifestRaw}\n` : headManifestRaw
  // 기존 무결성 먼저(변조된 매니페스트 위에서 consume 금지). HEAD blob 검증.
  if (headManifest.trim()) {
    const ep = validateManifest(headManifest, { ticketRel: ctx.ticketRel, validPhaseIds: ctx.validPhaseIds })
    if (ep.length) throw new Error(`HEAD approvals.jsonl 무결성 실패(fail-closed): ${ep.join('; ')}`)
  }
  const already = manifestHasConsumed(headManifest, ctx.sourceSha, {
    reviewKind: ctx.ev.review_kind,
    phaseId: ctx.ev.phase_id ?? null,
    responseSha256: ctx.ev.response_sha256,
  })
  // 🔴 이 커밋이 REQ 를 닫았는지 — `scope:'req'` 확인의 소비 시점(DEC-6). 멱등 skip 경로에서는 false 다
  //    (이미 finalize 된 커밋이 닫았다면 그때 소비됐다).
  let devCompleteEmitted = false
  if (!already) {
    const entry = buildManifestEntry(ctx.ev, {
      consumedAt: new Date().toISOString(),
      consumedByCommitSha: ctx.sourceSha,
      userCommitConfirmed: (ctx.state.user_commit_confirmed as UserCommitConfirmed | null) ?? null,
    })
    // 🔴 base는 **HEAD 매니페스트** — 실패한 이전 쓰기가 남긴 디스크 엔트리를 이어붙여 중복시키지 않는다.
    const newContent = headManifest + serializeManifestLine(entry)
    const reproblems = validateManifest(newContent, { ticketRel: ctx.ticketRel, validPhaseIds: ctx.validPhaseIds })
    if (reproblems.length)
      throw new Error(`(예상외) 매니페스트 검증 실패: ${reproblems.join('; ')} — source=${ctx.sourceSha} 커밋됨, --finalize로 복구`)
    mkdirSync(ctx.responsesDir, { recursive: true })
    writeFileSync(ctx.manifestPath, newContent, 'utf8')
    const archivePaths = expectedArchivePaths(ctx.archiveNames, ctx.ev.review_kind, ctx.ev.phase_id ?? null, ctx.ticketRel)
    // REQ-2026-051 D7: 리뷰 원장이 있으면 phase 증거 커밋에 함께 싣는다. 없으면 넣지 않는다 —
    // 없는 pathspec으로 `git add`가 실패해 증거 커밋 전체가 무산되면 본말전도다(design 경로의 ledgerExists와 대칭).
    const ledgerRel = `${ctx.ticketRel}/responses/${LEDGER_BASENAME}`
    const ledgerAdd = existsSync(join(ctx.ticketDir, 'responses', LEDGER_BASENAME)) ? [ledgerRel] : []
    // 🔴 REQ-2026-052 phase-3a: 이 커밋이 **마지막 phase**를 완료시키면 self-verifying dev-complete proof를
    //    **같은 durable 커밋**에 발행한다(DEC-B3). 아니면 발행 안 함. newContent(이 phase 엔트리 포함)로 판정.
    const devCompleteAdd = emitDevCompleteIfLastPhase(ctx, newContent)
    // 🔴 이 커밋이 REQ 를 닫았는가 — `scope:'req'` 확인의 소비 시점이다(DEC-6).
    //    발행 결과를 그대로 쓰므로 별도 판정이 생기지 않는다.
    devCompleteEmitted = devCompleteAdd.length > 0
    git(['add', ...archivePaths, `${ctx.ticketRel}/responses/approvals.jsonl`, ...ledgerAdd, ...devCompleteAdd])
    const choreLeak = stagedNames().filter((p) => !p.startsWith(`${ctx.ticketRel}/responses/`))
    if (choreLeak.length) throw new Error(`evidence 커밋에 responses 외 staged 금지(코드/state 누수): ${choreLeak.join(', ')}`)
    // REQ-2026-085 DEC-6: 메시지에 부기 trailer만 더한다 — 스테이징 범위는 그대로다.
    git(['commit', '-m', bookkeepingMessage(`chore(${ctx.state.id}): evidence-finalize — ${ctx.ev.review_kind} ${ctx.ev.phase_id ?? ''} 아카이브·approvals.jsonl${devCompleteAdd.length ? '·dev-complete' : ''}`)])
    // 🔴 발행 후 HEAD-only 재검증(DEC-B3 step 4): 발행했으면 HEAD blob만으로 dev-complete가 성립해야 한다.
    if (devCompleteAdd.length) verifyDevCompleteAtHead(ctx)
  } else {
    console.log('[req:commit] evidence 이미 finalize됨(멱등 skip) — 소비만 수행')
    /**
     * 🔴 복구 경로에서도 **완료 여부를 다시 판정**한다(phase-3 r02 P1).
     *
     * evidence·dev-complete 커밋 직후, 소비 checkpoint 전에 중단됐다가 `--finalize`로 복구하면 이 분기로
     * 온다. 여기서 `devCompleteEmitted`를 `false`로 두면 이미 REQ를 닫은 `scope:'req'` 확인이
     * **소비되지 않고 남아** 다음 REQ까지 따라간다 — "REQ 종료 커밋에서 소비한다"는 계약이 깨진다.
     *
     * 이미 엔트리가 매니페스트에 있으므로 `pending` 없이 그대로 판정한다(같은 함수를 공유).
     */
    devCompleteEmitted = wouldCompleteReq({
      phaseIds: ctx.validPhaseIds,
      manifestContent: headManifest,
    }).complete
  }
  // 소비(마지막) — commit_allowed=false·approved_diff_hash=null·pending 마커 제거.
  const consumed = consumeState(ctx.state, {
    sourceCommitSha: ctx.sourceSha,
    consumedAt: new Date().toISOString(),
    completesReq: devCompleteEmitted,
  })
  writeState(ctx.ticketDir, consumed)

  // ── REQ-2026-057: 소비 상태 durable checkpoint ──
  // 🔴 **순서를 바꾸지 않는다**(설계 DEC-2). consume을 evidence 커밋 앞으로 옮겨 한 커밋에 담으면,
  //    그 커밋이 실패했을 때 `pending_evidence_for`·`approval_evidence`가 이미 제거돼 `--finalize` 복구가
  //    근거를 잃는다. 그래서 소비를 마지막에 두고 **그 결과만** 별도 pathspec 커밋으로 내구화한다.
  //
  // 🔴 실패를 삼킨다 — 커밋은 이미 성공했다. 여기서 throw하면 사용자는 커밋이 실패한 것으로 오해한다.
  //    checkpoint가 없으면 이 REQ 이전과 같은 상태(dirty state.json)로 남고, 재실행이 흡수한다(멱등).
  try {
    if (
      commitStateCheckpoint({
        root: ctx.rootForClose,
        ticketRel: ctx.ticketRel,
        ticketId: String(ctx.state.id ?? ''),
        state: consumed,
        reason: `phase ${ctx.ev.phase_id ?? ''} 소비`,
        gitFn: git,
      })
    )
      console.log('[req:commit] state checkpoint 커밋(소비 상태).')
  } catch (err) {
    console.warn(
      `[req:commit] ⚠️ state checkpoint 커밋 실패(커밋·증거는 유효): ${err instanceof Error ? err.message : String(err)}\n` +
        `   ${ctx.ticketRel}/state.json 이 미커밋으로 남아 다음 req:new 가 막힐 수 있습니다 — 원인 해소 후 재실행하십시오.`,
    )
  }
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
  // REQ-2026-048 phase-3: 실제 내구화는 **공유 구현**에 위임한다. 정상 승인 경로(review-codex)와
  // 이 복구 경로가 같은 함수를 부르므로 동작이 갈라질 수 없다(DEC-1·DEC-3).
  const r = durableDesignEvidence({
    ticketId: String(args.state.id ?? ''),
    ticketRel: args.ticketRel,
    evidence: dev,
    validPhaseIds: args.validPhaseIds,
    nowIso: new Date().toISOString(),
    ports: createEvidencePorts(gitRoot, `${args.ticketRel}/responses`),
  })
  if (r.outcome === 'already-durable') {
    console.log('[req:commit] design 승인 이미 내구화됨(HEAD 기준 멱등 skip)')
    return
  }
  console.log(
    r.outcome === 'recommitted'
      ? '[req:commit] ✅ design-finalize 복구 완료 — 매니페스트는 이미 있었고 커밋만 누락돼 재커밋했습니다'
      : '[req:commit] ✅ design-finalize 완료 — approvals.jsonl 기록',
  )
}

export function main(argv: string[] = process.argv.slice(2)): void {
  const opts = parseArgs(argv)
  // 🔴 setup 완료 게이트(REQ-2026-062 DEC-6) — **가장 앞**이다. 다른 어떤 IO·판정보다 먼저여야 부분 상태가 남지 않는다.
  assertSetupComplete({ root: opts.root })
  // 🔴 REQ-2026-095 DEC-4: 붕괴 의심 경고는 **doctor·게이트보다 앞**에서 낸다. 두 근거가 같은 자리를 지지한다 —
  //    ① 자문이므로 커밋 성사 여부와 무관하게 사용자에게 보여야 하고,
  //    ② 뒤 단계가 실패해도 관측되므로 **배선 자체를 테스트할 수 있다**(02-plan 가드 9).
  //    차단하지 않고 메시지도 고치지 않는다 — 판정이 오탐일 수 있고, 커밋 메시지는 감사 기록이다.
  if (looksLikeCollapsedMessage(opts.message)) console.warn(collapsedMessageWarning())
  const cfg = loadConfig({ root: opts.root })
  gitRoot = cfg.root // runDoctor(pnpm/npm) cwd
  pkgManager = cfg.packageManager
  gitAdapter = createGitAdapter(cfg.root)
  quietGitAdapter = createGitAdapter(cfg.root, quietGitRunner) // HEAD 부재 조회 전용(F-5)
  const { ticketDir, doctorArgs } = resolveCommitTarget(opts, cfg)
  const { run, message, messageFile, finalize, finalizeDesign } = opts
  const state = loadState(ticketDir)
  const ticketRel = relative(cfg.root, ticketDir).replace(/\\/g, '/')
  const responsesDir = join(ticketDir, 'responses')
  const manifestPath = join(responsesDir, 'approvals.jsonl')
  const ev = (state.approval_evidence as ApprovalEvidence | undefined) ?? null
  const validPhaseIds = readPhases(state).map((p) => p.id)
  // REQ-2026-129 DEC-2: 이 티켓에 고정된 정지 정책(없으면 config — legacy 무회귀).
  const stopGateNow = effectiveStopGate(state, cfg)

  /**
   * 🔴 이 커밋이 REQ 를 완성시키는가 — **DRY-RUN·LIVE·복구가 같은 계산을 쓴다**(phase-3 r01 P1).
   *    미리보기가 보수적으로 `true` 를 쓰면 중간 phase 에서 "확인이 필요하다"고 **잘못** 표시해,
   *    미리보기 계약과 실제 정지 지점이 어긋난다.
   *    판정은 `wouldCompleteReq` 하나를 공유하므로 `dev-complete` 발행과도 갈라지지 않는다.
   */
  const computeCompletesReq = (st: WorkflowState, evidence: ApprovalEvidence | null): boolean => {
    if (stopGateNow !== 'req' || st.risk_level !== 'HIGH') return false
    const pendingPhase = typeof st.current_phase === 'string' ? st.current_phase : null
    if (!pendingPhase) return false
    const existing = existsSync(manifestPath) ? readFileSync(manifestPath, 'utf8') : ''
    const pendingRef =
      evidence && typeof (evidence as { phase_design_ref?: unknown }).phase_design_ref === 'string'
        ? (evidence as { phase_design_ref: string }).phase_design_ref
        : null
    return wouldCompleteReq({
      phaseIds: validPhaseIds,
      manifestContent: existing,
      pending: { phaseId: pendingPhase, designRef: pendingRef },
    }).complete
  }

  // ── DRY-RUN(부작용 없음): 게이트/계획 미리보기 ──
  if (!run) {
    const gate = userConfirmGate(state, stopGateNow, computeCompletesReq(state, ev))
    const mode = finalizeDesign ? 'finalize-design' : finalize ? 'finalize(복구)' : '정상'
    console.log(`[req:commit] DRY-RUN (모드=${mode}; 실제 실행은 --run)`)
    console.log(`  ticket=${ticketRel} commit_allowed=${String(state.commit_allowed)} risk=${String(state.risk_level)}`)
    console.log(`  HIGH 게이트: ${gate.blocked ? `차단 — ${gate.reason}` : 'OK(또는 비-HIGH)'}`)
    if (finalize) {
      // P2-a: pending 마커 없어도 HEAD가 승인 source면 orphaned 복구 가능 → dry-run에도 반영.
      const head = (() => {
        try {
          return { sha: git(['rev-parse', 'HEAD']), tree: git(['rev-parse', 'HEAD^{tree}']) }
        } catch {
          return null
        }
      })()
      const rec = resolveRecoverySource(state, head)
      let core = { valid: false, reason: rec.reason }
      if (rec.sourceSha) {
        let sourceTree: string | null = null
        try {
          sourceTree = git(['rev-parse', `${rec.sourceSha}^{tree}`])
        } catch {
          sourceTree = null
        }
        core = recoveryCoreValid(state, sourceTree)
      }
      console.log(
        `  finalize 적용 가능성: ${core.valid ? `valid${rec.viaOrphan ? '(orphaned 복구)' : ''}` : `invalid — ${core.reason}`}`,
      )
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
    // ── REQ-2026-142 DEC-3a: 소비 state 만 미커밋인 창 ──
    // ④에서 소비 state 를 **쓴 뒤 checkpoint 커밋 전에** 죽으면 `approval_evidence` 가 이미 없다.
    // 그러면 아래 `recoveryClassify` 는 원리적으로 성립할 수 없고("복구할 미완 승인 없음"), 예전엔
    // 여기서 영영 막혔다. 남은 일은 checkpoint 하나뿐이므로 그것만 재개한다 — 증거는 이미 HEAD 에 있다.
    //
    // 🔴 판정은 `planEvidenceRecovery` 가 한다. `!ev` 라는 사실만으로 여는 것이 아니다.
    if (!ev) {
      const plan = planEvidenceRecovery(recoveryIo(cfg.root, ticketRel, state))
      if (plan.kind !== 'ready' || plan.resumeFrom !== 'checkpoint')
        throw new Error(
          `finalize 거부: ${plan.kind === 'blocked' ? `${plan.reason} — ${RECOVERY_GUIDANCE[plan.reason]}` : 'approval_evidence 없음'}`,
        )
      runDoctor([...doctorArgs, '--finalize'])
      const res = executeEvidenceRecovery(plan, {
        finalizeEvidenceAndConsume: () => {
          throw new Error('(예상외) checkpoint 재개에서 evidence finalize 가 호출됐다')
        },
        commitStateCheckpoint: () =>
          commitStateCheckpoint({
            root: cfg.root,
            ticketRel,
            ticketId: String(state.id ?? ''),
            state,
            reason: '소비 state checkpoint 복구',
            gitFn: git,
          }),
      })
      console.log(
        res.checkpointCommitted
          ? '[req:commit] ✅ finalize 복구 완료 — 증거는 이미 커밋돼 있었고 소비 state checkpoint 만 재개했습니다'
          : '[req:commit] ✅ finalize 복구 불요 — 이미 완료된 상태입니다(멱등 no-op)',
      )
      return
    }
    // P2-a: pending 마커가 없을 수 있다(source 커밋 성공 후 markPendingEvidence 전에 crash). HEAD가 승인 source면 마커를 재구성해 복구.
    let fstate = state
    if (!pendingSourceSha(fstate)) {
      const head = (() => {
        try {
          return { sha: git(['rev-parse', 'HEAD']), tree: git(['rev-parse', 'HEAD^{tree}']) }
        } catch {
          return null
        }
      })()
      const rec = resolveRecoverySource(fstate, head)
      if (!rec.sourceSha) throw new Error(`finalize 거부: ${rec.reason}`)
      fstate = markPendingEvidence(fstate, rec.sourceSha) // crash가 막은 마커 재구성(승인 tree 대조로 안전 — 우회 아님)
      writeState(ticketDir, fstate)
      console.warn(`[req:commit] pending 마커 없음 — HEAD(${rec.sourceSha.slice(0, 8)})가 승인 source(tree==approved)라 orphaned 복구용 마커 재구성`)
    }
    const sourceSha = pendingSourceSha(fstate) as string
    const sourceTree = git(['rev-parse', `${sourceSha}^{tree}`])
    const rc = recoveryClassify(fstate, sourceTree)
    if (!rc.valid) throw new Error(`finalize 거부: ${rc.reason}`)
    if (!ev) throw new Error('approval_evidence 없음') // rc.valid가 보장하나 TS narrowing
    // doctor --finalize: D9를 source 커밋 tree로 교체(우회 아님), 나머지 검사 정상.
    runDoctor([...doctorArgs, '--finalize'])
    // 복구 경로도 **같은 계산**을 쓴다 — 중간 phase 복구에서 불필요한 확인을 요구하지 않는다.
    const gate = userConfirmGate(fstate, stopGateNow, computeCompletesReq(fstate, ev))
    if (gate.blocked) throw new Error(gate.reason)
    finalizeEvidenceAndConsume({ ticketDir, ticketRel, responsesDir, manifestPath, state: fstate, ev, archiveNames, validPhaseIds, sourceSha, rootForClose: cfg.root })
    console.log(`[req:commit] ✅ finalize 복구 완료 — source=${sourceSha.slice(0, 8)} · evidence/consume 복구`)
    return
  }

  // ── LIVE (B2 정상 flow) — ⚠️ B2 도구 자체 커밋엔 쓰지 않음(부트스트랩). Phase C부터 dogfood. ──
  const responsePathExists = !!ev && typeof ev.response_path === 'string' && existsSync(resolve(cfg.root, ev.response_path))

  // 1) doctor 게이트(fail-closed)
  runDoctor(doctorArgs)
  // 2) HIGH 사람확인 게이트 — 차단 지점은 `stopGate`가 정한다(REQ-2026-071 DEC-1·DEC-2).
  //    🔴 `req`는 **이 커밋이 REQ를 완성시킬 때만** 막는다. 중간 phase를 막으면 REQ 종료 지점에
  //       도달할 수 없다(설계 r01 P1). 판정은 `wouldCompleteReq` 하나를 공유해 `dev-complete` 발행과
  //       갈라지지 않는다 — 갈라지면 "게이트는 막는데 proof는 안 나오는" 상태가 생긴다.
  const gate = userConfirmGate(state, stopGateNow, computeCompletesReq(state, ev))
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
  // REQ-2026-092 DEC-1: 판정은 공유 술어 하나로. `req:review-codex`가 리뷰 **전에** 같은 술어로 막으므로
  // 정상 경로에서는 여기까지 위반이 오지 않는다 — 그래도 fail-closed 최종 방어로 남긴다(구버전 승인·수동 staging).
  const nonCode = sourceCommitForbiddenStaged(srcStaged, ticketRel)
  if (nonCode.length) throw new Error(forbiddenSourceStagedMessage(nonCode))
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
  finalizeEvidenceAndConsume({ ticketDir, ticketRel, responsesDir, manifestPath, state, ev, archiveNames, validPhaseIds, sourceSha, rootForClose: cfg.root })
  console.log(`[req:commit] ✅ 완료 — source=${sourceSha.slice(0, 8)} · evidence-finalize · commit_allowed 소비됨`)
}

/** bin dispatch 진입점(친절한 1줄 오류 + exit 1 경계). 직접 `tsx` 실행은 아래 `if (isMain) main()`이 그대로 담당(하위호환). */
export const runCli = makeRunCli(main)

const isMain = isEntrypoint(import.meta.url)
if (isMain) main()
