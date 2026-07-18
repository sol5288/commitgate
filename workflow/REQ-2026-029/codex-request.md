# REQ-2026-029 phase-2 리뷰 요청

## 배경

CommitGate 개선 **A-2b phase-2** — successor-of lineage. phase-1(human-resolution terminal)은 `6451826d`로
커밋됨. 이 phase는 배분표 ⑩ — 예산 세탁 방지의 lineage 절반. **A-2b의 마지막이자 A 계열 전체의 마지막.**

phase-1이 사람 종결을 부모에 기록하고 terminal로 만들었다. 이 phase는 `req:new --successor-of`가 그
**부모 replace 종결을 읽어** 대체 REQ의 lineage를 채운다 — 부모가 기록하지 않으면 자식이 태어나지 못한다.

## phase-2 r01 지적 반영 (P1 1건 + observation 2)

1. 🔴 **O2-4가 브랜치·디렉터리 미생성을 안 봤다**: `state.json` 부재만 확인해, `checkout -b`·`mkdir`를 먼저
   하고 throw하는 결함 구현도 통과(R6 위반 — 실패 경로에 브랜치·빈 디렉터리 잔존). → O2-4에 **브랜치
   미생성 + 티켓 디렉터리 미생성**을 실측 추가(`expectNoSideEffects`).

observation 2: (a) `resolveSuccessorLineage` 주석 "모든 값이 부모에서"를 recorded_at 예외와 정합하게 정정
(근거 3필드는 부모, recorded_at만 생성 시각). (b) `req-new.ts` 상단 사용법에 `--successor-of` 반영.

## 변경 요약 (phase-2-successor-of)

`review-codex.ts`(타입·순수) + `req-new.ts`(옵션·부모 읽기) + 테스트. D3.

- **`SuccessorOf`** {req_id, parent_attempts_total, parent_replace_resolution, recorded_at}.
  `WorkflowState.successor_of` 추가.
- **`resolveSuccessorLineage(parentState, parentReqId, recordedAt)`(순수, fail-closed)**: 부모에서
  `decision='replace'` + `isValidHumanResolution` 통과하는 series를 찾아 `SuccessorOf`를 **부모에서 읽어**
  만든다. 없으면 throw. `recorded_at`만 인자(자식 생성 시각 — design-r01 observation, provenance 분리).
- **`req:new --successor-of <REQ>`**: 부모 로드·lineage 해소를 **`checkout -b`·mkdir 前**에 둔다
  (design-r01 observation) — 실패면 티켓이 생성되지 않는다(R6). `buildInitialState`에 `successor_of` 전달
  (자식은 빈 review_series로 새 예산).

`recordAttempt`·A-2a 게이트·terminal 가드(phase-1)·G1·G2·승인 바인딩·`machine.schema.json` **무변경**.

게이트: typecheck 0, 단위 1127/1127 green.

## 리뷰 포인트

리뷰 포인트는 심사 범위의 하한이다.

1. **🔴 부모에 replace 기록 없으면 fail-closed**(배분표 ⑩·R6). `resolveSuccessorLineage`가 전부 approved·
   terminate·형식 위반 replace 각각 throw하는가? O2-1·O2-3이 이를 잡는가? 통합 O2-4가 **티켓 미생성**
   (디렉터리 안 생김)을 확인하는가?
2. **🔴 lineage가 부모에서 읽히는가**(배분표 ⑩·R7). `parent_attempts_total`(모든 series 합)·
   `parent_replace_resolution`이 CLI 아닌 부모 state에서 채워지는가(O2-2·O2-5)? 사람이 넘긴 값을 안 믿는가?
3. **🔴 검증이 branch 생성 前인가**(design-r01 observation). `--successor-of` 실패 시 `checkout -b`·mkdir가
   **일어나지 않아** 티켓이 안 생기는가? O2-4가 이를 실측하는가?
4. **recorded_at provenance**(design-r01 observation). `recorded_at`만 자식 생성 시각이고 나머지는 부모에서
   온다는 분리가 명확한가? "모든 값이 부모에서"가 아니라 정확히 표현됐는가?
5. **자식 새 예산·이력 보존**(R8). 자식 `review_series`가 빈 배열(새 예산)이고 `successor_of`가 부모 이력을
   보존하는가(O2-5)? 재시작을 막는 게 아니라 숨기지 못하게 하는 설계가 맞는가?
6. **한계·opt-in**(R9). `--successor-of` 없으면 종전대로(O2-6)? 도구가 대체 여부를 추정하지 않는가?
   막는 것(붙였는데 부모 기록 없음)과 못 막는 것(안 붙임)의 경계가 정직한가?
7. **A-1·A-2a·phase-1 무변경**(R10). recordAttempt·예산 게이트·terminal 가드에 영향 없는가?
8. **oracle**. O2-1~O2-6이 각 "→ 실패해야 하는 구현"을 실제로 실패시키는가? 통합 near-e2e가 우회 없이
   부모 검증과 티켓 미생성을 태우는가?
