# REQ-2026-033 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고.

> **오라클 원칙(REQ-2026-025 교훈)**: 오라클은 "필드가 있다"가 아니라 **"지우면/뒤집으면 실패한다"** 로 쓴다.

> **완전성(REQ-2026-032 교훈)**: main() delta 배선은 near-e2e로 각 정상 경로(full/delta × baseline有/無 ×
> 부분/zero-change × design/phase)를 처음부터 고정한다 — 순수 조각만으론 배선 발산을 못 잡는다.

## Phase 1 — delta detect (`phase-1-delta-detect`)

범위: D1~D4. `computeDesignDelta`(순수) · `DELTA_CHANGED_TAG`·`DELTA_BASELINE_TAG` 상수 ·
`ReviewPromptInput.designDelta` + `assembleReviewPrompt` delta 렌더 · `main()` design-전용 delta 게이트.
**persona 코드 무변경.**

변경 파일: `scripts/req/review-codex.ts` · `tests/unit/req-review-codex.test.ts`

### Oracle — 순수: computeDesignDelta

- **O1-1 🔴 한 문서만 변경 → 그 키만 changed(키별 비교)**(R1): `baseline={r:A,d:B,p:C}`, `current={r:A,d:B2,p:C}`
  → `changed=['design']`, `unchanged=['requirement','plan']`. → 위치/순서 비교 구현은 다른 키를 잡아 실패.
- **O1-2 🔴 전부 동일 → changed 빈 배열**(R1): baseline===current면 `changed=[]`, `unchanged`=3키.
- **O1-3 🔴 전부 상이 → changed 3키**(R1): 세 OID 모두 다르면 `changed`=3키, `unchanged=[]`.

### Oracle — 순수: assembleReviewPrompt (하드코딩 golden — SUT 독립)

🔴 **tautology 금지(design-r02 P1)**: byte-identity expected는 **검증 대상 `assembleReviewPrompt`를 재호출해
만들지 않는다** — 그러면 구현이 그 함수에 preamble을 넣어도 실제·expected가 함께 바뀌어 `===`가 무의미하게
통과한다. expected는 **하드코딩 문자열**(순수 오라클) 또는 **테스트가 손으로 조립한 템플릿**(near-e2e, 동적
값만 독립 보간)이어야 한다.

- **O1-4 🔴 delta 렌더 — 하드코딩 golden 전체 `===`**(R3·R4): **고정 입력**(persona=null·고정 3본문·
  `designDelta={changed:['requirement','plan'], unchanged:['design']}`)에서 `assembleReviewPrompt` 출력이
  **손으로 쓴 하드코딩 expected 문자열과 전체 `===`**. 그 expected는 00·02에 `DELTA_CHANGED_TAG`, 01에
  `DELTA_BASELINE_TAG`, 세 본문, 그리고 **계약 블록 없음**을 그대로 담는다. → 태그 오배치·본문 누락·태그 외
  계약/지시문 블록 삽입이 전부 실패(전체 동등성이라 "허용된 태그 외 아무것도 없음"까지 고정).
- **O1-5 🔴 full 모드 무회귀 — 하드코딩 golden 전체 `===`**(R6·인수기준 4): **고정 입력**에서 `designDelta`
  없이 assemble한 출력이 **손으로 쓴 하드코딩 expected(=B-1 이전 포맷)와 전체 `===`**. → no-delta 분기에
  preamble·개행 등 어떤 바이트 변화도 실패. **assembleReviewPrompt를 재호출하지 않는다**(독립 golden).

### Oracle — near-e2e: main() delta 게이트 배선 (fake reviewer 주입)

- **O1-6 🔴 baseline 있는 design 리뷰 → preview에 delta 태그**(R2·R3, non-run): temp repo에 00/01/02 커밋 +
  `state.design_baseline`(일부 다르게) → `reviewCodexMain(['<id>','--kind','design','--root',repo],{reviewer:fake})`
  (non-run) → `.review-preview.txt`에 `DELTA_CHANGED_TAG` 또는 `DELTA_BASELINE_TAG` 존재. fake 호출 0회.
- **O1-7 🔴 baseline 없는(legacy) design → preview 무표시 + full 무회귀**(R6·인수기준 4, non-run): `state.design_baseline`
  없이 같은 repo → preview에 delta 태그가 **없고**, 프롬프트가 **테스트가 손으로 조립한 expected 템플릿**과 전체
  `===`. 🔴 expected는 **`assembleReviewPrompt`를 호출하지 않고** 문자열 템플릿으로 직접 만든다 — 고정값(파일
  persona·고정 3본문·고정 branch·requestBody·플레인 authority 헤더)은 하드코딩, **동적값은 HEAD sha(reviewBaseSha)
  뿐**이라 `git rev-parse HEAD`로 독립 취득해 보간, reviewTree는 `git write-tree`(고정 content라 결정적). →
  baseline 없음에도 delta를 타거나, main이 assemble 뒤 후처리로 한 줄 넣으면 실패(SUT 독립이라 tautology 없음).
- **O1-8 🔴 부분 변경 문서별 태그 정확(main이 분류 그대로 전달)**(R1·R3, non-run): `state.design_baseline`을
  **design(01) OID만 현재와 다르게**, 00·02는 동일하게 세팅 → preview에서 `00-requirement.md`=`DELTA_BASELINE_TAG`,
  `01-design.md`=`DELTA_CHANGED_TAG`, `02-plan.md`=`DELTA_BASELINE_TAG`. **00·02에 CHANGED 태그가 안 붙음**을
  명시 단언. → main이 "changed 있으면 전부 변경"으로 넘기면 실패.
- **O1-9 🔴 zero-change(baseline==current) → 여전히 delta**(R2, non-run): `state.design_baseline`을 현재 인덱스
  OID와 **완전 동일**하게(`git ls-files -s`로 실제 OID 취득) → preview에 **세 문서 모두 `DELTA_BASELINE_TAG`**.
  → `changed.length===0`이면 full로 보내는 구현은 실패(게이트=`hasDesignBaseline`이지 changed 수 아님).
- **O1-10 🔴 kind 격리 — baseline 있어도 phase 프롬프트 전체 바이트 동일**(R2·R6, design-r06-2·B-2a-r01·r02
  교훈, near-e2e): baseline 보유 state + phase 리뷰(staged diff 대상) → preview에 delta 태그가 **없고**,
  프롬프트가 **테스트가 손으로 조립한 phase expected 템플릿**과 전체 `===`. 🔴 expected는 **`assembleReviewPrompt`
  호출 없이** 문자열 템플릿으로(고정 persona·staged diff·플레인 authority, 동적값은 HEAD sha·reviewTree만 독립
  취득 보간). → delta 태그·무표시 preamble·헤더 한 줄 추가가 전부 실패(phase 정상 경로 완전 무회귀, SUT 독립).

### Oracle — persona·policy_version 무변경 (R4)

- **O1-11 🔴 delta 프롬프트 = base persona + 태그 블록, 그 외 계약 없음(독립 expected)**(R4, B-2a-r01·r02 교훈,
  near-e2e `--run`): base persona 파일 + baseline 보유 design `--run`(fake 유효 verdict) → **두 축**:
  ① 전송 프롬프트(`fake.requests[0].prompt`)가 **테스트가 손으로 조립한 delta expected 템플릿**과 전체 `===`.
  🔴 expected는 **`assembleReviewPrompt` 호출 없이** 문자열로(base persona 파일 내용·고정 3본문·delta 태그 배치·
  동적값 HEAD sha/reviewTree만 독립 보간). → base persona·허용 태그 **외 어떤 계약/지시문 블록도 없음**을 봉쇄
  (`assembleReviewPrompt`의 delta 분기에 다른 이름의 `DELTA_REVIEW_INSTRUCTION`을 넣어도 재조립 expected가 아니라
  손 조립 expected라 실패). ② `REVIEW_CALL_LOG_REL` 행의 `policy_version === reviewPolicyVersion(base persona
  본문)`(= full 모드와 동일 — 계약 불변). → persona 증강·계약 삽입이면 ①이 실패. fake 호출 1회.

### 정직성 — 이 phase가 증명하지 않는 것

- **리뷰어 행동 개선**(재litigate 감소)은 경험적 — 오라클은 프롬프트 **구조**만 고정. 태그를 리뷰어가
  **어떻게 쓰는지**(계약)는 B-2b.
- **바인딩·승인 무변경**(R5): `captureDesignBinding`·`processResponse`·`applyVerdict` diff 0줄(리뷰어 diff 확인).
- **persona 계약·policy_version 구분·null persona·사용자 문서**는 B-2b. **미변경 문서 생략·escalation**은 B-3.

Exit: typecheck0 · 단위 그린 · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(unit·typecheck) · 사용자 main 반영(별도 승인).
- 이 REQ는 additive다. **B-2b·B-3을 기다리지 않고 단독 병합한다.**
- 이 repo에 lint 스크립트는 없다(게이트 = typecheck + vitest).
