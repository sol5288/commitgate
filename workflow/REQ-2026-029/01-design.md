# REQ-2026-029 설계 — review lineage

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

- **`SeriesRecord`(`review-codex.ts:699`)** — `closed_reason: 'approved' | null`. A-2a가 **열린 확장**으로
  남겼다. `'human-resolution'`을 추가한다(R1).
- **`recordAttempt`(`:730`, A-1)** — 순수. 같은 `(kind,phase_id)` 열린 series면 +1, 없으면 새로 연다.
  **이 함수는 안 바꾼다**(R10) — terminal 가드는 별도 함수로 호출 지점에서 검사한다.
- **`withAttemptRecorded`(A-1 D3 + A-2a D1)** — 예산 게이트 삽입됨. **terminal 가드를 예산 게이트 앞에**
  둔다(terminal이면 예산을 볼 필요도 없이 사람에게 넘긴다).
- **`consumeReviewException`·`isValidIsoInstant`(A-2a D2)** — 손기록 형식 검증 패턴. `isValidIsoInstant`를
  **재사용**한다(R3, ISO_RE+달력).
- **`gateRunCandidate`(`req-next.ts`, A-2a G3)** — escalated → AWAIT_HUMAN. **terminal도 여기서 안내**한다.
- **`req-new.ts`(`buildInitialState`·`main`)** — 신규 티켓 스캐폴드. `loadState`를 안 쓴다. `--successor-of`는
  부모 state를 **읽어야** 하므로 부모 로드를 추가한다.
- **`user_commit_confirmed`·`review_exception_confirmed`** — 사람 손기록 패턴. `human_resolution`도 같은 계열.

## 핵심 설계 결정

### D1. `closed_reason` 확장 + `human_resolution` 손기록 (R1·R2·R3)

`SeriesRecord`:

```ts
export interface SeriesRecord {
  series_id: string
  review_kind: ReviewKind
  phase_id: string | null
  attempts: number
  closed_reason: 'approved' | 'human-resolution' | null   // ← 'human-resolution' 추가
  human_resolution?: HumanResolution                       // closed_reason='human-resolution'일 때만
}

export interface HumanResolution {
  decision: 'terminate' | 'replace'   // accept-risk 없음(R11, 배분표 ④)
  method: string                       // 받은 승인 문장 그대로
  decided_at: string                   // 실제 시계(REQ-019)
  note?: string
}
```

**`closeSeriesHumanResolution(state, kind, phaseId, resolution)`(순수)**: 같은 `(kind,phase_id)`의 **열린**
레코드를 `closed_reason='human-resolution'` + `human_resolution=resolution`으로 닫는다. 열린 게 없으면
throw(사람이 escalate된 열린 series를 종결하는 것이므로 열려 있어야 한다).

**`isValidHumanResolution(r)`(순수)**(R3, 배분표 ⑪): `decision ∈ {'terminate','replace'}` + 비어있지 않은
`method` + `isValidIsoInstant(decided_at)`(A-2a 재사용). 하나라도 어긋나면 false. **손기록은 사람이 승인
문장을 주면 state에 기록**한다(예외 손기록과 같은 운영 — Claude가 `decided_at`에 실제 시계를 넣는다).

### D2. human-resolution 뒤 terminal 가드 (R4, 배분표 ③)

**`isSeriesKeyTerminal(state, kind, phaseId): boolean`(순수)**: `(kind,phase_id)`에 `closed_reason=
'human-resolution'` 레코드가 **하나라도 있으면** true.

**`approved`와 재개방 규칙이 정반대다**:
- `approved`로 닫힘 = **문제 해결됨** → 설계가 또 바뀌면 새 series(새 예산) 정당(A-1 유지).
- `human-resolution`으로 닫힘 = **문제 미해결·사람 개입** → 같은 키에서 계속하면 그 개입을 무효화한다.
  새 series를 **자동으로 열지 않는다**.

**가드는 두 곳**(A-2a legacy·escalated와 같은 이중 구조):
- **`withAttemptRecorded`(강제)**: 예산 게이트 **앞**에서 `isSeriesKeyTerminal`이면 throw
  ("이 series는 human-resolution으로 종결됐다 — 대체 REQ는 `req:new --successor-of`로 만든다").
- **`req:next`(안내)**: `gateRunCandidate`에서 terminal이면 AWAIT_HUMAN(종결됨 — 대체 REQ 안내).
  우선순위: G1 → **terminal** → G3(escalated) → G2. terminal이 G3보다 앞 — 종결된 series는 예산 안내가
  아니라 "이미 끝났다" 안내가 맞다.

**`recordAttempt`는 안 바꾼다**(R10). terminal 키는 애초에 `withAttemptRecorded`가 recordAttempt를 부르기
전에 막으므로, recordAttempt까지 도달하지 않는다. recordAttempt에 가드를 넣으면 순수 계수 함수가 정책을
알게 되어 A-1 계약이 흐려진다.

### D3. `--successor-of` — 부모를 읽어 lineage를 채운다 (R5·R6·R7·R8)

`req:new`에 `--successor-of <REQ-id>` 옵션. **자동 생성 없음**(사람이 명시).

**`resolveSuccessorLineage(parentState, parentReqId): SuccessorOf`(순수, fail-closed)**:
1. 부모 state에서 `closed_reason='human-resolution'` **이고** `human_resolution.decision='replace'` **이고**
   `isValidHumanResolution` 통과하는 series를 찾는다.
2. 없으면 **throw**("부모에 대체(replace)를 허용한 유효한 사람 결정 기록이 없다").
3. 있으면 `SuccessorOf`를 부모에서 **읽어** 만든다:

```ts
export interface SuccessorOf {
  req_id: string                              // 부모 REQ id
  parent_attempts_total: number               // 부모 모든 series attempts 합
  parent_replace_resolution: HumanResolution  // 그 series의 human_resolution 그대로
  recorded_at: string                          // 실제 시계
}
```

**모든 값이 부모에서 온다**(R7) — CLI로 안 받는다(전사 오류·날조 통로 차단).

`req-new.main`: `--successor-of`면
1. 부모 티켓 dir 해소 → `loadState`(없으면/읽기 실패면 throw, R6).
2. `resolveSuccessorLineage`(replace 기록 없으면 throw).
3. `buildInitialState`에 `successor_of`를 넣어 스캐폴드(R8: 빈 review_series·새 예산 — `successor_of`만 추가).

**대체 REQ는 새 예산을 받는다**(사람 결정). 그러나 `successor_of`가 "N번째 재시작, 부모 N회, 누가 언제
무슨 문장으로 허용"을 보존한다. R8의 목적은 재시작을 막는 게 아니라 **숨기지 못하게** 하는 것.

**한계(R9, 정직)**: `--successor-of` 없이 새 REQ를 만들면 lineage 없이 새 예산. 도구는 대체 여부를 모른다
(사람만 안다) — 협조적 작업자 전제 안의 한계. 막는 것은 `--successor-of`를 붙였는데 부모에 기록이 없는 경우다.

## Phase별 구현

| phase | 범위 | 변경 파일 |
|---|---|---|
| `phase-1-human-resolution-terminal` | D1·D2 — `closed_reason` 확장·`HumanResolution`·`closeSeriesHumanResolution`·`isValidHumanResolution`·`isSeriesKeyTerminal`·terminal 가드(withAttemptRecorded+req:next) | `review-codex.ts`·`req-next.ts`·테스트 |
| `phase-2-successor-of` | D3 — `--successor-of`·`resolveSuccessorLineage`·`SuccessorOf`·부모 읽기 | `req-new.ts`·`review-codex.ts`(타입)·테스트 |

phase 순서 근거: terminal(phase-1)이 먼저 있어야 "종결"이 의미를 갖고, `--successor-of`(phase-2)가 그
종결(replace)을 읽는다. 각 phase 병합 지점이 안전 — phase-1만 병합돼도 terminal 가드는 완결(대체 REQ
생성이 없을 뿐, 사람이 수동으로 만들 수 있다).

## 변경 파일

- `scripts/req/review-codex.ts` — `closed_reason` 확장·`HumanResolution`·`SuccessorOf` 타입·
  `closeSeriesHumanResolution`·`isValidHumanResolution`·`isSeriesKeyTerminal`·`resolveSuccessorLineage`·
  `withAttemptRecorded` terminal 가드(p1) · `buildInitialState` successor_of(p2)
- `scripts/req/req-next.ts` — `gateRunCandidate` terminal 안내(p1)
- `scripts/req/req-new.ts` — `--successor-of` 파싱·부모 로드·lineage(p2)
- `tests/unit/req-review-codex.test.ts` · `req-next.test.ts` · `req-new.test.ts` — 오라클

## 하위호환·안전

- **A-1 계수·A-2a 게이트 무변경**(R10): `recordAttempt`·`checkReviewBudget`·`consumeReviewException`·G3
  판정 로직 그대로. terminal 가드는 **추가**(withAttemptRecorded 앞·gateRunCandidate 앞)이며 기존 판정을
  느슨하게 하지 않는다. `closed_reason` 타입 확장은 기존 `'approved'|null` 값을 그대로 받는다.
- **`recordAttempt` 무변경**: 순수 계수 함수는 정책(terminal)을 모른다 — 가드가 그 앞에서 막는다.
- **G1·G2·승인 바인딩·`machine.schema.json` 무변경.** 이 REQ는 state 필드·`req:new` 옵션·도구 동작만 바꾼다.
- **기존 티켓 무영향**: `human_resolution` 없는 기존 series는 terminal이 아니다(`approved`·null 그대로).
  `--successor-of` 없는 `req:new`는 종전과 동일.
- **"terminal은 자동으로 안 열 뿐"** — 단일 활성 worktree 전제 안의 협조적 계약이다. `state.json`을 손으로
  고치면 우회된다. 명시된 경계이지 결함이 아니다.
- 이 REQ는 **additive**다. 완료 시 로그 측정 REQ(⑫⑬⑭)를 기다리지 않고 단독 병합한다. lineage만으로
  "예산 세탁 방지"가 완결된다.
