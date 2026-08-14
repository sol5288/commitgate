# REQ-2026-146 요구사항

## 무엇을

`req:next` 의 통합 안내를 **그 티켓의 실제 정책**에 맞춘다.

## 왜 — 실측(2026-08-14, REQ-2026-145 진행 중)

`stopGate: "auto"` 로 고정된 티켓에서 `req:next` 가 이렇게 말한다.

```text
[req:next] AWAIT_HUMAN  REQ-2026-145
  stopGate=merge 인데 이 feature 가 속한 delivery 묶음이 없다 — …
  … feature→main 통합은 사람 승인이 필요하다 — 경로(PR 또는 direct push)와
  승인 문장은 AGENTS.md 통제점표(I1/I2/B1)를 따른다.
```

같은 순간 `req:doctor` 는 `OK D32: 정지 정책 일치(stopGate="auto")` 라고 한다. **두 도구가 같은
티켓의 정책을 다르게 말한다.**

### 결함 1 — 정책명 하드코딩

`scripts/req/req-next.ts:904` 의 문자열이 `stopGate=merge` 로 **박혀 있다**. 이 분기는
`defersToIntegration`(= `merge` **또는** `auto`)에서 타는데, REQ-2026-140 이 `auto` 를 그 술어에
넣으면서 메시지를 갱신하지 않았다.

🔴 **전수 grep 확인**: `scripts/req`·`bin` 전체에서 `stopGate=` 를 문자열로 박은 자리는 **이 한 줄뿐**이고
나머지 6곳은 전부 실효값을 보간한다. 고립된 드리프트다.

### 결함 2 — `auto` 에서 **틀린 다음 명령**을 준다

`terminalIntegrationAction` 은 정책과 무관하게 I1/I2/B1 을 안내한다. 그런데 `auto` 에서는 사전 위임이
없으면 `integrate` 가 `denied(absent)` 로 **exit 1** 한다(REQ-2026-143 에서 실측). 즉 안내대로 승인
문장을 받아도 그 다음이 막힌다 — 필요한 것은 **`req:delegate`** 다.

🔴 이 저장소가 반복해 온 계열이다: **안내받은 대로 해도 그 상황에서 안 맞는다**
(REQ-092·093·141·142·145). 이번엔 도구가 스스로 만든 정책에서 그렇다.

## 제약

- 🔴 **정책 판정을 바꾸지 않는다.** `effectiveExecutionPolicy`·`defersToIntegration`·게이트는 무변경이다.
  이 REQ 는 **안내 문구와 다음 명령**만 고친다.
- 🔴 **`merge`·`req`·`phase` 무회귀.** 기존 정책의 안내는 한 글자도 바뀌지 않는다.
- 🔴 안내 명령은 **붙여넣으면 실행되는 형태**여야 한다 — 꺾쇠 자리표시자 금지(PowerShell 리디렉션),
  실제 REQ id·branch 를 박는다.

## 완료 기준

1. `auto` 티켓의 `req:next` 가 **`auto`** 라고 말한다.
2. `auto` 티켓의 다음 명령이 **`req:delegate`** 이고 실제 값이 **안전하게** 박혀 있다
   (따옴표 렌더링 · 안전하지 않은 값은 명령이 아니라 데이터로).
2b. **HIGH + auto** 는 `--high-risk` 를 포함한다 — 없으면 그 경로가 `high-risk-unacked` 로 막힌다.
3. `merge`·`req` 티켓의 안내는 **바이트 단위로 종전과 같다**.
4. 회귀 가드가 **정책마다 그 정책 이름을 말하는지** 고정한다 — 새 정책이 추가돼도 같은 드리프트가
   재발하지 않게.
