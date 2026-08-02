# REQ-2026-104 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

> **테스트 실행 계층(REQ-2026-100)**: 게이트는 테스트를 **실행하지 않는다**. 아래는 비용을 줄이기 위한 실행 시점 권고다.
> - **phase 진행 중**: 변경한 소스를 import하는 테스트만(빠른 피드백). 예: `grep -rl "<변경한 모듈>" tests/`
> - **통합(main 병합) 직전 1회**: **전체 스위트**. 범위 한정은 이것을 **대체하지 않는다** — 영향 분석은 놓친 회귀를 통과시킨다.

## Phase 1 — 문서 진실성 가드 범위 확장 (`phase-1-docs-truth-guard`)

범위(**수정 4파일**, granularity 권고 8 이하):

- `tests/unit/docs-stale-claims.test.ts`
  - `docFiles`를 `readdirSync(..., { recursive: true })`로 전환(DEC-1). 반환 경로 구분자를 정규화해 Windows에서도 단언이 성립하게 한다.
  - "검사 대상 문서가 존재한다"에 **`docs/ssot-design/` 파일 포함 단언**을 추가(DEC-1) — 재귀가 사라지면 실패해야 한다.
  - `STALE_CLAIMS`에 `향후 opt-in용` 1건 등재(DEC-2). 등재 전 저장소 전역 0건임을 확인한다.
  - 파일 상단 주석에 **이 가드의 한계**를 적는다(DEC-3): 고정 문자열 목록이며 새로운 거짓 서술을 자동으로 찾지 못한다.
- `docs/ssot-design/06-api-and-integration-contracts.md` · `docs/ssot-design/gaps-and-decisions.md` — DEC-2 C안: REQ-103 정정문이 옛 표현을 축자 인용하던 것을 풀어 쓴다(가드 문자열이 정정문에 남아 있으면 가드가 성립하지 않는다).
- `CHANGELOG.md` — 같은 축자 인용 제거(DEC-2 C안) + Unreleased 항목 추가. **가드의 한계를 함께 적는다**(DEC-3).

🔴 **변이검사**: 재귀를 되돌리면 새 단언이, 금지 문구를 문서에 되살리면 해당 항목이 각각 실패해야 한다. `git checkout --`이 아니라 편집으로 되돌린다(미커밋 작업 유실 방지).

Exit: `npm run docs:lint` 통과 · `docs-stale-claims` 그린 · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(typecheck·해당 시 lint) · **통합 직전 전체 스위트 1회** · 사용자 main 머지(별도 승인).
