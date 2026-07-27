# REQ-2026-070 요구사항 — phase 리뷰 전 대상 검증

## 배경 (이번 세션 실측)

REQ-2026-067에서 `--phase phase-1-select-core`로 리뷰를 돌렸다. 리뷰는 **APPROVED**로 끝났고
유료 호출 1회를 썼다. 그런데 `req:commit`에서 이렇게 실패했다:

```
Error: evidence preflight 실패(source 커밋 안 함):
  후보 manifest entry 검증 실패: line 2: phase_id 비유효: null
```

`state.json`의 `phases[]`를 채우지 않은 상태였다. `req:new`는 **모든 새 티켓을 `phases: []`로 초기화**하고,
`phases[]`는 티켓 저자가 손으로 채운다.

## 코드 확인

`resolvePhaseTarget`(review-codex.ts:1492)은 `phases[]`가 **빈 배열이면 레거시로 보고**
`phaseId: null`을 돌려준다 — 이때 `--phase`로 준 값은 **조용히 버려진다.**

그런데 커밋 경로는 `validPhaseIds = readPhases(state).map(p => p.id)`(review-codex.ts:2543)로 검증하고,
매니페스트 검증은 phase 행에 **비어 있지 않고 `validPhaseIds`에 있는** `phase_id`를 요구한다
(evidence.ts:396).

🔴 **그래서 `phases[]`가 빈 티켓에서 `--kind phase` 리뷰는 커밋 가능한 승인을 만들 수 없다.**
`--phase`를 줬든 안 줬든 결과는 같다 — 호출은 나가고 돈은 쓰이고, 승인은 쓸 수 없다.

## 요구사항

### R1 — 🔴 호출 **전에** 막는다
쓸 수 없는 승인을 만드는 리뷰는 **유료 호출이 나가기 전에** 거부돼야 한다.
지금은 실패가 커밋 시점까지 미뤄져 호출 1회가 버려진다.

### R2 — `--phase`를 조용히 버리지 않는다
사용자가 준 인자가 무시되면 안 된다. 바인딩되거나 **실패**하거나 둘 중 하나다.

### R3 — 메시지가 고칠 방법을 말한다
"`state.json`의 `phases[]`를 채우고 다시 실행하라"까지 알려 준다.
지금은 `phase_id 비유효: null`이라 원인을 역추적해야 한다.

## 제약

- 🔴 **진짜 레거시 티켓의 무회귀.** `phases[]` 추적 이전 티켓이 존재하고, 그 경로를 막으면 안 된다.
  구별 신호는 `req:new`가 새 티켓에 찍는 `review_series_model_version`이다(REQ-2026-027).
- `resolvePhaseTarget`의 기존 검증(`--phase`가 `phases[]`에 없으면 거부)은 그대로다.
- 예산·원장 기록 위치를 바꾸지 않는다 — 이 REQ는 **더 앞에서** 막는 것이다.

## 비목표

- `phases[]`를 도구가 자동으로 채우는 것(`02-plan.md`의 phase 분해는 사람이 한다).
- 레거시 티켓의 phase 리뷰 경로 개선.

## 수용 기준

1. 신규 모델 티켓 + `phases[]` 비어 있음 + `--kind phase` → **호출 전에** 거부.
2. 그 거부 메시지가 `phases[]`를 채우라고 말한다.
3. `--phase`를 줬는데 반영할 수 없으면 **거부**한다(조용히 버리지 않는다).
4. 🔴 레거시 티켓(`review_series_model_version` 부재)의 phase 리뷰는 **그대로 동작**한다.
5. `phases[]`가 채워진 정상 경로가 그대로 동작한다.
6. 거부 시 **원장 기록·예산 차감이 없다**(호출 전이므로).
