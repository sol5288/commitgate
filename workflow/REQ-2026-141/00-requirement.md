# REQ-2026-141 요구사항

## 무엇을

세 가지를 고친다.

1. **`req:delegate`가 dispatch 경계 계약을 어긴다** — `runCli`를 export하지 않는다.
2. **원장에 닫히지 않은 attempt가 남으면 재리뷰가 영구 차단된다** — 닫는 경로가 없다.

🔴 **세 번째 갭(`req:commit --finalize` 복구 불가)은 이 REQ에서 다루지 않는다** — 설계 리뷰 7라운드가
전부 그 하나에서 나왔고, 해법이 **승인 증거 모델 변경**(`archive_inventory` 생성·state pin·SHA 검증)까지
요구한다는 것이 드러났다. 이 저장소가 같은 상황에서 택해 온 **동결·분할**을 따른다
(REQ-2026-015·016·017). 상세와 이미 확정된 판단은 `01-design.md` DEC-2에 남긴다.

## 왜 — 실측 재현(REQ-2026-140 phase-6, 2026-08-14)

`req:commit --run`이 **소스 커밋 뒤 evidence-finalize 도중 중단**됐다. 남은 상태는:

```
소스 커밋 존재 · approvals.jsonl/review-ledger.jsonl/state.json 수정됨(미커밋) · 승인 아카이브 untracked
```

`req:next`는 `req:commit --finalize --run`을 안내한다. 그런데:

| 시도 | 결과 | 이 REQ |
|---|---|---|
| `--finalize --run` | 🔴 `FAIL D10: unstaged/untracked 존재: M …/approvals.jsonl` | 후속 REQ |
| 증거를 staged로 바꾸고 재시도 | 🔴 동일 — `findUnstagedOrUntracked`는 `responses/` 하위를 index 여부와 무관하게 flag | 후속 REQ |
| 되감고 재리뷰 | 🔴 `리뷰 원장 무결성 실패(fail-closed): 같은 자연키의 기존 행과 내용이 다름(attempt=2 attempt-opened)` | ✅ **여기서 해결** |

🔴 **탈출구가 하나는 생긴다.** 세 번째 줄이 풀리면 "되감고 재리뷰"가 가능해져 **완전한 봉쇄는 아니게**
된다. finalize 자체의 복구는 후속 REQ가 맡는다.

🔴 **안내하는 복구 명령이 그 상황에서 절대 실행될 수 없다.** 이 저장소는 같은 계열을 이미 두 번 겪었다
(REQ-2026-092 승인 행 교착 · REQ-2026-093 `--abandon` 탈출구). 그때 얻은 교훈이
**finalize 경로에서 반복**됐다.

🔴 **`runCli` 누락은 전체 스위트에서만 드러났다.** `dispatch.test.ts`가 `VERB_MODULES`의 모든 대상이
그것을 내보내는지 검사하는데, 그 verb만 골라 돌린 테스트는 dispatch 표면을 보지 않는다.

## 제약

- 🔴 **손으로 원장을 고치는 탈출구를 만들지 않는다.** `state.attempts`를 올려 우회하는 것은
  리뷰 이력 조작이다. 닫는 행위는 **기록으로 남아야** 한다.
- 어느 수정도 정상 경로의 판정을 바꾸지 않는다.

## 완료 기준

- `req:delegate`가 `runCli`를 export하고 `dispatch.test.ts`가 그린.
- 닫히지 않은 attempt를 **기록을 남기며** 해소하는 경로가 있고, 그것 없이는 여전히 fail-closed다.
- 그 경로가 **부분 실패 뒤 재실행에서 수렴**한다(자기가 고치는 교착을 스스로 만들지 않는다).
- REQ-2026-140 phase-6에서 작성했던 push 배선 테스트 4종을 함께 싣는다.
- `npm run typecheck` · `npm test` 전체 그린.
