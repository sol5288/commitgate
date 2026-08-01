# REQ-2026-097 리뷰 요청 — phase-1-terminal-branch-axis

## 배경

소비자 저장소(yammy-sales, commitgate 0.16.0) 버그 리포트 2건 중 두 번째다(첫 번째는 REQ-2026-096으로
해결·통합, main `4f3e10d`).

**종결된 티켓에 `req:doctor`를 돌리면 항상 FAIL(exit 1)이다.** 병합 후 브랜치를 지우는 권장 운영을
하면 D2·D3·D11이 영구히 발화한다. 리포터 저장소에서는 종결 티켓 118건 전부 그렇고, 이 저장소에서도
REQ-2026-072로 재현했다. 귀결은 (1) `req:doctor`를 CI·스크립트 건강 점검으로 쓸 수 없고,
(2) AGENTS.md 계약을 따르는 에이전트가 FAIL을 보고 **종결 티켓의 feature 브랜치를 되살리려 한다**
(리포터 세션에서 실제 발생).

설계는 r02에서 승인됐다(r01 P1 = 입력 계약이 boolean이라 요구된 사유 문구를 만들 수 없다 → 반영).
배경·결정 전문은 `00-requirement.md`·`01-design.md`에 있다.

## 변경 요약 (이번 staged diff)

| 파일 | 변경 |
|---|---|
| `scripts/req/req-doctor.ts` | **DEC-2** `DoctorInputs.ticketTerminalEvent?: CloseProofEvent \| null` 추가 · **DEC-3** D2·D3·D11이 그것을 보고 `OK` + `종결 티켓(<이벤트>) — … 점검 불요` · **DEC-1** `main()`이 `scanTicketIntake().baseState`로 계산해 주입(실패 시 `null` = fail-closed) |
| `tests/unit/req-doctor.test.ts` | 순수 판정 6항목 — 면제 · **이벤트별 문구**(r01 P1 회귀 가드) · 진행 중 무회귀 · 미계산 fail-closed · D10 유지 · **승인 축 유지** |
| `tests/unit/doctor-terminal-wiring.test.ts` (신규) | `main()` **배선** e2e(실 git) — 종결 티켓에서 면제되고, 종결되지 않은 티켓에서는 여전히 FAIL |
| `docs/ssot-design/07-business-rules-and-state-machines.md` | §3 표의 D2·D3·D11 행 + 신규 **§3.0**(면제 규칙·판정 원천·면제되지 않는 것·D25와의 술어 차이) |
| `CHANGELOG.md` | Unreleased 항목 + 확인할 파일 표 |

## 실측 검증

**도그푸딩** — 이 저장소에서 실제로 돌린 결과:

```
$ req:doctor REQ-2026-072      (종결·병합·브랜치 삭제)
  OK D2:  종결 티켓(dev-complete) — 브랜치 일치 점검 불요
  OK D3:  종결 티켓(dev-complete) — 브랜치 존재 점검 불요
  OK D11: 종결 티켓(dev-complete) — feature 브랜치 점검 불요
  FAIL D10: unstaged/untracked 존재      ← 진짜 워킹트리 신호는 살아남는다

$ req:doctor 2026-097          (진행 중 = 이 티켓)
  OK D2: branch 일치 / OK D3: branch 존재 / OK D11: feature 브랜치 OK   ← 무변경
```

**변이 검사** — `main()`의 `ticketTerminalEvent,` 한 줄을 지우고 돌렸더니
`req-doctor.test.ts`의 **순수 테스트 138건은 전부 통과**했고 신규 배선 e2e만 실패했다.
DEC-6 항목 6(실제 진입점 실행)이 필요하다는 근거가 실측으로 확인됐다. 그 뒤 배선을 복구했다.

게이트: `tsc --noEmit` 0 · `npm run docs:lint` 0 · 전체 단위 스위트 **2443/2443 통과(50파일)**.

## 리뷰 포인트

1. **면제 조건의 정확성.** `const terminal = inp.ticketTerminalEvent ?? null` 하나로 세 검사를 분기한다.
   `undefined`와 `null`을 같게 취급하는 것이 의도이며(둘 다 현행 동작), 그 외 값은 전부 면제다.
   `CloseProofEvent` 타입 밖의 값이 들어올 경로가 있는가.

2. **DEC-1 매핑의 안전성.** `scanTicketIntake(...).baseState`를 네 문자열과 비교해 그대로 이벤트로
   쓴다. `CloseBaseState`에 새 terminal 상태가 추가되면 이 목록이 조용히 뒤처진다 — 타입 수준에서
   강제할 방법이 있는가, 아니면 주석·테스트로 충분한가.

3. **fail-closed 경로.** `scanTicketIntake`가 던지면 `catch → null`이다. 즉 판정 불가는 **현행 동작**
   (FAIL 유지)이다. 반대로 이 try/catch가 진짜 결함(손상된 매니페스트 등)을 삼켜 사용자에게
   아무 신호도 주지 않는 문제가 있는가 — D17·D26·D27이 그 축을 이미 보고 있다고 판단했다.

4. **비용.** doctor는 `req:commit` 경로에서도 스폰된다. 현재 티켓 1건에 대한 `scanTicketIntake`
   추가 호출(HEAD blob 3~4회)이 허용 범위인가.

5. **테스트가 실제 결함을 잡는가.** 변이 검사는 배선 한 줄에 대해서만 했다. 다른 변이
   (예: `terminal`을 D11에만 적용, 문구에서 이벤트 제거)도 잡히는가.

6. **문서.** §3.0을 새로 넣으면서 D11 행의 낡은 조건(`phase≠DONE` — REQ-2026-085 DEC-5b에서
   제거됐는데 표에 남아 있었다)도 함께 정정했다. 표의 다른 행에 같은 종류의 낡은 서술이 더 있는가.
   (검사 수 "13개"가 실제 D27까지와 어긋나는 건은 설계 r02에서 별도 사안으로 확인받았다.)

7. **하위호환.** 종결되지 않은 티켓·2-arg 호출·기존 테스트 리터럴이 전부 무변경이라는 주장에
   반례가 있는가.
