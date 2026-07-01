# REQ-2026-001 설계 — 독립 패키지 추출

> palm-kiosk-app의 kit을 무수정 추출하고, 프로젝트 차이는 `req.config.json`·init CLI 경계에서만 흡수한다.

## 현재 상태(변경 대상)
- 소스: `palm-kiosk-app/scripts/req/{req-new,review-codex,req-doctor,req-commit}.ts` + `lib/{config,adapters}.ts`, `workflow/{machine,req.config}.schema.json`, `tests/unit/req-*.test.ts`(6).
- 결합도 실측: 앱 내부(src/db/nuxt) import 0. 외부 의존 = `ajv`뿐 + 실행기 `tsx`. `packageRoot()` = `scripts/req/lib`에서 3단계 위 = repo 루트.

## 핵심 설계 결정
- **D1 (Model A — vendored 스캐폴딩)**: kit을 대상 repo 안에 복사한다. init 후 레이아웃이 palm과 동일(`scripts/req/`·`workflow/`)이라 `packageRoot()`·`MACHINE_SCHEMA_PATH` 가정이 그대로 유효 → 코어 무손상. (Model B = `node_modules` 실행형은 Stage B.)
- **D2 (코어 무수정)**: 6 스크립트·2 스키마·6 테스트는 바이트 단위로 복사만. 로직 재작성 금지.
- **D3 (레이아웃 보존)**: 새 repo도 `scripts/req/` + `tests/unit/`. 테스트의 `../../scripts/req` 상대 import 무수정 → 회귀 가드 유지.
- **D4 (프로젝트 차이 흡수 지점)**: 오직 `req.config.json`. init은 **부재 시 생성**뿐 아니라 **기존 부분 config에도 누락된 `handoffPath:null`/`packageManager`를 병합**(기존 키 보존, design R1 P2 반영). 코어 DEFAULTS(palm 경로)는 건드리지 않되, init이 `handoffPath` 키 존재를 항상 보장 → palm 경로 resurface 차단. (DEFAULTS.handoffPath 자체의 null화는 손편집으로 키를 지운 경우까지 막는 방어로 Stage B; review-codex가 `existsSync` 가드라 미존재 시에도 null 처리이므로 무해.)
- **D5 (init CLI fail-closed)**: 대상 git 검증은 `.git` 경로 존재가 아니라 **실제 git probe**(`rev-parse --is-inside-work-tree` + `--show-toplevel` top-level 일치, design R1 P2 반영) — fake `.git` 마커·하위 디렉터리 스캐폴드 거부. `package.json` 부재 → throw. 기존 파일·키 미덮어씀(멱등). `--force`로만 덮어씀. `--dry-run` 지원. (top-level 비교는 `realpathSync.native`로 Windows case/8.3 정규화.)
- **D6 (독립 툴체인)**: `tsconfig`는 nuxt 비의존(`moduleResolution: Bundler`로 extensionless 상대 import 허용). `vitest.config`는 palm의 `.env`·DB 가드 setup 제거(req 단위 테스트는 순수).
- **D7 (bin 런처 — tsx 패키지-상대 해소)**: npm bin은 TS 직접 실행 불가 → `bin/req-workflow-init.mjs`가 tsx 로더를 얹어 `init.ts` 실행. ⚠️ tsx는 **호출 cwd가 아니라 패키지 기준**으로 해소해야 함(design R1 P1): npx로 실행하면 cwd=대상 repo인데 tsx가 아직 없어 bare `--import tsx`는 ERR_MODULE_NOT_FOUND. `import { register } from 'tsx/esm/api'`(정적 = 패키지 node_modules 기준 해소) + `register()` in-process로 해결. (node:module `register('tsx/esm')`는 tsx v4가 deprecated --loader로 거부.)
- **D8 (AGENTS)**: palm AGENTS.md는 SSOT 경로·포트 고유 → 이식 부적합. 워크플로 계약만 담은 generic `AGENTS.template.md` 신작, init이 부재 시에만 생성.

## Phase별 구현
- **Phase 1** — kit 추출 + 패키지 스캐폴드 + 툴체인. 산출: 6 스크립트·2 스키마·6 테스트 복사, `package.json`/`tsconfig`/`vitest.config`/`.gitignore`/`README`/`req.config.json.sample`/`AGENTS.template.md`. 검증: `npm test`(기존 req 358) green, `tsc` 0.
- **Phase 2** — `bin/init.ts` 스캐폴딩 CLI + 런처 + `init.test.ts`. 검증: init 13 테스트 green(정상·멱등·force·config 병합·기존값 유지·malformed 거부·dry-run·fail-closed 4종·pm감지·parseArgs), 빈 git repo 엔드투엔드(`init → req:new → req:doctor PASS`), foreign cwd 런처 실행(P1 회귀).

## 변경 파일
- 신규(패키지): `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `README.md`, `req.config.json.sample`, `req.config.json`, `AGENTS.template.md`, `bin/init.ts`, `bin/req-workflow-init.mjs`, `tests/unit/init.test.ts`.
- 복사(무수정): `scripts/req/**`(6), `workflow/*.schema.json`(2), `tests/unit/req-*.test.ts`(6).

## 하위호환·안전
- 코어 승인 바인딩(D9 staged tree↔승인 tree, D10 clean, D11 branchPrefix, codex fail-closed)은 복사만 — 무손상.
- init은 대상 파일을 덮어쓰지 않음(멱등). `files` 화이트리스트로 티켓 디렉터리는 publish 제외.
- **부분 설치 방지(design R2 P2)**: `runInit`은 **Preflight(git probe·package.json/req.config.json 파싱·shape 검증·계획 산출) → Apply(복사·쓰기)** 2단계. malformed 입력은 어떤 파일도 복사·수정하기 전에 throw(no-partial-write 회귀 테스트 2종).
- 잔존(Stage B, 무결성 아님): DEFAULTS.handoffPath palm 경로의 소스레벨 null화(현재는 init 병합이 키 존재를 보장해 실사용상 도달 불가). npx/global 설치의 bin 런처는 Stage A에서 패키지-상대 해소로 해결(D7) — Stage B는 JS 빌드로 런처 자체 제거.
