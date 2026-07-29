# REQ-2026-089 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고.

## Phase 1 — 면적을 측정 로그에 남긴다 (`phase-1-log-area`)

범위(2파일):
- `scripts/req/review-codex.ts` — `ReviewCallLogRow`에 `code_file_count`·`granularity_over`·`granularity_limit` (DEC-2) · `buildReviewCallLogRow`의 옵셔널 `phaseArea` 인자 (DEC-5) · preflight verdict 보존·전달 (DEC-1)
- `tests/unit/req-review-codex.test.ts`

회귀 가드: ①phase 행에 세 값이 실림 ②초과/비초과가 `granularity_over`에 정확히 반영
③`max_files` 선언이 `granularity_limit`에 반영 ④design 행은 세 값 `null`(DEC-3)
⑤인자 미지정이면 세 값 `null`(하위호환) ⑥🔴 행에 **경로·파일명이 없다**(내용배제 계약).

Exit: typecheck0 · 전체 스위트 그린 · Codex phase 리뷰 승인.

## Phase 2 — CHANGELOG (`phase-2-changelog`)

범위(1파일):
- `CHANGELOG.md` — Unreleased + **확인할 파일 표**(phase-1 실제 커밋 SHA·경로)

Exit: typecheck0 · 전체 스위트 그린 · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(unit·typecheck·docs:lint) · 사용자 main 머지(별도 승인).
