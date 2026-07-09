# REQ-2026-007 설계 — `commitgate uninstall` 읽기 전용 removal planner

> 정본 결정은 00-requirement의 "제품 방향". 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

- [bin/commitgate.mjs](../../bin/commitgate.mjs): tsx 등록 후 `init.ts`를 import해 `runCli(process.argv.slice(2))` 호출. **verb 개념 없음**.
- [bin/init.ts](../../bin/init.ts):
  - `PACKAGE_ROOT`, `REQ_SCRIPTS`, `REQ_DEV_DEPS`, `assertGitWorkTree` — 전부 **모듈 로컬**(미export).
  - `parseArgs`는 `--dir/--force/--dry-run/--strict/-h` 외 인자를 `알 수 없는 인자`로 throw.
  - `runInit`이 계산하는 `copied/skipped/configAction/configKeysAdded/packageJsonAdded/agentsCreated`는 `main()`에서 **console.log만** 되고 디스크에 남지 않는다 → **원장 부재**.
- [scripts/req/lib/config.ts](../../scripts/req/lib/config.ts) `loadConfig`: `ticketRoot`·`schemaPath`를 config에서 해소(기본 `workflow`, `workflow/machine.schema.json`).
- [scripts/req/lib/adapters.ts](../../scripts/req/lib/adapters.ts) `createGitAdapter(root, runner?)`: `GitRunner` 주입 가능 → 테스트에서 git 호출 감시 가능.
- [scripts/smoke.mjs](../../scripts/smoke.mjs): pack tarball 설치 후 `npx --no-install commitgate --dry-run` rc=0 검증.

## 핵심 설계 결정

### D1. planner는 구조적으로 읽기 전용이다
- `bin/uninstall.ts`는 `node:fs`에서 **`existsSync`·`readFileSync`만** import한다. `writeFileSync`/`rmSync`/`unlinkSync`/`mkdirSync`/`copyFileSync`/`renameSync`/`appendFileSync`를 import하지 않는다.
- git은 **read-only 서브커맨드 allowlist**(`rev-parse`, `status`, `ls-files`, `log`)만 호출한다. `restore`/`clean`/`revert`/`checkout`/`reset`/`add`/`commit`/`rm`은 호출하지 않는다.
- 해시는 `node:crypto`의 `createHash('sha256')`로 계산한다. `git hash-object`(`-w`가 objects/를 쓸 수 있음)를 쓰지 않는다.
- npm을 spawn하지 않는다. 캐시 경로 조회 명령은 **문자열로 출력만** 한다.
- 최악의 실패 모드가 "잘못된 안내"에 그치고 "오삭제"가 될 수 없게 하는 것이 이 결정의 목적이다.

### D2. verb dispatch는 `bin/commitgate.mjs`에서 (순환 import 회피)
```
argv[0] === 'uninstall'  → import('./uninstall.ts').runCli(argv.slice(1))
그 외                     → import('./init.ts').runCli(argv)          // 현행 그대로
```
- `uninstall.ts` → `init.ts` **단방향** import(상수·`assertGitWorkTree` 재사용). init.ts는 uninstall.ts를 모른다.
- `bin/init.ts`는 `PACKAGE_ROOT`/`REQ_SCRIPTS`/`REQ_DEV_DEPS`/`assertGitWorkTree`에 `export`만 추가(동작 불변)하고, `printHelp`에 `uninstall` 1줄을 더한다.
- 하위호환: 인자 없는 `npx commitgate` 및 기존 모든 플래그는 불변.

### D3. 원장이 없으므로 "CommitGate가 만들었다"고 단정하지 않는다
각 아티팩트를 3분류하고, **분류가 곧 안전 정책**이다.

| 분류 | 대상 | 정책 |
|---|---|---|
| `tool` | `scripts/req/**` 6개, `<schemaPath>`·`<ticketRoot>/req.config.schema.json` 2개 | 현재 실행 중인 패키지의 원본 바이트와 sha256 비교 → `identical` \| `differs`. `differs`는 "편집됐거나 **다른 버전**이 설치함"이라고만 표기(사용자 소유라 단정하지 않음). |
| `ambiguous` | `AGENTS.md`, `req.config.json`, `package.json`의 `req:*` 4키 + `ajv`/`cross-spawn`/`tsx` | **항상 자동 제거 대상에서 제외.** init에 기존 값 보존 경로(AGENTS.md skip · config merge · key-not-overwritten)가 있어 origin 판별 불가. 참고용으로 "init 기본값과 동일/다름"만 표기. |
| `evidence` | 설정된 `ticketRoot` 하위 `REQ-*` 디렉터리 | 제거 계획에서 제외. "감사 증거 — 삭제하지 말 것" 경고. |

- `ticketRoot`·`schemaPath`는 **`loadConfig`로 읽는다**. 하드코딩 `workflow/`를 가정하면 `ticketRoot=docs/req-tickets`인 repo에서 빈 `workflow/`만 지켜주고 진짜 증거를 놓치는 *가짜 안전*이 된다.
- `req.config.json` 파싱 실패 등으로 `loadConfig`가 throw하면 planner는 fail-closed로 중단하지 않고 **DEFAULTS로 강등하되 그 사실을 출력에 명시**한다(제거하려는 사용자가 깨진 config 때문에 안내를 못 받는 건 부당). 이 강등은 planner에서만 허용한다(쓰기가 없으므로 안전).

### D4. git 상태에 따라 안내를 분기한다
- 후보 경로별로 tracked 여부(`git ls-files -- <p>`)와 dirty 여부(`git status --porcelain -- <p>`)를 읽는다.
- **미커밋**(kit 경로가 전부 untracked): `git status`/`git diff`로 확인 후 사용자가 직접 되돌리도록 안내. planner는 명령을 **출력만** 한다.
- **커밋됨**(tracked 존재): `git log --diff-filter=A --format=%H|%s -1 -- <kit anchor>`로 스캐폴딩 **도입 커밋 후보**를 찾아 `git revert <sha>` 방향을 제시한다. 도입 커밋이 여러 개로 흩어졌으면 그 사실을 명시하고 단일 revert를 권하지 않는다.
- `package.json` 안내는 반드시 **`git checkout HEAD -- package.json`** 형태로만 출력하고(인덱스 기준인 `git checkout -- package.json`은 `git add` 이후 주입 스크립트를 남긴다), **다른 미커밋 편집도 함께 버려진다**는 경고를 붙인다.
- 빈 디렉터리 경고: git은 빈 디렉터리를 추적하지 않으므로 kit 파일 제거 후에도 `scripts/`·`<ticketRoot>/`가 남을 수 있음을 명시.

### D5. npx 캐시는 repo 스캐폴딩과 분리된 섹션
- `npm ls -g commitgate`로 전역 설치 여부를 **사용자가** 확인하도록 안내(planner는 실행하지 않음).
- OS별 `_npx` 제거 명령을 문자열로 출력.
- ⚠️ **`npm cache clean --force`는 `_npx`를 지우지 않으며 CommitGate 제거 명령이 아니다** — 경고를 출력에 포함.

### D6. CLI 표면은 최소
```
commitgate uninstall [--dir <repo>] [-h|--help]
```
- 항상 계획만 출력하고 **exit 0**(정보 명령). 전제 미충족(비-git repo, repo 최상위 아님)은 `assertGitWorkTree`가 throw → `runCli` 경계에서 exit 1.
- `--json`/`--force`/`--run` 등은 비목표(YAGNI). 삭제 플래그를 두지 않는 것이 D1의 계약이다.

### D7. 순수 코어 / IO 경계 분리(테스트 가능성)
- `collectFacts(root, cfg, git)` — 파일 존재·바이트 해시·git 상태를 읽어 `UninstallFacts` 반환(IO는 여기만, 읽기 전용).
- `buildPlan(facts): UninstallPlan` — **순수**. 분류·안내 분기 결정.
- `renderPlan(plan): string` — **순수**. 출력 텍스트.
- `runUninstall(opts)` — 위 3개를 엮고 `console.log`.

## Phase별 구현

- **phase-1-planner-core**: planner 구현 + verb dispatch + 테스트 + smoke. Test-First(Red→Green).
- **phase-2-docs**: README 2종 제거 섹션.

## 변경 파일

phase-1: [bin/uninstall.ts](../../bin/uninstall.ts)(신규) · [bin/commitgate.mjs](../../bin/commitgate.mjs) · [bin/init.ts](../../bin/init.ts) · [tests/unit/uninstall.test.ts](../../tests/unit/uninstall.test.ts)(신규) · [scripts/smoke.mjs](../../scripts/smoke.mjs)
phase-2: [README.md](../../README.md) · [README.en.md](../../README.en.md)

## 하위호환·안전

- init 경로 불변: 인자 없는 `npx commitgate`, `--dir/--force/--dry-run/--strict/-h` 모두 현행 동작. `bin/init.ts` 변경은 `export` 추가 + help 1줄뿐.
- planner는 쓰기가 없으므로 최악의 경우도 잘못된 안내에 그친다. 그래서 `ambiguous`/`evidence` 분류를 출력에 명시해 사용자가 스스로 판단하게 한다.
- `package.json` `files`의 `"bin"`은 디렉터리 엔트리라 `bin/uninstall.ts`가 자동으로 배포에 포함된다(변경 불필요). smoke가 이를 검증한다.
- 검증 시 실제 사용자 npm 캐시를 만지지 않는다. 캐시 관련 확인이 필요하면 격리된 `npm_config_cache`만 사용한다.
