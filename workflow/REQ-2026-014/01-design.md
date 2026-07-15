# REQ-2026-014 설계 — Stage B 하이브리드 런타임 모델 (축소 범위)

> 정본 결정은 SSOT. 본 문서는 그 결정을 현재 코드/구조에 반영하는 방법을 기록. 근거: `파일:심볼`.
>
> **범위 조정(PM 결정)**: 로컬 manifest는 파일 생성 주체의 신뢰 가능한 증거가 아니다. 따라서 **프로젝트 파일 자동 삭제**
> (`uninstall --apply`·`createdByCommitgate`·hash 삭제 증명·설치-저장소 결속·지문 레지스트리)는 **이번 REQ에서 제외**한다.
> `uninstall`은 **읽기 전용 계획**만, migration은 **비파괴**만. 자동 삭제 관련 새 예외는 추가하지 않는다.

## 0. 현재 상태(변경 대상)

- `bin/init.ts`가 `scripts/req/**`(실행 코드)·schema·persona·진입점을 **복사**하고, 대상 `package.json`에 `req:* = tsx scripts/req/*.ts`
  스크립트와 devDeps `ajv`·`cross-spawn`·`tsx`를 **주입**한다(`REQ_SCRIPTS`/`REQ_DEV_DEPS`).
- launcher `bin/commitgate.mjs`는 `tsx/esm/api`로 `.ts`를 실행, verb는 `uninstall`만 분기하고 나머지는 `init` 폴백.
- `bin/uninstall.ts`는 이미 **읽기 전용 계획만** 출력한다(`--apply` 없음). Stage B에서도 이 성질을 유지·확장한다.
- `scripts/req/*.ts`는 대상 root를 `req.config.json` 상향탐색 또는 `--root`로 해소한다(`scripts/req/lib/config.ts:151` `resolveRoot`).
  **이 해소 로직이 Stage B의 핵심 enabler** — 스크립트가 `node_modules`에서 실행돼도 대상 프로젝트를 root로 잡는다.
- `tsx`·`ajv`·`cross-spawn`·`semver`는 이미 commitgate의 **runtime `dependencies`**다 → `npm i -D commitgate` 시 함께 설치되어 bin이 self-contained.

## 1. Stage B 아키텍처 개요

```
대상 프로젝트                                node_modules/commitgate (런타임 패키지)
─────────────────────────────────           ───────────────────────────────────────
package.json  scripts.req:new = "commitgate req:new" ── bin ──▶ bin/commitgate.mjs (dispatch, register tsx)
req.config.json (reviewModel/effort pin)                          ├─▶ scripts/req/req-new.ts · review-codex.ts …
workflow/machine.schema.json  ◀ 런타임이 읽음                     │    (deps: tsx·ajv·cross-spawn·semver)
workflow/req.config.schema.json                                   ├─ bin/init.ts (Stage B 설치)
workflow/review-persona.md                                        ├─ bin/uninstall.ts (읽기 전용 계획)
workflow/REQ-*/ (감사 증거)                                       └─ bin/migrate.ts (비파괴 전환)
AGENTS.md / CLAUDE.md / .claude / .cursor
.commitgate/manifest.json  ── 진단용(설치 모드·버전·파일 목록), 삭제 권한 없음
```

핵심: **실행 코드는 패키지에만**, **거버넌스·증거·검증 입력은 프로젝트에만**. 런타임 제거는 `npm uninstall -D commitgate`.

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
| `bin/**`(commitgate.mjs·init·uninstall·migrate) | 패키지 | **RUNTIME** | dispatch·설치·제거 계획·마이그레이션 |
| `workflow/machine.schema.json` | 복사 | **MANAGED** | 런타임이 `schemaPath`로 읽음. 프로젝트 유지(confinement·재현성). (PM 유지 결정) |
| `workflow/req.config.schema.json` | 복사 | **MANAGED** | config 검증 스키마. 동일 축 |
| `workflow/review-persona.md` | 복사(force로 덮임) | **SEED-ONCE** | 프로젝트별 커스터마이즈. 항상 보존(PM). 부재 시만 생성 |
| `req.config.json` | 부재 시 생성/키 병합 | **SEED-ONCE** | 프로젝트 정책(pin 포함). 항상 보존 |
| `AGENTS.md` | 부재 시 생성 | **SEED-ONCE** | 계약 정본. 항상 보존 |
| `AGENTS.commitgate.md` | 마커 없을 때 생성 | **MANAGED** | 병합 안내 사본 |
| `CLAUDE.md` | 부재 시 생성 | **SEED-ONCE** | 지침 포인터. 항상 보존 |
| `.claude/skills/commitgate/SKILL.md`·`.claude/commands/req.md`·`.cursor/rules/commitgate.mdc` | 복사(진입점) | **MANAGED** | 얇은 포인터. `--no-agent-entrypoints`면 미설치 |
| `workflow/.gitignore` | 부재 시 생성 | **SEED-ONCE** | 스크래치 무시 정책. 항상 보존 |
| `package.json` scripts `req:*` | 주입(없는 키만) | **MANAGED(키 단위)** | Stage B는 값을 `commitgate <verb>`로. migrate는 정확한 Stage A 값만 전환(D5) |
| `package.json` devDeps | 주입 | **없음(Stage B)** | 주입 안 함 |
| `.commitgate/manifest.json` | 없음(신규) | **commitgate 메타데이터(진단용)** | 설치 모드·버전·파일 목록. **매 init 재기록(force 무관), D11 snapshot 대상. 삭제 권한 없음** |
| `workflow/REQ-*/**` | 워크플로 생성 | **PROJECT-DATA** | 감사 증거. 보존 |

> **결정 D1(스키마 위치, PM 유지)**: 스키마 2종을 프로젝트 MANAGED로 유지(`config.ts`의 `assertUnderRoot` confinement·재현성 유지).
> **결정 D2(persona SEED-ONCE, PM 유지)**: persona는 부재 시에만 생성, force도 덮지 않음, 항상 보존.

## 3. 런타임 dispatch (Phase 1)

`bin/commitgate.mjs`의 verb 테이블 확장:

| verb | 대상 모듈 |
|---|---|
| `req:new`/`req:next`/`req:review-codex`/`req:doctor`/`req:commit` | `scripts/req/{req-new,req-next,review-codex,req-doctor,req-commit}.ts` |
| `uninstall` | `bin/uninstall.ts` (읽기 전용) |
| `migrate` | `bin/migrate.ts` (**Phase 3에서 파일 생성과 함께 verb 등록** — Phase 1에서 미리 등록하지 않는다: 깨진 명령 노출 방지) |
| `init` | `bin/init.ts` |
| (verb 없음 / 첫 인자가 `-` 옵션) | `bin/init.ts`에 **argv 전체 전달** |
| 그 외 비-옵션 첫 토큰 | **throw**(fail-closed) |

> **결정 D3(dispatch 규칙)**: 기존·문서화된 `npx commitgate --dry-run`·`--dir`·`--strict`·`--force`·`--no-agent-entrypoints`·`-h`는
> **첫 인자가 `-` 옵션**이다. 판정: (1) 알려진 verb → 해당 모듈(verb 토큰 소비). (2) argv[0] 부재 **또는 `-` 시작** → `init.ts`에 argv 전체 전달.
> (3) 비-옵션 미지 토큰 → throw. 회귀: `--dry-run`/`--dir`/`--strict`/`--force`/`--no-agent-entrypoints`/`-h`가 init으로 라우팅.

- **실행 방식**: 각 `scripts/req/*.ts`에 `runCli(argv)` + `main(argv=process.argv.slice(2))` 진입 추가(기존 `if(isMain) main()` 가드 보존 —
  직접 `tsx` 실행 하위호환·기존 테스트 유지). launcher는 `mod.runCli(rest)`(예외→친절한 1줄+exit1 경계) 호출.
- **cwd 계약**: `npm/pnpm/yarn run req:*`는 cwd=프로젝트 root 보존 → `resolveRoot`가 대상을 찾는다. `--root` 유효. launcher는 cwd 불변.
- **tsx 해소**: `import from 'tsx/esm/api'`는 launcher(.mjs) 기준 정적 해소 → cwd 무관.

## 4. 진단용 manifest (Phase 2)

경로: `<root>/.commitgate/manifest.json`(git 커밋 대상). **진단·설치 모드 식별 전용, 삭제 권한 없음.**

```jsonc
{
  "manifestVersion": 1,
  "commitgateVersion": "0.7.0",
  "installMode": "runtime",          // "runtime" | "migrated-from-vendored"
  "files": ["workflow/machine.schema.json", "workflow/review-persona.md", "AGENTS.md", …],  // init이 설치/관리하는 경로 목록(진단용)
  "packageJson": { "scriptsSet": ["req:new","req:next","req:review-codex","req:doctor","req:commit"] }
}
```

- 용도: (a) `doctor`가 설치 모드(vendored/runtime/migrated)를 식별, (b) 읽기 전용 uninstall 계획이 "무엇을 설치했는지" 참고. **삭제 근거 아님**.
- AJV 구조 검증(손상 시 진단에서 무시하고 byte-comparison 폴백 — 안전, 읽기 전용). `createdByCommitgate`·hash 삭제 증명·`installRepoAnchor` 없음(범위 밖).
- **`.commitgate/` 경로 confinement(D8)**: init이 manifest를 쓸 때 `assertConfinedDest`(부모/대상 lstat, symlink·비-디렉터리 거부) 적용.

## 5. 설치·제거·마이그레이션 흐름

### 5.1 `commitgate init`(=default) — Stage B 설치 (Phase 2)
0a. **PnP preflight(D18 — R6, D14보다 먼저)**: `.pnp.cjs`/`.pnp.loader.mjs` 또는 `package.json`의 `installConfig.pnp`/PnP linker 감지 시,
    D14의 일반 "로컬 설치" 오류보다 **먼저** fail-closed throw + **`nodeLinker: node-modules` 전환 필요** 안내(자동 설정 변경 금지, PM). init·migrate 공통.
0b. **로컬 직접 devDependency + 실행 패키지 동일성 검증(D14)**: Stage B는 `req:* = commitgate <verb>`를 심으므로 대상에 commitgate가 **직접 devDependency**로 있어야 한다.
    검증(모두): (a) 대상 `package.json`의 **`devDependencies.commitgate` 선언 존재**(일반 `dependencies`·전이/hoisted-only는 거부 — `npm i -D`가 아닌 설치를 막음),
    (b) `<target>/node_modules/commitgate/package.json` 존재, (c) `realpathSync.native(PACKAGE_ROOT) === realpathSync.native(<target>/node_modules/commitgate)`.
    어느 하나라도 실패 → **fail-closed throw** + 안내("먼저 `npm install -D commitgate` 후 `npx commitgate init`"). `--dir` 대상 기준. PM별 devDep 선언 위치 동일(package.json).
0c. **Stage A 서명 감지 → migrate 안내(D19)**: 대상에 Stage A 서명(기존 `req:*` 값이 `tsx scripts/req/*.ts` **또는** `scripts/req/**` 존재)이 있으면,
    plain init은 기존 `req:*`를 덮지 않아 **vendored 런타임이 계속 실행**되는데 manifest만 `runtime`으로 잘못 기록될 수 있다. 따라서 init은 이 경우
    **fail-closed throw** + 안내("이미 Stage A 설치본입니다 — `commitgate migrate`로 전환하세요"). Stage A가 아니면 정상 Stage B 설치 진행.
1. Preflight(기존 재사용): `assertGitWorkTree`·package.json 유효·config 스키마·path confinement·gitignore/symlink 방어·dirty 분류 **+ `.commitgate/` confinement(D8)**.
2. 복사: **MANAGED/SEED-ONCE 자산만**(스키마·persona·진입점·계약·gitignore). `scripts/req/**` **복사 안 함**. (MANAGED=부재 시 생성 또는 `--force` 덮어씀; SEED-ONCE=부재 시만)
3. package.json: `req:* = commitgate <verb>` 주입(없는 키만). **devDeps 주입 안 함**.
4. `.commitgate/manifest.json`(진단용) 기록 — **manifest는 commitgate 소유 메타데이터라 `--force` 무관하게 매 init에서 현재 상태로 (재)기록**한다(§2 MANAGED
   "force로만 덮어씀" 규칙의 명시적 예외; 진단 정확성을 위해 항상 최신 버전/모드/파일목록 반영). 기존 manifest는 **D11 snapshot에 포함**해 write 실패 시 원본 복원.
5. 안내: stage할 경로 목록(기존 shell-safe 가이드) + "commitgate는 devDependency로 관리".
- **best-effort 트랜잭션(D11)**: preflight(무쓰기) → snapshot(package.json + **`--force`로 덮어쓸 기존 파일 + 기존 `.commitgate/manifest.json`** 바이트) →
  쓰기(추적) → 실패 시 rollback(새로 만든 파일 삭제 + 덮어쓴 파일·기존 manifest 복원 + package.json 복원). 부분 설치를 조용히 남기지 않음.
- **`--strict` + 선행 설치(D16)**: 필수 선행 `npm i -D commitgate`는 tracked `package.json`(+lockfile)을 더럽힌다. **파일 단위 예외는 두지 않는다**
  (무관 변경까지 통과 위험). 계약: `--strict`는 기존대로 모든 preexisting-dirty에서 중단하되 **원인 안내**("선행 설치분을 먼저 커밋: `git add package.json <lockfile> && git commit`").
  권장 순서: `npm i -D commitgate` → 커밋 → `commitgate init [--strict]` → 설치분 커밋. 비-strict init은 preexisting-dirty를 WARN만.
- `--no-agent-entrypoints`·`--dry-run`·`--force`·`--dir` 동작 보존(R8).

### 5.2 `commitgate uninstall` — 읽기 전용 계획만 (Phase 3)
- **자동 삭제 없음**(PM). 기존 `bin/uninstall.ts`의 읽기 전용 planner를 Stage B에 맞게 조정:
  - 프로젝트의 MANAGED/SEED-ONCE 파일을 byte-comparison(패키지 원본과 동일/수정됨)·SEED-ONCE(항상 보존)·PROJECT-DATA(증거, 보존)로 분류 출력.
  - **런타임 제거는 `npm uninstall -D commitgate`**임을 안내(scripts/req/**는 프로젝트에 없음).
  - package.json `req:*`·`.commitgate/manifest.json`은 **수동 정리 후보로 표시만**(자동 수정/삭제 없음), `git diff`·`git revert` 안내.
- **읽기 전용 불변식 유지**: `node:fs` 조회 API만, git allowlist(`rev-parse`/`status`/`ls-files`/`log`), npm spawn 없음.
- manifest는 있으면 계획을 풍부하게, 없으면 byte-comparison 폴백(안전).

### 5.3 Stage A 감지 + `commitgate migrate` — 비파괴 (Phase 3)
- **PnP preflight(D18) + 로컬 직접 devDep·실행 동일성 검증(D14, --apply 전 fail-closed)**: 일반 Stage A 프로젝트는 commitgate 로컬 devDep 없이 vendored 스크립트만 갖는다.
  `migrate --apply`는 `req:*`를 `commitgate <verb>`로 바꾸므로, 적용 전 **§5.1-0a(PnP)·0b(직접 devDep 선언+node_modules 존재+realpath 일치)와 동일 검증**(아니면 fail-closed).
- **감지**: package.json `req:*`가 `tsx scripts/req/*.ts`(Stage A) vs `commitgate <verb>`(Stage B)인지, `scripts/req/**`·manifest 존재로 설치 모드 판정(doctor D-check 공유).
- `migrate --dry-run`(기본): 계획 출력 — package.json `req:*` 재작성은 **각 키의 현재 값이 정확히 Stage A 주입값(`tsx scripts/req/<file>.ts`, `REQ_SCRIPTS` SSOT)일 때만**
  `commitgate <verb>`로 전환(D5). **사용자 정의 값(예: `req:new="node custom.mjs"`)은 절대 덮어쓰지 않고 보존·수동 안내**.
- **비파괴(D5·PM)**: migration은 기존 `scripts/req/**`·schema·persona·증거를 **자동 삭제하지 않는다**. 정리는 **읽기 전용 uninstall planner(§5.2)** 또는 **git revert 안내**로만.
  진단용 manifest(installMode=migrated-from-vendored)를 쓸 수 있으나 삭제 권한 없음.
- `--apply`: package.json 전환 + (선택)진단 manifest 기록만. 커밋 안 함(사용자 검토 후 stage/commit). best-effort 트랜잭션(D11).

## 6. 재현성·lockfile 전략 (R7, Phase 4)

- **리뷰 입력 고정**: `req.config.json`(reviewModel/effort pin)·스키마·persona가 **프로젝트에 pin** → 패키지 버전이 올라도 과거 리뷰 입력은 git 이력으로 재현.
- **런타임 고정**: `package-lock.json`(pnpm/yarn 각 lockfile)이 `commitgate`+전이 deps(`tsx`·`ajv`·`cross-spawn`·`semver`) pin. lockfile 커밋을 문서·doctor로 권고.
- **드리프트 감지(doctor D-check)**: 설치된 commitgate 버전 vs manifest 기록 버전 불일치 → WARN(진단만, 자동 변경 없음).
- **과거 Stage A 감사 불변**: 기존 `workflow/REQ-*/` 증거는 git 커밋되어 본 변경과 무관하게 유효.

## 7. PM·워크스페이스·PnP 결정 (R6, Phase 4)

- **PM 감지**: 기존 lockfile 기반(`pnpm-lock.yaml`/`yarn.lock`/`package-lock.json`) 유지. `buildScriptInvocation`이 pm별 인자 통과.
- **npm·pnpm·yarn(node-linker)**: bin이 `node_modules/.bin/commitgate`로 해소되므로 지원.
- **workspace/monorepo**: 단일 패키지 또는 **워크스페이스 root 설치** 지원(root에 req.config.json·workflow). 하위 패키지 독립 설치는 `resolveRoot` 상향탐색이
  상위 root를 먼저 만날 수 있어 **문서화된 제한**(테스트로 동작 명시).
- **Yarn PnP(완전 미지원, PM)**: **init·migrate의 preflight(D18)에서 D14보다 먼저** PnP를 감지해 `nodeLinker: node-modules` 요구를 **fail-closed 안내**(doctor에도 WARN).
  **자동 설정 변경 금지**. 검증: "fresh PnP 프로젝트에서 init/migrate가 PnP 제한 메시지로 fail-closed" 테스트(Done #6).

## 8. 보안 불변식 보존 (R8)

- init/uninstall/migrate 모두 기존 `assertGitWorkTree`·`assertConfinedDest`(symlink 방어)·`findIgnoredArtifacts`·`classifyPreexistingDirty`·safe spawn을 **재사용**.
- **`.commitgate/` confinement(D8)**: init·migrate의 manifest 쓰기에 `assertConfinedDest` 적용(symlink 따라가지 않음). symlink 회귀 테스트.
- fail-closed: 비-옵션 미지 verb·손상 config·**PnP 환경(D18)·로컬 직접 devDep 미선언/버전 불일치(D14)**는 throw. init 옵션(`-` 시작)은 init 라우팅(D3).
- review-codex의 sandbox read-only·path confinement·프롬프트 주입 방어는 **스크립트 미변경**(runCli 래핑만) 유지.
- **자동 삭제 없음** → 파일 삭제 관련 위협 표면 자체가 제거됨(PM). migrate 스크립트 전환은 정확한 Stage A 주입값에만(D5) — 사용자 설정 미덮어씀.

## 9. Phase별 구현

[02-plan.md](02-plan.md) 참조. 요약: P1 dispatch/runCli → P2 진단 manifest + Stage B init → P3 읽기 전용 uninstall + 비파괴 migrate + 설치모드 감지 →
P4 재현성·PM/워크스페이스/PnP doctor → P5 문서·smoke.

## 10. 변경 파일(개괄)

- 신규: `scripts/req/lib/ownership.ts`(설치 자산 SSOT — `KIT_*`/`REQ_SCRIPTS` 이동, 단방향 의존으로 순환 회피), `scripts/req/lib/manifest.ts`(진단용 read/write),
  `bin/migrate.ts`, `tests/unit/{ownership,manifest,migrate,dispatch}.test.ts`.
- 수정: `bin/commitgate.mjs`(dispatch), `bin/init.ts`(Stage B 모드·D14·진단 manifest·`KIT_*`→ownership.ts), `bin/uninstall.ts`(Stage B 읽기 전용 계획),
  `scripts/req/*.ts`(runCli 진입 5개), `scripts/req/req-doctor.ts`(설치 모드·버전 드리프트·PnP D-check), `scripts/smoke.mjs`(Stage B 경로), `README.md`/`README.en.md`/CLI help.

## 11. 하위호환·안전

- 기존 Stage A 설치본: dispatch 폴백(verb 없음→init)·직접 `tsx` 실행 가드 보존으로 깨지지 않음. migration은 opt-in dry-run 우선·비파괴.
- 롤백: 각 phase는 독립 커밋(REQ 게이트). Stage B init은 파일 생성만(커밋 없음) → git으로 되돌림. best-effort 트랜잭션으로 부분 실패도 원상복구.
- 사용자 트리의 기존 staged/uncommitted 변경은 건드리지 않음(clean-tree 게이트 존중).
