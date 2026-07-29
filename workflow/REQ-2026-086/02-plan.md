# REQ-2026-086 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

## Phase 1 — 리뷰 직전 면적 판정 (`phase-1-granularity-preflight`)

범위(4파일):
- `scripts/req/lib/config.ts` — `granularityGate: 'block' | 'warn'`(기본 `block`)·타입·스키마 (DEC-6)
- `workflow/req.config.schema.json` — 같은 축(드리프트 가드가 강제)
- `scripts/req/review-codex.ts` — `PhaseEntry.max_files?` (DEC-3) · 순수 판정 `phaseAreaProblem()` (DEC-4) · phase preflight 배선 (DEC-1·2·7)
- `tests/unit/req-review-codex.test.ts` — 회귀 가드

회귀 가드: ①임계 이하 통과 ②초과 시 throw + 메시지에 두 탈출구 ③`max_files` 선언이 그 phase 임계를 올린다
④`granularityGate: 'warn'`이면 통과 ⑤design 리뷰 무영향 ⑥티켓 문서·증거는 세지 않는다
⑦🔴 **차단 시 attempt·원장 행·부기 커밋이 하나도 생기지 않는다** — 실제 진입점으로 확인(순수 판정만으로는 순서를 못 잡는다).

Exit: typecheck0 · 전체 스위트 그린 · Codex phase 리뷰 승인.

## Phase 2 — D18 문구·문서·CHANGELOG (`phase-2-docs-changelog`)

범위(4파일):
- `scripts/req/req-doctor.ts` — D18 문구를 새 절차에 맞춘다. 🔴 **레벨은 WARN 유지**(DEC-5 — FAIL로 올리면 승인된 phase의 커밋이 교착된다)
- `docs/workflow.md` · `docs/workflow.en.md` — 두 탈출구·`granularityGate`·실측 근거
- `CHANGELOG.md` — Unreleased + **확인할 파일 표**(phase-1 커밋 SHA·경로) + ⚠️ 업그레이드 시 동작이 좁아진다는 고지

회귀 가드: D18 레벨이 WARN임을 고정(FAIL 승격 방지).

Exit: typecheck0 · 전체 스위트 그린 · `docs:lint` 그린 · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(unit·typecheck·docs:lint) · 사용자 main 머지(별도 승인).
