# REQ-2026-057 요구사항

## 무엇

티켓의 **작업 상태(`state.json`)를 승인·소비 경계마다 커밋으로 내구화(durable checkpoint)** 한다.
지금은 승인 증거(`responses/**`)만 커밋되고 상태는 미커밋 워킹 변경으로만 남는다.

## 왜

Nuxt 소비자 감사(2026-07-25, `commitgate@0.9.9`)에서 확인된 P1 2건이 같은 원인에서 나온다.

1. **티켓을 정상 완주해도 `state.json`이 dirty로 남아 다음 작업이 막힌다.**
   `req:commit`의 evidence-finalize는 `responses/` 4파일만 커밋하고, 소비된 상태는 커밋 **뒤에**
   디스크에만 쓴다(`req-commit.ts:567`). 그 결과:
   - `req:new --run`이 clean-tree 게이트에서 거부한다 — `req:new`의 스크래치 예외는 `state.json`을
     **의도적으로** 제외하기 때문이다(`lib/scratch.ts` D8: 증거 변조 구멍 방지).
   - `git checkout <다른 브랜치>`도 같은 이유로 막힌다.
   - 그런데 계약(`AGENTS.md`)과 문서(`docs/troubleshooting.md`)는 `state.json`을 **직접 커밋하지 말라**고 한다.
     → 남겨도 막히고 버려도 안 되는 상태다.

2. **상태를 버리면 이미 받은 승인이 사라진 것처럼 보인다.**
   `git checkout -- <ticket>/state.json`(문서 정책에 맞는 유일한 해소책) 후 `req:next`는 커밋된
   `approvals.jsonl`·아카이브가 있는데도 "설계 승인이 필요하다"며 **유료 Codex 재리뷰를 지시**한다.
   `req:reconstruct`는 close-proof의 `series-terminal` 행 복원 도구라 이 상태를 되살리지 못한다.

즉 지금 구조는 "남겨도 문제, 버려도 문제"다. 상태가 증거와 함께 Git에 남으면 둘 다 사라진다.

## 완료 기준

1. **티켓 완주 직후 `git status`가 clean이다** — 마지막 `req:commit --run` 뒤 `state.json`을 포함해
   워킹 변경이 남지 않는다.
2. **곧바로 `req:new <slug> --run`이 성공한다** — 직전 티켓의 상태 때문에 막히지 않는다.
3. **design 승인 직후에도 상태가 커밋된다** — 설계 승인 후·첫 phase 커밋 전 구간에서 브랜치를 옮기거나
   워킹 변경을 버려도 승인이 유실되지 않는다.
4. 커밋된 상태만으로 `req:next`가 승인 사실을 그대로 읽는다 — 재리뷰를 요구하지 않는다.
5. **source 커밋에는 `state.json`·`responses/`가 절대 들어가지 않는다**(`docs/guarantees.md` 보장 유지).
6. 기존 복구 경로(`req:commit --finalize`, `pending_evidence_for` 마커)가 그대로 동작한다.
7. 전체 테스트 green.

## 제약

- **승인 게이트를 완화하지 않는다.** D9(staged tree == approved tree)·D10·evidence 커밋의
  "responses 외 staged 금지" 가드는 그대로 유지한다.
- `req:new`의 스크래치 예외를 넓혀 dirty `state.json`을 통과시키는 방식은 **채택하지 않는다.**
  그 방식은 완료 기준 3·4를 만족하지 못하고(상태는 여전히 미커밋), tracked 파일인 `state.json`의
  변조 표면을 연다.
- 상태를 커밋하기 전에 그것이 도구가 방금 쓴 값 그대로인지 확인한다 — 임의 편집분을 무비판적으로
  커밋하지 않는다.

## 비목표

- `req:next`가 커밋된 증거로부터 상태를 **역복원**하는 기능(내구화하면 필요 없어진다).
- `req:new`의 위반 메시지 문구 개선, `fatal:` 진단 노이즈 차단, 제거 계획 문구 — 별도 REQ(안내·진단 계층).
- 병렬 워크트리·다중 활성 티켓 지원(이 도구의 보장 범위 밖).
