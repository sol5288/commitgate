# REQ-2026-005 리뷰 요청

## 리뷰 종류/범위 (중요)
이것은 **`--kind design`(설계 리뷰)** 이다. 권위 아티팩트는 설계 문서 00/01/02이며, **구현 코드는 아직 작성되지 않았다(design-first)** — REVIEW_BASE_SHA 기준 diff가 비어 있는 것은 정상이다. 구현은 이 설계 승인 후 작성되어 **후속 phase 리뷰(`--kind phase`)에서 staged diff로 검증**된다. 이 리뷰에서 판단할 것은 **설계(접근)의 타당성**이다.

## 배경
REQ-2026-004 R10은 `commit_approved=yes + findings 있음`을 모순(invalid)으로 막았다(안전). 그러나 승인 시 비차단 코멘트를 담을 채널이 없어 "승인+사소한 코멘트"가 exit 1 churn이 될 수 있다. 이를 위해 optional `observations` 채널을 추가한다.

## 설계 결정 요약 (01-design 참조)
- schema에 **optional** `observations` 배열 추가(root required 아님 → 하위호환). items `{detail, file}`, **severity 없음**(`additionalProperties:false`로 severity 붙은 항목은 구조적 거부). version **1.1 유지**.
- `classifyReview`(findings 존재 기반) **불변** — observations는 승인/차단 판정에 영향 없음. PM 정책 매트릭스가 추가 분기 없이 성립.
- `printOutcomeDetails`가 observations를 approved에서도 표출.

## 리뷰 포인트 (설계 타당성)
- optional additive + version 1.1 유지가 기존 아카이브와 안전하게 호환되는가.
- observations가 fail-closed를 훼손하지 않는가(`no+findings=[]+observations`는 여전히 blocked여야 — observations가 findings를 대체하면 안 됨).
- severity 미허용으로 blocking/non-blocking 경계가 유지되는가.
- 승인 시 `commit_approved=yes`, `merge_ready=no`. 설계에 결함 없으면 findings 없이 승인해 달라(비차단 의견은 observations로).
