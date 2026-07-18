# REQ-2026-028 phase-1 리뷰 요청

## 배경

CommitGate 개선 **A-2a phase-1** — 예산 게이트. 설계는 design-r04 승인(4라운드 수렴). A-1(REQ-027)이
main `42f599f`에 병합돼 review series를 정확히 세지만 아무것도 막지 않는다. 이 phase가 그 계수 위에
**예산 게이트**를 얹어 무한 재리뷰를 물리적으로 끝낸다.

## phase-1 r01 지적 반영 (P1 2건 — 둘 다 유효)

1. 🔴 **`sameSeriesSeq`가 series_id를 `split('#')`로 재구성** → phase id에 `#`가 있으면 `NaN`으로 계산돼
   유효한 예외가 거부됨. → **`openSeriesRecord`로 열린 record의 series_id를 직접 사용**(재구성 폐기).
   O1-11 회귀(phase id `phase#alpha`)로 고정.
2. 🔴 **O1-9가 canned approved만 써서 "예외 소비가 series를 잘못 닫는" 결함을 못 잡음**(approved면 어차피
   닫히니까). → **O1-9b 추가**: canned NEEDS_FIX로 6회차 후 `attempts=6`·`closed_reason=null`(열린 채) 확인,
   이어 7회차가 또 예외를 요구함을 검증(예외가 닫았다면 새 series로 7~9 우회됐을 것).

## 변경 요약 (phase-1-budget-gate)

D1·D2·D3. 순수 함수 + config + `withAttemptRecorded` 게이트 삽입.

**순수 함수(`review-codex.ts`)**:
- `checkReviewBudget(openAttempts, budget)` → allow / needs-exception / hard-blocked. **기준은 attempts뿐**
  (배분표 ⑤) — escalated·직전 outcome 안 봄.
- `openSeriesAttempts(state, kind, phaseId)` — 열린 series의 attempts(없으면 0).
- `isValidIsoInstant(s)` — 형식(`REVIEW_ISO_RE`, 밀리초 선택) **+ 달력 유효성**(재파싱 성분 일치).
  `2026-99-99...` 거부, `...08Z` 통과(design-r02·r03).
- `consumeReviewException(state, seriesId, nextAttempt)` — 형식(confirmed·method·ISO) + 바인딩
  (for_series_id·for_attempt) fail-closed. 유효하면 `null` 소비. **series 안 닫음**(배분표 ①).

**게이트 삽입**: `withAttemptRecorded` ctx에 `budget` 추가. `recordAttempt` **전** 예산 검사 —
hard-blocked면 throw(예외 안 봄), needs-exception면 `consumeReviewException`(무효 throw), allow면 진행.
`main()`이 `cfg.reviewBudget`을 넘김.

**config(`lib/config.ts`)**: `reviewBudget{autoBudget,hardCap}` — DEFAULTS 5/8. `CONFIG_SCHEMA`에 타입·
상한(hardCap≤8·최소1). loadConfig가 교차검증(autoBudget≤hardCap) throw. 배포용
`workflow/req.config.schema.json`·`req.config.json.sample`도 동기화(드리프트 가드 통과).

**무변경**: A-1 계수(`recordAttempt`·`closeSeriesApproved`)·G1·G2·`classifyReview`·승인 바인딩·
`machine.schema.json`. `req-commit.ts`의 기존 ISO 검증(범위 밖 — 후속 observation).

게이트: typecheck 0, 단위 1101/1101 green. (A-1 O2-6b는 A-2a 게이트 반영해 예산 안 시나리오로 갱신 —
고횟수 무차단은 이제 순수 recordAttempt(O2-1)·이 REQ O1-10이 담당.)

## 리뷰 포인트

리뷰 포인트는 심사 범위의 하한이다.

1. **🔴 게이트 기준이 attempts뿐인가**(배분표 ⑤). `checkReviewBudget`이 openAttempts만 받아 구조적으로
   attempts를 강제하는가? near-e2e O1-8이 직전 INVALID여도 6회차를 막는가?
2. **🔴 예외 소비가 series를 닫지 않는가**(배분표 ①). `consumeReviewException`이 closed_reason 무변경?
   O1-9가 예외 소비 후 attempts=6·series 판정을 확인하는가?
3. **🔴 형식 검증 fail-closed**(배분표 ⑪). confirmed·method·ISO(형식+달력) 각각 무효 시 throw?
   `isValidIsoInstant`가 `2026-99-99...`를 거부하고 밀리초 없는 값을 통과시키는가?
4. **🔴 config 범위 검증이 R4를 지키는가**(배분표 ⑥). hardCap>8·<1·autoBudget<1·교차 전부 throw?
   배포 스키마 드리프트 가드 통과? config로 R4를 뚫을 경로가 남았는가?
5. **🔴 게이트가 recordAttempt 전인가**. hard-blocked/needs-exception-무효 시 호출·기록 전에 throw?
   O1-7(호출 0회+state 무변경)·O1-10(9회차는 예외로도 차단)이 이를 잡는가?
6. **A-1 계수 무변경**(R15). recordAttempt·closeSeriesApproved·series 판정을 안 건드렸는가? 게이트가
   삽입일 뿐인가?
7. **범위 경계**. `req-commit.ts` ISO 검증을 안 건드린 것이 맞는가(같은 결함 있지만 A-2a 범위 밖)?
   near-e2e 하네스가 우회 없이 진짜 게이트를 태우는가?
8. **oracle**. O1-1~O1-10·config 6종이 각 "→ 실패해야 하는 구현"을 실제로 실패시키는가?
