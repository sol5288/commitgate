# REQ-2026-091 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고.

## Phase 1 — 커밋된 phase 블록 (`phase-1-shipped-phases-block`)

범위(2파일):
- `scripts/req/review-codex.ts` — 순수 `committedPhaseIds()`·`shippedPhasesBlock()` · 프롬프트 인자 `shippedPhaseIds?` · design 분기 삽입 · `mainImpl`의 HEAD blob 주입 (DEC-1~4)
- `tests/unit/req-review-codex.test.ts` — 회귀 가드 + byte-identity 기대값 갱신

회귀 가드: ①커밋된 phase가 블록에 실림 + 후속 REQ 경로·"판단은 당신의 것" 명시 · 🔴 단정 문구 부재
②🔴 **비었을 때 프롬프트 바이트 동일**(대조군 `===` 비교) ③phase 리뷰 무영향
④매니페스트 부재·파손 → 블록 없음 ⑤결속 끊긴 phase도 포함(커밋 여부만 판정).

Exit: typecheck0 · 전체 스위트 그린 · Codex phase 리뷰 승인.

## Phase 2 — 재결속 안내 시점 + CHANGELOG (`phase-2-notice-timing`)

범위(3파일):
- `scripts/req/req-next.ts` — `staleBindingNotice` 도입부를 "티켓을 닫기 전에"로, 조기 실행이 무효가 됨을 명시 (DEC-5)
- `tests/unit/req-next.test.ts` — "지금" 부재 + "닫기 전에"·"안정된 뒤" 존재 고정
- `CHANGELOG.md` — Unreleased + **확인할 파일 표**(phase-1 실제 커밋 SHA·경로)

Exit: typecheck0 · 전체 스위트 그린 · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(unit·typecheck·docs:lint) · 사용자 main 머지(별도 승인).
