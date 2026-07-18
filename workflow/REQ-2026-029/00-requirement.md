# REQ-2026-029 요구사항 — review lineage (개선 REQ-A-2b)

## 1. 배경

A-2a(REQ-2026-028, main `2bfb64a`)가 예산 게이트를 넣어 무한 재리뷰를 물리적으로 끝냈다. escalate된
series는 사람이 **종료 또는 대체 REQ 작성**으로 결정한다(G3가 안내). **그런데 그 결정이 기록되지 않고,
대체 REQ가 예산을 어떻게 이어받는지 계약이 비어 있다.**

문제(배분표 ③⑩⑪):
- **③**: escalate 뒤 사람이 대체를 결정해도, **같은 부모의 설계를 고치면 새 series(0회)가 자동으로 열려**
  예산이 리셋된다 — lineage 방어를 정상 도구 경로가 우회한다.
- **⑩**: 대체 REQ의 `successor_of`에 "사람 결정"을 넣으려면 **읽을 출처가 있어야** 한다. 부모가 기록하지
  않으면 자식이 그 값을 갖는 유일한 경로는 **날조**다(REQ-019 폐기 사유와 같은 구조).
- **⑪**: 손기록 형식을 검증하지 않으면 `{decision:'', decided_at:'x'}`도 통과한다.

이 REQ는 **예산 세탁을 막는 실체**를 완성한다 — "티켓만 새로 만들어 예산을 리셋"하는 경로를 fail-closed로
닫는다. 대체 REQ는 여전히 새 예산을 받되(사람이 결정했으므로), **누가·언제·무슨 문장으로 허용했는지가
숨겨지지 않는다.**

**출처와 분할**: REQ-2026-026(통합 REQ-A)의 D6이 이 설계다(merge 금지 감사보존). A를 A-1(계수)·A-2a
(게이트)·A-2b(lineage)로 나눴고, 로그 측정(⑫⑬⑭)은 **별도 REQ**로 남긴다. 근거: A-1·A-2a가 ~360줄로
4라운드 수렴했다 — 표면을 그 체급으로. 이 REQ는 배분표 **③⑩⑪**까지만.

## 2. 목표(What)

escalate된 series의 사람 종결을 **부모에 기록**하고, 대체 REQ가 그것을 **읽어** lineage를 채운다.
부모에 기록이 없으면 대체 REQ 생성은 **실패**한다. 대체 REQ는 새 예산을 받되 부모 이력이 보존된다.

**검수·게이트를 약화하지 않는다.** A-2a 예산 게이트·A-1 계수는 그대로다.

## 3. 요구(정규화)

### human-resolution 종결

- **R1 `closed_reason` 확장**: `SeriesRecord.closed_reason`에 `'human-resolution'`을 추가한다
  (`'approved' | 'human-resolution' | null`). A-2a가 열린 확장으로 남긴 타입을 채운다. (Done #1)
- **R2 사람 종결 손기록**: escalate된 series를 사람이 **종료 또는 대체**로 결정하면, 그 series 레코드에
  `human_resolution`을 손기록한다. `decision`(`'terminate' | 'replace'`)·`method`(받은 승인 문장)·
  `decided_at`(**실제 시계**)·`note`. `closed_reason`을 `'human-resolution'`으로 닫는다. (Done #1)
- **R3 🔴 형식 fail-closed**(배분표 ⑪): `human_resolution` 소비·판정 시 검증한다 —
  `decision ∈ {'terminate','replace'}` + 비어있지 않은 `method` + 유효 ISO `decided_at`
  (**A-2a의 `isValidIsoInstant` 재사용** — 형식+달력). 어긋나면 무효. (Done #1)
- **R4 🔴 human-resolution 뒤 terminal**(배분표 ③): `(kind, phase_id)`에 `closed_reason='human-resolution'`
  레코드가 **하나라도 있으면** 그 키는 **terminal**이다. 새 series를 **자동으로 열지 않는다** —
  `recordAttempt`(A-1)가 그 키를 해소하려 하면 열지 않고, 호출 지점·`req:next`가 사람에게 넘긴다.
  `approved`(문제 해결됨 → 재개방 정상)와 **재개방 규칙이 정반대**다. (Done #1)

### lineage

- **R5 `--successor-of <REQ-id>`**: `req:new`에 옵션 추가. 부모 state를 읽어 lineage를 채운다.
  **자동 생성은 없다**(사람이 명시). (Done #2)
- **R6 🔴 부모 검증 fail-closed**(배분표 ⑩): `--successor-of`는 아래를 전부 만족해야 티켓을 생성한다.
  하나라도 어긋나면 **throw(티켓 미생성)**.
  - 부모 state를 읽을 수 있다(없으면 throw).
  - 부모에 `closed_reason='human-resolution'` **이고** `human_resolution.decision='replace'`인 series가 있다
    (없으면 throw — "부모에 대체를 허용한 사람 결정 기록이 없다").
  - 그 `human_resolution`이 R3 형식 검증을 통과한다. (Done #2)
- **R7 lineage는 부모에서 읽는다**: `successor_of`의 모든 값은 **부모 state에서 읽어 채운다** — CLI로 받지
  않는다(전사 오류·날조 통로 차단). `req_id`·`parent_attempts_total`(부모 모든 series attempts 합)·
  `parent_replace_resolution`(그 `human_resolution` 레코드 그대로)·`recorded_at`(실제 시계). (Done #2)
- **R8 새 예산·이력 보존**: 대체 REQ는 새 series 모델(빈 review_series)로 시작해 **새 예산을 받는다**
  (사람이 결정했으므로). 그러나 `successor_of`가 부모 이력을 보존해 "N번째 재시작"이 보인다. R17의 목적은
  재시작을 **막는** 것이 아니라 **숨기지 못하게** 하는 것. (Done #2)

### 범위·안전

- **R9 한계(정직)**: `--successor-of`를 **안 붙이고** 새 REQ를 만들면 lineage 없이 새 예산을 받는다.
  도구는 "이 REQ가 저 REQ의 대체인가"를 알 수 없다 — 사람만 안다. **협조적 작업자 전제** 안의 한계이며
  설계는 그 이상을 약속하지 않는다. 막는 것은 **`--successor-of`를 붙였는데 부모에 기록이 없는** 경우다. (constraints)
- **R10 A-1·A-2a 무변경**: `recordAttempt`·`checkReviewBudget`·`consumeReviewException`·예산 게이트·G3는
  **바꾸지 않는다**. `recordAttempt`가 terminal 키를 안 여는 것(R4)은 **추가 가드**이지 계수 로직 변경이
  아니다. G1·G2·승인 바인딩·`machine.schema.json` 무변경. (constraints)
- **R11 accept-risk 없음**: escalate 선택지에 "명시적 위험 수용"을 넣지 않는다(배분표 ④). 리뷰 승인 없이
  커밋하는 우회 게이트는 별도 통제점 — 별도 REQ. `decision`은 `'terminate' | 'replace'` 둘뿐. (constraints)
- **R12 테스트·typecheck**: 단위 테스트·typecheck 통과. near-e2e로 terminal 가드와 `--successor-of` 검증을
  확인한다. (Done #3)

## 4. 비목표 — 이번 범위에서 구현하지 않음

- 🔴 **로그 측정**(배분표 ⑫⑬⑭): 로그 4필드 확장(`series_id`·`attempt_number`·`escalated`·`successor_of`,
  호출 시점 snapshot)·`parent_open_findings`(`findings.length+elided_count`)·G3 누적 findings(새 저장 모델).
  **별도 REQ.**
- 🔴 **accept-risk 우회 게이트**(배분표 ④). `B1`처럼 별도 통제점 — 별도 REQ.
- REQ-B(design delta review)·REQ-C(승인 단위 분리).
- 기존 REQ-001~028의 문서·state·승인 evidence 소급 수정. REQ-026 브랜치는 merge 금지 감사보존.
- `req-commit.ts`의 기존 ISO 검증 달력 결함(A-2a가 남긴 후속 observation) — 이 REQ 범위 아님.

## 5. 인수 기준

1. `SeriesRecord.closed_reason`이 `'human-resolution'`을 받는다. `human_resolution` 손기록 형식이 검증된다
   (decision enum·비어있지 않은 method·유효 ISO `decided_at` — `2026-99-99...` 거부).
2. 🔴 human-resolution terminal: 그 키에 human-resolution 레코드가 있으면 `recordAttempt`가 새 series를
   자동으로 안 열고, 호출 지점·`req:next`가 사람에게 넘긴다. `approved` 뒤 재개방은 **정상**(대비).
3. `--successor-of` 부모 검증: 부모 없음·replace 기록 없음·형식 위반 각각 **throw(티켓 미생성)**.
4. 정상 `--successor-of`: `successor_of`에 부모의 attempts 합·replace resolution·recorded_at이 부모에서
   **읽혀** 채워진다. 부모 state를 바꾸면 값이 따라 바뀐다(CLI로 안 받음).
5. 대체 REQ는 빈 review_series로 시작(새 예산). 부모 이력은 `successor_of`에 보존.
6. A-1 계수·A-2a 게이트·G1·G2·승인 바인딩 무변경. 단위 테스트·typecheck 통과.
