# REQ-2026-055 설계 — `req:review-exception` 전용 명령 + 구조화 rationale

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

- `scripts/req/review-codex.ts`:
  - `ReviewExceptionConfirmed { confirmed, method, confirmed_at, for_series_id, for_attempt, note? }`.
  - `consumeReviewException(state, seriesId, nextAttempt)` — 형식(confirmed/method/ISO)·바인딩
    (for_series_id===series·for_attempt===nextAttempt) 검증 후 소비(→null). **이 소비 로직은 불변**.
  - `openSeriesRecord`·`openSeriesAttempts`(REQ-2026-054로 **유효 회차 = attempts - refunded_attempts**)·
    `checkReviewBudget(openAttempts, budget)`(allow / needs-exception{attempt} / hard-blocked{attempt}).
  - `cfg.reviewBudget`(autoBudget/hardCap) — 게이트가 쓰는 예산.
  - `isSeriesKeyTerminal`(human-resolution 종결 series).
- 예외 부여는 지금 **운영자가 state.json 수동 편집**(REQ-044가 이 명령을 별도 REQ로 예약).
- `bin/dispatch.mjs` VERB_MODULES(현재 req 명령 표면 SSOT·P4c). `lib/review-ledger.ts`(B1·**릴리스됨** —
  스키마 필수 키 추가 금지).

## 핵심 설계 결정

### DEC-RE1 — 명령 + 대상(series·회차) 결정

`req:review-exception <REQ> --kind design|phase [--phase <id>] --method "<승인문장>" --rationale-file <path> [--run]`.

- 대상 series = `(kind, phaseId)`의 **열린** series(`openSeriesRecord`). 없으면 거부(예외 걸 대상 없음).
- terminal(human-resolution 종결) series면 거부(대체 REQ 안내 — 예산 예외 아님).
- 예산 판정: `checkReviewBudget(openSeriesAttempts(state,kind,phaseId), cfg.reviewBudget)`.
  - `needs-exception` → 부여 가능. `for_series_id = series.series_id`, `for_attempt = decision.attempt`
    (= 유효 회차 + 1 — REQ-2026-054 유효 회차 기준이라 소비 게이트와 **정확히 일치**).
  - `allow` → 거부("아직 예외 불요 — 그냥 리뷰하세요").
  - `hard-blocked` → 거부("예외로도 불가(hardCap) — 종료하거나 대체 REQ").
- 🔴 **소비 게이트와 같은 함수로 회차를 계산**(openSeriesAttempts·checkReviewBudget 재사용) — 오기 불가.

### DEC-RE2 — 구조화 rationale(필수)

`--rationale-file`은 아래 4개 섹션을 **모두 비어있지 않게** 담아야 한다(fail-closed 검증):

1. `## 직전 findings` — 직전 리뷰가 낸 findings 요약.
2. `## 이번 변경` — 예외 회차에서 무엇을 바꿨나.
3. `## 미해결` — 아직 못 고친/논쟁 중인 것.
4. `## 재시도 근거` — 왜 예산을 넘겨 재리뷰가 정당한가.

파서(순수)가 헤더별 본문을 뽑아 비어있으면 어느 섹션이 비었는지 알린다. 형식 자유(마크다운) — 존재·비-빔만 강제.

### DEC-RE3 — durable 기록: 전용 `review-exceptions.jsonl`(B1 스키마 불변)

🔴 **B1 review-ledger 스키마를 바꾸지 않는다** — 릴리스된 원장에 필수 키를 더하면 기존 커밋 원장이 "필수 키
누락"으로 D5 fail-closed된다(B1 자체가 경고한 위험). 대신 **전용 durable 파일** `responses/review-exceptions.jsonl`
(sibling ledger·자체 스키마)에 예외 부여를 append한다.

- 신규 `lib/review-exception.ts`(순수): `ExceptionGrantRow { ticket_id, review_kind, phase_id, series_id,
  for_attempt, method, confirmed_at, rationale: { prev_findings, changes, unresolved, retry_justification },
  reconstructed }`. 고정 키 직렬화·허용키 화이트리스트·자연키 `(ticket, series, for_attempt)`.
- 🔴 **멱등 판정은 material 동일**(r02 P1): `confirmed_at`은 실시계라 재실행마다 달라진다. 자연키가 같을 때
  **method + rationale이 같으면 duplicate**(confirmed_at 무시), **method/rationale이 다르면 conflict**(fail-closed —
  같은 회차에 다른 예외). 즉 `findExistingGrant(content, key)`(순수)가 기존 행을 돌려주고, 호출부가 그 행의
  `confirmed_at`을 재사용한다(재실행이 conflict 아닌 recovery).
- rationale **본문을 담는다**(이 파일의 목적이 "왜"의 감사다 — review-ledger가 본문을 뺀 것과 역할이 다름).
- 소비돼도 남는다(state.json review_exception_confirmed는 소비 후 null이 되지만 이 파일은 durable).

### DEC-RE4 — 실패-안전 순서: **durable 먼저, 소비 가능 state 마지막**(r01 P1)

🔴 **소비 가능한 예외(state.json)는 durable rationale이 커밋된 뒤에만 존재해야 한다.** state를 먼저 쓰면 durable
단계가 실패(dirty·커밋 실패)해도 review_exception_confirmed가 남아, 소비 로직 불변인 `req:review-codex`가
**rationale 없이** 예외를 소비할 수 있다(clean-guard·durable 요구 우회). 그래서 순서를 뒤집는다:

`--run` 시(순서):
1. `planReviewException`(순수)로 대상·회차 확정 + rationale 파싱·검증. **어떤 거부 조건이든(구간 아님·terminal·
   rationale 누락) 여기서 write 0으로 막는다**(state 변경 前).
2. **clean 가드** — `review-exceptions.jsonl`에 미커밋 변경 없음(HEAD 기반 append가 미커밋 행을 덮지 않게).
   **state 변경 前**에 검사(P1: dirty여도 state가 남으면 안 됨).
3. **durable rationale 먼저**: 기존 review-exceptions에서 자연키로 조회(`findExistingGrant`).
   - **material 일치**(method+rationale 같음) → 기존 행 재사용: **그 행의 `confirmed_at`을 쓴다**. 새 append 없음
     (이미 durable). = 재실행/복구 경로(r02 P1).
   - **material 불일치** → conflict throw(같은 회차 다른 예외 — fail-closed).
   - **부재** → `confirmed_at = 실시계`로 새 `ExceptionGrantRow` append + **pathspec 커밋**(그 파일만·staged 코드
     미접촉). 커밋 실패면 throw(state 미변경).
4. **durable(신규 커밋 또는 기존 행 확인) 후에만** `state.json` `review_exception_confirmed = { confirmed:true,
   method, confirmed_at(= durable 행과 **동일 값**), for_series_id, for_attempt, note }` 기록(scratch — 소비 게이트용).
- **실패-안전 불변식**: durable 단계 실패 → state 미기록 → **소비 가능한 예외가 rationale 없이 남지 않는다**.
  역방향(durable 커밋됐으나 state 미기록)은 무해 — 재실행이 기존 행 confirmed_at 재사용해 state만 기록(conflict 아님).
- **dry-run 기본**(--run 없으면 대상·회차·검증 결과만 표시·write 0). `confirmed_at`은 실제 시계(날조 금지·REQ-019).
- 멱등: 같은 (series, 회차) 동일 rationale 재실행 → review-exceptions duplicate(커밋 diff 없음) + state 재기록.
- `consumeReviewException`·예산 게이트·soft/hard cap **무변경** — 이 명령은 **기록만** 한다.

### DEC-RE5 — dispatch 표면

`bin/dispatch.mjs` VERB_MODULES += `req:review-exception` → P4c Stage-B 표면 자동 반영(init/migrate/uninstall/
smoke 파생·per-verb smoke 자동 검증). init.test STAGE_B 파생 집합 비교는 자동 통과.

## Phase별 구현

- **Phase 1 — 예외 grant 스키마·계획(순수)**: `lib/review-exception.ts`(ExceptionGrantRow serialize/parse/
  validate/append + rationale 파서 + `planReviewException(state,kind,phaseId,budget)`) + 단위 테스트.
- **Phase 2 — 명령 배선**: `req-review-exception.ts`(CLI: 인자·dry-run/--run·state 기록·durable 커밋) +
  dispatch VERB_MODULES + 실git 테스트(needs-exception 구간 부여→소비 e2e·구간아님 거부·rationale 누락 거부·멱등).

## 변경 파일

- `scripts/req/lib/review-exception.ts`(P1·신규) · `tests/unit/review-exception.test.ts`(P1)
- `scripts/req/req-review-exception.ts`(P2·신규) · `bin/dispatch.mjs`(P2) · `tests/unit/req-review-exception.test.ts`(P2)

## 하위호환·안전

- B1 review-ledger·close-proof·소비 로직 **불변**. 신규 durable 파일은 sibling(자체 스키마).
- 회차 계산을 소비 게이트와 동일 함수로 → 오기·drift 불가. 실제 시계·fail-closed·pathspec·clean 가드 계승.
- main 통합은 C·E와 함께 마지막 사용자 확인.
