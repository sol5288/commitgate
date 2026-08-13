# REQ-2026-131 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

> **테스트 실행 계층(REQ-2026-100)**: 게이트는 테스트를 **실행하지 않는다**. 아래는 비용을 줄이기 위한 실행 시점 권고다.
> - **phase 진행 중**: 변경한 소스를 import하는 테스트만(빠른 피드백). 예: `grep -rl "<변경한 모듈>" tests/`
> - **통합(main 병합) 직전 1회**: **전체 스위트**. 범위 한정은 이것을 **대체하지 않는다** — 영향 분석은 놓친 회귀를 통과시킨다.

## Phase 1 — 계약 본문 + 회귀 가드 (`phase-1-contract`)

범위(DEC-1·DEC-2·DEC-2b·DEC-3·DEC-5 중 템플릿 부분):
- `AGENTS.template.md`: 자율성 절 신설(세 규칙 + **예외 9항목** + `stopGate` 종속 명시 +
  "예외는 `kind`가 아니라 행위로 판정한다" 명시).
- 🔴 기존 "그 밖에 보고해야 할 때"의 **"설계 범위 변경 또는 비목표 추가"** 항목에 정정↔범위변경 경계를
  붙인다(DEC-2b) — 그 경계가 없으면 두 규칙이 정면 충돌한다.
- 같은 파일의 기존 "멈춤·확인·승인" 서술을 전수 확인해 모순을 정정한다.
- 회귀 가드(신규 테스트): 세 규칙의 핵심 문장 존재 + **예외 목록 존재** + **변이 검사**
  (문장을 지운 사본에서 가드가 실패해야 한다 — 오라클이 살아 있음을 증명).

Exit:
```sh
npx vitest run tests/unit/agent-autonomy-contract.test.ts tests/unit/docs-stale-claims.test.ts tests/unit/check.test.ts tests/unit/control-points.test.ts
```
가드 그린 · 변이 검사로 가드 실효 증명 · 문서 가드 무회귀 · Codex 승인.

## Phase 2 — 문서 + CHANGELOG (`phase-2-docs`)

범위: `docs/workflow.md`/`.en` 에 계약을 **다른 표현으로** 설명(축자 복사 금지 — 고정 문자열 가드와 공존
불가) · `docs/agent-prompt.md`/`.en` 의 **사람 전용 명령 표에서 `req:confirm` 제거**(DEC-5 — 정본은
계약이고 거기엔 `setup` 하나뿐이다. 통제점 명령을 사람 전용으로 적으면 에이전트가 `req:next` 지시를
실행해도 되는지 또 판단하게 된다) · `CHANGELOG.md`(기존 `AGENTS.md`는 자동 갱신되지 않는다는 사실 포함 —
과잉 약속 금지).

Exit: `npm run docs:lint` · 문서 가드 그린 · Codex 승인.

## 완료
- 게이트 해당분(typecheck·해당 시 lint) · **통합 직전 전체 스위트 1회** · 사용자 main 머지(별도 승인).
