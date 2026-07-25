# REQ-2026-055 리뷰 요청 — `req:review-exception` 전용 명령 + 구조화 rationale

## 배경

리뷰 예산 needs-exception 구간(6~8회차)의 사람 예외(`review_exception_confirmed`)를 지금은 운영자가
`state.json` 수동 편집으로 넣는다(안전 게이트 직접 편집·회차 오기 위험·rationale 무기록). REQ-2026-044가
`req:review-exception` 전용 명령을 별도 REQ로 예약했다. 이 REQ가 그 명령을 만든다.

## 변경 요약

- **DEC-RE1** 대상·회차를 **소비 게이트와 동일 함수**(openSeriesAttempts·checkReviewBudget)로 계산 —
  for_series_id/for_attempt 오기 불가. needs-exception 구간만 허용(allow/hard-blocked/terminal 거부).
- **DEC-RE2** 구조화 rationale(직전findings·변경·미해결·재시도근거) 필수·비-빔 검증.
- **DEC-RE3** durable 기록은 **전용 `review-exceptions.jsonl`**(sibling ledger) — B1 review-ledger 스키마는
  **안 건드린다**(릴리스된 원장에 필수 키 추가는 기존 커밋 원장을 D5 fail-closed로 깨뜨림·B1 자체 경고).
- **DEC-RE4** state.json review_exception_confirmed 원자 기록(confirmed_at 실시계) + review-exceptions pathspec
  커밋·clean 가드·dry-run 기본·멱등. 소비 로직·예산 게이트 무변경.

## 리뷰 포인트

1. **회차 정합(DEC-RE1)**: for_attempt를 `checkReviewBudget(openSeriesAttempts, budget).attempt`로 계산해
   `consumeReviewException`의 for_attempt 검증과 **정확히 일치**하는가? REQ-2026-054 유효회차(attempts-refunded)
   기준이 소비·부여 양쪽에서 같은가(attempts=6·refunded=1도 for_attempt=6)?
2. **구간 판정 fail-closed(DEC-RE1)**: allow/hard-blocked/terminal/열린 series 없음을 전부 거부하는가?
   needs-exception만 부여?
3. **B1 스키마 보존(DEC-RE3)**: 전용 파일 사용이 review-ledger의 릴리스-후 스키마 위험을 실제로 피하는가?
   review-exceptions.jsonl이 rationale **본문**을 담는 게(review-ledger의 hash-only와 역할 구분) 정당한가?
4. **원자성·안전(DEC-RE4)**: state 기록 + durable 커밋의 부분 실패가 fail-closed/멱등으로 안전한가?
   confirmed_at 실시계·clean 가드·pathspec(staged 코드 미접촉)?
5. **소비 로직 불변**: consumeReviewException·예산 게이트를 안 바꾸고 기록만 하는 경계가 맞는가?
