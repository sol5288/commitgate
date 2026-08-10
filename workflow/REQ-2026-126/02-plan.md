# REQ-2026-126 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

> **테스트 실행 계층(REQ-2026-100)**: 게이트는 테스트를 **실행하지 않는다**. 아래는 비용을 줄이기 위한 실행 시점 권고다.
> - **phase 진행 중**: 변경한 소스를 import하는 테스트만(빠른 피드백). 예: `grep -rl "<변경한 모듈>" tests/`
> - **통합(main 병합) 직전 1회**: **전체 스위트**. 범위 한정은 이것을 **대체하지 않는다** — 영향 분석은 놓친 회귀를 통과시킨다.

## Phase 1 — CI 실행 포트 + config 축 (`phase-1-ci-run-port`)

범위: `workflow/req.config.schema.json`·`scripts/req/lib/config.ts`에 `githubCi`(additive — 설계 DEC-4) ·
`scripts/req/lib/github-ci-run.ts` 신규(awaitCiRun 순수 판정·gh/git 어댑터 팩토리·fake — 설계 DEC-3,
**HEAD 결속: 원격 SHA=로컬 HEAD 대조 + run head_sha 대조**) ·
`tests/unit/github-ci-run.test.ts`(식별 필터·다중 후보 실패·timeout/red/cancelled/미출현·원격 브랜치
부재·원격 SHA 불일치·head_sha 불일치·config 검증).

Exit: typecheck 0 · `npx vitest run tests/unit/github-ci-run.test.ts tests/unit/config*.test.ts` 그린 · Codex phase 리뷰 승인.

## Phase 2 — MergeGate 순수 코어 (`phase-2-merge-gate-core`)

범위: `scripts/req/lib/merge-gate.ts` 신규(planIntegration·decideCiRun — 설계 DEC-2) ·
`tests/unit/merge-gate.test.ts`(전제 거부 5종·strict 차단·CI 결정표).

Exit: typecheck 0 · `npx vitest run tests/unit/merge-gate.test.ts` 그린 · Codex phase 리뷰 승인.

## Phase 3 — integrate verb·감사 로그 (`phase-3-integrate-verb`)

범위: `bin/integrate.ts` 신규(수집·질문·executeIntegration·감사 로그 — 설계 DEC-5·DEC-6) ·
`dispatch.mjs`/`init.ts` 각 1행 · 로그 유지 규칙 3종(`.gitignore`·`templates/workflow.gitignore`·
`scripts/smoke.mjs` 단언·troubleshooting 표 ko/en) · `tests/unit/integrate-verb.test.ts`
(fake 포트 dry-run/차단/CI 분기 + 실 git 충돌 복구 1건).

Exit: typecheck 0 · `npx vitest run tests/unit/integrate-verb.test.ts tests/unit/dispatch.test.ts tests/unit/sync-guidance-claims.test.ts` 그린 · Codex phase 리뷰 승인.

## Phase 4 — 문서 (`phase-4-docs`)

범위: `docs/workflow.md`/`.en` integrate 절(delivery integrate와 구별 명시) ·
`docs/upgrade.md`/`.en` 0.22 절에 integrate·githubCi 항목 · `CHANGELOG.md` Unreleased.

Exit: docs:lint 그린 · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(typecheck·해당 시 lint) · **통합 직전 전체 스위트 1회** · 사용자 main 머지(별도 승인).
