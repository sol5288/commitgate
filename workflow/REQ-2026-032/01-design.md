# REQ-2026-032 설계 — design delta review (B-2)

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

- **`assembleReviewPrompt`(`review-codex.ts:114`)** — 순수. design kind일 때 `# 권위 아티팩트 = 설계 문서
  00/01/02` 블록에 세 문서 본문을 **통짜로** 임베드(`:138-150`). persona는 맨 앞 블록(`:120`). 파일을 안 읽는다.
- **`ReviewPromptInput`(`:88` 부근)** — `persona?·designDocs?·stagedDiff?·reviewKind?` 등. delta 표시를 위한
  입력이 없다 → **optional `designDelta?` 추가**.
- **`loadReviewPersona`(`:180`)** — base persona 본문 로드(fail-closed). delta 계약은 여기서 안 읽는다 —
  **코드 상수**로 append(아래 D4).
- **`reviewPolicyVersion`(`:466`)** — `sha256(persona 본문).slice(0,12)`. persona에 delta 계약을 append하면
  자동으로 다른 policy_version이 나온다(수동 상수 bump 불필요 — 기존 설계 철학과 동일).
- **`captureDesignDocBlobs`(B-1)·`hasDesignBaseline`(B-1)·`state.design_baseline`(B-1)** — B-2가 처음 읽는다.
- **`main()` design 분기(`:1737-1742`, `:1761` 프롬프트 조립)** — `designDocs`·`designDocBlobs`(현재 인덱스)를
  이미 뽑는다. 여기에 baseline과의 delta 계산 + persona 증강 + `designDelta` 전달을 얹는다.
- **`captureDesignBinding.designHash`(`:238`)·`processResponse` 승인 판정(`:1182`)** — **전혀 안 건드린다**(R5).

## 핵심 설계 결정

### D1. 문서별 OID diff (R1)

**`computeDesignDelta(baseline, current): { changed: DesignDocKey[]; unchanged: DesignDocKey[] }`(순수)**:
`DesignDocKey = 'requirement' | 'design' | 'plan'`. 세 키를 각각 `baseline[k] === current[k]`로 비교 —
다르면 changed, 같으면 unchanged. **키별 비교**(위치·순서 무관). 결정적 키 순서(requirement→design→plan)로
반환. baseline·current는 `DesignDocBlobs`(B-1 타입 재사용).

### D2. delta 게이트 (R2)

`main()` design 분기에서: `hasDesignBaseline(state)`가 true면 **delta 모드**, 아니면 **full 모드**.
- delta 모드: `current = captureDesignDocBlobs(...)`(이미 `:1742`에서 뽑음) → `computeDesignDelta(state.design_baseline, current)`
  → `designDelta = { changed, unchanged }`를 프롬프트에 전달 + persona 증강.
- full 모드: `designDelta = undefined`, persona 무증강 → `assembleReviewPrompt`가 **기존 경로** 그대로
  (바이트 동일, R7·인수기준 4).

baseline이 있으면 항상 delta 모드다(baseline은 직전 승인의 산물이므로, 이후 design 리뷰는 정의상 재리뷰).
변경 문서가 0개인 경우(모두 baseline과 동일)도 delta 모드 — 모두 `[승인 baseline]`으로 표시되고 계약이
"변경 없음"을 알린다(리뷰어가 재승인). 이건 정상적인 degenerate 케이스다.

### D3. 변경 표시 authority 블록 (R3)

`assembleReviewPrompt`에 optional `designDelta?: { changed: DesignDocKey[]; unchanged: DesignDocKey[] }` 입력
추가. design kind + `designDelta` 있으면 authority 블록을 **문서별 표시** 형태로 렌더:

```
---
# 권위 아티팩트 = 설계 문서 00/01/02 (delta review — 변경분 심사)
## 00-requirement.md [변경됨 — 심사 대상]        ← 또는 [승인 baseline — 변경 없음, 참조]
<본문>
## 01-design.md [승인 baseline — 변경 없음, 참조]
<본문>
## 02-plan.md [변경됨 — 심사 대상]
<본문>
```

- **세 문서 본문 모두 포함**(미변경도 full) — B-3 전까지 문맥 보존(R6). 표시만 다르다.
- `designDelta` 없으면(full 모드) **기존 블록 문자열 그대로**(R7) — 분기는 `designDelta` 유무로만.
- 표시 문자열은 코드 상수(`DELTA_CHANGED_TAG`·`DELTA_BASELINE_TAG`)로 — 오라클이 정확히 고정.

### D4. design-delta persona 계약 (R4)

**코드 상수 `DESIGN_DELTA_CONTRACT`**(persona 증강 블록):
```
# Delta Review 계약
- 아래 설계 문서 중 [변경됨 — 심사 대상]으로 표시된 문서·섹션과 그 **직접 영향 범위**만 심사한다.
- [승인 baseline — 변경 없음, 참조]은 직전 라운드에 **승인**되었다. 재심사·재litigate 금지 —
  참조 문맥으로만 쓴다.
- 단, 이번 변경이 승인된 영역의 재고를 **강제**한다면(모순·전제 붕괴 등), 그것을 finding으로 명확히 밝혀라.
```

`main()` delta 모드 persona 증강:
```ts
const deltaPersona = base ? `${base}\n${DESIGN_DELTA_CONTRACT}` : DESIGN_DELTA_CONTRACT
```

🔴 **null base persona 정책(design-r01 P1)**: `reviewPersonaPath: null`은 **지원·문서화된** 설정이다 —
`loadReviewPersona`가 정상적으로 `null`을 반환한다(오설정 fail-closed와 구분: 경로가 있는데 부재·빈내용·root밖
symlink일 때만 throw). 따라서 base가 null일 수 있고, 그때 delta 모드는 **`DESIGN_DELTA_CONTRACT`를 단독
persona로** 쓴다(delta 계약 자체가 리뷰 품질 계약이다). base가 있으면 `base + '\n' + contract`. **양쪽 모두
delta 모드는 delta 계약을 보낸다** — null 계약 우회 없음. `reviewPersonaPath: null`의 기존 동작(full 모드에서
persona 없음, `policy_version='none'`)은 **안 깨진다**: delta 모드에서만 계약이 붙는다.

🔴 **effective persona 단일화(design-r02 P1)**: `main()`은 **전송 persona 하나**(`effectivePersona`)를
`assembleReviewPrompt`(프롬프트)와 `reviewPolicyVersion(...)`(review-call 로그, `:1920`) **양쪽에** 쓴다.
프롬프트에만 deltaPersona를 넘기고 로그는 옛 `persona`를 유지하면, base 있는 delta `--run`이 full과 **같은
policy_version**을 기록해 R4를 위반한다. 그래서 delta 모드에서 `persona`(또는 `effectivePersona`)를
deltaPersona로 확정한 뒤 그 하나를 downstream 전부(프롬프트·로그)에 흘린다 — 발산 지점 없음.

`reviewPolicyVersion(effectivePersona)`가 증강된 persona를 해싱하므로 delta/full이 로그에서 자동 구분된다 —
base 있으면 `hash(base+contract)`, base null이면 `hash(contract)`(둘 다 full 모드의 값과 다르다: base 있는
full=`hash(base)`, null full=`'none'`).

### D5. 바인딩·승인 의미 무변경 (R5·R6)

`captureDesignBinding.designHash`는 여전히 full 현재 00/01/02를 바인딩한다. delta는 `assembleReviewPrompt`가
**보내는 내용**만 바꾼다 — `designHash`·`processResponse`·`applyVerdict`·`design_approved_hash`·B-1 baseline
저장 전부 무변경. 승인은 계속 "full 현재 설계 승인"을 의미한다. 리뷰어가 delta만 보고 승인하는 gap의 안전판
(`FULL_REVIEW_REQUESTED`)은 B-3 — B-2는 미변경 문서를 참조로 포함해 gap을 최소화한다.

## Phase별 구현

단일 phase — delta 감지(순수) + 프롬프트 표시 + persona 증강 + 게이트 배선이 한 덩어리로 작다.

| phase | 범위 | 변경 파일 |
|---|---|---|
| `phase-1-delta-prompt` | D1~D5 — `computeDesignDelta`·`DESIGN_DELTA_CONTRACT`·`assembleReviewPrompt` delta 렌더·`main()` 게이트+persona 증강 | `review-codex.ts`·테스트 |

## 변경 파일

- `scripts/req/review-codex.ts` — `DesignDocKey` 타입 · `computeDesignDelta`(순수) · `DESIGN_DELTA_CONTRACT`·
  `DELTA_CHANGED_TAG`·`DELTA_BASELINE_TAG` 상수 · `ReviewPromptInput.designDelta` · `assembleReviewPrompt`
  delta 렌더 분기 · `main()` delta 게이트 + persona 증강 + `designDelta` 전달
- `tests/unit/req-review-codex.test.ts` — 오라클

**`req-commit.ts`·`machine.schema.json` 무변경**(R5·R7).

## 하위호환·안전

- **full 모드 무회귀**(R7·인수기준 4): baseline 없으면 `designDelta=undefined`·persona 무증강 →
  `assembleReviewPrompt`가 기존 코드 경로. 바이트 동일. 오라클로 고정.
- **바인딩·승인 무변경**(R5): delta는 전송 내용만. designHash·승인 판정·baseline 저장 그대로.
- **legacy 무침습**: `hasDesignBaseline` false(B-1 이전 승인)면 full 모드 — 소급 영향 없음.
- 이 REQ는 **additive**다. B-3을 기다리지 않고 단독 병합한다. 미변경 문서를 참조로 포함하므로 문맥
  무손실이라 단독으로 안전(B-1이 "저장만"이었던 것과 같은 구조).
