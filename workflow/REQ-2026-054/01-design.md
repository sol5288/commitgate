# REQ-2026-054 설계 — 리뷰 호출 lifecycle 분류 + pre-dispatch 무차감 예산

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

- `scripts/req/lib/adapters.ts` — `defaultCodexRunner`가 `safeSpawnSync('codex', …)`로 실행하고, spawn 실패와
  non-zero exit를 **같은 Error로 뭉친다**. `safeSpawnSyncStatus`(exit code 보존)는 이미 있다.
- `scripts/req/review-codex.ts`:
  - `SeriesRecord{ series_id, review_kind, phase_id, attempts, closed_reason, human_resolution? }`.
  - `openSeriesAttempts(state,kind,phase)` = 열린 series의 `attempts`(예산 게이트 입력).
  - `recordAttempt` = 열린 series `attempts +1`(없으면 새 series attempts=1). **외부 호출 전** 확정.
  - `callReviewer(rv, …)` = `rv.review()` 호출 + thread_id 없으면 throw + respPath 기록.
  - `mainImpl`(~2201~2353): gate+recordAttempt(2202) → 원장 `attempt-opened` append+pre-call commit(2214·2228) →
    binding 캡처(2231) → `callReviewer`(2249) → 사후 tamper 검증(2264) → processResponse/outcome(2288~2331) →
    원장 `attempt-closed(lifecycle:'completed')`(2338). **실패 시 callReviewer가 throw → 이후 전부 skip →
    attempt-closed 없음**.
  - `appendLedgerRowToDisk`(D5 전파/D6 삼킴), `precallCommitLedgerRow`(원장 pathspec 커밋).
- `scripts/req/lib/review-ledger.ts` — `LedgerRow.lifecycle: string|null`(forward-compat: 모르는 **값**은 거부
  안 함, 모르는 **키**만 거부). `attempt-closed`는 `outcome`·`lifecycle` 둘 다 non-null 필수(검증).

## 핵심 설계 결정

### DEC-C1 — 타입된 dispatch 분류 (문자열 추측 금지)

실패를 **타입**으로 구별한다 — 메시지 문자열 sniffing은 취약하다.

- `adapters.ts`에 `ReviewCallError extends Error { dispatchPhase: 'pre-dispatch' | 'dispatched' }`.
- `defaultCodexRunner`를 `safeSpawnSyncStatus`로 바꿔:
  - `res.error`(ENOENT 등 — subprocess **기동 실패**) → `ReviewCallError('pre-dispatch', …)`.
  - `res.status !== 0`(subprocess는 떴고 non-zero — 모델이 부분 실행됐을 수 있음) → `ReviewCallError('dispatched', …)`.
- `callReviewer`의 `thread_id 파싱 실패`(exit 0인데 stdout에 thread.started 없음 = 프로세스는 실행됨) →
  `ReviewCallError('dispatched', …)`.
- 🔴 **thread_id 확보 즉시 신호**(r01 P1): `callReviewer`에 `onDispatchConfirmed?:(threadId)=>void` 콜백을 두고,
  thread_id 파싱 성공 **직후·respPath 기록 前**에 호출한다. 그래야 thread_id 확보 **후** respPath I/O 실패도
  `dispatch_confirmed`로 분류된다(반환 후에만 true로 두면 이 경로가 `dispatched_unknown`로 오분류됨).
  ```
  callReviewer: rv.review() → threadId 파싱 → (없으면 throw 'dispatched') → onDispatchConfirmed(threadId) → writeFileSync(respPath) → return
  ```
- **주입된 runner/FakeReviewer**는 자유롭게 throw할 수 있다 — 타입 판정은 `err instanceof ReviewCallError`로만.

### DEC-C2 — lifecycle taxonomy (도달한 최원 단계)

원장 `attempt-closed.lifecycle` = 이 attempt가 **끝나기 전 도달한 가장 먼 단계**:

| lifecycle | 의미 | 예산 | outcome |
|---|---|---|---|
| `completed` | dispatched + 응답이 review outcome으로 분류됨(정상 경로) | 차감 | approved/needs-fix/blocked/invalid |
| `pre_dispatch_failed` | subprocess **미기동**(spawn 실패·`ReviewCallError('pre-dispatch')`) — 청구 불가 | **환불** | invalid |
| `dispatched_unknown` | 기동했으나 사용 가능한 결과 없음(non-zero exit·thread_id 없음, **확인 전** 실패) — 청구 가능성 | 차감 | invalid |
| `dispatch_confirmed` | thread_id 확보(모델 실행 확실) **후** 후처리/tamper 실패 — dispatched 확실 | 차감 | invalid |

- `classifyDispatchFailure(err, dispatchConfirmed): lifecycle`(순수):
  - `err instanceof ReviewCallError && phase==='pre-dispatch'` → `pre_dispatch_failed`.
  - `dispatchConfirmed`(thread_id 확보 후 실패) → `dispatch_confirmed`.
  - 그 외(타입 없는 일반 오류·확인 전 dispatched) → `dispatched_unknown`(**fail-closed 차감**).
- 🔴 **오직 타입된 pre-dispatch만 환불**. 애매/일반 오류는 `dispatched_unknown`으로 차감 — "명백한 pre-dispatch만 무차감".

### DEC-C3 — 예산 환불 = `refunded_attempts`(monotonic attempts 보존)

**자연키 충돌 회피가 핵심**: `attempts`를 되돌리면(감소) 재시도가 같은 `(series_id, attempt)`를 만들어 원장
자연키가 충돌(conflict)→영구 실패한다. 그래서 `attempts`는 **단조 증가 유지**하고, 별도 카운터로 환불한다.

- `SeriesRecord`에 **`refunded_attempts?: number`**(additive·기본 0) 추가.
- `openSeriesAttempts` = `attempts - (refunded_attempts ?? 0)`(예산 게이트가 보는 **유효 회차**).
- `refundAttempt(state,kind,phase)`(순수) = 열린 series의 `refunded_attempts +1`.
- 효과: opened #N(attempts=N) → pre_dispatch_failed → refunded=1 → 유효=N-1. 재시도 recordAttempt →
  attempts=N+1(**새 원장 키·충돌 없음**), 유효=(N+1)-1=N = 실패 전과 동일 예산 위치.
- 🔴 **소비된 사람 예외는 복원하지 않는다**(pre-dispatch가 예외 회차에서 나면 회차만 환불·예외는 사용됨으로 둠 —
  보수적, 절대 덜 엄격해지지 않음). `parent_attempts_total`(lineage)은 raw `attempts` 유지(역사적 수치).
- 🔴 raw `.attempts` 다른 소비처(recordAttempt 증가·ledger 자연키 `AttemptInfo.attempt`·lineage 합)는 **불변** —
  `openSeriesAttempts`(예산 입력)만 유효 회차로 바꾼다.

### DEC-C4 — 실패 시 보상 `attempt-closed` + durable 기록

`mainImpl`의 dispatch 구간(`callReviewer`~outcome 확정)을 try/catch로 감싼다. catch에서:

1. `lifecycle = classifyDispatchFailure(err, dispatchConfirmed)`.
2. 원장 `attempt-closed{ lifecycle, outcome:'invalid', prompt_sha256:null }` append(`appendLedgerRowToDisk` —
   D5 손상은 전파·D6 쓰기실패 삼킴).
3. **durable 티켓이면 원장 pathspec 커밋**(attempt-opened와 동일 조건·기법) — 아니면 tree가 modified 원장으로
   남아 다음 리뷰 D10이 막힌다. 커밋은 **best-effort**(실패해도 경고만·원본 오류 전파). 원장은 `responses/` —
   semantic identity 불변(reviewTree·재시도 무영향).
4. `pre_dispatch_failed`면 `state = refundAttempt(...)`; `writeState`(scratch 환불).
5. **원본 dispatch 오류를 re-throw**(fail-closed — 실패는 실패. exit 비-0).

- `dispatchConfirmed` 플래그: `callReviewer`의 `onDispatchConfirmed` 콜백(thread_id 파싱 성공 즉시, respPath 기록
  前)에서 `true`(DEC-C1). 따라서 thread_id 확보 **후** 실패(respPath I/O·사후 tamper·후처리)는 전부
  `dispatch_confirmed`. 콜백 前 실패(spawn·exit·thread_id 없음)만 `pre_dispatch_failed`/`dispatched_unknown`.
- 정상 경로는 불변(`lifecycle:'completed'` 그대로).

### DEC-C5 — fail-closed 불변식

- 4개 실패 lifecycle 전부 **exit 비-0**(승인 아님). `completed`만 outcome 기반 exit(approved=0 등).
- crash로 catch 전에 죽으면 → `attempt-opened`만 durable(unclosed) → 예산 차감 유지·환불 없음(보수적, "불명은 차감").
- 환불은 **타입된 pre-dispatch에서만**. 그 외 모든 애매함은 차감.

## Phase별 구현

- **Phase 1 — 예산 유효회차·환불·타입 오류(순수·adapters)**: `SeriesRecord.refunded_attempts`·`openSeriesAttempts`
  차감·`refundAttempt`·`classifyDispatchFailure`(review-codex) + `ReviewCallError`·`defaultCodexRunner`
  타입 분류·`callReviewer` thread-fail 타입화(adapters/review-codex) + 단위 테스트.
- **Phase 2 — mainImpl 배선(try/catch·보상 close·환불·커밋)**: dispatch 구간 래핑 + 실 git near-e2e
  (pre-dispatch 환불·dispatched_unknown 차감·dispatch_confirmed·정상 completed 불변).

## 변경 파일

- `scripts/req/lib/adapters.ts`(P1) · `scripts/req/review-codex.ts`(P1·P2) · `scripts/req/lib/review-ledger.ts`
  (필요 시 lifecycle 값 주석만) · 테스트(P1·P2).

## 하위호환·안전

- `refunded_attempts`·lifecycle 값은 **additive**(스키마 키 불변·forward-compat). 기존 원장·state 그대로 유효.
- 예산 게이트 의미(openAttempts 기준·R2) 보존 — 유효회차만 정교화.
- main 통합은 D·E와 함께 마지막 사용자 확인.
