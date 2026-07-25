# REQ-2026-054 리뷰 요청 — 리뷰 호출 lifecycle 분류 + pre-dispatch 무차감 예산

## 배경

리뷰 attempt는 외부 호출 **전** 예산 차감·`attempt-opened` 커밋된다. 호출 실패 시 `attempt-closed`가 안 남고
(원장 unclosed로 뭉개짐), 예산은 **무조건 차감**된다(codex spawn조차 실패한 경우 포함). `review-ledger.lifecycle`
(B1이 forward-compat로 마련·`completed`만 씀)을 채워 실패를 분류하고, **명백한 pre-dispatch만 무차감**한다.

## 변경 요약

- **DEC-C1** 타입 분류: `ReviewCallError{dispatchPhase}`(adapters). `defaultCodexRunner`가 `safeSpawnSyncStatus`로
  spawn 실패(pre-dispatch) vs non-zero exit(dispatched) 구별. 문자열 sniffing 없음.
- **DEC-C2** lifecycle taxonomy: completed / pre_dispatch_failed(환불) / dispatched_unknown(차감) /
  dispatch_confirmed(차감). `classifyDispatchFailure(err,dispatchConfirmed)` 순수.
- **DEC-C3** 환불 = `SeriesRecord.refunded_attempts`(additive). `openSeriesAttempts`가 `attempts-refunded`.
  **attempts는 단조 증가 유지**(원장 자연키 충돌 회피 — 감소하면 재시도가 같은 키 만들어 conflict).
- **DEC-C4** mainImpl dispatch 구간 try/catch → 보상 attempt-closed + durable pathspec 커밋 + pre-dispatch 환불
  + 원본 오류 re-throw(fail-closed).

## 리뷰 포인트

1. **명백한 pre-dispatch만 환불(DEC-C2/C3)**: 타입된 `ReviewCallError('pre-dispatch')`에서만 환불하고, 일반
   오류·확인 전 dispatched는 `dispatched_unknown`으로 **차감**하는가? 환불이 과도하게(애매한 실패까지) 일어나지 않는가?
2. **자연키 충돌 회피(DEC-C3)**: `refunded_attempts`로 attempts를 단조 유지하는 설계가, attempts 감소가 유발할
   원장 `(series_id,attempt)` 재사용 충돌을 실제로 피하는가? `openSeriesAttempts`만 유효회차로 바꾸고 다른
   `.attempts` 소비처(recordAttempt·ledger 키·lineage 합)는 불변인 경계가 맞는가?
3. **보상 close의 durable 커밋(DEC-C4)**: 실패 시 원장 pathspec 커밋이 staged 리뷰 대상(reviewTree)·semantic
   identity를 건드리지 않는가? best-effort 커밋 실패가 원본 dispatch 오류를 가리지 않는가?
4. **fail-closed(DEC-C5)**: 4개 실패 lifecycle 전부 exit 비-0인가? catch 전 crash → unclosed → 차감 유지
   (환불 없음)가 보수적으로 맞는가? 소비된 사람 예외를 pre-dispatch 환불이 복원하지 않는(덜 엄격해지지 않는) 게 맞는가?
5. **하위호환**: `refunded_attempts` 부재 원장/state가 그대로 동작(openSeriesAttempts=attempts)하는가? lifecycle
   값 확장이 스키마 키를 안 건드리는가(forward-compat)?
