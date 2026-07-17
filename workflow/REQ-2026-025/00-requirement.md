# REQ-2026-025 요구사항 — 리뷰 배칭과 review-call 측정 (개선 REQ-A0)

## 1. 배경

리뷰어의 지적은 대부분 유효했다. 문제는 **유효한 P1이 라운드당 한 건씩 흘러나온다**는 것이다.

- REQ-020: design 14라운드. 반려 9회가 **전부 `findings` 1건**.
- REQ-023: design 8라운드. r03~r06이 **각 1건**.
- REQ-013: 단일 design 흐름에서 **17라운드**.

현행 `workflow/review-persona.md`는 탐색 범위를 넓히라고는 한다("리뷰 포인트는 심사 범위의 **하한**이지
상한이 아니다"). 그러나 **이번 호출에서 식별한 P1을 모두 반환하라는 지시는 없다.** 그 결과 리뷰어가
만족화(satisficing)해 확신하는 첫 결함에서 멈출 수 있고, 한 건 수정 → 전체 재검토 → 새 한 건 발견의
직렬 흐름이 된다.

이 REQ는 개선 순서 A0/A/B의 **첫 단계**다. 배칭을 먼저 넣는 이유는, 배칭 없이 상한(REQ-A)만 넣으면
정상적으로 수렴하던 수정 흐름까지 너무 일찍 escalation되기 때문이다.

## 2. 목표(What)

리뷰어가 **이번 호출에서 아는 P1을 한 번에 반환**하게 하고, 그 정책의 효과를 **나중에 관측할 수 있는
최소 로그**를 남긴다.

이 REQ는 P1 기준을 완화하지 않는다. 차단 대상은 그대로 차단한다.

## 3. 요구(정규화)

- **R1 배칭 의무**: 리뷰어는 이번 호출에서 식별한 모든 P1을 `findings[]`에 함께 반환한다. 이미 아는 P1을
  다음 라운드로 의도적으로 미루지 않는다. (Done #1)
- **R2 review_kind별 관점**: 응답 전 점검 관점을 `design`·`phase`별로 분리해 명시한다. 두 목록은 서로
  모순되지 않는다. (Done #1)
- **R3 기존 코드 기준선 경계**: 기존 코드·CLI help는 **설계가 현재 동작과의 호환 또는 문서·help 변경을
  약속한 경우에만** 그 약속을 검증하는 기준선으로 읽는다. 설계와 무관한 기존 코드 결함은 `findings`가
  아니라 `observations`다. 이 경계는 현행 페르소나의 "리뷰 대상이 아닌 것을 근거로 지적하지 마라"와
  충돌하지 않아야 한다. (Done #1)
- **R4 검증 불가 선언 필드 금지**: "모든 결함을 찾았다" 같은 boolean 선언 필드를 `machine.schema.json`에
  추가하지 않는다. 배칭은 행동 계약이고 검증은 사후 측정이다. (constraints)
- **R5 기존 경계 무변경**: 기존 P1 정의·`observations` 경계·승인 바인딩(`findings` 0건일 때만 승인)·
  `findings[]` 배열 구조를 **약화하거나 바꾸지 않는다**. 다수 `findings`는 정상이며 그 자체가 승인 불가
  사유가 아니다(이미 현행 계약이 그렇다). (constraints)
- **R6 review-call 로그**: 완료된 review call마다 아래 **최소 필드만** 남긴다. (Done #2)
  `ticket_id` · `review_kind` · `phase_id` · `archive_round` · `outcome` · `findings_count` ·
  `observations_count` · `timestamp` · `policy_version`
- **R7 로그는 커밋하지 않고 내용을 담지 않는다**: 로그는 **gitignore된 로컬 파일**이며 커밋 대상이 아니다.
  프롬프트 본문·diff·`findings` 본문·`observations` 본문 등 **내용은 담지 않는다**(위 필드만). 근거: 이
  프로젝트는 이미 workflow ledger성 커밋이 제품 커밋을 압도한다(병합된 020~024 커밋 49개 중 제품 11 /
  finalize 25). 측정을 얻자고 ledger를 늘리지 않는다. (Done #2, constraints)
- **R8 로그 실패는 리뷰를 막지 않는다**: 로그 기록은 측정이지 게이트가 아니다. 기록 실패가 리뷰 판정·
  exit code·state를 바꾸지 않는다. (Done #2)
- **R9 A·B 개념 미정의**: A0는 `series`·`attempt`·`lineage`·`full_review` 개념을 **정의하지도 기록하지도
  않는다.** 그 필드는 REQ-A·REQ-B가 이 로그를 확장하며 추가한다. 같은 개념을 두 REQ가 각각 정의하면
  문서 간 모순이 되고, 그것이 REQ-020 r12·r13의 반려 사유였다. (constraints)
- **R10 테스트·typecheck**: 단위 테스트·typecheck 통과. (Done #3)

## 4. 비목표 — 이번 범위에서 구현하지 않음

- **REQ-A**: review series 상한·escalation·대체 REQ lineage·`reviewSeriesModelVersion`. 🔴 범위 밖.
- **REQ-B**: design delta review·delta 전용 persona·`FULL_REVIEW_REQUESTED`. 🔴 범위 밖.
- **REQ-C**: 승인 단위 분리. 측정 후 사람이 판단한다. 🔴 범위 밖.
- 로그 **집계·조회 명령**(리포트 CLI). 로그는 남기기만 한다. 집계 방식은 측정 단계에서 사람이 결정한다.
- G-09 state 내구화, G-06c 채번, timeout, analytics 확장, distributed concurrency.
- 기존 REQ-001~024의 문서·state·승인 evidence 소급 수정.

## 5. 인수 기준

1. 조립된 리뷰 프롬프트에 배칭 계약과 해당 `review_kind`의 관점 목록이 포함된다.
2. `design`·`phase` 관점 목록이 서로 모순되지 않고, R3 경계가 명시된다.
3. 완료된 review call마다 R6 필드를 가진 로그 1행이 남는다.
4. 로그 파일이 gitignore되어 `git status`에 나타나지 않는다.
5. 로그에 프롬프트·diff·finding 본문이 포함되지 않는다.
6. 로그 기록이 실패해도 리뷰 판정·exit code가 바뀌지 않는다.
7. 기존 승인 바인딩·`observations` 경계·legacy evidence 검증이 깨지지 않는다.
8. 단위 테스트·typecheck 통과.
