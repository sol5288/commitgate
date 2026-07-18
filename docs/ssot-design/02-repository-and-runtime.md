# 02. 저장소와 런타임

## 1. 디렉터리 트리 (의미 있는 소스·설정 위주)

```text
commitgate/
├── bin/
│   ├── commitgate.mjs        # 진입 런처(tsx 등록 후 dispatch 결정대로 모듈 위임)
│   ├── dispatch.mjs          # verb → 패키지 내부 모듈 매핑(VERB_MODULES, 순수·무부작용)
│   ├── dispatch.d.mts        # dispatch.mjs 타입 선언(.mjs를 TS에서 import)
│   ├── init.ts               # 설치 코어: 관리 자산 배치·req:* 주입·프리플라이트(런타임 무복사)
│   ├── migrate.ts            # Stage A → Stage B 전환(기본 dry-run, package.json 한 파일만)
│   └── uninstall.ts          # 읽기 전용 제거 플래너: 아무 것도 지우지 않음
├── scripts/
│   ├── req/
│   │   ├── req-new.ts         # req:new  — 티켓·브랜치 생성
│   │   ├── req-next.ts        # req:next — 다음 행동 계산(읽기 전용)
│   │   ├── review-codex.ts    # req:review-codex — 리뷰 조립·호출·검증·바인딩
│   │   ├── req-doctor.ts      # req:doctor — 일관성 게이트(D-체크)
│   │   ├── req-commit.ts      # req:commit — 승인 커밋 + evidence-finalize
│   │   └── lib/
│   │       ├── config.ts      # 설정 로드·검증·경로 confinement
│   │       ├── adapters.ts    # git·codex 프로세스 경계(safeSpawnSync)
│   │       ├── porcelain.ts   # git status -z 파서
│   │       └── scratch.ts     # scratch/도구출력 판정 SSOT
│   ├── smoke.mjs             # pack tarball 설치 스모크
│   └── verify-review-overrides.mjs  # codex 모델·추론강도 override 실효성 검증(수동)
├── workflow/
│   ├── machine.schema.json    # Codex 구조화 응답 스키마(1.1)
│   ├── req.config.schema.json # req.config.json 검증 스키마
│   ├── review-persona.md      # 리뷰어(PM) 페르소나(프롬프트 첫 블록)
│   └── REQ-2026-001..014,017,018/ # main에서 추적되는 기존 티켓
├── templates/                 # 얇은 포인터 진입점 원본 5종
│   ├── claude-skill.md · claude-command.md · cursor-rule.mdc
│   ├── CLAUDE.template.md · workflow.gitignore
├── .github/workflows/ci.yml   # 9-leg 매트릭스 CI
├── docs/RELEASING.md · follow-ups-design.md
├── AGENTS.template.md         # 계약 정본 템플릿(마커 <!-- commitgate:contract -->)
├── req.config.json(.sample)   # 프로젝트 설정(+샘플)
├── package.json · package-lock.json · tsconfig.json · vitest.config.ts
└── tests/unit/*.test.ts       # 17개 테스트 파일
```

현재 workspace에 `.agents/`가 보일 수 있으나 `git ls-files .agents` 결과는 비어 있다. 즉 재구현·패키지 페이로드에 포함되는 저장소 구성요소가 아니라 **로컬 미추적 디렉터리**다. 반면 `workflow/REQ-2026-014/`는 REQ-2026-014(Stage B)가 `main`에 반영되면서 **추적되는 감사 증거**가 됐다(`git ls-files workflow/REQ-2026-014` — 설계 문서 3종 + `codex-request.md` + `responses/` + `state.json`). 다른 티켓과 동일하게 main 추적 인벤토리에 포함한다.

## 2. 기술 스택과 버전

| 항목 | 값 | 근거 |
|---|---|---|
| 런타임 | Node.js `>=18.17` (`"type":"module"` ESM) | [package.json](../../package.json) |
| 언어 | TypeScript `^5.6.2` | [package.json](../../package.json) devDeps |
| TS 실행 | `tsx ^4.19.1` (컴파일 없이 `.ts` 실행) | [package.json](../../package.json) deps |
| 테스트 러너 | `vitest ^2.1.2` | [vitest.config.ts](../../vitest.config.ts) |
| 스키마 검증 | `ajv ^8.20.0` | [scripts/req/review-codex.ts](../../scripts/req/review-codex.ts) `validateResponseStructure` |
| 프로세스 실행 | `cross-spawn ^7.0.6` (shell 없는 안전 spawn) | [scripts/req/lib/adapters.ts](../../scripts/req/lib/adapters.ts) |
| 버전 비교 | `semver ^7.6.3` | [bin/init.ts](../../bin/init.ts) `CROSS_SPAWN_FLOOR` |

### tsconfig 핵심([tsconfig.json](../../tsconfig.json))
`target: ES2022`, `module: ESNext`, `moduleResolution: Bundler`, `strict: true`, `noUncheckedIndexedAccess: true`, `noImplicitOverride: true`, `resolveJsonModule: true`, `noEmit: true`, `include: ["scripts","bin","tests"]`. 타입검사는 `tsc --noEmit`.

### vitest 설정([vitest.config.ts](../../vitest.config.ts))
`test.include: ['tests/**/*.test.ts']`, `environment: 'node'`, `reporters: ['default']`. `setupFiles`/alias 없음(req:* 단위 테스트는 순수 — DB/네트워크 불요).

## 3. 명령 사전

**두 축을 혼동하지 말 것.** 아래 3.1은 CommitGate를 **설치한 대상 저장소**가 쓰는 명령(Stage B)이고, 3.2는 **이 저장소 자신**이 자기 스크립트를 개발·검증할 때 쓰는 명령이다. 두 축의 `req:*` 값이 다른 것은 정상이다(§3.3).

두 축 모두에서 `req:*`는 PATH 실행 파일이 아니라 **`package.json` 스크립트**다. npm은 인자 전달에 `--` 구분자가 필요하다. 패키지 매니저별 호출 형식(`buildScriptInvocation`): pnpm/yarn → `<pm> <script> <args>`; npm → `npm run <script> -- <args>`([scripts/req/lib/config.ts](../../scripts/req/lib/config.ts) `buildScriptInvocation`).

### 3.1 설치된 대상 저장소(Stage B)

대상의 `req:*` 값은 `commitgate <verb>`이며([bin/init.ts](../../bin/init.ts) `STAGE_B_REQ_SCRIPTS`), 런처가 verb를 **패키지 내부 모듈**로 dispatch한다([bin/dispatch.mjs](../../bin/dispatch.mjs) `VERB_MODULES`). 대상 repo에 `scripts/req/**`는 존재하지 않는다.

| 명령(npm 기준) | 용도 | 근거 |
|---|---|---|
| `npm install -D commitgate` | 런타임 패키지 설치(**init의 선행 조건**) | [bin/init.ts](../../bin/init.ts) `commitgateDeclared`(D14) |
| `npx commitgate init` | 관리 자산 배치 + `req:*` 주입 | [bin/init.ts](../../bin/init.ts) `planInstall`·`runInit` |
| `npx commitgate migrate [--apply]` | Stage A → Stage B 전환(기본 dry-run) | [bin/migrate.ts](../../bin/migrate.ts) `planMigrate`·`decideScripts` |
| `npx commitgate uninstall` | 제거 계획 출력(읽기 전용) | [bin/uninstall.ts](../../bin/uninstall.ts) |
| `npm run req:new -- <slug> --run` | 티켓·브랜치 생성 | `commitgate req:new` |
| `npm run req:next -- <id> [--json]` | 다음 행동 계산(읽기 전용) | `commitgate req:next` |
| `npm run req:review-codex -- <id> --kind design\|phase [--phase <p>] --run` | Codex 리뷰 | `commitgate req:review-codex` |
| `npm run req:doctor -- <id> [--finalize]` | 일관성 게이트 | `commitgate req:doctor` |
| `npm run req:commit -- <id> --run [-m msg\|--message-file f]` | 승인 커밋 | `commitgate req:commit` |

argv가 없거나 첫 인자가 `-` 옵션이면 argv 전체가 `init`으로 간다(하위호환 — `npx commitgate --dry-run`). 그 외 비-옵션 미지 토큰은 **fail-closed**로 거부한다(오타를 조용히 init으로 보내지 않는다) — [bin/dispatch.mjs](../../bin/dispatch.mjs) `resolveDispatch`.

### 3.2 이 저장소 자신의 개발 명령

CommitGate 저장소는 자기 `req:*`를 **`tsx scripts/req/*.ts`로 직접 실행**한다([package.json](../../package.json) `scripts`). 패키지를 자신에게 설치하지 않으므로 dispatch를 거치지 않는다.

| 명령 | 용도 | 근거 |
|---|---|---|
| `npm run req:new -- <slug> --run` 외 `req:*` 4종 | 자기 워크플로 실행(dogfooding) | `tsx scripts/req/*.ts` |
| `npm test` | vitest 전체 | `vitest run` |
| `npm run typecheck` | 타입검사 | `tsc --noEmit` |
| `npm run smoke` | pack tarball 설치 스모크 | [scripts/smoke.mjs](../../scripts/smoke.mjs) |
| `npm run verify:overrides` | codex 모델·추론강도 override 실효성(수동, codex 필요) | [scripts/verify-review-overrides.mjs](../../scripts/verify-review-overrides.mjs) |

### 3.3 두 축이 공존하는 이유(doctor D19)

이 저장소 자신의 `package.json`이 **Stage A 형태**인 것은 결함이 아니라 위 구조의 필연이다. doctor D19는 `req:*` **값의 형태만으로** `stage-a`/`stage-b`/`mixed`/`none`/`custom`을 분류하고, **`mixed`만 WARN하며 절대 FAIL하지 않는다**([scripts/req/req-doctor.ts](../../scripts/req/req-doctor.ts) `classifyInstallMode`). 이유는 구조적이다 — `req:commit`이 doctor를 exit≠0에 throw하는 하드 게이트로 spawn하므로, Stage A를 FAIL로 보면 **이 저장소 자신의 커밋이 영구 차단**된다. D19는 `bin/init.ts`를 import하지 않고(레이어 역전 방지) shape로만 판정하며, manifest·lockfile·`node_modules`·버전 skew는 **검증하지 않는다**.

### 로컬 개발·검증 순서
1. `npm ci` (또는 `npm install`)
2. `npm run typecheck`
3. `npm test`
4. `npm run smoke`
5. (리뷰 실호출 재현 시) `codex --version` + `codex login status`

## 4. 환경 변수

CommitGate 자체가 정의하는 환경 변수는 **1개**이며, 나머지는 하위 도구(codex/git)의 것이다. 비밀값은 기록하지 않는다.

| 이름 | 필수 | 형식 | 사용 위치 | 효과 | 안전한 예시값 |
|---|---|---|---|---|---|
| `REQ_COMMIT_MESSAGE_FILE` | 아니오 | 파일 경로 | [scripts/req/req-commit.ts](../../scripts/req/req-commit.ts) `resolveMessageSource` | `-m`/`--message-file` 둘 다 없을 때만 커밋 메시지 파일 폴백. `git commit -F`로 전달. | `./commit-message.txt` |
| (codex 인증) | 리뷰 실행 시 | codex 관리 | Codex CLI 내부 | `codex login`으로 저장되는 자격증명. CommitGate는 직접 읽지 않는다. | — |

- `req.config.json` 설정은 환경 변수가 아니라 파일이다(§5).
- Codex 리뷰 시 모델/추론강도는 환경 변수가 아니라 `req.config.json` + `-c` 인자로 고정한다([03-domain-and-data-model.md](03-domain-and-data-model.md)).

## 5. 설정(`req.config.json`)과 우선순위

프로젝트 루트의 선택적 파일. 부재 시 `DEFAULTS` 적용([scripts/req/lib/config.ts](../../scripts/req/lib/config.ts) `loadConfig`). 전체 키·기본값·제약은 [03-domain-and-data-model.md](03-domain-and-data-model.md) §3 참조. 요약:

| 키 | 기본값 | 설명 |
|---|---|---|
| `branchPrefix` | `"feat/req-"` | 새 브랜치 prefix(빈 값 금지 — D11 무력화 방지) |
| `ticketRoot` | `"workflow"` | REQ 티켓 폴더(프로젝트 밖 경로 금지) |
| `packageManager` | `pnpm`(런타임 `DEFAULTS`) | `npm`/`pnpm`/`yarn`. **자동 감지는 설치기만 수행**(lockfile 기준, [bin/init.ts](../../bin/init.ts) `detectPackageManager`)해 `req.config.json`에 주입한다. 런타임 코어 기본값은 `pnpm`([scripts/req/lib/config.ts](../../scripts/req/lib/config.ts) `DEFAULTS`) |
| `reviewPersonaPath` | `"workflow/review-persona.md"` | 리뷰 프롬프트 첫 블록. `null`=비활성 — 단 delta design 리뷰에는 내장 delta 계약이 주입된다(REQ-B-2b) |
| `reviewModel` | `"gpt-5.6-terra"` | codex 리뷰 모델(`-c model=` 고정). `null`=전역 상속 |
| `reviewReasoningEffort` | `"high"` | 추론강도(`none`~`xhigh`). `null`=전역 상속 |
| `granularityMaxFiles` | `8` | phase당 변경 파일 권고 상한(D18 WARN) |
| `designDocs` | `00/01/02` | 설계 문서 파일명 |
| `handoffPath` | `null` | 외부 핸드오프 문서 경로(confinement 예외) |

### 설정 해석 우선순위
- **루트 해석**(`resolveRoot`): `--root` 인자 > `cwd`에서 상향 탐색한 `req.config.json` > 패키지 루트.
- **값 병합**: 파일 값 > `DEFAULTS`. nullable 필드는 `!== undefined` 병합이라 **명시적 `null`이 보존**된다(전역 상속 의도를 지킴).
- **경로 confinement**: `ticketRoot`·`schemaPath`·`reviewPersonaPath`는 상대경로+루트 내부여야 하며, 위반 시 로드가 throw(fail-closed). `handoffPath`만 예외(외부 형제 repo 참조 허용).

### 런타임별 차이
- **Windows**: BOM(UTF-8 BOM) 방어(`stripBom`), `.cmd` 래퍼 안전 spawn, shell 연산자(`&&`) 회피, `%VAR%`/`!VAR!` 확장 경로는 명령 미출력. 상세 [09-security-and-reliability.md](09-security-and-reliability.md).
- **POSIX(Linux/macOS)**: cross-spawn의 POSIX exec 경로. CI가 세 OS 모두 검증.

## 6. 배포 모델과 버전 skew

현재 배포 모델은 **Stage B(런타임 패키지)**다. 실행 코드는 `node_modules/commitgate`에만 있고 대상 repo로 **복사되지 않는다**([bin/init.ts](../../bin/init.ts) `planInstall`). 런타임 갱신은 사용자가 package manager로 `commitgate` 버전을 올리는 것이며, 대상에 복사된 실행 코드가 패키지와 독립적으로 수정되는 **vendored drift 축은 Stage B 설치본에서 사라진다**. 다만 **legacy Stage A 설치본은 `commitgate migrate`로 전환하기 전까지 여전히 vendored 상태**이므로 이 축이 남아 있다.

대신 남는 것이 **자산↔런타임 skew**다. init이 배치하는 **관리 자산**(스키마 2종·`review-persona.md`·`req.config.json`·진입점)은 배치 시점의 사본이며, 이후 패키지를 upgrade해도 **자동으로 갱신되지 않는다**.

- **skew를 자동 감지할 수단이 없다.** 설치 당시 버전·원본 해시를 기록한 **설치 manifest가 없다.** `node_modules` realpath 검증은 **제거됐고**, 애초에 그 검증은 package upgrade 뒤의 자산 skew를 해결하지 못했다.
- **doctor D19도 이 축을 보지 않는다.** D19는 `req:*` 값의 형태만 판정하며 manifest·lockfile·`node_modules`·버전 skew를 검증하지 않는다(§3.3).
- `--force`는 kit 파일을 현재 패키지 원본으로 다시 쓸 수 있으나, 설치 당시 버전·원본 해시·사용자 수정 여부를 기록한 원장이 없다.
- 제거 플래너는 **현재 실행 중인 패키지 원본**과 대상 파일의 바이트를 비교한다. 과거 버전 설치본이나 사용자 수정본은 `differs`로 분류해 자동 소유물로 단정하지 않는다([bin/uninstall.ts](../../bin/uninstall.ts)).
- `package.json` 주입은 기존 키를 보존하는 비파괴 정책이므로, 이미 존재하는 오래된 스크립트 선언이 자동 마이그레이션된다고 보장할 수 없다. Stage A 설치본의 전환은 **명시적 `commitgate migrate`**가 담당하며, 이 역시 **현재 값이 정확히 Stage A 주입값인 키만** 바꾸고 사용자 정의 값은 보존한다([bin/migrate.ts](../../bin/migrate.ts) `decideScripts`).

packed tarball smoke가 무복사·무주입·`req:*` 형태·dispatch 도달·uninstall read-only·migrate 비파괴를 검증한다([scripts/smoke.mjs](../../scripts/smoke.mjs)). 단 **snapshot 비교는 파일 크기 기준**이라 크기가 같은 내용 변경은 놓칠 수 있다.

**이번 범위 밖**(지원한다고 읽지 말 것): Yarn PnP·nested workspace·lockfile/manifest 파서·자산 업그레이드/3-way merge.

이 보수성은 데이터 파괴를 막지만, 여러 repo를 최신 계약으로 유지하는 운영 기능은 아니다. 설치 원장·plan 기반 upgrade는 [gaps-and-decisions.md](gaps-and-decisions.md) G-10 및 [14](14-product-strategy-and-roadmap.md) STR-06의 목표 상태다.
