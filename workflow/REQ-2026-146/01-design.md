# REQ-2026-146 설계

## 현재 상태 (실측)

| 자리 | 현재 |
|---|---|
| `req-next.ts:904` | `prefix: 'stopGate=merge 인데 …'` — **하드코딩**. `defersToIntegration` 분기라 `auto` 도 여기로 온다 |
| `req-next.ts:1056` `terminalIntegrationAction` | 정책과 무관하게 I1/I2/B1 안내. `command` 없음 |
| `req-next.ts:1040` (HIGH 분기) | `stopGate="${input.stopGate}"` — **이미 보간한다**(대조군) |
| `bin/integrate.ts` | `auto` + 위임 없음 → `denied(absent)` **exit 1** |
| `req-doctor.ts:1161` D32 | `정지 정책 일치(stopGate="${effective}")` — 보간 |

전수 grep: `stopGate=` 문자열 박음은 **904 한 줄뿐**. 나머지 6곳은 보간한다.

## DEC-1 — 정책명은 **실효값에서 뽑는다**

```ts
prefix: `stopGate=${input.stopGate} 인데 이 feature 가 속한 delivery 묶음이 없다 — …`
```

🔴 **문자열을 고치는 것으로 끝내지 않는다.** 같은 드리프트가 재발하지 않으려면 "정책마다 그 정책
이름을 말한다"가 **테스트로 고정**돼야 한다(REQ-2026-104 교훈 — 새 절 추가 ≠ 갱신).

## DEC-2 — `auto` 는 **다른 다음 명령**을 준다

`terminalIntegrationAction` 이 `input.stopGate` 로 갈린다.

| 정책 | 통제점 | 다음 명령 |
|---|---|---|
| `req`·`merge` | 통합(feature→main) | **없음**(사람이 경로를 고른다 — 종전과 동일) |
| **`auto`** | **사전 위임 발급** | 아래 형태 — REQ id·branch 는 그 티켓의 실제 값이 박힌다 |

```sh
npx commitgate req:delegate --scope ticket:REQ-2026-146 --source "feat/req-2026-146-stopgate-message-drift" --sentence "REQ-2026-146 local merge 사전 위임 승인" --run
```

- 🔴 `auto` 의 안내는 **왜 위임이 필요한지**를 함께 말한다: 위임이 없으면 `integrate` 가
  `denied(absent)` 로 멈춘다. 명령만 주면 사용자는 그것이 선택인지 필수인지 모른다.
- 🔴 **`--allow-push`·`--allow-bypass` 를 안내에 넣지 않는다.** 기본이 불허인 것이 안전 속성이고,
  안내에 있으면 그게 기본 답이 된다(REQ-2026-140 DEC-6 과 같은 이유).
- 🔴 `--sentence` 자리는 **따옴표 안**에 둔다. 꺾쇠는 PowerShell 에서 리디렉션이라 명령이 죽는다.
- REQ id·branch 는 **실제 값**을 박는다. branch 는 `state.branch` 에서 온다.

### DEC-2a — 🔴 HIGH 티켓은 `--high-risk` 가 **필수**다(설계 r01 P1)

`--allow-push`·`--allow-bypass` 와 달리 `--high-risk` 는 **넣지 않으면 그 경로가 막힌다**.
HIGH + `auto` + 위임 있음에서 `--high-risk` 가 없으면 `integrate` 는 `denied(high-risk-unacked)` 로
멈춘다. 즉 안내대로 해도 다음이 막히는 — **이 REQ 가 고치려는 결함과 같은 모양**이 된다.

| 위험도 | 안내하는 명령 |
|---|---|
| LOW | `… --sentence "승인 문장" --run` |
| **HIGH** | `… --sentence "승인 문장" --high-risk --run` + **왜 필요한지 한 줄** |

🔴 두 플래그 부류를 구별하는 기준: **`--high-risk` 는 그 티켓이 이미 HIGH 라는 사실의 확인**이고,
`--allow-push`·`--allow-bypass` 는 **권한 확대**다. 앞의 것은 안내하고 뒤의 것은 안내하지 않는다.

### DEC-2b — 🔴 실제 값은 **안전하게 렌더링**한다(설계 r01 P1)

`branchPrefix` 는 임의 문자열이고 git ref 는 `;` 를 허용한다. `--source ${branch}` 를 무인용으로
보간하면 `feat/req-;whoami-…` 같은 branch 가 **붙여넣는 순간 별도 명령으로 실행**된다.

- 값은 **큰따옴표로 감싸** 렌더링한다: `--source "feat/req-2026-146-x"`.
- 🔴 그것으로 충분하지 않은 값(따옴표 `"`·백틱`` ` ``·`$` 포함)은 **명령으로 렌더링하지 않는다**.
  대신 값을 **데이터로 따로 보여 주고** 사람이 직접 넣도록 한다. 안전하게 못 만들면 만들지 않는다 —
  실행 가능한 안내가 목표지만 **실행되면 안 되는 것을 실행 가능하게 만드는 것은 목표가 아니다**.
- 이 판정은 순수 함수로 두고, 특수문자 branch 회귀 테스트로 고정한다.

## DEC-3 — `merge`·`req` 는 **바이트 단위로 무회귀**

이 REQ 의 첫 번째 오라클이다. `auto` 분기를 추가하되 다른 정책의 `detail`·`controlPoint`·
`approvalSentence` 문자열은 **한 글자도 바뀌지 않는다**.

🔴 `prefix` 의 `${input.stopGate}` 보간은 `merge` 티켓에서 `stopGate=merge` 를 그대로 만든다 —
**같은 문자열이 나오는지 테스트로 확인한다**(보간으로 바꾼 뒤 값이 달라지면 그건 회귀다).

## DEC-4 — 회귀 가드: 정책마다 **자기 이름**을 말한다

```ts
// 🔴 배열 리터럴이 아니라 Record<StopGate, …> 다 — 값이 늘면 **컴파일이 깨진다**.
const EXPECT: Record<StopGate, { self: string }> = { phase: …, req: …, merge: …, auto: … }
for (const sg of Object.keys(EXPECT) as StopGate[]) → 안내가 자기 정책 이름만 담는다
```

- 🔴 고정 문자열 하나(`'stopGate=merge'`)를 금지어로 두는 것으로 **끝내지 않는다**. 그러면 다음에
  `auto` 를 박아도 안 잡힌다. **각 정책의 산출물이 자기 이름만 담는지**를 본다.
- 🔴 **배열 리터럴로 순회하지 않는다**(설계 r01 관찰). `['phase','req','merge','auto']` 는 값이 늘어도
  조용히 그대로 돈다 — 등록부-강제가 아니다. `Record<StopGate, …>` 로 두면 새 값이 추가되는 순간
  **타입 검사가 깨져** 테스트를 갱신하지 않을 수 없다(REQ-2026-099 교훈).

## Phase 분해

| phase | 범위 |
|---|---|
| `phase-1-policy-aware-guidance` | 904 보간 · `terminalIntegrationAction` 의 `auto` 분기 · 회귀 가드 · CHANGELOG |

한 phase 다 — 파일 2개(`req-next.ts` + 테스트) + CHANGELOG.

## 변경 파일

`scripts/req/req-next.ts` · `tests/unit/req-next.test.ts`(또는 신규) · `CHANGELOG.md`

## 안전

- 정책 **판정**(`effectiveExecutionPolicy`·`defersToIntegration`·`requiredConfirmScope`)은 무변경.
- `bin/integrate.ts` 무변경 — 이 REQ 는 안내만 고친다. 위임 없는 `auto` 가 막히는 것은 **정상**이고
  그대로 둔다.
- 🔴 `auto` 안내가 `req:delegate` 를 가리키게 되지만, **위임 발급 자체는 여전히 사람의 문장**이 필요하다.
  안내가 그 문장을 대신 만들어 주지 않는다.
