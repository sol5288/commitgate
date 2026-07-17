# REQ-2026-027 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

> **오라클 원칙(REQ-2026-025 교훈)**: 오라클은 "필드가 있다"가 아니라 **"지우면/뒤집으면 실패한다"** 로 쓴다.

> **phase 순서 = legacy guard 먼저** (design-r01 P1). 각 phase는 병합돼도 안전해야 한다 — legacy 보호(D1)가
> attempt 기록(D3)보다 **먼저** main에 있어야, phase-1만 병합된 중간 상태에서 legacy 티켓이 attempt를
> 기록당하지 않는다. D1은 레코드 유무가 아니라 생성 시 모델 버전으로 판정하므로 "계수 먼저" 의존성은 없다.

## Phase 1 — 모델 버전·legacy (`phase-1-model-version-and-legacy`)

범위: reviewer 주입 seam(테스트 인프라) + D1. `review_series_model_version: 1` 스캐폴드 ·
legacy 2경로(`resolveNext` 안내 + 호출 지점 강제, **외부 호출 0회**).

변경 파일: `scripts/req/req-new.ts` · `scripts/req/req-next.ts` · `scripts/req/review-codex.ts` ·
`tests/unit/req-new.test.ts` · `tests/unit/req-next.test.ts` · `tests/unit/req-review-codex.test.ts`

### Oracle

- **O1-1 새 ticket에 모델 버전**(R1): `req:new`가 만든 state에 `review_series_model_version: 1`이 있다.
  → 스캐폴드에서 빼면 실패.
- **O1-2 🔴 legacy는 `req:next`에서 `AWAIT_HUMAN`이다**(R2) — **026 지적 ⑧**: 모델 버전 없는 state +
  design 미승인 + 워킹트리 clean → `resolveNext`가 `RUN`이 **아니라** `AWAIT_HUMAN`. → 호출 지점 throw만
  구현하면 실패(사용자가 `RUN` 안내를 따라 실행한 뒤에야 죽는다).
- **O1-3 🔴 legacy는 외부 호출을 하기 전에 throw한다 — near-e2e**(R2) — **design-r02 P1 반영**:
  **가짜 reviewer를 `main()`에 주입**해 모델 버전 없는 state로 리뷰를 돌리면, ① **throw**하고 ② **reviewer의
  exec/resume 호출 카운터가 0**이며 ③ **state 파일이 한 바이트도 안 바뀐다**.
  → **호출을 먼저 하고 throw하는 구현은 여기서 실패한다**(카운터가 1). "throw + state 무변경"만 검사하면
  그 구현이 통과하므로, **호출 0회를 명시적으로 단언**한다. R2의 요점은 "legacy에 외부 리뷰가 안 일어나는 것".
- **O1-4 새 모델 ticket은 legacy가 아니다**(R1·R2): `review_series_model_version:1`이 있고 series 레코드가
  없는 state는 legacy가 **아니다** — `req:next`·호출 지점 모두 legacy 처리하지 않는다. → 레코드 유무로
  legacy를 판정하면 새 ticket을 오분류해 실패.
- **O1-5 기존 `resolveNext` 분기 무변경**(R12): `commit_allowed=true`면 legacy 여부와 무관하게 종전대로
  `AWAIT_HUMAN`(commit). 새 모델 정상 티켓의 design 미승인이면 종전대로 design RUN 후보. → legacy 분기가
  이들을 가로채면 실패.
- **O1-6 reviewer 주입은 프로덕션 동작을 안 바꾼다**(seam 안전성): `main(argv)`를 인자 없이 부르면 기본
  `createCodexReviewerAdapter()`를 쓴다. → 주입구가 기본 경로를 바꾸면 실패. (seam이 phase-1 산출물이므로 여기)

### 정직성 — 이 phase가 증명하지 않는 것

- **legacy 경로는 실질적으로 비어 있다** — 현재 기준선의 legacy REQ는 전부 완료·병합됐다. 오라클은 합성
  state로 경로를 검증하지 실제 legacy 티켓을 만들지 않는다(소급 수정 금지).
- **`state.phase`를 안 쓴다는 것**(R3)은 부재 증명이라 완전히 테스트 못 한다 — 리뷰어가 diff로 확인한다.

Exit: typecheck0 · 단위 그린 · Codex phase 리뷰 승인.

## Phase 2 — series 레코드·attempt 기록 (`phase-2-series-record-and-attempt`)

범위: D2·D3. `SeriesRecord` · series 해소 · `approved` 종료 · `withAttemptRecorded` · 반환 state handoff.
(reviewer 주입 seam은 **phase-1 산출물** — 여기서 사용만 한다.) **아무것도 막지 않는다** — 세기만 한다.

변경 파일: `scripts/req/review-codex.ts` · `tests/unit/req-review-codex.test.ts`

### Oracle

- **O2-1 🔴 design series는 hash가 달라도 유지된다**(R5) — **핵심 오라클**: 서로 다른 `designHash`로 attempt를
  3회 해소·기록 → **series 레코드 1개, `attempts===3`**. → hash를 series 키에 넣거나 hash 변경 시 새 series를
  여는 구현은 실패(= REQ-020 병리 재현).
- **O2-2 series 해소**(R4): 같은 `(kind, phase_id)`의 열린 레코드를 재사용하고, `phase_id`가 다르면 별도
  series다. → 키에서 `phase_id`를 빼면 실패.
- **O2-3 🔴 `approved`만 자동 종료**(R6): outcome이 `approved`면 `closed_reason='approved'`.
  **`needs-fix`·`blocked`·`invalid`에서는 `closed_reason===null` 유지**. → NEEDS_FIX에서 닫는 구현은
  다음 리뷰가 새 series(0회)를 열어 A-2 상한을 무의미하게 만든다.
- **O2-4 이력 보존·재개방**(R7): `approved`로 닫힌 뒤 재해소하면 새 레코드(seq 증가)가 열리고 **이전
  레코드는 배열에 남는다**. → 닫을 때 지우거나 덮어쓰는 구현은 실패.
- **O2-5 🔴 호출이 throw해도 attempt가 되돌아가지 않는다**(R8): `withAttemptRecorded`에 **던지는 `call`**을
  넣고, throw 전파에도 **디스크 state의 `attempts`가 증가한 채 남음**을 단언. → 기록을 호출 뒤로 옮기거나
  실패 시 롤백하는 구현은 실패.
- **O2-6 🔴 main() 배선: 반환 state가 후처리 base다 — 네 outcome 전부 near-e2e**(R8·R9) —
  **design-r01·r03 P1 반영**: 가짜 reviewer(phase-1 seam)를 `main()`에 주입해 실제 실행 경로를 태운 뒤,
  디스크 state의 `attempts`가 **증가한 채 남음**을 단언한다. **`approved`·`needs-fix`·`blocked`·`invalid`
  네 outcome 전부**에서.
  → **일부 outcome에만 `afterAttempt`를 쓰고 나머지에 pre-call `state`를 base로 최종 write하는 구현은
  여기서 실패한다**(그 outcome 뒤 attempt가 되돌아가 계수가 신뢰를 잃는다 — r03 P1). NEEDS_FIX·approved만
  검사하면 blocked/invalid 분기 회귀가 새므로, **네 경로 전부**를 단언한다. 단위 wrapper 테스트(O2-5)는
  이 회귀를 못 잡는다.
- **O2-7 🔴 고횟수 열린 series도 호출을 허용한다 — "세기만 한다" 계약**(R11) — **design-r02 P1 반영**:
  `attempts=9`인 **열린** series + 변경된 바인딩 state로 가짜 reviewer를 주입해 `main()`을 돌리면,
  reviewer가 **실제로 호출되고** `attempts`가 **10으로 보존**된다.
  → **`attempts>=N`이면 throw/return하는 예산 게이트를 잘못 넣은 구현은 여기서 실패한다.** 저횟수(O2-1의
   3회)만 검사하면 그런 구현이 통과하므로, **고횟수에서 거부 없음**을 명시적으로 단언한다. 예산은 A-2다.
- **O2-8 호출 전 `state.json` 쓰기가 post-call D10에 안 걸린다**(026 지적 ⑦ 근거 고정): 수정된 `state.json`
  status entry를 `findUnstagedOrUntracked(entries, reviewScratchPaths(ticketRel), ticketRel)`에 넣으면 **빈 배열**.
  ※ `state.json` 외 tracked 파일 수정은 **여전히 검출됨**을 함께 단언(허용이 넓어지지 않았음).
- **O2-9 `--fresh-thread`가 series를 안 건드린다**(R10): `blocked_review` 초기화 경로를 타도
  `review_series.attempts`가 그대로다. → series까지 초기화하는 구현은 실패.

### 정직성 — 이 phase가 증명하지 않는 것

- **아무것도 막지 않으므로** 예산·상한 관련 오라클은 없다 — 그건 A-2다. O2-7은 그 부재를 **고횟수에서
  거부하지 않음**으로 증명한다.
- **state.json 동시 쓰기 경합은 다루지 않는다**(R13). 단일 활성 worktree 전제다.

Exit: typecheck0 · 단위 그린 · Codex phase 리뷰 승인.

## in-flight 티켓 채택 (design-r02 observation)

**이 REQ-027 자신의 state.json에는 `review_series_model_version`이 없다.** phase-1이 legacy 호출-지점
throw를 도입하므로, **stamp 없이 이 티켓의 phase 리뷰를 돌리면 legacy로 throw돼 phase-1을 커밋조차 할 수
없다**(자기 자신이 자기 규칙에 걸린다 — design-r03 P1).

**운영 순서(이 순서를 지킨다)**:

1. phase-1 코드·테스트를 구현하고 `git add`.
2. **phase 리뷰 요청 전에**, 이 티켓 state.json에 `review_series_model_version: 1`을 **사람이 명시적으로**
   추가한다(state.json은 SCRATCH라 D10에 안 걸림). 이는 "legacy 일괄 이관"이 아니라 **이 활성 티켓 하나를
   새 모델로 채택**하는 1회성 명시 행위다 — R2의 무침습(자동 스캔·일괄 stamp 금지)과 정합한다.
3. 그 다음 `req:review-codex ... --kind phase --phase phase-1-... --run`. 이제 legacy가 아니므로 통과한다.

phase-1의 legacy 오라클은 이와 무관하게 **합성 state**로 검증한다(실제 티켓을 legacy로 만들지 않는다).
이 stamp는 phase-1 diff에 포함되지 않아도 된다 — 도구 동작이 아니라 이 티켓의 운영 채택이다.

## 완료
- 게이트 해당분(unit·typecheck) · 사용자 main 반영(별도 승인).
- 이 REQ는 additive다. **A-2를 기다리지 않고 단독 병합한다.**
- 이 repo에 lint 스크립트는 없다(게이트 = typecheck + vitest).
