# REQ-2026-055 요구사항

`req:review-exception` 전용 명령 + 구조화 rationale durable 기록 (yammy 운영감사 후속 D)

## 문제

리뷰 예산 게이트(REQ-2026-028)는 같은 series의 회차가 autoBudget(5)을 넘어 needs-exception 구간(6~8회차)에
들면 **사람 예외**(`state.json`의 `review_exception_confirmed`)를 요구한다. 그런데 그 예외 손기록을 현재는
**운영자가 `state.json`을 직접 편집**해 넣어야 한다:

- 안전 게이트 상태(`state.json`)를 손으로 고치는 것은 CommitGate의 "state/responses 직접 편집 금지" 지침과
  충돌하고, `for_series_id`·`for_attempt`를 오기하면 소비 시 fail-closed로 막힌다.
- 예외를 **왜** 부여했는지(직전 findings·이번 변경·미해결·재시도 근거)가 **아무 데도 durable하게 안 남는다** —
  `review_exception_confirmed`는 소비 후 `null`로 지워진다(B1이 관측한 갭).

REQ-2026-044가 이 명령을 **별도 REQ로 예약**했다(§01: "AWAIT_HUMAN·series·회차를 검증하고 원자적으로 기록하는
`req:review-exception` 전용 명령 — 안전 게이트 상태 전이 변경이므로 별도 REQ").

## 목표

1. **`req:review-exception` 전용 명령** — 현재 예산 상태가 실제로 needs-exception인지, 어느 series·회차인지
   **검증**하고, `review_exception_confirmed`를 **원자적으로** 기록한다(수동 편집 대체).
2. **구조화 rationale** — 예외 부여 근거(직전 findings 요약·이번 변경·미해결·재시도 근거)를 필수로 받아
   **durable하게 기록**한다(소비돼도 남는 감사 기록).
3. **fail-closed** — needs-exception 구간이 아니거나(allow=불요·hard-blocked=예외로도 불가·terminal=대체 REQ),
   rationale 누락이면 거부. 시각은 실제 시계(날조 금지·REQ-019 이력).

## 비목표

- 예산 상한(autoBudget/hardCap) 값·소비 로직(`consumeReviewException`) 변경 없음 — **기록 경로**만 명령화.
- B1 review-ledger 스키마 변경 없음 — 릴리스된 원장에 필수 키 추가는 기존 커밋 원장을 깨뜨린다(B1 자체 경고).
  rationale는 **전용 durable 파일**에 기록한다.

## 완료 기준

- needs-exception 구간에서 `req:review-exception <REQ> --kind … --method … --rationale-file … --run` →
  `review_exception_confirmed` 원자 기록 + rationale durable 커밋 → 이어지는 `req:review-codex`가 정상 소비.
- 구간 아님·rationale 누락 → fail-closed 거부. 단위·실git 테스트 그린·typecheck 0·smoke 그린(신규 verb 자동 검출).
