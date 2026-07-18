# REQ-2026-028 phase-2 리뷰 요청

## 배경

CommitGate 개선 **A-2a phase-2** — `req:next` G3 안내. phase-1(예산 게이트 강제)은 `46381154`로 커밋됨.
설계는 design-r04 승인. 이 phase가 A-2a의 마지막이다.

phase-1은 **호출 지점 강제**(외부 호출 직전 throw)를 넣었다. 이 phase는 **`req:next` 안내** — 사람이
`req:review-codex`를 실행하기 **전에** "이 series가 예산을 소진했다"를 알게 한다. 강제는 여전히 호출 지점이
담당하고, G3는 UX다.

## phase-2 r01 지적 반영 (P1 1건)

1. 🔴 **soft-escalated 문구에 "위험 수용" 표현**: "위험 수용은 이 도구의 선택지가 아니다"가 그 단어를
   부정문으로 포함 → 인수 기준("어느 G3 문구에도 위험 수용 없음") 위반. O2-5가 hard-blocked만 봐서 놓침.
   → 부정문 삭제, 긍정 선택지만 나열. **O2-5b 추가**: soft-escalated(attempts=5) 전체 출력에 "위험 수용"
   부재 단언.

## 변경 요약 (phase-2-req-next-g3)

`req-next.ts` + 테스트만. 2파일.

- **G3를 `gateRunCandidate`에 G1과 G2 사이 삽입**(우선순위 G1→G3→G2). 열린 series attempts>=autoBudget
  (escalated, **파생값** — 저장 안 함, R11)이면 `RUN` 대신 **`AWAIT_HUMAN`**.
- **우선순위 근거**(배분표): G3가 G2보다 앞 — 5회차 NEEDS_FIX 직후 escalated와 같은 바인딩 needs-fix가
  동시 성립하는데, G2가 먼저 "findings 고치고 다시 add"(AGENT)를 내면 그 조언이 거짓(고쳐도 사람 승인
  없이 6회차 안 열림). G1이 G3보다 앞 — dirty면 승인해도 D10에서 죽으니 정리 먼저.
- **diagnostics**: 시도 수·직전 리뷰 outcome·선택지. **누적 findings는 없음**(A-2b — last_review는 직전만
  담아 거짓말). **hard-blocked(attempts>=hardCap) 문구 구분**: "예외로도 진행 불가 — 종료/대체 REQ".
  **"위험 수용"은 어느 문구에도 없음**(배분표 ④).
- **`NextInput.reviewBudget`** 추가(순수 입력 — main이 `cfg.reviewBudget`에서 채움).

**무변경**: G1·G2 판정 내용·`commit_allowed` 분기·legacy(A-1)·design/phase RUN. G3는 삽입이며 정상
series(attempts<autoBudget)에서 G2가 종전대로 동작한다.

게이트: typecheck 0, 단위 1110/1110 green.

## 리뷰 포인트

리뷰 포인트는 심사 범위의 하한이다.

1. **🔴 G3 우선순위 G1→G3→G2**(배분표 근거). O2-2가 escalated+같은 바인딩 needs-fix 동시 성립에서
   `AWAIT_HUMAN`(G2의 AGENT 아님)을 확인하는가? O2-3이 dirty+escalated에서 G1 우선(AGENT)을 확인하는가?
   두 조건이 실제로 항상 함께 성립하는가?
2. **🔴 정상 series G2 무변경**(R16). O2-4가 attempts<autoBudget에서 G2 종전 동작(RUN)을 확인하는가?
   G3가 정상 series를 가로채지 않는가?
3. **`escalated`가 파생값인가**(R11). `gateRunCandidate`가 openSeriesAttempts로 그 자리에서 계산하는가?
   state에 저장 안 하는가?
4. **hard-blocked 문구·위험 수용 부재**(R14, 배분표 ④). O2-5가 hardCap 도달 시 문구 구분과 "위험 수용"
   부재를 확인하는가?
5. **강제 vs 안내 경계**. G3는 안내일 뿐 강제는 phase-1 호출 지점 throw다. 사람이 `req:next`를 건너뛰고
   직접 실행해도 호출 지점이 막는가(phase-1 O1-7~O1-10)? 이 이중 구조가 맞는가?
6. **config 예산이 G3 경계를 움직이는가**. O2-6(autoBudget=3이면 attempts=3에서 escalated)이 이를 확인하는가?
7. **기존 분기 무변경**(R16). commit_allowed·design RUN·legacy가 G3 삽입에도 그대로인가?
8. **oracle**. O2-1~O2-6이 각 "→ 실패해야 하는 구현"을 실제로 실패시키는가?
