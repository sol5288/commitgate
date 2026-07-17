# REQ-2026-025 리뷰 요청

## 배경

CommitGate **리뷰 수렴·배송 안정화 개선 A0**. 순서는 A0 → A → B → 측정 → (조건부) C이며 각 REQ는 독립 병합된다.

해결 대상은 **drip-feed** — 유효한 P1이 라운드당 한 건씩 나와 직렬 재검수를 낳았다(REQ-020 design 14라운드
반려 9회 전부 1건, REQ-023 8라운드 r03~r06 각 1건, REQ-013 17라운드).

설계는 design-r01 승인(findings 0). **phase-1은 r02 승인·커밋 완료**(`1c0c8d7`) — persona에 전수반환 의무·
REVIEW_KIND별 관점·R3 경계를 넣었다. 이 요청은 **phase-2 리뷰**다.

## 변경 요약 (phase-2-review-call-log)

D2~D6 구현. **측정 로그만 추가하고 리뷰 판정 경로는 건드리지 않는다.**

- **D2 `reviewPolicyVersion(persona)`** — `sha256(persona 본문)` 앞 12자. persona 비활성(null)이면 `'none'`.
  수동 상수 bump를 쓰지 않는다(고치고 올리기를 잊으면 세그먼트가 조용히 거짓 — REQ-019 날조 폐기 이력).
- **D3 `.gitignore`에 `workflow/.review-calls.jsonl`** — 로컬 관측용, **커밋 대상 아님**.
- **`buildReviewCallLogRow`** — verdict를 받되 **개수만** 꺼낸다. 내용 배제 경계가 여기다(R7).
- **`appendReviewCallLog`** — JSONL append. **실패를 삼킨다**(R8 — 로그는 승인 근거가 아니므로 게이트가 아니다).
- **D4 `main()` 배선** — `resolveReviewOutcome`·`writeState` 직후 1행. `approvedAt` 재사용(새 시계 안 읽음).
  `archiveRound`는 아카이브를 남긴 경우에만 값, 무효 응답은 `null`.

`machine.schema.json`·승인 바인딩·`classifyReview`·persona **무변경**. `series`·`attempt`·`lineage`·
`full_review`는 **정의하지 않는다**(REQ-A/B 범위, R9).

게이트: typecheck 0, 단위 1057/1057 green (REQ-025 오라클 15/15).

## 리뷰 포인트

리뷰 포인트는 심사 범위의 하한이다. 아래에 없는 결함도 지적하라.

1. **내용 배제가 실제로 성립하는가** (R7·D3). `buildReviewCallLogRow`가 verdict를 인자로 받는다 —
   `detail`·`file`·`next_action`이 행에 샐 경로가 남아 있는가? O2-3은 표식 문자열의 **부재**와 개수의
   **정확성**을 함께 단언한다. 이 오라클이 "verdict 통째 덤프" 구현을 실제로 잡는가?

2. **실패 격리가 fail-closed를 침식하지 않는가** (R8·D5). `appendReviewCallLog`가 모든 예외를 삼킨다.
   "로그는 승인 근거가 아니므로 게이트가 아니다"라는 판단이 맞는가? 삼키면 안 되는 예외가 섞여 있는가?

3. **`policy_version`을 persona 해시로 파생하는 선택** (D2). 세그먼트 목적에 충분한가? persona가 `null`일
   때 `'none'`으로 뭉개는 것이 관측을 왜곡하는가?

4. **배선 지점과 누락 범위** (D4). `writeState` 직후에 기록하므로, 리뷰어 무수정 검증(`:1438`~`:1443`)에서
   throw되면 행이 없다. A0 목적(라운드당 P1 수 관측)에 이 누락이 문제인가? `archive_round`가 무효 응답에서
   `null`인 것이 집계에 모호함을 남기는가?

5. **gitignore 선택이 측정을 훼손하지 않는가** (D3·R7). 로그를 커밋하지 않으므로 clone·CI에는 데이터가
   없다. 측정 단계("B 배송 뒤 최소 5개 series")가 로컬 데이터만으로 가능한가? O2-5는 `git status`에
   나타나지 않음을 실측한다 — D10·`req:doctor` 무영향 주장이 이걸로 충분히 고정되는가?

6. **범위 이탈이 없는가** (R9). `series`·`attempt`·`lineage`·`full_review` 개념이 새어 들어오지 않았는가?
   행 형식이 A·B의 확장을 받을 수 있는 **열린 객체**인가?

7. **정직성 표기** (02-plan). "`main()` 배선의 종단 동작은 단위 테스트로 증명하지 않는다 — 리뷰어가 diff로
   확인하고, 병합 후 실제 로그 누적을 최종 보고에 포함한다"고 명시했다. 이 한계 표기가 정확한가?
