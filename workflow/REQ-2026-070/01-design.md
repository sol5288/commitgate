# REQ-2026-070 설계 — phase 리뷰 전 대상 검증

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

`scripts/req/review-codex.ts`

```ts
export function resolvePhaseTarget(state, kind, phaseOpt) {
  if (kind !== 'phase') return { ok: true, phaseId: null }
  const rawLen = Array.isArray(state.phases) ? state.phases.length : 0
  if (rawLen === 0) return { ok: true, phaseId: null }   // ← 레거시 취급. --phase 가 조용히 버려진다
  if (!phaseOpt) return { ok: false, … }
  …
}
```

**호출 순서 실측**: `resolvePhaseTarget`은 line 2174, `assertReviewerReady`(외부 호출 preflight)는 2309,
예산 게이트·원장 기록은 그 뒤다. 🔴 **이미 호출보다 앞이므로**, 이 함수에서 거부하면
"호출 전 차단·원장 미기록·예산 미차감"(수용기준 1·6)이 **자동으로** 충족된다 — 새 게이트를 만들 필요가 없다.

## 핵심 설계 결정

### DEC-1 — 🔴 `rawLen === 0`을 **레거시로 단정하지 않는다**

`req:new`는 **모든 새 티켓을 `phases: []`로 초기화**한다. 그래서 "빈 배열 = 레거시"는 거짓이고,
신규 티켓이 phase 분해 전에는 전부 레거시로 오인된다.

구별 신호는 `req:new`가 새 티켓에 찍는 **`review_series_model_version`**이다(REQ-2026-027 —
"기본 state는 새 모델 티켓이다, 첫 리뷰 전에도 stamp된다"). 레거시 판정은 이 **필드의 부재**로 한다.

### DEC-2 — 🔴 신규 모델 + 빈 `phases[]` + `--kind phase` = **거부**

그 조합은 **커밋 가능한 승인을 만들 수 없다.** 커밋 경로가 `validPhaseIds = readPhases(state)`로 검증하고
(review-codex.ts:2543), 매니페스트는 phase 행에 그 목록에 있는 `phase_id`를 요구한다(evidence.ts:396).
`phases[]`가 비면 `validPhaseIds`도 비어 **어떤 phase 행도 통과할 수 없다.**

즉 지금은 **호출은 나가고 돈은 쓰이고 승인은 쓸 수 없다.** 실측: REQ-2026-067에서 그렇게 1회를 버렸다.

### DEC-3 — 🔴 `--phase`는 **조용히 버려지지 않는다**

레거시 티켓이라도 `--phase`가 주어졌는데 반영할 수 없으면 **거부**한다.
사용자가 준 인자가 무시되면, 자기가 지정한 phase에 승인이 붙었다고 **잘못 믿는다**.

### DEC-4 — 메시지가 고칠 방법을 말한다

`phases[]`가 비었으면 "02-plan.md의 phase 분해를 `state.json`의 `phases[]`에 채운 뒤 다시 실행"까지
알려 준다. 지금 사용자가 보는 것은 커밋 시점의 `phase_id 비유효: null`이라 원인을 역추적해야 한다.

### DEC-5 — 판정은 **순수 함수 하나**에 머문다

`resolvePhaseTarget`의 시그니처·반환 형태를 바꾸지 않는다. 호출부(2175)는 이미
`if (!ok) throw`이므로 **배선 변경이 없다** — 변경 면적을 검증 가능한 최소로 둔다.

## Phase별 구현

`02-plan.md` 참조.

## 변경 파일

| 파일 | 변경 |
|---|---|
| `scripts/req/review-codex.ts` | `resolvePhaseTarget`의 레거시 판정·거부 규칙 |
| `tests/unit/req-review-codex.test.ts` | 신규/레거시 분기·`--phase` 무시 금지 |
| docs 한/영 · CHANGELOG | |

## 하위호환·안전

- 🔴 **레거시 티켓**(`review_series_model_version` 부재)의 phase 리뷰는 그대로 — `--phase` 없이 호출하면
  지금과 동일하게 `phaseId: null`로 진행한다.
- `phases[]`가 채워진 정상 경로 무변경.
- 거부는 호출·원장·예산보다 앞이라 부작용이 없다.
