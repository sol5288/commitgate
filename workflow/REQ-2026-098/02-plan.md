# REQ-2026-098 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

## Phase 1 — granularity 안내 문구를 설정에 종속시킨다 (`phase-1-warn-message-accuracy`)

범위(코드 2파일 · 문서 1파일):

- `review-codex.ts` — `phaseAreaMessage(v, phaseId, gate)`(DEC-1), warn 분기 문구(DEC-3), block 문구 바이트 유지(DEC-2), 호출부에서 `cfg.granularityGate` **명시 전달**.
- `tests/unit/req-review-codex.test.ts` — DEC-4의 5항목(warn 금지 문자열·warn 필수 문자열·block 유지·교차 검사·공통 유지) + DEC-5 배선 확인(dry-run `mainImpl`).
- `CHANGELOG.md` — Unreleased 항목.

Exit: typecheck0 · **전체 단위 스위트 그린** · 도그푸딩(warn 설정에서 실제 출력에 거짓 문장 없음) · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(unit·typecheck·lint) · 사용자 main 머지(별도 승인).
