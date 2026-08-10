# REQ-2026-127 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

> **테스트 실행 계층(REQ-2026-100)**: 게이트는 테스트를 **실행하지 않는다**. 아래는 비용을 줄이기 위한 실행 시점 권고다.
> - **phase 진행 중**: 변경한 소스를 import하는 테스트만(빠른 피드백). 예: `grep -rl "<변경한 모듈>" tests/`
> - **통합(main 병합) 직전 1회**: **전체 스위트**. 범위 한정은 이것을 **대체하지 않는다** — 영향 분석은 놓친 회귀를 통과시킨다.

## Phase 1 — 심층 분류 코어 (`phase-1-deep-core`)

선행: 없음. 입력: 설계 DEC-1·DEC-2. 산출: 순수 코어(6범주)와 배치 리더.

범위: `scripts/req/lib/git-batch.ts` 신규(cat-file --batch 프레이밍 파서 순수 분리) ·
`scripts/req/lib/attestations.ts` 신규(행 스키마·관대 파서·손상 카운트) ·
`scripts/req/lib/verify-range.ts` 확장(입력 additive·6범주 분류기·invalid 상세·verificationNotes —
validateManifest 재사용·사본 금지) · `tests/unit/git-batch.test.ts`·`tests/unit/verify-range.test.ts` 갱신
(분류 표 — 완료 기준 1·2·3 전반부·failure mode 3종).

Exit: typecheck 0 · `npx vitest run tests/unit/verify-range.test.ts tests/unit/git-batch.test.ts` 그린 · Codex phase 리뷰 승인.

## Phase 2 — attest verb (`phase-2-attest-verb`)

선행: phase-1(attestations.ts 파서). 산출: `commitgate attest`.

범위: `bin/attest.ts` 신규(설계 DEC-3 — dry-run 기본·--run 행 append+부기 커밋·대상 외 staged 거부) ·
`bin/dispatch.mjs`·`bin/init.ts` 각 1행 · `tests/unit/attest-verb.test.ts`(실 git — 완료 기준 4).

Exit: typecheck 0 · `npx vitest run tests/unit/attest-verb.test.ts tests/unit/dispatch.test.ts` 그린 · Codex phase 리뷰 승인.

## Phase 3 — 수집·strict·integrate 결속 (`phase-3-wire-strict`)

선행: phase-1·2. 산출: CLI 전 표면 결속·문서.

범위: `bin/verify-range.ts`(수집 확장 — name-only 1회·merge당 diff-tree --cc·배치 blob·
state phases·attestations — ·렌더·VerifyRunRow 6키·computeExit) · `bin/integrate.ts`·
`scripts/req/lib/merge-gate.ts`(invalid 차단·attested 통과) · 프로세스 수 회귀 테스트(완료 기준 7) ·
`tests/unit/verify-range-cli.test.ts`·`tests/unit/integrate-verb.test.ts`·`tests/unit/merge-gate.test.ts` 갱신 ·
`docs/workflow.md`/`.en`·`docs/upgrade.md`/`.en`·`CHANGELOG.md`.

Exit: typecheck 0 · 위 테스트 + docs:lint 그린 · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(typecheck·해당 시 lint) · **통합 직전 전체 스위트 1회** · 사용자 main 머지(별도 승인).
