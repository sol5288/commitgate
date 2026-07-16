# REQ-2026-014 설계 — Stage B 런타임 패키지 모델 (최소 완결 범위)

> 정본 결정은 SSOT. 본 문서는 그 결정을 현재 코드/구조에 반영하는 방법을 기록. 근거: `파일:심볼`.
>
> **범위 조정(PM 결정)**: 이 설계는 r19에서 findings 0건으로 승인된 뒤 r20~r30에서 **P2만 21건**으로 비수렴했다.
> 원인은 결함이 아니라 범위 확장이므로, [00-requirement.md](00-requirement.md) §4의 비목표
> (manifest·provenance·lockfile 파서·버전 완전 일치·realpath 동일성·자동 재실행·failure injection·PnP 완전 지원)를
> **이번 범위에서 제거**한다. **신규 모듈은 `bin/migrate.ts` 하나뿐**이며, 나머지는 기존 코드의 재사용·축소다.

## 0. 현재 상태(변경 대상) — 검증된 사실

| 사실 | 근거 |
|---|---|
| `bin/init.ts`가 `scripts/req/**`·schema·persona·진입점을 **복사**하고 `req:*` 스크립트와 devDeps를 **주입**한다 | `bin/init.ts` `REQ_SCRIPTS`:134, `REQ_DEV_DEPS`:146, 주입 루프 :813-824 |
| **주입은 `if (!(k in scripts))` — 기존 키를 절대 덮어쓰지 않는다** | `bin/init.ts`:814, :820 |
| init은 **Preflight(전 검증·파싱) → Apply(쓰기) 2단계**로 부분 설치를 막는다 | `bin/init.ts` `runInit` 주석 :740 |
| `bin/uninstall.ts`는 **이미 읽기 전용**이다 | `node:fs`에서 `existsSync·readFileSync·readdirSync·statSync`만 import(:20). 쓰기/삭제 API 0건, `--apply` 없음 |
| `bin/uninstall.ts`가 `REQ_SCRIPTS`·`REQ_DEV_DEPS`·`PACKAGE_ROOT`·`assertGitWorkTree`를 `./init`에서 **직접 import**한다 | `bin/uninstall.ts`:26-39 |
| `bin/init.ts`는 uninstall을 import하지 **않는다** → 순환 없음 | grep 확인 |
| `scripts/req/*.ts`가 `req.config.json` 상향탐색/`--root`로 대상 root를 해소한다 — **Stage B의 핵심 enabler** | `scripts/req/lib/config.ts:151` `resolveRoot` |
| `tsx`·`ajv`·`cross-spawn`·`semver`는 **이미 commitgate의 runtime `dependencies`** | `package.json` `dependencies` |
| Phase 1 dispatch(`bin/commitgate.mjs`·`bin/dispatch.mjs`)는 **승인·커밋 완료** | 커밋 `95d94b8`, `phase-1-dispatch-r01-approved.json` findings 0건 |

> **결정 D0(신규 모듈 최소화)**: r19 설계의 `scripts/req/lib/ownership.ts`(KIT_*/REQ_SCRIPTS 이동)와
> `scripts/req/lib/manifest.ts`를 **모두 제거**한다. ownership.ts의 근거였던 "순환/TDZ 회피"는 이미 해결돼 있다 —
> `bin/uninstall.ts`가 `./init`에서 직접 import하는 패턴이 동작 중이고 init은 역방향 import를 하지 않는다.
> `bin/migrate.ts`도 같은 패턴을 쓴다. manifest는 §4에서 제거.

## 1. Stage B 아키텍처 개요

```
대상 프로젝트                                node_modules/commitgate (런타임 패키지)
─────────────────────────────────           ───────────────────────────────────────
package.json  scripts.req:new = "commitgate req:new" ── bin ──▶ bin/commitgate.mjs (dispatch, register tsx)
              devDependencies.commitgate  ── 선행 설치(R6)      ├─▶ scripts/req/req-new.ts · review-codex.ts …
req.config.json (reviewModel/effort pin)                          │    (deps: tsx·ajv·cross-spawn·semver)
workflow/machine.schema.json  ◀ 런타임이 읽음                     ├─ bin/init.ts (Stage B 설치)
workflow/req.config.schema.json                                   ├─ bin/uninstall.ts (읽기 전용 계획)
workflow/review-persona.md                                        └─ bin/migrate.ts (비파괴 전환, Phase 3 신규)
workflow/REQ-*/ (감사 증거)
AGENTS.md / CLAUDE.md / .claude / .cursor
```

핵심: **실행 코드·런타임 의존성은 패키지에만**, **거버넌스·증거·검증 입력은 프로젝트에만**. 런타임 제거는 `npm uninstall -D commitgate`.

## 2. 파일 소유권 표 (설치·보존 기준 — 승인 대상)

자동 삭제가 없으므로 소유권은 **설치 시 어떻게 쓰는가 + 어떻게 보존하는가**로만 분류한다.

| 클래스 | 정의 | 설치(init) | 제거 |
|---|---|---|---|
| **RUNTIME** | 패키지에만 존재. 프로젝트에 복사 안 함. | — | `npm uninstall -D commitgate` |
| **MANAGED** | init이 패키지 원본에서 생성/갱신(없으면 생성, `--force`로만 덮어씀). | 씀 | **자동 삭제 안 함**. 읽기 전용 계획이 "패키지 원본과 동일/수정됨"으로 분류·수동 안내 |
| **SEED-ONCE** | init이 부재 시에만 생성(force도 덮지 않음). 사용자 정책/거버넌스. | 부재 시만 | **항상 보존**. 계획에 "직접 판단" 표시 |
| **PROJECT-DATA** | 사용자·워크플로 생성. init이 만들지 않음. | — | **건드리지 않음** |

### 2.1 소유권 매핑(전수)

| 자산(대상 경로) | Stage A 현재 | **Stage B 클래스** | 근거/비고 |
|---|---|---|---|
| `scripts/req/**` (실행 코드) | 복사 | **RUNTIME** | 패키지에서 실행. 신규 설치는 프로젝트에 없음. (R1/R3) |
| devDeps `tsx`·`ajv`·`cross-spawn` | 주입 | **RUNTIME** | commitgate runtime deps로 전이 설치. 대상 package.json 주입 안 함. (R3) |
| `bin/**`(commitgate.mjs·dispatch.mjs·init·uninstall·migrate) | 패키지 | **RUNTIME** | dispatch·설치·제거 계획·마이그레이션 |
| `workflow/machine.schema.json` | 복사 | **MANAGED** | 런타임이 `schemaPath`로 읽음. 프로젝트 유지(confinement·재현성). (PM 유지) |
| `workflow/req.config.schema.json` | 복사 | **MANAGED** | config 검증 스키마. 동일 축 |
| `workflow/review-persona.md` | 복사(force로 덮임) | **SEED-ONCE** | 프로젝트별 커스터마이즈. 항상 보존(PM). 부재 시만 생성 |
| `req.config.json` | 부재 시 생성/키 병합 | **SEED-ONCE** | 프로젝트 정책(pin 포함). 항상 보존 |
| `AGENTS.md` | 부재 시 생성 | **SEED-ONCE** | 계약 정본. 항상 보존 |
| `AGENTS.commitgate.md` | 마커 없을 때 생성 | **MANAGED** | 병합 안내 사본 |
| `CLAUDE.md` | 부재 시 생성 | **SEED-ONCE** | 지침 포인터. 항상 보존 |
| `.claude/skills/commitgate/SKILL.md`·`.claude/commands/req.md`·`.cursor/rules/commitgate.mdc` | 복사(진입점) | **MANAGED** | 얇은 포인터. `--no-agent-entrypoints`면 미설치 |
| `workflow/.gitignore` | 부재 시 생성 | **SEED-ONCE** | 스크래치 무시 정책. 항상 보존 |
| `package.json` scripts `req:*` | 주입(없는 키만) | **MANAGED(키 단위)** | Stage B는 값을 `commitgate <verb>`로. migrate는 정확한 Stage A 값만 전환(D5) |
| `package.json` devDeps `tsx`·`ajv`·`cross-spawn` | 주입 | **없음(Stage B)** | 주입 안 함(R3) |
| `package.json` `devDependencies.commitgate` | 없음 | **사용자 소유(선행 설치)** | `npm i -D commitgate`가 만든다. init은 **선언 존재만 확인**(D14) |
| `workflow/REQ-*/**` | 워크플로 생성 | **PROJECT-DATA** | 감사 증거. 보존 |

> **결정 D1(스키마 위치, PM 유지)**: 스키마 2종을 프로젝트 MANAGED로 유지(`config.ts`의 confinement·재현성 유지).
> **결정 D2(persona SEED-ONCE, PM 유지)**: persona는 부재 시에만 생성, force도 덮지 않음, 항상 보존.
> **결정 D-M(manifest 제거)**: `.commitgate/manifest.json`은 **도입하지 않는다**. 로컬 manifest는 파일 생성 주체의
> 신뢰 가능한 증거가 아니고(PM), 자동 삭제가 없는 이상 진단 목적만으로 새 파일·새 스키마·새 confinement 축을
> 도입할 이유가 없다. 설치 모드 진단은 **script 형태**로 충분하다(§6). → backlog.

## 3. 런타임 dispatch (Phase 1 — 완료·승인)

`bin/commitgate.mjs`의 verb 테이블(구현 완료):

| verb | 대상 모듈 |
|---|---|
| `req:new`/`req:next`/`req:review-codex`/`req:doctor`/`req:commit` | `scripts/req/{req-new,req-next,review-codex,req-doctor,req-commit}.ts` |
| `uninstall` | `bin/uninstall.ts` (읽기 전용) |
| `migrate` | `bin/migrate.ts` (**Phase 3에서 파일 생성과 함께 verb 등록** — Phase 1에서 미리 등록하지 않는다: 깨진 명령 노출 방지) |
| `init` | `bin/init.ts` |
| (verb 없음 / 첫 인자가 `-` 옵션) | `bin/init.ts`에 **argv 전체 전달** |
| 그 외 비-옵션 첫 토큰 | **throw**(fail-closed) |

> **결정 D3(dispatch 규칙, 구현됨)**: 기존·문서화된 `npx commitgate --dry-run`·`--dir`·`--strict`·`--force`·`--no-agent-entrypoints`·`-h`는
> **첫 인자가 `-` 옵션**이다. 판정: (1) 알려진 verb → 해당 모듈(verb 토큰 소비). (2) argv[0] 부재 **또는 `-` 시작** → `init.ts`에 argv 전체 전달.
> (3) 비-옵션 미지 토큰 → throw.

- **실행 방식**: 각 `scripts/req/*.ts`의 `runCli(argv)` + `main(argv=process.argv.slice(2))`(기존 `if(isMain) main()` 가드 보존 —
  직접 `tsx` 실행 하위호환). launcher는 `mod.runCli(rest)` 호출.
- **cwd 계약**: `npm/pnpm/yarn run req:*`는 cwd=프로젝트 root 보존 → `resolveRoot`가 대상을 찾는다. `--root` 유효. launcher는 cwd 불변.
- **tsx 해소**: `import from 'tsx/esm/api'`는 launcher(.mjs) 기준 정적 해소 → cwd 무관.

## 4. ~~진단용 manifest~~ — **제거됨**

r19 설계의 `.commitgate/manifest.json`·`scripts/req/lib/manifest.ts`·AJV 구조 검증·`.commitgate/` confinement(D8)·
manifest 재기록/rollback은 **이번 범위에서 전부 제거**한다(D-M). 설치 모드 진단은 §6의 script 형태 판정으로 대체한다.
manifest가 없으므로 uninstall planner는 **기존 byte-comparison 분류를 그대로 쓴다**(현행 동작, 변경 없음).

## 5. 설치·제거·마이그레이션 흐름

### 5.1 `commitgate init` — Stage B 설치 (Phase 2)

**Preflight(쓰기 0건) 순서** — 기존 `runInit`의 Preflight 단계에 두 검사를 추가한다.

> 🔴 **순서가 계약이다: D19(Stage A 서명) → D14(선행 설치). 뒤바꾸면 R7이 정상 경로에서 달성되지 않는다.**
> **근거(design r20 P1)**: Stage A 설치본에는 `devDependencies.commitgate`가 **없다** — Stage A는 `npx commitgate`로 설치되고
> `REQ_DEV_DEPS`(`bin/init.ts:146-150`)는 `ajv`·`cross-spawn`·`tsx`뿐 **`commitgate`를 주입하지 않는다**.
> 따라서 D14를 먼저 두면 Stage A 사용자의 `npx commitgate init`은 **항상 D14에서 먼저 죽고**
> "먼저 `npm install -D commitgate`"라는 **엉뚱한 안내**를 받는다 — `commitgate migrate` 안내(R7 인수 기준 4)에 **영원히 도달하지 못한다**.
> 논리적으로도 "이 프로젝트가 이미 Stage A인가?"가 "선행 설치를 했는가?"보다 앞선다.
> 회귀 테스트로 **순서 자체를 고정**한다(Stage A 서명 + commitgate 미선언 → migrate 안내로 throw).

1. **Stage A 서명 감지(D19)** — §5.1-2. **가장 먼저 판정한다.**
2. **선행 설치 확인(D14, 축소)**: 대상 `package.json`에 **`devDependencies.commitgate` 키가 존재하는지만** 확인한다
   (`'commitgate' in (pkg.devDependencies ?? {})`). 없으면 **fail-closed throw** + 안내
   ("먼저 `npm install -D commitgate` 후 `commitgate init`"). `--dir` 대상 기준.

   > 🔴 **키 존재만 본다 — 값의 형태를 검증하지 않는다.** 실측: `npm install -D <packed tarball>`은
   > `"commitgate": "file:../tmp.../commitgate-0.6.0.tgz"`를 쓴다(semver range가 **아니다**).
   > 값을 semver range로 검증하면 **Phase 5의 packed-tarball smoke가 스스로 실패**한다. `file:`·`link:`·`workspace:`·
   > git URL 모두 정당한 설치 형태다. → 키 존재만.
   >
   > **실측 확인(격리 npm 캐시)**: `npm i -D <tgz>` 후 `node_modules/.bin/{commitgate,commitgate.cmd,commitgate.ps1}`가
   > 생성된다 → `req:* = "commitgate <verb>"`가 `npm run`에서 **실제로 해소된다**(가정이 아니라 검증됨).

   > **결정 D14(축소)**: r19는 (a)선언 + (b)`node_modules/commitgate` 존재 + (c)`realpath(PACKAGE_ROOT) === realpath(<target>/node_modules/commitgate)`
   > 3중 검증을 요구했다. **(b)·(c)를 제거하고 (a)만 남긴다.**
   >
   > - **(c) 제거는 타협이 아니라 r19의 자기모순 해소다.** `PACKAGE_ROOT`는 `bin/` 기준 한 단계 위로 module-load 시점에 고정된다
   >   (`bin/init.ts:36`). `npx commitgate init --dir /other/repo`는 npx가 `_npx/<hash>/`로 받아 실행하므로
   >   `PACKAGE_ROOT ≠ /other/repo/node_modules/commitgate`가 되어, **대상이 올바르게 설치돼 있어도 (c)가 fail-closed로 막는다.**
   >   r19의 해법은 "대상 로컬 bin 자동 재실행"이었고 그것도 PM이 잘랐다 → **r19 − 자동재실행 = `--dir`가 구조적으로 깨진 상태**.
   >   `--dir`는 문서화·테스트된 플래그다(`bin/init.ts:1146-1150`, `tests/unit/init.test.ts:832`). (c)를 빼면 `--dir`가 **추가 기능 없이 그대로 동작**한다.
   >   (참고: (c)는 pnpm에서는 문제가 없었다 — `.bin` shim이 `.pnpm/` 스토어의 같은 실경로로 수렴한다. (c)는 pnpm 문제가 아니라 `--dir`/`npx@version` 문제였다.)
   > - **(b) 제거는 명시적 트레이드오프다**(아래 §5.1-1a에 수용 위험으로 기록).
   > - 버전 일치·lockfile 해결 버전 대조는 §4 비목표. → backlog.

   **1a. (b)·(c) 제거로 수용하는 위험 — 명시적 기록**

   > 이 두 항목은 "없어도 된다"가 아니라 **"이번 범위에서 감수한다"**이다. 암묵적으로 두면 나중에 결함으로 읽히므로 여기 적는다.
   >
   > | 제거 | 잃는 것 | 왜 감수 가능한가 | 후속 |
   > |---|---|---|---|
   > | **(b)** node_modules 존재 확인 | "선언했지만 `npm install`을 안 한" 상태가 통과 → init이 `req:* = commitgate <verb>`를 쓰고, 이후 `npm run req:*`가 `commitgate: not found`로 실패 | `installGuidance` 2단계가 **이미 무조건 `<pm> install`을 지시**한다(`bin/init.ts:1080`) → 정상 경로는 자연히 복구된다. 현실적 잔여 케이스는 "README에서 `"commitgate": "^0.7.0"`을 손으로 붙여넣고 install을 건너뛴 사용자"뿐이고, 그때도 표준 npm 오류가 즉시 난다(조용한 손상이 아니다). **반대로 (b)를 넣으면 Yarn PnP(node_modules 없음)·hoisted workspace를 "설치 안 됨"이라는 *틀린 메시지*로 거부**하게 된다 — PnP preflight를 잘라낸 이번 범위에선 (b)가 PnP를 거부하는 주체가 되어버린다 | backlog |
   > | **(c)** 실행 패키지 동일성 | **자산↔런타임 버전 skew를 탐지할 수단이 0이 된다.** init은 `PACKAGE_ROOT`에서 스키마 2종·persona·템플릿을 복사하는데(`bin/init.ts:562-566`), Stage B의 런타임은 `<target>/node_modules/commitgate`다. `npx commitgate@0.7.0 init`을 `commitgate@0.5.0`을 pin한 repo에 돌리면 **v0.7 스키마 + v0.5 런타임**이 되고, `loadConfig`가 `cfg.schemaPathAbs`로 검증하므로 깔끔한 메시지 대신 config 검증 오류로 드러난다 | 기본 경로(`npm i -D commitgate` → `npx commitgate init`)는 npx가 로컬 설치를 우선하므로 skew가 나려면 **명시적 `@version` 또는 교차 repo `--dir`** 가 필요하다. 더 현실적인 skew는 **시간에 따른 upgrade**(`npm update commitgate` 후 옛 스키마가 pin된 채 남음)인데 **(c)는 그것도 못 잡았다** — r19의 답은 manifest `commitgateVersion` + doctor drift WARN이었고 그 둘도 잘렸다. 즉 (c)는 이 위험의 해법이 아니었다 | backlog (drift 탐지는 신뢰 가능한 버전 증거 모델을 먼저 정의해야 함) |
   > ⚠️ **D14는 D19 다음이다**(위 순서 계약). D19가 이미 걸러 낸 Stage A 프로젝트는 D14에 도달하지 않는다.

**(위 1번 D19의 상세)**

- **Stage A 서명 감지(D19)**: 대상이 Stage A 설치본이면 plain init은 기존 `req:*`를 덮지 않아(§0 `if (!(k in scripts))`)
  **vendored 런타임이 계속 실행되는 조용한 혼합 설치**가 된다. 따라서 다음 중 하나라도 참이면 **fail-closed throw** +
  안내("이미 Stage A 설치본입니다 — `commitgate migrate`로 전환하세요"):
  - 대상 `req:*` 키 중 현재 값이 **정확히 `REQ_SCRIPTS`의 Stage A 주입값**인 것이 하나라도 있다, 또는
  - 대상에 `scripts/req/**`가 존재한다.
  > **결정 D19**: Stage A가 아니면 D14로 진행. 이 검사는 R7(혼합 설치 방지)의 유일한 강제 지점이며,
  > **D14보다 먼저 도는 것이 그 강제의 전제**다(위 순서 계약).

3. **기존 preflight 전부 재사용**: `assertGitWorkTree`·package.json 유효·config 스키마·path confinement·
   gitignore/symlink 방어(`assertConfinedDest`·`assertEntrypointPathsUsable`)·dirty 분류. **변경 없음**.

**Apply(쓰기)**

4. 복사: **MANAGED/SEED-ONCE 자산만**(스키마 2종·persona·진입점·계약·`workflow/.gitignore`).
   **`scripts/req/**` 복사 안 함**(R3). MANAGED=부재 시 생성 또는 `--force` 덮어씀; SEED-ONCE=부재 시만.
5. package.json: `req:* = commitgate <verb>` 주입(**없는 키만** — 기존 `if (!(k in scripts))` 규칙 재사용).
   **devDeps 주입 안 함**(R3). `REQ_DEV_DEPS` 상수는 `bin/uninstall.ts`가 기존 Stage A 설치본 분류에 쓰므로 **삭제하지 않는다**.
6. 안내: stage할 경로 목록(기존 shell-safe 가이드) + "commitgate는 devDependency로 관리".

> **결정 D11(제거)**: r19의 "best-effort 트랜잭션(snapshot·write-tracking·실패 rollback)"은 **신규 프레임워크**이므로 만들지 않는다.
> 기존 **Preflight→Apply 2단계**(`bin/init.ts:740`)가 이미 "검증 실패 시 어떤 파일도 쓰기 전에 중단"을 보장한다.
> Stage B는 **쓰기 대상을 줄이기만** 하므로(`scripts/req/**` 복사 제거, devDeps 주입 제거) 부분 설치 위험은 현행보다 **작아진다**.
> 모든 쓰기 지점의 failure injection과 다중 파일 원자성 확장은 §4 비목표. → backlog.

> **결정 D16(`--strict` + 선행 설치)**: 필수 선행 `npm i -D commitgate`는 tracked `package.json`(+lockfile)을 더럽힌다.
> **파일 단위 예외는 두지 않는다**(무관 변경까지 통과 위험). 계약: `--strict`는 기존대로 모든 preexisting-dirty에서 중단하되
> **원인 안내**("선행 설치분을 먼저 커밋: `git add package.json <lockfile> && git commit`").
> 권장 순서: `npm i -D commitgate` → 커밋 → `commitgate init [--strict]` → 설치분 커밋. 비-strict init은 preexisting-dirty를 WARN만.

- `--no-agent-entrypoints`·`--dry-run`·`--force`·`--dir` 동작 보존(R10).

### 5.2 `commitgate uninstall` — 읽기 전용 계획만 (Phase 3)

- **현재 이미 읽기 전용이다**(§0 검증: `node:fs` 조회 API만, `--apply` 없음). **삭제 기능을 추가하지 않는다.**
- Stage B에 맞춘 **안내 조정만**:
  - 프로젝트의 MANAGED/SEED-ONCE 파일을 기존 byte-comparison(패키지 원본과 동일/수정됨)·SEED-ONCE(항상 보존)·
    PROJECT-DATA(증거, 보존)로 분류 출력. **기존 로직 유지**.
  - **런타임 제거는 `npm uninstall -D commitgate`**임을 안내(신규 설치본에 `scripts/req/**`는 없다).
  - package.json `req:*`는 **수동 정리 후보로 표시만**(자동 수정/삭제 없음), `git diff`·`git revert` 안내.
- **읽기 전용 불변식**: `node:fs` 조회 API만, git allowlist(`rev-parse`/`status`/`ls-files`/`log`), **npm spawn 없음**.
  회귀 테스트로 **전후 tree snapshot 동일**을 고정한다.
  > 🔴 **`npm uninstall -D commitgate`는 문자열로 출력만 한다 — spawn하지 않는다**(`bin/uninstall.ts:17`의 기존 계약).
  > 주의: 현재 구조적 "무쓰기" 테스트(`tests/unit/uninstall.test.ts:107`)는 **`bin/uninstall.ts` 파일만** 스캔하고
  > 금지 식별자 목록에 `spawn`/`exec*`가 **빠져 있다**. 즉 이 계약은 지금 테스트로 고정돼 있지 않다.
  > Phase 3은 런타임 제거 안내를 다루므로 **npm spawn 유혹이 실제로 생기는 지점**이다 — 안내는 출력 문자열로만 낸다.

### 5.3 `commitgate migrate` — 비파괴 전환 (Phase 3, 신규 `bin/migrate.ts`)

- **import 패턴**: `REQ_SCRIPTS`·`assertGitWorkTree`를 `./init`에서 직접 import(D0 — `bin/uninstall.ts`와 동일 패턴, 순환 없음).
- 🔴 **대상 root는 `--dir`로만 해소한다(기본 `process.cwd()`) — `resolveRoot`를 쓰지 않는다.**
  `resolveRoot`(`scripts/req/lib/config.ts:151`)의 fallback ③은 config를 못 찾으면 **`packageRoot()`를 반환**한다(`config.ts:160`).
  migrate는 **package.json을 쓰는 변경 동사**이므로, 그 fallback을 타면 **CommitGate 패키지 자신의 `package.json`을 재작성**할 수 있다.
  init·uninstall이 이미 `--dir` 방식을 쓴다(`bin/init.ts:1139`, `bin/uninstall.ts:548`) — 같은 방식을 따른다.
- **감지**: package.json `req:*`가 `tsx scripts/req/*.ts`(Stage A) vs `commitgate <verb>`(Stage B)인지로 설치 모드 판정(§6 규칙과 개념 공유).
- **exact-match 판정 로직은 이미 있다 — 네 번째 비교문을 만들지 않는다**: `bin/uninstall.ts:295-303`의
  `cur === injected`(`REQ_SCRIPTS` 순회)가 곧 "정확히 Stage A 주입값인가" 판정이다. migrate는 이 술어를 재사용한다.
- **기본 dry-run**: 계획만 출력, **파일 쓰기 0건**.
- **전환 규칙(D5)**: `req:*` 각 키의 **현재 값이 정확히 Stage A 주입값(`REQ_SCRIPTS` SSOT)일 때만** `commitgate <verb>`로 전환한다.
  **사용자 정의 값(예: `req:new="node custom.mjs"`)은 절대 덮어쓰지 않고 보존 + 수동 조치 안내**.
- **선행 설치 확인**: `--apply` 전에 `devDependencies.commitgate` 선언 존재만 확인(§5.1-1과 동일 축소 규칙). 없으면 fail-closed.
- **비파괴(D5·PM)**: `scripts/req/**`·schema·persona·`req.config.json`·진입점·`workflow/REQ-*` 증거를 **자동 삭제하지 않는다**.
  정리는 **읽기 전용 uninstall planner(§5.2)** 또는 **git revert 안내**로만.
- **`--apply` 쓰기 범위**: **`package.json` 한 파일**. 커밋하지 않는다(사용자가 검토 후 stage/commit).
  단일 파일 쓰기이므로 다중 파일 rollback 프레임워크가 필요 없다(D11 제거와 일관).
- **verb 등록**: `bin/dispatch.mjs`의 `VERB_MODULES`에 `migrate` 1줄 추가(파일 생성과 동시).
  > **Phase 1 tripwire(의도된 것)**: `tests/unit/dispatch.test.ts`는 현재 `'migrate' in VERB_MODULES === false`와
  > `resolveDispatch(['migrate','--dry-run']) === {unknown:'migrate'}`를 단언한다. 이는 "미등록이 정상"임을 고정한 **의도적 tripwire**이므로,
  > Phase 3이 verb를 등록할 때 **이 두 단언을 Stage B 기대값으로 다시 쓰는 것이 정상**이다. Phase 1 회귀가 아니다.
- **migrate의 `runCli`는 반드시 동기(sync)여야 한다**: launcher(`bin/commitgate.mjs`)가 `mod.runCli(rest)`를
  **await 없이** 호출하고 기존 7개 runCli가 전부 sync `void`다. async면 promise가 버려져 오류가 unhandledRejection이 되고
  exit code가 소실된다. → migrate는 동기 IO만 쓴다(기존 init/uninstall과 동일).
- **오류·exit 계약은 throw만으로 확보된다**: 모든 runCli가 `try { main(argv) } catch { 1줄 stderr + process.exitCode=1 }`로
  동일하다. migrate는 **actionable 메시지로 throw**하면 되고 별도 rollback 보고 표면이 필요 없다.
- **flag 파싱은 migrate가 100% 소유**한다: dispatch는 verb 토큰만 소비하고(`rest = argv.slice(1)`) `--`를 스트립하지 않는다.
  기존 `parseArgs` 관례(`--flag=value` 미지원, 미지 토큰 throw)를 따른다.

## 6. 설치 모드 진단 — script 형태 기준 (Phase 4, doctor D19)

manifest 없이 **`package.json`의 `req:*` 값 형태만으로** 판정한다(D-M).

| 모드 | 판정 | level |
|---|---|---|
| **Stage B** | `req:*` 값이 전부 `commitgate <verb>` 형태 | OK |
| **Stage A** | `req:*` 값이 전부 Stage A 형태(`tsx scripts/req/<file>.ts`) | **OK** (정당한 설치 형태) |
| **mixed** | Stage A 형태와 Stage B 형태가 **섞여 있다** | **WARN** + `commitgate migrate` 안내 |
| **none/custom** | `req:*` 키가 없거나 사용자 정의 값 | OK(점검 불요/사용자 값) |

> **결정 D-DOC1(level은 WARN이 상한 — FAIL 금지)**: 이 검사는 **절대 FAIL이 되어선 안 된다.**
> 근거: (a) **CommitGate 자신의 `package.json`이 Stage A 형태다**(`req:new = tsx scripts/req/req-new.ts` — 개발 repo가
> 자기 스크립트를 직접 실행하므로 정상이다). (b) `req:commit`이 `req:doctor`를 **하드 게이트로 spawn하고 exit≠0이면 throw**한다.
> 따라서 FAIL 레벨이면 **이 저장소 자신의 `req:commit`이 영구 차단**되고, 정당한 Stage A 소비자 전원의 커밋도 막힌다.
> Stage A는 결함이 아니라 **지원되는 설치 형태**다 — mixed만 WARN한다.

> **결정 D-DOC2(shape 판정, import 없음)**: doctor는 `bin/init.ts`를 **import하지 않는다**. init.ts는 cross-spawn·semver·
> npm spawn을 끌고 오는 ~1200줄 설치 CLI이고, 매 커밋 게이트로 도는 스크립트가 그것을 로드하는 것은 레이어 역전이다.
> 대신 **값의 형태(shape)** 로 판정하는 순수 함수 `classifyInstallMode(scripts)`를 `req-doctor.ts`에 export한다.
> 요구(§R7)도 "**script 형태를 기준으로**"이지 바이트 일치가 아니다.
>
> **migrate와의 비대칭은 의도적이다**: migrate의 전환(D5)은 **쓰기**이므로 `REQ_SCRIPTS` **바이트 정확 일치**를 요구하고
> (`./init`에서 import), doctor의 진단은 **읽기 전용 advisory**이므로 shape로 충분하다. 강도를 바꾸면 안 되는 쪽은 migrate다.

- **doctor D-check 번호는 D19**(현재 구현 최대 D18 다음). `D1/D4/D4a/D7/D7b/D8/D12/D14`는 **예약된 결번**이므로 재사용하지 않는다.
- ⚠️ **번호 공간 충돌 주의(읽는 사람을 위한 경고)**: 이 문서의 `D<n>`은 **이 티켓의 설계 결정 id**이고,
  `req-doctor.ts`의 `D<n>`은 **doctor 점검 id**다. **완전히 다른 번호 공간**이며 우연히 겹친다:
  | 번호 | 이 문서(설계 결정) | doctor(점검 id) |
  |---|---|---|
  | **D14** | 선행 설치 확인(§5.1-1) | **예약된 결번**(미구현) |
  | **D19** | Stage A 서명 감지(§5.1-2) | **설치 모드 진단**(이번에 신설) |
  SSOT `00-document-control.md`가 이 충돌을 이미 명시한다. 리뷰 시 두 D19를 같은 것으로 읽지 말 것.
- `DoctorInputs`에 추가하는 필드는 **반드시 optional**이어야 한다 — `tests/unit/req-doctor.test.ts`가
  `const base: DoctorInputs = {…}`로 required 필드만 나열하므로 required 추가는 즉시 tsc 오류다.
  `reqScripts?: Record<string,string> | null`(undefined=미조회 → OK '점검 불요', null=package.json 없음/파손, object=파싱 결과).
- IO는 `main()`에서만(runChecks는 순수 계약). package.json 읽기에 **`stripBom` 적용** — BOM'd package.json은 이 플랫폼에서
  실제로 발생하는 실패다(PowerShell `Set-Content -Encoding UTF8`).
- 모든 검사는 **모든 경로에서 정확히 1개 Check를 push**한다(비해당도 OK '점검 불요'). D19 블록은 D17 뒤 `return c` 앞에 **append**한다.
- **manifest·lockfile·버전 드리프트·PnP 탐지에 의존하지 않는다.**

## 7. 재현성·지원 경계 (R8·R9, Phase 4·5 — 문서 확정)

- **리뷰 입력 고정**: `req.config.json`(reviewModel/effort pin)·스키마·persona가 **프로젝트에 pin** → 패키지 버전이 올라도 과거 리뷰 입력은 git 이력으로 재현.
- **런타임 고정**: lockfile이 `commitgate`+전이 deps(`tsx`·`ajv`·`cross-spawn`·`semver`)를 pin한다.
  **lockfile 커밋을 문서로 권고**한다. **lockfile 내부 파서는 만들지 않는다**(§4 비목표).
- **과거 Stage A 감사 불변**: 기존 `workflow/REQ-*/` 증거는 git 커밋되어 본 변경과 무관하게 유효.
- **PM 지원 경계**:
  - **npm packed install** = 필수 end-to-end 지원(smoke로 증명).
  - **pnpm·yarn** = `node_modules` linker에서 **표준 local bin 해소를 쓰는 범위**로 지원(bin이 `node_modules/.bin/commitgate`로 해소).
  - **Yarn PnP** = 이번 릴리스 **문서화된 제한**. 자동 설정 변경·자동 재실행 없음. → backlog(preflight/doctor WARN).
  - **workspace** = 단일 패키지 또는 **워크스페이스 root 설치** 지원(root에 req.config.json·workflow).
    하위 패키지 독립 설치는 `resolveRoot` 상향탐색이 상위 root를 먼저 만날 수 있어 **문서화된 제한**.

## 8. 보안 불변식 보존 (R10)

- init/uninstall/migrate 모두 기존 `assertGitWorkTree`·`findIgnoredArtifacts`·`classifyPreexistingDirty`·
  `safeSpawnSync`를 **재사용**한다. **새 confinement 축(`.commitgate/`)은 추가하지 않는다**(D-M).
- **현행 confinement 범위를 정확히 기술한다(과장 금지)**: `assertConfinedDest`(`bin/init.ts:318`, module-local)는
  **호출 지점이 정확히 1곳**(`:851`, `workflow/.gitignore`)이고 **상위 컴포넌트만** lstat한다(leaf 검사는 `:855-865` 인라인).
  `KIT_COPY_RELPATHS` 복사와 `applyCopies`는 lstat 기반 confinement를 받지 않으며,
  `assertEntrypointPathsUsable`은 `statSync`(symlink를 **따라감**)라 symlink 방어가 아니다.
  → 이 설계는 "repo 전역 confinement가 이미 있다"고 주장하지 않는다. **현행 범위를 그대로 유지**할 뿐이다.
- **Stage B는 쓰기 표면을 줄인다**: `scripts/req/**` 복사(현행 confinement 미적용 경로 중 최대 표면)와 devDeps 주입이
  사라지므로, 비-confined 쓰기 표면과 부분 설치 위험은 현행보다 **작아진다**. 새 위협 표면을 추가하지 않는다.
- fail-closed: 비-옵션 미지 verb(D3)·손상 config·**`devDependencies.commitgate` 미선언(D14)**·**Stage A 서명(D19)**는 throw.
  init 옵션(`-` 시작)은 init 라우팅(D3).
- review-codex의 sandbox read-only·path confinement·프롬프트 주입 방어는 **스크립트 미변경**(Phase 1 runCli 래핑만) 유지.
- **자동 삭제 없음** → 파일 삭제 관련 위협 표면 자체가 없다. migrate 전환은 정확한 Stage A 주입값에만(D5) — 사용자 설정 미덮어씀.
- **Stage B는 대상의 `cross-spawn`을 실행하지 않는다** — `safeSpawnSync`는 패키지 자신의 `dependencies.cross-spawn`(`^7.0.6`)에서 돈다.
  기존 `crossSpawnBelowFloor` 진단은 대상에 cross-spawn이 없으면 자동으로 무동작이므로(`existingCrossSpawnSpec` null → return null)
  **이번 범위에서 건드리지 않는다**. Stage B에서의 의미 재검토는 → backlog.

## 9. Phase별 구현

[02-plan.md](02-plan.md) 참조. 요약: **P1 dispatch/runCli(완료·승인)** → P2 Stage B init(`bin/init.ts` 단일 파일) →
P3 비파괴 migrate(`bin/migrate.ts` 신규) + Stage B uninstall 안내 + verb 등록 → P4 설치 모드 진단(doctor D-check 1건) →
P5 문서·packed-tarball smoke.

## 9.1 테스트 영향(blast radius) — 측정치

Stage B init은 **기존 테스트 픽스처의 전제를 바꾼다**. 규모를 미리 고정해 phase가 "그린" 조건을 못 맞추는 일을 막는다.

| 사실 | 수치/근거 | 조치 |
|---|---|---|
| `runInit` 호출 지점 | **90곳**(init.test.ts 86 · uninstall.test.ts 2 · req-config.test.ts 2) | 아래 픽스처 1줄로 대부분 해소 |
| 픽스처 기본 package.json에 `devDependencies.commitgate`가 **없다** | `tmpTarget` 기본 `{name:'x',version:'0.0.0'}` | **D14가 전부 throw시킨다** → 기본 pkg에 `devDependencies:{commitgate:'…'}` 추가(1줄). `pkg` 명시 override는 **6곳**만 개별 조정 |
| `uninstall.test.ts`가 `runInit`을 **설치 픽스처**로 쓰고 vendored `scripts/req/**` 존재에 의존 | :420-422, :584-615 (13곳 참조) | **`bin/uninstall.ts` 소스는 유지**(Stage A 프로젝트 분류에 계속 필요). 해당 테스트는 **Stage A 픽스처를 직접 시드**하도록 조정 — **Phase 2에 포함**(init 변경과 동시에 깨지므로) |
| "부분 설치 없음"을 `existsSync('scripts/req/req-new.ts')===false`로 증명하는 fail-closed 테스트 **7건** | init.test.ts:471,600,622,803,825 등 | Stage B에선 **성공 경로에서도 그 경로가 안 생겨 단언이 공허(vacuous)해진다.** Stage B가 실제로 쓰는 경로(`req.config.json`·스키마)로 **재-앵커** — 그러지 않으면 검증 소실 |
| 보안 회귀 세트 **14건**(symlink/confinement 4 · zero-write snapshot 4 · gitignore preflight 6) | init.test.ts:1781~1841, :990/:1042/:1520 등 | **변경 없이 그대로 통과해야 한다**(R10 판정 기준) |
| `classifyPreexistingDirty`·`parseArgs`·BOM·pm 감지 등 순수 함수 테스트 | init.test.ts:832~899 등 | Stage-B 중립 — 손대지 않는다 |
| `KIT_COPY_RELPATHS` SSOT 단언 | init.test.ts:119,126 | **영향 없음** — Stage B가 제거하는 것은 `KIT_SOURCE_DIR_REL`(`scripts/req`) 복사 축이고, `KIT_COPY_RELPATHS`(스키마+persona)는 그대로 복사된다 |
| `installGuidance` 블록 **29건** | init.test.ts:1142-1635 | **이번 범위에서 손대지 않는다.** 2단계 `<pm> install`은 Stage B에서 **중복이지 오류가 아니다**(선행 설치로 이미 완료). 문구 정합은 Phase 5 문서에서 판단 |
| 전제 모순 주석 | init.test.ts:263-278 — "`npx commitgate`는 `node_modules/commitgate/`를 남기지 않는다"를 포인터 결정의 **근거**로 기록 | Stage B(devDep 설치)에서 그 전제는 더 이상 참이 아니다. **동작(AGENTS.commitgate.md 포인터)은 유지**하고 **근거 주석만** 정정 |

## 10. 변경 파일(개괄)

- **신규**: `bin/migrate.ts`, `tests/unit/migrate.test.ts`.
  (~~`scripts/req/lib/ownership.ts`~~·~~`scripts/req/lib/manifest.ts`~~ — D0/D-M로 제거)
- **수정**: `bin/init.ts`(Stage B 모드·D14 축소·D19), `bin/commitgate.mjs`(`migrate` verb — Phase 3),
  `bin/uninstall.ts`(Stage B 안내 조정), `scripts/req/req-doctor.ts`(설치 모드 D-check),
  `scripts/smoke.mjs`(Stage B 경로), `README.md`/`README.en.md`/CLI help, 관련 unit test.
- **불변**: `scripts/req/*.ts`의 리뷰·게이트 로직(Phase 1 runCli 진입 외), `machine.schema.json`, `review-persona.md`,
  `classifyReview` 등 리뷰 상태 전이.

## 11. 하위호환·안전

- 기존 Stage A 설치본: 직접 `tsx scripts/req/*.ts` 실행 가드가 보존되므로 **깨지지 않는다**. 전환은 opt-in `migrate`(dry-run 우선·비파괴).
- 신규 Stage B 설치본에서 plain `init`을 Stage A 프로젝트에 돌리면 **fail-closed**(D19) — 조용한 혼합 설치 없음.
- 롤백: 각 phase는 독립 커밋(REQ 게이트). Stage B init은 파일 생성만(커밋 없음) → git으로 되돌림.
  Preflight→Apply 2단계가 검증 실패 시 무쓰기를 보장.
- 사용자 트리의 기존 staged/uncommitted 변경은 건드리지 않음(clean-tree 게이트 존중).
