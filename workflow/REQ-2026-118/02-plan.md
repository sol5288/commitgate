# REQ-2026-118 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

> **테스트 실행 계층(REQ-2026-100)**: 게이트는 테스트를 **실행하지 않는다**. 아래는 비용을 줄이기 위한 실행 시점 권고다.
> - **phase 진행 중**: 변경한 소스를 import하는 테스트만(빠른 피드백). 예: `grep -rl "<변경한 모듈>" tests/`
> - **통합(main 병합) 직전 1회**: **전체 스위트**. 범위 한정은 이것을 **대체하지 않는다** — 영향 분석은 놓친 회귀를 통과시킨다.

## Phase 1 — 결정적 판정 코어 (`phase-1-reason-core`)

범위: `scripts/req/lib/full-review.ts` 신설 — `planPhaseIds`(02-plan 헤딩의 백틱 phase id 집합)·
`autoFullReviewReason`(설계 DEC-1: absent→no-baseline · invalid→invalid-baseline ·
전 문서 변경→all-docs-changed · plan phase 집합 상이→phase-structure-changed · 그 외 null,
baseline plan 읽기 실패 시 구조 비교 건너뜀). `tests/unit/full-review.test.ts` 신규.

Exit: typecheck 0 · 신규 테스트 그린 · Codex phase 리뷰 승인.

## Phase 2 — 배선·로그 (`phase-2-wiring-log`)

범위: `review-codex.ts` design 분기에 baselineState 3분해·baseline plan `cat-file`·판정 호출·
reason 시 `designDelta` 미설정(full 강제)·stdout 사유 1줄(설계 DEC-2), 리뷰 호출 로그 행에
`full_review_reason` 선택 키(DEC-3), 통합 테스트(델타 유지 회귀 포함)·`CHANGELOG.md`.

Exit: typecheck 0 · 신규·기존 리뷰 로그 테스트 그린 · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(typecheck·해당 시 lint) · **통합 직전 전체 스위트 1회** · 사용자 main 머지(별도 승인).
