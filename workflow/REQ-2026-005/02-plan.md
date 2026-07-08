# REQ-2026-005 계획 — phase 분해

design-first. 단일 phase(추적). observations는 additive라 작은 phase.

## Phase 1 — observations 채널 (`phase-1-observations`)
범위:
- `workflow/machine.schema.json`: optional `observations` 배열 추가(items `{detail, file}`, severity 없음, `additionalProperties:false`). version 1.1 유지.
- `scripts/req/review-codex.ts`: `Observation` 인터페이스 + `Verdict.observations?` + `printOutcomeDetails`에서 observations 표출(approved 포함).
- `tests/unit/req-review-codex.test.ts`: 정책 매트릭스 4종 + 하위호환(observations 없음) + severity 붙은 observation 거부.
- `AGENTS.template.md`·schema description: 비차단 코멘트는 `observations`에만.
Exit: typecheck0 · 단위 그린 · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(unit·typecheck) · 사용자 main 머지(별도 승인 — R10 완료 후 병합 판단).
- 후속(별도): R9 resume `--sandbox`(live CLI 지원 확인 후).
