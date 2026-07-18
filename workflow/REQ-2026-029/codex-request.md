# REQ-2026-029 phase-1 리뷰 요청

## 배경

CommitGate 개선 **A-2b phase-1** — human-resolution terminal. 설계는 design-r01 승인(1라운드 수렴).
A-2a(예산 게이트)가 main `2bfb64a`에 병합됨. 이 phase는 배분표 ③⑪ — 예산 세탁 방지의 종결 절반.

A-2a가 escalate를 "종료·대체 REQ"로 안내하지만 그 결정이 기록되지 않는다. 이 phase는 사람 종결을
**부모 series에 기록**하고, 그 키를 **terminal**로 만들어 자동 재개(새 series 0회 개방 = 예산 리셋)를 막는다.

## 변경 요약 (phase-1-human-resolution-terminal)

`review-codex.ts` + `req-next.ts` + 테스트. D1·D2.

- **`SeriesRecord.closed_reason`에 `'human-resolution'` 추가**(A-2a 열린 확장). `HumanResolution`
  {decision('terminate'|'replace'), method, decided_at, note}.
- **순수 함수**: `isValidHumanResolution`(형식 fail-closed — decision enum·method 비어있지 않음·
  `isValidIsoInstant` decided_at, A-2a 재사용). `closeSeriesHumanResolution`(열린 series 종결, 무효면 throw).
  `isSeriesKeyTerminal`(human-resolution 레코드 있으면 true; approved/null은 false — 재개방 정상).
- **terminal 가드 두 곳**: `withAttemptRecorded`가 예산 게이트 **앞**에서 terminal이면 throw(recordAttempt
  도달 안 함 — 새 series 안 열림). `req:next` `gateRunCandidate`가 G1 다음·G3 앞에서 terminal이면
  AWAIT_HUMAN(종결 — 대체 REQ 안내). 우선순위 **G1 → terminal → G3 → G2**.

`recordAttempt`·`checkReviewBudget`·`consumeReviewException`·A-2a G3·G1·G2·승인 바인딩·
`machine.schema.json` **무변경**. terminal 가드는 추가.

게이트: typecheck 0, 단위 1120/1120 green.

## 리뷰 포인트

리뷰 포인트는 심사 범위의 하한이다.

1. **🔴 terminal 가드가 세탁을 실제로 막는가**(배분표 ③). O1-4가 human-resolution 키에서
   `withAttemptRecorded`가 recordAttempt **전에** throw(새 series 안 열림, call 도달 안 함, state 미기록)를
   확인하는가? 가드 없으면 recordAttempt가 새 series(0회)를 열어 예산이 리셋되는데, 그게 막혔는가?
2. **🔴 approved vs human-resolution 재개방 규칙이 정반대인가**(O1-5). approved 뒤는 새 series 정상 열림
   (A-1 유지), human-resolution 뒤는 terminal. `isSeriesKeyTerminal`이 approved 키에 false인가? 가드가
   approved까지 막지 않는가?
3. **🔴 형식 fail-closed**(배분표 ⑪). `isValidHumanResolution`이 decision enum(accept-risk 거부)·method 빈값·
   decided_at 비-ISO(달력 `2026-99-99` 포함)를 거부하는가? 밀리초 유효값은 통과? `closeSeriesHumanResolution`도
   무효 resolution이면 throw?
4. **recordAttempt 무변경**(R10). 순수 계수 함수에 terminal 정책이 안 새는가? 가드가 그 앞에서 막는 구조가
   A-1 계약을 지키는가?
5. **우선순위 G1→terminal→G3→G2**. terminal이 G3보다 앞(종결된 series는 예산 안내가 아니라 "끝났다")·
   G1이 terminal보다 앞(dirty면 정리 먼저)이 맞는가? O1-6이 이를 확인하는가?
6. **accept-risk 부재**(배분표 ④). `decision`이 terminate·replace 둘뿐인가?
7. **oracle**. O1-1~O1-7이 각 "→ 실패해야 하는 구현"을 실제로 실패시키는가? O1-4 near-e2e(state 미기록)가
   가드 우회를 잡는가?
