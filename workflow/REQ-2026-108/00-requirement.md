# REQ-2026-108 요구사항

D5 강등 — 죽은 필드가 커밋을 막지 않는다

## 배경

2026-08-02 자체 감사 B트랙 2번째.

### 실측

`req:doctor` D5는 `state.codex_thread_id`가 UUID 형식인지 검사하고 **FAIL**을 낸다(`req-doctor.ts:476-478`). 그런데 이 필드를 **읽는 코드는 D5 자신뿐**이다.

| 위치 | 역할 |
|---|---|
| `review-codex.ts:1993`·`:2030`·`:2278` | **쓰기**(승인 증거 스냅샷 포함) |
| `req-new.ts:107` | 초기화(`null`) |
| `lib/review-types.ts:37` | 타입 선언 |
| `req-doctor.ts:476` | **유일한 읽기 — D5 자신** |

REQ-2026-013 P4가 재리뷰를 stateless로 고정한 뒤 이 값을 소비하는 분기가 상수로 죽었고, **REQ-2026-103이 그 죽은 배선을 제거**하면서 완전히 기록 전용 필드가 됐다.

### 왜 문제인가 — 비대칭 비용

`req:commit`은 `req:doctor`를 **하드 게이트로 spawn**한다. 따라서 D5 FAIL = **커밋 차단**이다.

`codex_thread_id`의 출처는 `parseThreadId(rawStdout)` — codex CLI가 내는 `thread.started.thread_id`다. **codex가 이 id 형식을 UUID가 아닌 것으로 바꾸는 날, 전 소비자의 커밋이 동시에 막힌다.** 아무것도 읽지 않는 필드 때문에.

이 저장소는 이미 같은 비대칭을 다른 자리에서 명시적으로 판단했다 — `assertReviewerReady`(`review-codex.ts`)는 auth probe의 `unknown`을 통과시키며 이렇게 적었다: *"false block은 codex가 `login status` 출력 문자열을 바꾼 날 전 소비자의 모든 리뷰를 동시에 멈춘다."* D5는 같은 종류의 위험인데 반대로 판단돼 있다.

또한 D19~D27 아홉 개 검사는 전부 **WARN 상한**이고, 그 근거 주석이 여덟 번 반복된다: *"`req:commit`이 doctor를 하드 게이트로 spawn하므로 FAIL은 소비자 커밋을 벽돌로 만든다."* **D5만 그 원칙 밖에 남아 있다.**

## 요구

1. **D5를 WARN으로 강등한다.** 형식 이상은 여전히 보고하되 **커밋을 막지 않는다**.

2. **강등 사유를 코드에 남긴다.** 다음 사람이 "왜 이것만 WARN이지" 하고 FAIL로 되돌리지 않도록, 이 필드가 기록 전용이라는 사실과 비대칭 비용 논거를 검사 옆에 적는다.

## 비요구

- **D5 제거**: 이 필드는 **승인 증거 스냅샷에 들어간다**(`ApprovalEvidence.codex_thread_id`). 형식이 깨진 값이 감사 기록에 남는 것은 여전히 알 값어치가 있다. 게다가 제거는 `D_CHECK_IDS`·정본 표(`07 §3`)·결번 정책까지 건드리는 더 큰 소비자 변화다. **막지 않게만 한다.**
- **`codex_thread_id` 필드 자체 제거**: 소비자 state 95개(yammy 81·MBTI 14)에 실재하고 증거 스냅샷에도 들어 있다. REQ-2026-103이 이미 유지를 결정했다.
- **X-6(HIGH 확인 진단 공백)·delivery ports 버그·doctor 병합**: 각각 별도 REQ.

## 완료 기준

- 형식이 깨진 `codex_thread_id`로 `runChecks`를 돌리면 D5가 **WARN**이고 FAIL이 0건인 회귀 테스트.
- `req:doctor`의 exit code가 그 상태에서 **0**이다(= `req:commit`이 막히지 않는다).
- 소비자 영향: **막히던 것이 안 막히는 방향만**. 정상 UUID 티켓의 출력은 불변(OK).
