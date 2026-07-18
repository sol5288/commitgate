# REQ-2026-036 요구사항 — delta 미변경 문서 본문 생략 (개선 REQ-B-3b)

## 1. 배경

delta review([[req-2026-031-delta-review-b1]]) 파이프라인: B-1(저장)·B-2a(감지·표시)·B-2b(계약)·B-3a
(FULL_REVIEW_REQUESTED escalation). B-2a는 **안전을 위해 미변경 문서 본문도 full로 포함**했다(문맥 무손실).
이제 B-3a escalation 안전판이 섰으니, **미변경 문서 본문을 실제로 생략**해 토큰을 절감해도 안전하다 —
리뷰어가 생략된 문맥이 필요하면 `full_review_requested=yes`로 full review를 요청할 수 있다.

**분할(사용자 2분할)**: B-3 = B-3a(escalation, 완료) + **B-3b(미변경 문서 실제 생략)**. B-3b가 마지막 조각.

## 2. 목표(What)

design **delta 재리뷰**의 authority 블록에서, **변경 문서(`[변경됨]`)는 full 본문**을 유지하고 **미변경 문서
(`[승인 baseline]`)는 본문을 생략**한다(헤더+태그는 유지, 본문 자리에 생략 placeholder). placeholder는 전체가
필요하면 `full_review_requested=yes`(B-3a)로 요청하라고 안내한다.

**🔴 delta 모드에서만.** full 모드(baseline 없음)·phase 리뷰는 전부 무변경(모든 본문 포함).

## 3. 요구(정규화)

### 생략

- **R1 미변경 문서 본문 생략(delta 렌더)**: `assembleReviewPrompt`의 delta 분기에서 **미변경 문서(`changed`에
  없는 키)의 본문을 생략** placeholder로 대체한다. 변경 문서는 full 본문 유지. 헤더·태그(`## XX.md [승인
  baseline...]`)는 유지. (Done #1)
- **R2 생략 placeholder + escalation 안내**: 생략 자리에 코드 상수 `DELTA_OMITTED_BODY`를 넣는다. 내용 = "본문
  생략(승인 baseline·변경 없음). 전체가 필요하면 `full_review_requested: "yes"`로 full review 요청" 취지 —
  B-3a escalation 경로를 명시(생략이 문맥을 숨긴 위험의 안전판). (Done #1)

### 범위·안전

- **R3 🔴 full·phase 무회귀**: full 모드(baseline 없음)·phase 리뷰는 **모든 본문 포함**(B-3b 이전과 바이트
  동일). 생략은 delta 분기(designDelta 있음)에만. (constraints)
- **R4 🔴 바인딩 무변경**: `captureDesignBinding.designHash`는 여전히 full 현재 설계를 바인딩한다. 생략은
  **전송 내용**만 줄인다(승인이 무엇을 바인딩하는지 무변경). 리뷰어가 delta만 보고 승인해도 승인은 full
  설계를 의미하고, 그 gap의 안전판이 B-3a다(생략으로 문맥이 부족하면 full 요청). `processResponse`·B-2a
  감지·B-2b 계약·B-3a escalation 로직 무변경. (constraints)
- **R5 🔴 상위 오라클 갱신(cross-cutting)**: 이 변경은 delta 렌더를 바꾼다 → **B-2a·B-2b의 "미변경 본문
  포함" 단언이 깨진다**(B-2b가 B-2a를 깼던 것과 동형 — [[req-2026-031-delta-review-b1]] 교훈). B-2a O1-4(순수
  delta 렌더 본문 존재)와 B-2b `buildExpected`(전체 본문 재조립 hand-built expected)를 **생략 반영**으로
  갱신한다. **전체 스위트로 검증 필수**(isolation은 놓친다). (constraints)
- **R6 테스트·typecheck**: 단위·typecheck 통과. 생략·placeholder·무회귀·cross-cutting 갱신을 오라클로 고정.

## 4. 비목표 — 이번 범위에서 구현하지 않음

- delta의 실제 토큰 절감 **수치**는 측정하지 않는다(오라클은 생략 **구조**만). 로그 측정(⑫⑬⑭)은 별도 REQ.
- B-1~B-3a 로직 변경. 미변경 문서를 **부분** 생략(예: diff hunk만)은 범위 밖 — 전체 본문 생략(header/tag 유지).
- accept-risk 우회(④). 기존 REQ 소급 수정.

## 5. 인수 기준

1. delta 모드: 변경 문서(`[변경됨]`)는 full 본문, 미변경 문서(`[승인 baseline]`)는 `DELTA_OMITTED_BODY`로
   본문 생략. 헤더·태그 유지.
2. `DELTA_OMITTED_BODY`가 생략 사실 + `full_review_requested` escalation 안내를 담는다.
3. 🔴 full 모드·phase 리뷰는 모든 본문 포함(B-3b 이전과 바이트 동일 — 생략은 delta 전용).
4. 🔴 `captureDesignBinding.designHash`·`processResponse`·B-2a/B-2b/B-3a 로직 무변경.
5. 🔴 cross-cutting: B-2a O1-4·B-2b buildExpected가 생략 반영으로 갱신되고 **전체 스위트 그린**.
6. 단위·typecheck 통과.
