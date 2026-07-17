# REQ-2026-027 설계 — review series 모델·attempt 기록·legacy

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

- **`review-codex.ts` `main()`** — `callReviewer`(`:~1425`) **직전**에 D10 재검사(`preDirty`)와 blocked
  회로차단기가 있다. 호출 후 `processResponse`(pre-call `state`를 `baseArgs`에 넣음) → `resolveReviewOutcome`
  → `writeState`. **호출 전 state가 후처리 base로 쓰인다 — 이게 R9의 위험 지점.**
- **`resolveNext`(`req-next.ts:416`)** — 순수 판정 코어. `commit_allowed` 분기(1번) → design stale 분기 →
  `gateRunCandidate`로 RUN 후보 게이트. `NextInput`(순수 입력) → `NextAction`.
- **`req-new.ts:84~90`** — state 스캐폴드. `approval_evidence_required: true`가 **grandfathering 선례**
  (REQ-016 D-016-6: 신규 강제·필드 부재=legacy).
- **`findUnstagedOrUntracked`(`review-codex.ts:1062`)** — `reviewScratchPaths(ticketRel)`가 반환하는
  SCRATCH 목록에 **`state.json`이 이미 포함**(`lib/scratch.ts:34`). 첫 분기
  `if (e.origPath === undefined && allowed.has(e.path)) return false`가 `state.json`을 먼저 걸러낸다.
- **`--fresh-thread`** — `blocked_review` 마커를 초기화(`clearBlockedReview`). 회복 의미. series와 무관.
- **실측**: `state.phase`는 죽은 필드다 — 티켓 23개 전부 `INTAKE`, 완료·병합된 024도 `INTAKE`, 읽는 코드 없음.

## 핵심 설계 결정

### D1. 모델 버전으로 "새 ticket"과 "legacy"를 가른다 (R1·R2·R3)

`req-new`의 state 스캐폴드에 **`review_series_model_version: 1`**을 추가한다.
`approval_evidence_required`와 같은 자리·같은 의미론이다.

- **필드 있음** = 새 모델. series 레코드가 없어도 "0회 시작"이 정당하다.
- **필드 부재** = legacy. 새 재리뷰 요청 시 **`AWAIT_HUMAN`**.

**"series 레코드 유무"로 판정하지 않는 이유**: 새 ticket도 첫 리뷰 전엔 레코드가 없어 legacy로
오분류된다. 생성 시점에 찍는 표식만이 둘을 구분한다.

**`state.phase`를 쓰지 않는 이유**(R3): 죽은 필드다(위 실측). 이걸로 판정하면 역사적 티켓 23개 전부가
"활성 legacy"로 분류돼 R2를 깬다.

**legacy 판정은 두 곳에 있어야 한다** (026 지적 ⑧):

| 지점 | 역할 | 결과 |
|---|---|---|
| `resolveNext`(`req-next.ts`) | **안내** | legacy면 RUN 후보를 만들기 **전에** `AWAIT_HUMAN` |
| `review-codex` 호출 직전 | **강제** | legacy면 throw(fail-closed) |

호출 지점 throw만 두면 `req:next`가 여전히 `RUN`을 지시하고 사용자는 실행한 뒤에야 죽는다. R2는
`AWAIT_HUMAN`을 요구한다. `resolveNext`는 `commit_allowed` 분기 **다음**, design/phase RUN 후보를 만들기
**전에** legacy를 본다 — 살아 있는 승인이 legacy보다 우선한다(소비만 하면 되고 새 외부 호출이 아니다).
`NextInput`에 `reviewSeriesModelVersion: number | null`을 추가한다(순수 입력 유지).

**legacy 일괄 스캔 금지.** 지연 판정만 — 리뷰가 실제 요청될 때만. 현재 기준선의 legacy REQ는 전부
완료·병합됐으므로 이 경로는 실질적으로 비어 있다. 그래도 fail-safe로 남긴다.

### D2. series 레코드 (R4~R7)

`state.review_series: SeriesRecord[]`. 배열이다 — **이력을 지우지 않기 위해**(R7).

```jsonc
{
  "series_id": "design:-#1",  // 생성식: `${kind}:${phase_id ?? '-'}#${seq}` (내부 식별자, 외부 계약 아님)
  "review_kind": "design",
  "phase_id": null,
  "attempts": 3,
  "closed_reason": null       // null=열림. A-1에서 쓰는 값은 'approved' 하나뿐(아래)
}
```

**A-1은 `closed_reason`에 `'approved'`만 쓴다.** `human-resolution`·예산·escalation은 A-2다. A-1의
타입은 `'approved' | null`이며, A-2가 `'human-resolution'`을 **추가**한다(열린 확장).

- **열림 판정**: 같은 `(kind, phase_id)`에 `closed_reason === null`인 레코드. 없으면 새로 연다
  (`seq` = 같은 키의 기존 레코드 수 + 1).
- **design series(R5)**: hash·thread·archive·round가 바뀌어도 **닫지 않는다.** 닫히는 계기는 **승인뿐**
  (A-1 범위). archive 파일명·round는 series 판정의 입력이 아니다. ← A-1의 핵심.
- **`approved`만 자동 종료**(R6): outcome이 `approved`면 그 series를 닫는다. **`needs-fix`·`blocked`·
  `invalid`는 닫지 않는다.** NEEDS_FIX에서 닫으면 다음 리뷰가 새 series(0회)를 열어, A-2가 얹을 상한이
  무의미해진다(026 지적 ①의 뿌리).
- **이력 보존·재개방(R7)**: `approved`로 닫힌 뒤 재해소하면 새 레코드(seq 증가)가 열리고 **이전 레코드는
  배열에 남는다.** 승인 후 설계가 또 바뀌는 것은 정당하다 — 승인은 얻었고 새 바인딩은 새 문제다.

**쓰는 지점**: `review-codex`에서 outcome이 `approved`로 확정될 때(`resolveReviewOutcome` 직후,
최종 `writeState` 전). `req-commit.ts`는 건드리지 않는다 — `approved`가 모든 kind를 닫으므로 커밋 시점에
닫을 것이 없다.

### D3. attempt는 호출 **직전**에 기록하고, 반환 state가 후처리 base다 (R8·R9·R10)

순서:

1. legacy 판정(D1) → legacy면 throw(fail-closed, `AWAIT_HUMAN` 안내)
2. series 해소(열린 것 재사용 또는 새로 열기)
3. `attempts += 1` → **`writeState`**
4. 그 다음에 `callReviewer`

**A-1에는 예산 게이트가 없다**(R11) — 3단계는 순수 증가다. A-2가 2.5단계에 게이트를 삽입한다.

**이 순서를 테스트 가능한 이음매로 만든다.** `main()`의 `reviewer`는 모듈 스코프 상수
(`review-codex.ts:52`)라 주입 불가 → 인라인이면 단위 테스트로 증명할 수 없다. R8/R9는 예산 세탁의
유일한 방어선이라 그러기엔 중요하다. 그래서 1~3을 고차 함수로 감싼다:

```ts
export function withAttemptRecorded<T>(
  ctx: { ticketDir: string; state: WorkflowState; kind: ReviewKind; phaseId: string | null },
  call: () => T,
): { result: T; state: WorkflowState }
```

- series 해소·`attempts += 1`·`writeState`를 하고 **그 뒤** `call()`을 부른다.
- `call()`이 **throw해도 기록을 되돌리지 않는다**(전파만, 기록은 선행).
- **반환 `state`가 후처리의 유일한 base**다(R9 · 026 지적 ②).

#### 🔴 반환 state를 후처리 base로 쓰지 않으면 정상 경로에서 되돌아간다 (026 지적 ②)

기준선 `main()`은 호출 **전** `state`를 `baseArgs`에 넣고, `processResponse`→`resolveReviewOutcome`이
그것으로 `finalState`를 만들어 `writeState`로 덮는다. wrapper가 디스크에 `attempts=5`를 써도, 후처리가
`attempts=4`인 pre-call state를 base로 최종 write하면 **되돌아간다.** throw 경로 테스트로는 이걸 못 잡는다
(후처리가 안 돌기 때문). 그래서 계약을 명시한다:

```ts
const { result: callResult, state: afterAttempt } = withAttemptRecorded(ctx, () => callReviewer(reviewer, {...}))
const baseArgs = { ticketDir, state: afterAttempt, /* ... */ }   // ← pre-call state 아님
```

`attempts`·`review_series`가 **정상 NEEDS_FIX와 approved 양쪽에서** 보존돼야 한다.

#### 🔴 배선을 검증하려면 reviewer를 주입 가능하게 만든다 — 그리고 그 seam은 **phase-1**이다 (design-r01·r02 P1)

`main()`의 **동작을 실제 실행 경로에서** 검증하려면 reviewer를 주입해야 하는데, 이게 두 지점에서 필요하다:

- **phase-1(legacy)**: R2는 legacy에서 **외부 호출 자체가 안 일어남**을 요구한다. "throw + state 바이트 동일"만
  검사하면 **호출을 먼저 하고 throw하는 구현도 통과**한다(r02 P1). 가짜 reviewer의 **exec/resume 호출이 0회**
  임을 단언해야 진짜로 fail-closed다.
- **phase-2(attempt)**: `main()`이 wrapper 반환 state를 후처리 base로 넘겼는지(R9)는 단위 테스트로 안 잡힌다
  (r01 P1). 가짜 reviewer로 near-e2e를 돌려 최종 `writeState` 후 `attempts`를 단언해야 한다.

**둘 다 seam을 요구하고, phase-1이 먼저다.** 그래서 **reviewer 주입 seam은 phase-1의 첫 작업**이다 —
D2·D3(계수)이 아니라 D1(legacy)이 먼저 그것을 쓴다. seam 자체는 계수와 무관한 순수 테스트 인프라다.

현재 `reviewer`는 모듈 스코프 **`const`**(`review-codex.ts:52`)다. 바로 옆 `gitAdapter`는 이미 **`let` +
`main()` 내 재할당**으로 테스트 주입을 지원한다 — **같은 선례를 따른다**:

- `reviewer`를 `let`으로 바꾸고, `main(argv, opts?: { reviewer?: ReviewerAdapter })`로 **선택적 주입구**를
  연다(기본값 `createCodexReviewerAdapter()` — 프로덕션 동작 불변, `runCli`도 그대로).
- 가짜 reviewer는 **호출 횟수를 관찰 가능**하게 한다(exec/resume 카운터). phase-1은 legacy에서 그 카운터가
  **0**임을, phase-2는 정상 경로에서 실제 호출 후 `attempts` 보존을 단언한다.

이 주입은 `gitAdapter` 선례가 있는 **최소 변경**이며, 026 observation이 "후속 리팩터 후보"로 미뤘던 것을
r01·r02 P1이 **A-1에서 필요**함을 보였다 — legacy fail-closed와 attempt 계수 정확성이 A-1의 유일한
산출물인데, 그 두 배선을 main 경로에서 증명하지 못하면 A-1이 약속을 못 지킨다.

#### 호출 전 `state.json` 쓰기는 post-call D10에 걸리지 않는다 (026 지적 ⑦ — 실측)

026 리뷰가 "호출 전 `writeState`가 post-call `postDirty`에 걸려 정상 리뷰가 매번 죽는다"고 지적했으나
**실측 반박됐다.** `state.json`은 이미 SCRATCH 허용 목록에 있다(`lib/scratch.ts:34`가 `${dir}/state.json`
반환). `findUnstagedOrUntracked`의 첫 분기 `allowed.has(e.path)`가 먼저 걸러낸다.

**실측**: 티켓 `state.json`을 `MM`(staged+worktree modified)으로 만들고 `req:doctor` → `OK D10: 클린` ·
`PASS`. 바이트 동일 원복. 기준선의 `writeState`가 원래 리뷰 흐름 중 `state.json`을 갱신하므로 그 경로가
스크래치로 열려 있다. **단 `state.json` 외 tracked 파일을 쓰면 여전히 검출된다** — `withAttemptRecorded`는
`state.json` 외 어떤 tracked 파일도 건드리지 않는다.

#### R10 초기화 불가

`--fresh-thread`는 `blocked_review` 마커만 초기화(기존 회복 의미 보존). **`review_series`에는 손대지
않는다.** hash·archive round는 series 판정 입력이 아니므로 그것들로도 초기화되지 않는다.

## Phase별 구현

| phase | 범위 | 변경 파일 |
|---|---|---|
| `phase-1-model-version-and-legacy` | **reviewer 주입 seam**(테스트 인프라) + D1 — `review_series_model_version`·legacy 2경로(`resolveNext`+호출 지점, **호출 0회 검증**) | `req-new.ts`·`review-codex.ts`·`req-next.ts`·테스트 |
| `phase-2-series-record-and-attempt` | D2·D3 — series 레코드·`approved` 종료·`withAttemptRecorded`·반환 state handoff(near-e2e) | `review-codex.ts`·테스트 |

**reviewer 주입 seam은 phase-1의 첫 작업**이다(design-r02 P1). legacy fail-closed(R2)를 "외부 호출 0회"로
증명하려면 phase-1부터 seam이 있어야 한다. seam은 계수와 무관한 순수 테스트 인프라라 D1 앞에 둘 수 있다.

**phase 순서 = legacy guard 먼저** (design-r01 P1). 앞선 초안은 "계수 먼저"라며 D3 배선을 phase-1에 뒀는데,
**그러면 phase-1만 병합된 중간 상태에서 legacy 티켓이 R2를 위반한다**: 모델 버전 없는 기존 ticket이
`req:next`의 RUN 안내를 따라 리뷰를 실행하면 `withAttemptRecorded`가 state를 쓰고 외부 호출까지 한다
(AWAIT_HUMAN·throw·state 무변경 전부 깨짐).

그리고 D1은 **레코드 유무가 아니라 생성 시 모델 버전**으로 판정하므로(§D1), "계수가 먼저 있어야 legacy가
물을 대상이 생긴다"는 의존성은 **애초에 성립하지 않는다.** legacy는 `review_series_model_version` 필드만
보면 되고 그 필드는 D1이 만든다. 따라서 **D1(legacy guard)이 phase-1이고, D2·D3(계수·배선)이 phase-2**다.
각 phase는 병합돼도 안전한 상태여야 한다 — legacy 보호가 attempt 기록보다 먼저 main에 있어야 한다.

## 변경 파일

- `scripts/req/req-new.ts` — `review_series_model_version: 1` 스캐폴드(**p1**)
- `scripts/req/req-next.ts` — legacy `AWAIT_HUMAN` 분기 + `NextInput.reviewSeriesModelVersion`(**p1**)
- `scripts/req/review-codex.ts` — legacy 호출 지점 throw(**p1**) · `SeriesRecord`·series 해소·`approved`
  종료·`withAttemptRecorded`·반환 state handoff·**reviewer 주입 seam**(`let` + `main` 선택 인자)(**p2**)
- `tests/unit/req-new.test.ts` · `req-next.test.ts` · `req-review-codex.test.ts` — 오라클

## 하위호환·안전

- **`machine.schema.json` 무변경** → 기존 v1.1 archive 검증·legacy evidence 그대로. state 스키마와 도구
  동작만 바꾼다.
- **G1·G2·`classifyReview`·승인 바인딩·BLOCKED/INVALID/D9 무변경**(R12). legacy `AWAIT_HUMAN`은 `resolveNext`에
  **추가**이며 기존 분기를 바꾸지 않는다 — `commit_allowed` 우선, 그 다음 legacy, 그 다음 기존 design/phase.
- **legacy ticket 무침습**(R2) — 일괄 스캔·마이그레이션·자동 reset 없음. 지연 판정만.
- **`--fresh-thread` 회복 의미 보존** — `blocked_review` 초기화는 그대로, series는 안 건드린다.
- **A-1은 아무것도 막지 않는다**(R11). attempt는 늘기만 하고 어떤 값에서도 리뷰를 거부하지 않는다.
  예산·상한·escalation·차단은 A-2다. `SeriesRecord.closed_reason` 타입을 열린 확장으로 둬서 A-2가
  `'human-resolution'`을 더하기 쉽게 한다.
- **단일 활성 worktree 전제**(R13). state.json 동시 쓰기 경합·lock·CAS 미구현.
- 이 REQ는 **additive**다. 완료 시 A-2를 기다리지 않고 단독 병합한다. A-1만으로는 상한이 없지만,
  계수 모델이 정확하다는 것 자체가 회귀 방지 가치가 있고 A-2의 안전한 토대가 된다.
