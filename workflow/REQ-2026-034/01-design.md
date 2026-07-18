# REQ-2026-034 설계 — design-delta persona 계약 (B-2b)

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

- **`main()` persona 로드(`review-codex.ts:1751`)** — `const persona = loadReviewPersona(cfg.reviewPersonaPathAbs, cfg.root)`.
  현재 이 `persona`(base)를 `assembleReviewPrompt`와 `reviewPolicyVersion` **양쪽**에 그대로 쓴다.
- **`assembleReviewPrompt` 호출(`:1761` 부근)** — B-2a가 `designDelta`를 넘긴다. persona 인자는 아직 base.
- **review-call 로그(`:1920`)** — `policyVersion: reviewPolicyVersion(persona)`. base persona 해시.
- **`designDelta`(B-2a, `:1794`)** — `design + hasDesignBaseline`일 때만 설정(phase·full은 undefined). **이게
  계약 적용의 게이트다** — 계약은 `designDelta` 유무에 올라탄다(kind 격리·baseline 게이트를 재사용).
- **`DELTA_CHANGED_TAG`·`DELTA_BASELINE_TAG`(B-2a)** — 계약이 참조할 태그 상수.
- **`reviewPolicyVersion`(`:466`)** — `persona===null ? 'none' : sha256(persona).slice(0,12)`. effective persona를
  주면 base 있는 delta=`hash(base+계약)`, null delta=`hash(계약)`, full=base 그대로.
- **`assembleReviewPrompt`·`computeDesignDelta`·B-2a 태그 렌더·바인딩·`processResponse`** — **무변경**(R7).

## 핵심 설계 결정

### D1. `DESIGN_DELTA_CONTRACT` 상수 (R1)

코드 상수. 태그 문구는 **상수 참조**(하드코딩 금지 — 태그 바뀌면 계약 자동 반영, drift 방지):
```ts
export const DESIGN_DELTA_CONTRACT = [
  '# Delta Review 계약',
  `- ${DELTA_CHANGED_TAG} 표시 문서·섹션과 그 직접 영향 범위만 심사한다.`,
  `- ${DELTA_BASELINE_TAG}은 직전 라운드에 승인되었다. 재심사·재litigate 금지 — 참조 문맥으로만 쓴다.`,
  '- 단, 이번 변경이 승인 영역의 재고를 강제하면(모순·전제 붕괴) finding으로 명확히 밝혀라.',
].join('\n')
```
persona는 프롬프트 첫 블록이고 태그는 뒤 authority 블록에 나온다 — 계약이 "아래 [변경됨] 문서"를 가리키는
구조라 순서상 정합(리뷰어가 역할→대상 순으로 읽음).

### D2. `applyDeltaPersona`(순수) (R2·R4)

```ts
export function applyDeltaPersona(base: string | null, deltaActive: boolean): string | null {
  if (!deltaActive) return base                                   // full·phase: base 그대로(null이면 null)
  return base ? `${base}\n${DESIGN_DELTA_CONTRACT}` : DESIGN_DELTA_CONTRACT  // delta: base+계약 / null→계약 단독
}
```
🔴 **null base 정책**(R4): `reviewPersonaPath:null`은 지원 설정(loadReviewPersona가 정상 null 반환 — 오설정
fail-closed와 구분). delta면 계약 단독, full이면 null 그대로.

### D3. 단일 effective persona 배선 (R3) — 032 r02·r03 정면 해소

`main()`에서 `designDelta`가 확정된 뒤(B-2a 게이트 직후), **effective persona 하나**를 만들어 downstream
전부에 흘린다:
```ts
const effectivePersona = applyDeltaPersona(persona, designDelta !== undefined)
// assembleReviewPrompt({ persona: effectivePersona, ... })   ← 전송 프롬프트
// reviewPolicyVersion(effectivePersona)                       ← review-call 로그 policy_version
```
🔴 base persona(`:1751`)를 직접 쓰던 **두 지점(프롬프트·로그)을 모두 effectivePersona로 교체**한다. 발산
지점 없음 — 프롬프트에 계약을 넣으면 로그 policy_version도 같은 계약을 반영한다.

### D4. kind 격리 — 계약은 designDelta에 올라탄다 (R5)

`deltaActive = designDelta !== undefined`. `designDelta`는 B-2a에서 **design + baseline**일 때만 설정된다
(`opts.kind==='design'` 분기 내부, phase는 구조적 제외). 따라서:
- **phase 리뷰**: `designDelta` undefined → `effectivePersona = base` → 계약 없음, policy_version=base.
- **full design(baseline 없음)**: `designDelta` undefined → 계약 없음, policy_version=base(null이면 'none').
- **delta design(baseline 있음)**: `designDelta` 설정 → 계약 붙음.

새 kind 검사를 추가하지 않는다 — B-2a 게이트를 재사용해 격리가 구조적으로 성립(032 r06-2의 "kind 검사 밖
적용" 실수를 원천 차단).

### D5. 사용자 문서 계약 (R6) — 032 r06-3

`reviewPersonaPath:null`의 사용자 계약을 갱신한다(full 비활성은 유지, delta는 내장 계약 주입 명시):
- `README.md:120`·`:497` / `README.en.md:120`·`:497`: null 설명에 "delta design 리뷰는 내장 delta 계약을 주입" 추가.
- `docs/ssot-design/02-repository-and-runtime.md:132`: `reviewPersonaPath` 표 설명 동일 갱신.

## Phase별 구현

단일 phase — 상수 + 순수 함수 + main 2지점 배선 + 문서. persona 표면만이라 작다(032를 이걸로 쪼갠 이유).

| phase | 범위 | 변경 파일 |
|---|---|---|
| `phase-1-delta-persona` | D1~D5 — `DESIGN_DELTA_CONTRACT`·`applyDeltaPersona`·main effectivePersona 배선(프롬프트+로그)·사용자 문서 | `review-codex.ts`·테스트·README·README.en·SSOT |

## 변경 파일

- `scripts/req/review-codex.ts` — `DESIGN_DELTA_CONTRACT` 상수 · `applyDeltaPersona`(순수) · `main()`
  effectivePersona 도입 + assembleReviewPrompt persona 인자·`reviewPolicyVersion` 입력을 effectivePersona로 교체
- `tests/unit/req-review-codex.test.ts` — 오라클
- `README.md`·`README.en.md`·`docs/ssot-design/02-repository-and-runtime.md` — null persona 계약 갱신

**`assembleReviewPrompt`·`computeDesignDelta`·B-2a 태그·`req-commit.ts`·`machine.schema.json` 무변경**(R7).

## 하위호환·안전

- **full·phase 무회귀**(R7·인수기준 5): `designDelta` undefined면 `effectivePersona=base` → 프롬프트·
  policy_version이 B-2b 이전과 바이트 동일. 오라클로 고정(하드코딩/독립 expected — 033 tautology 교훈).
- **null 설정 무회귀**(R4): full 모드 null은 여전히 persona 없음·`policy_version='none'`. delta에서만 계약.
- **B-2a 무변경**: 태그·감지·게이트 그대로. B-2b는 main이 넘기는 persona만 바꾼다.
- 이 REQ는 **additive**다. B-3을 기다리지 않고 단독 병합한다. delta 리뷰에 계약이 붙는 것 외 동작 불변.
