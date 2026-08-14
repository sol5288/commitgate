# REQ-2026-151 요구사항

## 무엇을

**종결된 티켓에는 되돌릴 수 없는 source 커밋을 만들지 않고, checkpoint 복구는 정확히 도구가 만든
소비 state 만 커밋한다.**

## 왜 — 두 결함 (외부 리뷰, 실측)

### P1 — `dev-complete` 재진입이 source 커밋을 먼저 만들고 교착한다

`req:commit --run` 정상 경로는 종결 여부를 **source 커밋 전에 보지 않는다**.

```
① doctor 통과 → ② HIGH 게이트 → ③ source 커밋 ← 되돌릴 수 없는 것을 여기서 한다
④ emitDevCompleteIfLastPhase → close-proof 자연키 충돌 → throw
```

그 뒤로는 `approvals.jsonl`·아카이브가 더러워 **D10 이 이후 모든 `req:commit` 을 막고 `--finalize`
도 같은 자리에서 막힌다**. 이미 만들어진 source 커밋은 자동으로 되돌릴 수도 없다.

🔴 **이 세션이 실제로 밟았다**(REQ-2026-149 회귀 수정을 완결 티켓에 덧붙이다가). 손수 부기하고
`attest` 로 빠져나왔다 — 규범 밖 조치였다.

🔴 **`emitDevCompleteIfLastPhase` 를 조용히 멱등으로 만드는 것은 답이 아니다.** 완료된 티켓에 새
작업이 소리 없이 붙어 lifecycle 의미가 흐려진다. **source 커밋 前에 차단**하고, 재개가 필요하면
successor 또는 **명시적 reopen 전이**를 따로 둔다.

### P2 — checkpoint 복구가 임의 `state.json` 변경을 함께 커밋한다

REQ-2026-150 의 판별자 A/B/C 는 **HEAD 쪽 사실**만 본다. 워킹 `state.json` 이 실제
`consumeState` 산출과 같은지는 확인하지 않는다. 그래서 crash window 안에서 `policy_snapshot`·
`risk_level`·`phases`·`user_commit_confirmed` 를 고쳐도 "소비 checkpoint 복구" 커밋에 함께 실린다.

crash 와 편집이 **둘 다** 필요해 P1 은 아니지만, D10 예외가 주장하는 "정확히 필요한 것만" 보다 넓다.

## 제약

- 🔴 **정상 crash window 는 `--finalize --run` 한 번으로 수렴**해야 한다(REQ-2026-142 무회귀).
- 🔴 **종결 판정은 HEAD 정본**을 쓴다 — `scanTicketIntake`(그 술어와 **입력 획득까지**). 같은 술어를
  쓰고도 입력이 달라 판독이 갈린 전례가 있다(REQ-2026-094).
- 🔴 duplicate/conflict 를 **조용히 무시하지 않는다.**
- 🔴 시각처럼 **변조 가능한 값**을 결속 키로 쓰지 않는다(REQ-2026-148 r03).

## 완료 기준

1. 종결(`dev-complete`) 티켓에서 `req:commit --run` 이 **source 커밋 전에** 막힌다 —
   HEAD SHA·커밋 수 불변, 새 더러움 없음, 안내가 실행 가능한 다음 단계를 준다.
2. checkpoint 복구가 **도구가 만든 소비 state 와 바이트로 일치할 때만** 열린다.
   임의 필드 추가·`risk_level`·`policy_snapshot`·`phases`·`user_commit_confirmed` 변조는 전부 거부.
3. 정상 crash window 는 여전히 한 번에 수렴한다.
