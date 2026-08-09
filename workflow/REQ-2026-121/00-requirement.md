# REQ-2026-121 요구사항

design-finalize 커밋에 승인 상태 동승 — 부기 커밋 절감(REQ-2026-057 DEC-1의 부분 재개정)

## 배경 (무엇이 문제인가)

소비자 3곳 실측(2026-08-10, `--grep` trailer 기준): 부기 커밋이 전체 커밋의 **61.5%**(6,097/9,915)이고,
그중 `state checkpoint`가 **1,526건(~25%)**이다. checkpoint는 finalize 커밋 **직후에 항상 따라오는
같은 논리 단위**("이 승인이 반영된 상태")의 별도 커밋이다 — 정보를 더하지 않고 커밋 수만 배가한다.

REQ-2026-057 DEC-1은 "증거 커밋에 상태를 끼워 넣지 않는다"를 **의도적으로** 결정했다 — 근거는
"responses/ 외 staged 금지" 가드(코드/state 누수의 마지막 방어선) 보존이었다. 이 REQ는 그 결정을
**부분 재개정**한다: 가드를 없애는 것이 아니라, 화이트리스트에 **정확히 그 티켓의 `state.json`
한 경로**를 추가한다(임의 경로 허용이 아님 — 코드 누수 방어는 그대로다).

**범위는 design 경로만이다.** design 승인 흐름은 상태가 finalize **전에** 이미 기록돼 있어
(`writeState` → `durableDesignEvidence` → checkpoint) 동승이 순서 불변식을 건드리지 않는다.
phase 경로(`finalizeEvidenceAndConsume`)는 "소비는 evidence-finalize 성공 **뒤**"라는 복구
불변식(B2/B3)이 있어 동승하려면 소비 순서 재설계가 필요하다 — **의도적 비목표**로 남기고
별도 REQ에서 다룬다(design만으로 checkpoint의 ~40%·전체 부기의 ~10%p 절감: 3곳 design-finalize
626건과 짝인 checkpoint가 대상).

## 요구

- **R1** — design 승인 시 `durableDesignEvidence`의 finalize 커밋이 티켓 `state.json`을 **같은
  커밋에** 싣는다(pathspec에 추가). 별도 `state checkpoint 커밋(design 승인)`은 그 경우 생기지
  않는다(동승 성공 시 checkpoint는 무변경 no-op).
- **R2** — 동승하는 state는 **checkpoint와 같은 검증**을 통과해야 한다: 디스크 내용 = 방금 쓴
  상태의 직렬화(바이트 대조) · 상태의 `id` = 대상 티켓. 검증 실패 시 **state 없이 기존대로**
  finalize하고(증거가 우선) 기존 checkpoint 경로가 폴백으로 남는다 — 실패 정책 무회귀.
- **R3** — "responses/ 외 staged 금지" 가드는 유지하되 허용 목록이
  `responses/**` ∪ {`<ticketRel>/state.json`}이 된다. 그 외 경로는 여전히 fail-closed.
- **R4** — 커밋 메시지에 state 동승 사실을 표기한다(감사 시 커밋 내용과 메시지가 일치).
- **R5** — 멱등·복구 경로(`already-durable`·`recommitted`) 무회귀: 재실행 시 중복 커밋·중복
  행이 생기지 않는다.

## 제약

- 감사 내용 무손실: 기존 2커밋과 새 1커밋의 **파일 내용은 동일**하다(경계만 다름). 증거 삭제·
  압축·요약 없음.
- phase 경로(`finalizeEvidenceAndConsume`)·pre-call 원장 커밋·기타 checkpoint 지점 무변경.
- 기존 이력(2커밋 형태) 소급 변경 없음 — verify-range·D-체크는 커밋 경계에 무의존이므로 영향 없음
  (설계에서 확인·명시).

## 완료 기준

1. design 승인 정상 경로에서 finalize 커밋 하나에 responses 증거 + `state.json`이 함께 들어가고,
   직후 별도 checkpoint 커밋이 생기지 않는다(near-e2e — 커밋 수·파일 목록 단언).
2. state 검증 실패(디스크 불일치) 시 기존 동작: state 없는 finalize + 폴백 checkpoint 경로(경고).
3. 허용 목록 밖 경로가 stagePaths에 섞이면 여전히 throw(가드 변이 검사 — state.json 허용이
   다른 경로까지 열지 않았음을 고정).
4. `already-durable` 멱등 재실행에서 추가 커밋 0.
5. 관련 기존 테스트(evidence·checkpoint·review-lifecycle) 그린.
