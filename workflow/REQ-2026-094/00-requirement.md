# REQ-2026-094 요구사항

승인 행 증인 — doctor 진단과 정직한 복원 경로

## 배경

소비자 버그 리포트(0.15.0)의 **결함 3(복구)** 과 **결함 4(가시성)** 다. 앞선 두 REQ가 각각
**예방**(092: 커밋 불가 승인을 리뷰 전에 차단)과 **탈출구**(093: `req:close --abandon`)를 넣었다.
남은 것은 "승인은 실제로 있었는데 매니페스트 행이 비어 버린" 티켓을 **진단**하고, 가능하면 **복원**하는 것이다.

리포트의 제안은 세 증인(`responses/<phase>-rNN-approved.json` · `state.consumed_approvals[]` ·
`consumed_by_commit_sha`가 HEAD 조상)이 일치하면 승인 행을 복원하자는 것이었다.
**실측해 보니 그 조합만으로는 정직한 복원이 불가능하다**(§2). 요구를 그에 맞게 정정한다.

## 1. 지금 무슨 일이 일어나는가

`lib/intake.ts`에서 **증거의 유일한 출처는 HEAD의 `responses/approvals.jsonl`** 이다. 그 행이 없으면
그 phase는 `evidencedPhaseIds`에 들어가지 않고, 하류 전부가 거부한다.

| 명령 | 결과 |
|---|---|
| `req:commit --finalize` | pending 마커 없음 + HEAD가 승인 source 아님 → invalid |
| `req:reconstruct` | 복원 범위가 **close-proof 한정** — `approvals.jsonl`은 대상 밖 |
| `req:rebind` | `phase 승인 행이 없습니다` (행 존재를 전제) |
| `req:close --migrate` | `missingPlanned` — 부분 완료 티켓 거부 |

그리고 **`req:doctor`는 PASS를 낸다.** D26은 매니페스트에 **행이 있는 phase만** 결속을 보고, `state.phases`
(계획)나 `state.consumed_approvals`(소비 기록)와의 **완전성 대조를 하지 않는다.** 진단이 건강하다고
말하는 티켓이 실제로는 종결 불가다.

## 2. 🔴 실측 — 리포트의 3증인으로는 행을 복원할 수 없다

이 저장소의 REQ-2026-092 실제 커밋 데이터로 매니페스트 행의 각 필드가 HEAD 증거로 결정되는지 확인했다.

| 매니페스트 필드 | HEAD 증거 | 결정 가능? |
|---|---|---|
| `kind`·`phase_id` | `consumed_approvals[].phase_id` | ✅ |
| `response_path`·`response_sha256` | 커밋된 아카이브 파일(있다면) | ✅ (phase당 `-approved` 아카이브는 1개) |
| `review_base_sha` | 아카이브 JSON 안 | ✅ |
| `approved_tree` | `consumed_approvals[].approved_tree` | ✅ |
| `consumed_by_commit_sha` | `consumed_approvals[].consumed_by_commit_sha` | ✅ |
| **`approved_at`** | **어디에도 없다** — `approval_evidence`에 있었고 소비 시 제거된다 | 🔴 |
| **`consumed_at`** | `approval_consumed_at`과 **다른 스탬프**다 | 🔴 |
| `user_commit_confirmed` | 소비와 함께 초기화 | 🔴 |
| `phase_design_ref` | 소비 기록에 없음 | 🔴 |

`consumed_at`이 다르다는 것은 **실제 값으로 확인**했다 — 같은 phase에서
매니페스트 `consumed_at=…41.497Z` vs `approval_consumed_at=…41.660Z`.

즉 리포트의 3증인으로 행을 만들면 **`approved_at`을 지어내야 한다.** 그것은 REQ-2026-019가 폐기된
바로 그 표면이고, `lib/reconstruct.ts`가 "HEAD-committed immutable evidence가 행의 **모든** 필드를
명확·모호없이 결정할 때만" 복원한다고 못 박은 원칙에 정면으로 어긋난다.

### 2.1 그렇다면 정직한 1차 증인은 무엇인가

`state.json`의 **`approval_evidence`** 다. 승인 시점에 기록되고 `response_path`·`response_sha256`·
`review_base_sha`·`approved_tree`·`phase_design_ref`·`approved_at`을 **그대로** 담는다
(= 매니페스트 승인 절반과 같은 값). 정상 경로에서는 소비 시 제거되지만, **교착 티켓에서는 소비가 일어나지
않았으므로 워킹 `state.json`에 남아 있고**, 사용자가 그것을 커밋했다면 HEAD에 있다.

그러나 **`consumed_at`은 여전히 없다** — 소비가 일어난 적이 없으니 당연하다. 이것이 이 REQ의 핵심 제약이다.

## 3. 요구사항

- **R1 (진단·필수)** `req:doctor`가 "승인 흔적은 있는데 매니페스트 행이 없는 phase"를 **본다**.
  판정은 HEAD 증거로만 하고, 무엇이 어긋났는지와 **다음에 할 수 있는 일**을 함께 말한다.
  🔴 리포트가 제안한 `close-migrate`의 `missingPlanned` 술어를 그대로 쓰지 **않는다** — 진행 중인
  정상 티켓은 미래 phase에 증거가 없는 것이 당연해 전부 오탐이 된다. 신호는 **증인 불일치**다.
- **R2 (복원·조건부)** 모든 필수 필드가 HEAD 증거로 **결정될 때만** 승인 행을 복원한다.
  하나라도 결정되지 않으면 **거부하고 무엇이 없는지 말한다.** 값을 추정·근사·합성하지 않는다.
- **R3 (복원본 표시·필수)** 복원된 행은 원본과 **구별 가능**해야 한다. 현재 매니페스트 어휘에는
  `reconstructed` 표시가 없어 복원본이 원본으로 위장된다 — 그 표시를 추가한다.
  (`close-proof`는 이미 `reconstructed`+`evidence_basis`로 이 구별을 한다. 같은 원칙을 매니페스트에도.)
- **R4 (막다른 길 없음)** 복원이 불가능한 티켓에도 **다음 행동이 있어야 한다.** 최소한
  `req:close --abandon`(REQ-2026-093에서 배포됨)을 안내한다.
- **R5 (무회귀)** 기존 매니페스트 행·검증·게이트 동작은 바뀌지 않는다. 새 표시는 **선택 필드**이고
  그 키가 없는 기존 커밋 행은 계속 유효하다(REQ-2026-093 DEC-3a와 같은 함정을 피한다).
- **R6 (게이트 무력화 금지)** 복원 명령이 **승인을 만들어 내는 통로가 되면 안 된다.** 복원은 이미
  존재했던 승인의 **기록을 옮겨 적는 것**이지 새 승인을 부여하는 것이 아니다.

## 4. 범위 밖

- `req:confirm`이 `state.json`을 인덱스에 넣어 자기 승인을 D9 stale로 만드는 순환(REQ-2026-092에서 실측).
- `human-resolution` 기계장치 미배선(REQ-2026-093에서 발견 — CLI가 0개).
- 승인 시점 tree 보존(리포트 결함 2) — 092가 배포된 뒤 재평가.

## 5. 완료 기준

- 증인 불일치가 있는 티켓에서 `req:doctor`가 **그것을 말한다**(현재는 PASS).
- 정상 진행 중 티켓에서는 **아무 말도 하지 않는다**(오탐 0 — 대조군 테스트).
- 증인이 완비된 티켓에서 복원이 성공하고, 복원 행이 `reconstructed`로 표시되며, 그 뒤 티켓이 정상
  경로(`req:rebind`·완료)로 진행 가능하다.
- 증인이 하나라도 없으면 복원이 **거부**되고 `--abandon` 경로를 안내한다.
