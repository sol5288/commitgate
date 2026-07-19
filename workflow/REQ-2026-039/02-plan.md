# REQ-2026-039 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일
> 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님).

## Phase 1 — Quick Start 블록 삽입 + 일치/존재/보존 테스트 (`phase-1-quickstart-templates`)

범위(≤4 파일, Test-First):
1. **Red** — `tests/unit/`에 테스트 추가:
   - (a) `templates/CLAUDE.template.md`·`AGENTS.template.md`의 `commitgate:quickstart` 마커 블록
     추출 → **바이트 동일** assert.
   - (b) init을 임시 대상에 적용한 결과 CLAUDE.md·AGENTS.md에 quickstart 블록 **포함** assert.
   - (c) 기존 CLAUDE.md·AGENTS.md 존재 시 **보존**(주입 안 함) assert (REQ-040 경계).
   - 이 시점엔 템플릿에 블록이 없어 (a)(b) 실패(Red).
2. **Green** — 두 템플릿 앞부분에 01-design D3의 Quick Start 블록을 **동일하게** 삽입.
   AGENTS.template.md 첫 줄 `<!-- commitgate:contract -->` 마커 보존. 계약 위치 문장은 블록 밖
   파일별로(D2).
3. `CHANGELOG.md` Unreleased에 항목 추가(D5).

Exit: `eslint 0` · `tsc --noEmit 0` · 단위 그린(신규 포함) · Codex phase 리뷰 승인.

## 완료

- 게이트 해당분(unit·typecheck·lint) 그린 · Codex 승인.
- 사용자 main 머지(별도 통합 통제점 승인).
- **후속 명시**: 기존-파일 프로젝트 Quick Start 주입 UX = **REQ-040**(init.ts/doctor, HIGH).
