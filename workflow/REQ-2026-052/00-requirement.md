# REQ-2026-052 요구사항

durable checkpoint(pre-call opened 커밋) + close proof 상태모델 + req:new 게이트 + 재구성

## 배경

REQ-2026-051(B1)은 `responses/review-ledger.jsonl`에 `attempt-opened`/`attempt-closed`를 기록하고 design 승인·phase evidence-finalize 시 자동 커밋한다. **승인까지 도달한 series**의 감사 보존에는 효과가 있다.

그러나 그 사이 구간에는 갭이 남는다:

- `attempt-opened`는 외부 호출 **전** 워킹트리에 쓰이지만 **커밋은 다음 durable checkpoint(승인)에서야** 일어난다.
- NEEDS_FIX 후 사람이 교체/중단하거나, 다음 checkpoint 전에 워킹트리 변경이 폐기되면 **원장 자체가 소실**될 수 있다.
- 따라서 "원장이 있다"(working tree)와 "원장이 durable하다"(HEAD committed blob)를 **구분**해야 한다.

`state.json`은 계속 scratch/cache이며 커밋 정본으로 되돌리지 않는다.

## 목표

새 버전으로 생성된 티켓은, scratch state가 사라지거나 브랜치 전환·외부 폐기가 발생해도 **거짓 없이** 판별할 수 있어야 한다:

1. 어떤 리뷰 attempt가 시작됐는가
2. 마지막으로 내구화된 attempt/event는 어디까지인가
3. 티켓이 개발 완료·통합 대기·종료 중 어느 상태인가
4. 새 REQ 생성이 허용되는가
5. 복원된 기록과 원본 기록을 구분할 수 있는가

## 필수 설계 원칙

- **`attempt-opened`가 외부 호출 전에 durable하지 않으면 B2의 근본 요구를 충족하지 못한다.**
- attempt마다 무조건 **2개 커밋**을 만드는 방식은 비용·사용성 분석 뒤에만 채택한다. 더 적은 커밋으로 같은 내구성을 낼 수 있으면 그 대안을 설계한다. 단, 비용 절감을 이유로 "미승인·미종결 호출이 다시 소실될 수 있음"을 허용하지 않는다.
- **`attempt-closed`가 유실돼도 durable `attempt-opened`만으로 "예산을 사용했고 결과는 미확정"을 판별 가능**해야 한다.
- 사람이 실행하는 replace/human-resolution/종결 경로는 **ledger와 close proof를 함께 내구화**한다.
- 원장이 없거나 끊긴 기존 티켓을 정상 완료로 꾸미지 않는다.
- prompt 본문·응답 본문·민감 데이터는 ledger·close proof에 저장하지 않는다(해시까지만).
- **모든 내구성 판정은 working tree가 아니라 HEAD의 커밋된 blob 기준**이다.

## 비목표 (별도 REQ)

- **C** = 리뷰호출 lifecycle 실패 분류(`pre_dispatch_failed`·`dispatch_confirmed`·`dispatched_unknown`)와 예산 차감 규칙 변경. 이 REQ는 `lifecycle` 값을 바꾸지 않는다(B1이 남긴 `completed`만 유지).
- **D** = `req:review-exception` 전용 명령 + 구조화 rationale.
- **E** = lockfile 프롬프트 축소.

## 인수 기준(회귀 테스트와 1:1)

1. 외부 호출 직전의 durable `attempt-opened`가 process 종료 후에도 HEAD에서 보인다.
2. `attempt-opened`만 있고 `attempt-closed`가 없으면 다음 행동과 `req:new`가 정확히 차단·안내한다.
3. NEEDS_FIX 후 replace/human-resolution으로 종결해도 ledger와 terminal proof가 커밋된다.
4. 정상 design 승인·phase 승인·evidence-finalize·DONE 흐름이 기존처럼 동작한다.
5. phase 승인 뒤 evidence commit 실패와 재시도에서 중복 ledger/close proof가 없다.
6. scratch state를 삭제·외부 폐기한 뒤 main에서 `req:new`를 실행해도 durable proof 부재를 감지한다.
7. legacy marker 없는 티켓은 기존 동작을 유지한다.
8. reconstructed ticket은 원본과 구별되며, 검증 불가능한 값을 만들지 않는다.
9. `AWAIT_HUMAN`·통합 대기·DONE의 새 REQ 허용/차단 규칙을 각각 검증한다.
10. 전체 테스트·typecheck 통과(장시간이면 분할·합산 보고).
