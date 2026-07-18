# REQ-2026-035 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고.

> **오라클 원칙(REQ-2026-025)**: "지우면/뒤집으면 실패한다"로 쓴다.

## Phase 1 — full-review signal (`phase-1-full-review-signal`)

범위: D1~D4. `machine.schema.json` optional `full_review_requested` · `Verdict.full_review_requested?` ·
`validateVerdict` 2규칙 · `processResponse` design 분기 baseline 비움. **main·게이트·B-2a/B-2b 무변경.**

변경 파일: `workflow/machine.schema.json` · `scripts/req/review-codex.ts` · `tests/unit/req-review-codex.test.ts`

### Oracle — validateVerdict 교차필드 (순수)

- **O1-1 🔴 full_review_requested=yes + commit_approved=yes → 무효**(R2): 그 외 유효한 verdict에
  `full_review_requested='yes'`·`commit_approved='yes'`면 errors에 모순. → full review 요청+승인 동시 허용하면 실패.
- **O1-2 🔴 full_review_requested=yes + review_kind=phase → 무효**(R2): `full_review_requested='yes'`·
  `review_kind='phase'`면 errors에 모순(delta/baseline은 design 전용). → phase에 full 요청 허용하면 실패.
- **O1-3 🔴 유효 escalation은 통과**(R2): `full_review_requested='yes'`·`commit_approved='no'`·`review_kind='design'`·
  `status='NEEDS_FIX'`·findings≥1·next_action → `ok===true`. → 정상 escalation을 막으면 실패(과잉 제약).
- **O1-4 full_review_requested=no/부재 → 제약 없음**(R6): `'no'` 또는 필드 부재면 기존 승인/needs-fix verdict가
  그대로 통과(새 규칙이 정상 경로를 안 건드림). → 부재를 yes처럼 취급하면 실패.

### Oracle — escalation 지침(계약)

- **O1-0 🔴 DESIGN_DELTA_CONTRACT에 escalation 지침**(R2b, design-r01 P1): `DESIGN_DELTA_CONTRACT`에
  `"full_review_requested"` 문자열과 escalation 조건("근본적"/"delta로 판단" 취지)이 포함된다. → 계약에
  escalation 사용법이 없으면 리뷰어가 always "no"라 신호가 죽으므로 실패. (기존 B-2b O1-1도 이 확장에 맞춰
  갱신 — 계약 내용 단언이 새 줄을 포함.) delta 프롬프트가 곧 이 계약을 담음은 B-2b near-e2e(O1-3/O1-4)가 이미
  고정 — 계약 텍스트만 확장하면 자동 전파.

### Oracle — 스키마(원본=검증 SSOT / 파생=출력) 

- **O1-5 🔴 full_review_requested 없는 응답도 검증 통과(하위호환)**(R1): `validateResponseStructure`(원본 스키마)에
  이 필드 **없는** 유효 응답 → ok. → required로 넣어 구 archive를 깨면 실패.
- **O1-6 🔴 full_review_requested=yes 응답 검증 통과 + 오타 enum 거부**(R1): 이 필드 `"yes"` 응답 → 구조 ok
  (properties에 있음). `"maybe"` 등 enum 밖 → AJV 거부(additionalProperties/enum). → properties에 안 넣어
  additionalProperties:false가 유효 응답을 막으면 실패.
- **O1-7 🔴 파생 출력 스키마는 codex에 required로 요구**(R1): `deriveStrictOutputSchema(원본)`의 root
  `required`에 `full_review_requested`가 포함되고 enum 보존. → codex가 emit 안 해도 되게 두면(출력 스키마 누락)
  실패. (severity=P1 좁힘도 함께 유지 확인.)

### Oracle — processResponse 전환 (near-e2e 하네스)

- **O1-8 🔴 design full_review_requested=yes → baseline 제거(다음 full)**(R3, 인수기준 3): `state.design_baseline`
  있는 state + design NEEDS_FIX·commit_approved=no·`full_review_requested='yes'` 응답 → `processResponse` 후
  `nextState.design_baseline`이 **undefined**이고 `hasDesignBaseline(nextState)===false`. → baseline을 남기면
  다음 리뷰가 delta로 오작동해 실패.
- **O1-9 🔴 ordinary NEEDS_FIX(full_review_requested=no)는 baseline 보존(무회귀)**(R3·R6, 인수기준 5):
  `state.design_baseline` 있는 state + design NEEDS_FIX·`full_review_requested='no'` 응답 → `processResponse`
  후 `nextState.design_baseline`이 **그대로**(B-1 NEEDS_FIX 생존). → full 요청 아닌데 baseline을 지우면 실패
  (B-3a가 B-1을 회귀시킴).
- **O1-10 🔴 baseline 재개 — full review 승인이 baseline 재설정**(R4): baseline 없는(escalation 직후) state +
  design **approved**(designDocBlobs 제공) → `processResponse` 후 `nextState.design_baseline`이 다시 채워짐
  (`hasDesignBaseline` true) — B-1 재사용. → escalation이 영구 full로 고착되면 실패(delta 재개 안 됨).

### 정직성 — 이 phase가 증명하지 않는 것

- **미변경 문서 실제 생략**은 B-3b. B-3a는 문맥 무손실(생략 없음).
- **full 모드 전환의 프롬프트 효과**(태그·계약 없음)는 B-2a O1-7·O1-8이 이미 "baseline 없음 → full"로 고정 —
  B-3a는 baseline을 **비우는 것**까지 증명(O1-8), full 렌더는 게이트 재사용이라 중복 안 함.
- **로그 review_mode/full_review 측정**은 별도 REQ. `main()`·바인딩·B-2a/B-2b 무변경(diff로 확인).

Exit: typecheck0 · 단위 그린 · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(unit·typecheck) · 사용자 main 반영(별도 승인).
- 이 REQ는 additive다. **B-3b를 기다리지 않고 단독 병합한다.**
- 이 repo에 lint 스크립트는 없다(게이트 = typecheck + vitest).
