# REQ-2026-117 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

> **테스트 실행 계층(REQ-2026-100)**: 게이트는 테스트를 **실행하지 않는다**. 아래는 비용을 줄이기 위한 실행 시점 권고다.
> - **phase 진행 중**: 변경한 소스를 import하는 테스트만(빠른 피드백). 예: `grep -rl "<변경한 모듈>" tests/`
> - **통합(main 병합) 직전 1회**: **전체 스위트**. 범위 한정은 이것을 **대체하지 않는다** — 영향 분석은 놓친 회귀를 통과시킨다.

## Phase 1 — D30 상태 분류 (`phase-1-d30-classify`)

범위: `req-doctor.ts`에 `classifyStranded` 순수 함수(설계 DEC-1)·`readReviewCallStats`(DEC-3)·
수집부(upstream ref 해석·원격 trunk 트리 티켓 집합·로컬 브랜치 목록·신선도 — DEC-2, git +4회·fetch 0회)·
D30 메시지 재구성(DEC-4, level 불변). `tests/unit/d30-classify.test.ts` 신규 + 기존 D30 기대 갱신.

Exit: typecheck 0 · 신규·갱신 테스트 그린 · Codex phase 리뷰 승인.

## Phase 2 — 실행 로그에 발화 대상 (`phase-2-runlog-subjects`)

범위: `Check.subjects?`(설계 DEC-5) + D25·D29·D30 채움 + `buildDoctorRunRow` 선택 직렬화 +
허용 규칙(티켓 id·계약 파일명만) 테스트 + 하위호환(기존 행 파싱) 테스트 + `CHANGELOG.md` Unreleased.

Exit: typecheck 0 · doctor-run-log 테스트 그린 · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(typecheck·해당 시 lint) · **통합 직전 전체 스위트 1회** · 사용자 main 머지(별도 승인).
