# REQ-2026-084 리뷰 요청

## 배경

소비 repo(yammy) 0.11.0 운영 구간 리뷰 호출 68회를 감사해 나온 두 건이다.

1. 리뷰어가 내는 `risk_level`이 게이트 어디에도 닿지 않는다(응답 67건 중 31건 HIGH, 그중 7건은 승인과 동반). 소비처는 `state.risk_level`뿐이다.
2. `outcome === 'invalid'`(리뷰어가 검증 불통과 응답을 낸 회차)가 빌더의 리뷰 예산을 정상 회차와 동일하게 소모한다.

## 변경 요약

- **phase-1**: `risk_level`을 리뷰어 출력 계약에서 뺀다. SSOT `machine.schema.json`에는 property를 **남기고**(`deprecated: true`) `required`에서만 제거, strict output copy 파생 시 deprecated 속성을 탈락시킨다. `validateVerdict`는 있으면 검사·없으면 통과.
- **phase-2**: `void_attempts` 계수를 추가해 invalid 회차가 `autoBudget`을 소모하지 않게 한다. `hardCap`은 실제 호출 수(`dispatched`) 기준으로 그대로 남겨 무한 루프를 막는다.
- **phase-3**: CHANGELOG.

## 리뷰 포인트

- **기존 아카이브 무손상**: `additionalProperties: false` + D17/D9의 아카이브 재검증 경로에서, `risk_level`을 담은 과거 응답이 계속 통과하는가. 이 REQ에서 가장 중요한 불변식이다.
- **스키마 버전 불변**: `machine_schema_version`을 `1.1`로 유지하는 근거(상향 시 `validateVerdict` 정확 일치로 전 아카이브 무효)가 코드와 일치하는가.
- **파생 순서**: `deriveStrictOutputSchema`에서 deprecated 탈락이 `required = Object.keys(properties)` **앞**에 오는가. 뒤에 오면 목적을 달성하지 못한다.
- **예산 안전성**: invalid가 반복될 때 `dispatched`가 `hardCap`에서 반드시 차단하는가(판정 순서상 hard-blocked가 먼저인가).
- **하위호환**: `void_attempts` 부재 state의 판정이 현행과 동일한가. `refunded_attempts`(REQ-2026-054) 의미가 바뀌지 않았는가.
- **판정 일원화**: `req-review-exception`의 부여 판정과 `review-codex`의 소비 판정이 같은 함수·같은 입력을 쓰는가.
