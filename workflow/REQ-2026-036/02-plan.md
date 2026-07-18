# REQ-2026-036 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고.

> **오라클 원칙(REQ-2026-025)**: "지우면/뒤집으면 실패한다". byte-identity expected는 SUT 재조립 금지 →
> 하드코딩/손 조립 독립 golden(033 tautology 교훈). temp repo git은 `.replace(/\s+$/,'')`, `--run`은 스키마 복사.

## Phase 1 — omit unchanged (`phase-1-omit-unchanged`)

범위: D1~D4. `DELTA_OMITTED_BODY` 상수 · `assembleReviewPrompt` delta 분기 미변경 본문 생략 · B-3b 오라클 +
**B-2a O1-4·B-2b buildExpected 갱신(cross-cutting)**. `captureDesignBinding`·`processResponse`·B-2a/B-2b/B-3a 무변경.

변경 파일: `scripts/req/review-codex.ts` · `tests/unit/req-review-codex.test.ts`

### Oracle — 순수

- **O1-1 🔴 DELTA_OMITTED_BODY 내용**(R2): 생략 사실("생략") + escalation 안내("full_review_requested")를 담는다.
  → placeholder에 escalation 경로가 없으면(생략이 문맥 숨긴 위험 미안내) 실패.
- **O1-2 🔴 delta 렌더 생략 — 하드코딩 golden 전체 `===`**(R1, SUT 독립): 고정 입력(persona=null·고정 3본문·
  `designDelta={changed:['requirement','plan'], unchanged:['design']}`)에서 `assembleReviewPrompt` 출력이
  **손으로 쓴 golden과 전체 `===`**. golden = 00·02는 **full 본문**(변경), 01은 **`DELTA_OMITTED_BODY`**(미변경),
  헤더·태그 유지. → 미변경 본문을 그대로 내보내거나(생략 안 함) 변경 본문을 생략하면 실패.
- **O1-3 🔴 full 모드·phase 무회귀 — 하드코딩 golden 전체 `===`**(R3): `designDelta` 없이(full) assemble한
  출력이 **모든 본문 포함** golden과 `===`. phase(staged diff)도 무변경. → full/phase에 생략이 새면 실패.

### Oracle — near-e2e (hand-built expected)

- **O1-4 🔴 부분 변경(design만) → 변경 본문 유지·미변경 본문 생략(전체 ===)**(R1, near-e2e): temp repo +
  `state.design_baseline`(design만 현재와 다름) → `reviewCodexMain(...design...run)` → 전송 프롬프트가
  **손 조립 expected**(01=full body, 00·02=`DELTA_OMITTED_BODY`, 헤더·태그·persona 계약 포함)와 전체 `===`.
  🔴 expected는 `assembleReviewPrompt` 재호출 없이 손 조립(동적값 HEAD sha/tree만 독립 보간). → main이 생략을
  안 하거나 변경 문서를 생략하면 실패.
- **O1-5 🔴 zero-change(baseline==current) → 세 본문 모두 생략**(R1): `state.design_baseline`=현재 OID → 전송
  프롬프트에서 세 문서 본문이 모두 `DELTA_OMITTED_BODY`(원 본문 부재). 헤더·태그(세 `[승인 baseline]`) 유지.
  → 변경 0인데 본문을 남기면 실패(생략 게이트가 changed 기준임을 고정).

### Oracle — cross-cutting 갱신 (R5) — 상위 REQ 불변식 변경

- **B-2a O1-4 갱신**: "세 본문 모두 존재" → **변경 본문 존재 + 미변경 본문은 `DELTA_OMITTED_BODY`**(원 본문
  부재)로 단언 변경. (B-3b가 이 불변식을 바꾸므로.)
- **B-2b `buildExpected` 갱신**: delta 경로에서 미변경 문서 본문을 `DELTA_OMITTED_BODY`로 재조립하도록 수정 →
  B-2b O1-3·O1-4(delta near-e2e 전체 ===)가 새 렌더와 일치. B-2b full/phase 경로는 무변경.
- 🔴 **전체 스위트로 검증**: isolation 실행은 통과해도 cross-file 회귀(B-2a/B-2b)는 full 스위트에서만 잡힌다
  (REQ-034 교훈). phase exit 전 `vitest run`(전체) 그린 확인.

### 정직성 — 이 phase가 증명하지 않는 것

- **토큰 절감 수치**는 측정 안 함 — 오라클은 생략 **구조**(미변경 본문 부재·placeholder 존재)만.
- **바인딩·승인·B-2a/B-2b/B-3a 로직 무변경**(R4): diff에 해당 함수 변경 0줄(리뷰어 diff 확인). 생략은
  `assembleReviewPrompt` 전송 본문만.

Exit: typecheck0 · 단위 그린(**전체 스위트**) · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(unit·typecheck) · 사용자 main 반영(별도 승인).
- 이 REQ는 additive다(delta 프롬프트 축소). **개선 B(delta review)의 마지막 조각.**
- 이 repo에 lint 스크립트는 없다(게이트 = typecheck + vitest).
