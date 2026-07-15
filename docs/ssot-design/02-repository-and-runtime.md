# 02. 저장소와 런타임

## 1. 디렉터리 트리 (의미 있는 소스·설정 위주)

```text
commitgate/
├── bin/
│   ├── commitgate.mjs        # npx 진입 런처(tsx 등록 후 init/uninstall 위임)
│   ├── init.ts               # 설치 코어(~1250줄): 복사·주입·프리플라이트
│   └── uninstall.ts          # 읽기 전용 제거 플래너(~597줄): 아무 것도 지우지 않음
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
│   └── REQ-2026-001..013/     # 기존 티켓(증거·설계문서·responses/)
├── templates/                 # 얇은 포인터 진입점 원본 5종
│   ├── claude-skill.md · claude-command.md · cursor-rule.mdc
│   ├── CLAUDE.template.md · workflow.gitignore
├── .github/workflows/ci.yml   # 9-leg 매트릭스 CI
├── docs/RELEASING.md · follow-ups-design.md
├── AGENTS.template.md         # 계약 정본 템플릿(마커 <!-- commitgate:contract -->)
├── req.config.json(.sample)   # 프로젝트 설정(+샘플)
├── package.json · package-lock.json · tsconfig.json · vitest.config.ts
└── tests/unit/*.test.ts       # 15개 테스트 파일
```

`.agents/`는 존재하지만 **비어 있고 git 미추적**이다(빈 스캐폴드) — [tests 조사], `git ls-files .agents` 공백.

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

`req:*`는 PATH 실행 파일이 아니라 **`package.json` 스크립트**다. npm은 인자 전달에 `--` 구분자가 필요하다([scripts/req/lib/config.ts](../../scripts/req/lib/config.ts) `buildScriptInvocation`).

| 명령(npm 기준) | 용도 | 근거 |
|---|---|---|
| `npx commitgate` | 대상 repo에 설치 | [bin/init.ts](../../bin/init.ts) |
| `npx commitgate uninstall` | 제거 계획 출력(읽기 전용) | [bin/uninstall.ts](../../bin/uninstall.ts) |
| `npm run req:new -- <slug> --run` | 티켓·브랜치 생성 | `tsx scripts/req/req-new.ts` |
| `npm run req:next -- <id> [--json]` | 다음 행동 계산(읽기 전용) | `tsx scripts/req/req-next.ts` |
| `npm run req:review-codex -- <id> --kind design\|phase [--phase <p>] --run` | Codex 리뷰 | `tsx scripts/req/review-codex.ts` |
| `npm run req:doctor -- <id> [--finalize]` | 일관성 게이트 | `tsx scripts/req/req-doctor.ts` |
| `npm run req:commit -- <id> --run [-m msg\|--message-file f]` | 승인 커밋 | `tsx scripts/req/req-commit.ts` |
| `npm test` | vitest 전체 | `vitest run` |
| `npm run typecheck` | 타입검사 | `tsc --noEmit` |
| `npm run smoke` | pack tarball 설치 스모크 | [scripts/smoke.mjs](../../scripts/smoke.mjs) |
| `npm run verify:overrides` | codex 모델·추론강도 override 실효성(수동, codex 필요) | [scripts/verify-review-overrides.mjs](../../scripts/verify-review-overrides.mjs) |

패키지 매니저별 호출 형식(`buildScriptInvocation`): pnpm/yarn → `<pm> <script> <args>`; npm → `npm run <script> -- <args>`.

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
| `reviewPersonaPath` | `"workflow/review-persona.md"` | 리뷰 프롬프트 첫 블록. `null`=비활성 |
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
