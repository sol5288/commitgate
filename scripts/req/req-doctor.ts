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
import { parseStatusZ, entryPaths, formatStatusEntry, STATUS_Z_ARGS, type StatusEntry } from './lib/porcelain'
import { isArchiveFileName, isAllowedResponsesScratch, reviewScratchPaths } from './lib/scratch'
import {
  loadState,
  validateVerdict,
  validateResponseStructure,
  findUnstagedOrUntracked,
  captureDesignBinding,
  designDocPaths,
  type WorkflowState,
  type Verdict,
  type ApprovalEvidence,
} from './review-codex'
import { loadConfig, packageRoot, stripBom, DEFAULTS, type ResolvedConfig } from './lib/config'
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
  statusEntries: StatusEntry[]
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
  /**
   * D19(REQ-2026-014): 대상 `package.json`의 `scripts` 맵. main()이 읽어 채운다(runChecks는 순수).
   *   - `undefined` = main()이 조회하지 않음(legacy/2-arg 호출) → OK '점검 불요'
   *   - `null`      = package.json 없음/파손 → OK '점검 불요'(읽기 전용 advisory라 FAIL 아님)
   *   - object      = 파싱된 scripts 맵
   * ⚠️ **optional이어야 한다** — required면 `tests/unit/req-doctor.test.ts`의 `const base: DoctorInputs = {…}`
   *    리터럴이 즉시 tsc 오류가 난다(기존 optional 필드 관례와 동일).
   */
  reqScripts?: Record<string, string> | null
  // D20(REQ-2026-038): vendored 자산 skew content-hash 검사. main()이 계산해 채운다(runChecks는 순수).
  //   - packagedSchemaSha : packageRoot()/workflow/machine.schema.json 의 sha256 (조회 불가 시 null)
  //   - vendoredSchemaSha : cfg.schemaPathAbs(소비 repo 사본)의 sha256 (조회 불가 시 null)
  //   - packageRootDiffers: packageRoot() !== cfg.root (dogfood/dev repo면 false → OK, D19 자기보호와 동일 취지)
  //   - schemaPathIsDefault: cfg.schemaPathAbs === resolve(cfg.root, DEFAULTS.schemaPath) (**정규화 절대경로** 비교 — 동치 상대경로 포함)
  //   - installedVersion  : packageRoot()/package.json 의 version (WARN 메시지용)
  // 미지정(undefined) = 계산 안 함(legacy/2-arg 호출) → OK '점검 불요'. optional이어야 테스트의 base 리터럴이 안 깨진다(reqScripts와 동일).
  packagedSchemaSha?: string | null
  vendoredSchemaSha?: string | null
  packageRootDiffers?: boolean
  schemaPathIsDefault?: boolean
  installedVersion?: string | null
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

/** 설치 모드(REQ-2026-014 D19 진단). `req:*` 스크립트 **값의 형태**로만 판정한다. */
export type InstallMode = 'stage-a' | 'stage-b' | 'mixed' | 'none' | 'custom'

/**
 * 진단 대상 `req:*` 키.
 *
 * 설치 축의 SSOT는 `bin/init.ts`의 `REQ_SCRIPTS`지만 여기서 import하지 않는다(아래 `classifyInstallMode` 주석 — 레이어 역전).
 * 키가 늘면 이 목록도 늘려야 한다. 드리프트가 나도 이 검사는 **advisory(WARN 상한)** 라 게이트를 깨지 않는다.
 */
const REQ_SCRIPT_KEYS = ['req:new', 'req:next', 'req:review-codex', 'req:doctor', 'req:commit'] as const

/** Stage A 형태: `tsx scripts/req/<file>.ts` (과거 vendored scaffold가 주입하던 모양). */
const STAGE_A_SCRIPT_RE = /^tsx\s+scripts\/req\/[A-Za-z0-9._-]+\.ts$/
/** Stage B 형태: `commitgate <verb>` (설치된 패키지 bin dispatch). */
const STAGE_B_SCRIPT_RE = /^commitgate\s+req:[A-Za-z0-9-]+$/

/**
 * 설치 모드 진단(REQ-2026-014 D19 — doctor D19, 순수).
 *
 * **`package.json`의 `req:*` 값 형태만** 본다. manifest·lockfile·node_modules·버전에 의존하지 않는다.
 *
 * ⚠️ **`bin/init.ts`를 import하지 않는다**(레이어 역전 방지). init.ts는 cross-spawn·semver·git spawn을 끌고 오는
 * ~1250줄 설치 CLI이고, 매 커밋 게이트로 도는 이 스크립트가 그것을 로드해선 안 된다. 그래서 바이트 일치(`REQ_SCRIPTS`)가
 * 아니라 **shape**로 판정한다 — 요구(R7)도 "script 형태를 기준으로"다.
 *
 * ⚠️ **migrate와의 비대칭은 의도적이다**: `bin/migrate.ts`의 전환은 **쓰기**라 `REQ_SCRIPTS` 바이트 정확 일치를
 * 요구한다(사용자 값을 덮지 않기 위해). 이 진단은 **읽기 전용 advisory**라 shape로 충분하다. 강도를 바꿔야 하는 쪽은 migrate다.
 *
 * @param scripts `package.json`의 `scripts` 맵. `undefined`/`null`이면 판정 불가 → 호출부가 '점검 불요'.
 */
export function classifyInstallMode(scripts: Record<string, string>): InstallMode {
  const values = REQ_SCRIPT_KEYS.map((k) => scripts[k]).filter((v): v is string => typeof v === 'string')
  if (values.length === 0) return 'none'
  const a = values.filter((v) => STAGE_A_SCRIPT_RE.test(v)).length
  const b = values.filter((v) => STAGE_B_SCRIPT_RE.test(v)).length
  if (a > 0 && b > 0) return 'mixed'
  if (a > 0 && a === values.length) return 'stage-a'
  if (b > 0 && b === values.length) return 'stage-b'
  // Stage A/B 형태가 하나도 없거나(전부 사용자 값), 일부만 kit 형태이고 나머지는 사용자 값.
  return 'custom'
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

// statusPaths는 lib/porcelain의 entryPaths로 대체(REQ-2026-012). `-z`가 rename의 src·dest를
// 필드로 확실히 주므로 ` -> ` 분할과 인용 해제가 필요 없다.

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
  const dirty = findUnstagedOrUntracked(inp.statusEntries, inp.scratch, inp.ticketRel)
  if (dirty.length)
    c.push({ id: 'D10', level: 'FAIL', msg: `unstaged/untracked 존재:\n  ${dirty.map(formatStatusEntry).join('\n  ')}` })
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
    ? inp.statusEntries.filter((e) => isAllowedResponsesScratch(e, inp.ticketRel as string)).flatMap(entryPaths)
    : []
  const allowD13 = new Set([...inp.ticketDocs, ...inp.scratch, ...responsesScratch].map((p) => p.replace(/\\/g, '/')))
  const codeChanges = [...new Set(inp.statusEntries.flatMap(entryPaths).filter((p) => p !== '' && !allowD13.has(p)))]
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

  // D19(REQ-2026-014): 설치 모드 진단 — `req:*` 값의 **형태**만 본다(manifest·lockfile·node_modules 미사용).
  //
  // 🔴 **level 상한은 WARN — 절대 FAIL이 아니다.** CommitGate 자신의 package.json이 Stage A 형태이고(개발 repo가
  //    자기 스크립트를 직접 실행하므로 정상), `req:commit`이 이 doctor를 exit≠0에 throw하는 하드 게이트로 spawn한다.
  //    FAIL이면 **이 저장소 자신의 커밋과 정당한 Stage A 소비자 전원의 커밋이 영구 차단**된다.
  //    Stage A는 결함이 아니라 지원되는 설치 형태다 → mixed만 WARN한다.
  if (inp.reqScripts === undefined || inp.reqScripts === null) {
    c.push({ id: 'D19', level: 'OK', msg: 'package.json scripts 미조회/없음(점검 불요)' })
  } else {
    const mode = classifyInstallMode(inp.reqScripts)
    if (mode === 'mixed')
      c.push({
        id: 'D19',
        level: 'WARN',
        msg: 'req:* 스크립트에 Stage A(tsx scripts/req/*.ts)와 Stage B(commitgate <verb>) 형태가 섞여 있습니다 — `commitgate migrate` 로 전환하세요(형태 기준 진단)',
      })
    else c.push({ id: 'D19', level: 'OK', msg: `설치 모드: ${INSTALL_MODE_LABEL[mode]}(req:* 스크립트 형태 기준)` })
  }

  // D20(REQ-2026-038): vendored machine.schema.json 자산 skew(content-hash) 진단.
  //
  // 🔴 **level 상한은 WARN — 절대 FAIL이 아니다**(D19 :406-411과 동일 근거). `req:commit`이 이 doctor를 exit≠0에
  //    throw하는 하드 게이트로 spawn하므로, FAIL이면 skew난 소비자의 모든 커밋이 `commitgate sync` 전까지 벽돌이 된다.
  //    확인된 피해는 데이터 손실이 아니라 **조용한 기능 상실**(stale 스키마가 full_review_requested를 제거해 delta 리뷰
  //    full-review 에스컬레이션이 죽음) → WARN이 정확한 강도.
  // 🔴 **content-hash 비교**(버전 비교 아님): machine_schema_version이 minor 간 불변일 수 있어(0.7.0/0.8.1 둘 다 "1.1")
  //    버전으로는 이 skew를 못 잡는다. sha256(shipped) vs sha256(vendored)만 잡는다.
  // 결정표(D19의 undefined→OK 선례): dev repo/dogfood·custom schemaPath·조회 불가·동일 → OK. 상이 → WARN.
  if (inp.packageRootDiffers === false) {
    c.push({ id: 'D20', level: 'OK', msg: '자산 skew 점검 불요(dev repo/dogfood — packageRoot === config root)' })
  } else if (inp.schemaPathIsDefault === false) {
    c.push({ id: 'D20', level: 'OK', msg: 'custom schemaPath(kit 관리 자산 아님 — unmanaged, 점검 불요)' })
  } else if (!inp.packagedSchemaSha || !inp.vendoredSchemaSha) {
    c.push({ id: 'D20', level: 'OK', msg: '자산 skew 점검 불요(shipped/vendored 스키마 조회 불가 — Stage A/미설치/2-arg)' })
  } else if (inp.packagedSchemaSha === inp.vendoredSchemaSha) {
    c.push({ id: 'D20', level: 'OK', msg: 'vendored machine.schema.json 동기화됨(shipped와 동일)' })
  } else {
    const ver = inp.installedVersion ? `commitgate ${inp.installedVersion}` : '설치된 commitgate'
    c.push({
      id: 'D20',
      level: 'WARN',
      msg: `vendored workflow/machine.schema.json 이 ${ver} 사본과 불일치(stale) — \`commitgate sync --apply\` 로 재동기화하세요. stale 스키마는 신규 필드(full_review_requested)를 조용히 제거해 design delta 리뷰의 full-review 에스컬레이션을 비활성화합니다(content-hash 감지).`,
    })
  }

  return c
}

/** D19 메시지용 라벨. */
const INSTALL_MODE_LABEL: Record<InstallMode, string> = {
  'stage-a': 'Stage A(vendored — scripts/req/** 를 직접 실행)',
  'stage-b': 'Stage B(런타임 패키지 — commitgate <verb> dispatch)',
  mixed: 'mixed',
  none: 'req:* 스크립트 없음',
  custom: '사용자 정의 req:* 값(kit 형태 아님)',
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

/**
 * D19(REQ-2026-014): 대상 `package.json`의 `scripts` 맵을 읽는다. 없거나 파손이면 `null`(→ D19는 '점검 불요' OK).
 *
 * **읽기 전용 advisory이므로 throw하지 않는다** — package.json이 깨졌다는 사실은 다른 게이트(init·migrate)가
 * fail-closed로 알린다. 여기서 throw하면 무관한 이유로 `req:commit`의 doctor 게이트가 죽는다.
 *
 * `stripBom` 필수: PowerShell `Set-Content -Encoding UTF8`이 만든 BOM'd package.json은 이 플랫폼에서 실제로
 * 발생하는 실패다. 없으면 정상 파일을 '파손'으로 오분류한다.
 */
function readReqScripts(root: string): Record<string, string> | null {
  const p = join(root, 'package.json')
  if (!existsSync(p)) return null
  try {
    const raw: unknown = JSON.parse(stripBom(readFileSync(p, 'utf8')))
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    const s = (raw as { scripts?: unknown }).scripts
    if (!s || typeof s !== 'object' || Array.isArray(s)) return null
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(s as Record<string, unknown>)) if (typeof v === 'string') out[k] = v
    return out
  } catch {
    return null
  }
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

/**
 * 파일 sha256(hex). 부재·오류 시 null — D20 fail-safe(조회 불가는 OK로 처리, 게이트를 막지 않는다).
 *
 * ⚠️ `createHash`는 이 파일 상단(`import { createHash } from 'node:crypto'`, :13)에 **이미** import돼 있다
 *    — D16 live-sha·evidence archive sha가 공유하는 기존 import다. D20용으로 추가 import는 필요 없다(중복이면 오류).
 * `export`인 이유: 테스트가 **실제 createHash 경로**를 직접 구동해(합성 sha 문자열이 아니라) req-doctor의 sha 계산이
 *    실제로 동작함을 증명하기 위함이다(REQ-2026-038 phase-2 리뷰 대응).
 */
export function safeSha256(abs: string): string | null {
  try {
    return createHash('sha256').update(readFileSync(abs)).digest('hex')
  } catch {
    return null
  }
}

/** package.json의 version 문자열. 부재·파손 시 null(D20 WARN 메시지용 — 없어도 무해). */
function safeReadVersion(pkgAbs: string): string | null {
  try {
    const raw = JSON.parse(stripBom(readFileSync(pkgAbs, 'utf8'))) as { version?: unknown }
    return typeof raw.version === 'string' ? raw.version : null
  } catch {
    return null
  }
}

export function main(argv: string[] = process.argv.slice(2)): void {
  const opts = parseArgs(argv)
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
    // `-z`: 경로 인용 없음(설계 D11) → core.quotePath 불필요. --untracked-files=all: `?? responses/` collapse 방지.
    statusEntries: parseStatusZ(git([...STATUS_Z_ARGS])),
    scratch: reviewScratchPaths(ticketRel),
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
    reqScripts: readReqScripts(cfg.root),
    // D20(REQ-2026-038): 자산 skew content-hash 입력. shipped=packageRoot 사본, vendored=cfg.schemaPathAbs(소비 repo 사본).
    packagedSchemaSha: safeSha256(join(packageRoot(), 'workflow', 'machine.schema.json')),
    vendoredSchemaSha: safeSha256(cfg.schemaPathAbs),
    packageRootDiffers: packageRoot() !== cfg.root,
    schemaPathIsDefault: cfg.schemaPathAbs === resolve(cfg.root, DEFAULTS.schemaPath), // 정규화 절대경로 비교(동치 상대경로 포함)
    installedVersion: safeReadVersion(join(packageRoot(), 'package.json')),
  }

  const checks = runChecks(inp)
  for (const c of checks) console.log(`[req:doctor] ${c.level} ${c.id}: ${c.msg}`)
  const fails = checks.filter((c) => c.level === 'FAIL')
  console.log(`[req:doctor] ${fails.length ? `FAIL ${fails.length}건` : 'PASS'} (REQ=${state.id})`)
  if (fails.length) process.exit(1)
}

/** bin dispatch 진입점(친절한 1줄 오류 + exit 1 경계). 직접 `tsx` 실행은 아래 `if (isMain) main()`이 그대로 담당(하위호환). */
export function runCli(argv: string[]): void {
  try {
    main(argv)
  } catch (err) {
    console.error(`commitgate: ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
  }
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href
if (isMain) main()
