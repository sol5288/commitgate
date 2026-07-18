# REQ-2026-029 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

> **오라클 원칙(REQ-2026-025 교훈)**: 오라클은 "필드가 있다"가 아니라 **"지우면/뒤집으면 실패한다"** 로 쓴다.
> 026이 이 영역에서 잡힌 ③⑩⑪을 각 오라클이 재현·차단한다.

## Phase 1 — human-resolution terminal (`phase-1-human-resolution-terminal`)

범위: D1·D2. `closed_reason` 확장 · `HumanResolution` · `closeSeriesHumanResolution` ·
`isValidHumanResolution` · `isSeriesKeyTerminal` · terminal 가드(withAttemptRecorded + req:next).

변경 파일: `scripts/req/review-codex.ts` · `scripts/req/req-next.ts` · `tests/unit/req-review-codex.test.ts` ·
`tests/unit/req-next.test.ts`

### Oracle — 순수 함수

- **O1-1 `closeSeriesHumanResolution`**(R2): 열린 series를 `closed_reason='human-resolution'`+`human_resolution`
  으로 닫는다. 열린 게 없으면 throw. → approved된 series를 human-resolution으로 닫으려 하면(열린 게 없음) throw.
- **O1-2 🔴 형식 fail-closed**(R3, 배분표 ⑪): `isValidHumanResolution`이 `decision∈{terminate,replace}` 아님·
  `method` 빈값·`decided_at` 비-ISO(`2026-99-99...` 포함) 각각 false. 유효값 true. 밀리초 없는 ISO 통과.
  → 검증 없으면 `{decision:'',decided_at:'x'}`가 통과해 날조 종결(REQ-019 부류).
- **O1-3 🔴 terminal 판정**(R4, 배분표 ③): `isSeriesKeyTerminal`이 `(kind,phase_id)`에 human-resolution
  레코드가 있으면 true. `approved`만 있는 키·null 키는 **false**(재개방 정상).
  → approved를 terminal로 보면 정상 재리뷰가 막히고, human-resolution을 terminal로 안 보면 세탁이 뚫린다.

### Oracle — 가드(near-e2e / withAttemptRecorded)

- **O1-4 🔴 human-resolution terminal 키는 recordAttempt 전에 막힌다**(R4): human-resolution 레코드가 있는
  `(kind,phase_id)`로 `withAttemptRecorded`를 부르면 **throw**(새 series 안 열림, attempts 안 늘어남).
  → **가드 없으면 recordAttempt가 새 series(0회)를 열어** 예산이 리셋된다(배분표 ③ 세탁).
- **O1-5 🔴 approved 뒤 재개방은 정상**(R4 대비): approved로 닫힌 키로 `withAttemptRecorded`를 부르면
  **새 series가 정상적으로 열린다**(throw 없음, attempts=1). → terminal 가드가 approved까지 막으면 A-1 재개방을 깬다.
- **O1-6 req:next terminal 안내**(R4): terminal 키 상태에서 `resolveNext`가 `RUN`이 아니라 `AWAIT_HUMAN`
  (종결됨 — 대체 REQ 안내). 우선순위: terminal이 G3(escalated)보다 앞. → 종결된 series에 예산 안내를 내면
  "고치고 예외 받으라"는 틀린 조언.
- **O1-7 기존 게이트 무변경**(R10): terminal 아닌 series에서 A-2a G3·A-1 계수·G1·G2가 종전대로.
  approved된 series의 새 series는 A-2a 예산 게이트를 정상적으로 받는다.

### 정직성 — 이 phase가 증명하지 않는 것

- **손기록을 사람이 정확히 넣는다**는 증명 안 함 — `decided_at` 실제 시계는 운영 규율(예외 손기록과 동일).
  오라클은 **형식 검증**(잘못된 손기록 거부)만 고정한다.
- **대체 REQ 생성**은 phase-2다. phase-1은 terminal 종결까지만.

Exit: typecheck0 · 단위 그린 · Codex phase 리뷰 승인.

## Phase 2 — successor-of lineage (`phase-2-successor-of`)

범위: D3. `--successor-of` · `resolveSuccessorLineage` · `SuccessorOf` · 부모 읽기 · `buildInitialState` 확장.

변경 파일: `scripts/req/req-new.ts` · `scripts/req/review-codex.ts`(타입) · `tests/unit/req-new.test.ts` ·
`tests/unit/req-review-codex.test.ts`

### Oracle — resolveSuccessorLineage(순수)

- **O2-1 🔴 부모에 replace 기록 없으면 throw**(R6, 배분표 ⑩): 부모 series가 전부 approved거나
  human-resolution이지만 `decision='terminate'`면 **throw**. `decision='replace'` + 유효 형식이어야 통과.
  → 이게 없으면 lineage 없이 새 예산을 받는다(= 예산 세탁 정의).
- **O2-2 🔴 lineage는 부모에서 읽는다**(R7): 반환 `SuccessorOf`의 `parent_attempts_total`(모든 series 합)·
  `parent_replace_resolution`(그 레코드 그대로)이 **부모 state에서** 채워진다. 부모 값을 바꾸면 따라 바뀐다.
  → CLI로 받거나 사람이 넘긴 값을 믿으면 전사 오류·날조.
- **O2-3 형식 위반 replace도 거부**(R3·R6): 부모에 `decision='replace'`지만 `method:''`·`decided_at:'x'`면
  `isValidHumanResolution` 실패 → throw. → enum만 보고 형식 안 보면 날조 replace로 자식 생성.

### Oracle — req:new 통합(near-e2e)

- **O2-4 🔴 부모 없음·읽기 실패 → throw·티켓 미생성**(R6): 존재하지 않는 `--successor-of REQ-…`면 throw하고
  **티켓 디렉터리가 안 생긴다**. → lineage 비운 채 새 예산을 주는 구현 차단.
- **O2-5 정상 successor**(R7·R8): 부모에 유효 replace 기록이 있으면 자식 티켓이 생성되고, state의
  `successor_of`에 부모 attempts 합·replace resolution·recorded_at이 채워진다. 자식 `review_series`는 **빈
  배열/부재**(새 예산). `review_series_model_version=1`(새 모델).
- **O2-6 `--successor-of` 없으면 종전대로**(R9): 옵션 없이 `req:new`면 `successor_of` 없이 정상 생성.
  → lineage는 opt-in이고 도구가 대체 여부를 추정하지 않는다(한계 명시).

### 정직성 — 이 phase가 증명하지 않는 것

- **`--successor-of` 안 붙이고 새 REQ를 만드는 것은 막지 못한다**(R9). 도구는 대체 여부를 모른다 — 사람만
  안다. 협조적 작업자 전제 안의 한계. 막는 것은 붙였는데 부모에 기록이 없는 경우(O2-1·O2-4).

Exit: typecheck0 · 단위 그린 · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(unit·typecheck) · 사용자 main 반영(별도 승인).
- 이 REQ는 additive다. **로그 측정 REQ(⑫⑬⑭)를 기다리지 않고 단독 병합한다.**
- 이 repo에 lint 스크립트는 없다(게이트 = typecheck + vitest).
