# REQ-2026-001 계획 — phase 분해

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor D18 WARN(분할 권고·FAIL 아님).

## Phase 1 — kit 추출 + 패키지 스캐폴드 (`phase-1-extract-scaffold`)
범위: 6 스크립트·2 스키마·6 테스트 무수정 복사 + 독립 툴체인(`package.json`/`tsconfig`/`vitest.config`/`.gitignore`/`README`/`req.config.json.sample`/`AGENTS.template.md`).
Exit: `npm test`(기존 req 테스트) green · `tsc --noEmit` 0 · 드리프트 가드(req.config.schema==CONFIG_SCHEMA) green · Codex phase 리뷰 승인.

## Phase 2 — init 스캐폴딩 CLI (`phase-2-init-cli`)
범위: `bin/init.ts`(runInit/parseArgs/detectPackageManager/assertGitWorkTree) + `bin/req-workflow-init.mjs` 런처(tsx 패키지-상대) + `tests/unit/init.test.ts`.
Exit: init 13 테스트 green(정상·멱등·force·config 병합·기존값 유지·malformed 거부·dry-run·fail-closed 4종[none/fake-git/pkg부재/미존재]·pm감지·parseArgs) · 빈 git repo 엔드투엔드(`init → npm i → req:new --run → req:doctor PASS`) · foreign cwd 런처(P1 회귀) · Codex phase 리뷰 승인.
반영(design R1): P1 런처 tsx 패키지-상대 해소, P2 config 누락키 병합, P2 실제 git probe.

## 완료
- 게이트 해당분(unit·typecheck) · 사용자 원격 repo 생성/push(별도 승인).
- Stage B(라이브러리 모델·JS 빌드·DEFAULTS.handoffPath null·publish)는 별도 REQ.
