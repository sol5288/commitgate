# REQ-2026-028 요구사항 — review 예산 게이트·escalation·사람 예외 (개선 REQ-A-2a)

## 1. 배경

A-1(REQ-2026-027, main `42f599f`)이 review series를 **정확히 세는 토대**를 놓았다 — `recordAttempt`가
hash 변경에도 같은 series에 attempts를 누적하고(REQ-020 병리 차단), `approved`만 자동 종료한다.
**그러나 A-1은 아무것도 막지 않는다.** attempts가 아무리 커도 리뷰를 거부하지 않는다.

이 REQ는 그 계수 위에 **예산 게이트**를 얹어 **무한 재리뷰를 물리적으로 끝낸다.** 이것이 개선 A의 핵심
목적이다 — REQ-020 14라운드, REQ-013 17라운드 같은 폭주를 상한으로 차단한다. 다만 현재 데이터에서
정상 수렴했던 series(이력 21개 중 15개가 ≤5회)는 자동으로 가로막지 않는다.

**출처**: REQ-2026-026(통합 REQ-A)이 예산+escalation+lineage+로그를 한 REQ에 담아 6라운드 미수렴으로
종료됐다(merge 금지 감사보존). 그 배분표가 A-2를 A-2a/A-2b로 나눴다. **이 REQ(A-2a)는 D4·D5 =
예산·escalation·사람 예외까지만.** lineage·로그(D6·D7)는 A-2b다. 근거: A-1(356줄)이 4라운드 수렴했다 —
표면을 그 체급으로 유지한다. 026 배분표의 A-2 몫 중 **①⑤⑥이 이 REQ**, ③⑩⑪⑫⑬⑭는 A-2b다.

## 2. 목표(What)

정상 수렴 series는 막지 않되, **무한 재리뷰를 물리적으로 끝낸다.** 자동 예산을 소진하면 사람 결정으로
전환하고, 어떤 경로로도 하드 상한을 넘지 못하게 한다.

**검수를 약화하지 않는다.** P1 기준·승인 바인딩·A-1 계수는 그대로다.

## 3. 요구(정규화)

### 예산 게이트

- **R1 자동 예산**: 자동 호출 **1~5회**를 허용한다. `attempts < autoBudget`이면 게이트를 통과한다.
  `attempts=4`(→5회차)도 통과한다 — 이력상 15/21이 ≤5회이므로 5회차를 막으면 정상 수렴을 죽인다. (Done #1)
- **R2 🔴 게이트 기준은 `attempts`이지 `escalated`가 아니다** (배분표 ⑤): `attempts >= autoBudget`이면
  다음 호출은 6회차이므로 예외가 필요하다 — **직전 outcome이 needs-fix든 invalid든 blocked든 같다.**
  외부 호출은 이미 `attempts`번 일어났고 비용도 그만큼 발생했다. `escalated`를 게이트 기준으로 쓰면
  5회차 INVALID/BLOCKED 뒤 6회차가 자동 통과하는 구멍이 생긴다. (Done #1)
- **R3 사람 예외**: 6~8회차(`autoBudget <= attempts < hardCap`)는 **사람의 명시적 승인마다 한 번씩만**
  허용한다. 승인 없이 6회차 이상을 실행하지 않는다. 예외는 **1회 소비되고 이월되지 않는다.** (Done #2)
- **R4 🔴 하드 상한**: **9번째(`attempts >= hardCap`) 외부 리뷰 호출은 어떤 경로로도 실행하지 않는다** —
  유효한 사람 예외가 있어도 차단한다. (Done #2)
- **R5 강제 지점**: 게이트는 **외부 호출 직전**(`withAttemptRecorded` 내, `recordAttempt` 전)에서
  fail-closed throw한다. 이것이 진짜 게이트다 — 사람이 `req:review-codex`를 직접 실행해도 막힌다. (Done #1)

### 설정

- **R6 설정 가능**: 예산은 `req.config.json`으로 설정 가능해야 한다. 지금의 작은 표본을 영구 정책으로
  굳히지 않는다. 미설정 시 기본값 `autoBudget=5`·`hardCap=8`. (Done #3)
- **R7 🔴 설정도 하드 상한을 넘을 수 없다** (배분표 ⑥): config 로드 시 검증한다(fail-closed) —
  `hardCap`은 **1 이상 8 이하**(9 이상이면 throw), `autoBudget`은 1 이상 `hardCap` 이하. **R4는 설정의
  상한이지 설정 가능한 값이 아니다.** config 한 줄로 R4가 무너지면 안 된다. (Done #3)

### 사람 예외 손기록

- **R8 손기록 패턴 재사용 + 형식 fail-closed**: 사람 예외는 `user_commit_confirmed`와 **같은 모양**의
  `review_exception_confirmed`를 state에 둔다. `confirmed`·`method`·`confirmed_at`·`for_series_id`·
  `for_attempt`·`note`. `confirmed_at`은 **실제 시계를 읽어** 기록한다(REQ-019 날조 폐기 이력).
  🔴 **소비 시 형식을 검증한다**(배분표 ⑪): `confirmed===true` + 비어있지 않은 `method` + **유효 ISO**
  `confirmed_at`이 아니면 무효. 유효 ISO = 형식(`ISO_RE`, 밀리초 선택) **+ 달력 유효성**(재파싱 성분 일치 —
  `2026-99-99...` 같은 불가능한 값 거부). `{confirmed:false, method:''}` 같은 날조 손기록으로 예외를
  통과시키지 않는다. 기존 `req-commit.ts`의 ISO 검증은 건드리지 않는다(범위 밖 — 후속 observation). (Done #2)
- **R9 예외는 대상 바인딩에만·1회만**: `for_series_id`·`for_attempt`가 **현재 series·현재 회차와 일치할
  때만** 유효하다. 사용되면 `null`로 소비되어 재사용 불가. 한 번 받은 예외로 6·7·8회차를 다 태우지
  못한다. (Done #2)
- **R10 🔴 예외 소비는 series를 닫지 않는다** (배분표 ①): 예외 소비는 **6~8회차 호출을 1회 허용하는
  행위**이지 종결이 아니다. `attempts`만 오르고 `closed_reason`은 `null`로 남는다. 만약 예외 소비가
  series를 닫으면, 다음 재리뷰가 **열린 series를 못 찾아 새 series(0회)를 열어** 7·8 예외와 9회 상한을
  통째로 우회한다. (Done #2)

### escalated 표시 · req:next

- **R11 `escalated`는 파생값이지 저장 필드가 아니다**: `escalated = (attempts >= autoBudget &&
  closed_reason === null)`. 저장하면 갱신 시점을 놓친 경로에서 실제와 어긋나 R2 구멍이 재현된다.
  `escalated`는 **표시용**이다 — 차단 근거가 아니다(차단은 R2의 `attempts`). (constraints)
- **R12 🔴 `req:next` G3 안내**: `gateRunCandidate`에 **G3**를 추가한다. 자동 예산을 소진한 series
  (`escalated`)면 `RUN`이 아니라 **`AWAIT_HUMAN`**을 내고, **시도 수·직전 리뷰 outcome·선택지**를
  `diagnostics`에 싣는다. **누적 findings는 넣지 않는다** — `last_review.findings`는 직전 리뷰만 담아
  INVALID/BLOCKED면 비어 거짓말을 한다(진짜 누적은 새 저장 모델 필요 → A-2b). (Done #4)
- **R13 🔴 게이트 우선순위 G1 → G3 → G2** (배분표 근거): 5회차 NEEDS_FIX 직후엔 `escalated=true`와 같은
  바인딩 needs-fix가 **동시 성립**한다. G3를 G2 뒤에 붙이면 G2가 먼저 `AGENT`("findings 고치고 다시 add")를
  반환해 escalate 안내가 영영 안 나온다. `commit_allowed`(0) → G1(1) → **G3(2)** → G2(3) 순서. (Done #4)
- **R14 사람 선택지**: `req:next`는 escalate에서 범위 유지 후 수정 · 종료 · 대체 REQ 작성(A-2b) 중 사람이
  결정하게 안내한다. **"명시적 위험 수용"은 넣지 않는다**(배분표 ④ — 우회 게이트가 필요한 별도 통제점). (Done #4)

### 범위·안전

- **R15 A-1 계수 무변경**: `recordAttempt`·`closeSeriesApproved`·series 판정은 **바꾸지 않는다.** 게이트는
  `withAttemptRecorded`에 **삽입**이며 계수 자체를 건드리지 않는다. (constraints)
- **R16 기존 흐름 무변경**: G1·G2·`classifyReview`·승인 바인딩·BLOCKED/INVALID/D9·legacy 처리를
  **약화하지 않는다.** G3는 추가다. (constraints)
- **R17 지원 범위**: 단일 활성 worktree + 협조적 작업자만. **"어떤 경로로도 차단"(R4)은 이 경계 안의
  주장이다** — `state.json`을 손으로 지우면 우회된다. 그것은 결함이 아니라 명시된 경계다(transactional
  backend 없음). multi-worktree lock·CAS·자동 recovery 미구현. (constraints)
- **R18 테스트·typecheck**: 단위 테스트·typecheck 통과. near-e2e로 게이트 강제를 main 경로에서 검증한다
  (A-1의 fake reviewer 주입 seam 재사용). (Done #5)

## 4. 비목표 — 이번 범위에서 구현하지 않음

- 🔴 **A-2b**: lineage(`--successor-of`·`human_resolution` 부모 손기록·자식이 읽기)·로그 4필드 확장
  (`series_id`·`attempt_number`·`escalated`·`successor_of`, 호출 시점 snapshot)·`human-resolution` terminal.
  배분표 ③⑩⑪⑫⑬⑭. **전부 범위 밖.**
- 🔴 **"명시적 위험 수용" 전이**(리뷰 승인 없이 커밋하는 우회 게이트, 배분표 ④). `B1`처럼 별도 통제점 — 별도 REQ.
- REQ-B(design delta review)·REQ-C(승인 단위 분리).
- 기존 REQ-001~027의 문서·state·승인 evidence 소급 수정. REQ-026 브랜치는 merge 금지 감사보존.

## 5. 인수 기준

1. `attempts=0..4`에서 게이트 통과(5회차 포함). `attempts=5`에서 예외 없이 부르면 throw.
2. 5회차가 INVALID/BLOCKED였어도(escalated=false) 6회차는 예외를 요구한다 — 게이트 기준은 `attempts`.
3. `attempts=8`이면 유효한 사람 예외가 있어도 throw(9번째 차단).
4. config `hardCap`이 8 초과 또는 1 미만이면 throw. `autoBudget`이 1 미만 또는 `hardCap` 초과면 throw.
   미설정=5/8. 런타임 `CONFIG_SCHEMA`와 배포용 `workflow/req.config.schema.json` 동치 유지.
5. 사람 예외는 `for_series_id`/`for_attempt` 불일치면 무효, **형식(confirmed/method/ISO) 위반도 무효**,
   사용되면 `null`로 소비(재사용 불가).
6. 예외 소비 후 series는 **열린 채**(`closed_reason===null`)·`attempts` 증가 — 6회차 NEEDS_FIX 뒤 7회차는
   또 예외를 요구한다(우회 없음).
7. `req:next`가 escalated series에서 `RUN`이 아니라 `AWAIT_HUMAN`을 내고 누적 정보를 싣는다.
8. G3가 escalated+동일바인딩 동시 성립에서 `AWAIT_HUMAN`(G1 dirty면 AGENT 우선). 정상 series는 G2 무변경.
9. near-e2e: `attempts=5` state에서 예외 없이 main()을 돌리면 fake reviewer **호출 0회** + throw.
   예외 있으면 6회차 호출 1회 + attempts=6 + series 열린 채.
10. A-1 계수·기존 게이트·legacy 처리 무변경. 단위 테스트·typecheck 통과.
