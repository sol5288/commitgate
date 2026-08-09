# REQ-2026-116 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

> **테스트 실행 계층(REQ-2026-100)**: 게이트는 테스트를 **실행하지 않는다**. 아래는 비용을 줄이기 위한 실행 시점 권고다.
> - **phase 진행 중**: 변경한 소스를 import하는 테스트만(빠른 피드백). 예: `grep -rl "<변경한 모듈>" tests/`
> - **통합(main 병합) 직전 1회**: **전체 스위트**. 범위 한정은 이것을 **대체하지 않는다** — 영향 분석은 놓친 회귀를 통과시킨다.

## Phase 1 — verify-range 순수 코어 (`phase-1-verify-core`)

범위: `scripts/req/lib/verify-range.ts` 신규(순수 — fs·git 무의존, 입력은 호출부가 포트로 수집):
커밋 분류(merge→bookkeeping→approved→unproven, 설계 DEC-2), head 트리 manifest 본문에서
`consumed_by_commit_sha` 집합 추출(관대 파싱 + 문제 수 집계), strict 판정(설계 DEC-1·DEC-7의 순수 부분).
`tests/unit/verify-range.test.ts` — 4범주 각 1케이스·손상 manifest 행·strict 경계.

Exit: typecheck 0 · 신규 테스트 그린 · Codex phase 리뷰 승인.

## Phase 2 — CLI verb + GitHub CI opt-in (`phase-2-cli-ci-optin`)

범위: `bin/verify-range.ts` 신규(인자 파싱 fail-closed·대화형 [y/N]·`--github-ci`/`--no-github-ci`/
`--strict`/`--json`/`--base`/`--head`/`--dir`·`GithubCiPort`+gh 어댑터(spawn 주입)·감사 로그
`workflow/.verify-runs.jsonl`(설계 DEC-5)), `bin/dispatch.mjs` verb 등록, `bin/init.ts` help 1행,
`scripts/req/req-next.ts` 통합 안내 1행(설계 DEC-6), `.gitignore`·`templates/workflow.gitignore` 규칙.
완료 기준 10개 시나리오 테스트(00-requirement — 전부 fake 포트, 실 GitHub 무호출).

Exit: typecheck 0 · 완료 기준 1~10 테스트 그린 · 기존 dispatch/help 가드 그린 · Codex phase 리뷰 승인.

## Phase 3 — 문서 정합 (`phase-3-docs`)

범위: `docs/workflow.md`/`.en`·`docs/guarantees.md`/`.en`에 verify-range 소개 + "GitHub CI는 선택이며
사용량·비용이 발생할 수 있다" 고지, `docs/ssot-design/14`(STR-01 정정 — 로컬 검증 구현·원격 강제는
opt-in 예제로 격하)·`09`·`12`(갭 서술 갱신), `CHANGELOG.md` Unreleased.

Exit: `docs:lint` 그린 · docs-stale-claims 가드 그린 · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(typecheck·해당 시 lint) · **통합 직전 전체 스위트 1회** · 사용자 main 머지(별도 승인).
