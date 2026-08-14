# REQ-2026-150 요구사항

## 무엇을

`req:commit --finalize` 의 **checkpoint 복구**가 "이 소비의 증거"를 확인하게 한다. 지금은 확인하지 않아
**완료된 티켓에서 `state.json` 을 임의로 고쳐도 D10 예외가 열린다**.

## 왜 — 외부 리뷰 결함 3(실측)

`scripts/req/lib/evidence-recovery.ts` 의 checkpoint 분기는 세 가지만 본다:
① `approval_evidence` 없음 ② 더러운 것이 `state.json` 뿐 ③ **HEAD 매니페스트가 비어 있지 않음**.

③이 너무 약하다. 완료된 티켓에는 옛 승인 행이 당연히 있으므로, `state.json` 의 아무 필드나 고치고
`req:commit --finalize --run` 하면 "복구"로 오판해 그 임의 변경이 커밋된다.

## 🔴 기각된 판별자 3종 (REQ-2026-148 설계 8라운드가 태운 값 — 재검토 불요)

| # | 판별자 | 왜 기각됐나 |
|---|---|---|
| 1 | 워킹 state 의 마지막 소비 항목이 HEAD state 에 없으면 Ready | **워킹 트리는 위조 가능**하다. HEAD 매니페스트 행을 베껴 워킹 `consumed_approvals` 에 붙이면 그대로 통과한다(148-r04) |
| 2 | HEAD state 의 `commit_allowed=true` + `approval_evidence` 존재 | **그 상태는 HEAD 에 없다.** phase 승인은 워킹 state 에만 쓰이고 source 커밋은 state 를 staged 금지한다 — 정상 창을 **전부** 막는다(148-r05) |
| 3 | 동일성 키에 `approval_consumed_at` 포함 | **변조 가능한 값을 키로 쓰면** 그 필드 하나로 판정이 뒤집힌다(148-r03) |

🔴 여기서 나온 규칙: **판정 입력은 커밋해야만 바꿀 수 있는 것이어야 한다.** 커밋이 곧 이 게이트가
통제하는 대상이므로, 그때만 위조 비용이 게이트를 통과하는 비용과 같아진다.

## 제약

- 🔴 **정상 crash window 는 `--finalize --run` 한 번으로 수렴**해야 한다. REQ-2026-142 가 연 경로를
  막으면 이 REQ 는 실패다 — 그 무회귀가 첫 오라클이다.
- 🔴 **`consumeState` 의 producer·스키마를 바꾸지 않는다.** 새 필드를 넣으면 마이그레이션이 따라붙고
  옛 티켓은 여전히 그 필드가 없다.
- 🔴 D10 의 일반 판정은 변경하지 않는다(`recoveryAllowlist === undefined` 에서 종전과 동일).

## 완료 기준

1. 정상 crash window(증거 커밋 → 소비 state write → checkpoint 전 중단)가 **한 번에 수렴**한다.
2. 완료된 티켓의 `state.json` 임의 수정은 **거부**되고 D10 이 종전처럼 차단한다.
   - 임의 필드 수정 · `approval_consumed_at` 만 변조 · **매니페스트 행을 워킹 `consumed_approvals` 에
     복사** — 셋 다 거부.
3. 판정 입력이 전부 **커밋된 것**이다(워킹 state 는 더러움 **범위** 확인에만 쓴다).
