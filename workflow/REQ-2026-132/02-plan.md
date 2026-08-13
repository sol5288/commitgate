# REQ-2026-132 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

> **테스트 실행 계층(REQ-2026-100)**: 게이트는 테스트를 **실행하지 않는다**. 아래는 비용을 줄이기 위한 실행 시점 권고다.
> - **phase 진행 중**: 변경한 소스를 import하는 테스트만(빠른 피드백). 예: `grep -rl "<변경한 모듈>" tests/`
> - **통합(main 병합) 직전 1회**: **전체 스위트**. 범위 한정은 이것을 **대체하지 않는다** — 영향 분석은 놓친 회귀를 통과시킨다.

## Phase 1 — `onSoftLimit` 축 + `soft-auto` 판정 + 원장 근거 (`phase-1-soft-limit`)

범위(DEC-1·DEC-1b·DEC-2·DEC-3·DEC-4·DEC-4b):
- `lib/config.ts`: `SoftLimitPolicy` · `ReviewBudget.onSoftLimit` · DEFAULTS(`ask`) ·
  🔴 **`reviewBudget` 키별 병합**(현재는 객체 통째 교체라 부분 설정에서 새 키가 `undefined`가 된다).
- `workflow/req.config.schema.json`: `properties`에만 추가하고 **`required`에는 넣지 않는다**
  (넣으면 기존 `{autoBudget,hardCap}` 설정이 업그레이드에서 거부된다).
- `review-codex.ts`: `BudgetDecision`에 `soft-auto` · `checkReviewBudget` 분기 · 호출부(`recordAttempt` 앞)에서
  `soft-auto`면 예외 소비를 **건너뛴다**.
- `lib/review-ledger.ts`: `soft_limit_resolution` **optional** 키 + **열거 검증**(`null|'exception'|'policy'`).
- `req:next`: 🔴 `!== 'allow'` 를 **진행 가능 집합**(`allow`·`soft-auto`)으로 바꾼다 — 부정으로 두면
  판정 종류가 늘 때마다 조용히 정지 쪽에 붙는다.
- `req-review-exception.ts`: 🔴 `soft-auto`를 **거부**한다(사유 명시) — 그러지 않으면 `auto` 설정에서
  사람 예외 기록이 만들어져 "auto는 사람 승인을 만들지 않는다"를 도구가 스스로 어긴다.

Exit:
```sh
npm run typecheck
npx vitest run tests/unit/review-soft-limit-policy.test.ts tests/unit/review-ledger.test.ts \
  tests/unit/review-exception.test.ts tests/unit/req-review-exception.test.ts \
  tests/unit/review-lifecycle-budget.test.ts tests/unit/req-config.test.ts tests/unit/req-next.test.ts
```
(🔴 `review-soft-limit-policy.test.ts`가 이 phase의 **정책 오라클**이다 — 이 파일을 빼면 auto 정책·원장
배선 회귀가 검증 대상에서 통째로 빠진다. 나머지는 기존 소유 스위트의 무회귀 확인이다.)
typecheck0 · 진리표(ask/auto × 5·6·8·9회차) 그린 · **부분 설정 `{autoBudget:3,hardCap:6}` → `ask`** 무회귀 ·
`hardCap` 두 값 모두 차단 · `auto`에서 `req:next`가 예산으로 멈추지 않음 ·
`auto`에서 `req:review-exception` 거부 · 원장 행의 `policy`/`exception` 구별 · Codex 승인.

## Phase 2 — 문서 (`phase-2-docs`)

범위: `docs/configuration.md`/`.en`(새 키 설명 — **비용 통제이지 안전 게이트가 아니라는 것**과
`hardCap` 불변을 명시) · `docs/workflow.md`/`.en` 예산 절 · `CHANGELOG.md`.

Exit: `npm run docs:lint` · 문서 가드 그린 · Codex 승인.

## 완료
- 게이트 해당분(typecheck·해당 시 lint) · **통합 직전 전체 스위트 1회** · 사용자 main 머지(별도 승인).
