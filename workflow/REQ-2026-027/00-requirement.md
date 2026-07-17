# REQ-2026-027 요구사항 — review series 모델·attempt 기록·legacy (개선 REQ-A-1)

## 1. 배경

무한 재리뷰에 실질적 상한이 없다. 현행 `gateRunCandidate`의 G2는 **같은 바인딩** 재리뷰만 막고
(`last_review.compare_hash` 일치), **hash가 바뀌면 통과**한다. 관측된 병리는 전부 후자다 — REQ-020의
design 14라운드는 라운드마다 hash가 달랐고, REQ-013은 17라운드였다.

**이 REQ는 상한을 만들기 위한 토대다.** 상한을 강제하려면 먼저 "이 series에서 외부 리뷰가 몇 번
일어났는가"를 신뢰 가능하게 **세어야** 한다. 그 계수 모델이 없으면 예산도 escalation도 얹을 곳이 없다.

**출처**: REQ-2026-026(REQ-A)이 series 모델·예산·escalation·lineage·로그를 **한 REQ에 다 담아** 설계
755줄에 design 리뷰 6라운드 미수렴으로 종료됐다(2026-07-17, merge 금지 감사 보존). 그 리뷰가 남긴
유효 지적 15건을 A-1/A-2로 나눠 재구현한다. **이 REQ(A-1)는 D1~D3 = 계수 모델까지만**이다.
근거: REQ-025(A0) 274줄이 design 1라운드로 끝났다. 표면을 그 체급으로 줄인다.

## 2. 목표(What)

review series를 **정의하고, 외부 호출을 신뢰 가능하게 세고, legacy 티켓을 안전하게 구분**한다.

**이 REQ는 아무것도 막지 않는다.** 예산·상한·escalation·차단은 전부 A-2다. A-1은 **세기만 한다** —
attempt가 정확히 누적되고 우회로가 없다는 것만 보장한다. 그래야 A-2가 그 위에 게이트를 얹을 수 있다.

## 3. 요구(정규화)

### 새 ticket 모델 · legacy

- **R1 모델 버전**: `req:new`가 만드는 새 ticket은 **첫 리뷰 전에도** `review_series_model_version: 1`을
  갖는다. 이로써 "series 레코드가 아직 없다"(새 ticket)와 "legacy"(필드 부재)를 혼동하지 않는다.
  선례: 같은 자리의 `approval_evidence_required`(REQ-016 D-016-6 — 신규 강제·legacy 부재 판정). (Done #1)
- **R2 legacy 무침습**: legacy ticket(필드 부재)을 **일괄 스캔·수정·초기화하지 않는다.** 지연 판정만 —
  그 티켓에서 리뷰가 실제로 요청될 때만 판정한다. legacy면 자동 0회 초기화 대신 **`AWAIT_HUMAN`**을
  반환하며, 이 판정은 **`req:next`(안내)와 호출 지점(강제) 양쪽**에 있어야 한다 — 호출 지점 throw만으로는
  `req:next`가 여전히 `RUN`을 지시해 "실행해 보면 죽는" 안내가 된다. (026 지적 ⑧) (Done #2)
- **R3 `state.phase` 금지**: 활성·완료 판정 근거로 **쓰지 않는다.** 실측: 티켓 23개 전부 `INTAKE`,
  완료·병합된 REQ-024도 `INTAKE`, 이 값을 읽는 코드가 없다. 이걸로 legacy를 판정하면 역사적 티켓 전부가
  "활성 legacy"로 오분류돼 R2를 깬다. (constraints)

### series 계약

- **R4 series 식별**: series는 최소 `(ticket, review_kind, phase_id)`를 식별한다. 같은 `(kind, phase_id)`에
  열린 레코드가 있으면 재사용하고, `phase_id`가 다르면 별도 series다. (Done #3)
- **R5 design series 지속**: 설계 hash·`--fresh-thread`·archive 파일명·round가 바뀌어도 **닫히지 않는다.**
  ← 이것이 A-1의 핵심. hash 변경으로 series가 새로 열리면 계수가 초기화돼 REQ-020 병리가 재현된다.
  archive 파일명·round는 series 판정의 **입력이 아니다.** (Done #3)
- **R6 `approved`만이 자동 종료다**: outcome이 `approved`면 그 series를 `closed_reason='approved'`로 닫는다.
  **`needs-fix`·`blocked`·`invalid`에서는 닫히지 않는다**(`closed_reason===null` 유지). ← NEEDS_FIX에서 닫는
  구현은 다음 리뷰가 새 series(0회)를 열어 상한을 무의미하게 만든다. (026 지적 ①의 뿌리) (Done #3)
- **R7 이력 보존**: `approved`로 닫힌 뒤 같은 `(kind, phase_id)`를 다시 해소하면 **새 레코드**(seq 증가)가
  열리고 **이전 레코드는 배열에 그대로 남는다.** 닫을 때 지우거나 덮어쓰지 않는다. (Done #3)

### attempt 기록

- **R8 호출 직전 기록**: 외부 Codex 호출 **직전에** attempt를 기록하고 즉시 `writeState`한다. 호출 중
  프로세스가 실패·중단돼도 attempt는 **소비된 채 남는다**(fail-closed). "호출이 실패했으니 안 센다"는
  잘못이다 — 외부 호출은 이미 일어났고 비용도 이미 발생했다. (Done #4)
- **R9 정상 경로 보존**: 호출 **후** 처리(`processResponse`·`resolveReviewOutcome`·최종 `writeState`)는
  **attempt 기록이 반영된 state를 base로** 해야 한다. 호출 전 state를 후처리에 다시 쓰면 attempt가
  **정상 경로에서 되돌아간다.** (026 지적 ②) 이 배선은 **가짜 reviewer를 `main()`에 주입한 near-e2e
  오라클로 검증**한다 — 단위 wrapper 테스트로는 못 잡는다(design-r01 P1). (Done #4)
- **R10 초기화 불가**: hash 변경·`--fresh-thread`·archive 재번호·수동 state 편집으로 attempt가 **조용히
  0으로 돌아가면 안 된다.** `--fresh-thread`는 `blocked_review` 마커만 초기화하고(기존 의미 보존) series에는
  손대지 않는다. (Done #4)

### 범위

- **R11 아무것도 막지 않는다**: 이 REQ는 계수·기록·legacy 구분만 한다. **예산·상한·escalation·차단·예외·
  lineage·로그 확장은 전부 A-2(비목표).** attempt는 늘어나기만 하고 어떤 값에서도 리뷰를 거부하지 않는다
  (legacy `AWAIT_HUMAN` 제외 — 그건 계수가 아니라 안전 구분이다). (constraints)
- **R12 기존 흐름 무변경**: 기존 BLOCKED/INVALID/D9/G1/G2/phase 승인 흐름·`classifyReview`·승인 바인딩을
  **약화하지 않는다.** legacy `AWAIT_HUMAN`은 `resolveNext`에 **추가**되며 기존 판정을 바꾸지 않는다. (constraints)
- **R13 지원 범위**: 단일 활성 worktree + 협조적 작업자만 지원한다. multi-worktree lock·CAS·common-dir
  state·분산 동시 실행 방지·자동 recovery는 **구현하지 않는다.** state.json 동시 쓰기 경합은 다루지 않는다.
  REQ-017의 lock/CAS 설계는 재사용·복구하지 않는다(terminal). (constraints)
- **R14 테스트·typecheck**: 단위 테스트·typecheck 통과. (Done #5)

## 4. 비목표 — 이번 범위에서 구현하지 않음 (전부 A-2 또는 그 뒤)

- 🔴 **A-2**: 예산 게이트(자동 1~5)·escalation·사람 예외(6~8회)·하드 상한(9)·`req:next` G3·config 설정값·
  lineage(`--successor-of`·`human_resolution`)·로그 4필드 확장·호출 시점 snapshot. **전부 범위 밖.**
- 🔴 **명시적 위험 수용 전이**(리뷰 승인 없이 커밋하는 우회 게이트). `B1`처럼 별도 통제점 — 별도 REQ.
- REQ-B(design delta review)·REQ-C(승인 단위 분리).
- 로그 집계·조회 명령.
- 기존 REQ-001~026의 문서·state·승인 evidence 소급 수정. **REQ-026 브랜치는 merge 금지 감사 보존.**

## 5. 인수 기준

1. `req:new`가 만든 state에 `review_series_model_version: 1`이 있다.
2. 서로 다른 design hash로 attempt를 3회 기록하면 **series 레코드는 1개, `attempts===3`**(hash 변경이
   계수를 초기화하지 않는다).
3. `approved`가 series를 닫고, `needs-fix`·`blocked`·`invalid`는 닫지 않는다.
4. `approved`로 닫힌 뒤 재해소하면 새 레코드(seq 증가)가 열리고 이전 레코드는 남는다.
5. `withAttemptRecorded`가 `attempts` 증가·`writeState` 후 `call()`을 부르며, `call()`이 throw해도
   디스크 state의 `attempts`가 증가한 채 남는다.
6. 반환 state를 base로 후처리한 최종 state에 `attempts` 증가가 **`approved`·`needs-fix`·`blocked`·`invalid`
   네 outcome 전부에서** 남는다(main() near-e2e).
7. legacy state(모델 버전 부재)는 `req:next`에서 **`AWAIT_HUMAN`**이고 호출 지점에서 **throw**하며,
   **state가 한 바이트도 바뀌지 않는다**(자동 초기화 없음).
8. `--fresh-thread`가 `review_series.attempts`를 건드리지 않는다.
9. 호출 전 `state.json` 쓰기가 호출 후 D10 재검사에 걸리지 않는다(`state.json`은 이미 SCRATCH).
   `state.json` 외 tracked 파일 수정은 여전히 검출된다.
10. 기존 BLOCKED/INVALID/D9/G1/G2/phase 승인 흐름과 legacy evidence 검증이 깨지지 않는다.
11. 단위 테스트·typecheck 통과.
