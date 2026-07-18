# REQ-2026-032 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고.

> **오라클 원칙(REQ-2026-025 교훈)**: 오라클은 "필드가 있다"가 아니라 **"지우면/뒤집으면 실패한다"** 로 쓴다.

## Phase 1 — delta prompt (`phase-1-delta-prompt`)

범위: D1~D5. `computeDesignDelta`(순수) · `DESIGN_DELTA_CONTRACT`·`DELTA_CHANGED_TAG`·`DELTA_BASELINE_TAG`
상수 · `ReviewPromptInput.designDelta` + `assembleReviewPrompt` delta 렌더 · `main()` delta 게이트 + persona 증강.

변경 파일: `scripts/req/review-codex.ts` · `tests/unit/req-review-codex.test.ts`

### Oracle — 순수: computeDesignDelta

- **O1-1 🔴 한 문서만 변경 → 그 키만 changed(키별 비교)**(R1): `baseline={r:A,d:B,p:C}`, `current={r:A,d:B2,p:C}`
  → `changed=['design']`, `unchanged=['requirement','plan']`. → 위치/순서로 비교한 구현은 다른 키를 changed로
  잡아 실패. requirement·plan OID가 같은데 changed로 넣으면 실패.
- **O1-2 🔴 전부 동일 → changed 빈 배열**(R1): baseline===current면 `changed=[]`, `unchanged`=3키. → 아무거나
  changed로 넣으면 실패(degenerate 재승인 케이스 고정).
- **O1-3 🔴 전부 상이 → changed 3키**(R1): 세 OID 모두 다르면 `changed`=3키, `unchanged=[]`. → 하나라도
  빠뜨리면 실패.

### Oracle — 순수: assembleReviewPrompt delta 렌더

- **O1-4 🔴 delta 모드 문서 표시**(R3): `designDelta={changed:['requirement','plan'], unchanged:['design']}` +
  designDocs 3본문으로 assemble → 프롬프트에 **00·02는 `DELTA_CHANGED_TAG`**, **01은 `DELTA_BASELINE_TAG`**
  가 붙고 **세 본문 모두 존재**. → changed/unchanged 표시를 뒤바꾼 구현은 실패(01에 CHANGED가 붙음).
  본문 하나라도 빠뜨리면 실패(문맥 보존 위반).
- **O1-5 🔴 full 모드 무회귀 — 전체 문자열 바이트 동일**(R7·인수기준 4, design-r05 P1): 고정 입력
  (persona·designDocs·reviewContext·reviewBaseSha·requestBody)에서 `designDelta` 없이 assemble한 **전체 출력
  문자열**이 **하드코딩된 expected(=B-1 이전 assembleReviewPrompt 출력)와 정확히 `===`**. → 무표시 preamble·
  추가 개행 등 어떤 바이트 변화도 여기서 실패한다(부분 substring 검사가 못 잡는 회귀를 전체 동등성으로 봉쇄).

### Oracle — 순수: persona 증강 / policy_version

- **O1-6 🔴 DESIGN_DELTA_CONTRACT 계약 + policy_version 구분(base 有/無)**(R4): (a) base persona 있으면
  `deltaPersona = base + '\n' + DESIGN_DELTA_CONTRACT` → 계약 핵심 문구("재심사·재litigate 금지"·"직접 영향"·
  "finding으로 밝혀라") 존재 + `reviewPolicyVersion(deltaPersona) !== reviewPolicyVersion(base)`.
  (b) 🔴 **base null**(design-r01 P1): `deltaPersona = DESIGN_DELTA_CONTRACT` **단독**(문자열 `"null"` coercion
  없음), 계약 문구 존재, `reviewPolicyVersion(deltaPersona) !== 'none'`(null full 모드의 값). → 계약 미부착·
  policy_version 미구분·null coercion이면 실패.

### Oracle — near-e2e: main() delta 게이트 배선 (DRY-RUN, 돈 안 씀)

near-e2e인 이유: 순수 조각이 맞아도 **`main()`이 baseline 있을 때 실제로 delta 경로를 타는지**는 배선이다.
`--run` 없이 실행해 `.review-preview.txt`만 쓰게 하고(외부 호출 0), preview 내용을 단언한다.

- **O1-7 🔴 baseline 있는 design 리뷰(reviewPersonaPath:null) → preview에 delta 태그·단독 계약**(R2·R3·R4,
  null 정책): temp repo에 00/01/02 커밋 + `state.design_baseline`(현재 OID와 일부 다르게) 세팅 +
  `reviewPersonaPath:null`(temp repo엔 persona 파일 없음 = 지원되는 null 설정) → `reviewCodexMain(['<id>',
  '--kind','design','--root',repo], {reviewer:fake})`(non-run) → `.review-preview.txt`에 `DELTA_CHANGED_TAG`
  또는 `DELTA_BASELINE_TAG` + `DESIGN_DELTA_CONTRACT`가 있고, **문자열 `"null"` coercion 흔적이 없다**(base null
  단독 계약). fake reviewer 호출 0회. → 게이트가 full로 새거나 null이 "null\n계약"으로 새면 실패.
- **O1-8 🔴 baseline 없는(legacy) design 리뷰 → preview 플레인(full 무회귀)**(R2·R7·R5): `state.design_baseline`
  없이 같은 repo → preview에 delta 태그·계약이 **없고** 플레인 `권위 아티팩트 = 설계 문서 00/01/02`가 있다.
  design_hash(바인딩) 로그가 나온다(바인딩 무변경 신호). → baseline 없음에도 delta를 타면 실패.
- **O1-9 🔴 base 있는 live delta: 전송 프롬프트·로그 policy_version 둘 다 effective persona**(R4·D4,
  design-r02·r03 P1, near-e2e `--run`): temp repo에 **실제 base persona 파일** + `reviewPersonaPath` 설정 +
  `state.design_baseline` 세팅 → `reviewCodexMain(['<id>','--kind','design','--run','--root',repo],
  {reviewer:fake})`(fake가 유효 design verdict 반환) → **두 축 모두 단언**:
  ① **전송 프롬프트**(`fake.requests[0].prompt`)에 **base persona 본문 AND `DESIGN_DELTA_CONTRACT`가 모두
  존재**(계약이 실제 리뷰어에게 전송됨 — 프롬프트에 base만 넘긴 구현은 여기서 실패, design-r03 P1).
  ② `REVIEW_CALL_LOG_REL` 마지막 행의 `policy_version === reviewPolicyVersion(base + '\n' + DESIGN_DELTA_CONTRACT)`
  이고 `!== reviewPolicyVersion(base)`(로그가 delta를 full로 기록한 구현은 실패, design-r02 P1).
  → 프롬프트·로그 어느 한쪽이라도 effective persona에서 발산하면 실패. fake 호출 1회.
- **O1-10 🔴 base persona full 모드(baseline 없음) — main 전송 prompt 전체 바이트 동일**(R4·R7·인수기준 4,
  design-r04·r05 P1, near-e2e): temp repo에 **실제 base persona 파일** + `reviewPersonaPath` 설정 +
  **`state.design_baseline` 없음**(첫/legacy) → `reviewCodexMain([...,'--kind','design','--root',repo],
  {reviewer:fake})`(non-run) → `.review-preview.txt`가, **테스트가 같은 입력**(파일 base persona·인덱스
  designDocs·git 파생 reviewBaseSha/reviewTree/branch·requestBody)으로 `assembleReviewPrompt`를 `designDelta`
  **없이** 재호출해 만든 expected와 **전체 문자열 `===`**. → main()이 baseline 검사 전 계약을 붙이거나, 무표시
  preamble·개행을 삽입하면 전체 동등성에서 실패(부분 검사가 놓치는 바이트 회귀 봉쇄).
- **O1-11 🔴 baseline==current(zero-change) 게이트 → 여전히 delta**(R2·D2, design-r04 P1, near-e2e): temp repo에
  00/01/02 커밋 + `state.design_baseline`을 **현재 인덱스 OID와 완전히 동일**하게 세팅(`git ls-files -s`로
  실제 OID 취득 후 그대로) → non-run 실행 → preview에 **세 문서 모두 `DELTA_BASELINE_TAG`** + `DESIGN_DELTA_CONTRACT`
  가 있다(변경 0이어도 delta 모드·재승인 경로). → `changed.length===0`이면 designDelta/persona를 떼 full로
  보내는 오구현은 여기서 실패(degenerate delta가 full 재심사로 둔갑).
- **O1-12 🔴 부분 변경의 문서별 태그 배선(main이 분류를 그대로 전달)**(R1·R3, design-r05 P1, near-e2e):
  temp repo에 00/01/02 커밋 + `state.design_baseline`을 **design(01) OID만 현재와 다르게**, requirement(00)·
  plan(02)은 현재와 동일하게 세팅 + base persona 파일 → non-run 실행 → preview에서 **문서별 헤더 태그가 정확**:
  `00-requirement.md`는 `DELTA_BASELINE_TAG`, `01-design.md`는 `DELTA_CHANGED_TAG`, `02-plan.md`는
  `DELTA_BASELINE_TAG`. **00·02에 `DELTA_CHANGED_TAG`가 붙지 않음**을 명시 단언. → main()이 "changed 있으면
  전부 [변경됨]"으로 넘기는 오구현은 여기서 실패(문서별 delta·재litigation 방지 계약 위반). computeDesignDelta
  결과가 프롬프트까지 문서별로 보존됨을 near-e2e로 고정.

### 정직성 — 이 phase가 증명하지 않는 것

- **리뷰어 행동 개선**(재litigation 감소)은 경험적 — 단위로 증명 불가. 오라클은 프롬프트 **구조**만 고정.
- **바인딩·승인 무변경**(R5): B-2는 `captureDesignBinding`·`processResponse`·`applyVerdict`를 **건드리지 않는다**
  — diff에 그 함수 변경 0줄(리뷰어가 diff로 확인). delta는 `assembleReviewPrompt` 전송 내용 + persona만 바꾼다.
- **미변경 문서 생략·escalation**은 B-3. B-2는 참조로 포함(문맥 무손실).

Exit: typecheck0 · 단위 그린 · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(unit·typecheck) · 사용자 main 반영(별도 승인).
- 이 REQ는 additive다. **B-3을 기다리지 않고 단독 병합한다.**
- 이 repo에 lint 스크립트는 없다(게이트 = typecheck + vitest).
