# REQ-2026-029 리뷰 요청

## 배경

CommitGate 개선 **A-2b** — review lineage. A-2a(REQ-028, 예산 게이트)가 main `2bfb64a`에 병합됨.

A-2a가 escalate된 series를 "종료·대체 REQ"로 안내하지만, **그 결정이 기록되지 않고 대체 REQ가 예산을
어떻게 이어받는지 계약이 비어 있다.** 이 REQ가 **예산 세탁을 막는 실체**를 완성한다 — 대체 REQ는 새 예산을
받되(사람 결정), 누가·언제·무슨 문장으로 허용했는지가 숨겨지지 않는다.

**출처와 분할**: REQ-2026-026(통합 REQ-A)의 D6이 이 설계다(merge 금지 감사보존). A를 A-1(계수)·A-2a
(게이트)·A-2b(lineage)로 나눴고, 사용자 결정으로 로그 측정(⑫⑬⑭)은 **별도 REQ**로 남겼다. 이 REQ는
배분표 **③⑩⑪**까지만.

**026이 이 영역에서 이미 잡힌 결함을 처음부터 반영**:
- ③ human-resolution 뒤 같은 부모에서 새 series(0회)가 열려 lineage 우회 → §D2 **terminal 가드**
- ⑩ successor_of의 사람 결정 출처 없음(날조 통로) → §D3 **부모가 기록·자식이 읽음, 없으면 throw**
- ⑪ 손기록 형식 미검증 → §D1 **isValidHumanResolution**(A-2a `isValidIsoInstant` 재사용)

## 변경 요약

설계 문서 3종만(구현 diff 없음 — design 리뷰). 2 phase. **terminal이 먼저.**

- **phase-1 (D1·D2)**: `closed_reason`에 `'human-resolution'` 추가(A-2a 열린 확장). `HumanResolution`
  {decision('terminate'|'replace'), method, decided_at, note}. `closeSeriesHumanResolution`·
  `isValidHumanResolution`(형식+달력)·`isSeriesKeyTerminal`(순수). **terminal 가드**: human-resolution 키는
  `withAttemptRecorded`(강제 throw)·`req:next`(안내 AWAIT_HUMAN)가 새 series를 자동으로 안 연다.
  우선순위 G1→**terminal**→G3→G2. approved 뒤 재개방은 정상(대비).
- **phase-2 (D3)**: `req:new --successor-of <REQ>`. `resolveSuccessorLineage`(순수)가 부모에서
  `decision='replace'`+유효 형식 series를 찾아 `SuccessorOf`를 **부모에서 읽어** 채운다. 없으면 throw
  (티켓 미생성). 자식은 빈 review_series로 새 예산.

`recordAttempt`·`checkReviewBudget`·`consumeReviewException`·A-2a 게이트·G1·G2·승인 바인딩·
`machine.schema.json` **무변경**. terminal 가드는 추가(recordAttempt는 안 건드림 — R10).

## 리뷰 포인트

리뷰 포인트는 심사 범위의 하한이다.

1. **🔴 terminal 가드가 세탁을 실제로 막는가**(§D2·R4, 배분표 ③). human-resolution 키에서
   `withAttemptRecorded`가 recordAttempt **전에** throw하는가? 가드 없으면 recordAttempt가 새 series(0회)를
   열어 예산이 리셋되는데, 그 경로가 막혔는가? O1-4가 이를 잡는가?
2. **🔴 approved와 human-resolution의 재개방 규칙이 정반대인가**(§D2·O1-5). approved 뒤 재개방은 정상
   (A-1 유지), human-resolution 뒤는 terminal. terminal 가드가 approved까지 막으면 A-1을 깨는데, 그 구분이
   정확한가? `isSeriesKeyTerminal`이 approved 키에 false인가?
3. **🔴 손기록 형식 fail-closed**(§D1·R3, 배분표 ⑪). `isValidHumanResolution`이 decision enum·method 빈값·
   decided_at 비-ISO(달력 포함)를 각각 거부하는가? A-2a `isValidIsoInstant` 재사용이 맞는가?
4. **🔴 successor_of가 부모에서 읽히는가**(§D3·R7, 배분표 ⑩). `resolveSuccessorLineage`가 CLI 아닌 부모
   state에서 값을 채우는가? 부모에 replace 기록 없으면 throw(티켓 미생성)인가? 형식 위반 replace도 거부하는가?
5. **recordAttempt 무변경**(§D2·R10). 순수 계수 함수에 terminal 정책이 새어들지 않았는가? 가드가 그 앞에서
   막는 구조가 A-1 계약을 지키는가?
6. **우선순위 G1→terminal→G3→G2**(§D2). terminal이 G3보다 앞서는 게 맞는가(종결된 series는 예산 안내가
   아니라 "끝났다" 안내)? G1이 terminal보다 앞(dirty면 정리 먼저)?
7. **한계 정직성**(§D3·R9). `--successor-of` 없이 새 REQ 만드는 건 못 막는다고 명시했다. 이 한계 표기가
   정확한가? 막는 것과 못 막는 것의 경계가 분명한가?
8. **accept-risk 부재**(R11, 배분표 ④). `decision`이 terminate·replace 둘뿐인가? 위험 수용이 안 새는가?
9. **oracle**. O1-2~O1-6·O2-1~O2-5가 각 "→ 실패해야 하는 구현"을 실제로 실패시키는가? near-e2e가 우회
   없이 terminal 가드와 부모 검증을 태우는가?
