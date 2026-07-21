# REQ-2026-046 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase 진행. 각 phase 후 Codex 리뷰·승인.

> 단일 phase micro-REQ. 변경 = 문서 1개 프로즈.

## Phase 1 — 문구 정정 (`phase-1-prose-correction`)

범위: `workflow/REQ-2026-045/03-analysis.md`의 **§잠정 결론·§후속 REQ 후보·§한계** 문구를 정직한 한정으로 정정(01-design DEC-1). **32 태깅 행·§집계·§DEC-1 임계값 표·§방법·§REQ 최종결정 게이트·`corpus-freeze.md`·코드는 미접촉**(DEC-2).

Exit: 수정 파일 = `workflow/REQ-2026-045/03-analysis.md` **하나** · `tsc --noEmit` 0 · `req:doctor` PASS · Codex phase 리뷰 승인.

## 완료

- **docs 단일 커밋** + **B1 direct push**. push 후 main SHA·CI·수정 파일 1개 보고.
- 2인 태깅·adjudication·후속 oracle REQ·design 증거 영속화는 **범위 밖**(별도).
