# REQ-2026-054 요구사항

리뷰 호출 lifecycle 분류 + pre-dispatch 무차감 예산 규칙 (yammy 운영감사 후속 C)

## 문제

리뷰 호출(`codex`)의 attempt는 **외부 호출 전에** 예산이 차감되고 원장에 `attempt-opened`가 커밋된다
(REQ-2026-051/052). 호출이 실패하면 현재:

- `attempt-closed`가 **아예 안 남는다**(예외가 전파돼 그 뒤 코드가 실행 안 됨) → 원장에 "opened만 있고
  closed 없음"으로 남는다. 이는 **어떤 실패든** 뭉뚱그린다: codex 바이너리 부재(호출조차 안 됨)와
  usage-limit로 모델이 부분 실행된 경우가 구별되지 않는다.
- 예산은 **무조건 차감**된다 — codex가 **뜨지도 못한**(spawn 실패) 명백한 pre-dispatch 실패에도 회차가
  소진된다. 소비자에서 "명령 실패(exit=1): codex"(usage limit)가 회차를 태우는 마찰이 관측됐다.

`review-ledger`의 `lifecycle` 필드(B1이 forward-compat로 마련·현재 `completed`만 씀)를 실제로 채워 이를 해소한다.

## 목표

1. **호출 lifecycle 분류**(원장 `lifecycle`): `completed`(정상 판정) / `pre_dispatch_failed`(subprocess 미기동) /
   `dispatched_unknown`(기동했으나 사용 가능한 결과 없음) / `dispatch_confirmed`(모델 응답 확인 후 후처리 실패).
   실패도 `attempt-closed`를 남겨 "왜 끝났는지"가 원장에 기록된다(조용한 unclosed 축소).
2. **예산 차감 규칙**: **명백한 pre-dispatch 실패만 무차감**(회차 환불). dispatch 후·불명은 fail-closed 차감.
   "명백한"은 **타입된 신호**(subprocess spawn 실패)로만 판정 — 문자열 추측 금지. 애매하면 차감(fail-closed).

## 비목표

- 실패 재시도 자동화·타임아웃·resume 정책 변경 없음(별도).
- 예산 상한(autoBudget/hardCap) 값 변경 없음 — 차감 **규칙**만 정교화.
- 원장 스키마 **키 추가/제거 없음** — 기존 `lifecycle` 필드의 **값**만 확장(forward-compat 설계 그대로).

## 완료 기준

- pre-dispatch 실패 → 원장 `attempt-closed(pre_dispatch_failed)` + 예산 환불(재시도가 회차 안 태움).
- dispatch 후 실패 → `attempt-closed(dispatched_unknown|dispatch_confirmed)` + 차감 유지.
- 정상 → `completed`(불변). 단위·실git 테스트 그린·typecheck 0·smoke 그린.
