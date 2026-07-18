# REQ-2026-036 리뷰 요청

## 배경

CommitGate 개선 **REQ-B-3b** — delta 미변경 문서 본문 생략(토큰 절감). delta review 파이프라인의 **마지막
조각**. B-2a는 안전을 위해 미변경 문서 본문도 full로 포함했다(문맥 무손실). B-3a(FULL_REVIEW_REQUESTED
escalation) 안전판이 섰으니, 이제 미변경 본문을 **실제로 생략**해도 안전하다 — 생략된 문맥이 필요하면
리뷰어가 `full_review_requested=yes`로 full review를 요청한다.

**분할(사용자 2분할)**: B-3 = B-3a(escalation, 완료) + **B-3b(생략)**.

## 변경 요약

- **`DELTA_OMITTED_BODY`**(상수): 미변경 문서 본문 자리. "본문 생략(승인 baseline). 전체가 필요하면
  `full_review_requested: "yes"`" 취지 — B-3a escalation 경로 명시.
- **`assembleReviewPrompt` delta 분기**: 변경 문서(`[변경됨]`)는 **full 본문**, 미변경 문서(`[승인 baseline]`)는
  **`DELTA_OMITTED_BODY`로 본문 생략**. 헤더·태그 유지. full 분기(`else`)·phase 무변경.

🔴 **바인딩 무변경**(R4): `captureDesignBinding.designHash`는 여전히 full 설계를 바인딩. 생략은 **전송 본문**만
줄인다. "리뷰 대상=바인딩 대상"의 약화는 delta의 의도된 트레이드오프이고 **B-3a escalation이 상쇄**(문맥
부족 시 full 요청). `processResponse`·B-2a 감지·B-2b 계약·B-3a escalation 로직 무변경.

🔴 **cross-cutting(R5)**: 이 변경은 delta 렌더를 바꿔 **B-2a O1-4·B-2b buildExpected("미변경 본문 포함" 단언)를
깬다**(B-2b가 B-2a를 깼던 것과 동형). 두 오라클을 생략 반영으로 **갱신**하고 **전체 스위트로 검증**(isolation은
cross-file 회귀를 놓침 — 034 교훈).

`req-commit.ts`·`machine.schema.json` 무변경.

## 리뷰 포인트

리뷰 포인트는 심사 범위의 하한이다.

1. **🔴 생략이 delta 전용인가**(R1·R3·D2). 변경 문서는 full 본문 유지, 미변경만 생략인가? full 모드(baseline
   없음)·phase는 전부 무변경(모든 본문 포함)인가(O1-3)? 생략 게이트가 `changed` 기준이 맞는가(O1-2·O1-5)?
2. **🔴 바인딩·안전판**(R4·D3). designHash가 full 설계를 바인딩하는 게 무변경인가? 생략으로 "리뷰 대상≠바인딩
   대상"이 되는 gap을 B-3a escalation이 상쇄하는가 — placeholder가 `full_review_requested` 경로를 안내하는가
   (O1-1)? 이 트레이드오프가 escalation 안전판 위에서 타당한가? B-3b 단독 병합이 안전한가?
3. **🔴 cross-cutting 갱신**(R5·D4). B-2a O1-4·B-2b buildExpected 갱신이 맞는가? **전체 스위트 그린**으로
   B-2a/B-2b 회귀가 없음을 확인하는가? isolation만 보고 놓치지 않는가(034 교훈 반영)?
4. **무회귀 golden**(R3). O1-2(delta 생략)·O1-3(full/phase 무변경)이 하드코딩 golden 전체 `===`로 SUT 독립
   검증하는가(033 tautology 회피)? O1-4/O1-5 near-e2e가 hand-built expected인가?
5. **zero-change**(D2). 모두 미변경이면 세 본문 다 생략인가(O1-5)? degenerate지만 정상(재승인)인가?
6. **분할·완결**. B-3b가 delta review(B-1~B-3a)의 마지막 조각으로 맞는가? 생략을 escalation 뒤로 미룬 게
   옳았는가(생략은 안전판 위에서만 안전)?
7. **oracle**. O1-1~O1-5 + cross-cutting 갱신이 각 "→ 실패해야 하는 구현"(미변경 본문 미생략·변경 본문 생략·
   full/phase 생략 누수·placeholder escalation 누락)을 실제로 실패시키는가?
