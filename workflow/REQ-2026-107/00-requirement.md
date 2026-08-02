# REQ-2026-107 요구사항

D18 오탐 제거 — 리뷰 게이트와 판정 공유

## 배경

2026-08-02 자체 감사의 B트랙(소비자 관측이 있는 항목) 첫 REQ. A트랙(REQ-103~106)은 소비자 관측 변화 0인 항목만 다뤘고, 이 REQ부터는 **doctor 출력이 바뀐다.**

### 실측된 결함

`req:doctor` D18(granularity 권고)이 **같은 정책을 리뷰 게이트와 다르게 판정한다.**

| 축 | `req:review-codex` preflight (정본) | `req:doctor` D18 |
|---|---|---|
| 임계 | `judgePhaseArea(count, declaredPhaseMaxFiles(state, phaseId), cfg.granularityMaxFiles)` — **`phases[].max_files` 선언 우선** (`review-codex.ts:2671`) | `phaseGranularityWarnings(codeChanges, cfg.granularityMaxFiles, gate)` — **선언을 인자로 받지도 않는다** (`req-doctor.ts:540`) |
| 대상 파일 | `phaseCodeFiles(staged, ticketRel)` — **staged만** (`:2670`) | `codeChanges` — staged+unstaged+untracked에서 티켓 문서·scratch 제외 (`:523`) |

**결과**: 사용자가 REQ-2026-086이 만든 탈출구대로 `phases[].max_files: 20`을 선언해 리뷰 게이트를 정당하게 통과시켜도, **`req:doctor`는 계속 "8파일 초과" WARN을 낸다.** 도구가 스스로 준 탈출구를 스스로 인정하지 않는다.

소비자 실측(2026-08-02): `44_yammy_sales`·`45_MBTI_kiosk`에서 `max_files` 선언이 **5개 티켓**에 실재한다 — 오탐이 실제로 발화하고 있다.

### 왜 지금까지 안 보였나

REQ-2026-086이 granularity 게이트를 **커밋 직전(D18)에서 리뷰 직전(preflight)으로 옮기면서** 새 판정 함수(`judgePhaseArea`)와 선언 탈출구(`phases[].max_files`)를 만들었는데, **doctor 쪽 사본을 따라 고치지 않았다.** 정책 SSOT가 이동했는데 사본이 남은 전형적인 형태다.

## 요구

1. **D18이 `phases[].max_files` 선언을 존중한다.** 리뷰 게이트가 통과시킨 phase를 doctor가 경고하지 않는다.

2. **판정을 공유한다 — 사본을 하나 더 만들지 않는다.** D18은 `judgePhaseArea`(정본)를 호출한다. 두 표면이 다시 갈라질 수 있는 구조를 남기지 않는 것이 이 REQ의 실질이다. 문구는 각 표면이 자기 것을 유지한다(리뷰 직전과 커밋 직전은 사용자가 할 수 있는 조치가 다르다).

3. **대상 파일 정의를 맞춘다.** D18도 **staged 코드 파일**을 센다.
   - ⚠️ 실효 차이는 작다: D10(clean tree)이 통과하는 실행에서는 unstaged/untracked 비-scratch가 0이므로 두 집합이 사실상 같다. D10이 FAIL인 실행에서만 갈리는데 그때는 doctor 전체가 이미 FAIL이다. **그럼에도 맞추는 이유는 "두 표면이 증명 가능하게 같은 것을 센다"를 만들기 위해서다** — 정의가 다르면 다음 사람이 또 한쪽만 고친다.

## 비요구

- **D18 제거**: `judgePhaseArea`의 주석은 "커밋 직전 권고는 시정 비용이 비싸 무시된다 — 실제로 phase의 69%가 그렇게 초과했다"고 기록한다. 즉 D18은 행동을 거의 바꾸지 않는다. 그렇더라도 **제거하지 않는다** — 올바른 WARN은 해롭지 않고, D-체크 제거는 `D_CHECK_IDS`·정본 표·결번 정책까지 건드리는 더 큰 소비자 변화다. 오탐만 없앤다.
- **doctor 체크 병합(21→10)·D5 제거·HIGH 확인 진단 신설**: 감사가 제안한 다른 B트랙 항목. 각각 별도 REQ.

## 완료 기준

- `phases[].max_files`를 선언한 phase에서 D18이 **OK**를 내는 회귀 테스트(선언 없으면 여전히 WARN).
- D18과 리뷰 preflight가 **같은 함수**로 판정한다.
- 소비자 영향: **오탐이 사라지는 방향의 변화만**. 선언이 없는 기존 티켓의 판정은 불변.
