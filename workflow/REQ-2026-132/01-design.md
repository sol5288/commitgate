# REQ-2026-132 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

`checkReviewBudget`(순수, `review-codex.ts`)이 세 판정을 낸다:

```
dispatched >= hardCap   → hard-blocked   (9회차 — 어떤 경로로도 차단)
productive <  autoBudget→ allow
그 외                    → needs-exception(6~8회차 — 사람 예외 필요)
```

`needs-exception`이면 호출 직전에 `consumeReviewException`이 `state.review_exception_confirmed`를
검증·소비하고, 없으면 **throw**한다. 그 승인은 `req:review-exception`이 기록한다.

원장(`review-ledger.ts`)은 `exception_consumed: boolean`을 **필수 키**로 담는다.
선택 키(`OPTIONAL_LEDGER_KEYS`)는 additive 확장을 위해 이미 분리돼 있다.

## 핵심 설계 결정

### DEC-1 — 축은 `reviewBudget.onSoftLimit` 하나, 기본 `ask`

```ts
export type SoftLimitPolicy = 'ask' | 'auto'
export interface ReviewBudget { autoBudget: number; hardCap: number; onSoftLimit: SoftLimitPolicy }
```

- config 미지정 = `ask` = **현행과 100% 동일**. 비용이 드는 축의 기본은 조용히 바꾸지 않는다.
- 🔴 `hardCap`은 이 축과 **무관**하다. `auto`는 "무한 재시도"가 아니라 "6~8회차의 사람 확인 생략"이다.

### DEC-1b — 기존 부분 설정의 이행 계약(**키별 병합** + 스키마 optional)

🔴 실측(설계 r01 P1-a): `loadConfig`는 `reviewBudget: raw.reviewBudget ?? DEFAULTS.reviewBudget` 로
**객체를 통째로 교체**하고, 스키마는 `required: ['autoBudget','hardCap']` + `additionalProperties: false` 다.
그래서 그냥 두면 기존 정상 설정 `{"reviewBudget":{"autoBudget":3,"hardCap":6}}` 이 두 방향 모두에서 깨진다:

| 방식 | 결과 |
|---|---|
| 새 키를 `required` 로 추가 | 그 설정이 **스키마에서 거부**된다(업그레이드가 기존 config를 깬다) |
| optional 로만 두고 병합을 안 고침 | `merged.reviewBudget.onSoftLimit === undefined` — "기본 `ask`"가 성립하지 않는다 |

그래서 **둘 다** 한다.

1. 스키마: `onSoftLimit` 을 `required` 에 넣지 **않고** `properties` 에만 추가한다(enum `['ask','auto']`).
2. 로더: 객체 교체를 **키별 병합**으로 바꾼다.

```ts
reviewBudget: { ...DEFAULTS.reviewBudget, ...(raw.reviewBudget ?? {}) }
```

🔴 이 병합은 `autoBudget`·`hardCap` 에도 적용되지만 **동작은 바뀌지 않는다** — 스키마가 그 둘을 여전히
required 로 요구하므로, `raw.reviewBudget` 이 있으면 두 값은 항상 존재한다. 바뀌는 것은 **새 키가
기본값으로 채워진다**는 것뿐이다. 이 무회귀를 테스트로 고정한다(부분 설정 → `ask`).

**왜 새 값이 아니라 새 키인가**: `autoBudget: 8`로 올리면 같은 효과를 낼 수 있어 보이지만 다르다 —
그러면 **왜 6회차가 나갔는지가 기록에서 사라진다**(그냥 예산 안이었다고 남는다). 정책으로 통과한 사실은
"예산 안이었다"와 구별돼야 감사에서 의미가 있다.

### DEC-2 — 판정에 정책을 넣되 **결과 종류를 늘린다**

```ts
export type BudgetDecision =
  | { kind: 'allow' }
  | { kind: 'needs-exception'; attempt: number }
  | { kind: 'soft-auto'; attempt: number }   // 신설
  | { kind: 'hard-blocked'; attempt: number }
```

`checkReviewBudget(counts, budget)`에서 소프트 초과 시 `budget.onSoftLimit === 'auto'`면 `soft-auto`.

🔴 **`allow`로 뭉치지 않는다.** 뭉치면 호출부가 "예산 안이었다"와 "정책으로 통과했다"를 구별하지 못해
원장에 사실을 남길 수 없다. 판정 종류가 곧 기록의 근거다.

### DEC-3 — 원장에 **정책 근거**를 남긴다(additive optional 키)

```ts
/** 소프트 예산 초과를 무엇으로 통과했는가. 부재 = 이 필드 이전의 옛 행. */
soft_limit_resolution?: 'exception' | 'policy' | null
```

- `needs-exception` 소비 → `'exception'`(기존 `exception_consumed: true`와 함께 — 그 키는 **그대로 둔다**).
- `soft-auto` → `'policy'`. 이때 `exception_consumed`는 **`false`**다(사람 승인은 없었으므로).
- 그 외 → `null`.

🔴 **`exception_consumed`의 의미를 바꾸지 않는다.** 그 키는 "사람 예외를 소비했는가"이고, `auto`에서는
거짓이다. 의미를 넓혀 `true`로 쓰면 **정책 통과가 사람 승인으로 위장**된다 — 그것이 이 REQ가 가장
피해야 할 결과다.
🔴 `OPTIONAL_LEDGER_KEYS`에 넣는다 — 필수로 넣으면 이미 커밋된 모든 원장 행이 거부되고 D5 fail-closed가
그 티켓의 리뷰를 전부 막는다(REQ-2026-064가 실제로 겪었다).
🔴 값 검증은 **일반 string이 아니라 열거**로 한다(`null | 'exception' | 'policy'`, 설계 r01 observation).
감사 필드의 의미가 제한돼 있으므로, 임의 문자열을 통과시키면 손상 행이 정상으로 위장한다.

### DEC-4 — `req:next` 안내가 정책을 반영한다

현재 예산 소진 시 `AWAIT_HUMAN`("사람 결정이 필요하다")을 낸다. `auto`면 그 정지는 **존재하지 않으므로**
안내도 내면 안 된다 — 화면과 동작이 갈라진다(REQ-2026-071 phase-4 r01에서 같은 종류의 P1을 받았다).

🔴 실측(설계 r01 P1-b): 같은 함수를 쓰는 것만으로는 **부족하다.** 현재 호출부는

```ts
if (budgetDecision.kind !== 'allow') { …AWAIT_HUMAN… }   // req-next.ts
```

라서 새 `soft-auto`도 그 가지에 빨려 들어간다. 그래서 **소비 계약을 명시적으로 바꾼다**:
`allow`와 `soft-auto`는 **진행 가능**이고, `needs-exception`·`hard-blocked`만 정지다.

```ts
if (budgetDecision.kind === 'needs-exception' || budgetDecision.kind === 'hard-blocked') { …AWAIT_HUMAN… }
```

🔴 "진행 가능 집합"으로 적는다 — `!== 'allow'`처럼 **부정으로 적으면 판정 종류가 늘 때마다 조용히
정지 쪽에 붙는다.** 이번이 정확히 그 사례다.

### DEC-4b — `req:review-exception`은 `soft-auto`에서 **예외를 부여하지 않는다**

🔴 실측(설계 r01 P1-c): `planReviewException`은 `allow`·`hard-blocked`만 거부하므로, `auto` 설정에서
사용자가 `req:review-exception --run`을 실행하면 **사람 예외 기록이 만들어진다.** 그러면 `auto`가
"사람 승인을 만들지 않는다"는 요구를 도구 스스로 위반한다.

`soft-auto`도 거부한다. 사유를 정확히 말한다 — "이 설정(`onSoftLimit: "auto"`)에서는 6~8회차가 사람
승인 없이 진행되므로 부여할 예외가 없습니다. 사람 승인을 요구하려면 `ask`로 바꾸세요."

### DEC-5 — 자동 에스컬레이션 사다리는 **넣지 않는다**

초안 검토에서 "fresh-thread → full review → effort 상향 → phase 재분할"을 자동화하는 안이 있었으나
이 REQ에 넣지 않는다.

- `--fresh-thread`는 **BLOCKED 회복용 1회**로 계약에 이미 규정돼 있다. 그것을 예산 축에서 자동 발동하면
  두 규칙이 같은 플래그를 다르게 쓴다.
- resume·세션 유지 재리뷰는 REQ-2026-045에서 **감사 붕괴·drift 재발**을 이유로 확정 제외됐다.
- 무엇이 수렴을 돕는지는 측정된 바 없다(REQ-2026-045의 태깅도 잠정이다). 근거 없이 자동 조치를 넣으면
  "왜 이렇게 돌았는가"가 더 불투명해진다.

이 REQ는 **정지를 설정 가능하게** 만드는 데 그친다. 사다리는 데이터가 쌓인 뒤 별도 REQ의 결정이다.

## Phase별 구현

- **phase-1**: 타입·config·스키마(`onSoftLimit`) + `checkReviewBudget`의 `soft-auto` + 호출부 배선 +
  원장 optional 키 + 테스트.
- **phase-2**: 문서(`docs/configuration*.md`·`docs/workflow*.md` 해당 절) + `CHANGELOG.md`.

## 변경 파일

| phase | 파일 |
|---|---|
| 1 | `scripts/req/lib/config.ts` · `workflow/req.config.schema.json` · `scripts/req/review-codex.ts` · `scripts/req/lib/review-ledger.ts` · `scripts/req/req-next.ts`(해당 시) · `tests/unit/*` |
| 2 | `docs/configuration.md`/`.en` · `docs/workflow.md`/`.en` · `CHANGELOG.md` |

## 하위호환·안전

- config 미지정 → `ask` → **현행 동작 그대로**(테스트로 고정).
- 옛 원장 행(`soft_limit_resolution` 부재) → 그대로 유효(optional 키).
- `hardCap` 차단은 두 값 모두에서 동일 — 이 REQ는 절대 상한을 건드리지 않는다.
- 보증 범위: `auto`는 **비용 통제 정지를 끄는 것**이지 안전 게이트를 끄는 것이 아니다.
  리뷰 승인·증거·통합 통제점은 전부 그대로다. 과잉 약속하지 않는다.
