# REQ-2026-087 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고.

완결 REQ(2026-086)의 **사후 정정**이라 단일 phase로 간다 — 기본값 한 줄과 그 귀결(문서·가드)이 한 덩어리다.

## Phase 1 — 기본값을 warn으로 (`phase-1-default-warn`)

범위(6파일):
- `scripts/req/lib/config.ts` — `DEFAULTS.granularityGate: 'block' → 'warn'` + 근거 주석 교체 (DEC-1)
- `tests/unit/review-lifecycle-wiring.test.ts` — 🔴 기본 설정에서 초과해도 진행 · `block` 명시 시 차단 유지
- `tests/unit/req-doctor.test.ts` — 기본 인자 문구가 warn 변형 · `block` 명시 시 차단 문구 (DEC-3)
- `docs/workflow.md` · `docs/workflow.en.md` — 기본 동작 서술 반전, `block`은 opt-in
- `CHANGELOG.md` — 0.13.1 절 + **0.13.0 절 ⚠️ 고지 정정 포인터**(DEC-4)

회귀 가드: ①`DEFAULTS.granularityGate === 'warn'` ②기본 설정 + 20파일 staged → 면적으로 중단되지 않음
③`"granularityGate": "block"` → 여전히 throw + 두 탈출구 메시지 ④`phases[].max_files` 계약 불변(fail-closed 포함)
⑤D18 기본 문구에 "막힙니다" 없음 ⑥`workflow/req.config.schema.json`의 enum 무변경.

Exit: typecheck0 · 전체 스위트 그린 · `docs:lint` 그린 · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(unit·typecheck·docs:lint) · 사용자 main 머지(별도 승인) · 0.13.1 patch 릴리스.
