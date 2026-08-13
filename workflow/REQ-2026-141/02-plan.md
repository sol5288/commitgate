# REQ-2026-141 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

> **테스트 실행 계층(REQ-2026-100)**: 게이트는 테스트를 **실행하지 않는다**. 아래는 비용을 줄이기 위한 실행 시점 권고다.
> - **phase 진행 중**: 변경한 소스를 import하는 테스트만(빠른 피드백). 예: `grep -rl "<변경한 모듈>" tests/`
> - **통합(main 병합) 직전 1회**: **전체 스위트**. 범위 한정은 이것을 **대체하지 않는다** — 영향 분석은 놓친 회귀를 통과시킨다.

🔴 **순서의 근거**(설계 마지막 절): `runCli` 누락은 전체 스위트를 **확정적으로** red 로 두는 실결함이고,
finalize 교착은 **확률적**이다. 그래서 확정적인 것을 먼저 고친다.

## Phase 0 — 선행: `state.json` 의 `phases[]` 선언

🔴 **설계 승인 직후 첫 행동**이다(리뷰 r05 P1). 신규 티켓의 `phases[]` 는 빈 배열이라, 선언하지 않으면
`req:review-codex --kind phase --phase …` 가 **어느 phase 도 받지 않는다**. 아래 두 id 를 그대로 넣는다:

```
phase-1-runcli-and-push-tests · phase-2-close-stale-attempt
```

확인: `npx tsx scripts/req/req-next.ts 2026-141` 이 phase 진행을 안내한다.

## Phase 1 — dispatch 경계 수정 + push 배선 테스트 (`phase-1-runcli-and-push-tests`)

범위:
- `scripts/req/req-delegate.ts` — `export const runCli`(DEC-1).
- REQ-2026-140 phase-6에서 작성했던 push 배선 테스트 4종과 fake 확장을 **패치로 복원**(DEC-4):
  push 미위임 · push+bypass(2회 push) · 1차 push 실패 · 2차 push 실패.

Exit: `npx tsc --noEmit` 0 · `npx vitest run tests/unit/dispatch.test.ts tests/unit/integrate-delegation.test.ts tests/unit/integrate-verb.test.ts` · Codex 승인.

## Phase 2 — 열린 attempt 해소 경로 (`phase-2-close-stale-attempt`)

범위: `req:review-exception <REQ> --close-stale <series_id> --reason "…" --run` ·
**`lib/review-ledger.ts` 확장**(`OUTCOMES`에 `'abandoned'` · `OPTIONAL_LEDGER_KEYS`에 `stale_close_reason`(문자열)) ·
`attempt-closed(outcome=abandoned)` 행 append ·
**대상 `SeriesRecord` 정합화**(`attempts = max(…, N)` · `void_attempts += 1`) ·
`docs/workflow*.md` 복구 절차 · CHANGELOG.

검증 명령: `npx vitest run tests/unit/review-ledger.test.ts tests/unit/review-exception.test.ts`

Exit:
- 사유 부재·공백 거부 · 열린 attempt가 아니면 거부 · **`<REQ>` 없이는 실행 불가**
- 🔴 대상 state의 열린 series와 `series_id`가 **일치하지 않으면 거부**(엉뚱한 티켓을 닫지 않는다)
- 🔴 **정합화 검증**: 원장 `attempt-opened #N` + 해당 **`SeriesRecord.attempts` < N** 인 재현 상태에서
  close 후 그 record 의 `attempts >= N` 이고, **실제 재리뷰가 새 번호(#N+1)로 진행**된다(핵심 오라클)
- 🔴 **productive 회계 두 경우**(r04 observation):
  ① `attempts < N`(정합화 필요) → close 전후 productive **불변**
  ② `attempts === N`(정합화 불필요) → productive **1 감소**(판정 못 받은 회차가 예산을 놓아준다)
- 🔴 열린 attempt 가 둘 이상이면 **가장 이른 것**을 닫는다(재실행이 순서대로 해소)
- 🔴 `attempts`를 **줄이지 않는다** · 닫힌 사실이 `attempt-closed(outcome=abandoned)` 행에 남는다
- 🔴 **이 행 없이는 여전히 fail-closed**(탈출구가 기본을 열지 않는다)
- 🔴 **부분 실패 재실행 수렴**(DEC-3a): 원장에 abandoned 행만 있고 state 가 미정합인 상태에서
  `--close-stale` 재실행이 **새 행을 만들지 않고** state 만 맞추고 성공한다 · 완전 정합 상태에서는 no-op
- 🔴 **원장 호환**: `stale_close_reason` 키가 **없는** 기존 커밋 원장이 여전히 유효(선택 키 계약)
- 🔴 선택 키는 `null | string` 만 — 객체를 넣으면 손상 판정임을 테스트로 고정
- 🔴 이미 닫힌 attempt 를 다시 닫으면 **무결성 가드가 막는다**(자연키 중복)
- 🔴 `abandoned` 는 productive 가 아니다 — `autoBudget` 소비량이 변하지 않음을 고정
- Codex 승인.

## 후속 (이 REQ 밖)
🔴 **D10 finalize 예외**는 설계 DEC-2 대로 별도 REQ 다 — `archive_inventory` 생성·state pin·SHA 검증이
선행돼야 하고, 그것은 승인 증거 모델 변경이다.

## 완료
- 게이트 해당분 · **통합 직전 전체 스위트 1회** · REQ-2026-140과 함께 main 통합(사용자 승인 수령됨).
