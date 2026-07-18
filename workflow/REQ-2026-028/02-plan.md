# REQ-2026-028 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

> **오라클 원칙(REQ-2026-025 교훈)**: 오라클은 "필드가 있다"가 아니라 **"지우면/뒤집으면 실패한다"** 로 쓴다.
> 026이 이 영역에서 잡힌 결함(⑤⑥①)을 각 오라클이 재현·차단한다.

## Phase 1 — 예산 게이트 (`phase-1-budget-gate`)

범위: D1·D2·D3. `checkReviewBudget`·`consumeReviewException`(순수) · `withAttemptRecorded` 게이트 삽입 ·
config `reviewBudget` + 범위 검증. **강제 게이트가 먼저.**

변경 파일: `scripts/req/review-codex.ts` · `scripts/req/lib/config.ts` ·
**`workflow/req.config.schema.json`**(배포 스키마 동치, D3·O1-6b) · **`req.config.json.sample`**(observation) ·
`tests/unit/req-review-codex.test.ts` · `tests/unit/req-config.test.ts`

### Oracle — checkReviewBudget(순수)

- **O1-1 자동 1~5 허용**(R1): `checkReviewBudget(0..4, {5,8})` = `allow`. **`openAttempts=4`(→5회차)도 allow**.
  → 경계를 당겨 5회차를 막으면 실패(정상 수렴 15/21을 죽인다).
- **O1-2 🔴 6~8회차는 예외 필요**(R2): `checkReviewBudget(5..7, {5,8})` = `needs-exception`.
  → **`attempts` 아닌 다른 기준(escalated 등)으로 판정하는 구현은 여기서 못 잡히지만, 아래 O1-6 near-e2e가
  INVALID 직후 케이스로 잡는다.** 순수 함수는 attempts만 받으므로 구조적으로 attempts 기준이 강제된다.
- **O1-3 🔴 9회차는 hard-blocked**(R4): `checkReviewBudget(8.., {5,8})` = `hard-blocked`. → 임계 초과를
  `needs-exception`으로 두면 예외로 9회차가 뚫린다.

### Oracle — consumeReviewException(순수)

- **O1-4 🔴 대상 바인딩 일치만 유효·1회 소비**(R9): `for_series_id`/`for_attempt`가 인자와 일치하면 소비된
  state(`review_exception_confirmed===null`) 반환, 불일치면 throw. → 전역 플래그로 두거나 소비 안 하면
  한 예외로 6·7·8을 다 태운다.
- **O1-4b 🔴 손기록 형식 fail-closed**(R8, design-r01 P1, 배분표 ⑪): 바인딩이 맞아도
  `{confirmed:false}` · `{method:''}` · `{confirmed_at:'not-a-date'}` 각각 **무효(throw)**. `confirmed===true` +
  비어있지 않은 method + `ISO_RE` 통과만 소비. → 형식 검증 없으면 날조 손기록으로 6회차가 뚫린다(REQ-019 부류).
  ※ **밀리초 없는 유효 ISO(`2026-07-18T00:30:08Z`)는 통과**(r02 observation).
  ※ 🔴 **달력상 불가능한 값(`2026-99-99T99:99:99Z`)은 무효**(r03 P1) — `ISO_RE`만으론 통과하므로
  `isValidIsoInstant`가 재파싱 성분 일치로 잡는다. 형식·달력 둘 다 오라클에 고정.
- **O1-5 🔴 예외 소비는 series를 닫지 않는다**(R10, 배분표 ①): `consumeReviewException` 반환 state의
  `review_series[*].closed_reason`이 **입력과 동일**(건드리지 않음). → 닫으면 다음 리뷰가 새 series(0회)를
  열어 상한 우회.

### Oracle — config 검증

- **O1-6 🔴 범위 검증 상한·하한·교차 전부**(R7, 배분표 ⑥, design-r01 P1): loadConfig가 아래를 **각각 throw**.
  - `hardCap=9`(상한 초과) · `hardCap=0`(하한 미만) · `autoBudget=0`(하한 미만) · `autoBudget=6,hardCap=5`(교차)
  - 미설정 = `{5,8}` 통과. `{autoBudget:3,hardCap:6}` 같은 정상값 통과.
  → 상한·교차만 구현하고 `{0,0}`을 허용하는 구현은 **하한 사례에서 실패**(design-r01 P1 반영).
- **O1-6b 🔴 런타임·배포 스키마 동치**(R6, design-r01 P1): 기존 드리프트 가드 테스트(`req-config.test.ts`,
  `CONFIG_SCHEMA` == `workflow/req.config.schema.json`)가 `reviewBudget` 추가 후에도 **통과**한다.
  배포 스키마가 정상 `reviewBudget` 설정을 **거부하지 않는다**(`additionalProperties:false` 하에서 허용).
  → 런타임만 바꾸면 이 오라클이 실패.

### Oracle — main() near-e2e (A-1 하네스 재사용)

- **O1-7 🔴 attempts=5 예외 없음 → 호출 0회 + throw**(R5·R2): `attempts=5` 열린 series를 심고 예외 없이
  main()을 fake reviewer로 돌리면 **fake 호출 카운터 0** + throw. → 게이트가 recordAttempt/call 뒤면 실패.
- **O1-8 🔴 INVALID 직후 6회차도 예외 요구**(R2, 배분표 ⑤): `attempts=5`인데 직전 outcome이 invalid인
  state에서도 예외 없이 부르면 throw. → `escalated`(needs-fix에서만 set) 기준 구현은 여기서 통과시켜 실패.
- **O1-9 예외 있으면 6회차 호출·attempts=6·series 열린 채**(R3·R10): 유효한 `review_exception_confirmed`
  (for_attempt=6)를 심으면 호출 1회 + `attempts=6` + `closed_reason===null` + 예외 `null` 소비.
- **O1-10 🔴 attempts=8 + 유효 예외라도 throw**(R4): 9회차는 예외로도 안 뚫린다. → 예외를 무제한
  허용하는 구현 차단.

### 정직성 — 이 phase가 증명하지 않는 것

- **`main()` 배선**(`cfg.reviewBudget`을 ctx에 넘겼는가)은 near-e2e(O1-7~O1-10)가 덮는다. 순수 함수 동작과
  분리해 각각 고정한다.
- **A-2b 범위**(lineage·로그·human-resolution)는 안 다룬다. 예외는 소비만 하고 대체 REQ 계보는 A-2b.

Exit: typecheck0 · 단위 그린 · Codex phase 리뷰 승인.

## Phase 2 — req:next G3 안내 (`phase-2-req-next-g3`)

범위: D4·D5. `gateRunCandidate` G3 · `NextInput.reviewBudget` · 우선순위 G1→G3→G2.

변경 파일: `scripts/req/req-next.ts` · `tests/unit/req-next.test.ts`

### Oracle

- **O2-1 🔴 escalated → AWAIT_HUMAN**(R12): 열린 series attempts>=autoBudget인 state에서 `resolveNext`가
  `RUN`이 아니라 `AWAIT_HUMAN`. `diagnostics`에 **시도 수·직전 outcome·선택지** 포함(누적 findings는
  A-2b — design-r01 P1). → RUN 내면 상한이 안내에 안 뜬다.
- **O2-2 🔴 G3가 G2보다 앞선다 — 동시 성립**(R13, 배분표 근거): `escalated` **이고** `last_review`가 같은
  compare_hash로 needs-fix인 state(5회차 NEEDS_FIX 직후)에서 `AGENT`가 **아니라** `AWAIT_HUMAN`.
  → G3를 G2 뒤에 붙이면 G2가 먼저 AGENT를 반환해 escalate 안내가 영영 안 나온다. 두 조건은 항상 함께 성립.
- **O2-3 G1이 G3보다 앞선다**: 워킹트리 dirty + escalated 동시 → `AGENT`(정리 먼저). → dirty에 AWAIT_HUMAN
  내면 승인해도 D10에서 죽는다.
- **O2-4 정상 series G2 무변경**(R16): escalated **아닌**(attempts<autoBudget) series에서 G2가 종전대로
  (같은 바인딩 needs-fix→AGENT 등). → G3가 정상 series까지 가로채면 실패.
- **O2-5 hard-blocked 문구 구분**(R14): attempts>=hardCap이면 G3 안내가 "예외로도 안 됨 — 종료/대체 REQ",
  6~8이면 "예외 승인 가능"으로 문구가 다르다. **"위험 수용"은 어느 문구에도 없다**(배분표 ④).
- **O2-6 기존 분기 무변경**(R16): `commit_allowed`→AWAIT_HUMAN(commit), legacy→AWAIT_HUMAN(A-1),
  design/phase RUN(정상)이 G3 삽입에도 그대로.

### 정직성 — 이 phase가 증명하지 않는 것

- **`req:next`는 강제가 아니라 안내다.** 강제는 phase-1의 호출 지점 throw. G3는 사람이 실행 **전에**
  상한을 알게 하는 UX다. `state.json`을 손으로 지우면 우회(경계, R17).

Exit: typecheck0 · 단위 그린 · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(unit·typecheck) · 사용자 main 반영(별도 승인).
- 이 REQ는 additive다. **A-2b를 기다리지 않고 단독 병합한다.**
- 이 repo에 lint 스크립트는 없다(게이트 = typecheck + vitest).
