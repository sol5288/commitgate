# REQ-2026-125 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

> **테스트 실행 계층(REQ-2026-100)**: 게이트는 테스트를 **실행하지 않는다**. 아래는 비용을 줄이기 위한 실행 시점 권고다.
> - **phase 진행 중**: 변경한 소스를 import하는 테스트만(빠른 피드백). 예: `grep -rl "<변경한 모듈>" tests/`
> - **통합(main 병합) 직전 1회**: **전체 스위트**. 범위 한정은 이것을 **대체하지 않는다** — 영향 분석은 놓친 회귀를 통과시킨다.

## Phase 1 — gitignore 백필 안내 정정 + 가드 (`phase-1-sync-apply-guidance`)

범위: `bin/verify-range.ts:368` 경고 문자열에 `--apply` 반영 · `CHANGELOG.md` 0.21.0 안내 2곳 정정 ·
`docs/troubleshooting.md`/`.en.md` 인벤토리 표 정정 · `scripts/req/lib/sync-guidance.ts` 신규
(순수 규칙 `syncGuidanceViolations` — 설계 DEC-1) · `tests/unit/sync-guidance-claims.test.ts` 신규
(규칙 양방향 단위 + 실제 트리 스캔 위반 0건).

Exit: typecheck 0 · `npx vitest run tests/unit/sync-guidance-claims.test.ts tests/unit/verify-range-cli.test.ts` 그린 · Codex phase 리뷰 승인.

## Phase 2 — CI 조회/실행 용어 정정 (`phase-2-ci-query-terms`)

범위: `bin/verify-range.ts` — `--check-github-ci`/`--no-check-github-ci` 정식화 + 기존 옵션 alias·
deprecation(설계 DEC-2), `CI_PROMPT` 조회 문구, printHelp·헤더 주석 · `bin/init.ts` HELP_TEXT 1행 ·
`docs/workflow.md`/`.en.md` 인용부 · `docs/ssot-design/14` 옵션명 · `tests/unit/verify-range-cli.test.ts`
갱신(+alias·동시 지정·deprecation 단언).

Exit: typecheck 0 · `npx vitest run tests/unit/verify-range-cli.test.ts tests/unit/dispatch.test.ts` 그린 · Codex phase 리뷰 승인.

## Phase 3 — 0.22 업그레이드 문서 (`phase-3-upgrade-docs`)

범위: `docs/upgrade.md`/`.en.md` "버전별 주의사항"에 0.20/0.21 → 0.22 절(설계 DEC-3) ·
`CHANGELOG.md` Unreleased 항목.

Exit: docs:lint 그린 · sync-guidance 가드 그린(신규 문서도 스캔 대상) · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(typecheck·해당 시 lint) · **통합 직전 전체 스위트 1회** · 사용자 main 머지(별도 승인).
