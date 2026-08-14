# REQ-2026-146 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님).

> **테스트 실행 계층(REQ-2026-100)**: 게이트는 테스트를 **실행하지 않는다**.
> - **phase 진행 중**: 변경 영역 테스트 + `tests/unit/dispatch.test.ts` + 정책 구조 가드.
> - **통합 직전 1회**: **전체 스위트**(`npm test`) + `verify-range --strict`.

🔴 **선행**: 설계 승인 직후 `state.json` 의 `phases[]` 에 `phase-1-policy-aware-guidance` 를 선언한다.

## Phase 1 — 정책 인지 안내 (`phase-1-policy-aware-guidance`)

범위: `req-next.ts:904` 정책명 보간 · `terminalIntegrationAction` 의 `auto` 분기 · 회귀 가드 · CHANGELOG.

Exit:
- 🔴 **`auto` 티켓의 안내가 `auto` 라고 말한다** — 실측 재현(`stopGate=merge` 가 나오면 실패).
- 🔴 **`auto` 의 다음 명령이 `req:delegate`** 이고 **실제 REQ id·branch 가 박혀** 있다.
  꺾쇠(`<`)가 없고, `--allow-push`·`--allow-bypass` 가 **들어 있지 않다**.
- 🔴 **HIGH + auto 는 `--high-risk` 가 들어 있다**(DEC-2a). 없으면 integrate 가
  `denied(high-risk-unacked)` 로 막혀, 안내대로 해도 다음이 막힌다. LOW 에는 들어 있지 않다.
- 🔴 **branch 는 따옴표로 감싸 렌더링**한다. `;`·공백이 든 branch 로 회귀 테스트하고,
  `"`·백틱·`$` 가 든 값은 **명령으로 렌더링하지 않고 데이터로 보여 준다**(DEC-2b).
- 🔴 **`merge`·`req` 무회귀 — 바이트 단위 대조.** `detail`·`controlPoint`·`approvalSentence` 가
  이 REQ 전과 정확히 같다(보간으로 바꾼 뒤에도 `merge` 는 `stopGate=merge` 를 그대로 낸다).
- 🔴 **등록부-강제 회귀 가드**: `Record<StopGate, …>` 로 순회한다 — 배열 리터럴이면 값이 늘어도
  조용히 통과한다. 각 정책의 안내에 **다른 정책 이름이 섞이지 않는지** 본다.
  고정 문자열 금지어 하나로 끝내지 않는다 — 그러면 다음 값에서 또 뚫린다.
- 🔴 **변이 검사**: 904 를 다시 `'stopGate=merge'` 로 되돌리면 가드가 실제로 red 여야 한다.
- 정책 판정 무변경 — `effectiveExecutionPolicy`·`defersToIntegration`·`requiredConfirmScope` 는
  이 REQ 의 diff 에 나타나지 않는다.
- 계약 스위트: `npx vitest run tests/unit/req-next.test.ts tests/unit/dispatch.test.ts tests/unit/stopgate-auto-equivalence.test.ts`
- Codex 승인.

## 완료
- 게이트 해당분 · **통합 직전 전체 스위트 1회 + `verify-range --strict`**.
- 🔴 통합은 `stopGate: "auto"` 다. 사전 위임을 받거나(사람 승인 문장 필요) `[B1]` direct push 를
  사람이 승인한다 — 어느 쪽이든 **사람의 결정**이다.
