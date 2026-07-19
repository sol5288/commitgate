# REQ-2026-043 설계 — review-call 로그에 리뷰 모델·effort 기록

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

- **로그 행 타입** `ReviewCallLogRow`([review-codex.ts:564-575](../../scripts/req/review-codex.ts#L564)) — 9필드(`ticket_id`·`review_kind`·`phase_id`·`archive_round`·`outcome`·`findings_count`·`observations_count`·`timestamp`·`policy_version`). **모델 필드 없음.** `policy_version`은 persona 해시([review-codex.ts:558](../../scripts/req/review-codex.ts#L558))라 모델과 무관.
- **순수 빌더** `buildReviewCallLogRow(args)`([review-codex.ts:585-606](../../scripts/req/review-codex.ts#L585)) — verdict에서 **개수만** 꺼내 행을 만든다(내용 배제 경계 R7). 여기가 확장 지점.
- **append** `appendReviewCallLog`([review-codex.ts:614-622](../../scripts/req/review-codex.ts#L614)) — 실패를 삼킨다(R8, 측정≠게이트). 경로 `REVIEW_CALL_LOG_REL='workflow/.review-calls.jsonl'`([:549](../../scripts/req/review-codex.ts#L549))는 **`.gitignore` 등재**([.gitignore:16](../../.gitignore#L16)) → 커밋 대상 아님. **무변경.**
- **호출 지점**([review-codex.ts:2018-2030](../../scripts/req/review-codex.ts#L2018)) — `main()` 안. 여기서 `cfg`가 스코프에 있다(바로 위 `cfg.root` 사용). 즉 `cfg.reviewModel`·`cfg.reviewReasoningEffort` 접근 가능.
- **모델 원천 = 해소된 config**. `ResolvedConfig.reviewModel: string|null`·`reviewReasoningEffort: ReviewReasoningEffort|null`([config.ts:80-81](../../scripts/req/lib/config.ts#L80)). 이 값이 어댑터로 흘러가 codex `-c`를 만든다: 호출 [review-codex.ts:1942-1943](../../scripts/req/review-codex.ts#L1942) → review 파라미터 [:1760-1761](../../scripts/req/review-codex.ts#L1760) → override 조립 [adapters.ts:189-191](../../scripts/req/lib/adapters.ts#L189)(`if (model) push('-c', model="…")`; null이면 생략=전역 상속).
- **DEFAULTS** = `gpt-5.6-terra`/`high`([config.ts:129-130](../../scripts/req/lib/config.ts#L129)). config가 키를 생략하면 이 값으로 해소, **명시적 `null`이면 null 유지**(미핀).
- **테스트** [tests/unit/req-review-codex.test.ts](../../tests/unit/req-review-codex.test.ts) — `buildReviewCallLogRow`/로그 행 커버리지 존재. **확장 대상.**

## 핵심 설계 결정

### D1. `ReviewCallLogRow`에 두 필드 추가

```ts
review_model: string | null            // commitgate가 이 리뷰에 핀한 모델. null=미핀(전역 상속)
review_reasoning_effort: string | null // 동일. null=미핀
```

- 기존 필드와 동일한 snake_case. `policy_version` 뒤에 배치(측정 메타 그룹).
- 타입은 `ResolvedConfig`의 그것과 일치(`string|null`). effort는 `ReviewReasoningEffort|null`이나 로그 직렬화는 `string|null`로 넓혀 담아도 무손실(값은 enum 문자열).

### D2. 값 원천 = 해소된 config (codex에 흘러가는 그 값, 단일 배선)

`buildReviewCallLogRow` args에 `reviewModel`·`reviewReasoningEffort` 추가 → 필드에 그대로 대입(순수 유지). 호출 지점은 `cfg.reviewModel`·`cfg.reviewReasoningEffort`를 넘긴다.

- **왜 codex stdout이 아니라 config인가**: `policy_version`이 "전송 persona와 동일 배선"([:2028](../../scripts/req/review-codex.ts#L2028))인 것과 같은 원칙 — commitgate가 **실제 codex에 전달한 결정값**을 기록한다. codex `--json` 이벤트에서 실행 모델을 파싱하는 것은 형식 결합·미핀 케이스 복잡도라 **비목표**(00 참조).
- **정직성**: 핀(비-null) → codex가 강제받은 정확한 값. 미핀(null) → "commitgate 미핀"이라는 사실만 기록(실제 상속 모델은 주장 안 함). 두 경우 모두 참.

### D3. null 기록의 감사 가치

미핀 저장소에서 이 필드는 `null`로 남는다 — 이것이 곧 **"이 리뷰는 모델이 핀되지 않았다"**는 관측 신호이며, 애초 감사에서 드러난 갭 그 자체다. 현재는 필드가 아예 없어 핀/미핀을 구별조차 못 한다.

## Phase별 구현

- **Phase 1 (`phase-1-log-model-fields`)** — 단일 phase. `ReviewCallLogRow` + `buildReviewCallLogRow` + 호출 지점 + 테스트. TDD: 빌더가 두 필드를 담는 실패 테스트 먼저 → 필드/args 추가 → 그린.

## 변경 파일

- `scripts/req/review-codex.ts` — 타입 2필드 · 빌더 args 2개 · 호출 지점 cfg 2값 전달.
- `tests/unit/req-review-codex.test.ts` — 빌더 두 필드 assert(핀/미핀 두 케이스).
- (문서) `workflow/REQ-2026-043/00·01·02·codex-request`.

## 하위호환·안전

- **로그는 gitignore·측정 전용**: 커밋된 산출물이 아니므로 스키마 계약·원장 해시에 영향 0. 기존 행은 두 필드가 없지만 JSONL 로그에는 게이트가 의존하는 strict 리더가 없다 — 순수 additive.
- **게이트 불변**: `appendReviewCallLog`는 계속 fail-closed(실패 삼킴). exit code·state·승인 판정 경로 무변경. 측정 실패가 판정을 못 바꾼다(R8).
- **MANIFEST/approvals/state 무변경**: 원장·승인 증거·해싱 축을 건드리지 않아 하위호환 위험 없음.
- **주입 안전**: 값은 config에서 온 것으로 AJV 스키마 제약(model=BASENAME 패턴·effort=enum, [config.ts:153-155](../../scripts/req/lib/config.ts#L153))을 이미 통과. JSON 직렬화라 추가 escaping 불요.
