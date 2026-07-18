# REQ-2026-034 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고.

> **오라클 원칙(REQ-2026-025)**: "지우면/뒤집으면 실패한다"로 쓴다.

> **완전성(032/033 교훈)**: main 배선은 near-e2e로 정상 경로(delta/full × base/null persona × design/phase)를
> 처음부터 고정. byte-identity expected는 **검증 대상 assembleReviewPrompt로 재조립하지 않고**(tautology)
> 하드코딩/손 조립(동적값만 `git rev-parse`/`write-tree`로 독립 보간). temp repo git은 프로덕션처럼
> `.replace(/\s+$/,'')`. `--run`은 `machine.schema.json` 복사.

## Phase 1 — delta persona (`phase-1-delta-persona`)

범위: D1~D5. `DESIGN_DELTA_CONTRACT`·`applyDeltaPersona`(순수)·`main()` effectivePersona 배선(프롬프트+로그)·
사용자 문서(README·README.en·SSOT). **assembleReviewPrompt·B-2a 태그 무변경.**

변경 파일: `scripts/req/review-codex.ts` · `tests/unit/req-review-codex.test.ts` · `README.md` · `README.en.md` ·
`docs/ssot-design/02-repository-and-runtime.md`

### Oracle — 순수

- **O1-1 🔴 `DESIGN_DELTA_CONTRACT` 내용 + 태그 상수 값 포함**(R1): 계약 문자열에 "재litigate"·"직접 영향"·
  "finding"(재고 강제 시)이 있고, `expect(contract).toContain(DELTA_CHANGED_TAG)`·`toContain(DELTA_BASELINE_TAG)`.
  → 계약이 재심사 금지를 안 걸거나 현재 태그 값과 다른 표현을 쓰면 실패. **정직성(design-r02 observation)**:
  `toContain(상수)`는 "현재 태그 값을 계약이 포함"까지만 고정한다 — 소스가 상수 보간인지 같은 값 리터럴인지는
  단위 테스트로 구분 못 한다(둘은 태그 상수가 바뀌기 전까지 관측적으로 동일). drift는 태그 상수를 바꾸는
  **B-2a 경계 변경** 시점에 이 오라클이 드러낸다(그때 리터럴이면 값 불일치로 실패). 소스 구조 단언은 과하다.
- **O1-2 🔴 `applyDeltaPersona` 4경우**(R2·R4): (a) `(base,true)` → `base+'\n'+DESIGN_DELTA_CONTRACT`.
  (b) `(null,true)` → `DESIGN_DELTA_CONTRACT` 단독(문자열 `"null"` 없음). (c) `(base,false)` → `base`(불변).
  (d) `(null,false)` → `null`. → deltaActive에서 계약 누락·null coercion·!deltaActive에서 계약 삽입이면 실패.

### Oracle — near-e2e: main effectivePersona 배선 (hand-built expected)

- **O1-3 🔴 base persona + baseline design `--run`: 프롬프트·로그 둘 다 base+계약**(R3, 032 r02·r03):
  temp repo에 base persona 파일 + `state.design_baseline`(partial) → `reviewCodexMain([...,'--kind','design',
  '--run',...],{reviewer:fake})` → ① `fake.requests[0].prompt`가 **손 조립 expected**(persona=`base+'\n'+계약`,
  B-2a 태그 authority)와 전체 `===`. ② `REVIEW_CALL_LOG_REL` 행 `policy_version === reviewPolicyVersion(base+'\n'+계약)`
  **이고** `!== reviewPolicyVersion(base)`. → 프롬프트·로그 어느 쪽이 base로 발산해도 실패.
- **O1-4 🔴 null persona + baseline design `--run`: 계약 단독 + 로그 hash(계약)**(R4, 032 r01·r06-1):
  `reviewPersonaPath:null`(persona 파일 없음) + baseline → --run → ① 전송 프롬프트 persona 블록 = `DESIGN_DELTA_CONTRACT`
  **단독**(`"null"` coercion 없음), 손 조립 expected와 전체 `===`. ② 로그 `policy_version === reviewPolicyVersion(DESIGN_DELTA_CONTRACT)`
  **이고** `!== 'none'`. → null을 계약 없이 흘리거나 로그가 'none'이면 실패.
- **O1-5 🔴 base persona + baseline **없음**(full) design `--run`: 계약 없음, 프롬프트 전체 === + 로그 policy=base**
  (R5·R7, design-r01 P1, --run): base persona + `design_baseline` 없음 → --run → ① 전송 프롬프트
  (`fake.requests[0].prompt`)에 `DESIGN_DELTA_CONTRACT`가 **없고** persona=base only인 **손 조립 full expected와
  전체 `===`**. ② 로그 `policy_version === reviewPolicyVersion(base)`(≠ delta·≠'none'). → full design에 계약이
  새거나, 프롬프트는 base인데 로그가 'none'/delta로 발산하면 실패(non-run으론 로그를 못 봐서 --run 필수).
- **O1-6 🔴 null persona + baseline **없음**(full) design `--run`: 프롬프트 전체 === + policy='none'(null 무회귀)**
  (R4·R7·인수기준 5, design-r04 P1, --run): `reviewPersonaPath:null` + baseline 없음 → --run → ① 전송 프롬프트가
  **손 조립 full expected**(persona 없음, 계약 없음, 플레인 authority)와 전체 `===`. ② 로그 `policy_version === 'none'`.
  → full+null에 계약/안내문/개행이 새거나 policy가 'none' 아니면 실패(non-run으론 못 잡는 로그·바이트 회귀 봉쇄).
- **O1-7 🔴 kind 격리 — phase 프롬프트 전체 === (base persona 그대로) + policy=base**(R5·R7, 032 r06-2·
  design-r02 P1, --run): base persona + baseline + **phase** 리뷰 → --run → ① 전송 프롬프트가 **손 조립 phase
  expected**(persona=**base only**, 계약 없음, staged diff authority)와 전체 `===` — 프롬프트가 실제 base
  persona를 받았음을 바이트로 고정(계약 없음만이 아니라). ② 로그 `policy_version === reviewPolicyVersion(base)`.
  → phase에 계약을 붙이거나, 프롬프트엔 null을 넘기고 로그엔 base를 쓰는 발산 구현이 여기서 실패.

- **O1-9 🔴 kind 격리 — null persona phase도 계약 없음, policy='none'**(R5·R7·인수기준 5, design-r03 P1, --run):
  `reviewPersonaPath:null` + baseline + **phase** 리뷰 → --run → ① 전송 프롬프트가 **손 조립 phase expected**
  (**persona 없음**, 계약 없음, staged diff authority)와 전체 `===`. ② 로그 `policy_version === 'none'`.
  → main이 phase+null에만 계약을 주입하는 오배선이면 여기서 실패(정상 null phase에 계약 새는 것 차단).

### Oracle — 사용자 문서 (touchpoint별 canonical)

- **O1-8 🔴 문서 계약 갱신 — 각 위치에 canonical 문구**(R6·D5, 032 r06-3·design-r03·r04 P1): D5가 명시한
  **각 touchpoint**가 "null이어도 **delta design 리뷰는 내장 계약을 주입**"이라는 **의미**를 담아야 한다 —
  단순 "delta" 키워드가 아니라(그러면 "delta에서도 비활성"이란 반대 문장도 통과), **canonical 문구를 정의하고
  각 위치에 그 문구가 있는지** 단언한다. canonical = KR `"delta design 리뷰에는 내장 delta 계약이 주입된다"` /
  EN `"delta design reviews still inject the built-in delta contract"`(정확 문구는 구현이 상수로 고정, 테스트가
  그 상수를 각 위치에서 grep). 검증 위치:
  ① `README.md` 본문 null 설명(:120 부근) + 설정 표 `reviewPersonaPath` 행(:497 부근).
  ② `README.en.md` 본문(:120 부근) + 표(:497 부근).
  ③ `docs/ssot-design/02-repository-and-runtime.md`의 `reviewPersonaPath` 항목(:132 부근).
  → 다섯 위치 중 하나라도 canonical 문구가 없거나, "delta에서도 비활성"처럼 계약과 반대 안내를 하면 실패
  (grep이 의미를 고정 — 키워드만이 아니라).

### 정직성 — 이 phase가 증명하지 않는 것

- **리뷰어 행동 개선**(재litigate 감소)은 경험적 — 오라클은 프롬프트/로그 **구조**만.
- **바인딩·승인·B-2a 태그·assembleReviewPrompt 무변경**(R7): diff에 해당 함수 변경 0줄(리뷰어 diff 확인).
- **미변경 문서 생략·escalation**은 B-3.

Exit: typecheck0 · 단위 그린 · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(unit·typecheck) · 사용자 main 반영(별도 승인).
- 이 REQ는 additive다. **B-3을 기다리지 않고 단독 병합한다.**
- 이 repo에 lint 스크립트는 없다(게이트 = typecheck + vitest).
