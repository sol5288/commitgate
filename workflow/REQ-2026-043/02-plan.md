# REQ-2026-043 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

## Phase 1 — review-call 로그에 모델·effort 기록 (`phase-1-log-model-fields`)

범위: `scripts/req/review-codex.ts`(`ReviewCallLogRow`에 `review_model`·`review_reasoning_effort` 2필드 · `buildReviewCallLogRow` args 2개 · 호출 지점에서 `cfg.reviewModel`·`cfg.reviewReasoningEffort` 전달) + `tests/unit/req-review-codex.test.ts`(빌더가 핀/미핀 두 케이스에서 두 필드를 담는지 assert).

TDD: 빌더 실패 테스트 먼저(Red) → 타입/args/호출 지점 추가(Green) → 리팩터.

변경 파일 2개(코드 1 + 테스트 1) ≤ 8. 단일 phase로 충분.

Exit: eslint0·typecheck0 · 단위 그린 · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(unit·typecheck·lint) · 사용자 main 머지(별도 승인).
