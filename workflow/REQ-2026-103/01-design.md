# REQ-2026-103 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

전부 2026-08-02 감사 후 **직접 grep으로 재검증**한 사실이다(서브에이전트 정적 분석을 그대로 믿지 않았다).

| # | 위치 | 현재 상태 | 근거 |
|---|---|---|---|
| 1 | `review-codex.ts:2670` | `const isResume = false` — REQ-2026-013 P4에서 stateless로 전환하며 상수로 고정 | `:2773` `isResume ? 'resume' : 'exec'`, `:2792` `isResume ? state.codex_thread_id : null` 두 분기가 영구 도달 불가 |
| 2 | `review-codex.ts:2462,2478` / `lib/adapters.ts:250,413,426-430` | `resumeThreadId`가 `callReviewer` → `ReviewerAdapter.review` → `createCodexReviewerAdapter`까지 흐르지만 **항상 null** | `:426` `resumeThreadId ? [exec resume …] : [exec …]`의 참(眞) 가지가 프로덕션에서 실행되지 않음 |
| 3 | `review-codex.ts:1756` `withAttemptRecorded` | 프로덕션 호출자 0 — `mainImpl:2721`은 `gateAndRecordAttempt`를 직접 호출 | 참조는 `tests/unit/req-review-codex.test.ts` 3곳뿐. 함수 자신의 JSDoc(`:1707-1713`)이 "재조립으로 기존 계약 보존"이라 자인 |
| 4 | `review-codex.ts:2490-2502` | `main()`이 `reviewer`만 try/finally 복원. `mainImpl:2510`이 재할당하는 `gitAdapter`는 복원 없음 | 같은 위험을 지적한 주석(`:2494-2496`)이 `reviewer`에만 달려 있음 |
| 5 | `bin/quickstart.ts:16-17` | `QUICKSTART_MARKER_OPEN`/`_CLOSE` — 저장소 전역 참조 0 | `extractQuickstartBlock`·`injectQuickstart`는 자체 정규식 사용 |
| 6 | `req-close.ts:125` | `committedPlannedPhaseIds = plannedPhaseIdsFromState` 별칭. 사용처는 같은 파일 `:310` 1곳 | 다른 grep 히트(`close-migrate.ts:51` 등)는 **동명 객체 프로퍼티**라 참조가 아님 |
| 7 | `lib/review-ledger.ts:292` `unclosedAttempts` | 어떤 게이트·doctor 체크도 호출하지 않음 | 참조는 `tests/unit/review-ledger.test.ts`뿐 |
| 8 | `review-codex.ts:2657` | DRY-RUN 출력에 `phase=${state.phase}` | `state.phase`는 `:995-999`가 DEPRECATED 선언(아무도 갱신 안 해 영원히 `INTAKE`). 프롬프트에서는 `:2606-2608`이 이미 제거했는데 이 출력만 남음 |
| 9 | `review-codex.ts:1519-1546`, `:1606-1616` | 고아 JSDoc 3덩어리 — 함수만 이동하고 주석이 남음 | `:1519` 블록은 `withAttemptRecorded`용, `:1528` 블록은 `appendLedgerRowToDisk`(실제 위치 `:1589`, **JSDoc 없음**)용인데 둘 다 `REVIEW_PROVIDER_ID:1551` 위에 쌓여 있음. `:1606` 블록은 `precallCommitLedgerRow`용인데 `appendCloseProofRowToDisk:1617`(자체 JSDoc 보유) 위에 떠 있음 |

## 핵심 설계 결정

### DEC-1 🔴 `state.codex_thread_id` **필드는 유지한다**. 읽어서 분기하는 죽은 경로만 제거한다

소비자 state 95개(yammy 81·MBTI 14)에 이 필드가 실재하고, 승인 증거 스냅샷에도 값이 들어가 있다. 필드를 없애면 기존 티켓의 state·아카이브 형태가 바뀐다. 따라서 **쓰기(`:2036`·`:2073`·`:2321`)는 그대로 두고**, `isResume` 삼항으로 읽던 경로만 없앤다. 결과적으로 이 필드는 "기록 전용"이라는 현재의 실제 성격이 코드에도 드러난다.

(D5가 이 필드에 FAIL 권한을 갖는 문제는 doctor 출력이 바뀌므로 **이 REQ 범위 밖**이다.)

### DEC-2 resume 분기는 어댑터까지 완전히 제거한다 — 트레이드오프를 명시한다

`ReviewerAdapter.review`의 `resumeThreadId` 파라미터와 `createCodexReviewerAdapter`의 resume 인자 조립을 제거한다.

- **소비자 영향 0**: 소비자가 어댑터를 주입할 수 있는 config 경로가 없다(`lib/config.ts`에 adapter 키 없음 — 확인함). `docs/ssot-design/08`이 `createCodexReviewerAdapter(run?)`를 공개 인터페이스로 적었지만 그 시그니처에 `resumeThreadId`는 없다(문서 수정 불요).
- **트레이드오프(정직하게)**: REQ-2026-045는 resume을 **폐기가 아니라 PARKED**로 뒀다("stateless 유지 · 사람 태거-2 확정 前 resume 구현 금지", 후속 레버 C=자문 전용). 지금 지우면 resume이 부활할 때 어댑터 인자 조립 ~10줄을 다시 써야 한다.
- **그럼에도 제거하는 이유**: ① 부활하더라도 게이트 정책·감사 설계를 새로 해야 하므로 이 10줄이 재사용될 여지가 작다. ② REQ-045 1차 태깅에서 resume의 전제인 "재론"이 **32전이 중 0회** 관측됐다 — 레버가 당겨질 개연성이 낮다. ③ `isResume = false`라는 상수가 "resume이라는 모드가 있다"고 **읽는 사람을 오도**한다. ④ 복원 지점을 CHANGELOG에 SHA로 남긴다.
- 리뷰어가 ②③보다 PARKED 보존을 더 무겁게 본다면 이 결정을 뒤집을 수 있다 — 그 경우 DEC-1만 남기고 `callReviewer` 상위 배선만 정리한다.

### DEC-3 `withAttemptRecorded` 제거 + 테스트 3곳은 **삭제가 아니라 재작성**

세 테스트가 실제로 검증하는 대상은 래퍼가 아니라 `gateAndRecordAttempt`의 게이트 동작이다. 각각 무손실로 옮겨진다:

| 테스트 | 현재 검증 대상 | 재작성 |
|---|---|---|
| `O2-5`(`:4504`) "call() throw에도 attempts가 남는다" | 실질은 **`gateAndRecordAttempt`가 반환 전에 `writeState`한다**(예산 세탁 차단) | `gateAndRecordAttempt` 호출 후 디스크 state의 `attempts=1`을 단언. throw 시뮬레이션은 래퍼 고유 형태라 제거하고, "호출 전 영속"이라는 불변식을 직접 단언한다 |
| `O1-9b`(`:4717`) 예외 소비 후 7회차 차단 | 게이트가 `/사람 승인/`으로 throw | `gateAndRecordAttempt(...)`가 같은 메시지로 throw |
| `O1-11`(`:4741`) phase id에 `#` 있어도 예외 바인딩 유지 | 열린 record의 `series_id` 직접 사용 | `gateAndRecordAttempt(...)`의 반환 `state`로 동일 단언 |

**커버리지는 줄지 않고 오히려 프로덕션 함수를 직접 겨냥하게 된다.** 이것이 "테스트를 지워서 통과시키지 않는다" 규칙을 지키는 방식이다.

### DEC-4 `gitAdapter`는 `reviewer`와 **같은 패턴**으로 복원한다

`main()`의 기존 try/finally에 `gitAdapter` 저장·복원을 추가한다. 새 패턴을 만들지 않고 바로 옆 3줄을 대칭으로 맞춘다. 이 REQ에서 **동작이 바뀌는 유일한 변경**이므로 별도 phase로 격리하고 회귀 테스트를 붙인다.

### DEC-5 `unclosedAttempts`는 삭제한다 — 배선 없는 진단은 "있는 척하는 보호"다

"예산은 깎였는데 완료되지 않은 호출"은 쓸모 있는 진단이지만, 어디에도 연결돼 있지 않아 **아무것도 지키지 않으면서 지키는 것처럼 보인다**. 진단이 필요해지면 그때 체크와 함께 작성한다(그 시점엔 doctor 출력이 바뀌므로 어차피 소비자 관측 있는 별도 REQ다). 삭제 지점을 CHANGELOG에 SHA로 남긴다.

### DEC-6 고아 JSDoc은 **삭제가 아니라 실제 함수 위로 이동**

설계 근거 주석은 이 저장소의 자산이다. `appendLedgerRowToDisk`(현재 JSDoc 없음)와 `precallCommitLedgerRow`는 자기 주석을 되찾고, `withAttemptRecorded`의 주석만 함수와 함께 사라진다.

### DEC-7 `export` 표면 축소는 범위 밖

감사가 지목한 값 47개·타입 111개의 불필요 `export` 제거는 20여 파일을 건드리는데 런타임 효과가 0이다. 검수 면적(과 리뷰 비용) 대비 가치가 낮고, 일부는 테스트가 타입으로 import하고 있어 개별 확인이 필요하다. 별도 REQ로 미룬다.

## Phase별 구현

| phase | 성격 | 내용 |
|---|---|---|
| `phase-1-dead-review-wiring` | **동작 무변경** | DEC-1·2·3·6 + 항목 8(DRY-RUN `phase=`) |
| `phase-2-misc-dead-symbols` | **동작 무변경** | DEC-5 + 항목 5·6(quickstart 마커·req-close 별칭) |
| `phase-3-gitadapter-restore` | **동작 변경(유일)** | DEC-4 |
| `phase-4-changelog` | 문서 | CHANGELOG + 앞 phase SHA 포인터 표 |

## 변경 파일

- phase-1: `scripts/req/review-codex.ts` · `scripts/req/lib/adapters.ts` · `tests/unit/req-review-codex.test.ts` · `tests/unit/req-adapters.test.ts`
- phase-2: `bin/quickstart.ts` · `scripts/req/req-close.ts` · `scripts/req/lib/review-ledger.ts` · `tests/unit/review-ledger.test.ts`
- phase-3: `scripts/req/review-codex.ts` · `tests/unit/req-review-codex.test.ts`
- phase-4: `CHANGELOG.md`

## 하위호환·안전

**판정 기준**: 소비자는 진행 중 티켓 위로 업그레이드한다(yammy REQ-131 작업 중, MBTI REQ-014/015 진행 중). 따라서 "기존 state·아카이브·원장·프롬프트를 바이트 그대로 읽고 쓰는가"가 통과 조건이다.

| 축 | 영향 | 근거 |
|---|---|---|
| state 스키마 | 없음 | `codex_thread_id` 쓰기 유지(DEC-1). 삭제·추가 필드 0 |
| 승인 아카이브 | 없음 | 응답 파싱·검증 경로 미변경. `risk_level` 셔틀 미접촉(yammy 697파일이 의존) |
| 원장/close proof 형식 | 없음 | 직렬화 코드 미변경. `unclosedAttempts`는 **읽기 helper**라 기록 형식과 무관 |
| 프롬프트 바이트 | 없음 | 조립 경로 미변경. DRY-RUN **콘솔 출력** 1줄만 짧아짐(프롬프트 파일 아님) |
| doctor 출력 | 없음 | D-체크 미변경 |
| CLI 표면 | 없음 | verb·옵션 미변경 |
| `machine.schema.json` | 없음 | 미접촉(변경 시 D20 skew + 아카이브 재검증 위험) |

**동작이 바뀌는 유일한 지점**은 DEC-4다. programmatic 다중 호출(near-e2e 테스트)에서 `gitAdapter`가 이전 호출의 root를 물고 있던 오염이 사라진다. CLI는 프로세스당 1회라 소비자 관측이 없다.

**되돌리기**: 각 phase가 독립 커밋이라 개별 revert 가능. resume 배선(DEC-2)·`unclosedAttempts`(DEC-5) 복원 지점은 CHANGELOG에 SHA로 남긴다.
