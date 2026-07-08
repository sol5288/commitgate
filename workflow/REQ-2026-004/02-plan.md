# REQ-2026-004 계획 — phase 분해

안정화 체크포인트. 이미 작성된 변경을 관심사별 2개 커밋으로 분리해 각각 Codex phase 리뷰·승인 후 커밋한다. (레거시 phase 모드 — phases[] 미추적, 각 phase는 staged diff를 리뷰.)

## Phase 1 — init CLI UX (`phase-1-init-ux`)
범위: `bin/init.ts`, `bin/commitgate.mjs`, `package.json`(버전 0.2.2), `tests/unit/init.test.ts`.
Exit: typecheck0 · 단위 그린 · Codex phase 리뷰 승인.

## Phase 2 — review-gate 안정화 (`phase-2-review-gate`)
범위: `scripts/req/review-codex.ts`(outcome 분리·회로차단기·R10·resolveReviewOutcome·--fresh-thread), `scripts/req/lib/adapters.ts`(git maxBuffer 64MiB), `workflow/machine.schema.json`(description), `.gitignore`(.tmp/), `AGENTS.template.md`, `README.md`, `README.en.md`, `tests/unit/req-review-codex.test.ts`, `tests/unit/req-adapters.test.ts`, `tests/unit/req-adapters-cmd.test.ts`.
Exit: typecheck0 · 단위 그린(신규 outcome/breaker/R10 회귀 포함) · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(unit·typecheck) · 사용자 main 머지(별도 승인).
- 후속(별도 REQ): R10 `observations` 필드(비차단 코멘트 채널), R9 resume `--sandbox`(live CLI 지원 확인 후).
