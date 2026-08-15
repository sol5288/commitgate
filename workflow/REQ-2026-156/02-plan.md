# REQ-2026-156 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고.

> **테스트 실행 계층(REQ-2026-100)**: 게이트는 테스트를 **실행하지 않는다**.
> - **phase 진행 중**: 변경 영역 테스트 + `tests/unit/dispatch.test.ts`.
> - **통합 직전 1회**: **전체 스위트**(`npm test`) + `bin/verify-range.ts --base main --head HEAD --strict`.
>   🔴 계약 스위트만 돌리면 **반대 계약을 고정한 기존 테스트**를 놓친다(REQ-2026-155 에서 실제로 밟았다).

🔴 **선행**: 설계 승인 직후 `state.json` 의 `phases[]` 에 아래 id 를 선언한다.

```
phase-1-checkpoint-window-guard
```

## Phase 1 — checkpoint 창 가드 (`phase-1-checkpoint-window-guard`)

범위: `inCheckpointWindow`·`stateWriteBlocked` 신설 · 네 verb 배선 · parity 테스트 정정.

Exit:
- 🔴 **결함 1 재현 e2e**: **evidence 결속이 든 실제 checkpoint 창 fixture**에서 네 verb 의 `--run` 이
  각각 **거부**하고 **state 바이트·HEAD SHA 가 불변**이다. (지금은 넷 다 통과해 결속을 깬다.)
  fixture 는 `evidence-recovery-wiring.test.ts` 의 `boundFixture`(HEAD 에 `consumed_state_sha256`,
  워킹에 소비 state)와 같은 모양이어야 한다 — 임의로 만든 상태로는 이 결함을 재현하지 못한다.
- 🔴 **복구 자신은 막히지 않는다**: 같은 fixture 에서 `req:commit --finalize --run` 이 **성공**하고
  커밋된 state 해시가 매니페스트 결속과 **일치**한다. 유일한 나갈 길이다.
- 🔴 **창 ① 무회귀**: `pending_evidence_for` 가 살아 있는 상태의 기존 거부 테스트가 그대로 통과한다.
- 🔴 **평시 무회귀**: 두 창 중 어느 것도 아닐 때 네 verb 가 종전대로 동작한다. 특히
  **승인 직후(핀 있음)** 는 ①이라 막히고, **소비·checkpoint 가 모두 끝난 뒤**는 막히지 않는다.
- 🔴 **dry-run 무회귀**: `--run` 없는 호출은 두 창 모두에서 동작한다.
- 🔴 **HEAD blob 을 못 읽으면 ②는 false 다** — 티켓의 `approvals.jsonl` 이 HEAD 에 아예 없는 경우다
  (아직 증거를 커밋한 적 없음). 추가 안전장치가 새 교착을 만들면 안 된다.
  🔴 **"부모 없음"은 여기에 포함되지 않는다**(설계 r02 P1: 두 항목이 서로 반대였다). 루트 커밋이
  소비 행을 추가했다면 그것은 **정상적인 창 ②**이고 아래 항목대로 A=true 다.
- 🔴 **순수 술어 전수**: `inCheckpointWindow` 를 A·B 조합 4가지로 검사한다
  (A만·B만·둘 다·둘 다 아님).
- 🔴 **부모가 없으면 A 는 true 다**(설계 r01 관찰로 정정). `consumedKeysAddedByHead(head, '')` 는
  HEAD 의 소비 행을 **새 행으로** 본다 — 루트 커밋이 그 행을 추가했다면 그것이 곧 창 ②이므로
  **의미상으로도 옳다**. `planEvidenceRecovery` 의 checkpoint 분기가 이미 같은 규약을 쓴다.
  🔴 부재와 "부모가 비어 있음"을 구별하는 사실(`parentAvailable`)을 **새로 만들지 않는다** —
  두 경우의 판정이 같아야 하므로 구별할 이유가 없다. 회귀 테스트로 그 규약을 고정한다.
- 🔴 **D10 예외 표면 무회귀**: `lib/evidence-recovery` 를 verb 가 직접 import 하지 않는다(기존 구조
  가드 유지). 🔴 그리고 **그 가드의 주석에 구별을 명시**한다 — "예외를 여는 것"과 "창을 아는 것"은
  다르다. 우회처럼 보이지 않게 하는 것이 이 항목의 목적이다.
- 🔴 **dry-run preview 는 건드리지 않는다**(요구 문서의 반증): `.review-preview.txt` 는 gitignored 라
  `dirtyPaths` 에 들어가지 않는다. 그 근거를 **주석과 회귀 테스트**로 남긴다 —
  `git check-ignore` 로 ignored 임을 확인하는 테스트 1건.
- 🔴 **DEC-2 parity 정정**: 비교 기준을 실제 호출부와 **동일**하게 만든다(정규화·빈 조각 필터 없음).
  둘이 달라지면 그 차이가 실재하는지 판정해 **호출부를 고치거나 사실을 테스트에 적는다**.
  🔴 **POSIX 리터럴 역슬래시 fixture** 로 검사한다(win32 는 사유 출력 후 skip).
- 🔴 **변이 검사 3건**: ① `inCheckpointWindow` 를 `false` 로 고정하면 네 verb e2e 가 red
  ② A 또는 B 판정을 지우면 순수 테스트가 red ③ parity 비교 기준에 정규화를 되돌리면 red.
- 계약 스위트: `npx vitest run tests/unit/recovery-window.test.ts tests/unit/repolicy-verb.test.ts tests/unit/req-review-exception.test.ts tests/unit/req-review-codex.test.ts tests/unit/req-commit.test.ts tests/unit/evidence-recovery-wiring.test.ts tests/unit/dispatch.test.ts`
- Codex 승인.

## 완료
- 게이트 해당분 · **통합 직전 전체 스위트 1회 + `verify-range --strict`** · CHANGELOG.
- 🔴 CHANGELOG 는 **REQ-2026-155 가 창 하나만 막았다**는 것을 감추지 않는다. 그리고 검토의 하위
  주장(dry-run preview)이 **반증됐다**는 것도 적는다 — 고치지 않은 이유가 기록에 남아야 한다.
- 🔴 이 브랜치는 **REQ-2026-155 위에** 쌓여 있다 — 병합하면 155 도 함께 들어간다. 통합 요청 시 밝힌다.
- 통합은 `stopGate: "auto"` 다. 사전 위임 또는 `[B1]` direct push 를 사람이 승인한다.
