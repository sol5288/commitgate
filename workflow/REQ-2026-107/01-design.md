# REQ-2026-107 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

| # | 위치 | 현재 |
|---|---|---|
| 1 | `req-doctor.ts:240` `phaseGranularityWarnings(codeFiles, maxFiles, gate)` | 임계를 **하나만** 받는다. 선언(`phases[].max_files`)을 알 방법이 없다 |
| 2 | `req-doctor.ts:537-544` D18 호출부 | `maxFiles = inp.granularityMaxFiles ?? GRANULARITY_MAX_FILES`, 파일은 D13이 만든 `codeChanges`(staged+unstaged+untracked) |
| 3 | `review-codex.ts:1322` `judgePhaseArea(count, declared, configMax)` | **정본**. `declared ?? configMax`로 임계를 정하고 `source: 'declared'|'config'`를 함께 낸다 |
| 4 | `review-codex.ts:1303` `declaredPhaseMaxFiles(state, phaseId)` | 선언 파서(1 이상 정수만 인정, 그 외 fail-closed) |
| 5 | `review-codex.ts:1280` `phaseCodeFiles(stagedPaths, ticketRel)` | staged에서 티켓 경로를 뺀 코드 파일 |
| 6 | `DoctorInputs` | `state: WorkflowState`(`:87`)와 `granularityMaxFiles`(`:93`)는 있으나 **staged 경로 목록이 없다** |

## 핵심 설계 결정

### DEC-1 판정은 `judgePhaseArea`로 **일원화**한다. 문구는 표면별로 유지한다

D18은 `judgePhaseArea`를 호출해 `over`/`limit`/`source`를 얻고, **메시지만** 자기 것을 만든다.

- 왜 판정만 공유하나: 두 표면은 사용자가 **할 수 있는 조치가 다르다**. 리뷰 직전이면 "staging을 줄여라"가 싸고, 커밋 직전이면 이미 늦어서 "다음 phase에서 줄여라"가 맞다. 문구까지 공유하면 한쪽에 거짓 안내가 된다 — REQ-2026-086 r01 P1과 REQ-2026-098이 각각 같은 교훈을 남겼다.
- 🔴 **`judgePhaseArea`를 doctor로 복사하지 않는다.** 이 REQ가 고치는 결함이 정확히 "정책 SSOT가 옮겨갔는데 사본이 남은 것"이다. 사본을 하나 더 만들면 같은 결함을 재생산한다.

### DEC-2 임계 결정에 필요한 입력을 `DoctorInputs`에 **명시적으로** 넣는다

`declaredMaxFiles: number | null`을 추가하고 `main()`이 `declaredPhaseMaxFiles(inp.state, currentPhaseId)`로 채운다.

- 왜 `runChecks` 안에서 계산하지 않나: `runChecks`는 순수 함수이고 그 순수성이 테스트 가능성의 근거다. 선언 파싱은 이미 순수하므로 어디서 불러도 되지만, **입력을 명시하면 테스트가 그 축을 직접 조작할 수 있다** — "선언 있음/없음"이 이 REQ의 핵심 축이다.
- phase id는 `state.current_phase`를 쓴다. `null`이면 선언도 `null`(= config 기본) — 기존 동작.

### DEC-3 대상 파일도 staged로 맞춘다 — `stagedCodeFiles`를 입력으로

`DoctorInputs`에 `stagedCodeFiles: string[]`을 추가하고 `main()`이 `phaseCodeFiles(staged, ticketRel)`(정본)로 채운다. D18은 `codeChanges`(D13용) 대신 이것을 센다.

⚠️ **실효 차이는 작다**(요구 3에 적었다): D10이 통과하는 실행에서 두 집합은 사실상 같다. 그럼에도 맞추는 것은 **"두 표면이 증명 가능하게 같은 것을 센다"**를 만들기 위해서다. 정의가 갈려 있으면 다음 사람이 또 한쪽만 고친다 — 그것이 이 REQ가 존재하는 이유다.

🔴 **D13은 계속 `codeChanges`를 쓴다.** D13의 질문은 "설계 승인 없이 코드가 바뀌었나"이고 거기엔 unstaged/untracked도 포함되어야 한다. **두 검사는 다른 질문을 하므로 다른 지표가 맞다** — 지금까지 지표를 공유한 것이 오히려 사고였다(D18이 D13의 계산을 빌려 썼다).

### DEC-4 메시지에 **임계의 출처**를 드러낸다

`judgePhaseArea`가 주는 `source`를 문구에 반영한다: 선언이면 "선언한 상한 N", config면 "권고 N". 사용자가 자기 선언이 인정됐는지 출력에서 바로 확인할 수 있어야 한다 — 그게 이 오탐의 재발을 사람이 알아채는 경로다.

## Phase별 구현

단일 phase. 판정·입력·메시지가 한 덩어리라 나누면 중간 상태가 커밋된다.

| phase | 내용 |
|---|---|
| `phase-1-d18-parity` | DEC-1~4 + 회귀 테스트 + CHANGELOG |

## 변경 파일

- `scripts/req/req-doctor.ts` (DEC-1~4)
- `tests/unit/req-doctor.test.ts` (회귀)
- `CHANGELOG.md`

## 하위호환·안전

| 축 | 영향 |
|---|---|
| **선언이 없는 티켓** | **판정 불변**(`declared=null` → `configMax`, 지금과 같다). 기존 소비자 대부분이 여기 |
| **선언이 있는 티켓** | WARN → OK. **오탐이 사라지는 방향** — 새로 막히는 것은 없다(D18은 WARN이라 애초에 막지 않는다) |
| D18 심각도 | **WARN 유지**. FAIL로 올리지 않는다(`req:commit`이 doctor를 하드 게이트로 spawn하므로 교착이 된다 — `req-doctor.ts:234-238`이 이미 경고) |
| D13 | **미변경**(DEC-3 — 다른 질문, 다른 지표) |
| 다른 D-체크 | 미접촉. `D_CHECK_IDS`·정본 표 변경 없음(id 추가·제거 없음) |
| state·아카이브·프롬프트 | 미접촉 |
