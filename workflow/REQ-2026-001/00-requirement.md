# REQ-2026-001 요구사항 — AI REQ workflow 독립 패키지화

## 배경
`palm-kiosk-app`의 REQ-2026-017에서 완성한 AI REQ workflow portability kit(`scripts/req/*` + config/adapter 경계 + `req.config.json`)을, 다른 프로젝트에서 **`npx` 한 번으로 설치·사용**할 수 있는 독립 패키지로 추출한다. REQ-2026-017은 "npm 패키지화"를 명시적 비목표로 두었으므로, 본 REQ가 그 후속이다.

## 목표
1. kit을 앱 내부 결합 없이 독립 repo로 추출(코어 승인 바인딩·staged tree 검증 불변).
2. `req-workflow-init` 스캐폴딩 CLI로 대상 git repo에 kit을 vendored 설치(Model A).
3. 대상 repo에서 `req:new → req:review-codex → req:doctor → req:commit`이 실제로 동작.
4. 기존 단위 테스트 + init 테스트가 palm 종속(예: `ALLOW_NONLOCAL_TEST_DB`) 없이 green.

## 범위
- **In**: 6 스크립트 + 2 스키마 + 6 테스트 추출, 독립 `package.json`/`tsconfig`/`vitest.config`, `bin/init.ts`(+런처), generic `AGENTS.template.md`, README, self `req.config.json`.
- **Out(후속/Stage B)**: `node_modules` 직접 실행 라이브러리 모델, init.ts JS 빌드, `packageRoot`→selfRoot/projectRoot 분리, DEFAULTS.handoffPath null화, npm registry publish, 비-git VCS·2종 설계문서.

## 수용 기준
- `npm test` = 기존 req 테스트 + init 테스트 전부 green(비-palm 환경).
- `tsc --noEmit` 0 에러.
- 빈 git repo에 `req-workflow-init` → `req:new --run` → `req:doctor` PASS.
- init 멱등·비파괴(기존 키 미덮어씀)·fail-closed(비-git·package.json 부재).
- 프로젝트 차이는 `req.config.json`과 adapter 경계에서만 흡수.
