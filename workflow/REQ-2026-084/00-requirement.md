# REQ-2026-084 요구사항

리뷰 계약 축소 — risk_level 요청·검증 제거, invalid attempt 예산 미소모

## 배경 — 소비자(yammy) 운영 이력 실측

`44_yammy_sales`가 commitgate 0.11.0으로 REQ-067~075를 진행한 구간(리뷰 호출 68회)을 감사해
나온 두 건이다. 둘 다 **리뷰 1회당 비용은 유료 호출 + 대기 + 부기 커밋**이라는 전제에서
"값을 못 내는 계약 항목"과 "잘못 청구되는 예산"이다.

### 관측 1 — 리뷰어의 `risk_level`은 어디에도 닿지 않는다

- 응답 67건 중 **31건이 `risk_level: "HIGH"`**였고 그중 **7건은 승인(STEP_COMPLETE)과 함께** HIGH였다.
- 그런데 티켓은 전부 `state.risk_level: "LOW"`로 남았고 사람 확인은 0회였다.
- 원인: `validateVerdict`(review-codex.ts)는 이 값을 **enum 유효성만** 검사한다. 게이트 판정에 쓰이는 것은
  `state.risk_level`(req:new 시점에 사람이 정한 값)뿐이다 — req-commit.ts(HIGH 확인 지점),
  req-next.ts(low-only 자동 커밋). 즉 **매 리뷰마다 물어보고, 받아 적고, 버린다.**

두 축(응답 risk_level / 티켓 risk_level)이 이름만 같고 하나만 살아 있는 어중간한 상태다.
REQ-2026-071이 HIGH 백스톱을 의도적으로 제거해 `stopGate` 단일 지배로 정리한 결과이며,
**이 REQ는 그 결정을 되돌리지 않는다.** 죽은 쪽(응답 필드)을 계약에서 걷어낸다.

### 관측 2 — 리뷰어 잘못인 무효 응답이 빌더의 예산을 깎는다

- REQ-2026-075 phase-1의 `attempts`가 **3인데 아카이브된 라운드는 2개**뿐이다.
  2회차가 `outcome: "invalid"`(49초 소모, 산출물 0)로 끝났다.
- `invalid` = 리뷰어가 스키마/도메인 검증을 통과하지 못하는 응답을 냈다는 뜻이다. **빌더의 코드 문제가 아니다.**
- 그런데 예산(`autoBudget`=5 soft / `hardCap`=8 absolute)은 이 회차를 정상 회차와 동일하게 계산한다.

지금 비율은 68회 중 1회(1.5%)로 낮다. 문제는 **터지는 자리**다: 어려운 phase에서 5회차에 invalid가
나면 빌더는 자기 잘못이 아닌 일로 곧장 `req:review-exception` 사유서를 써야 한다.

## 요구사항

- **R1** 리뷰어에게 `risk_level`을 **더 이상 요청하지 않는다**(출력 스키마에서 제외).
- **R2** `risk_level`이 없는 응답이 **정상 통과**해야 한다.
- **R3** `risk_level`을 담고 있는 **기존 아카이브가 계속 유효**해야 한다 — 재검증에서 하나도 깨지지 않는다.
- **R4** `machine_schema_version`은 **`1.1`을 유지**한다.
- **R5** `outcome === 'invalid'`인 회차는 **`autoBudget`(사람 예외를 요구하는 soft cap)을 소모하지 않는다.**
- **R6** 그럼에도 **무한 invalid 루프는 불가능**해야 한다 — 실제 호출 횟수에 대한 절대 상한이 남는다.
- **R7** REQ-2026-054(DEC-C3) pre-dispatch 환불 의미론을 **바꾸지 않는다.**
- **R8** 옛 `state.json`(신규 계수 필드 부재)이 **동작·판정 변화 없이** 그대로 돌아간다.

## 비목표

- 티켓 `state.risk_level`·`stopGate`·HIGH 확인 경로는 **손대지 않는다**(REQ-2026-071 결정 유지).
- `autoBudget`/`hardCap` 기본값(5/8)은 바꾸지 않는다.
- invalid 응답의 자동 재시도는 넣지 않는다 — 예산 계산만 고친다.
