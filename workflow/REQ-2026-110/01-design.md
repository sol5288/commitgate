# REQ-2026-110 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

| # | 위치 | 현재 |
|---|---|---|
| 1 | `req-commit.ts:114` `userConfirmGate(state, stopGate, completesReq)` | HIGH 확인 차단의 **정본**. 사유 문자열에 조치 명령(`req:confirm … --scope …`)까지 포함 |
| 2 | `req-commit.ts:541` `wouldCompleteReq({phaseIds, manifestContent, pending})` | `stopGate:'req'`에서 "이 커밋이 REQ를 완성시키는가" 판정 |
| 3 | `req-doctor.ts` `D_CHECK_IDS`(`:70-73`) | 21개. D28 미등재 |
| 4 | `req-doctor.ts:1198` | 이미 `createEvidencePorts(...).headText(approvals.jsonl)`로 **매니페스트를 읽는다** — `wouldCompleteReq`의 입력이 이미 있다 |
| 5 | `DoctorInputs` | `state`는 있으나 `stopGate`가 없다 |

## 핵심 설계 결정

### DEC-1 D28은 `userConfirmGate`를 **호출**한다 — 조건을 다시 쓰지 않는다

REQ-2026-107이 고친 결함이 정확히 "정책 SSOT가 옮겨갔는데 사본이 남아 갈라진 것"이었다. 같은 실패를 새로 만들지 않는다.

- `req-doctor.ts`가 `./req-commit`에서 `userConfirmGate`·`wouldCompleteReq`를 import한다. doctor는 이미 `./review-codex`(다른 CLI 모듈)에서 import하므로 구조상 새로운 방향이 아니다.
- ⚠️ **순환 주의**: `req-commit.ts`가 `req-doctor.ts`를 import하는가? `runDoctor`는 **자식 프로세스 spawn**이지 import가 아니다(`req-commit.ts:437-442`). 따라서 정적 순환은 생기지 않는다 — 구현 시 typecheck로 확인한다.

### DEC-2 판정에 필요한 입력을 `DoctorInputs`에 명시적으로 넣는다

`highConfirm?: { blocked: boolean; reason?: string }` **하나**를 넣고 `main()`이 `userConfirmGate(...)` 결과를 그대로 채운다.

- **왜 `stopGate`·`completesReq`를 각각 넣지 않나**: 그렇게 하면 `runChecks`(순수 함수) 안에서 게이트를 재조립해야 하고, 그 조립이 곧 사본이다. **판정 결과를 넣으면 `runChecks`는 표시만 한다** — 정본과 갈라질 표면이 아예 없다.
- `undefined`면 D28은 **OK("판정 불요")**. 이 입력을 주지 않는 기존 호출부(테스트 포함)는 무회귀다.

### DEC-3 사유 문자열을 **재작성하지 않는다**

`userConfirmGate`가 낸 `reason`을 그대로 메시지에 싣는다. 두 표면이 다른 문구를 내면 "어느 쪽이 맞나"를 사람이 판단해야 하고, 그 순간 진단은 시간을 아껴주는 대신 쓴다.

### DEC-4 **WARN 상한** — 그리고 그 이유를 코드에 적는다

D19~D27과 같은 근거이며, 여기엔 하나가 더 있다: **이 검사가 FAIL이면 같은 조건을 두 곳에서 막는다.** doctor의 판정이 커밋 게이트와 조금이라도 어긋나는 순간(예: `completesReq` 계산 입력 차이) 커밋이 **doctor 때문에** 막힌다 — 진단이 게이트가 되면 진단의 오차가 차단이 된다.

### DEC-5 `D_CHECK_IDS`와 정본 표를 **같은 커밋에서** 갱신한다

`docs-stale-claims.test.ts`가 두 집합의 동일성을 양방향 검사한다(REQ-2026-099). 또한 "죽은 항목 탐지" 검사가 **모든 id가 최소 한 변형에서 발화**할 것을 요구하므로, D28이 WARN을 내는 입력 변형을 그 테스트에 추가해야 한다.

## Phase별 구현

| phase | 내용 | 파일 |
|---|---|---|
| `phase-1-d28-high-confirm` | DEC-1~5 + 회귀 + CHANGELOG | 5 |

## 변경 파일

- `scripts/req/req-doctor.ts`(D28·입력·main 배선) · `docs/ssot-design/07-business-rules-and-state-machines.md`(§3 표) · `tests/unit/req-doctor.test.ts` · `tests/unit/docs-stale-claims.test.ts`(발화 변형) · `CHANGELOG.md`

## 하위호환·안전

| 축 | 영향 |
|---|---|
| LOW 티켓 | **불변**(D28 OK) |
| HIGH + 유효 확인 | **불변**(D28 OK) |
| HIGH + 확인 없음 | doctor 출력에 **WARN 1줄 추가**. exit code는 **불변**(FAIL 아님) — 지금도 커밋은 막혔고, 이제 이유를 미리 안다 |
| `req:commit` 동작 | **미접촉**(차단은 그대로 `userConfirmGate`가 한다) |
| 기존 `runChecks` 호출부 | `highConfirm` 미지정 → OK. 무회귀 |
| state·아카이브·프롬프트 | 미접촉 |
