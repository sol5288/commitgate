#!/usr/bin/env tsx
/**
 * req:doctor — AI REQ 워크플로우 1차 (단계 4B): 일관성 점검(fail-closed).
 *
 * 1차 최소셋(registry 비의존): D2·D3·D5·D6·D9·D10·D11 + D13(design 선행·freshness)·D15(NEEDS_FIX actionable). (D1/D7/D7b·D4a 등 registry/merge 의존은 2차)
 * FAIL 1건 이상 → exit 1, 자동 보정 금지(P9). review-codex 헬퍼 재사용.
 *
 * 사용: req:doctor <REQ-id>  |  req:doctor --ticket <dir>   (저장소 패키지매니저의 실행 형식으로)
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve, join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import {
  loadState,
  validateVerdict,
  validateResponseStructure,
  findUnstagedOrUntracked,
  captureDesignBinding,
  designDocPaths,
  isArchiveFileName,
  isAllowedResponsesScratch,
  type WorkflowState,
  type Verdict,
  type ApprovalEvidence,
} from './review-codex'
import { loadConfig, packageRoot, type ResolvedConfig } from './lib/config'
import { createGitAdapter, type GitAdapter } from './lib/adapters'

// 모든 git 호출은 GitAdapter 경유(D-017-3). main()이 loadConfig 후 config.root로 재생성(기본 = packageRoot — config 부재 시 현재 동작 보존).
let gitAdapter: GitAdapter = createGitAdapter(packageRoot())

function git(args: string[]): string {
  return gitAdapter.exec(args)
}

export type Level = 'OK' | 'WARN' | 'FAIL'
export interface Check {
  id: string
  level: Level
  msg: string
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface DoctorInputs {
  state: WorkflowState
  currentBranch: string
  branchExists: boolean
  // D11 feature-branch 게이트의 prefix(config). main이 cfg.branchPrefix 주입. 빈 prefix는 config 스키마가 금지(D11 무력화 방지).
  branchPrefix: string
  // D18 granularity 임계(config, advisory). 미지정 시 GRANULARITY_MAX_FILES(현재 동작). main이 cfg.granularityMaxFiles 주입.
  granularityMaxFiles?: number
  stagedTree: string
  statusLines: string[]
  scratch: string[]
  responseVerdict: Verdict | null
  responseStructureOk: boolean
  // D13(design 선행 + freshness): 유효 승인 = designApproved && designApprovedHash === currentDesignHash.
  designApproved: boolean
  designApprovedHash: string | null
  currentDesignHash: string | null // 현재 00/01/02 index 재계산 해시(미추적 등 계산 불가 시 null → 승인 무효)
  ticketDocs: string[] // 현재 티켓 docs(00/01/02/codex-request)의 exact repo-rel 경로 — D13 코드/문서 분류용
  // A2(D-016-5/6): 승인 증거 아카이브 정본 검증(D16 phase·D17 design)용 입력. main()이 채움(미지정 시 legacy/2-arg 동작).
  ticketRel?: string // responses/ 스크래치 매처(D10)용
  approvalEvidenceRequired?: boolean // state.approval_evidence_required(신규 REQ면 FAIL, legacy면 WARN)
  approvalEvidence?: ApprovalEvidence | null // state.approval_evidence(phase)
  designApprovalEvidence?: ApprovalEvidence | null // state.design_approval_evidence(design)
  approvalArchive?: ArchiveCheck | null // approvalEvidence.response_path 온디스크 검사
  designArchive?: ArchiveCheck | null // designApprovalEvidence.response_path 온디스크 검사
  liveResponseSha256?: string | null // 현재 codex-response.json 바이트 sha — D16(phase) live↔evidence 일치(D-016-5). design 미사용.
  // B3: finalize(복구) 모드. D9 비교 대상을 staged tree → pending_evidence_for.source_commit_sha의 source 커밋 tree로 교체(우회 아님).
  finalize?: boolean
  finalizeSourceTree?: string | null // git rev-parse <pending.source_commit_sha>^{tree}
}

/**
 * D9 검사(순수, 정상/finalize 공용). commit_allowed=true일 때 tree == approved_diff_hash.
 * - 정상(finalize=false): staged tree와 비교.
 * - finalize=true(B3 복구): **pending_evidence_for.source_commit_sha의 source 커밋 tree**와 비교 — source 재커밋 없이 evidence/consume만 복구.
 *   ⚠️ B3-P1: HEAD 커밋 tree가 아니라 **source 커밋 tree**(HEAD는 evidence 커밋일 수 있음). 우회가 아님 — 비교 대상만 교체, fail-closed(source tree 없거나 불일치 시 FAIL).
 */
export function finalizeD9Check(opts: {
  commitAllowed: boolean
  finalize: boolean
  approvedDiffHash: string | null
  stagedTree: string | null
  finalizeSourceTree: string | null
}): { ok: boolean; msg: string } {
  if (!opts.commitAllowed) return { ok: true, msg: 'commit_allowed=false(점검 불요)' }
  if (!opts.approvedDiffHash) return { ok: false, msg: 'commit_allowed=true인데 approved_diff_hash 없음' }
  if (opts.finalize) {
    const ok = opts.finalizeSourceTree !== null && opts.finalizeSourceTree === opts.approvedDiffHash
    return ok
      ? { ok: true, msg: 'finalize: source 커밋 tree == approved(복구 유효)' }
      : { ok: false, msg: `finalize: source 커밋 tree(${String(opts.finalizeSourceTree)}) != approved(${opts.approvedDiffHash}) — pending 마커 없음/불일치(정상 req:commit 사용)` }
  }
  const ok = opts.stagedTree === opts.approvedDiffHash
  return ok
    ? { ok: true, msg: 'staged tree == approved' }
    : { ok: false, msg: `staged tree(${String(opts.stagedTree)}) != approved(${opts.approvedDiffHash}) — stale 승인` }
}

/** Phase C granularity 정책: phase당 코드 변경 권고 상한(초과 시 D18 WARN — 분할 권고). FAIL 아님(advisory). */
export const GRANULARITY_MAX_FILES = 8

/**
 * Phase 분할 권고(순수, advisory). phase 1개의 코드 변경 파일 수가 maxFiles 초과면 WARN 메시지(빈 배열=권고 없음).
 * ⚠️ 절대 FAIL 아님 — 리뷰 면적을 줄이도록 **다음 phase부터** 분할을 유도하는 조언일 뿐(이미 큰 phase를 막지 않음).
 */
export function phaseGranularityWarnings(codeFiles: string[], maxFiles: number): string[] {
  if (codeFiles.length > maxFiles)
    return [`phase 코드 변경 ${codeFiles.length}파일 > 권고 ${maxFiles} — 리뷰 면적 큼, 다음부터 phase 분할 권고(granularity 정책)`]
  return []
}

/** 승인 증거 아카이브 파일의 온디스크 검사(main이 읽어 채움 — runChecks는 순수). */
export interface ArchiveCheck {
  exists: boolean
  sha256: string | null
  verdict: Verdict | null
  structureOk: boolean
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

/**
 * 승인 증거(evidence)와 그 아카이브 파일의 정합 문제 목록(순수, A2/D-016-5).
 * evidence 누락 → 단일 문제. 그 외: 경로 confinement·아카이브 존재·SHA·구조(AJV)·validateVerdict·review_kind·승인 status·바인딩 정합.
 * base-sha 검증은 **evidence 자신의 review_base_sha 기준**(design 승인 base는 고정 — 이후 phase의 state.review_base_sha 변동과 무관, 오탐 방지).
 */
function evidenceProblems(
  ev: ApprovalEvidence | null | undefined,
  archive: ArchiveCheck | null | undefined,
  kind: 'phase' | 'design',
  s: WorkflowState,
  ticketRel: string | undefined,
  liveResponseSha256?: string | null,
): string[] {
  const r: string[] = []
  if (!ev) return [`${kind} 승인 증거(evidence) 누락`]
  if (!isConfinedArchivePath(ev.response_path, ticketRel))
    r.push(`response_path가 현재 티켓 responses/ 직계 아카이브가 아님: ${ev.response_path}`)
  if (!archive || !archive.exists) {
    r.push(`아카이브 파일 없음: ${ev.response_path}`)
    return r
  }
  if (archive.sha256 !== ev.response_sha256) r.push(`아카이브 SHA 불일치(기대 ${ev.response_sha256})`)
  if (!archive.structureOk) r.push('아카이브 구조(AJV) 비적합')
  const v = archive.verdict
  if (!v) r.push('아카이브 verdict 파싱 불가')
  else {
    // base-sha 교차검증은 아래 evidence vs 아카이브 비교로 한다(state.review_base_sha 기준 금지 — design 오탐).
    const dom = validateVerdict(v)
    if (!dom.ok) r.push(...dom.errors)
    if (v.review_kind !== kind) r.push(`아카이브 review_kind 불일치(기대 ${kind}, 실제 ${String(v.review_kind)})`)
    if (v.commit_approved !== 'yes') r.push(`아카이브 commit_approved≠yes(${String(v.commit_approved)})`)
    if (v.status !== 'STEP_COMPLETE' && v.status !== 'COMPLETE') r.push(`아카이브 status 비승인(${String(v.status)})`)
    if (ev.review_base_sha !== v.review_base_sha) r.push('evidence review_base_sha != 아카이브 review_base_sha')
  }
  if (ev.review_kind !== kind) r.push(`evidence review_kind 불일치(${String(ev.review_kind)})`)
  if (kind === 'phase') {
    const approvedTree = typeof s.approved_diff_hash === 'string' ? s.approved_diff_hash : null
    if (!approvedTree || ev.approved_tree !== approvedTree) r.push('evidence approved_tree != state.approved_diff_hash')
    // phase evidence만 현재 state.review_base_sha와 일치 요구(design 고정 base는 비교 안 함).
    if (typeof s.review_base_sha === 'string' && ev.review_base_sha !== s.review_base_sha)
      r.push('evidence review_base_sha != state.review_base_sha')
    // D-016-5(A2-R3): live codex-response.json(있으면)은 pinned evidence와 동일 SHA여야 함 — D6가 phase 게이팅에 live 응답을 쓰므로.
    // (design은 미적용 — live 파일은 단일 캐시라 이후 phase 리뷰가 덮으면 phase 응답이 됨, D17은 archive SHA로만 검증.)
    if (typeof liveResponseSha256 === 'string' && liveResponseSha256 !== ev.response_sha256)
      r.push('live codex-response.json SHA != evidence response_sha256 (손편집 의심)')
  } else {
    const dh = typeof s.design_approved_hash === 'string' ? s.design_approved_hash : null
    if (!dh || ev.design_hash !== dh) r.push('evidence design_hash != state.design_approved_hash')
  }
  return r
}

/**
 * porcelain v1 라인의 **모든** 변경 경로 추출. 비-ASCII는 core.quotePath=false 전제.
 * rename/copy(`R`/`C`, ` -> `)는 [원본, 목적지] **둘 다** 반환 — D13이 양쪽 모두 검사하여
 * 비허용 경로→허용 경로 rename으로 코드 삭제를 우회하는 것을 차단(Codex P2). 그 외는 단일 경로.
 */
export function statusPaths(line: string): string[] {
  if (line.length < 4) return []
  const body = line.slice(3).replace(/\\/g, '/')
  const arrow = body.indexOf(' -> ')
  if (arrow >= 0) return [body.slice(0, arrow), body.slice(arrow + 4)]
  return [body]
}

/** 순수: 입력으로부터 1차 최소셋 점검 결과 산출(부수효과 없음 — 테스트 용이). */
export function runChecks(inp: DoctorInputs): Check[] {
  const c: Check[] = []
  const s = inp.state
  const branch = typeof s.branch === 'string' ? s.branch : ''
  const phase = String(s.phase)
  const commitAllowed = s.commit_allowed === true

  // D2: state.branch == 현재 브랜치
  if (branch && inp.currentBranch !== branch)
    c.push({ id: 'D2', level: 'FAIL', msg: `state.branch(${branch}) != current(${inp.currentBranch})` })
  else c.push({ id: 'D2', level: 'OK', msg: 'branch 일치' })

  // D3: state.branch 로컬 존재
  if (branch && !inp.branchExists) c.push({ id: 'D3', level: 'FAIL', msg: `state.branch 로컬에 없음: ${branch}` })
  else c.push({ id: 'D3', level: 'OK', msg: 'branch 존재' })

  // D5: codex_thread_id 형식(설정 시 UUID)
  const tid = s.codex_thread_id
  if (typeof tid === 'string' && tid.length > 0 && !UUID_RE.test(tid))
    c.push({ id: 'D5', level: 'FAIL', msg: `codex_thread_id 형식 오류: ${tid}` })
  else c.push({ id: 'D5', level: 'OK', msg: 'thread_id 형식 OK(또는 미설정)' })

  // D6: commit_allowed=true → 온디스크 응답 재파싱·재검증 + **실제 승인 여부**·state 바인딩 정합(§9.6, DEC-WF-025).
  // 저장 플래그(commit_allowed)를 믿지 않고, 응답이 정말로 승인(commit_approved=yes·승인 status)했는지 + 바인딩 필드가 정합한지 재확인.
  if (commitAllowed) {
    const reasons: string[] = []
    const v = inp.responseVerdict
    if (!v) {
      reasons.push('codex-response.json 없음/파손')
    } else {
      if (!inp.responseStructureOk) reasons.push('구조(AJV) 비적합')
      const dom = validateVerdict(v, {
        reviewBaseSha: typeof s.review_base_sha === 'string' ? s.review_base_sha : undefined,
      })
      if (!dom.ok) reasons.push(...dom.errors)
      if (v.commit_approved !== 'yes') reasons.push(`응답 commit_approved≠yes(${String(v.commit_approved)})`)
      if (v.status !== 'STEP_COMPLETE' && v.status !== 'COMPLETE')
        reasons.push(`응답 status 비승인(${String(v.status)})`)
    }
    const baseSha = typeof s.review_base_sha === 'string' ? s.review_base_sha : ''
    const reviewTree = typeof s.review_diff_hash === 'string' ? s.review_diff_hash : ''
    const approvedTree = typeof s.approved_diff_hash === 'string' ? s.approved_diff_hash : ''
    if (!baseSha) reasons.push('state.review_base_sha 없음')
    if (!reviewTree) reasons.push('state.review_diff_hash 없음')
    if (!approvedTree) reasons.push('state.approved_diff_hash 없음')
    else if (reviewTree && approvedTree !== reviewTree) reasons.push('approved_diff_hash != review_diff_hash')

    if (reasons.length)
      c.push({ id: 'D6', level: 'FAIL', msg: `commit_allowed=true 재검증 실패: ${reasons.join('; ')}` })
    else c.push({ id: 'D6', level: 'OK', msg: '재검증 OK(승인 verdict + 바인딩 정합)' })
  } else c.push({ id: 'D6', level: 'OK', msg: 'commit_allowed=false(점검 불요)' })

  // D9: commit_allowed=true → tree == approved_diff_hash(§8.4). 정상=staged tree, **finalize(B3)=현재 HEAD 커밋 tree**.
  // finalize는 우회가 아니라 비교 **대상만** 교체(여전히 fail-closed) — source 재커밋 없이 evidence/consume만 복구.
  {
    const d9 = finalizeD9Check({
      commitAllowed,
      finalize: inp.finalize === true,
      approvedDiffHash: typeof s.approved_diff_hash === 'string' ? s.approved_diff_hash : null,
      stagedTree: inp.stagedTree,
      finalizeSourceTree: inp.finalizeSourceTree ?? null,
    })
    c.push({ id: 'D9', level: d9.ok ? 'OK' : 'FAIL', msg: d9.msg })
  }

  // D10: unstaged/untracked(비-스크래치) — review용 클린. A2: ticketRel 전달 시 responses/ untracked 아카이브만 스크래치 허용(tracked 변조·approvals.jsonl·타 티켓 flag).
  const dirty = findUnstagedOrUntracked(inp.statusLines, inp.scratch, inp.ticketRel)
  if (dirty.length) c.push({ id: 'D10', level: 'FAIL', msg: `unstaged/untracked 존재:\n  ${dirty.join('\n  ')}` })
  else c.push({ id: 'D10', level: 'OK', msg: '워킹트리 클린(staged + 스크래치)' })

  // D11: phase≠DONE인데 main 또는 비-<branchPrefix>* 브랜치(DEC-WF-020). branchPrefix=config(기본 feat/req-).
  if (phase !== 'DONE' && (inp.currentBranch === 'main' || !branch.startsWith(inp.branchPrefix)))
    c.push({
      id: 'D11',
      level: 'FAIL',
      msg: `REQ 작업이 자기 feature 브랜치 밖(current=${inp.currentBranch}, state.branch=${branch || '(없음)'})`,
    })
  else c.push({ id: 'D11', level: 'OK', msg: 'feature 브랜치 OK' })

  // D13: design 선행 게이트(DEC-WF-027). 유효 design 승인(freshness 포함) 없으면 비-티켓 코드 변경 금지.
  // 유효 승인 = design_approved=true AND design_approved_hash === 현재 00/01/02 index 재계산 해시(불일치=승인 후 설계 변경→무효).
  // 코드 변경 = statusLines(staged/unstaged/untracked)의 경로 중 **티켓 docs/scratch 외**(exact 매칭 — 다른 REQ·.bak·src 모두 코드).
  const validDesign =
    inp.designApproved === true &&
    typeof inp.designApprovedHash === 'string' &&
    inp.designApprovedHash.length > 0 &&
    inp.designApprovedHash === inp.currentDesignHash
  // A2(A2-R2-P2-1): 허용된 untracked 응답 아카이브(D10 scratch)는 D13 코드변경 분류에서도 제외 — D10/D13 scratch 정책 일치.
  // (tracked evidence 변조·approvals.jsonl·타 티켓·collapsed dir은 isAllowedResponsesScratch=false라 제외되지 않음 → D10/D13 모두 FAIL 유지.)
  const responsesScratch = inp.ticketRel
    ? inp.statusLines.filter((l) => isAllowedResponsesScratch(l, inp.ticketRel as string)).flatMap(statusPaths)
    : []
  const allowD13 = new Set([...inp.ticketDocs, ...inp.scratch, ...responsesScratch].map((p) => p.replace(/\\/g, '/')))
  const codeChanges = [...new Set(inp.statusLines.flatMap(statusPaths).filter((p) => p !== '' && !allowD13.has(p)))]
  if (!validDesign && codeChanges.length)
    c.push({
      id: 'D13',
      level: 'FAIL',
      msg: `유효 design 승인 없이 비-티켓 코드 변경 존재(설계 선행 위반): ${codeChanges.join(', ')}`,
    })
  else
    c.push({
      id: 'D13',
      level: 'OK',
      msg: validDesign ? 'design 승인 유효(freshness OK) — 코드 변경 허용' : '비-티켓 코드 변경 없음',
    })

  // D18(Phase C, granularity 정책): phase 코드 변경 파일 수가 임계 초과면 분할 권고. **advisory WARN — 절대 FAIL 아님**.
  // 임계 = config(cfg.granularityMaxFiles) 주입, 미지정 시 GRANULARITY_MAX_FILES(현재 동작).
  {
    const maxFiles = inp.granularityMaxFiles ?? GRANULARITY_MAX_FILES
    const adv = phaseGranularityWarnings(codeChanges, maxFiles)
    if (adv.length) c.push({ id: 'D18', level: 'WARN', msg: adv.join(' / ') })
    else c.push({ id: 'D18', level: 'OK', msg: `granularity OK(코드 변경 ${codeChanges.length}파일 ≤ ${maxFiles})` })
  }

  // D15: 온디스크 응답이 NEEDS_FIX면 findings·next_action이 actionable해야 함(스키마/validateVerdict와 중복이라도 명시 점검).
  // typeof 가드: 파손된 next_action(비-문자열)이 .trim()에서 throw하지 않게(fail-closed).
  const rv = inp.responseVerdict
  if (rv && rv.status === 'NEEDS_FIX') {
    const findingsOk = Array.isArray(rv.findings) && rv.findings.length > 0
    const nextOk = typeof rv.next_action === 'string' && rv.next_action.trim().length > 0
    if (!findingsOk || !nextOk)
      c.push({
        id: 'D15',
        level: 'FAIL',
        msg: `NEEDS_FIX 응답인데 actionable 아님(findings ${findingsOk ? 'OK' : '없음'}, next_action ${nextOk ? 'OK' : '공백'})`,
      })
    else c.push({ id: 'D15', level: 'OK', msg: 'NEEDS_FIX 응답 actionable(findings + next_action)' })
  } else c.push({ id: 'D15', level: 'OK', msg: 'NEEDS_FIX 응답 아님(점검 불요)' })

  // D16(A2/D-016-5): phase 승인 증거 아카이브 정본 검증. commit_allowed=true일 때만.
  // 신규 REQ(approval_evidence_required)면 누락/불일치 FAIL, legacy면 (증거 없음=OK / 증거 있는데 불일치=WARN). 기존 D6/D9 대체 아님(추가 게이트).
  if (commitAllowed) {
    const required = inp.approvalEvidenceRequired === true
    if (!required && !inp.approvalEvidence) {
      c.push({ id: 'D16', level: 'OK', msg: 'legacy(증거 미요구) — 점검 불요' })
    } else {
      const problems = evidenceProblems(inp.approvalEvidence, inp.approvalArchive, 'phase', s, inp.ticketRel, inp.liveResponseSha256)
      if (problems.length === 0) c.push({ id: 'D16', level: 'OK', msg: 'phase 승인 증거 아카이브 정합' })
      else if (required) c.push({ id: 'D16', level: 'FAIL', msg: `phase 승인 증거 검증 실패: ${problems.join('; ')}` })
      else c.push({ id: 'D16', level: 'WARN', msg: `phase 승인 증거 미정합(legacy): ${problems.join('; ')}` })
    }
  } else c.push({ id: 'D16', level: 'OK', msg: 'commit_allowed=false(점검 불요)' })

  // D17(A2/D-016-5·6): design 승인 증거 아카이브 정본 검증. design_approved=true일 때만(D13 freshness와 별개의 증거 게이트).
  if (inp.designApproved === true) {
    const required = inp.approvalEvidenceRequired === true
    if (!required && !inp.designApprovalEvidence) {
      c.push({ id: 'D17', level: 'OK', msg: 'legacy(증거 미요구) — 점검 불요' })
    } else {
      const problems = evidenceProblems(inp.designApprovalEvidence, inp.designArchive, 'design', s, inp.ticketRel)
      if (problems.length === 0) c.push({ id: 'D17', level: 'OK', msg: 'design 승인 증거 아카이브 정합' })
      else if (required) c.push({ id: 'D17', level: 'FAIL', msg: `design 승인 증거 검증 실패: ${problems.join('; ')}` })
      else c.push({ id: 'D17', level: 'WARN', msg: `design 승인 증거 미정합(legacy): ${problems.join('; ')}` })
    }
  } else c.push({ id: 'D17', level: 'OK', msg: 'design_approved=false(점검 불요)' })

  return c
}

// ──────────────────────────────────────────────────────────────── CLI ──

export interface DoctorArgs {
  ticket: string | null
  reqId: string | null
  finalize: boolean
  root: string | null
}

/** CLI 파싱(fail-closed). `--ticket`·`--finalize`(B3)·`--root <dir>`(config 탐색 루트). 알 수 없는 옵션·`--root` 값 누락은 throw. */
export function parseArgs(argv: string[]): DoctorArgs {
  let ticket: string | null = null
  let reqId: string | null = null
  let finalize = false
  let root: string | null = null
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === undefined) continue
    // bare `--`는 POSIX end-of-options 마커(DEC-011-3). pnpm/yarn은 이를 스크립트에 그대로 넘긴다.
    if (a === '--') continue
    else if (a === '--ticket') ticket = argv[++i] ?? null
    else if (a === '--finalize') finalize = true // B3: D9를 finalize(source tree) 모드로
    else if (a === '--root') {
      const v = argv[++i]
      if (v === undefined) throw new Error('--root 값 필요')
      root = v
    } else if (a.startsWith('-')) throw new Error(`알 수 없는 옵션: ${a}`)
    else reqId = a
  }
  return { ticket, reqId, finalize, root }
}

function resolveTicketDir(opts: DoctorArgs, cfg: ResolvedConfig): string {
  if (opts.ticket) return resolve(opts.ticket)
  if (opts.reqId) return join(cfg.workflowDirAbs, `REQ-${opts.reqId.replace(/^REQ-/, '')}`)
  throw new Error('REQ id 또는 --ticket <dir> 필요')
}

function branchExistsLocal(branch: string): boolean {
  if (!branch) return false
  try {
    git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])
    return true
  } catch {
    return false
  }
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2))
  const cfg = loadConfig({ root: opts.root })
  gitAdapter = createGitAdapter(cfg.root) // 모든 git 호출 cwd = config.root
  const ticketDir = resolveTicketDir(opts, cfg)
  const finalize = opts.finalize // B3: D9를 source tree 모드로
  const state = loadState(ticketDir)

  const respPath = join(ticketDir, 'codex-response.json')
  let responseVerdict: Verdict | null = null
  let responseStructureOk = false
  let liveResponseSha256: string | null = null
  if (existsSync(respPath)) {
    const bytes = readFileSync(respPath)
    liveResponseSha256 = createHash('sha256').update(bytes).digest('hex') // D16 live↔evidence SHA(D-016-5)
    try {
      responseVerdict = JSON.parse(bytes.toString('utf8')) as Verdict
      responseStructureOk = validateResponseStructure(responseVerdict, cfg.schemaPathAbs).ok
    } catch {
      responseVerdict = null
    }
  }

  const repoRel = (abs: string) => relative(cfg.root, abs).replace(/\\/g, '/')
  const ticketRel = repoRel(ticketDir)

  // D13 freshness: 현재 설계문서 index 해시 재계산. 문서 미추적 등으로 계산 불가면 null(→ 유효 승인 불가, fail-closed).
  let currentDesignHash: string | null = null
  try {
    currentDesignHash = captureDesignBinding(ticketRel, git, cfg.designDocs).designHash
  } catch {
    currentDesignHash = null
  }

  // A2: 승인 증거 아카이브 온디스크 검사(D16/D17). evidence.response_path 파일을 읽어 sha/verdict/구조를 채움.
  const readArchive = (ev: ApprovalEvidence | null): ArchiveCheck | null => {
    if (!ev || typeof ev.response_path !== 'string' || !ev.response_path) return null
    // confinement: 현재 티켓 responses/ 직계 아카이브만 읽음(범위 밖 경로는 미존재 처리 → evidenceProblems가 FAIL).
    if (!isConfinedArchivePath(ev.response_path, ticketRel)) return { exists: false, sha256: null, verdict: null, structureOk: false }
    const abs = resolve(cfg.root, ev.response_path)
    if (!existsSync(abs)) return { exists: false, sha256: null, verdict: null, structureOk: false }
    try {
      const bytes = readFileSync(abs)
      let v: Verdict | null = null
      let sOk = false
      try {
        v = JSON.parse(bytes.toString('utf8')) as Verdict
        sOk = validateResponseStructure(v, cfg.schemaPathAbs).ok
      } catch {
        v = null
      }
      return { exists: true, sha256: createHash('sha256').update(bytes).digest('hex'), verdict: v, structureOk: sOk }
    } catch {
      return { exists: false, sha256: null, verdict: null, structureOk: false }
    }
  }
  const approvalEvidence = (state.approval_evidence as ApprovalEvidence | undefined) ?? null
  const designApprovalEvidence = (state.design_approval_evidence as ApprovalEvidence | undefined) ?? null

  // B3 finalize: pending_evidence_for.source_commit_sha의 source 커밋 tree(없거나 계산 불가 → null → D9 FAIL).
  let finalizeSourceTree: string | null = null
  if (finalize) {
    const pending = state.pending_evidence_for as { source_commit_sha?: unknown } | undefined
    const sha = pending && typeof pending.source_commit_sha === 'string' && pending.source_commit_sha ? pending.source_commit_sha : null
    if (sha) {
      try {
        finalizeSourceTree = git(['rev-parse', `${sha}^{tree}`])
      } catch {
        finalizeSourceTree = null
      }
    }
  }

  const inp: DoctorInputs = {
    state,
    currentBranch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    branchExists: branchExistsLocal(typeof state.branch === 'string' ? state.branch : ''),
    branchPrefix: cfg.branchPrefix,
    granularityMaxFiles: cfg.granularityMaxFiles,
    stagedTree: git(['write-tree']),
    // --untracked-files=all: untracked 디렉터리 collapse(`?? responses/`) 방지 — responses/ 아카이브를 개별 파일로 판단(A2-P2 후속).
    statusLines: git(['-c', 'core.quotePath=false', 'status', '--porcelain', '--untracked-files=all']).split('\n').filter(Boolean),
    scratch: [
      repoRel(join(ticketDir, 'codex-response.json')),
      repoRel(join(ticketDir, '.review-preview.txt')),
      repoRel(join(ticketDir, 'state.json')), // 도구가 쓰는 메타데이터(4C e2e: review-codex 후 unstaged) — D10 제외
    ],
    responseVerdict,
    responseStructureOk,
    designApproved: state.design_approved === true,
    designApprovedHash: typeof state.design_approved_hash === 'string' ? state.design_approved_hash : null,
    currentDesignHash,
    ticketDocs: [...designDocPaths(ticketRel, cfg.designDocs), `${ticketRel}/codex-request.md`],
    ticketRel,
    approvalEvidenceRequired: state.approval_evidence_required === true,
    approvalEvidence,
    designApprovalEvidence,
    approvalArchive: readArchive(approvalEvidence),
    designArchive: readArchive(designApprovalEvidence),
    liveResponseSha256,
    finalize,
    finalizeSourceTree,
  }

  const checks = runChecks(inp)
  for (const c of checks) console.log(`[req:doctor] ${c.level} ${c.id}: ${c.msg}`)
  const fails = checks.filter((c) => c.level === 'FAIL')
  console.log(`[req:doctor] ${fails.length ? `FAIL ${fails.length}건` : 'PASS'} (REQ=${state.id})`)
  if (fails.length) process.exit(1)
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href
if (isMain) main()
