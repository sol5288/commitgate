# REQ-2026-027 리뷰 요청

## 배경

CommitGate **리뷰 수렴·배송 안정화 개선 A-1**. A0(REQ-2026-025)는 main `b91a73f`에 병합됐다.

**출처와 종료 이력(투명 공개)**: REQ-2026-026(REQ-A)이 series 모델·예산·escalation·lineage·로그를
**한 REQ에 다 담아** 설계 755줄에 design 리뷰 **6라운드 미수렴**으로 종료됐다(사람 결정 "권장하는 A 로 진행",
merge 금지 감사 보존). P1 추이 3·3·4·1·1·4 — r06 P1-1은 r05 수정이 직접 유발(모순 A를 고치는 편집이
모순 B를 생성). 실측: REQ-025(A0) 274줄→1라운드, REQ-020 720줄→14라운드. **표면이 원인이었다.**

이 REQ(A-1)는 그 종료 REQ의 **D1~D3 = 계수 모델까지만**이다. **아무것도 막지 않는다** — 예산·상한·
escalation·차단·lineage·로그 확장은 전부 A-2다. A-1은 "이 series에서 외부 리뷰가 몇 번 일어났는가"를
신뢰 가능하게 **세기만** 한다. 그래야 A-2가 그 위에 게이트를 얹는다.

026 리뷰가 남긴 유효 지적 중 **A-1 범위(계수 모델)에 해당하는 것을 처음부터 반영**했다:
- ② wrapper attempt를 후처리가 pre-call state로 되돌림 → §D3 반환 state handoff 계약
- ⑦ "호출 전 writeState가 D10에 걸린다"는 **오탐** → 실측으로 확인(§D3, `state.json`은 이미 SCRATCH)
- ⑧ legacy `AWAIT_HUMAN`이 `req:next`에 없음 → §D1 2경로
- ⑨ 종료 사유를 선언만 하고 쓰는 지점 없음 → §D2 `approved` 쓰는 지점 명시

## design-r01 지적 반영 (P1 2건 — 둘 다 유효)

1. 🔴 **phase 순서가 거꾸로였다.** "계수 먼저"라며 D3 배선을 phase-1에 뒀는데, 그러면 **phase-1만 병합된
   중간 상태에서 legacy 티켓이 R2를 위반**한다(RUN 안내 따라 attempt 기록·외부 호출). 그리고 D1은 레코드
   유무가 아니라 **생성 시 모델 버전**으로 판정하므로 "계수 먼저" 의존성은 애초에 없다.
   → **순서를 뒤집었다: phase-1 = D1(legacy guard), phase-2 = D2·D3(계수·배선).** 각 phase는 병합돼도
   안전해야 하고, legacy 보호가 attempt 기록보다 먼저 main에 있어야 한다.
2. 🔴 **O1-5가 main() 배선을 못 잡았다.** 테스트가 `afterAttempt`를 직접 `processResponse`에 넘겨,
   정작 `main()`이 pre-call state를 쓰는 회귀를 놓쳤다. "리뷰어 diff 확인"은 R9의 유일한 방어선에 약하다.
   → **reviewer를 주입 가능하게** 만든다(`const`→`let` + `main(argv, {reviewer?})` — 바로 옆 `gitAdapter`가
   이미 쓰는 선례). 가짜 reviewer로 `main()`을 **near-e2e**로 돌려 실제 배선을 검증(O2-6). 기본값은
   `createCodexReviewerAdapter()`라 프로덕션 동작 불변(O2-9).

## design-r02 지적 반영 (P1 2건 — 둘 다 오라클 강화)

1. 🔴 **O1-3이 "호출 먼저 하고 throw"를 못 잡았다.** "throw + state 바이트 동일"만 검사하면, legacy에서
   `callReviewer()`를 먼저 하고 나서 throw하는 구현도 통과한다 — R2의 요점("legacy에 외부 호출 0회")이 샌다.
   → O1-3을 **near-e2e**로 바꿔 가짜 reviewer의 **exec/resume 호출 카운터가 0**임을 단언한다. 이 때문에
   **reviewer 주입 seam이 phase-2가 아니라 phase-1의 첫 작업**이 됐다(legacy fail-closed 증명에 먼저 필요).
2. 🔴 **"세기만 한다"(R11)를 저횟수로만 검증했다.** O2-1이 3회까지만 봐서, `attempts>=3`이면 거부하는
   잘못된 예산 게이트도 통과한다 → 4번째 정상 리뷰를 막는다(A-1 계약 위반).
   → **O2-7 추가**: `attempts=9` 열린 series + 변경된 바인딩에서 `main()`이 reviewer를 **실제 호출**하고
   `attempts`를 **10으로 보존**함을 near-e2e로 단언. 고횟수에서 거부 없음을 명시.

observation 2건: (a) 이 티켓 자신의 채택 규칙을 계획에 한 줄 명시(phase-1 후 사람이 명시적 stamp — 자동
이관 아님). (b) `series_id` 예시를 생성식과 일치(`design:-#1`).

## design-r03 지적 반영 (P1 2건 — 둘 다 내 앞선 수정이 만든 후속)

1. 🔴 **stamp 순서가 자기모순이었다.** "phase-1 구현·커밋 **직후** stamp"라고 썼는데, 커밋하려면 phase 리뷰
   승인이 필요하고 그 호출 지점에서 이 티켓이 model version 없어 **legacy로 throw** → 커밋에 도달 못 함.
   → 계획의 운영 순서를 **"구현·add → phase 리뷰 요청 **전**에 stamp → 리뷰"**로 바로잡았다.
2. 🔴 **O2-6이 NEEDS_FIX·approved만 봤다.** blocked·invalid 후처리에 pre-call state를 쓰는 구현이 통과해
   그 응답 뒤 attempt가 되돌아간다(계수 신뢰 상실).
   → O2-6을 **네 outcome(approved·needs-fix·blocked·invalid) 전부** near-e2e로 확장.

observation: phase-2 범위 문구에 seam이 중복돼 있던 것 제거(seam은 phase-1 산출물).

## 변경 요약

설계 문서 3종만 제출한다(구현 diff 없음 — design 리뷰). 2 phase. **legacy guard가 먼저다.**

- **phase-1 (D1)**: `req:new` 스캐폴드에 `review_series_model_version: 1` · legacy 2경로
  (`resolveNext` 안내 `AWAIT_HUMAN` + 호출 지점 강제 throw).
- **phase-2 (D2·D3)**: `SeriesRecord{series_id, review_kind, phase_id, attempts, closed_reason}` ·
  series 해소(같은 `(kind, phase_id)` 열린 것 재사용, hash 무관) · `approved`만 자동 종료 ·
  `withAttemptRecorded(ctx, call)`(호출 직전 기록, throw해도 보존, **반환 state가 후처리 base**) ·
  reviewer 주입 seam(near-e2e 배선 검증).

`machine.schema.json`·G1·G2·`classifyReview`·승인 바인딩·BLOCKED/INVALID/D9 **무변경**.
`SeriesRecord.closed_reason` 타입은 `'approved' | null`이며 A-2가 `'human-resolution'`을 **추가**한다(열린 확장).

## 리뷰 포인트

리뷰 포인트는 심사 범위의 하한이다. 아래에 없는 결함도 지적하라.

1. **🔴 범위가 정말 "세기만" 하는가.** A-1이 실수로 무언가를 **막지** 않는가? attempt가 어떤 값에서도
   리뷰를 거부하지 않는가(legacy `AWAIT_HUMAN` 제외 — 그건 계수가 아니라 안전 구분)? 예산·상한 개념이
   새어 들어오지 않았는가?

2. **🔴 반환 state handoff 계약이 충분한가** (§D3). "wrapper 반환 state가 호출 이후 모든 처리의 유일한
   base"라고 했다. `main()`에는 호출 **전** state를 읽는 다른 지점(`blockedTarget`·`designValid` 계산 등)이
   있다 — 그것들이 pre-call state를 쓰는 것은 정당한가, 계약이 "어디까지"인지 모호하지 않은가?

3. **🔴 `approved`만 자동 종료가 맞는가** (§D2·O1-3). `needs-fix`·`blocked`·`invalid`에서 안 닫는 것이
   A-2 상한의 전제다. `invalid`가 2회 누적되면 기존 G2가 BLOCKED를 내는데(무변경), 그때 series는 열린 채로
   남는다 — 이게 A-1에서 문제가 되는가, 아니면 A-2가 다룰 상태인가?

4. **series 재개방 규칙** (§D2·O1-4). `approved` 뒤 같은 `(kind, phase_id)`를 재해소하면 새 series가 열린다.
   승인 후 설계가 또 바뀌는 정상 경로다 — 이게 계수를 부당하게 리셋하는 통로가 되지 않는가?
   (A-2가 `human-resolution` terminal을 더할 자리를 §D2에 열어뒀다.)

5. **legacy 판정 위치** (§D1). `resolveNext`에서 `commit_allowed` 다음, design/phase RUN 후보 **전**에
   legacy를 본다. 이 순서가 옳은가? 살아 있는 승인이 legacy보다 우선하는 것이 맞는가?

6. **phase 순서 = legacy guard 먼저** (계획, r01 P1 반영). phase-1=D1(모델·legacy), phase-2=D2·D3(계수·배선)로
   뒤집었다. 근거: 각 phase는 병합돼도 안전해야 하고, phase-1만 병합된 상태에서 legacy 티켓이 attempt를
   기록당하면 안 된다. 이 순서가 옳은가? 두 phase 각각의 병합 지점이 안전한 상태인가?

7. **🔴 reviewer 주입 seam** (§D3, r01 P1 반영). `const reviewer`를 `let` + `main(argv, {reviewer?})`로 바꿔
   near-e2e 오라클(O2-6)을 가능하게 했다. 바로 옆 `gitAdapter`가 같은 패턴을 쓴다. 이 주입이 프로덕션 경로를
   바꾸지 않는가(O2-9)? seam이 R9 배선 회귀를 실제로 실패시키는가, 아니면 여전히 우회 가능한가?

8. **oracle이 실제 회귀를 잡는가** (계획). 특히 O1-2/O1-3(legacy가 req:next AWAIT_HUMAN + 호출 throw +
   state 바이트 무변경)·O2-1(hash 달라도 series 1개)·O2-5(throw해도 보존)·**O2-6(near-e2e로 pre-call state
   회귀 잡기)**·O2-7(state.json SCRATCH). 각 "→ 실패해야 하는 구현"이 실제로 실패하는가?

9. **A-1 단독 병합이 정당한가** (§하위호환·안전). A-1만으로는 상한이 없다(계수만 있고 게이트 없음).
   그래도 additive로 단독 병합한다는 판단이 옳은가, 아니면 A-2와 묶여야 하는가?
   (지시서: 완료된 additive REQ는 독립 병합. A0도 그랬다.)
