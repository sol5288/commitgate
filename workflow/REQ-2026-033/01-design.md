# REQ-2026-033 설계 — design delta 감지·표시 (B-2a)

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

- **`assembleReviewPrompt`(`review-codex.ts:114`)** — 순수. design kind일 때 `# 권위 아티팩트 = 설계 문서
  00/01/02` 블록에 세 문서 본문을 **통짜로** 임베드(`:138-150`). persona는 맨 앞 블록(`:120`). 파일 안 읽음.
- **`ReviewPromptInput`(`:88` 부근)** — 문서별 표시 입력이 없다 → **optional `designDelta?` 추가**.
- **`captureDesignDocBlobs`·`hasDesignBaseline`·`state.design_baseline`(B-1)** — B-2a가 처음 읽는다.
- **`main()` design 분기(`:1737-1742`, `:1761` 조립)** — `designDocs`·`designDocBlobs`(현재 인덱스)를 이미
  뽑는다. 여기 baseline과의 delta 계산 + `designDelta` 전달을 얹는다. **persona는 안 건드린다.**
- **`persona`(`:1704`)·`reviewPolicyVersion(persona)`(`:1920` 로그)·`captureDesignBinding`·`processResponse`
  승인 판정** — **전혀 안 건드린다**(R4·R5). ← 이게 B-2/032 비수렴의 복잡도 근원이라 B-2a에서 배제.

## 핵심 설계 결정

### D1. 문서별 OID diff (R1)

**`computeDesignDelta(baseline, current): { changed: DesignDocKey[]; unchanged: DesignDocKey[] }`(순수)**:
`DesignDocKey = 'requirement' | 'design' | 'plan'`. 세 키를 각각 `baseline[k] === current[k]`로 비교 —
다르면 changed, 같으면 unchanged. **키별 비교**(위치·순서 무관). 결정적 키 순서로 반환. baseline·current는
`DesignDocBlobs`(B-1 타입 재사용).

### D2. delta 게이트 — design kind 전용 (R2)

`main()`의 **`if (opts.kind === 'design')` 분기 내부**에서만 delta를 계산한다 → **phase 리뷰는 구조적으로
delta 불가**(kind 격리, REQ-032 r06-2 반영). 그 분기에서 `hasDesignBaseline(state)` true면:
`current = captureDesignDocBlobs(...)`(이미 뽑음) → `computeDesignDelta(state.design_baseline, current)` →
`designDelta = { changed, unchanged }`를 `assembleReviewPrompt`에 전달. false(첫 리뷰·legacy)면
`designDelta = undefined`(full 모드).

🔴 게이트는 **`hasDesignBaseline`이지 `changed.length>0`이 아니다** — 변경 0개(baseline==current)여도 delta
모드로 세 문서 모두 baseline 태그를 붙인다(REQ-032 r04-2 반영). persona는 어느 경우든 base 그대로.

### D3. 변경 표시 authority 블록 (R3)

`assembleReviewPrompt`에 optional `designDelta?: { changed: DesignDocKey[]; unchanged: DesignDocKey[] }` 추가.
design kind + `designDelta` 있으면 authority 블록을 문서별 태그 형태로 렌더:

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

- **세 문서 본문 모두 포함**(미변경도 full — 문맥 보존). 태그만 다르다.
- 태그 문자열은 코드 상수 `DELTA_CHANGED_TAG`·`DELTA_BASELINE_TAG`.
- `designDelta` 없으면(full 모드·phase) **기존 블록 문자열 그대로**(R6) — 분기는 `designDelta` 유무로만.

### D4. persona·policy_version·바인딩 무변경 (R4·R5) — B-2/032 복잡도 배제

🔴 **B-2a는 persona를 증강하지 않는다.** `main()`의 `persona`(`:1704`)·`assembleReviewPrompt`의 persona
입력·`reviewPolicyVersion(persona)` 로그 입력(`:1920`)이 **전부 base 그대로**. delta 모드에서도 리뷰 계약이
안 바뀌므로 `policy_version`은 delta/full에서 동일한 게 **정당하다**(계약이 같으니 같아야 맞다). delta 계약
persona(재litigate 금지)와 그에 따른 policy_version 구분·null persona 정책·사용자 문서는 **B-2b**다.

`captureDesignBinding.designHash`는 여전히 full 현재 설계 바인딩. `processResponse`·`applyVerdict`·
`design_approved_hash`·B-1 baseline 저장 무변경. delta는 `assembleReviewPrompt`가 보내는 **문서 태그**만 바꾼다.

## Phase별 구현

단일 phase — delta 감지(순수) + 표시 렌더 + 게이트 배선이 한 덩어리로 작다. persona 표면이 없어 B-2보다 작다.

| phase | 범위 | 변경 파일 |
|---|---|---|
| `phase-1-delta-detect` | D1~D4 — `computeDesignDelta`·`DELTA_*_TAG` 상수·`assembleReviewPrompt` delta 렌더·`main()` design-전용 게이트 | `review-codex.ts`·테스트 |

## 변경 파일

- `scripts/req/review-codex.ts` — `DesignDocKey` 타입 · `computeDesignDelta`(순수) · `DELTA_CHANGED_TAG`·
  `DELTA_BASELINE_TAG` 상수 · `ReviewPromptInput.designDelta` · `assembleReviewPrompt` delta 렌더 분기 ·
  `main()` design 분기 delta 게이트 + `designDelta` 전달. **persona 관련 코드 무변경.**
- `tests/unit/req-review-codex.test.ts` — 오라클

**`req-commit.ts`·`machine.schema.json` 무변경**(R5·R6).

## 하위호환·안전

- **full 모드·phase 무회귀**(R6·인수기준 4): baseline 없거나 phase면 `designDelta=undefined` →
  `assembleReviewPrompt` 기존 코드 경로. 바이트 동일. 오라클로 고정.
- **persona·policy_version 무변경**(R4): B-2a는 persona 코드를 안 건드린다(diff 0줄). policy_version은 계약
  불변이라 delta/full 동일 — 이게 정확한 동작이다.
- **바인딩·승인 무변경**(R5): delta는 전송 문서 태그만.
- 이 REQ는 **additive**다. B-2b·B-3을 기다리지 않고 단독 병합한다. 태그는 정보성이고 문맥 무손실이라
  단독으로 안전(B-1 "저장만" 구조와 동형).
