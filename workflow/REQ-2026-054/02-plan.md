# REQ-2026-054 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

검증 명령(각 phase Exit): `pnpm run typecheck` · `npx vitest run <해당 테스트>` · (P2 후) `node scripts/smoke.mjs`.

## Phase 1 — 예산 유효회차·환불·타입 오류 (`phase-1-budget-refund-and-typed-error`)

범위: `scripts/req/lib/adapters.ts` + `scripts/req/review-codex.ts`(순수 함수·타입만) + 단위 테스트.

- `adapters.ts`: `ReviewCallError extends Error{ dispatchPhase:'pre-dispatch'|'dispatched' }`(export).
  `defaultCodexRunner`를 `safeSpawnSyncStatus` 기반으로 — `res.error`→pre-dispatch, `res.status!==0`→dispatched.
- `review-codex.ts`: `SeriesRecord.refunded_attempts?:number` 추가. `openSeriesAttempts` = `attempts -
  (refunded_attempts??0)`. `refundAttempt(state,kind,phase)` 순수. `classifyDispatchFailure(err,dispatchConfirmed)`
  순수. `callReviewer` thread-fail을 `ReviewCallError('dispatched')`로.

테스트 오라클(`tests/unit/review-budget-refund.test.ts`·`tests/unit/adapters.test.ts` 등):
- ① `refundAttempt`: 열린 series refunded_attempts +1(없던 필드 → 1). 닫힌/부재 series → no-op.
- ② `openSeriesAttempts`: attempts=3·refunded=1 → 2. refunded 부재 → attempts 그대로(하위호환).
- ③ 예산 게이트 통합: attempts=6·refunded=1 → 유효5 → allow(autoBudget=5 경계 확인). 환불 없으면 needs-exception.
- ④ `classifyDispatchFailure`: ReviewCallError('pre-dispatch') → pre_dispatch_failed. ('dispatched') 확인 전
  → dispatched_unknown. dispatchConfirmed=true → dispatch_confirmed. 일반 Error → dispatched_unknown(fail-closed).
- ⑤ `ReviewCallError`: dispatchPhase 보존·instanceof Error.
- ⑥ `defaultCodexRunner`(주입 runner로): spawn error(ENOENT 모사) → ReviewCallError('pre-dispatch'). exit!==0 →
  ('dispatched'). exit 0 → stdout 반환.
- ⑦ recordAttempt는 refunded_attempts 불변(환불은 refundAttempt만)·attempts 단조 증가(재시도 새 키).

## Phase 2 — mainImpl 배선 (`phase-2-dispatch-lifecycle-wiring`)

범위: `scripts/req/review-codex.ts` `mainImpl` dispatch 구간 try/catch + 보상 close·환불·pathspec 커밋 +
실 git near-e2e.

- `dispatchConfirmed` 플래그: callReviewer `onDispatchConfirmed` 콜백(thread_id 파싱 즉시·respPath 기록 前)에서
  true(r01 P1). dispatch 구간(callReviewer~outcome) try/catch.
- catch: classify → `attempt-closed(lifecycle,outcome:'invalid')` append → durable이면 원장 pathspec 커밋
  (best-effort) → pre_dispatch면 refundAttempt+writeState → **원본 오류 re-throw**.
- 정상 경로 `lifecycle:'completed'` 불변.

테스트 오라클(`tests/unit/review-lifecycle-wiring.test.ts` 실 git near-e2e, FakeReviewer로 실패 주입):
- ⑧ pre-dispatch(FakeReviewer가 ReviewCallError('pre-dispatch') throw) → 원장 opened+closed(pre_dispatch_failed)·
   유효 예산 환불(재시도가 같은 회차 예산 위치)·명령 exit 비-0·throw.
- ⑨ dispatched(exit!==0 모사) → closed(dispatched_unknown)·환불 없음(유효 예산 차감 유지)·throw.
- ⑩ dispatch_confirmed(thread_id 반환 후 사후 tamper) → closed(dispatch_confirmed)·차감 유지·throw.
- ⑩b (r01 P1) thread_id 파싱 성공 **후 respPath 기록 실패**(callReviewer 내부 I/O throw) → onDispatchConfirmed가
   이미 발화 → closed(**dispatch_confirmed**)·차감 유지(dispatched_unknown 아님).
- ⑪ 정상 approved → closed(completed)·기존 동작 불변(승인·evidence).
- ⑫ durable 티켓: 보상 closed가 HEAD에 커밋됨(다음 리뷰 D10 안 막힘). pre_dispatch 재시도 → opened #N+1(새 키·
   충돌 없음).
- ⑬ 보상 커밋이 staged 리뷰 대상(reviewTree)·semantic identity 불변(원장 responses/ 제외).

## 완료
- 게이트 해당분(unit·typecheck·smoke) · 사용자 main 머지(D·E와 함께 마지막 별도 승인).
