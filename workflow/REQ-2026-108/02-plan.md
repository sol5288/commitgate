# REQ-2026-108 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

> **테스트 실행 계층(REQ-2026-100)**: 게이트는 테스트를 **실행하지 않는다**. 아래는 비용을 줄이기 위한 실행 시점 권고다.
> - **phase 진행 중**: 변경한 소스를 import하는 테스트만(빠른 피드백). 예: `grep -rl "<변경한 모듈>" tests/`
> - **통합(main 병합) 직전 1회**: **전체 스위트**. 범위 한정은 이것을 **대체하지 않는다** — 영향 분석은 놓친 회귀를 통과시킨다.

## Phase 1 — D5를 WARN으로 (`phase-1-d5-warn`)

**선행 조건: 없음.**

범위(3파일):

- `scripts/req/req-doctor.ts` — D5의 `level`을 `'FAIL'` → `'WARN'`(DEC-1). **판정 조건·메시지 문자열은 유지.** 강등 사유 주석 추가(DEC-2): ①이 필드는 읽는 코드가 D5 자신뿐(REQ-2026-103이 마지막 소비 경로 제거) ②`req:commit`이 doctor를 하드 게이트로 spawn하므로 FAIL은 커밋 차단 ③codex가 id 형식을 바꾸면 전 소비자가 동시에 막히는 비대칭 비용
- `tests/unit/req-doctor.test.ts` — 회귀:
  1. 형식 이상 `codex_thread_id` → D5 **WARN**
  2. 같은 입력에서 **FAIL 0건**(= exit 0 — 커밋이 막히지 않는다)(DEC-3)
  3. 정상 UUID → D5 **OK**(무회귀)
  4. 미설정(`undefined`) → D5 **OK**(무회귀)
- `CHANGELOG.md` — Unreleased. **소비자 관측 변화 있음**(REQ-107과 같은 묶음)임을 명시

🔴 **변이검사**: `level`을 `'FAIL'`로 되돌리면 회귀 2가 실패해야 한다. 편집으로 되돌린다(`git checkout --` 금지).

Exit: typecheck 0 · `req-doctor` 테스트 그린 · 변이검사 · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(typecheck·해당 시 lint) · **통합 직전 전체 스위트 1회** · 사용자 main 머지(별도 승인).
