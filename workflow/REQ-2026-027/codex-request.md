# REQ-2026-027 phase-2 리뷰 요청

## 배경

CommitGate 개선 A-1(REQ-2026-027)의 **phase-2**. 설계는 design-r04 승인(4라운드 수렴).
phase-1(모델 버전·legacy guard·reviewer 주입 seam)은 `4910a207`로 커밋됨.

이 phase는 D2·D3 = **series 계수 모델**이다. **아무것도 막지 않는다** — 예산·상한은 A-2.
"이 series에서 외부 리뷰가 몇 번 일어났는가"를 신뢰 가능하게 세는 것이 목적.

## 변경 요약 (phase-2-series-record-and-attempt)

`scripts/req/review-codex.ts` + 테스트만. 2파일.

**순수 함수**:
- `recordAttempt(state, kind, phaseId)`: 같은 `(kind, phase_id)`의 **열린** series면 `attempts+1`, 없으면 새로
  연다(seq = 같은 키 기존 레코드 수 + 1). **hash를 입력으로 받지 않는다**(R5) — design series는 hash가
  바뀌어도 같은 series. 이것이 REQ-020 14라운드 병리(hash마다 계수 초기화)를 막는 핵심. **아무것도 막지
  않는다**(R11): attempts가 아무리 커도 거부 없음.
- `closeSeriesApproved(state, kind, phaseId)`: 열린 레코드를 `'approved'`로 닫는다. 열린 게 없으면 no-op.
  **`approved`만이 A-1의 자동 종료 계기**(R6) — needs-fix·blocked·invalid는 안 닫아 열린 채 남는다.

**`withAttemptRecorded(ctx, call)`**: `recordAttempt` → `writeState`(호출 **전**) → `call()` → `{result, state}`.
- 순서가 계약(R8): 기록·writeState가 call보다 먼저 → throw해도 되돌아가지 않는다(예산 세탁 차단).
- **반환 state가 후처리의 유일한 base**(R9).

**`main()` 배선**:
- `callReviewer`를 `withAttemptRecorded`로 감싸고 `state = afterAttempt`로 재할당 → baseArgs·finalState가
  전부 그 계보. **단일 할당 지점**이라 outcome별 분기가 없다.
- outcome이 `approved`면 `closeSeriesApproved(finalState, ...)`를 `writeState` 전에 적용.
- **reviewer 복원**(phase-1 observation): `main()`을 try/finally로 감싸 주입 reviewer를 호출 후 기본값으로
  복원한다. programmatic 다중 호출(near-e2e) 오염 방지. CLI(프로세스당 1회)엔 무영향.

## 리뷰 포인트

리뷰 포인트는 심사 범위의 하한이다. 아래에 없는 결함도 지적하라.

1. **🔴 정말 "세기만" 하는가**(R11). `recordAttempt`가 어떤 attempts 값에서도 거부하지 않는가?
   예산·상한 개념이 새어 들어오지 않았는가? O2-6이 `attempts=9`… 는 아니고, near-e2e는 1회만 검증한다 —
   고횟수 거부 없음은 순수 함수(3회 누적)로 본다. 이 커버리지가 충분한가?

2. **🔴 반환 state handoff가 실제로 배선됐는가**(R9·D3). `main()`에서 `state = afterAttempt` 후 baseArgs가
   그 `state`를 참조한다. 호출 전 state를 후처리에 쓰는 경로가 남아 있는가? near-e2e O2-6이 네 outcome
   전부에서 attempts=1 보존을 단언하는데, 이게 회귀를 실제로 잡는가?

3. **🔴 `approved`만 종료가 맞는가**(R6). `closeSeriesApproved`를 `outcome==='approved'`에서만 부른다.
   needs-fix·blocked·invalid에서 series가 열린 채 남는 것이 near-e2e로 확인되는가? invalid에서도 attempt가
   기록되고 series가 열린 채인 것이 맞는가(무효 응답도 외부 호출은 일어났으므로)?

4. **series 재개방**(R7). `approved`로 닫힌 뒤 재해소하면 새 레코드(seq 증가)·이전 보존(O2-4). 이게 계수를
   부당하게 리셋하지 않는가? (A-2가 `human-resolution` terminal을 더할 자리는 phase-1에서 열어둠 —
   `closed_reason: 'approved' | null` 확장 가능 타입.)

5. **reviewer 복원**(phase-1 observation 대응). try/finally로 `main()` 후 기본 reviewer 복원. O2-7이
   "재주입 없이 부르면 fake가 재사용 안 됨"으로 검증. 복원이 정말 되는가, exit 경로(process.exit)에서도?

6. **near-e2e 하네스의 신뢰성**. fake reviewer canned 응답으로 main()을 실제로 돌린다. review_base_sha를
   repo HEAD와 맞추고 실 machine.schema.json을 복사했다. 이 하네스가 **진짜 배선을 태우는가**, 아니면
   우회하는가? invalid outcome이 실제로 invalid로 분류되는가(merge_ready=yes 모순)?

7. **oracle이 회귀를 잡는가**. O2-1(hash 달라도 series 1개)·O2-3(approved만 종료)·O2-5(throw해도 보존)·
   O2-6(네 outcome attempt 보존)·O2-8(state.json SCRATCH·타 파일 검출)·O2-9(fresh-thread가 series 무변경).
   각 "→ 실패해야 하는 구현"이 실제로 실패하는가?
