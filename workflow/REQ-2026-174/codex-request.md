# REQ-2026-174 리뷰 요청

## 배경

`stopGate: "auto"` + 티켓 scope 종단에서 HIGH 티켓이 사람 문장을 **둘** 요구한다
(`req:confirm` → `req:delegate --high-risk`). 그런데 그 경로에서 `user_commit_confirmed` 를
**집행하는 게이트가 없다** — `req:commit` 의 `userConfirmGate` 는 `defersToIntegration` 이면
즉시 통과하고, `integrate` 는 위임의 `high_risk_ack` 만 본다.

## 변경 요약

`auto` + 티켓 scope 에서만 `requireHighConfirm` 을 끄고, HIGH 승인을 **사전 위임의 `--high-risk`** 로 모은다.
집행 게이트(`high-risk-unacked`)는 손대지 않는다.

## 리뷰 포인트

1. 🔴 **승인이 정말 옮겨지는가, 사라지는가.** `auto` + 티켓 scope 에서 `user_commit_confirmed` 를
   읽는 곳이 정말 없는지 전수로 봐 달라. 하나라도 있으면 이 변경은 **게이트를 여는 것**이 된다.

2. 🔴 **`merge` 와 delivery 묶음이 정말 안 바뀌는가.** 조건을 `stopGate === 'merge'` 로 좁혔는데,
   `auto` + 묶음 있음 경로가 그 분기에 도달하지 않는다는 전제가 맞는지.
   `bin/delivery.ts` 가 멤버의 `user_commit_confirmed` 를 읽는 경로가 영향받지 않는지.

3. **DEC-2 의 함수화가 옳은가.** `highRiskCarriedByDelegation` 이 `stopGate === 'auto'` 하나인데,
   그것을 함수로 두는 것이 이득인지 아니면 간접만 늘리는지.

4. 🔴 **정직성.** 확인이 하나로 모였다는 사실을 안내와 계약이 충분히 말하는지 —
   "감춰진 완화"가 되지 않으려면 무엇이 더 필요한지.

5. **DEC-5 기각이 옳은가.** `req:delegate` 가 `user_commit_confirmed` 를 함께 기록하게 하는 절충을
   기각했다(그 필드는 `req:confirm` 만 쓴다 — 시각 날조 방지). 그 판단이 맞는지.
