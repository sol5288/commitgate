# REQ-2026-145 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님).

> **테스트 실행 계층(REQ-2026-100)**: 게이트는 테스트를 **실행하지 않는다**.
> - **phase 진행 중**: 변경 영역 테스트 + `tests/unit/dispatch.test.ts`.
> - **통합 직전 1회**: **전체 스위트**(`npm test`) + `verify-range --strict`.

🔴 **선행**: 설계 승인 직후 `state.json` 의 `phases[]` 에 `phase-1-resolve-replace` 를 선언한다.

## Phase 1 — `--resolve replace` 배선 (`phase-1-resolve-replace`)

범위: `req:review-exception <REQ> --resolve replace --series "<id>" --reason "…" --confirm "…" [--run]`.
파싱·검증 · 기존 `closeSeriesHumanResolution` 호출 · `commitStateCheckpoint` · 안내 · 문서.

Exit:
- 🔴 **e2e(트리 clean): `--resolve replace --run` 직후 `req:new --successor-of --run` 이 다른 조작 없이
  성공**한다. 배선 끊김은 순수 테스트가 못 잡으므로 **실제 진입점을 두 번 연속 구동**한다(4회 실증).
- 🔴 **e2e(설계 문서 staged): 실제 hardCap 상태를 재현**해 ① `state.json` 기인 더러움이 0 이 되고
  ② 남은 경로가 **실제 값으로 열거**되며 ③ 파킹 커밋 후 `req:new` 가 성공하는 것을 확인한다(DEC-3b).
- 🔴 `--confirm` → `method`, `--reason` → `note` 에 **각각** 저장된다(서로 다른 값을 주고 대조).
  `decided_at` 은 **실제 시계**다(고정값 주입 금지 — REQ-2026-019 날조 폐기 이력).
- 🔴 `--series` 는 **`state.review_series` 에서 `series_id` 원문 대조**로 찾는다. 문자열 파싱 금지 —
  `phase#alpha` 처럼 `#` 이 든 phase id 에서 깨진다(변이 검사로 실증).
- 🔴 design series 와 phase series 가 **동시에 열린** 티켓에서 지정한 쪽만 닫힌다.
- 거부: 없는 series_id · 이미 닫힌 series · `--resolve` 값이 `replace` 아님 ·
  🔴 **`--reason`·`--confirm` 이 없거나 `trim()` 후 빈 문자열**(공백만 준 경우 — `note` 는 선택 필드고
  `isValidHumanResolution` 도 검사하지 않으므로 **verb 가 막지 않으면 빈 근거가 커밋된다**, r02 P1).
- 🔴 `--run` 없으면 **아무것도 쓰지 않는다**(dry-run 무부작용 — 실행 전후 state 바이트 동일).
- 🔴 안내 출력에 **`<` 가 없다**(고정 문자 부재 검사 — PowerShell 리디렉션으로 명령이 죽는다).
- 🔴 안내의 **CommitGate 명령 줄**은 전부 `npx commitgate ` 로 시작하고 `--run` 으로 끝난다.
  🔴 정리용 비-CommitGate 명령(`git commit …`)은 이 검사에서 **명시적으로 제외**한다 — 둘을 한 규칙으로
  묶으면 DEC-3b 의 파킹 안내를 낼 수 없고, 그러면 사용자가 막힌 자리에서 다음 명령을 못 받는다(r02 P1).
- 🔴 예산 로직 무변경 — `checkReviewBudget`·`budgetCounts` 는 이 REQ 의 diff 에 나타나지 않는다.
- 계약 스위트: `npx vitest run tests/unit/req-review-exception.test.ts tests/unit/dispatch.test.ts tests/unit/req-review-codex.test.ts`
- Codex 승인.

## 완료
- 게이트 해당분 · **통합 직전 전체 스위트 1회 + `verify-range --strict`**.
- 🔴 통합은 `stopGate: "auto"` 이므로 **사전 위임이 필요**하다 — 사람 승인 문장을 받아
  `req:delegate --scope ticket:REQ-2026-145 --source feat/req-2026-145-replace-decision-escape --sentence "…" --run`.
  `--allow-push`·`--allow-bypass` 는 주지 않는다(원격은 계속 별도 승인).
