/**
 * `EvidenceFinalizationRecovery` — evidence-finalize 중단의 **전용 복구 트랜잭션**(REQ-2026-142).
 *
 * 🔴 **이 모듈의 존재 이유는 D10 을 넓히지 않는 것이다.** source 커밋 뒤 evidence-finalize 도중 죽으면
 *    `approvals.jsonl`·아카이브·`state.json` 이 더러워지고, D10 이 그걸 보고 `req:commit --finalize` 를
 *    막는다 — **안내하는 복구 명령이 그 상황에서 절대 실행될 수 없다**(REQ-2026-140 phase-6 실측).
 *    답은 "`--finalize` 면 `responses/` 를 봐준다"가 아니다. 그건 플래그 하나로 증거 주입 구멍을 여는 것이다.
 *    답은 **승인 시점에 못 박아 둔 인벤토리와 바이트 단위로 일치할 때만, 정확히 그 파일들만** 통과시키는 것이다.
 *
 * 🔴 **`req:commit --finalize` 가 유일한 호출자다**(DEC-3). 다른 경로가 이걸 부르면 그 경로에도 예외가
 *    생긴다 — 호출자를 하나로 묶어 두는 것이 예외를 좁게 유지하는 구조적 수단이다.
 *
 * 🔴 **leaf 다.** `./evidence`(그 자신도 leaf)와 타입만 가져온다. fs·git 을 모른다 — 사실은 전부 주입된다.
 *
 * ## 이 모듈이 막는 것과 막지 않는 것
 *
 * **막는다**: 승인 이후 아카이브 내용이 바뀌는 것 · 인벤토리에 없는 아카이브가 증거 커밋에 딸려 들어가는 것
 * (`…-r99-approved.json` 주입) · 증거와 무관한 파일이 복구 커밋에 섞이는 것 · 승인과 다른 tree 를 복구
 * 대상으로 삼는 것 · 커밋된 매니페스트와 다른 핀을 들이미는 것.
 *
 * **막지 않는다(그리고 이 REQ 가 새로 여는 것도 아니다)**: `state.json` 을 손으로 고쳐 승인 자체를 날조하는 것.
 * `approved_diff_hash`·`commit_allowed` 는 이 REQ 이전부터 state 에서 오고 `recoveryCoreValid` 가 그걸 믿는다.
 * 🔴 여기서 중요한 것은 **이 복구 경로가 그 신뢰 수준을 더 낮추지 않는다**는 것이다 — 증거 커밋이 이미 있는
 * 상태에서는 `pin-divergent` 가 커밋된 매니페스트를 상위 근거로 삼아 state 위조를 잡아낸다.
 */
import { canonicalInventoryForm, manifestHasConsumed, parseManifestEntries } from './evidence'
import type { ArchiveInventoryItem } from './evidence'
import type { ApprovalEvidence, PinnedArchiveInventory, PinnedInventoryItem } from './review-types'

/** 거부 사유 등록부. 늘리면 `RECOVERY_GUIDANCE` 가 강제로 같이 늘어난다(안내 없는 사유 금지). */
export const RECOVERY_BLOCKED_REASONS = [
  'not-a-recovery',
  'tree-mismatch',
  'inventory-absent',
  'pin-divergent',
  'inventory-tampered',
  'archive-mismatch',
  'inventory-unbound',
  'foreign-files',
] as const
export type RecoveryBlockedReason = (typeof RECOVERY_BLOCKED_REASONS)[number]

export const RECOVERY_GUIDANCE: Record<RecoveryBlockedReason, string> = {
  'not-a-recovery':
    '복구할 미완 finalize 가 없습니다 — 승인·source 커밋이 갖춰진 상태가 아닙니다. 정상 경로(req:commit --run)를 쓰십시오.',
  'tree-mismatch':
    'source 커밋의 tree 가 승인된 tree 와 다릅니다 — 승인 이후 내용이 바뀌었습니다. 복구가 아니라 재리뷰가 필요합니다.',
  'inventory-absent':
    '이 승인에는 아카이브 인벤토리 핀이 없습니다(REQ-2026-142 이전 승인). 근거가 없으므로 복구를 열지 않습니다 — 재리뷰로 새 승인을 받으십시오.',
  'pin-divergent':
    'state 의 인벤토리 핀과 커밋된 매니페스트의 인벤토리가 다릅니다 — 둘 중 하나가 변조됐습니다. 손으로 고치지 말고 재리뷰하십시오.',
  'inventory-tampered':
    '인벤토리 목록이 핀 당시의 해시와 맞지 않습니다 — 목록이 승인 이후 바뀌었습니다.',
  'archive-mismatch':
    '아카이브 파일의 현재 내용이 승인 시점 SHA-256 과 다르거나 파일이 없습니다 — 증거가 훼손됐습니다.',
  'inventory-unbound':
    '승인 응답 아카이브가 인벤토리 목록 안에 없습니다 — 핀이 승인과 결속되지 않았습니다.',
  'foreign-files':
    '복구 허용 범위 밖의 변경이 작업 트리에 있습니다. 그 변경을 먼저 커밋하거나 되돌린 뒤 다시 실행하십시오(복구는 증거 파일만 만집니다).',
}

/**
 * 재개 지점.
 *
 * 🔴 **설계 DEC-5 의 4단계(① stage → ② evidence commit → ③ HEAD 재검증 → ④ 소비 checkpoint)는 그대로다.**
 *    다만 `finalizeEvidenceAndConsume` 이 ①~③ 을 **이미 HEAD 기준으로 멱등 처리**하므로(REQ-2026-052
 *    phase-3a P1), 그 안을 다시 쪼갠 `resumeFrom` 을 두면 **진행 지점이라는 개념이 두 개**가 되고 둘이
 *    갈라진다. 그래서 실제 머신이 구별하는 세 지점만 둔다:
 *
 *    | 값 | 상태 | DEC-5 표의 어느 줄인가 |
 *    |---|---|---|
 *    | `evidence`   | 승인 핀 있음 · HEAD 에 소비 행 **없음**    | ① 전 · ① 후 ② 전 |
 *    | `consume`    | 승인 핀 있음 · HEAD 에 소비 행 **있음**    | ② 후 ③ 전 · ③ 후 ④ 전 |
 *    | `checkpoint` | 승인 핀 **없음**(디스크에서 이미 소비됨)  | ④의 state write 후 commit 전 |
 */
export type RecoveryResumeStage = 'evidence' | 'consume' | 'checkpoint'

export interface RecoveryFacts {
  /** repo-상대 티켓 디렉터리(POSIX, 후행 `/` 없음). */
  ticketRel: string
  /** 워킹 state 의 `commit_allowed`. */
  commitAllowed: boolean
  /** 워킹 state 의 `approved_diff_hash`. */
  approvedDiffHash: string | null
  /** 워킹 state 의 `approval_evidence`(소비 후엔 null). */
  approvalEvidence: ApprovalEvidence | null
  /** 복구 대상 source 커밋(pending 마커 또는 orphan HEAD 로 해소된 값). */
  source: { sha: string; tree: string } | null
  /** **HEAD 의** `approvals.jsonl` 내용(없으면 빈 문자열). 🔴 워킹 파일이 아니다(DEC-3a). */
  headManifest: string
  /** 작업 트리에서 더러운(staged·unstaged·untracked) repo-상대 경로 전부. */
  dirtyPaths: readonly string[]
  /** repo-상대 경로 → 현재 파일 바이트의 sha256(hex). 파일이 없으면 null. */
  archiveSha: (repoRelPath: string) => string | null
  /** UTF-8 문자열 → sha256(hex). */
  hashUtf8: (s: string) => string
}

export type RecoveryPlan =
  | {
      kind: 'ready'
      resumeFrom: RecoveryResumeStage
      /** 🔴 D10 이 예외로 통과시킬 **정확한 경로 목록**. 이 밖은 하나도 허용하지 않는다. */
      allowlist: string[]
      detail: string
    }
  | { kind: 'blocked'; reason: RecoveryBlockedReason; detail: string }

const norm = (p: string): string => p.replace(/\\/g, '/')

/** 매니페스트에서 이 승인 identity 의 행이 담고 있는 인벤토리(없으면 null). */
function headRowInventory(headManifest: string, ev: ApprovalEvidence): ArchiveInventoryItem[] | null {
  for (const e of parseManifestEntries(headManifest)) {
    if (e.kind === ev.review_kind && (e.phase_id ?? null) === (ev.phase_id ?? null) && e.response_sha256 === ev.response_sha256)
      return Array.isArray(e.archive_inventory) ? e.archive_inventory : null
  }
  return null
}

/**
 * 복구 가능성 판정(순수). `Ready` 일 때만 D10 예외가 열린다(DEC-4).
 *
 * 🔴 검사 순서는 **좁은 것부터**다. 예컨대 tree 불일치를 인벤토리 검사보다 먼저 본다 — 승인과 다른 내용을
 *    복구 대상으로 삼는 것이 더 중대한 위반이고, 그 상태에서 인벤토리가 맞는다는 사실은 의미가 없다.
 */
export function planEvidenceRecovery(facts: RecoveryFacts): RecoveryPlan {
  const ticketRel = norm(facts.ticketRel).replace(/\/+$/, '')
  const stateRel = `${ticketRel}/state.json`
  const manifestRel = `${ticketRel}/responses/approvals.jsonl`
  const ledgerRel = `${ticketRel}/responses/review-ledger.jsonl`
  const dirty = facts.dirtyPaths.map(norm)
  const ev = facts.approvalEvidence

  // ── ④의 state write 후 checkpoint commit 전 (DEC-3a) ──
  // 🔴 핀이 없다는 사실은 **두 뜻**이다: *아직 안 만들었다*(옛 승인 — 거부)와 *이미 소비했다*(정상 완료 직전).
  //    구별의 근거는 HEAD 다 — 증거가 이미 커밋돼 있고 남은 더러움이 state.json 뿐이면 후자다.
  //    이 분기는 인벤토리를 요구하지 않는다. 커밋할 것이 state.json 하나뿐이라 인벤토리가 지킬 대상이 없다.
  if (!ev) {
    const foreign = dirty.filter((p) => p !== stateRel)
    if (foreign.length)
      return { kind: 'blocked', reason: 'not-a-recovery', detail: `승인 핀 없음 + state.json 외 변경: ${foreign.join(', ')}` }
    if (!dirty.length) return { kind: 'blocked', reason: 'not-a-recovery', detail: '복구할 변경이 없습니다(이미 완료)' }
    if (!facts.headManifest.trim())
      return { kind: 'blocked', reason: 'not-a-recovery', detail: 'HEAD 에 커밋된 승인 증거가 없습니다 — 소비 후 상태가 아닙니다' }
    return {
      kind: 'ready',
      resumeFrom: 'checkpoint',
      allowlist: [stateRel],
      detail: '증거는 HEAD 에 있고 소비 state 만 미커밋 — checkpoint 만 재개',
    }
  }

  if (facts.commitAllowed !== true)
    return { kind: 'blocked', reason: 'not-a-recovery', detail: 'commit_allowed=true 아님 — 복구할 미완 승인이 없습니다' }
  if (!facts.source) return { kind: 'blocked', reason: 'not-a-recovery', detail: 'source 커밋을 해소하지 못했습니다' }
  if (!facts.approvedDiffHash || facts.source.tree !== facts.approvedDiffHash)
    return {
      kind: 'blocked',
      reason: 'tree-mismatch',
      detail: `source tree(${facts.source.tree}) != approved(${String(facts.approvedDiffHash)})`,
    }

  // ── 인벤토리 근거 확보(DEC-3a: HEAD 우선 대조) ──
  const pin: PinnedArchiveInventory | null = ev.archive_inventory ?? null
  const headInv = headRowInventory(facts.headManifest, ev)
  if (!pin && !headInv)
    return { kind: 'blocked', reason: 'inventory-absent', detail: '승인에도 커밋된 매니페스트에도 인벤토리가 없습니다' }
  if (pin && headInv && canonicalInventoryForm(pin.items) !== canonicalInventoryForm(headInv))
    return { kind: 'blocked', reason: 'pin-divergent', detail: 'state 핀과 HEAD 매니페스트 인벤토리가 다릅니다' }

  const items: PinnedInventoryItem[] = pin ? pin.items : (headInv as ArchiveInventoryItem[])

  // 목록 자체의 무결성 — 핀이 있을 때만 대조할 값이 있다(HEAD 행은 목록 해시를 담지 않는다).
  if (pin && facts.hashUtf8(canonicalInventoryForm(pin.items)) !== pin.inventory_sha256)
    return { kind: 'blocked', reason: 'inventory-tampered', detail: '인벤토리 목록이 핀 해시와 불일치' }

  // 결속 — 승인 응답이 목록 안에 있어야 한다. 🔴 핀의 `source_response_path` 와 evidence 의
  //   `response_path` 를 **둘 다** 본다. 하나만 보면 서로 다른 승인의 핀을 갖다 붙일 수 있다.
  const paths = new Set(items.map((i) => norm(i.response_path)))
  if (pin && !paths.has(norm(pin.source_response_path)))
    return { kind: 'blocked', reason: 'inventory-unbound', detail: `source_response_path 가 목록 밖: ${pin.source_response_path}` }
  if (!paths.has(norm(ev.response_path)))
    return { kind: 'blocked', reason: 'inventory-unbound', detail: `승인 응답이 목록 밖: ${ev.response_path}` }
  if (pin && (pin.review_kind !== ev.review_kind || (pin.phase_id ?? null) !== (ev.phase_id ?? null)))
    return { kind: 'blocked', reason: 'inventory-unbound', detail: '핀의 kind/phase 결속이 승인과 다릅니다' }

  // 바이트 대조 — 목록의 모든 파일이 승인 시점 그대로여야 한다.
  for (const i of items) {
    const actual = facts.archiveSha(norm(i.response_path))
    if (actual === null) return { kind: 'blocked', reason: 'archive-mismatch', detail: `아카이브 없음: ${i.response_path}` }
    if (actual !== i.sha256) return { kind: 'blocked', reason: 'archive-mismatch', detail: `아카이브 SHA 불일치: ${i.response_path}` }
  }

  // ── 허용 write set: 인벤토리 아카이브 ∪ 매니페스트 ∪ 원장 ∪ state ──
  // 🔴 **부분집합이지 동일집합이 아니다.** 중단 지점에 따라 일부만 더러울 수 있다(아카이브는 이미 커밋됐고
  //    `approvals.jsonl` 만 남는 식). "정확히 이만큼 더러워야 한다"고 요구하면 정상 복구가 중단 지점에 따라
  //    막힌다 — REQ-2026-141 r06 과 같은 종류의 과잉 조임이다.
  const allowlist = [...items.map((i) => norm(i.response_path)), manifestRel, ledgerRel, stateRel]
  const allowed = new Set(allowlist)
  const foreign = dirty.filter((p) => !allowed.has(p))
  if (foreign.length)
    return { kind: 'blocked', reason: 'foreign-files', detail: `허용 범위 밖 변경: ${foreign.join(', ')}` }

  const already = manifestHasConsumed(facts.headManifest, facts.source.sha, {
    reviewKind: ev.review_kind,
    phaseId: ev.phase_id ?? null,
    responseSha256: ev.response_sha256,
  })
  return {
    kind: 'ready',
    resumeFrom: already ? 'consume' : 'evidence',
    allowlist,
    detail: already
      ? 'HEAD 에 증거 행이 있음 — 소비·checkpoint 만 재개'
      : `증거 미커밋 — 아카이브 ${items.length}건·매니페스트부터 재개`,
  }
}
