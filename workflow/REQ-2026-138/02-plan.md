# REQ-2026-138 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

> **테스트 실행 계층(REQ-2026-100)**: 게이트는 테스트를 **실행하지 않는다**. 아래는 비용을 줄이기 위한 실행 시점 권고다.
> - **phase 진행 중**: 변경한 소스를 import하는 테스트만(빠른 피드백). 예: `grep -rl "<변경한 모듈>" tests/`
> - **통합(main 병합) 직전 1회**: **전체 스위트**. 범위 한정은 이것을 **대체하지 않는다** — 영향 분석은 놓친 회귀를 통과시킨다.

## Phase 1 — 소개의 배타 표현 제거 + 폐기 문구 등재 (`phase-1-intro-stop-promise`)

범위:
- `README.md:51` 흐름도 `human check` 칸을 중립 표현으로(DEC-3).
- `README.md:57`·`README.en.md:57`을 DEC-1·DEC-2대로: 기본값에서 phase마다 부르지 않는다는 사실은 유지하고,
  소프트 한도 초과 회차에 사람이 필요할 수 있음을 한 문장으로 밝히고 "사람이 멈추는 지점" 절로 연결.
- `scripts/req/lib/retired-claims.ts`에 4건 등재(DEC-4) + 사유 주석.
- `CHANGELOG.md` Unreleased.

Exit: typecheck0 · `npm run docs:lint` · `docs-stale-claims`·`readme-landing` 그린 · 4건 전부 변이 검사로 red 확인 · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(typecheck·해당 시 lint) · **통합 직전 전체 스위트 1회** · 사용자 main 머지(별도 승인).
