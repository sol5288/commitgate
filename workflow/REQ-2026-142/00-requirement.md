# REQ-2026-142 요구사항

## 무엇을

`req:commit --finalize` 의 복구 불가 문제를 **일반 D10 완화 없이** 증거 전용 트랜잭션 복구로 해결한다.

- 소스 커밋 뒤 evidence-finalize 도중 중단돼도 `req:commit --finalize --run` **하나로** 안전하고
  멱등적으로 복구한다.
- D10 의 정상 fail-closed 보장은 **약화하지 않는다**.
- 사람이 원장·state·`approvals.jsonl` 을 손으로 편집해 복구하는 경로는 **만들지 않는다**.

## 왜 — 실측 재현(REQ-2026-140 phase-6, 2026-08-14)

`req:commit --run` 이 **소스 커밋 뒤 evidence-finalize 도중 중단**됐다. `req:next` 는
`req:commit --finalize --run` 을 안내하는데, 그 명령이 **그 상황에서 실행될 수 없었다**:

| 시도 | 결과 |
|---|---|
| `--finalize --run` | 🔴 `FAIL D10: unstaged/untracked 존재: M …/approvals.jsonl` |
| 증거를 staged 로 바꾸고 재시도 | 🔴 동일 — `findUnstagedOrUntracked` 는 `responses/` 하위를 index 여부와 무관하게 flag |

🔴 **안내하는 복구 명령이 그 상황에서 절대 실행될 수 없다.** 이 저장소는 같은 계열을 이미 두 번 겪었다
(REQ-2026-092 승인 행 교착 · REQ-2026-093 `--abandon`). REQ-2026-141 이 원장 쪽 탈출구
(`--close-stale`)는 냈지만 finalize 자체는 남겨 두고 **분할**했다 — 이 REQ 가 그 몫이다.

🔴 **REQ-2026-141 설계 리뷰 7라운드가 전부 이 하나에서 나왔고**, 거기서 경계가 이미 좁혀졌다:
① 패턴 허용은 무관 아카이브 **주입 구멍**(`…-r99-approved.json`) ② 승인 아카이브 하나로 좁히면
정상 `needs-fix`+`approved` 복구가 막힘 ③ `archive_inventory` 로 결속해야 하는데 **그 필드가
`ApprovalEvidence` 에 없다**. 이 REQ 는 ③을 먼저 만들고 그 위에 복구를 세운다.

## 제약

- 🔴 **`--finalize` 라는 플래그만으로 예외를 열지 않는다.** 복구 plan 이 `Ready` 일 때만 연다.
- 🔴 **일반 `req:doctor` 와 정상 `req:commit` 의 D10 은 변경하지 않는다.**
- 🔴 허용 write set 밖의 staged/unstaged/untracked 가 **하나라도** 있으면 거부한다.
- 🔴 어느 중간 지점에서 죽어도 재실행이 **안전하게 수렴**한다(REQ-2026-141 DEC-3a 와 같은 요구 —
  복구 경로가 자기 자신의 교착을 만들면 안 된다).
- 🔴 **hardCap·HIGH·BLOCKED·SHA/범위 불일치는 풀지 않는다.** 이 REQ 는 **실패 복구**만 다룬다.

## 완료 기준

`EvidenceFinalizationRecovery` 모듈(`plan` / `execute`)이 서고 `req:commit --finalize` 가 **유일한 호출자**다.
사용자 명시 10종 테스트 + `npm run typecheck` · `npm run docs:lint` · `npm test` · `verify-range --strict`.
