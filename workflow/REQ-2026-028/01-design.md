# REQ-2026-028 설계 — review 예산 게이트·escalation·사람 예외

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

- **`withAttemptRecorded`(`review-codex.ts:773`, A-1 D3)** — `recordAttempt` → `writeState`(호출 前) →
  `call()`. **게이트 삽입 지점이 여기다** — `recordAttempt` **전**에 예산을 검사해 초과면 throw. 계수(A-1)는
  그대로 두고 그 앞에 게이트만 얹는다(R15).
- **`recordAttempt`·`closeSeriesApproved`(A-1 D2)** — 순수. `SeriesRecord{series_id, review_kind, phase_id,
  attempts, closed_reason:'approved'|null}`. 열린 series = 같은 `(kind,phase_id)`에 `closed_reason===null`.
- **`gateRunCandidate`(`req-next.ts:349`)** — G1(워킹트리 clean)·G2(바인딩 신선도). **G3를 여기 삽입**한다.
  `resolveNext` 우선순위: `commit_allowed`(1번) → legacy(1.5, A-1) → design/phase RUN 후보(`gateRunCandidate`).
- **`user_commit_confirmed`** — 사람 손기록 state 패턴. `req:commit`이 1회 소비→`null`. **`review_exception_confirmed`
  가 같은 모양**(R8).
- **`loadConfig`(`config.ts:183`)** — `req.config.json` 파싱·AJV 검증·DEFAULTS 병합·범위 검증(fail-closed
  throw). **`reviewBudget`를 여기 추가**하고 범위를 검증한다(R7).
- **A-1 near-e2e 하네스**(`req-review-codex.test.ts`) — fake reviewer를 `main(argv,{reviewer})`에 주입,
  `setupRepo`·`cannedDesign`·process.exit mock. **재사용**한다.

## 핵심 설계 결정

### D1. 예산 게이트는 순수 함수 + `withAttemptRecorded` 삽입 (R1·R2·R4·R5)

**순수 판정 함수** `checkReviewBudget`를 만든다 — 게이트 결정을 계수·I/O에서 분리해 단위 테스트로 고정한다.

```ts
export interface ReviewBudget { autoBudget: number; hardCap: number }
export type BudgetDecision =
  | { kind: 'allow' }                         // attempts < autoBudget (자동)
  | { kind: 'needs-exception'; attempt: number } // autoBudget <= attempts < hardCap (6~8회차)
  | { kind: 'hard-blocked'; attempt: number }    // attempts >= hardCap (9회차 — 어떤 경로로도 차단)

export function checkReviewBudget(openAttempts: number, budget: ReviewBudget): BudgetDecision
```

- `openAttempts` = 현재 **열린** series의 `attempts`(없으면 0). **이 다음 호출이 `openAttempts+1`회차**다.
- 🔴 **기준은 `attempts`뿐**(R2, 배분표 ⑤): `escalated` 같은 파생 플래그를 게이트 입력으로 쓰지 않는다.
  5회차가 INVALID/BLOCKED였어도 `attempts`는 5이므로 6회차는 `needs-exception`이다.
- `allow` → 그대로 진행. `needs-exception` → 유효한 사람 예외가 있으면 소비하고 진행, 없으면 throw.
  `hard-blocked` → **예외 유무와 무관하게 throw**(R4).

**`withAttemptRecorded`에 게이트를 삽입**한다. 시그니처를 확장한다:

```ts
withAttemptRecorded(
  ctx: { ticketDir; state; kind; phaseId; budget: ReviewBudget },
  call,
): { result, state }
```

순서(계약):
1. `openAttempts` 계산(열린 series의 attempts) → `checkReviewBudget`
2. `needs-exception`이면 `consumeReviewException(state, seriesId, attempt)` — 유효하면 소비(`null`), 무효/부재면 throw
3. `hard-blocked`이면 throw(예외 안 봄)
4. `allow`(또는 예외 소비 성공) → `recordAttempt` → `writeState` → `call()`

**게이트가 `recordAttempt` 전인 이유**: attempt를 기록하고 나서 막으면 계수가 오염된다. 막을 거면 **호출도
기록도 하기 전에** 막아야 한다. throw 시 state는 A-1 계약대로 바뀌지 않는다(예외 소비 성공 시에만 쓰기).

### D2. 사람 예외 = 손기록 패턴 (R3·R8·R9·R10)

`state.review_exception_confirmed`(`user_commit_confirmed`와 같은 모양):

```jsonc
{
  "confirmed": true,
  "method": "in-chat: \"review 6회차 예외 승인\"",  // 받은 승인 문장 그대로
  "confirmed_at": "<실제 시계>",                     // 지어내지 않는다(REQ-019)
  "for_series_id": "design:-#1",                     // 이 series에만
  "for_attempt": 6,                                  // 이 회차에만(= openAttempts+1)
  "note": "감사 기록이며 위조불가 증명이 아니다."
}
```

**`consumeReviewException(state, seriesId, nextAttempt)`(순수)** — **fail-closed 형식 검증 먼저**:
- `review_exception_confirmed`가 없으면 → 무효(throw 유발).
- 🔴 **손기록 형식 검증**(design-r01 P1, 배분표 ⑪과 같은 결함): 아래 중 하나라도 어긋나면 **무효**.
  - `confirmed !== true`
  - `method`가 비어 있음(빈 문자열·공백만·비문자열)
  - `confirmed_at`이 유효 ISO가 아님 — **형식(`ISO_RE`) + 달력 유효성** 둘 다 본다(design-r02·r03).
    - **형식**: `req-commit.ts:37`의 `ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/`.
      밀리초 선택적이라 `...08Z`도 통과(r02 observation).
    - **달력 유효성**(r03 P1): `ISO_RE`만으론 `2026-99-99T99:99:99Z` 같은 **달력상 불가능한 값**도 통과한다.
      그래서 `new Date(s)`가 `NaN`이 아니고 **`d.toISOString()`의 날짜·시각 성분이 입력과 일치**하는지 확인한다.
      밀리초 표기 차(`08Z` vs `08.000Z`)는 비교에서 정규화한다 — **성분(연·월·일·시·분·초)이 보존**되면 유효.
      즉 형식은 `ISO_RE`로, 의미는 재파싱으로 잡는다(둘 다 필요 — 어느 하나로는 부족).
    - 이 검증을 **새 헬퍼 `isValidIsoInstant(s): boolean`**(review-codex 또는 lib)로 만들어
      `consumeReviewException`에서 쓴다. `ISO_RE` 형식 검사 + 달력 유효성(재파싱 성분 일치)을 한 함수로.
    - ⚠️ **범위 경계**: `req-commit.ts`의 기존 `ISO_RE`(user_commit_confirmed·evidence 검증)는 **건드리지
      않는다** — 그것도 같은 달력 결함이 있지만, 고치는 것은 A-2a(예산 게이트) 범위가 아니다. 후속
      observation으로 남긴다. 이 REQ는 **새로 도입하는 `review_exception_confirmed`만** 엄격 검증한다.
  → 이게 없으면 `{confirmed:false, method:'', confirmed_at:'x'}`도 소비되어 R3(명시적 사람 승인)·R8을
  우회한다. `user_commit_confirmed`가 감사 기록인 것과 같은 수준의 형식 무결성을 요구한다.
- `for_series_id !== seriesId` 또는 `for_attempt !== nextAttempt`면 → **무효**(R9). 한 번 받은 예외로
  다른 series·다른 회차를 태우지 못한다.
- 위를 전부 통과하면 → `review_exception_confirmed`를 `null`로 지운 state 반환(1회 소비, 무이월).

**🔴 예외 소비는 series를 닫지 않는다**(R10, 배분표 ①). `consumeReviewException`은 `closed_reason`을 건드리지
않는다. 이어지는 `recordAttempt`가 **같은 열린 series**의 attempts만 올린다. 만약 닫으면 다음 리뷰가
열린 series를 못 찾아 새 series(0회)를 열어 7·8 예외와 9회 상한을 통째로 우회한다.

**`consumeReviewException`은 `withAttemptRecorded` 안에서 `recordAttempt` 전에 호출**되고, 그 반환 state가
`recordAttempt`의 입력이 된다(소비 반영).

### D3. config 예산 + 범위 검증 (R6·R7)

`req.config.json`에 `reviewBudget`(선택):

```jsonc
"reviewBudget": { "autoBudget": 5, "hardCap": 8 }
```

`RawConfig`·`ResolvedConfig`에 `reviewBudget: ReviewBudget` 추가. DEFAULTS = `{autoBudget:5, hardCap:8}`.

🔴 **`loadConfig`에서 fail-closed 범위 검증**(R7, 배분표 ⑥):
- `hardCap`: 정수, **1 이상 8 이하**. 9 이상이면 **throw**("reviewBudget.hardCap는 8을 넘을 수 없다 —
  9번째 외부 리뷰는 어떤 경로로도 허용되지 않는다").
- `autoBudget`: 정수, 1 이상 `hardCap` 이하. 벗어나면 throw.

**하드 상한 8이 설정을 넘는 값이 아니라 코드 상수 경계인 이유**: R4("9번째는 어떤 경로로도 차단")가
config로 뚫리면 안전망 전체가 무의미하다. R6가 조절하는 것은 그 **안쪽**(1~8)이다. AJV 스키마로 타입을,
loadConfig 검증으로 의미 경계를 잡는다(스키마만으론 `hardCap<=8`을 표현해도 `autoBudget<=hardCap` 교차
검증은 코드가 필요).

🔴 **런타임·배포용 스키마 둘 다 바꾼다**(design-r01 P1): `CONFIG_SCHEMA`(런타임 AJV)와 배포용
`workflow/req.config.schema.json`의 **동치를 고정하는 드리프트 가드 테스트**가 이미 있다
(`req-config.test.ts:296`). 런타임만 바꾸면 그 테스트가 실패하고, 설치본의 `additionalProperties:false`
스키마가 정상적인 `reviewBudget` 설정을 거부해 R6와 어긋난다. **두 파일에 `reviewBudget` 프로퍼티를
동일하게 추가**한다. 스키마는 타입·상한(`hardCap` maximum 8)까지, 교차검증(`autoBudget<=hardCap`)·하한은
loadConfig 코드가 담당.

**observation 반영**: `req.config.json.sample`에도 `reviewBudget`를 넣어 사용자가 설정값을 발견·입력할 수
있게 한다(비차단이지만 같이 처리 — 파일이 존재하고 phase-1 diff에 포함됨).

### D4. `req:next` G3 — 우선순위 G1 → G3 → G2 (R11·R12·R13·R14)

`gateRunCandidate`에 **G3**를 G1과 G2 **사이**에 삽입한다.

```
gateRunCandidate:
  G1: 워킹트리 dirty → AGENT (정리 먼저)
  G3: escalated(openAttempts >= autoBudget && closed_reason===null) → AWAIT_HUMAN  ← 신규
  G2: 같은 바인딩 신선도 → AGENT/BLOCKED (기존)
  → RUN
```

**🔴 G3가 G2보다 앞서는 이유**(R13, 배분표 근거): 5회차 NEEDS_FIX 직후엔 `escalated`이면서 `last_review`가
같은 compare_hash로 needs-fix다(동시 성립). G3를 G2 뒤에 두면 G2가 먼저 `AGENT`("findings 고치고 다시
add")를 반환한다 — 그 조언은 **거짓**이다(고쳐도 사람 승인 없이 6회차가 안 열린다). 그래서 G3가 먼저
`AWAIT_HUMAN`으로 사람에게 넘긴다.

**G1이 G3보다 앞서는 이유**: 워킹트리 dirty면 `AWAIT_HUMAN`을 내도 사람이 할 게 없다(승인해도 D10에서
죽는다). 정리가 먼저다.

**`escalated`는 파생값**(R11): `gateRunCandidate`가 열린 series의 attempts와 autoBudget으로 그 자리에서
계산한다. state에 저장하지 않는다 — 저장하면 갱신 누락 경로에서 실제와 어긋나 R2 구멍이 생긴다.

**`NextInput`에 `reviewBudget: ReviewBudget`을 추가**한다(순수 입력 유지 — `req-next.ts` main이 cfg에서 채움).
G3 `diagnostics`: **시도 수**(openAttempts)·**직전 리뷰 outcome**(`last_review.outcome`)·선택지
(범위 유지 후 수정 / 종료 / 대체 REQ 작성 — **위험 수용은 없음**, R14·배분표 ④).

🔴 **누적 findings는 G3 안내에 넣지 않는다**(design-r01 P1). `last_review.findings`는 buildFindingsSnapshot으로
**직전 리뷰만** 담고 매 호출 덮어쓴다 — INVALID/BLOCKED면 비어 있어 "5회차가 INVALID면 누적 0건"으로
거짓말을 한다. **진짜 누적 findings를 보이려면 새 저장 모델이 필요한데, 그건 A-2a 범위를 키운다.** G3는
시도 수와 직전 outcome으로 "이 series가 자동 예산을 소진했다"를 충분히 전달한다 — 누적 findings 표시는
lineage와 함께 **A-2b**로 미룬다(R12를 "시도 수·직전 outcome·선택지 제공"으로 축소, 누적 findings는 비목표).

`hard-blocked`(9회차)면 G3는 "예외로도 진행 불가 — 종료 또는 대체 REQ"만 안내한다(6~8과 문구 구분).

### D5. hardCap 도달의 표현 (R4)

`checkReviewBudget`의 `hard-blocked`는 **호출 지점 강제**(throw)에서만 의미가 있다. `req:next` G3는
escalated(6회차 이후)면 전부 `AWAIT_HUMAN`이고, 그중 9회차 이상은 "예외로도 안 됨"을 문구로 구분한다 —
`req:next`는 어차피 호출을 실행하지 않는 안내자라 강제는 D1의 throw가 담당한다.

## Phase별 구현

| phase | 범위 | 변경 파일 |
|---|---|---|
| `phase-1-budget-gate` | D1·D2·D3 — `checkReviewBudget`·`consumeReviewException`(형식 검증 포함)·`withAttemptRecorded` 게이트 삽입·config 예산·검증(런타임+배포 스키마+sample) | `review-codex.ts`·`lib/config.ts`·`workflow/req.config.schema.json`·`req.config.json.sample`·테스트 |
| `phase-2-req-next-g3` | D4·D5 — `gateRunCandidate` G3(시도 수·직전 outcome·선택지)·`NextInput.reviewBudget`·우선순위 | `req-next.ts`·테스트 |

phase 순서 근거: 강제 게이트(D1)가 먼저 main에 있어야 안전하다. `req:next` G3(안내)는 강제 없이 배송돼도
"안내만 하고 실행은 호출 지점이 막는" 상태라 무해하지만, 강제가 먼저 있으면 phase-1만 병합돼도 상한이
실제로 작동한다. phase-2는 UX(사람이 실행 전에 안내받음)를 더한다.

## 변경 파일

- `scripts/req/review-codex.ts` — `ReviewBudget`·`BudgetDecision`·`checkReviewBudget`·`consumeReviewException`
  (형식 검증)·`withAttemptRecorded` 게이트 삽입(p1)
- `scripts/req/lib/config.ts` — `reviewBudget` config + `CONFIG_SCHEMA` + 범위 검증(p1)
- `workflow/req.config.schema.json` — 배포용 스키마에 `reviewBudget`(드리프트 가드 동치, p1)
- `req.config.json.sample` — `reviewBudget` 예시(p1, observation)
- `scripts/req/req-next.ts` — G3 + `NextInput.reviewBudget`(p2)
- `tests/unit/req-review-codex.test.ts` · `req-config.test.ts` · `req-next.test.ts` — 오라클

`review-codex.ts`의 `main()`은 `cfg.reviewBudget`을 `withAttemptRecorded` ctx에 넘긴다(p1 배선).

## 하위호환·안전

- **A-1 계수 무변경**(R15): `recordAttempt`·`closeSeriesApproved`·`SeriesRecord`·series 판정 그대로. 게이트는
  `withAttemptRecorded`에 **삽입**이며 계수 로직을 건드리지 않는다. `closed_reason` 타입도 `'approved'|null`
  그대로 — A-2b가 `'human-resolution'`을 더한다.
- **G1·G2·`classifyReview`·승인 바인딩·BLOCKED/INVALID/D9·legacy 무변경**(R16). G3는 **삽입**이며 기존
  판정을 바꾸지 않는다 — escalated가 아닌 정상 series에선 G2가 종전대로 동작한다.
- **`machine.schema.json` 무변경** → v1.1 archive·legacy evidence 그대로. 이 REQ는 state 필드
  (`review_exception_confirmed`)·config·도구 동작만 바꾼다.
- **미설정 시 기본값**(5/8)이라 기존 repo·기존 티켓은 config 없이 그대로 동작한다. 기존 진행 중 티켓의
  열린 series attempts가 이미 크면(예: A-1 dogfooding으로 attempts=4) 다음 호출부터 게이트가 적용된다 —
  이는 정상(그 series는 실제로 그만큼 리뷰됐다).
- **"어떤 경로로도 차단"(R4)은 단일 활성 worktree 경계 안**(R17). `state.json`을 손으로 지우면 우회된다 —
  명시된 경계이지 결함이 아니다. 설계는 transactional 절대 보장을 약속하지 않는다.
- 이 REQ는 **additive**다. 완료 시 A-2b를 기다리지 않고 단독 병합한다. A-2a만으로 무한 재리뷰 상한이
  **실제로 작동한다**(lineage 없이도 게이트는 완결). lineage는 escalation 이후 대체 REQ 계보라 A-2b다.
