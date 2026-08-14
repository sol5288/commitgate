/**
 * 리뷰 커널의 **공용 도메인 타입**(REQ-2026-106).
 *
 * 왜 여기에 있나: 이 타입들은 원래 `review-codex.ts`가 정의했고 `lib/`의 세 모듈
 * (`evidence`·`review-exception`·`review-ledger`)이 **거꾸로** 거기서 import했다 — 즉 `lib/`이 leaf가
 * 아니었다. `import type`이라 런타임 순환은 없었지만, 방향이 뒤집힌 채로는 어떤 추출도 순환을 만든다.
 *
 * 🔴 **여기에 넣는 기준은 "lib이 실제로 쓰는 타입"이다**(REQ-2026-106 DEC-4). 관련돼 보인다고 끌고
 *    오지 않는다 — 예컨대 `WorkflowState`는 어떤 lib 모듈도 쓰지 않고, 폐포로 6~8개 타입을 더 끌고
 *    온다. 필요해지는 REQ가 그때 더 내리면 된다(`review-codex.ts`가 re-export를 유지하므로 점진
 *    이동이 가능하다).
 *
 * ⚠️ **런타임 코드를 두지 않는다.** `type`·`interface`만 — 그래야 이 파일의 변경이 동작을 바꿀 수 없다.
 */

/** 리뷰 종류 (DEC-WF-027): design=설계문서 권위, phase=staged diff 권위. */
export type ReviewKind = 'design' | 'phase'

/**
 * 아카이브 인벤토리 한 항목(REQ-2026-048 DEC-2). `evidence.ts`의 `ArchiveInventoryItem`이 이 타입의 별칭이다 —
 * **한 모양만 둔다**. 매니페스트 행과 state 핀이 같은 모양이어야 DEC-3a의 교차 대조(HEAD 행 vs 워킹 핀)가
 * 필드 단위로 성립한다.
 */
export interface PinnedInventoryItem {
  response_path: string
  sha256: string
}

/**
 * **승인 시점에 확정해 state에 핀하는** 아카이브 인벤토리(REQ-2026-142 DEC-2).
 *
 * 🔴 **왜 승인 시점인가**: 매니페스트 행의 `archive_inventory`는 evidence-finalize가 디스크를 훑어 만든다.
 *    그런데 복구가 필요한 상황이 바로 **그 finalize가 중단된 상황**이다 — 그 시점의 산출물을 복구의 근거로
 *    쓸 수 없다. 그래서 더 이른 시점(승인)에 확정해 둔다.
 *
 * 🔴 **왜 목록인가**: 승인 하나(`response_path`)로 좁히면 정상적인 `r01 needs-fix` + `r02 approved` 복구가
 *    막히고(REQ-2026-141 r06 실측), 파일명 패턴으로 넓히면 무관한 `…-r99-approved.json`이 주입된다(같은 REQ r02).
 *    "승인 시점에 실제로 존재하던 것 전부"를 경로+SHA로 못 박는 것만이 둘 다 피한다.
 */
export interface PinnedArchiveInventory {
  /** 이 승인에 이르는 라운드 아카이브 전부(needs-fix 포함). repo-상대 POSIX 경로. */
  items: PinnedInventoryItem[]
  /** 🔴 목록 **자체**의 안정 해시 — 핀 이후 목록이 바뀌었는지 값 하나로 본다(정규형은 `canonicalInventoryForm`). */
  inventory_sha256: string
  /** 결속: 어느 리뷰의 어느 라운드 묶음인가. */
  review_kind: ReviewKind
  phase_id: string | null
  /** 승인 응답 아카이브(= `ApprovalEvidence.response_path`). **`items` 안에 있어야 한다**(미결속 거부). */
  source_response_path: string
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
  /**
   * 🔴 REQ-2026-052 DEC-B5(phase-3a2): **phase 전용** — 이 phase 승인 시점의 committed design 결속
   *   (= `designValid` 통과값 `currentHash`). evidence-finalize가 manifest phase 행 `phase_design_ref`로 기록한다.
   *   design kind·레거시(phaseId 없음)면 null.
   */
  phase_design_ref?: string | null
  codex_thread_id: string
  machine_schema_version: string
  status: string
  commit_approved: string
  approved_at: string
  /**
   * REQ-2026-142 DEC-2: 승인 시점 아카이브 인벤토리 핀. **선택 키다** — 이 REQ 이전 승인에는 없다.
   * 부재는 "아직 만들지 않았다"이고, 복구는 근거가 없으므로 열지 않는다(fail-closed).
   */
  archive_inventory?: PinnedArchiveInventory
}
