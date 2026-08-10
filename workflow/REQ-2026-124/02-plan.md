# REQ-2026-124 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

> **테스트 실행 계층(REQ-2026-100)**: 게이트는 테스트를 **실행하지 않는다**. 아래는 비용을 줄이기 위한 실행 시점 권고다.
> - **phase 진행 중**: 변경한 소스를 import하는 테스트만(빠른 피드백). 예: `grep -rl "<변경한 모듈>" tests/`
> - **통합(main 병합) 직전 1회**: **전체 스위트**. 범위 한정은 이것을 **대체하지 않는다** — 영향 분석은 놓친 회귀를 통과시킨다.

## Phase 1 — 집계 코어 (`phase-1-report-lib`)

범위: `scripts/req/lib/report.ts` 신규(설계 DEC-1·DEC-2 — 3로그 관대 파서·doctor 해소 관측·
review "대상당 총 호출" 분포·p50/p95·ci 분포·problems 집계) + `tests/unit/report-lib.test.ts`
(fixture 로그 기대값·부재·손상·subjects 없는 검사 제외 표기).

Exit: typecheck 0 · `npx vitest run tests/unit/report-lib.test.ts` 그린 · Codex phase 리뷰 승인.

## Phase 2 — verb·표면 (`phase-2-report-verb`)

범위: `bin/report.ts`(수집 — 로그 3종 읽기 + config trunk 기준 verify-range 산출·renderHuman/Json
동일 파생·fail-closed 인자 — DEC-3), `dispatch.mjs`·`init.ts` 각 1행, `tests/unit/report-verb.test.ts`
(빈 repo exit 0·json 파생·인자 오류), `docs/workflow.md`/`.en` report 절, `CHANGELOG.md`.

Exit: typecheck 0 · 신규 테스트 + help↔dispatch 가드 그린 · docs:lint 그린 · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(typecheck·해당 시 lint) · **통합 직전 전체 스위트 1회** · 사용자 main 머지(별도 승인).
