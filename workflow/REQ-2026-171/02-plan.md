# REQ-2026-171 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

> **테스트 실행 계층(REQ-2026-100)**: 게이트는 테스트를 **실행하지 않는다**. 아래는 비용을 줄이기 위한 실행 시점 권고다.
> - **phase 진행 중**: 변경한 소스를 import하는 테스트만(빠른 피드백). 예: `grep -rl "<변경한 모듈>" tests/`
> - **통합(main 병합) 직전 1회**: **전체 스위트**. 범위 한정은 이것을 **대체하지 않는다** — 영향 분석은 놓친 회귀를 통과시킨다.

## Phase 1 — 계약·문서 정합 + 파생 가드 (`phase-1-auto-parity`)

범위 (**6파일**):

- `AGENTS.template.md` — 자율 진행 규칙을 **`phase` 제외** 형태로(DEC-1). 열거는 `req`·`merge`·`auto`.
- `docs/workflow.md` · `docs/workflow.en.md` — 각각 2곳:
  자율 진행 규칙 · 예산 축(`reviewBudget.onSoftLimit`) 안내.
- `scripts/req/req-next.ts` — `softLimitUpgradeHint` 주석만. 🔴 **동작 변경 0**(코드는 이미 `auto` 포함).
- `tests/helpers/autonomy-enumeration.ts` — **신규**. 순수 판별기
  `autonomyEnumerationProblem(contractText, allStopGates): string | null`.
  🔴 테스트 파일 안에 두지 않는다(REQ-2026-158 교훈 — 자기 자신을 검사하는 오라클이 된다).
- `tests/unit/agent-autonomy-contract.test.ts` — **추가만**(기존 단정 무수정):
  1. 실물: `AGENTS.template.md` + `stopGateValues()` → `null`
  2. 🔴 **파생 증명(합성 fixture)**: 합성 계약 문장 + `[...stopGateValues(), 'newgate']` → **problem**.
     실제 템플릿·실제 enum 을 건드리지 않으므로 `'stopGate 는 네 값이다'` 기존 단정이 대신 실패해 줄 수 없다.
  3. `phase` 가 **제외**로 적혀 있다
  4. 🔴 자율 규칙을 담은 문서 전수에 `req`·`merge` **만** 열거한 형태가 남아 있지 않다(DEC-3)

Exit:
- typecheck 0
- `agent-autonomy-contract` · `quickstart` · `req-next` green
- 🔴 **변이 검사 2종** — 둘 다 *새 가드가* red 여야 하고, 실패 지점을 출력으로 확인한다:
  1. 계약 문장에서 `` `auto` `` 만 지운다 → 실물 테스트 red(가드가 실재한다)
  2. 새 헬퍼를 **고정 문자열 비교로 바꾼다**(`['req','merge','auto']` 하드코딩) →
     **합성 fixture 테스트 red** · 실물 테스트는 green.
     🔴 이 조합이 나와야 "파생이 실제로 쓰인다"가 증명된다. 등록부(enum) 확장 변이는
     기존 `'네 값이다'` 단정이 먼저 red 라 증거가 되지 못한다(design-r01 P1).
- Codex phase 리뷰 승인

## 완료
- 게이트 해당분(typecheck·해당 시 lint) · **통합 직전 전체 스위트 1회** · 사용자 main 머지(별도 승인).
- 🔴 마지막 phase 를 커밋하기 **전에** 전체 스위트를 돌린다 — 커밋 뒤에는 티켓이 `dev-complete` 가 되어
  phase 를 더할 수 없다(REQ-2026-169 에서 겪어 micro-REQ 를 하나 더 만들었다).
