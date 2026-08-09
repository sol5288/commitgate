# REQ-2026-121 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

> **테스트 실행 계층(REQ-2026-100)**: 게이트는 테스트를 **실행하지 않는다**. 아래는 비용을 줄이기 위한 실행 시점 권고다.
> - **phase 진행 중**: 변경한 소스를 import하는 테스트만(빠른 피드백). 예: `grep -rl "<변경한 모듈>" tests/`
> - **통합(main 병합) 직전 1회**: **전체 스위트**. 범위 한정은 이것을 **대체하지 않는다** — 영향 분석은 놓친 회귀를 통과시킨다.

## Phase 1 — design-finalize state 동승 (`phase-1-design-companion`)

범위: `lib/evidence.ts` `durableDesignEvidence`에 `companionState` 선택 인자(설계 DEC-2 — 함수 내
재검증·실패 시 동승 생략·`stateIncluded` 반환·가드 허용 목록 = responses/** ∪ {stateRel}·메시지
`…·state 기록`), `review-codex.ts` design 승인 분기(전달 + stateIncluded=false 폴백 checkpoint —
DEC-3), `lib/state-checkpoint.ts` 헤더에 재개정 기록(DEC-5 — 동작 무변경), 테스트(완료 기준 1~4:
near-e2e 커밋 수·파일 목록 / 검증 실패 폴백 / 가드 변이 / already-durable 멱등), `CHANGELOG.md`.

Exit: typecheck 0 · `npx vitest run tests/unit/req-review-codex.test.ts tests/unit/review-lifecycle-wiring.test.ts tests/unit/state-checkpoint.test.ts` + 신규 오라클 그린 · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(typecheck·해당 시 lint) · **통합 직전 전체 스위트 1회** · 사용자 main 머지(별도 승인).
