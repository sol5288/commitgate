# REQ-2026-101 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

> **테스트 실행 계층(REQ-2026-100)**: 게이트는 테스트를 **실행하지 않는다**. 아래는 비용을 줄이기 위한 실행 시점 권고다.
> - **phase 진행 중**: 변경한 소스를 import하는 테스트만(빠른 피드백). 예: `grep -rl "<변경한 모듈>" tests/`
> - **통합(main 병합) 직전 1회**: **전체 스위트**. 범위 한정은 이것을 **대체하지 않는다** — 영향 분석은 놓친 회귀를 통과시킨다.

## Phase 1 — Quick Start 드리프트 탐지 + 계층 한 줄 (`phase-1-drift-detection`)

범위(코드 3파일 · 테스트 2파일 · 문서 1파일):

- `bin/quickstart.ts` — `missingQuickstartFiles` → `quickstartBackfillTargets`(`planQuickstart` 파생, DEC-1).
- `scripts/req/req-doctor.ts` — D21 입력 타입 교체 + 부재/드리프트 분기 문구(DEC-2), WARN 상한 유지(DEC-3), dev 스킵 무변경(DEC-4).
- `templates/CLAUDE.template.md` — Quick Start 블록에 계층 7번 항목(DEC-5).
- `tests/unit/quickstart.test.ts` — DEC-6 ①드리프트 ②부재 무회귀 ③skip 사유 보존 ⑥**진단↔적용 왕복**.
- `tests/unit/req-doctor.test.ts` — DEC-6 ④문구 분기 ⑤WARN 상한.
- `CHANGELOG.md` — Unreleased. 기존 소비자가 D21 WARN을 보게 되는 이유와 대응을 적는다.

쓰기 동작 변경 0 — 바뀌는 것은 진단 입력과 블록 내용이다.

Exit(실행 명령):
- `npx tsc --noEmit` → exit 0
- **변경 범위 단위 그린**: `npx vitest run tests/unit/quickstart.test.ts tests/unit/req-doctor.test.ts tests/unit/init.test.ts tests/unit/package-payload.test.ts`
- 변이 검사 2종: ① 블록을 한 글자 바꾼 소비자 픽스처에서 드리프트가 안 잡히면 실패 ② D21을 FAIL로 올리면 WARN 상한 테스트가 실패
- 도그푸딩: 실제 소비자 저장소 사본에서 D21 드리프트 발화 → `quickstart --apply` → 재진단 clean 확인
- 전체 스위트는 **통합 직전 1회**
- Codex phase 리뷰 승인

## 완료
- 게이트 해당분(typecheck·해당 시 lint) · **통합 직전 전체 스위트 1회** · 사용자 main 머지(별도 승인).
