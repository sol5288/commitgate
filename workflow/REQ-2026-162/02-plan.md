# REQ-2026-162 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **테스트 실행 계층(REQ-2026-100)**: 게이트는 테스트를 **실행하지 않는다**.
> phase 중에는 변경한 소스를 import 하는 테스트만, **전체 스위트는 통합 직전 1회**.

## Phase 1 — 주석 pm 중립화 (`phase-1-pm-neutral-comments`)

범위: `scripts/req/lib/command-surface.ts` · `scripts/req/req-doctor.ts` — **주석만**.

- 실측 사실은 남기고 pm 실행 리터럴만 제거한다.
- 가드(`tests/unit/pm-derived-strings.test.ts`)는 **고치지 않는다** — 잡은 것이 옳다.

Exit: typecheck 0 · `tests/unit/pm-derived-strings.test.ts` 그린 ·
`grep -rn "npm run req\|pnpm req:\|yarn req:" scripts/req/` 0건 · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(typecheck) · **통합 직전 전체 스위트 1회** · 사용자 main 머지(별도 승인).
