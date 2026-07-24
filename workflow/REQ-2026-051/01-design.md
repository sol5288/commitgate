# REQ-2026-051 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

**attempt 기록.** [review-codex.ts](../../scripts/req/review-codex.ts) `withAttemptRecorded`가 `recordAttempt` + `writeState`를 **codex 호출 직전**에 수행한다(REQ-2026-027 D3). 반환 state가 이후 처리의 base다. 호출이 throw하면 attempt는 이미 디스크에 남지만, 완료 기록(`appendReviewCallLog`)은 호출·판정이 **끝난 뒤**라 남지 않는다.

**내구화 지점 2곳.** ① design 승인 시 `durableDesignEvidence`가 `designEvidenceStagePaths`로 아카이브 전량 + `approvals.jsonl`을 `commitPaths`한다(REQ-2026-048). ② phase 승인은 `req:commit`의 `finalizeEvidenceAndConsume`이 evidence-finalize 커밋을 만든다. **둘 다 `state.json`은 제외한다**(의도).

**포트 경계.** `lib/evidence`는 fs·git을 직접 모른다 — `EvidencePorts`(readText/writeText/sha256/headText/commitPaths…)로만 부작용을 낸다. 실패 주입 테스트가 이 경계 덕에 가능하다.

**이미 내구적인 것.** `approvals.jsonl`의 `archive_inventory`가 아카이브된 전 라운드를 `response_path`+`sha256`으로 담는다. 원장은 이것을 **다시 적지 않는다**.

## 핵심 설계 결정

### D1. 원장 위치 — 티켓 `responses/` 안

`workflow/REQ-XXXX/responses/review-ledger.jsonl`.

`approvals.jsonl`과 같은 디렉터리에 두면 **기존 내구화 경로 2곳에 경로 하나만 추가**하면 된다 — `designEvidenceStagePaths`의 confinement 규칙(`isConfinedArchivePath`)과 evidence-finalize의 pathspec을 그대로 재사용한다. repo 루트에 두면 두 경로 모두 새 confinement 판단이 필요해지고, 티켓 삭제·아카이브 시 원장만 남는 비대칭이 생긴다.

### D2. 🔴 append-only를 지키려면 **행을 갱신하지 말고 두 개 쓴다**

attempt는 호출 **전**에 확정되고 결과는 **후**에 나온다. 한 행에 담으려면 나중에 그 행을 고쳐야 하는데, 그것은 append-only가 아니다. 그래서 **이벤트 2종**으로 나눈다.

| `event` | 언제 | outcome |
|---|---|---|
| `attempt-opened` | `withAttemptRecorded`가 attempt를 확정한 직후(호출 **전**) | 없음 |
| `attempt-closed` | 판정이 끝나 측정 로그를 남기는 시점 | `approved` / `needs-fix` / `blocked` / `invalid` |

**이 분리가 요구사항 #1(아카이브 없는 시도)을 그대로 만족시킨다** — `attempt-opened`만 있고 대응하는 `attempt-closed`가 없는 attempt가 곧 "예산은 깎였는데 완료되지 않은 호출"이다. 별도 필드 없이 **원장 구조 자체로 관측된다**.

### D3. lifecycle 필드는 자리만 만든다

`attempt-closed` 행에 `lifecycle` 필드를 두고 이 REQ는 **`completed`만** 쓴다. `pre_dispatch_failed`·`dispatch_confirmed`·`dispatched_unknown` 및 예산 차감 규칙 변경은 후속 REQ 소관이다.

확장 규칙을 지금 못 박는다: **검증기는 모르는 `lifecycle` 값을 거부하지 않는다**(forward-compatible). 반대로 모르는 **top-level 키는 거부**한다(주입 방어 — `approvals.jsonl`의 허용키 화이트리스트와 같은 취지). 이 비대칭이 의도다 — 값 확장은 후속 REQ의 정상 경로이고, 키 확장은 오염 신호다.

### D4. 행 스키마 — 프롬프트 전문 없음

고정 키 순서로 직렬화한다(deterministic — `serializeManifestLine`과 같은 방식).

```json
{"ticket_id":"REQ-2026-051","series_id":"design:-#1","review_kind":"design","phase_id":null,
 "attempt":3,"event":"attempt-closed","lifecycle":"completed","outcome":"approved",
 "exception_consumed":false,"archive_path":"workflow/REQ-2026-051/responses/design-r03-approved.json",
 "archive_sha256":"…","prompt_sha256":"…","at":"2026-07-24T…Z","reconstructed":false}
```

- `prompt_sha256`은 **해시만**이다. 프롬프트 본문·응답 본문은 원장에 들어가지 않는다(요구사항 #3). 응답 본문은 이미 아카이브에 있고 `archive_sha256`이 그것을 가리킨다.
- `attempt-opened` 행은 `outcome`·`archive_*`가 `null`이다.
- `exception_consumed`는 그 attempt가 autoBudget 초과라 사람 예외를 소비했는지다 — scratch에서 지워지는 유일한 사실이라 여기서만 살아남는다.

### D5. 멱등 — 자연키 + 충돌은 fail-closed

자연키 = `(ticket_id, series_id, attempt, event)`.

- 같은 키의 행이 이미 있고 **내용이 같으면** append하지 않는다(no-op). crash 후 재실행이 중복을 만들지 않는다.
- 같은 키인데 **내용이 다르면** append하지도, 덮지도 않고 **문제로 보고한다**(fail-closed). 조용한 덮어쓰기는 append-only 원장의 신뢰를 무너뜨린다.
- 파싱 불가 행이 있으면 그 파일 전체를 손상으로 보고한다 — `validateManifest`와 같은 태도다.

### D6. 🔴 원장 쓰기는 판정·exit code를 바꾸지 않는다

기록 실패가 게이트 결정을 뒤집으면 그것이 계약 위반이다(측정 로그 R8과 동일한 취지). 원장 append 실패는 **삼키고 경고**한다. 승인·차단 판정과 exit code는 원장과 무관하게 결정된다.

이것이 D5의 fail-closed와 모순되지 않는다 — D5는 **읽기·검증** 시 손상을 숨기지 않는다는 뜻이고, D6은 **쓰기** 실패가 게이트를 흔들지 않는다는 뜻이다.

### D7. 내구화는 기존 커밋 2곳에 얹는다 — 새 수동 단계 0

- design 승인 → `designEvidenceStagePaths`의 반환에 원장 경로를 합류시킨다.
- phase 승인 → evidence-finalize의 pathspec에 원장 경로를 합류시킨다.

원장 파일이 없으면(아직 한 행도 없을 때) 경로를 넣지 않는다 — 존재하지 않는 pathspec으로 커밋이 실패하지 않게 한다.

**커밋되지 않는 구간이 남는다**: 승인이 한 번도 없는 티켓의 attempt 행들. 그 구간은 후속 REQ(close proof)가 닫는다. 이 REQ에서 해결한 척하지 않는다.

### D8. gitignore 회귀 가드

원장은 `workflow/REQ-*/responses/` 아래라 현재 `workflow/.gitignore` 규칙(`/REQ-*/codex-response.json`·`.review-preview.txt`·`.codex-*.tmp`·`/.review-calls.jsonl`) 어디에도 안 걸린다. 그러나 **자산 skew로 규칙이 어긋나 무시되면 원장이 조용히 사라진다** — REQ-2026-025/047에서 같은 계열의 실패가 이미 두 번 났다. 실제 `git check-ignore`로 확인하는 회귀 테스트를 둔다.

## Phase별 구현

### phase-1-ledger-core

| 항목 | 내용 |
|---|---|
| 책임 계약 | 원장 행의 스키마·직렬화·파싱·검증·멱등 append를 순수 함수로 확정한다(D2·D3·D4·D5) |
| 입력 | 기존 `lib/evidence`의 직렬화·검증 관례 |
| 산출물 | `scripts/req/lib/review-ledger.ts` · `tests/unit/review-ledger.test.ts` |
| 선행 phase | 없음 |
| 독립 검증 | `npx vitest run tests/unit/review-ledger.test.ts` · `npm run typecheck` |

부작용 0 — fs·git을 모른다. 아무 호출부도 아직 이 모듈을 쓰지 않으므로 단독 커밋해도 런타임 동작이 변하지 않는다.

### phase-2-review-codex-wiring

| 항목 | 내용 |
|---|---|
| 책임 계약 | attempt 확정 직후와 판정 완료 시점에 원장 행이 남고, design 승인 커밋에 원장이 실린다(D2·D6·D7) |
| 입력 | phase-1 모듈 |
| 산출물 | `review-codex.ts` 배선 · `evidence.ts`의 `designEvidenceStagePaths` 확장 · 테스트 |
| 선행 phase | phase-1 |
| 독립 검증 | `npx vitest run tests/unit/req-review-codex.test.ts tests/unit/evidence-module.test.ts` · `npm run typecheck` |

### phase-3-evidence-finalize-and-ignore-guard

| 항목 | 내용 |
|---|---|
| 책임 계약 | phase 승인의 evidence-finalize 커밋에 원장이 실리고, 원장이 git에 무시되지 않음이 회귀로 잠긴다(D7·D8) |
| 입력 | phase-1 모듈 · phase-2가 만든 원장 파일 |
| 산출물 | `req-commit.ts` pathspec 확장 · gitignore 회귀 가드 · 재실행 멱등 테스트 |
| 선행 phase | phase-1 (phase-2와는 독립 — 서로 다른 커밋 경로다) |
| 독립 검증 | `npx vitest run tests/unit/req-commit.test.ts tests/unit/sync.test.ts` · `npm run typecheck` |

## 변경 파일

| phase | 파일 |
|---|---|
| 1 | `scripts/req/lib/review-ledger.ts`(신규) · `tests/unit/review-ledger.test.ts`(신규) |
| 2 | `scripts/req/review-codex.ts` · `scripts/req/lib/evidence.ts` · `tests/unit/req-review-codex.test.ts` · `tests/unit/evidence-module.test.ts` |
| 3 | `scripts/req/req-commit.ts` · `tests/unit/req-commit.test.ts` · `docs/guarantees.{md,en.md}` |

## 하위호환·안전

- **기존 티켓**: 원장이 없는 티켓은 그대로 동작한다. 원장 부재는 오류가 아니다(신규 파일이므로 모든 기존 티켓이 부재 상태다).
- **`state.json` 무변경**: 정본으로 승격하지 않는다. 원장은 별도 파일이고 scratch state는 지금 역할 그대로다.
- **게이트 무변경**: 이 REQ는 승인·차단 판정을 바꾸지 않는다(D6). exit code 경로도 그대로다.
- **`.review-calls.jsonl` 무변경**: 측정 로그는 gitignore된 채 남는다. 원장과 목적이 다르다(측정 vs 감사).
- **미해결로 남는 것**: 승인 0건으로 종결된 티켓의 원장은 여전히 커밋되지 않는다. 후속 REQ가 닫는다 — 이 REQ의 인수 기준에 넣지 않는다.
