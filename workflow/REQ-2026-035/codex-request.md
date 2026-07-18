# REQ-2026-035 리뷰 요청

## 배경

CommitGate 개선 **REQ-B-3a** — FULL_REVIEW_REQUESTED escalation. delta review 파이프라인(B-1 저장·B-2a 감지·
표시·B-2b 계약)의 **안전판**: delta 재리뷰에서 리뷰어가 "이 변경은 delta로 판단하기엔 너무 근본적 — 전체
설계를 다시 봐야겠다"고 판단하면 **다음 리뷰를 full 모드로 되돌린다**.

**분할(사용자 2분할 결정)**: B-3 = **B-3a(escalation 안전판 — 전체 문맥 유지)** + B-3b(미변경 문서 실제 생략,
토큰 절감). B-3a가 escalation 메커니즘을 먼저 안전하게(생략 없음). 이 REQ는 **최적화가 아니라 안전판**.

## 변경 요약

- **`machine.schema.json`**: properties에 optional `full_review_requested`(enum yes/no). **required엔 안 넣음**
  → 검증 SSOT는 optional(구 archive 하위호환). `deriveStrictOutputSchema`가 root required=전체 properties로
  파생하므로 codex 출력 스키마엔 자동 포함(매 응답 emit). 스키마 버전 1.1 유지.
- **`validateVerdict` 2규칙**: `full_review_requested='yes'` → `commit_approved='no'`(승인+full요청 모순) AND
  `review_kind='design'`(delta는 design 전용).
- **`processResponse` design 분기**: `full_review_requested='yes'`면 `nextState.design_baseline`을 **제거** →
  다음 design 리뷰가 `hasDesignBaseline=false`로 full 모드(B-2a 게이트 재사용). `main()` 무변경.

🔴 **핵심**: 전환을 **state로** 표현한다 — baseline을 비우면 기존 `hasDesignBaseline` 게이트가 자연히 full을
고른다. `main()`·delta 게이트·B-2a 태그·B-2b 계약·바인딩에 **코드 경로 신설 없음**(회귀 표면 최소). 다음
full review가 승인되면 B-1이 baseline을 재설정 → delta 재개(1회 리셋). full 전환은 문맥을 더 보낼 뿐이라
안전 → **새 human 게이트 없음**.

`req-commit.ts` 무변경.

## design-r01 지적 반영 (P1 1건)

1. 🔴 **신호만 있고 사용 지침이 없어 escalation 경로가 죽음**: `full_review_requested` enum은 형식만 요구할 뿐
   리뷰어에게 **언제 yes를 쓸지** 안 알려준다. B-2b 계약은 재litigate 금지만 지시하므로 정상 delta 리뷰에서
   리뷰어는 always `"no"`를 내 R1~R3의 정상 경로가 제공되지 않는다. → **`DESIGN_DELTA_CONTRACT`에 escalation
   지침 한 줄 추가**(근본 변경 시 `full_review_requested=yes`·`commit_approved=no`로 전체 재리뷰 요청).
   `applyDeltaPersona` 로직·게이트는 무변경(계약 텍스트만). O1-0 추가(계약에 지침 포함) + 기존 B-2b O1-1 갱신.
   delta 프롬프트 전파는 B-2b near-e2e가 이미 고정.

## 리뷰 포인트

리뷰 포인트는 심사 범위의 하한이다.

1. **🔴 스키마 하위호환**(R1·D1). optional 추가(required 제외)가 구 archive를 안 깨는가(O1-5)? properties에
   넣어 additionalProperties:false가 신규 응답을 통과시키는가(O1-6)? `deriveStrictOutputSchema`가 출력 스키마
   required에 자동 포함해 codex가 emit하게 하는가(O1-7)? 스키마 버전 1.1 유지가 맞는가(additive)?
2. **🔴 교차필드 검증**(R2·D2). `full_review_requested='yes'`가 `commit_approved='yes'`·`review_kind='phase'`와
   모순 처리되는가(O1-1·O1-2)? 유효 escalation(no+design+NEEDS_FIX+findings)은 통과하는가(O1-3)? `'no'`/부재가
   정상 경로를 안 건드리는가(O1-4)?
3. **🔴 전환·무회귀**(R3·R6·D3). `full_review_requested='yes'`만 baseline을 지우고(O1-8), ordinary NEEDS_FIX는
   **보존**하는가(O1-9, B-1 NEEDS_FIX 생존 무회귀)? `main()`·게이트 무변경으로 baseline 부재가 full을 유도하는
   구조가 맞는가? 코드 경로 신설 없이 state로 전환하는 게 회귀 표면을 최소화하는가?
4. **🔴 delta 재개**(R4·D4). full review 승인이 B-1으로 baseline을 재설정해 delta가 재개되는가(O1-10)?
   escalation이 영구 full로 고착되지 않는가?
5. **human 게이트 불필요**(R5·D4). full 전환(문맥 증가)이 안전해 새 통제점이 불필요한 게 맞는가? 승인·커밋의
   기존 통제점으로 충분한가?
6. **분할·범위**. escalation(B-3a)과 생략(B-3b)을 나눈 게 맞는가? B-3a 단독 병합이 안전한가(문맥 무손실)?
   미변경 문서 생략을 B-3b로 미룬 근거(생략은 escalation 안전판 위에서만 안전)가 타당한가?
7. **oracle**. O1-1~O1-10이 각 "→ 실패해야 하는 구현"(승인+full요청·phase full요청·구 archive 깸·baseline
   오삭제/오보존·고착)을 실제로 실패시키는가?
