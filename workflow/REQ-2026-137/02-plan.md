# REQ-2026-137 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

> **테스트 실행 계층(REQ-2026-100)**: 게이트는 테스트를 **실행하지 않는다**. 아래는 비용을 줄이기 위한 실행 시점 권고다.
> - **phase 진행 중**: 변경한 소스를 import하는 테스트만(빠른 피드백). 예: `grep -rl "<변경한 모듈>" tests/`
> - **통합(main 병합) 직전 1회**: **전체 스위트**. 범위 한정은 이것을 **대체하지 않는다** — 영향 분석은 놓친 회귀를 통과시킨다.

## Phase 1 — 랜딩 정지 지점 절 정정 + 폐기 문구 등재 (`phase-1-readme-stop-points`)

범위:
- `README.md`·`README.en.md`의 "사람이 멈추는 지점"/"Where a human stops" 절을 DEC-1·DEC-2대로 재작성.
  - `stopGate` = 커밋·통합에서 사람이 확인하는 자리(순서 표현 제거)
  - `reviewBudget.onSoftLimit` = 별도 축 소절(`ask`/`auto`, `hardCap`은 두 값 모두에서 차단, 정본 링크)
  - `merge` 행·본문에 묶음 있음/없음 두 경우
- 용어집 `delivery set` 행에 묶음이 선택임을 명시(DEC-5).
- `scripts/req/lib/retired-claims.ts`에 폐기 문구 4건 등재(DEC-3) + 등재 사유 주석.
- `CHANGELOG.md` Unreleased.

Exit: typecheck0 · `npm run docs:lint` · `docs-stale-claims`·`readme-landing` 그린 · 변이 검사(옛 문구 복원 시 red) · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(typecheck·해당 시 lint) · **통합 직전 전체 스위트 1회** · 사용자 main 머지(별도 승인).
