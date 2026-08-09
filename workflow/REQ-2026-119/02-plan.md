# REQ-2026-119 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

> **테스트 실행 계층(REQ-2026-100)**: 게이트는 테스트를 **실행하지 않는다**. 아래는 비용을 줄이기 위한 실행 시점 권고다.
> - **phase 진행 중**: 변경한 소스를 import하는 테스트만(빠른 피드백). 예: `grep -rl "<변경한 모듈>" tests/`
> - **통합(main 병합) 직전 1회**: **전체 스위트**. 범위 한정은 이것을 **대체하지 않는다** — 영향 분석은 놓친 회귀를 통과시킨다.

## Phase 1 — 실효 위험 감지 (`phase-1-risk-detect`)

범위: `scripts/req/lib/effective-risk.ts` 신설(순수 매처 `effectiveRiskHits`·`DEFAULT_RISK_PATTERNS` —
설계 DEC-1), config `riskPaths` 선택 키(스키마·로더·기본값 — DEC-2, 대체 의미), D31 등록·판정·수집
(WARN 전용·staged 입력 재사용·subjects 없음 — DEC-3), `docs/ssot-design/07` §3 표 갱신(R4),
`tests/unit/effective-risk.test.ts` 신규 + `tests/unit/req-doctor.test.ts` D31 케이스, `CHANGELOG.md`.

단일 phase(설계 §Phase별 구현의 근거 — 매처와 D31은 서로 없이는 리뷰 불가능한 중간 상태).

Exit: typecheck 0 · 신규·갱신 테스트 그린(`npx vitest run tests/unit/effective-risk.test.ts tests/unit/req-doctor.test.ts`) · 등록부↔정본 표 가드 그린 · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(typecheck·해당 시 lint) · **통합 직전 전체 스위트 1회** · 사용자 main 머지(별도 승인).
