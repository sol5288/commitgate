# REQ-2026-035 설계 — FULL_REVIEW_REQUESTED escalation (B-3a)

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

- **`machine.schema.json`** — `additionalProperties:false` + `required`. `full_review_requested`를 properties에
  추가(required엔 안 넣음 = optional). `deriveStrictOutputSchema`(adapters.ts:159)가 **root required=전체
  properties**로 파생하므로 codex 출력 스키마엔 자동 포함(매 응답 emit). 검증 SSOT(원본)는 optional로 남아
  구 archive 하위호환(observations 선례).
- **`Verdict` 인터페이스(`review-codex.ts:422`)** — `full_review_requested?: string` 추가.
- **`validateVerdict`(`:441`)** — 교차필드 규칙 블록(`:471~483`)에 full_review_requested 규칙 2개 추가.
- **`processResponse` design 분기(`:1182`~)** — `nextState` 계산 후 baseline 재설정 블록(B-1) 부근에서
  `full_review_requested="yes"`면 `delete nextState.design_baseline`.
- **`DESIGN_DELTA_CONTRACT`(B-2b, `review-codex.ts`)** — delta 프롬프트 persona 계약. escalation 지침 한 줄
  **추가**(아래 D1b). `applyDeltaPersona` **로직**·`hasDesignBaseline`·`computeDesignDelta`·`main()` delta
  게이트(B-2a) — **무변경**. baseline이 비면 게이트가 자연히 full을 고른다.

## 핵심 설계 결정

### D1. `full_review_requested` 신호 (R1)

`machine.schema.json` properties에 `"full_review_requested": { "type": "string", "enum": ["yes","no"] }` 추가.
**required 배열엔 넣지 않는다** → 검증 SSOT에선 optional(구 archive·이 필드 없는 응답도 통과). 출력 스키마는
`deriveStrictOutputSchema`가 required에 자동 포함 → codex는 매 응답 `"yes"`/`"no"` emit. 스키마 버전 1.1 유지
(optional 추가는 additive — observations와 동일 패턴). `Verdict.full_review_requested?: string` 추가.

### D1b. 🔴 escalation 지침 — 계약에 사용법 추가 (R2b) — design-r01 P1

신호(D1)만 추가하면 리뷰어가 **언제 yes를 쓸지** 모른다 — B-2b 계약은 재litigate 금지만 말한다. 따라서
`DESIGN_DELTA_CONTRACT`(delta 프롬프트 첫 블록)에 한 줄을 **추가**한다:
```
- 변경이 너무 근본적이어서 delta(변경분만)로 판단할 수 없으면 `full_review_requested: "yes"`로 응답해
  전체 설계 재리뷰를 요청하라(그때 `commit_approved: "no"`).
```
이로써 **정상 delta 경로**에 escalation 사용법이 실린다(delta 리뷰 프롬프트가 곧 이 계약을 포함 — B-2b). 계약
텍스트만 확장하고 `applyDeltaPersona`·prepend 위치·delta 게이트는 무변경. `policy_version`(persona 해시 파생)은
계약이 바뀌므로 자동으로 새 값이 된다(delta 리뷰 로그가 이전과 구분 — 정상).

### D2. 교차필드 검증 (R2)

`validateVerdict`에 규칙 2개:
```ts
if (v.full_review_requested === 'yes' && v.commit_approved !== 'no')
  errors.push('모순: full_review_requested=yes 인데 commit_approved≠no (full review 요청은 미승인이어야 함)')
if (v.full_review_requested === 'yes' && v.review_kind !== 'design')
  errors.push('모순: full_review_requested=yes 인데 review_kind≠design (delta/baseline은 design 전용)')
```
`"no"`·부재는 제약 없음(기존 동작). enum 자체는 AJV(스키마)가 강제 — validateVerdict는 교차필드만.

### D3. 🔴 full review 전환 — baseline 비움 (R3)

`processResponse`의 **design 분기**에서, `nextState` 확정 후:
```ts
if (verdict.full_review_requested === 'yes') {
  delete nextState.design_baseline   // 다음 design 리뷰가 hasDesignBaseline=false → full 모드(B-2a 게이트)
}
```
- `full_review_requested="yes"`는 R2로 `commit_approved="no"` → design 미승인 → baseline 재설정 분기(B-1,
  `nextState.design_approved===true`)를 **안 탄다**. 그래서 stateRest에서 온 기존 baseline을 명시적으로 지운다.
- **`main()`·게이트 무변경**: baseline 부재를 기존 `hasDesignBaseline`이 읽어 full 모드를 고른다. B-3a는
  전환을 **state로** 표현(코드 경로 신설 없음).
- ordinary NEEDS_FIX(full_review_requested≠yes)는 baseline을 **보존**한다(B-1 R2 — NEEDS_FIX 생존). 오직
  full_review_requested="yes"만 baseline을 리셋한다.

### D4. baseline 재개·사람 게이트 불필요 (R4·R5)

full review가 다음에 승인되면 B-1의 승인-시-baseline-저장이 현재 문서로 baseline을 **재설정**한다(무변경 재사용)
→ 이후 리뷰는 다시 delta. escalation = **1회 full 재리뷰 리셋**.

🔴 새 human control point 없음(R5): baseline 비움은 자동이고, full 모드는 **더 많은 문맥을 보낼 뿐**이라
안전하다. 승인(design/commit)의 기존 통제점은 그대로다. 리뷰어가 요청 → 다음 라운드 자동 full.

## Phase별 구현

단일 phase — 스키마 필드 + 검증 2줄 + processResponse 1블록. 작다(코드 경로 신설 없이 state로 전환).

| phase | 범위 | 변경 파일 |
|---|---|---|
| `phase-1-full-review-signal` | D1~D4 — 스키마 필드·`Verdict`·`DESIGN_DELTA_CONTRACT` escalation 지침·`validateVerdict` 2규칙·`processResponse` baseline 비움 | `machine.schema.json`·`review-codex.ts`·테스트 |

## 변경 파일

- `workflow/machine.schema.json` — optional `full_review_requested`(enum yes/no) 추가
- `scripts/req/review-codex.ts` — `Verdict.full_review_requested?` · `DESIGN_DELTA_CONTRACT` escalation 지침 한 줄 ·
  `validateVerdict` 2규칙 · `processResponse` design 분기 baseline 비움
- `tests/unit/req-review-codex.test.ts` — 오라클

**`main()`·`hasDesignBaseline`·`computeDesignDelta`·`applyDeltaPersona`·`req-commit.ts` 무변경**(R6).

## 하위호환·안전

- **무회귀**(R6·인수기준 5): `full_review_requested` 부재/`"no"`면 baseline 비움 블록을 안 타 B-3a 이전과
  동일. delta/full 게이트·태그·계약·바인딩 무변경. 구 archive는 optional이라 검증 통과.
- **derive 안전**: `deriveStrictOutputSchema`는 root required만 확장·severity만 좁힌다 — enum 필드 추가는
  그대로 통과. 출력 스키마에 required로 포함돼 codex가 emit.
- **전환은 state로**: baseline 비움만으로 full 전환 — `main()` 코드 경로 신설 없음(회귀 표면 최소).
- 이 REQ는 **additive**다. B-3b를 기다리지 않고 단독 병합한다. escalation 안전판이 먼저 서면 B-3b의 생략이
  그 위에서 안전해진다.
