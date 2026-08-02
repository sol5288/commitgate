# REQ-2026-103 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

> **테스트 실행 계층(REQ-2026-100)**: 게이트는 테스트를 **실행하지 않는다**. 아래는 비용을 줄이기 위한 실행 시점 권고다.
> - **phase 진행 중**: 변경한 소스를 import하는 테스트만(빠른 피드백). 예: `grep -rl "<변경한 모듈>" tests/`
> - **통합(main 병합) 직전 1회**: **전체 스위트**. 범위 한정은 이것을 **대체하지 않는다** — 영향 분석은 놓친 회귀를 통과시킨다.

## Phase 1 — review-codex 죽은 배선 제거 (`phase-1-dead-review-wiring`)

범위(4파일 · **동작 무변경**):
- `scripts/req/review-codex.ts` — ① `isResume` 상수와 그것을 읽는 삼항 2곳(`:2773` 로그 문구, `:2792` `resumeThreadId` 전달) 제거 ② `callReviewer`의 `resumeThreadId` 인자 제거 ③ `withAttemptRecorded` 함수 + 그 JSDoc 제거(DEC-3) ④ DRY-RUN 출력의 `phase=${state.phase}` 제거(DEC-1 항목 8) ⑤ 고아 JSDoc 2덩어리를 `appendLedgerRowToDisk`·`precallCommitLedgerRow` 위로 이동(DEC-6)
- `scripts/req/lib/adapters.ts` — `ReviewInput.resumeThreadId` 제거, `createCodexReviewerAdapter`의 resume 인자 분기 제거(항상 `exec` 경로), `threadId`는 `parseThreadId(rawStdout)`만
- `tests/unit/req-adapters.test.ts` — 죽은 분기를 검증하던 `[R9] resume`·`[P1] resume` 2건 제거, 나머지 호출부의 `resumeThreadId: null` 인자 제거
- `tests/unit/req-review-codex.test.ts` — `withAttemptRecorded` 테스트 3곳을 `gateAndRecordAttempt` 대상으로 재작성(설계 DEC-3 표대로). **삭제 금지**

🔴 `state.codex_thread_id` **쓰기 경로는 건드리지 않는다**(DEC-1 — 소비자 state 95개가 이 필드를 갖고 있다).

Exit: typecheck 0 · `req-review-codex`/`req-adapters` 테스트 그린 · Codex phase 리뷰 승인.

## Phase 2 — 기타 모듈 데드심볼 (`phase-2-misc-dead-symbols`)

범위(4파일 · **동작 무변경**):
- `bin/quickstart.ts` — `QUICKSTART_MARKER_OPEN`/`_CLOSE` 제거(참조 0). 🔴 canonical Quick Start **블록 본문은 미접촉**(바꾸면 소비자 D21 drift WARN)
- `scripts/req/req-close.ts` — `committedPlannedPhaseIds` 별칭 제거, `:310`이 `plannedPhaseIdsFromState`를 직접 호출
- `scripts/req/lib/review-ledger.ts` — `unclosedAttempts` 제거(DEC-5)
- `tests/unit/review-ledger.test.ts` — `unclosedAttempts` 대상 테스트 제거(대상 함수가 사라지므로)

Exit: typecheck 0 · `review-ledger`/`req-close`/`quickstart` 테스트 그린 · Codex phase 리뷰 승인.

## Phase 3 — gitAdapter 복원 누락 수정 (`phase-3-gitadapter-restore`)

범위(2파일 · **이 REQ에서 동작이 바뀌는 유일한 phase**):
- `scripts/req/review-codex.ts` — `main()`의 기존 try/finally에 `gitAdapter` 저장·복원 추가(DEC-4, `reviewer`와 대칭)
- `tests/unit/req-review-codex.test.ts` — 회귀 테스트: 서로 다른 root로 `main()`을 2회 호출했을 때 두 번째 호출이 첫 번째의 `gitAdapter`를 물지 않는다

Exit: typecheck 0 · `req-review-codex` 테스트 그린 · Codex phase 리뷰 승인.

## Phase 4 — CHANGELOG (`phase-4-changelog`)

범위(1파일):
- `CHANGELOG.md` Unreleased에 REQ-2026-103 항목. **처음부터 "확인할 파일" 표를 포함한다**(REQ-2026-082 교훈: 막 phase의 CHANGELOG가 앞 phase를 설명하면 diff-scoped 리뷰가 근거 부족으로 반려한다 → 각 항목에 phase 커밋 SHA + 파일 경로를 표로 제시).
- DEC-2(resume 배선)·DEC-5(`unclosedAttempts`) **복원 지점 SHA**를 명시한다.

Exit: `npm run docs:lint` 통과 · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(typecheck·해당 시 lint) · **통합 직전 전체 스위트 1회** · 사용자 main 머지(별도 승인).
- 통합 후 소비자 영향 재확인: `codex_thread_id`를 가진 기존 state를 읽는 경로가 변하지 않았음을 전체 스위트로 확인.
