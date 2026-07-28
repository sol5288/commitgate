# REQ-2026-084 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

## Phase 1 — risk_level 계약 축소 (`phase-1-risk-level-deprecation`)

범위(4파일):
- `workflow/machine.schema.json` — `required`에서 `risk_level` 제거 · `properties.risk_level`에 `"deprecated": true` + 방출 금지 description (DEC-1)
- `scripts/req/lib/adapters.ts` — `deriveStrictOutputSchema`에 deprecated 속성 탈락 단계. **`required` 재구성보다 앞** (DEC-2)
- `scripts/req/review-codex.ts` — `validateVerdict`의 risk_level 검사를 조건부(있으면 enum, 없으면 통과)로 (DEC-3)
- `tests/unit/req-review-codex.test.ts` — 아래 6건 회귀 가드

회귀 가드: ①레거시 아카이브(risk_level 포함) 통과 ②신규 응답(부재) 통과 ③오값(`MEDIUM`) 거부
④strict copy의 `properties`에 risk_level 없음 ⑤strict copy의 `required`에도 없음 ⑥`MACHINE_SCHEMA_VERSION === '1.1'` 고정.

Exit: eslint0·typecheck0 · 단위 그린 · Codex phase 리뷰 승인.

## Phase 2 — invalid 회차 예산 미소모 (`phase-2-invalid-budget`)

범위(4파일):
- `scripts/req/review-codex.ts` — `SeriesRecord.void_attempts?` · `voidAttempt()` · `openSeriesProductiveAttempts()` · `checkReviewBudget({productive, dispatched})` · 정상 경로 `persistedState` 분기에 invalid → voidAttempt (DEC-4·5·6)
- `scripts/req/req-review-exception.ts` — 새 시그니처로 동기화 (DEC-7)
- `tests/unit/req-review-codex.test.ts` — 예산 판정 회귀 가드
- `tests/unit/req-review-exception.test.ts` — 부여/소비 판정 일치 가드

회귀 가드: ①invalid 1회 뒤 autoBudget이 1회 덜 소모됨 ②invalid만 반복해도 `dispatched`로 hardCap에서 차단
③`void_attempts` 부재 state가 현행과 동일 판정 ④pre-dispatch 환불(REQ-2026-054) 의미 불변
⑤예외 부여 판정과 소비 판정이 같은 회차를 가리킴.

Exit: eslint0·typecheck0 · 단위 그린 · Codex phase 리뷰 승인.

## Phase 3 — CHANGELOG (`phase-3-changelog`)

범위(1파일):
- `CHANGELOG.md` — Unreleased에 두 변경 기록. **확인할 파일 표**에 phase-1·2의 실제 커밋 SHA와 경로를 명시한다(diff-scoped 리뷰는 앞 phase의 diff를 볼 수 없다 — REQ-2026-082·083 교훈).
- 소비자 안내: `machine.schema.json`이 바뀌었으므로 D20 WARN 시 `commitgate sync`.

Exit: eslint0·typecheck0 · 단위 그린 · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(unit·typecheck·lint) · 사용자 main 머지(별도 승인).
