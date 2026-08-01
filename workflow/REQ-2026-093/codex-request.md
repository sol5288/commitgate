# REQ-2026-093 phase-1 리뷰 요청 — `abandoned` 이벤트 + `req:close --abandon`

## 배경

`req:new` intake는 `deriveBaseState`가 `developing`인 durable 티켓 **하나**로 저장소의 모든 후속 작업을
막는데, 그 상태에서 빠져나오는 길이 **완료뿐**이었다. 종결 이벤트 3종 중 사람이 쓸 수 있는 것이 없다
(`dev-complete`=완료 필요 · `migrated-complete`=부분 완료 명시 거부 · `series-terminal`=열린 series 필요
+ **CLI 미배선**). 설계는 r03 승인 상태다.

## 변경 요약 (6파일 — 코드 4 · 테스트 2)

**`lib/close-proof.ts`** — `CloseProofEvent`·`CloseBaseState`에 `abandoned` 추가. 행 필드
`abandon_reason`·`method`(**선택 필드**). 검증: `abandoned`는 두 필드 필수(공백만 거부)·series 축 필드
전부 null·`reconstructed:false` 강제(DEC-6), 그 외 이벤트는 두 필드가 **부재이거나 null**.
`verifiedTerminalEvent`의 **마지막** 후보(DEC-2).

**`lib/intake.ts`** — `abandoned` reason 문구("완료가 아니며, 커밋된 증거는 그대로 남아 있습니다").

**`lib/reconstruct.ts`** — 복원 대상 아님을 헤더에 명시(주석만).

**`req-close.ts`** — `--abandon --reason --confirm` 모드. `--migrate`와 상호배타, 기본 dry-run,
시각은 **실시계 스탬프**, pathspec 커밋.

**테스트** — 모델 24건 + 실 git e2e 14건. 전체 스위트 그린(49파일 **2404**건, +32) · typecheck 0.

## 실측 확인 (실제 진입점 `node bin/commitgate.mjs`)

| 시나리오 | 결과 |
|---|---|
| 이미 종결된 티켓(REQ-2026-092, dev-complete) | `이미 종결(dev-complete) — no-op(write 0)` · exit 0 |
| 진행 중 티켓(REQ-2026-093) dry-run | 계획 출력 · write 없음 · 워킹트리 무변경 |
| `--reason` 누락 / 모드 충돌 / 모드 부재 | 각각 exit **1** |

## 🔴 설계와 다르게 구현한 곳 한 군데 (판단을 봐 주세요)

설계 DEC-3은 "`abandon_reason`·`method`를 `CLOSE_PROOF_KEYS`에 더한다"고 적었다. **그대로 하면 안 된다.**
`closeProofRowProblems`가 그 배열을 **필수 키 목록으로도** 쓰기 때문이다:

```ts
for (const k of CLOSE_PROOF_KEYS) if (!(k in r)) p.push(`필수 키 누락: ${k}`)
```

그냥 넣으면 그 키가 **없는 기존 커밋 행이 전부 "필수 키 누락"** → `classifyIntake`가 corrupt →
**완료된 티켓조차 intake를 통과하지 못한다.** 설계 r01 P1이 지목한 회귀와 같은 결과가 **다른 경로로**
재발한다. 그래서 두 역할을 분리했다 — `CLOSE_PROOF_KEYS`(직렬화 순서 + 허용 목록)는 그대로 두고
`OPTIONAL_KEYS` 집합을 새로 만들어 필수 검사에서만 제외했다. DEC-3a의 규범(부재==null 허용)은
그대로 지켰다.

**질문**: 이 해석이 맞는가? 설계 문구를 정정해야 하는가(그러면 delta 설계 재승인이 필요하다),
아니면 DEC-3a가 이미 규범을 정했으므로 구현 세부로 봐도 되는가?

## 리뷰 포인트

**P1. 포기 경로가 "적게 검사하는 것"이 옳은가.** `runAbandon`은 `--migrate`가 요구하는 mainline 해소·
integrated·매니페스트 무결성을 **하나도 거치지 않는다**. 그것들이 깨진 티켓이야말로 탈출구가 가장
필요한 티켓이고, 특히 `resolveMainline`은 미해소 시 throw하므로 그 경로에 태우면 탈출구가 다시 막힌다고
판단했다. 유일하게 fail-closed로 막는 것은 **close-proof 자신의 손상·미커밋**이다(덧쓰는 대상이라서).
이 경계가 옳은가? 포기를 허용하면 안 되는 상태가 남아 있는가?

**P2. 우선순위(DEC-2) 구현.** `abandoned`를 `verifiedTerminalEvent` 마지막에 뒀다. 테스트로
`dev-complete`·`migrated-complete`가 이기고 `needs-recovery`는 지는 것을 고정했다. 이 배치가
"증거가 불완전한 티켓을 포기로 덮어 복구 기회를 놓치게" 만드는가?

**P3. 기존 행 바이트 무변경.** 새 필드를 TS **선택 필드**로 두어 기존 생산자가 값을 넣지 않고,
`serializeCloseProofRow`가 `undefined`를 JSON에서 생략하므로 기존 행의 직렬화가 그대로다
(멱등 비교가 직렬화 문자열 동일성이라 이게 깨지면 duplicate 판정이 무너진다). 테스트로 고정했는데,
내가 못 본 경로에서 `null`이 명시적으로 들어가 바이트가 달라질 여지가 있는가?

**P4. 가시성 경고의 phase 집합.** 경고 개수는 **design 결속으로 거르지 않은** 전체 커밋 phase를 쓴다.
"무엇이 유효한 완료인가"가 아니라 "무엇이 이미 커밋돼 남는가"를 알리는 것이 목적이라고 판단했다.
맞는가?

**P5. 개발 중 낸 회귀 하나를 공유한다.** `--abandon` 분기를 끼워 넣다가 `parseArgs`에서 **`--run`
분기를 떨어뜨렸다**(`알 수 없는 옵션: --run`). 기존 `--migrate` e2e가 즉시 잡았고, 파서 자신의
계약으로도 고정했다(전용 테스트 추가). 이런 종류를 더 잘 막을 방법이 있는가?

**P6. 멱등의 범위.** 이미 terminal이면 no-op으로 끝낸다. 그런데 **`abandoned` 행이 이미 있는데 사유가
다른** 경우는 `appendCloseProofRow`가 conflict를 낸다(no-op 검사에서 이미 걸러지므로 실제로는 도달
불가). 도달 불가 코드를 남겨 두는 것이 맞는가, 아니면 그 경로를 명시적으로 처리해야 하는가?
