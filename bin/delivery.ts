#!/usr/bin/env tsx
/**
 * commitgate delivery — 상위 작업 묶음(delivery set) 오케스트레이션 (REQ-2026-066 phase-2).
 *
 * 브랜치 전환·검증·반영·레코드 갱신은 **사람이 따를 절차가 아니라 하나의 원자적 워크플로**다.
 * 절차로 두면 D2/D11 회피를 사람이 해야 하고 부분 실패가 재도입된다(설계 DEC-7).
 *
 * 🔴 **현재 브랜치 위치에 의존하지 않는다.** delivery ref와 레코드를 직접 읽고, 전제를 검증한 뒤
 *    **도구가 이동**한다. 그래서 사용자의 수동 `git checkout` 이탈은 상태 전이가 아니며 불변식을 깨지 않는다.
 *
 * 🔴 **레코드의 읽기 정본은 delivery ref다**(DEC-3). feature 브랜치의 사본은 분기 시점에 고정되어
 *    stale이므로 판정 입력이 아니다. 사본을 지우지도 않는다 — 지우면 integrate가 delete/modify 충돌을 내
 *    무충돌 불변식을 스스로 깬다.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { loadConfig, effectiveStopGate, type StopGate } from '../scripts/req/lib/config'
import { createGitAdapter, safeSpawnSyncStatus, type GitAdapter } from '../scripts/req/lib/adapters'
import { closeProofPath, parseCloseProof } from '../scripts/req/lib/close-proof'
import { createHash } from 'node:crypto'
import {
  userConfirmProblem,
  effectiveConfirmScope,
  requiredConfirmScope,
  type UserCommitConfirmed,
  validateManifest,
  designHashFromManifest,
  evidencedPhaseIdsFromManifest,
  verifyCommittedEvidenceIntegrity,
  parseManifestEntries,
} from '../scripts/req/lib/evidence'
import { main as reqNewMain } from '../scripts/req/req-new'
import { assertSetupComplete } from '../scripts/req/lib/setup-gate'
import { bookkeepingMessage } from '../scripts/req/lib/bookkeeping'
import {
  canApprove,
  canBegin,
  deliveryGateVerdict,
  deliveryRecordProblems,
  integrateTopologyProblems,
  newDeliveryRecord,
  nextOrder,
  serializeDeliveryRecord,
  activeMember,
  type DeliveryEvent,
  type DeliveryRecord,
} from '../scripts/req/lib/delivery'
import { isEntrypoint } from '../scripts/req/lib/cli-boundary'
import { createEvidencePorts } from '../scripts/req/lib/evidence-ports'

/** `-h/--help` 신호(오류가 아니다). */
export class HelpRequested extends Error {
  constructor() {
    super('help')
    this.name = 'HelpRequested'
  }
}

/** delivery 브랜치 이름 규칙. `branchPrefix`와 겹치지 않아야 D11이 feature와 혼동하지 않는다. */
export function deliveryBranchName(slug: string): string {
  return `delivery/${slug}`
}

/** 레코드 경로(repo-상대). 커밋되는 감사 데이터이므로 ticketRoot 아래에 둔다. */
export function deliveryRecordPath(ticketRoot: string, slug: string): string {
  return `${ticketRoot}/delivery/${slug}.json`
}

/** slug 검증: kebab-case(브랜치명에 그대로 들어가므로 argv·ref 안전 문자만). */
export function validateSlug(slug: string): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
    throw new Error(`slug는 kebab-case(a-z0-9, '-' 구분)여야 합니다: "${slug}"`)
}

export interface Opts {
  sub: 'create' | 'begin' | 'integrate' | 'seal' | 'approve' | 'reopen' | 'status'
  slug: string | null
  reqSlug: string | null
  successorOf: string | null
  /** 사람이 입력한 확인 문구(seal·approve·reopen). */
  confirm: string | null
  root: string | null
  run: boolean
}

export function parseArgs(argv: string[]): Opts {
  const o: Opts = { sub: 'status', slug: null, reqSlug: null, successorOf: null, confirm: null, root: null, run: false }
  const subs = ['create', 'begin', 'integrate', 'seal', 'approve', 'reopen', 'status'] as const
  let i = 0
  const first = argv[0]
  if (first !== undefined && (subs as readonly string[]).includes(first)) {
    o.sub = first as Opts['sub']
    i = 1
  } else if (first === '-h' || first === '--help') throw new HelpRequested()
  else if (first !== undefined && !first.startsWith('-')) throw new Error(`알 수 없는 하위 명령: ${first}`)

  for (; i < argv.length; i++) {
    const a = argv[i] as string
    if (a === '--root' || a === '--dir') {
      const v = argv[++i]
      // 🔴 값 자리에 온 옵션을 값으로 삼키지 않는다(REQ-2026-061 r01 P1과 같은 함정).
      if (v === undefined || v.startsWith('-')) throw new Error(`${a} 에 경로가 필요합니다 (받음: ${v ?? '(없음)'})`)
      o.root = v
    } else if (a === '--slug') {
      const v = argv[++i]
      if (v === undefined || v.startsWith('-')) throw new Error(`--slug 값이 필요합니다 (받음: ${v ?? '(없음)'})`)
      o.slug = v
    } else if (a === '--successor-of') {
      // 🔴 phase-3 소관이다. 파서만 받아 두면 사용자는 "교체했다"고 믿는데 일반 begin으로 처리된다 —
      //    지금은 **명시적으로 거부**하고 그 phase에서 구현과 함께 노출한다(phase-2 r03 observation).
      throw new Error('--successor-of 는 아직 제공되지 않습니다(후속 phase). 지금은 일반 `delivery begin`만 쓸 수 있습니다.')
    } else if (a === '--confirm') {
      const v = argv[++i]
      if (v === undefined || v.startsWith('-')) throw new Error(`--confirm 에 확인 문구가 필요합니다 (받음: ${v ?? '(없음)'})`)
      o.confirm = v
    } else if (a === '--run') o.run = true
    else if (a === '-h' || a === '--help') throw new HelpRequested()
    else if (!a.startsWith('-')) {
      if (o.sub === 'create' && o.slug === null) o.slug = a
      else if (o.sub === 'begin' && o.reqSlug === null) o.reqSlug = a
      else throw new Error(`예상치 못한 인자: ${a}`)
    } else throw new Error(`알 수 없는 옵션: ${a}`)
  }
  return o
}

// ────────────────────────────────────────────────────── git 헬퍼 ──

export interface Ctx {
  root: string
  ticketRoot: string
  git: GitAdapter
  /** 🔴 HIGH 확인을 **어느 지점에서** 요구하는지 정한다(REQ-2026-071). `merge`일 때만 delivery 확인이 필요하다. */
  stopGate: StopGate
}

export function makeCtx(rootOpt: string | null): Ctx {
  const cfg = loadConfig({ root: rootOpt })
  const git = createGitAdapter(cfg.root)
  const ticketRoot = cfg.ticketRoot
  return { root: cfg.root, ticketRoot, git, stopGate: cfg.stopGate }
}

/** ref가 존재하는가. */
export function refExists(ctx: Ctx, ref: string): boolean {
  const r = safeSpawnSyncStatus('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd: ctx.root })
  return r.status === 0
}

/** 특정 ref의 파일 본문. 없으면 `null`. */
export function readAtRef(ctx: Ctx, ref: string, relPath: string): string | null {
  const r = safeSpawnSyncStatus('git', ['show', `${ref}:${relPath}`], { cwd: ctx.root })
  return r.status === 0 ? r.stdout : null
}

/**
 * delivery ref에서 레코드를 읽는다(**유일한 읽기 정본** — DEC-3).
 * 손상은 조용히 넘기지 않는다(fail-closed).
 */
export function readRecord(ctx: Ctx, slug: string): DeliveryRecord {
  const branch = deliveryBranchName(slug)
  if (!refExists(ctx, branch)) throw new Error(`delivery 브랜치가 없습니다: ${branch} (먼저 \`delivery create ${slug}\`)`)
  const rel = deliveryRecordPath(ctx.ticketRoot, slug)
  const text = readAtRef(ctx, branch, rel)
  if (text === null) throw new Error(`delivery 레코드를 ${branch}:${rel} 에서 찾을 수 없습니다`)
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (e) {
    throw new Error(`delivery 레코드 파싱 실패(${branch}:${rel}): ${e instanceof Error ? e.message : String(e)}`)
  }
  const problems = deliveryRecordProblems(parsed)
  if (problems.length) throw new Error(`delivery 레코드 손상(${branch}:${rel}): ${problems.join('; ')}`)
  return parsed as DeliveryRecord
}

/** 워킹트리 clean 여부(추적·미추적 모두). */
export function worktreeClean(ctx: Ctx): boolean {
  return ctx.git.exec(['status', '--porcelain']).trim() === ''
}

/** 진행 중 merge/rebase가 없는가. */
export function noMergeInProgress(ctx: Ctx): boolean {
  for (const p of ['MERGE_HEAD', 'REBASE_HEAD', 'rebase-merge', 'rebase-apply'])
    if (existsSync(join(ctx.root, '.git', p))) return false
  return true
}

/**
 * 현재 위치를 잡아 두고 **되돌리는 함수**를 준다.
 *
 * 🔴 detached HEAD 를 브랜치 이름으로 다룰 수 없다(phase-3 r01 P1). `rev-parse --abbrev-ref HEAD` 는
 *    detached 에서 문자열 `"HEAD"` 를 주므로, 그것으로 복원을 건너뛰면 **사용자가 delivery 브랜치에 남는다**
 *    — 이후 작업이 통합 브랜치에서 이뤄지는 안전 문제다. detached 면 커밋 SHA 를 기억했다가
 *    `checkout --detach <sha>` 로 정확히 그 자리로 돌아간다.
 */
export function captureHead(ctx: Ctx): () => void {
  const sym = safeSpawnSyncStatus('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd: ctx.root })
  const branch = sym.status === 0 ? sym.stdout.trim() : ''
  if (branch) return () => void safeSpawnSyncStatus('git', ['checkout', branch], { cwd: ctx.root })
  const sha = safeSpawnSyncStatus('git', ['rev-parse', 'HEAD'], { cwd: ctx.root }).stdout.trim()
  if (!/^[0-9a-f]{40}$/.test(sha)) return () => {} // 커밋이 없는 저장소 등 — 돌아갈 자리가 없다.
  return () => void safeSpawnSyncStatus('git', ['checkout', '--detach', sha], { cwd: ctx.root })
}

/** 레코드를 현재 체크아웃된 브랜치에 쓰고 **그 경로만** 커밋한다. */
export function commitRecord(ctx: Ctx, slug: string, record: DeliveryRecord, message: string): void {
  const rel = deliveryRecordPath(ctx.ticketRoot, slug)
  const abs = join(ctx.root, rel)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, serializeDeliveryRecord(record), 'utf8')
  ctx.git.exec(['add', '--', rel])
  // REQ-2026-085 DEC-6: 호출부마다가 아니라 **여기 한 곳**에서 표식을 붙인다 — 새 호출부가 생겨도 누락되지 않는다.
  ctx.git.exec(['commit', '-m', bookkeepingMessage(message), '--', rel])
}

/**
 * `merge-base(delivery, feature) .. delivery HEAD` 에서 **레코드 파일이 아닌** 변경 경로들.
 * 빈 배열이면 "분기 이후 delivery에서 코드가 움직이지 않았다" = 병합이 코드 충돌을 낼 수 없다(design r03).
 */
export function deliveryNonRecordChanges(ctx: Ctx, slug: string, deliveryHead: string, featureRef: string): string[] {
  const mb = safeSpawnSyncStatus('git', ['merge-base', deliveryHead, featureRef], { cwd: ctx.root })
  if (mb.status !== 0) return ['(merge-base 계산 실패 — 공통 조상이 없습니다)']
  const base = mb.stdout.trim()
  const r = safeSpawnSyncStatus('git', ['diff', '--name-only', `${base}..${deliveryHead}`], { cwd: ctx.root })
  if (r.status !== 0) return ['(delivery 변경 목록 조회 실패)']
  const recordRel = deliveryRecordPath(ctx.ticketRoot, slug)
  return r.stdout
    .split('\n')
    .map((x) => x.trim())
    .filter((x) => x !== '' && x !== recordRel)
}

// ─────────────────────────────────────────── 통합 자격 (DEC-2b) ──

export interface EligibilityFacts {
  /** feature ref에 그 REQ의 `dev-complete` close-proof가 커밋돼 있는가. */
  hasDevComplete: boolean
  /** 증거 파일 자체를 읽을 수 있었는가. */
  evidenceReadable: boolean
  /**
   * 🔴 **승인 매니페스트(`approvals.jsonl`) 검증 결과**(phase-2 r03 P1-a). 비어 있지 않으면 손상·부재다.
   * `dev-complete` 행의 존재만 보면 **손으로 써 넣은 행 하나로 미검수 코드가 통합된다**.
   */
  manifestProblems: string[]
  /** 🔴 `dev-complete` 행의 `design_ref`가 매니페스트의 **실제 design 승인 해시**와 일치하는가. */
  designRefMatches: boolean
  /** 🔴 `dev-complete` 행의 `phase_inventory`가 매니페스트가 증거를 가진 phase 집합과 일치하는가. */
  phaseInventoryMatches: boolean
  /**
   * 증거 커밋 **자신을 포함해** 티켓 밖 경로를 건드린 커밋 목록(phase-2 r03 P1-b).
   * 증거 커밋을 제외하면 미검수 소스를 **같은 커밋에 끼워 넣거나 amend**해서 검사를 통째로 우회한다.
   */
  postEvidenceCodeCommits: string[]
  /**
   * 🔴 **증거 무결성**(phase-2 r04 P1-c). manifest가 가리키는 응답 파일이 그 ref에 실제로 있고
   * 기록된 SHA-256과 일치하는가. 구조만 보면 **구조적으로 유효한 가짜 manifest**가 통과한다.
   */
  integrityProblems: string[]
  /**
   * 🔴 **HIGH 확인**(REQ-2026-071 DEC-4). `stopGate:'merge'`에서 HIGH REQ 의 사람 확인은 phase 커밋이
   * 아니라 **여기**서 요구된다 — 그것이 그 값이 정한 정지 지점이다.
   *
   * 🔴 `scope`는 **정확히 `delivery`**여야 한다. 좁은 확인(`phase`·`req`)은 묶음을 덮지 않는다 —
   *    범위는 크기 순서가 아니라 "무엇을 승인했는가"에 대한 진술이다.
   */
  highConfirmProblem: string | null
  /**
   * 🔴 **provenance**(phase-2 r04 P1-d). phase 승인 행의 `approved_tree`가 feature 이력에 실제로 존재하는가.
   * 없으면 승인 이후 **history rewrite**(amend/rebase)로 코드가 바뀐 것이다 — 증거 이후 커밋만 보는
   * 검사로는 잡히지 않는다(증거 커밋은 그대로 두고 그 **앞**을 고치면 되기 때문).
   */
  unknownApprovedTrees: string[]
}

/**
 * 🔴 **보증 범위**(저장소 전반의 원칙과 같다 — 협력적 worker · 단일 활성 워크트리).
 *
 * 여기 검증은 **실수와 절차 이탈**을 막는다: 승인 뒤 커밋, checkout 이탈, amend/rebase,
 * 증거 파일 손상, 완료 선언과 실제 승인의 불일치, close-proof 재작성으로 기준점 밀기.
 * 실측(이 저장소 REQ-2026-060·061·062·063·064·065 6건)에서 정상 완료분은 전부 통과했고,
 * 같은 증거로 HEAD를 feature ref로 준 경우는 전부 차단됐다.
 *
 * 막지 **못하는** 것: 커밋된 증거 자체를 일관되게 위조하는 행위. `approvals.jsonl`은 feature
 * 브랜치의 파일이고 `approved_tree` 값은 리뷰어 응답 본문에 서명으로 묶여 있지 않으므로,
 * 티켓 경로만 고치는 커밋으로 기준점을 옮길 수 있다. 이를 막으려면 리뷰어 측 서명이나
 * 저장소 밖 신뢰 저장소가 필요하다 — 현재 설계의 범위 밖이다. **절대적 보증을 주장하지 않는다.**
 */
export function integrateEligibilityProblems(f: EligibilityFacts): string[] {
  const p: string[] = []
  if (!f.evidenceReadable) {
    p.push('feature 브랜치에서 close-proof 증거를 읽을 수 없습니다')
    return p
  }
  if (!f.hasDevComplete) {
    p.push('REQ가 완료(dev-complete)로 종결되지 않았습니다 — 모든 phase 승인·증거 확정 후에만 통합할 수 있습니다')
    return p
  }
  // 🔴 여기부터가 "행 하나 써 넣기"를 막는 실질 검증이다.
  if (f.manifestProblems.length)
    p.push(`승인 증거(approvals.jsonl) 검증 실패: ${f.manifestProblems.slice(0, 3).join('; ')}`)
  if (!f.designRefMatches)
    p.push('완료 증거의 design_ref가 실제 design 승인과 일치하지 않습니다 — 위조되었거나 재승인 이후의 낡은 증거입니다')
  if (!f.phaseInventoryMatches)
    p.push('완료 증거의 phase 목록이 실제 승인된 phase 증거와 일치하지 않습니다')
  if (f.integrityProblems.length)
    p.push(`승인 증거 무결성 검증 실패: ${f.integrityProblems.slice(0, 3).join('; ')}`)
  if (f.unknownApprovedTrees.length)
    p.push(
      `승인된 트리가 feature 이력에 없습니다(${f.unknownApprovedTrees.map((x) => x.slice(0, 8)).join(', ')}) — ` +
        '승인 이후 이력이 다시 쓰인 것으로 보입니다(amend/rebase). 재리뷰가 필요합니다',
    )
  if (f.highConfirmProblem)
    p.push(`HIGH 위험 REQ 의 사람 확인이 없습니다: ${f.highConfirmProblem}`)
  if (f.postEvidenceCodeCommits.length) {
    const shown = f.postEvidenceCodeCommits.slice(0, 5).join(', ')
    const more = f.postEvidenceCodeCommits.length - 5
    p.push(
      `승인 이후 티켓 밖 변경이 커밋됐습니다(미검수 코드 ${f.postEvidenceCodeCommits.length}건): ` +
        `${shown}${more > 0 ? ` 외 ${more}건` : ''} — 리뷰를 마친 뒤 다시 시도하세요`,
    )
  }
  return p
}

/** feature ref에서 통합 자격 사실을 수집한다. */

/** 목록 비교용 구분자(US). 파일에 원시 제어문자를 넣지 않기 위해 fromCharCode 로 만든다. */
const UNIT_SEP = String.fromCharCode(31)

export function collectEligibility(ctx: Ctx, featureRef: string, reqId: string): EligibilityFacts {
  const ticketRel = `${ctx.ticketRoot}/${reqId}`
  const cpRel = closeProofPath(ticketRel)
  const empty: EligibilityFacts = {
    hasDevComplete: false,
    evidenceReadable: false,
    manifestProblems: [],
    designRefMatches: false,
    phaseInventoryMatches: false,
    postEvidenceCodeCommits: [],
    integrityProblems: [],
    unknownApprovedTrees: [],
    highConfirmProblem: null,
  }
  const text = readAtRef(ctx, featureRef, cpRel)
  if (text === null) return empty
  const parsed = parseCloseProof(text)
  const row = parsed.rows.find((r) => r.ticket_id === reqId && r.event === 'dev-complete')
  if (!row) return { ...empty, evidenceReadable: true }

  // 🔴 승인 매니페스트를 **실제로** 검증한다(r03 P1-a). close-proof 행은 스스로를 증명하지 못한다.
  const manifestRel = `${ticketRel}/responses/approvals.jsonl`
  const manifestText = readAtRef(ctx, featureRef, manifestRel)
  const inventory = row.phase_inventory ?? []
  const manifestProblems =
    manifestText === null
      ? [`승인 매니페스트가 없습니다: ${manifestRel}`]
      : validateManifest(manifestText, { ticketRel, validPhaseIds: inventory })
  const designRef = manifestText === null ? null : designHashFromManifest(manifestText)
  const designRefMatches = designRef !== null && designRef === row.design_ref
  const evidenced = manifestText === null ? [] : evidencedPhaseIdsFromManifest(manifestText, row.design_ref)
  const phaseInventoryMatches =
    // 🔴 구분자는 String.fromCharCode 로 만든다 — 소스에 원시 제어문자가 박히면 git이 파일을 binary 로 취급해
    // grep·diff·리뷰가 전부 깨진다(review-ledger.ts 의 KEY_SEP 과 같은 교훈).
    [...evidenced].sort().join(UNIT_SEP) === [...inventory].sort().join(UNIT_SEP)

  // 🔴 정본 검증기로 무결성을 본다(r04 P1-c) — manifest가 가리키는 응답 파일이 실제로 있고 SHA가 맞는가.
  const integrityProblems =
    manifestText === null
      ? ['승인 매니페스트가 없어 무결성을 검증할 수 없습니다']
      : verifyCommittedEvidenceIntegrity({ ticketRel, manifestText, ports: createEvidencePorts(ctx.root, `${ticketRel}/responses`, featureRef) })
          .problems

  /**
   * feature 이력을 **커밋↔트리 쌍**으로 읽는다(newest first). 승인 트리를 이력 위에 앉히는 데 쓴다.
   * `rev-list --format=%T`는 `commit <sha>` / `<tree>` 두 줄을 번갈아 낸다.
   */
  const history: Array<{ commit: string; tree: string }> = []
  {
    const out = safeSpawnSyncStatus('git', ['rev-list', '--format=%T', featureRef], { cwd: ctx.root }).stdout || ''
    const lines = out.split('\n').map((x) => x.trim()).filter(Boolean)
    for (let i = 0; i + 1 < lines.length; i += 2) {
      const c = /^commit ([0-9a-f]{40})$/.exec(lines[i]!)
      const t = lines[i + 1]!
      if (c && /^[0-9a-f]{40}$/.test(t)) history.push({ commit: c[1]!, tree: t })
    }
  }
  const treeToCommit = new Map(history.map((h) => [h.tree, h.commit]))

  // 🔴 provenance(r04 P1-d): 승인된 트리가 feature 이력에 실재하는가. 승인 이후 amend/rebase로 코드를
  //    바꾸면 증거 이후 커밋 검사는 비어 있지만 승인 당시 트리는 이력에서 사라진다.
  const unknownApprovedTrees: string[] = []
  const approvedIdx: number[] = []
  if (manifestText !== null) {
    for (const e of parseManifestEntries(manifestText)) {
      const t = e.approved_tree
      if (typeof t !== 'string' || !t) continue
      const c = treeToCommit.get(t)
      if (c === undefined) unknownApprovedTrees.push(t)
      else approvedIdx.push(history.findIndex((h) => h.commit === c))
    }
  }

  /**
   * 🔴 미검수 코드 탐지의 기준점은 **가장 최근 승인 트리의 커밋**이다(r06 P1).
   *
   * close-proof 파일의 마지막 수정 커밋을 기준으로 삼으면, 승인 뒤에 코드를 커밋하고 그 다음
   * close-proof를 의미 동일하게 재포맷하는 ticket-only 커밋 하나로 기준점이 앞으로 밀려
   * 미검수 코드가 검사 범위 밖으로 빠진다. 승인 트리는 리뷰어가 실제로 본 트리이므로 밀 수 없다.
   */
  const post: string[] = []
  if (approvedIdx.length === 0) {
    // 승인 트리가 하나도 없으면 "어디까지가 검수된 코드인가"를 정할 근거가 없다 — fail-closed.
    integrityProblems.push('승인 트리가 없어 미검수 코드 범위를 판정할 수 없습니다')
  } else {
    const baseline = history[Math.min(...approvedIdx)]!.commit
    const r = safeSpawnSyncStatus(
      'git',
      [
        'rev-list',
        `${baseline}..${featureRef}`,
        '--',
        ':(exclude)' + ticketRel + '/*',
        // delivery 레코드는 코드가 아니라 감사 기록이고, 판정 정본은 delivery ref다(DEC-3).
        // feature 쪽 사본까지 "미검수 코드"로 세면 사용자가 delivery를 feature에 merge한 순간 오탐이 난다.
        ':(exclude)' + ctx.ticketRoot + '/delivery/*',
      ],
      { cwd: ctx.root },
    )
    if (r.status === 0)
      post.push(
        ...r.stdout
          .split('\n')
          .map((x) => x.trim())
          .filter(Boolean)
          .map((x) => x.slice(0, 8)),
      )
  }

  /**
   * 🔴 HIGH 확인(REQ-2026-071 DEC-4). `feature ref 의 커밋된 state.json`을 본다 — 워킹트리가 아니다.
   *    다른 자격 검사와 같은 근거(HEAD-committed 증거)를 써야 한다.
   */
  const highConfirmProblem = (() => {
    /**
     * 🔴 **`merge`일 때만 요구한다**(phase-3 r01 P1). 다른 값에서는 확인이 **이미 다른 지점에서** 끝났다:
     *    `phase`는 매 커밋에서 받고 소비되며(그래서 여기 도달 시 값이 `null`이다), `req`는 REQ를
     *    완성시키는 커밋에서 받고 소비된다. 그때도 여기서 요구하면 **정상 종결한 HIGH REQ가 영구 거부**된다.
     *    stopGate가 정한 정지 지점은 하나여야 한다는 것이 이 REQ의 요구사항이다.
     */
    /**
     * 🔴 REQ-2026-129: 정지 정책은 **티켓 스냅샷**이 정본이다. config 만 보면 티켓 생성 이후 설정이 바뀐
     *    경우 이 자격검사와 `req:commit`·`req:next` 가 서로 다른 정책으로 판정한다.
     *    state 를 먼저 읽되, **읽기 실패의 오류화는 config 가 `merge` 일 때만** 한다 — 그러지 않으면
     *    delivery 를 쓰지 않는 구성에서 없던 실패가 생긴다(현행 동작 보존).
     */
    const stateText = readAtRef(ctx, featureRef, `${ticketRel}/state.json`)
    if (stateText === null) return ctx.stopGate === 'merge' ? 'feature ref 에 state.json 이 없습니다' : null
    let st: { risk_level?: unknown; user_commit_confirmed?: unknown; policy_snapshot?: unknown }
    try {
      st = JSON.parse(stateText) as typeof st
    } catch {
      return ctx.stopGate === 'merge' ? 'state.json 파싱 실패' : null
    }
    if (effectiveStopGate(st, { stopGate: ctx.stopGate }) !== 'merge') return null
    if (st.risk_level !== 'HIGH') return null // HIGH 가 아니면 요구하지 않는다
    const problem = userConfirmProblem(st.user_commit_confirmed)
    if (problem) return `${problem} — npx commitgate req:confirm ${reqId} --scope delivery --method "<승인 문장>" --run`
    const scope = effectiveConfirmScope(st.user_commit_confirmed as UserCommitConfirmed | null)
    /**
     * 🔴 요구 scope 는 SSOT 함수에서 나온다(REQ-2026-128 DEC-6). 여기는 **묶음 안**이므로
     *    `inDeliverySet: true` 가 사실이고, 결과는 현행과 같은 `'delivery'` 다 — 동작 불변이며
     *    바뀌는 것은 "문자열을 손으로 적지 않는다"는 점뿐이다.
     */
    const required = requiredConfirmScope('merge', { inDeliverySet: true })
    if (scope !== required)
      return `scope="${scope}" 는 묶음을 덮지 않습니다(scope="${required}" 필요) — 범위는 크기 순서가 아니라 무엇을 승인했는지에 대한 진술입니다`
    return null
  })()

  return {
    hasDevComplete: true,
    evidenceReadable: true,
    manifestProblems,
    designRefMatches,
    phaseInventoryMatches,
    postEvidenceCodeCommits: post,
    integrityProblems,
    unknownApprovedTrees,
    highConfirmProblem,
  }
}

// ──────────────────────────────────────────────────── 하위 명령 ──

export interface Io {
  log: (m: string) => void
  now: () => string
}

const defaultIo: Io = { log: (m) => console.log(m), now: () => new Date().toISOString() }

/** 묶음의 대상 브랜치. 현재는 `main` 고정(v1 — 여러 대상은 비목표). */
/**
 * `merge-base(delivery, feature) .. feature` 에서 **delivery 레코드 파일**을 건드린 경로들.
 * 비어 있지 않으면 양쪽이 같은 파일을 다르게 고친 것이라 병합이 그 파일에서 충돌한다(design r07 P1).
 */
export function featureChangedRecordPaths(ctx: Ctx, slug: string, deliveryHead: string, featureRef: string): string[] {
  const mb = safeSpawnSyncStatus('git', ['merge-base', deliveryHead, featureRef], { cwd: ctx.root })
  if (mb.status !== 0) return ['(merge-base 계산 실패 — 공통 조상이 없습니다)']
  const recordRel = deliveryRecordPath(ctx.ticketRoot, slug)
  const r = safeSpawnSyncStatus(
    'git',
    ['diff', '--name-only', `${mb.stdout.trim()}..${featureRef}`, '--', recordRel],
    { cwd: ctx.root },
  )
  if (r.status !== 0) return ['(feature 변경 목록 조회 실패)']
  return r.stdout.split('\n').map((x) => x.trim()).filter(Boolean)
}

export const DEFAULT_TARGET_BRANCH = 'main'

/**
 * 묶음을 만든다.
 *
 * 🔴 **base는 반드시 target 브랜치다**(phase-2 r01 P1). 현재 HEAD에서 만들면, 미승인 커밋이 있는 feature
 *    브랜치에서 실행했을 때 **그 커밋이 delivery의 조상**이 된다. 이후 member들은 그 HEAD에서 분기하므로
 *    그 변경은 **active member도 통합 자격 검증도 거치지 않은 채** 묶음에 포함되고, 결국 target으로 간다.
 *    "위치 비의존"(DEC-7)은 편의가 아니라 이 우회를 막는 안전 조건이다.
 */
export function cmdCreate(ctx: Ctx, slug: string, io: Io = defaultIo, target = DEFAULT_TARGET_BRANCH): void {
  validateSlug(slug)
  const branch = deliveryBranchName(slug)
  if (refExists(ctx, branch)) throw new Error(`이미 존재합니다: ${branch}`)
  if (!refExists(ctx, target))
    throw new Error(`대상 브랜치가 없습니다: ${target} — 묶음은 대상 브랜치에서만 만들 수 있습니다.`)
  if (!worktreeClean(ctx)) throw new Error('워킹트리가 clean 해야 합니다 — 변경을 커밋하거나 치운 뒤 다시 시도하세요.')
  if (!noMergeInProgress(ctx)) throw new Error('진행 중인 merge/rebase가 있습니다.')

  const before = ctx.git.exec(['rev-parse', '--abbrev-ref', 'HEAD'])
  // 🔴 현재 HEAD가 아니라 **target에서** 분기한다. 어느 브랜치에서 실행하든 결과가 같다.
  ctx.git.exec(['checkout', '-b', branch, target])
  const record = newDeliveryRecord({ slug, branch, targetBranch: target, at: io.now() })
  commitRecord(ctx, slug, record, `chore(delivery): create ${slug}`)
  io.log(`[delivery] 생성: ${branch} (base=${target} · 이전 브랜치: ${before})`)
  io.log(`  레코드: ${deliveryRecordPath(ctx.ticketRoot, slug)}`)
  io.log(`  다음: commitgate delivery begin <req-slug> --slug ${slug} --run`)
}

export function cmdStatus(ctx: Ctx, slug: string, io: Io = defaultIo): void {
  const r = readRecord(ctx, slug)
  const gate = deliveryGateVerdict(r)
  io.log(`[delivery] ${r.slug} — state=${r.state} · members=${r.members.length} · ${r.branch} → ${r.target_branch}`)
  for (const m of r.members)
    io.log(`  #${m.order} ${m.req_id} [${m.status}]${m.successor_of ? ` (successor-of ${m.successor_of})` : ''}`)
  io.log(`  gate: ${gate.kind} — ${gate.detail}`)
}

export function cmdBegin(ctx: Ctx, slug: string, reqSlug: string, io: Io = defaultIo): DeliveryRecord {
  const branch = deliveryBranchName(slug)
  const record = readRecord(ctx, slug)
  // 🔴 열린 묶음 + 활성 member 없음(DEC-2c) — 둘을 함께 본다.
  const v = canBegin(record)
  if (!v.ok) throw new Error(`[delivery begin] ${v.reason}`)
  if (!worktreeClean(ctx)) throw new Error('워킹트리가 clean 해야 합니다.')
  if (!noMergeInProgress(ctx)) throw new Error('진행 중인 merge/rebase가 있습니다.')

  // ① 위치 비의존: 도구가 delivery로 이동한다(DEC-7).
  ctx.git.exec(['checkout', branch])
  const baseSha = ctx.git.exec(['rev-parse', 'HEAD'])

  // ② req:new 위임 — feature가 **delivery HEAD에서** 갈라진다.
  reqNewMain([reqSlug, '--run', '--root', ctx.root])
  const featureBranch = ctx.git.exec(['rev-parse', '--abbrev-ref', 'HEAD'])
  const reqId = reqIdFromBranch(featureBranch)
  if (!reqId) throw new Error(`feature 브랜치에서 REQ id를 읽을 수 없습니다: ${featureBranch}`)

  // ③ delivery로 돌아와 **그때 확정된 REQ id**로 member를 등록·커밋한다.
  //    🔴 이 커밋이 delivery를 한 걸음 전진시키지만 변경은 **레코드 파일뿐**이므로 integrate의
  //       무충돌 조건(design r03)을 그대로 만족한다. ancestry 조건에서는 이 순서가 불가능했다.
  //    🔴 여기부터 실패하면 REQ는 이미 만들어졌는데 묶음에는 없는 **부분 상태**다. 조용히 던지면
  //       사용자가 `begin`을 다시 불러 REQ가 하나 더 생기고 앞의 것은 고아가 된다. 복구 지시를 붙인다.
  ctx.git.exec(['checkout', branch])
  const updated: DeliveryRecord = {
    ...record,
    members: [
      ...record.members,
      {
        req_id: reqId,
        order: nextOrder(record),
        delivery_base_sha: baseSha,
        status: 'active' as const,
        successor_of: null,
        // 🔴 integrate 는 현재 checkout 위치가 아니라 이 값을 쓴다(DEC-7 · phase-2 r05 P1).
        feature_ref: featureBranch,
        integrated_at: null,
        superseded_evidence: null,
      },
    ],
  }
  try {
    commitRecord(ctx, slug, updated, `chore(delivery): begin ${reqId} in ${slug}`)
  } catch (err) {
    throw new Error(
      `[delivery begin] ${reqId}는 이미 만들어졌지만 ${slug} 묶음에 등록하지 못했습니다: ` +
        `${err instanceof Error ? err.message : String(err)}\n` +
        `  🔴 \`delivery begin\`을 다시 실행하지 마세요 — REQ가 하나 더 생기고 ${reqId}가 고아가 됩니다.\n` +
        `  원인을 해소한 뒤 ${deliveryBranchName(slug)}의 레코드에 ${reqId}(feature_ref=${featureBranch})를 등록하세요.`,
    )
  }

  // ④ feature로 복귀 — 사용자는 바로 작업을 이어간다.
  ctx.git.exec(['checkout', featureBranch])
  io.log(`[delivery] ${reqId} 등록 · feature=${featureBranch} (base=${baseSha.slice(0, 8)})`)
  io.log(`  다음: 이 브랜치에서 작업·리뷰를 마친 뒤 \`commitgate delivery integrate --slug ${slug} --run\``)
  return updated
}

/** `feat/req-2026-067-slug` → `REQ-2026-067`. 규칙은 `req-new.ts`의 `branchName()`과 짝을 이룬다. */
export function reqIdFromBranch(branch: string): string | null {
  const m = /(\d{4})-(\d{3,})/.exec(branch)
  return m ? `REQ-${m[1]}-${m[2]}` : null
}

export interface IntegrateResult {
  merged: boolean
  gate: ReturnType<typeof deliveryGateVerdict>
}

export function cmdIntegrate(ctx: Ctx, slug: string, reqId: string, io: Io = defaultIo): IntegrateResult {
  const branch = deliveryBranchName(slug)
  const record = readRecord(ctx, slug)
  const member = record.members.find((m) => m.req_id === reqId && m.status === 'active')
  if (!member) throw new Error(`활성 member가 아닙니다: ${reqId}`)
  // 🔴 feature ref 는 **레코드에서** 온다 — 현재 checkout 위치를 쓰면 사용자가 다른 브랜치로 이탈했을 때
  //    엉뚱한 ref 를 검증·병합한다(phase-2 r05 P1). 값이 없으면 판단 근거가 없으므로 fail-closed.
  const featureRef = member.feature_ref
  if (!featureRef) throw new Error(`member에 feature_ref가 없습니다: ${reqId} — 'delivery begin'으로 만든 묶음이어야 합니다.`)
  if (safeSpawnSyncStatus('git', ['rev-parse', '--verify', '--quiet', `${featureRef}^{commit}`], { cwd: ctx.root }).status !== 0)
    throw new Error(`feature 브랜치가 없습니다: ${featureRef}`)

  // 🔴 ① 통합 자격이 **가장 먼저**다(DEC-2b). 위상이 맞아도 내용이 미검수면 반영하면 안 된다.
  const elig = integrateEligibilityProblems(collectEligibility(ctx, featureRef, reqId))
  if (elig.length) throw new Error(`[delivery integrate] 통합 자격 미충족(변경 0건):\n  - ${elig.join('\n  - ')}`)

  // 🔴 ②-0 clean·merge 가드는 **이동 前**이다. dirty 상태로 checkout하면 변경이 delivery로 따라오고,
  //    ③의 merge 커밋은 (merge라서) 인덱스 전체를 담으므로 무관한 변경이 통합 커밋에 섞인다.
  //    이동 후에 확인하면 이미 늦다.
  if (!worktreeClean(ctx)) throw new Error('[delivery integrate] 워킹트리가 clean 해야 합니다(변경 0건).')
  if (!noMergeInProgress(ctx)) throw new Error('[delivery integrate] 진행 중인 merge/rebase가 있습니다(변경 0건).')

  // ② 위상 전제(DEC-2). 🔴 실패해도 사용자를 원래 자리로 되돌린다 — 도구가 위치를 옮겨 놓고 끝내지 않는다.
  const restore = captureHead(ctx)
  ctx.git.exec(['checkout', branch])
  const deliveryHead = ctx.git.exec(['rev-parse', 'HEAD'])
  // 🔴 무충돌 보장(design r03): 분기 이후 delivery에서 움직인 것이 **레코드 파일뿐**인가.
  //    ancestry가 아니라 이것을 본다 — ancestry는 membership을 delivery에 기록하는 것과 양립 불가였다.
  const nonRecord = deliveryNonRecordChanges(ctx, slug, deliveryHead, featureRef)
  // 🔴 feature 쪽이 같은 레코드 파일을 바꿨는지도 본다(design r07 P1) — 한쪽만 보면 무충돌이 아니다.
  const featureRecord = featureChangedRecordPaths(ctx, slug, deliveryHead, featureRef)
  // base는 **동일성이 아니라 이력 선상**을 본다(design r02).
  const baseAnc = safeSpawnSyncStatus(
    'git',
    ['merge-base', '--is-ancestor', member.delivery_base_sha, deliveryHead],
    { cwd: ctx.root },
  )
  const topo = integrateTopologyProblems({
    memberBaseSha: member.delivery_base_sha,
    deliveryHeadSha: deliveryHead,
    deliveryDivergedOnlyByRecord: nonRecord.length === 0,
    deliveryNonRecordPaths: nonRecord,
    featureChangedRecordPaths: featureRecord,
    baseIsAncestorOfDeliveryHead: baseAnc.status === 0,
    worktreeClean: worktreeClean(ctx),
    noMergeInProgress: noMergeInProgress(ctx),
  })
  if (topo.length) {
    restore()
    throw new Error(`[delivery integrate] 위상 전제 미충족(변경 0건):\n  - ${topo.join('\n  - ')}`)
  }

  // ③ 단일 merge commit — feature 반영과 레코드 갱신을 **같은 커밋**에 담는다(실측 확인).
  const m = safeSpawnSyncStatus('git', ['merge', '--no-ff', '--no-commit', featureRef], { cwd: ctx.root })
  if (m.status !== 0) {
    safeSpawnSyncStatus('git', ['merge', '--abort'], { cwd: ctx.root })
    restore()
    throw new Error(`[delivery integrate] 병합 실패(원상 복구함): ${m.stderr.trim() || m.stdout.trim()}`)
  }
  try {
    const updated: DeliveryRecord = {
      ...record,
      members: record.members.map((x) =>
        x.req_id === reqId ? { ...x, status: 'integrated' as const, integrated_at: io.now() } : x,
      ),
    }
    const rel = deliveryRecordPath(ctx.ticketRoot, slug)
    const abs = join(ctx.root, rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, serializeDeliveryRecord(updated), 'utf8')
    ctx.git.exec(['add', '--', rel])
    // 🔴 여기만 pathspec 없이 커밋한다 — merge 커밋은 인덱스 전체(= 병합 결과)를 담아야 하기 때문이다.
    //    무관한 변경이 섞이지 않는 근거는 ②-0의 clean 가드다(그 뒤로 인덱스를 건드리는 것은 merge와 레코드뿐).
    ctx.git.exec(['commit', '-m', bookkeepingMessage(`chore(delivery): integrate ${reqId} into ${slug}`)])
    io.log(`[delivery] ${reqId} 반영 완료 → ${branch}`)
    const gate = deliveryGateVerdict(updated)
    // 🔴 전이를 만든 명령이 게이트를 낸다(DEC-8a) — req:next만 판정하면 영영 안 나온다.
    io.log(`  gate: ${gate.kind} — ${gate.detail}`)
    // 성공해도 사용자를 원래 자리로 되돌린다 — 도구의 이동은 수단이지 결과가 아니다(DEC-7).
    restore()
    return { merged: true, gate }
  } catch (err) {
    safeSpawnSyncStatus('git', ['merge', '--abort'], { cwd: ctx.root })
    restore()
    throw err
  }
}

// ──────────────────────────────────── seal · approve · reopen (DEC-8) ──

/**
 * 확인 문구는 **묶음마다 다르게** 만든다 — 복사-붙여넣기 습관으로 다른 묶음을 닫는 사고를 막는다.
 * 형식은 사람이 읽고 그대로 타이핑할 수 있어야 하므로 짧게 둔다.
 */
export function confirmSentence(action: 'seal' | 'approve' | 'reopen', slug: string): string {
  return `${action} ${slug}`
}

/** 확인 문구 검증(순수). 앞뒤 공백만 허용한다 — 문구 자체가 통제점이므로 느슨하게 받지 않는다. */
export function checkConfirm(action: 'seal' | 'approve' | 'reopen', slug: string, given: string | null): void {
  const want = confirmSentence(action, slug)
  if ((given ?? '').trim() !== want)
    throw new Error(`확인 문구가 필요합니다 — \`--confirm "${want}"\` (받음: ${given === null ? '(없음)' : `"${given}"`})`)
}

/**
 * 상태 전이 + 이벤트를 **같은 커밋**에 담는다.
 * 🔴 이벤트는 append-only다 — 상태만 갱신하면 "승인이 있었다가 무효화됐다"는 사실이 사라진다(DEC-8).
 * 🔴 시각은 **실제 시계**에서 읽는다(REQ-2026-019 폐기 사유).
 */
function commitTransition(
  ctx: Ctx,
  slug: string,
  record: DeliveryRecord,
  state: DeliveryRecord['state'],
  event: DeliveryEvent['event'],
  confirmation: string,
  io: Io,
): DeliveryRecord {
  const updated: DeliveryRecord = {
    ...record,
    state,
    events: [...record.events, { event, at: io.now(), confirmation }],
  }
  const branch = deliveryBranchName(slug)
  if (!worktreeClean(ctx)) throw new Error(`[delivery ${event}] 워킹트리가 clean 해야 합니다(변경 0건).`)
  if (!noMergeInProgress(ctx)) throw new Error(`[delivery ${event}] 진행 중인 merge/rebase가 있습니다(변경 0건).`)
  const restore = captureHead(ctx)
  ctx.git.exec(['checkout', branch])
  try {
    commitRecord(ctx, slug, updated, `chore(delivery): ${event} ${slug}`)
  } finally {
    // 성공·실패 모두 사용자를 원래 자리로 되돌린다(DEC-7) — detached HEAD 포함.
    restore()
  }
  return updated
}

export function cmdSeal(ctx: Ctx, slug: string, confirm: string | null, io: Io = defaultIo): DeliveryRecord {
  const record = readRecord(ctx, slug)
  if (record.state !== 'open') throw new Error(`[delivery seal] 이미 닫힌 묶음입니다(state=${record.state}).`)
  if (record.members.length === 0) throw new Error('[delivery seal] member가 없는 묶음은 닫지 않습니다 — 닫을 내용이 없습니다.')
  checkConfirm('seal', slug, confirm)
  const updated = commitTransition(ctx, slug, record, 'sealed', 'sealed', confirmSentence('seal', slug), io)
  io.log(`[delivery] '${slug}' 묶음을 닫았습니다(더 이상 begin 할 수 없습니다).`)
  // 🔴 전이를 만든 명령이 게이트를 낸다(DEC-8a). seal이 마지막 전이인 경우 여기가 유일한 발생지다.
  const gate = deliveryGateVerdict(updated)
  io.log(`  gate: ${gate.kind} — ${gate.detail}`)
  return updated
}

export function cmdApprove(ctx: Ctx, slug: string, confirm: string | null, io: Io = defaultIo): DeliveryRecord {
  const record = readRecord(ctx, slug)
  // 🔴 `sealed` && 모든 member terminal 일 때만(DEC-8). 판정은 순수 모델을 공유한다.
  const v = canApprove(record)
  if (!v.ok) throw new Error(`[delivery approve] ${v.reason}`)
  checkConfirm('approve', slug, confirm)
  const updated = commitTransition(ctx, slug, record, 'approved', 'approved', confirmSentence('approve', slug), io)
  io.log(`[delivery] '${slug}' 통합 승인을 기록했습니다.`)
  // 🔴 병합은 하지 않는다(DEC-11) — 실행은 사람이 I1/I2/B1 절차로 한다.
  io.log(`  🔴 이 명령은 병합하지 않습니다. ${updated.branch} → ${updated.target_branch} 는 AGENTS.md 통제점표(I1/I2/B1)를 따르세요.`)
  return updated
}

export function cmdReopen(ctx: Ctx, slug: string, confirm: string | null, io: Io = defaultIo): DeliveryRecord {
  const record = readRecord(ctx, slug)
  if (record.state === 'open') throw new Error('[delivery reopen] 이미 열려 있습니다.')
  checkConfirm('reopen', slug, confirm)
  const updated = commitTransition(ctx, slug, record, 'open', 'reopened', confirmSentence('reopen', slug), io)
  io.log(`[delivery] '${slug}' 묶음을 다시 열었습니다 — 이전 승인은 무효이며 이력에 남습니다.`)
  return updated
}

export function printHelp(): void {
  console.log(`commitgate delivery — 상위 작업 묶음(delivery set)

여러 REQ를 하나의 묶음으로 묶어, 묶음이 끝날 때까지 main 병합을 미루고 마지막에 한 번만 멈춥니다.
🔴 전역 백로그가 아닙니다 — 묶음을 만들고 닫는 것은 **사용자**입니다.

사용법:
  npx commitgate delivery create <slug> [--run]
  npx commitgate delivery begin <req-slug> --slug <slug> [--run]
  npx commitgate delivery integrate --slug <slug> [--run]
  npx commitgate delivery seal --slug <slug> --confirm "seal <slug>" [--run]
  npx commitgate delivery approve --slug <slug> --confirm "approve <slug>" [--run]
  npx commitgate delivery reopen --slug <slug> --confirm "reopen <slug>" [--run]
  npx commitgate delivery status --slug <slug>

흐름:
  create → begin(REQ 1) → 작업·리뷰 → integrate → begin(REQ 2) → … → seal → approve
  seal 이후에는 begin 할 수 없습니다. 되돌리려면 reopen(이력에 남습니다).

req.config.json 의 stopGate: "merge" 를 함께 쓰면 req:next 종단도 묶음 단위로 판정합니다.

하지 않는 일:
  delivery → main 병합 실행(기존 I1/I2/B1 통제점에서 사람이 합니다) ·
  자동 rebase·충돌 해결(재검수 없는 코드 유입 방지) ·
  미승인 REQ의 통합(--force 류 우회 없음).
`)
}

/**
 * 🔴 이 `runCli`는 `lib/cli-boundary`의 `makeRunCli`를 **일부러 쓰지 않는다**(REQ-2026-105 DEC-4).
 *    `bin/check.ts`와 같은 이유다 — `HelpRequested`를 잡아 도움말을 찍고 **정상 종료**하므로 공용
 *    경계의 "예외 → 한 줄 + exit 1" 계약과 의미가 다르다. 누락이 아니라 결정이다.
 *    (`isEntrypoint`는 별개 관심사라 아래에서 공유한다.)
 */
export function runCli(argv: string[]): void {
  try {
    const o = parseArgs(argv)
    // 🔴 상태를 바꾸는 하위 명령은 setup 완료 게이트를 지난다(REQ-2026-062 DEC-6) — `status`는 읽기 전용이라 뺀다.
    //    `begin`은 `req:new` 위임으로 전이적으로 막히지만, `create`/`integrate`/`seal`/`approve`/`reopen`은
    //    그 경로를 타지 않아 여기서 막지 않으면 설정 없이 묶음을 만들고 통합할 수 있다.
    if (o.sub !== 'status') assertSetupComplete({ root: o.root })
    const ctx = makeCtx(o.root)
    if (o.sub === 'create') {
      if (!o.slug) throw new Error('slug 필요 (예: delivery create payment-improvement --run)')
      if (!o.run) {
        console.log(`[delivery] DRY-RUN — --run 시 ${deliveryBranchName(o.slug)} 생성`)
        return
      }
      cmdCreate(ctx, o.slug)
      return
    }
    if (!o.slug) throw new Error('--slug <묶음> 필요')
    if (o.sub === 'status') return cmdStatus(ctx, o.slug)
    if (o.sub === 'seal' || o.sub === 'approve' || o.sub === 'reopen') {
      if (!o.run) {
        console.log(`[delivery] DRY-RUN — --run 시 '${o.slug}' 묶음을 ${o.sub} 합니다 (--confirm "${confirmSentence(o.sub, o.slug)}" 필요)`)
        return
      }
      if (o.sub === 'seal') cmdSeal(ctx, o.slug, o.confirm)
      else if (o.sub === 'approve') cmdApprove(ctx, o.slug, o.confirm)
      else cmdReopen(ctx, o.slug, o.confirm)
      return
    }
    if (o.sub === 'begin') {
      if (!o.reqSlug) throw new Error('req-slug 필요 (예: delivery begin payment-api --slug payment --run)')
      if (!o.run) {
        console.log('[delivery] DRY-RUN — --run 시 delivery 브랜치로 이동합니다')
        return
      }
      cmdBegin(ctx, o.slug, o.reqSlug)
      return
    }
    // integrate
    const record = readRecord(ctx, o.slug)
    const active = activeMember(record)
    if (!active) throw new Error('활성 member가 없습니다 — 반영할 REQ가 없습니다.')
    if (!o.run) {
      console.log(`[delivery] DRY-RUN — --run 시 ${active.feature_ref ?? '(feature_ref 없음)'} → ${deliveryBranchName(o.slug)} 반영(${active.req_id})`)
      return
    }
    cmdIntegrate(ctx, o.slug, active.req_id)
  } catch (err) {
    if (err instanceof HelpRequested) {
      printHelp()
      return
    }
    console.error(`commitgate delivery: ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
  }
}

const isMain = isEntrypoint(import.meta.url)
if (isMain) runCli(process.argv.slice(2))

/** 테스트가 root를 명시해 ctx를 만들 때 쓰는 헬퍼. */
export function ctxFor(root: string): Ctx {
  return makeCtx(resolve(root))
}
