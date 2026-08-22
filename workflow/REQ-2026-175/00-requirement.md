# REQ-2026-175 요구사항

## 무엇

`req:next` 가 **`req:commit` 이 거부할 명령을 지시하지 않게** 한다.
종결된 티켓(`dev-complete`·`migrated-complete`·`abandoned`)에서는 `req:commit --run` 대신
**실제로 실행 가능한 다음 단계**를 안내한다.

## 왜 (이 저장소에서 실제로 겪은 사실)

REQ-2026-169 진행 중, 전체 스위트가 잡은 결함을 고쳐 phase-3 을 커밋하려 할 때:

```
$ npm run req:next -- 2026-169
[req:next] RUN  REQ-2026-169
  phase 승인이 살아 있다(LOW · 자동 커밋). … 실행하라.
  $ npm run req:commit -- 2026-169 --run -m "…"

$ npm run req:commit -- 2026-169 --run -m "…"
Error: REQ-2026-169 는 이미 dev-complete 입니다 — 완료된 티켓에는 새 작업을 붙이지 않습니다.
```

**한 도구가 지시한 명령을 다른 도구가 거부한다.** `req:next` 는 `RUN`(= 계약상 "묻지 말고 실행")을
냈고, 그대로 실행한 사용자는 막혔다.

🔴 이 저장소가 반복해서 데인 유형이다 — *"안내한 탈출구가 실행 불가"*(REQ-2026-149·152·159).
   `req:next` 는 **"다음 행동을 추측하지 마라, 도구가 계산해 준다"** 는 계약의 근거인데,
   그 계산이 틀리면 계약 자체가 무너진다.

## 원인

| 도구 | 판정 입력 | 종결 티켓을 아는가 |
|---|---|---|
| `req:commit` | `scanTicketIntake(...).baseState` → `terminalReentryProblem` | ✅ |
| `req:next` | `state.json` + git 워킹 상태 | ❌ **HEAD 종결 증거를 보지 않는다** |

`terminalReentryProblem` 은 이미 **순수 함수로 export** 돼 있는데 `req:next` 가 쓰지 않는다.

## 완료 기준

1. 종결 티켓에서 `req:next` 가 **`req:commit --run` 을 지시하지 않는다.**
2. 🔴 안내는 `req:commit` 의 거부 문구와 **같은 생성기**(`terminalReentryProblem`)에서 나온다 —
   두 곳이 각자 문구를 만들면 다시 갈라진다(REQ-2026-072 가 같은 결론에 도달했다).
3. 🔴 **비용을 정상 경로에 지우지 않는다.** 종결 판정은 `req:commit` 명령을 낼 자리에서만 계산한다.
4. 🔴 **판정 불가는 종전 동작**이다 — HEAD 증거를 읽지 못하면 지금처럼 안내한다(무회귀).
   모른다고 막으면 정상 흐름이 죽는다(여기는 **안내** 지점이지 차단 지점이 아니다).
5. 종결이 아닌 티켓의 동작은 **한 줄도 바뀌지 않는다**.

## 비목표

- `terminalReentryProblem` 판정 자체·`req:commit` 거부 동작의 변경. 안내를 맞출 뿐이다.
- 완료된 티켓에 phase 를 덧붙일 수 있게 하는 것. 🔴 그 게이트는 **옳다** —
  고치는 것은 "막힌다"가 아니라 "막힐 것을 하라고 시킨다"이다.
