# REQ-2026-005 요구사항 — 비차단 코멘트 채널(observations)

## 무엇을
Codex 리뷰가 **승인하면서도 비차단(P3급) 코멘트**를 남길 수 있는 공식 채널 `observations`를 추가한다. `findings`는 blocking 전용으로 유지한다.

## 왜
REQ-2026-004 R10에서 `commit_approved=yes + findings 있음`을 모순(invalid)으로 막았다. 이는 안전하지만, 비차단 코멘트를 담을 채널이 없어 "승인 + 사소한 코멘트"가 exit 1 churn이 될 수 있다. main 병합 전 이 완성 계약이 필요하다.

## 제약 (PM 고정 정책)
- `observations`는 **optional additive field**. `findings`는 blocking 전용.
- `observations` 항목에는 **`severity`를 넣지 않는다**(있으면 blocking/non-blocking 경계가 흐려짐). 최소 형태 `detail`, `file`.
- schema는 `machine_schema_version: "1.1"` 유지(기존 archived response와 충돌 없이).

## 정책 매트릭스 (완료 기준)
- `commit_approved=yes` + `findings=[]` + `observations`(유무 무관) → **approved** (exit 0)
- `commit_approved=yes` + `findings` nonempty → **invalid** (exit 1)
- `commit_approved=no` + `findings` nonempty → **needs-fix** (exit 3)
- `commit_approved=no` + `findings=[]` + `observations`만 있음 → **blocked** (exit 2)

## 완료 기준
- 위 매트릭스가 코드로 강제됨(단위 테스트로 고정).
- 기존 observations 없는 1.1 응답 하위호환(struct 유효).
- `observations`가 승인 시 사용자에게 표출됨.
- vitest·`tsc --noEmit`·`req:doctor` green + design/phase 승인.
