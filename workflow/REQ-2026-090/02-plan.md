# REQ-2026-090 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고.

## Phase 1 — runCli 계약 복구 (`phase-1-runcli-contract`)

범위(4파일):
- `scripts/req/req-rebind.ts` — `isMain` 인라인 경계를 `runCli`로 추출 · `isMain`이 호출 (DEC-1·5)
- `scripts/req/req-confirm.ts` — 동일
- `bin/commitgate.mjs` — 계약 위반 시 원시 TypeError 대신 진단 가능한 오류 (DEC-4, **폴백 아님**)
- `tests/unit/dispatch.test.ts` — 전 대상 계약 검사 (DEC-3)

회귀 가드: ①🔴 `VERB_MODULES` **전 대상**이 `runCli` 함수 export(대상 수 하한 포함 — 표본이 비면 무의미)
②`req:rebind`·`req:confirm`이 dispatch 경로로 모듈에 도달(TypeError 없음)
③계약 위반 모듈 → bin이 읽을 수 있는 오류 ④Stage A 직접 실행 무회귀.

Exit: typecheck0 · 전체 스위트 그린 · Codex phase 리뷰 승인.

## Phase 2 — CHANGELOG (`phase-2-changelog`)

범위(1파일):
- `CHANGELOG.md` — Unreleased + **확인할 파일 표**(phase-1 실제 커밋 SHA·경로)

Exit: typecheck0 · 전체 스위트 그린 · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(unit·typecheck·docs:lint) · 사용자 main 머지(별도 승인) · patch 릴리스.
