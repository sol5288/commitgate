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
}
