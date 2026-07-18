# REQ-2026-036 설계 — delta 미변경 문서 본문 생략 (B-3b)

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

- **`assembleReviewPrompt` delta 분기(`review-codex.ts:143~157`)** — B-2a가 delta 모드에서 문서별 태그를 붙이고
  **세 본문 모두 full로 포함**한다(`designDocs.requirement`·`.design`·`.plan`). B-3b가 미변경 문서 본문을
  placeholder로 대체.
- **`DELTA_CHANGED_TAG`·`DELTA_BASELINE_TAG`(B-2a)·`DESIGN_DELTA_CONTRACT`(B-2b)·`full_review_requested`(B-3a)**
  — 참조. `DELTA_OMITTED_BODY` 상수 신설(escalation 안내에 `full_review_requested` 언급).
- **`captureDesignBinding.designHash`·`processResponse`·B-2a 감지·B-2b 계약·B-3a escalation** — **무변경**(R4).
  생략은 `assembleReviewPrompt`가 보내는 본문만 줄인다.
- **테스트(cross-cutting)**: B-2a O1-4(순수 delta 렌더, "세 본문 존재")·B-2b `buildExpected`(near-e2e 전체
  본문 재조립) — 생략 반영으로 **갱신 대상**(R5).

## 핵심 설계 결정

### D1. `DELTA_OMITTED_BODY` 상수 (R2)

```ts
export const DELTA_OMITTED_BODY =
  '(본문 생략 — 승인 baseline·변경 없음. 전체가 필요하면 `full_review_requested: "yes"`로 full review를 요청하라.)'
```
생략 사실 + B-3a escalation 경로를 명시(생략이 문맥을 숨긴 위험의 안전판).

### D2. delta 렌더 — 미변경 본문 생략 (R1)

`assembleReviewPrompt`의 delta 분기에서 문서별 본문을 조건부로:
```ts
const tag = (k: DesignDocKey) => designDelta.changed.includes(k) ? DELTA_CHANGED_TAG : DELTA_BASELINE_TAG
const body = (k: DesignDocKey, content: string) =>
  designDelta.changed.includes(k) ? content : DELTA_OMITTED_BODY   // 변경=full, 미변경=생략
blocks.push([
  '---\n# 권위 아티팩트 = 설계 문서 00/01/02 (delta review — 변경분 심사)',
  `## 00-requirement.md ${tag('requirement')}`, body('requirement', designDocs.requirement),
  `## 01-design.md ${tag('design')}`,          body('design', designDocs.design),
  `## 02-plan.md ${tag('plan')}`,              body('plan', designDocs.plan),
].join('\n'))
```
헤더·태그 유지, 미변경 본문만 placeholder로. **변경 문서 본문은 full**(심사 대상). zero-change(모두 미변경)면
세 본문 다 생략 — degenerate지만 정상(재승인, 계약이 "변경 없음" 안내). full 분기(`else`)는 무변경.

### D3. 바인딩·gap·안전판 (R4)

`captureDesignBinding.designHash`는 여전히 full 현재 00/01/02를 바인딩한다. delta는 **전송 본문**만 줄인다 —
승인이 바인딩하는 대상(full 설계)은 무변경. 리뷰어가 변경분만 보고 승인해도 승인은 full 설계를 의미하고,
생략으로 문맥이 부족하면 **B-3a `full_review_requested=yes`로 full review를 요청**한다(안전판). 이 gap이
"리뷰 대상 = 바인딩 대상"을 약화하는 건 delta review의 의도된 트레이드오프이고, escalation이 상쇄한다.

### D4. cross-cutting 오라클 갱신 (R5) — 상위 REQ 불변식 변경

B-3b가 delta 렌더를 바꾸므로 **상위 REQ 테스트가 깨진다**(B-2b가 B-2a O1-9/O1-11을 깼던 것과 동형):
- **B-2a O1-4**(순수 delta 렌더): "세 본문 모두 존재" → **변경 본문 존재 + 미변경 본문 생략(placeholder)**로 갱신.
- **B-2b `buildExpected`**(near-e2e hand-built): 전체 본문 재조립 → **미변경 문서는 `DELTA_OMITTED_BODY`**로
  재조립하게 갱신(B-2b O1-3·O1-4 delta 경로가 이걸 씀).
이 갱신은 B-3b diff에 포함된다. **전체 스위트로 검증**(isolation은 cross-file 회귀를 놓친다 — 034 교훈).

## Phase별 구현

단일 phase — 상수 1개 + delta 렌더 조건부 본문 + cross-cutting 테스트 갱신. 작다.

| phase | 범위 | 변경 파일 |
|---|---|---|
| `phase-1-omit-unchanged` | D1~D4 — `DELTA_OMITTED_BODY`·delta 렌더 본문 생략·B-3b 오라클·B-2a/B-2b 오라클 갱신 | `review-codex.ts`·테스트 |

## 변경 파일

- `scripts/req/review-codex.ts` — `DELTA_OMITTED_BODY` 상수 · `assembleReviewPrompt` delta 분기 본문 조건부
- `tests/unit/req-review-codex.test.ts` — B-3b 오라클 + B-2a O1-4·B-2b buildExpected 갱신

**`captureDesignBinding`·`processResponse`·B-2a/B-2b/B-3a 로직·`req-commit.ts`·`machine.schema.json` 무변경**(R4).

## 하위호환·안전

- **full·phase 무회귀**(R3·인수기준 3): full 분기(`else`)·phase는 무변경 → 모든 본문 포함. 오라클로 고정.
- **바인딩 무변경**(R4): 생략은 전송 본문만. designHash·승인 판정·B-3a escalation 그대로.
- **안전판 존재**(B-3a): 생략으로 문맥이 부족하면 리뷰어가 full review 요청 → 이 REQ가 단독으로도 안전.
- 이 REQ는 **additive**다(delta 프롬프트 축소만). escalation 안전판 위에서 생략을 얹는 마지막 조각.
