# REQ-2026-004 요구사항 — 0.2.2 안정화 체크포인트

## 무엇을
실제 프로젝트 주입 중 드러난 review-gate 결함(무한 재리뷰 루프)을 막는 수정과, 진행 중이던 init CLI UX 개선을 **2개 커밋으로 분리**해 CommitGate 워크플로로 랜딩한다.

## 왜
- Codex가 `findings=[] + commit_approved=no`를 반복 반환하면 CLI가 `OK`/exit 0으로 보고하면서 커밋은 계속 막혀, 에이전트가 고칠 것 없는 동일 리뷰를 무한 반복(토큰 낭비). 결정적 도구 결함.
- 승인(`commit_approved=yes`)이 findings를 동반해도 통과해 미검토 코드가 커밋될 수 있었다(안전 결함).
- 큰 staged diff에서 git 1MiB 기본 maxBuffer가 codex 호출 전에 ENOBUFS로 하드 실패.

## 제약
- fail-closed 유지: "미승인"을 절대 "승인"으로 바꾸지 않는다. 무진단 미승인은 별도의 재시도-불가 BLOCKED로.
- 하위호환: machine.schema.json version은 1.1 유지(기존 아카이브 호환).
- init CLI UX 변경과 review-gate 변경을 한 커밋에 섞지 않는다.

## 완료 기준
- 전체 단위 테스트 green + `tsc --noEmit` 0.
- Phase 1(init UX)·Phase 2(review-gate) 각각 Codex phase 리뷰 승인 후 커밋.
- 리뷰 종료코드 계약: 0=승인, 1=invalid, 2=BLOCKED(재시도 금지), 3=needs-fix.
