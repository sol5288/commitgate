# REQ-2026-174 요구사항

## 무엇

`stopGate: "auto"` + **티켓 scope**(delivery 묶음 없음) 종단에서 HIGH 티켓이 요구하는
사람 확인을 **둘에서 하나로** 줄인다. HIGH 승인은 **사전 위임의 `--high-risk`** 가 담는다.

## 왜 (코드로 확인한 사실)

`req-next.ts` 의 `auto`·`merge` 공통 종단이 `requireHighConfirm: true` 를 넘긴다.
그래서 HIGH 티켓은 몇 초 간격으로 **사람 문장 두 개**를 요구한다:

1. `req:confirm --scope … --run` — `user_commit_confirmed` 기록
2. `req:delegate … --high-risk --run` — 사전 위임 발급

그런데 `auto` + 티켓 scope 에서 **`user_commit_confirmed` 를 강제하는 게이트가 없다**:

| 지점 | 무엇을 보는가 | HIGH 를 막는가 |
|---|---|---|
| `req:commit` `userConfirmGate` | `defersToIntegration(stopGate)` 이면 **즉시 `{blocked:false}`** | ❌ (auto 포함) |
| `req:doctor` D28 | 같은 함수 | ❌ |
| `commitgate integrate` | 위임 행의 **`high_risk_ack`** | ✅ |

즉 이 경로에서 `req:confirm` 은 **화면상의 정지**일 뿐이고, 실제로 집행되는 것은 `--high-risk` 다.
`req-next.ts` 의 주석도 두 단계임을 인정하고 *"이 확인 **뒤에** 사전 위임이 하나 더 필요하다"* 고 적는다.

🔴 사용자가 `auto` 를 고른 이유는 **main 병합 직전 한 번만** 확인하기 위해서다.
   집행되지 않는 확인을 하나 더 요구하는 것은 그 설정을 무의미하게 만든다.

## 완료 기준

1. `auto` + **티켓 scope** 종단에서 HIGH 티켓의 `req:confirm` 정지가 사라진다 —
   다음 지점은 곧바로 **`--high-risk` 사전 위임 발급**이다.
2. 🔴 **HIGH 승인이 사라지지 않는다.** 위임에 `--high-risk` 가 없으면 `integrate` 가
   `high-risk-unacked` 로 그대로 막는다(기존 게이트, 손대지 않는다).
3. 🔴 **`merge` 는 바뀌지 않는다.** 그 값에는 위임이 없어 HIGH 승인을 담을 곳이 `req:confirm` 뿐이다.
4. 🔴 **delivery 묶음 경로도 바뀌지 않는다.** `commitgate delivery approve` 가 멤버의
   `user_commit_confirmed` 를 **실제로 읽는다**(`bin/delivery.ts`) — 그 경로의 확인은 집행된다.
5. 안내가 이 사실을 **말한다**: HIGH 승인이 어디에 담기는지(위임의 `--high-risk`).
6. 계약 문서(`AGENTS.template.md`)가 같은 것을 말한다.

## 비목표

- `req:confirm` 명령 자체의 변경·제거. 다른 `stopGate` 와 delivery 경로가 계속 쓴다.
- `user_commit_confirmed` 를 `req:confirm` 이 아닌 곳에서 쓰기.
  🔴 그 필드는 **`req:confirm` 만 쓴다**(시각을 실제 시계에서 읽기 위해 — REQ-2026-019 폐기 사유).
  `req:delegate` 가 대신 기록하게 만들지 **않는다**.
- HIGH 게이트 자체의 완화. `--high-risk` 요구는 그대로다.
