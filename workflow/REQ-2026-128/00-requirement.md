# REQ-2026-128 요구사항

## 무엇

`stopGate: "merge"` 를 쓰는데 이 REQ 가 **어떤 delivery 묶음에도 속하지 않을 때**, `req:next` 종단이
`DONE` 이 아니라 `req` 와 **같은** `AWAIT_HUMAN`(통합 feature→main)으로 멈추게 한다.
그 지점에서 HIGH 위험 티켓은 `req:confirm` 사람 확인을 요구한다.

## 왜

`stopGate` 는 "사람이 어디서 멈추는가"의 의미 SSOT 인데(REQ-2026-063 DEC-1, REQ-2026-071),
`merge` 는 묶음이 있을 때만 그 약속을 지킨다. 묶음이 없으면 두 가지가 무너진다.

1. **정지 지점 소실.** `req:next` 종단이 `DONE` + "묶음을 찾지 못했다"로 끝난다
   (`req-next.ts` 종단, REQ-2026-066 DEC-10). `req` 는 같은 자리에서 `AWAIT_HUMAN`(통합)을 내는데
   `merge` 만 안 낸다 — **더 늦게 멈추겠다고 고른 값이 오히려 아무 데서도 안 멈춘다.**
   사용자 관찰: "setup 에서 정한 값이 케이스마다 다르게 해석된다."
2. **HIGH 확인 공백(실결함).** `merge` 에서 `userConfirmGate` 는 커밋을 막지 않고(`req-commit.ts`),
   HIGH 사람 확인은 `delivery integrate` 자격검사에서만 요구된다(`bin/delivery.ts`).
   묶음이 없으면 **어느 게이트도 `req:confirm` 을 요구하지 않는다** → HIGH 티켓이 확인 기록 0건으로
   통합 지점에 도달한다.

부수적으로, 안내와 도구가 갈라져 있다: 이 자리에서 `--scope req` 를 안내해도 `req:confirm` 은
`REQUIRED_CONFIRM_SCOPE[merge] === 'delivery'` 만 받으므로 **거부**한다.

## 제약

- 🔴 **`merge` 의 존재 이유를 지운다.** 묶음이 **열려 있거나 다른 member 가 남았을 때**(`kind: 'continue'`)는
  `DONE` 을 유지한다 — 거기서 멈추면 "묶음이 끝날 때까지 미룬다"가 REQ 단위 정지로 되돌아간다.
- 🔴 **커밋 지점은 건드리지 않는다.** `merge` 는 커밋에서 멈추지 않는다는 계약을 유지한다
  (`userConfirmGate` 무변경). 확인은 **종단**으로 모인다.
- 🔴 **확인을 도구가 만들지 않는다.** 위조 금지(REQ-2026-019 폐기 사유). 종단은 안내만 하고,
  기록은 사람이 `req:confirm` 으로 남긴다.
- 묶음이 있는 경로(`await-human`·`corrupt`)의 현행 동작은 무변경.

## 완료 기준

- `stopGate:'merge'` + `deliveryGate === null` + 모든 phase 종결 → `AWAIT_HUMAN`(통합), `DONE` 아님.
- 같은 조건 + `risk_level === 'HIGH'` + 확인 미기록 → `req:confirm --scope req` 를 안내하는 `AWAIT_HUMAN`.
- 그 안내대로 실행한 `req:confirm --scope req` 가 `stopGate:'merge'` 에서 **성공**한다(안내↔도구 정합).
- `kind: 'continue'` 는 `DONE` 유지, `await-human`·`corrupt` 는 현행 유지.
- 확인 scope 판정이 **함수 하나**에서 나온다(네 소비자 공유).
