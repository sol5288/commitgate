# REQ-2026-014 요구사항 — Stage B 런타임 패키지 전환 (최소 완결 범위)

> **범위 조정(PM 결정, 설계 재검수 r30 이후)**: 이 티켓의 설계 리뷰는 r19에서 **findings 0건으로 승인**된 뒤,
> r20~r30에서 **21건의 지적이 모두 P2(P1 0건)** 인 채로 비수렴했다. 원인은 결함이 아니라 **범위 확장**이다.
> 따라서 이번 REQ는 **Stage A → Stage B 전환을 증명하는 최소 완결 경로**로 축소한다. 아래 §4의 비목표는
> 이번 범위에서 **구현하지 않으며**, 그 부재를 근거로 한 차단은 성립하지 않는다(§7 후속 backlog로 이관).

## 1. 배경

현재 CommitGate는 **Stage A: vendored scaffold** 모델이다. `npx commitgate`(=`bin/init.ts`)가 실행 코드 `scripts/req/**`와
런타임 devDependency(`tsx`·`ajv`·`cross-spawn`)를 **대상 프로젝트에 복사·주입**한다. 업데이트·제거가 어렵고 복사본 버전이 갈라진다.

## 2. 목표(What)

실행 코드와 런타임 의존성은 대상 프로젝트에 복사하지 않고, `npm install -D commitgate`로 설치된 패키지(`node_modules/commitgate`)에서
실행한다. 사용자 경험(`npm run req:*`)은 유지하되 내부적으로 로컬 `commitgate` bin을 dispatch한다. 프로젝트 고유 거버넌스·감사 데이터는
프로젝트에 보존한다. 런타임 패키지 제거는 `npm uninstall -D commitgate`가 담당하고, `commitgate uninstall`은 **읽기 전용 제거 계획**만 제공한다.

## 3. 요구(정규화, 축소 범위)

- **R1 런타임 실행**: 새 임시 git 프로젝트에서 `npm install -D <packed tarball>` 후 `commitgate init` 시, 복사된 `scripts/req/**` 없이 모든
  `req:*` 명령이 로컬 패키지 bin(`commitgate <verb>`)을 통해 동작한다. (Done #1)
- **R2 UX 보존**: 기존 `npm run req:new -- …`/`req:next`/`req:review-codex`/`req:doctor`/`req:commit` 명령 형식·인자 전달(`--` 통과)이 유지된다. (Done #2)
- **R3 무복사·무주입**: 새 설치는 `scripts/req/**`를 복사하지 않고, devDependency `tsx`·`ajv`·`cross-spawn`을 대상 `package.json`에
  주입하지 않는다. 이들은 `commitgate` 패키지의 runtime dependency로만 존재한다. 기존 프로젝트별 설정·persona·계약·티켓 증거는 계속 동작한다. (Done #3)
- **R4 읽기 전용 제거**: `commitgate uninstall`은 **읽기 전용 계획만** 출력한다. 아무것도 쓰거나 삭제하지 않는다. 런타임 코드는
  `npm uninstall -D commitgate`로 제거된다. 프로젝트 내 schema, reviewer persona, `req.config.json`, AGENTS/Claude/Cursor 진입점,
  workflow 티켓·감사 증거는 **사용자/프로젝트 데이터로 보존**한다. (Done #4)
- **R5 비파괴 마이그레이션**: `commitgate migrate`는 Stage A 설치본을 **비파괴적으로** 전환한다 — 기존 `scripts/req/**`·schema·persona·증거를
  **자동 삭제하지 않는다**(정리는 읽기 전용 planner 또는 git revert 안내로만). 기본은 dry-run이다. `req:*` 스크립트는 **현재 값이 정확히
  Stage A 주입값(`REQ_SCRIPTS` SSOT)일 때만** `commitgate <verb>`로 전환하고, 사용자 정의 script는 **절대 덮어쓰지 않고 보존·수동 안내**한다. (Done #5)
- **R6 선행 설치 확인**: Stage B는 `req:* = commitgate <verb>`를 심으므로 대상에 commitgate가 설치돼 있어야 한다. init과 `migrate --apply`는
  대상 `package.json`에 **`devDependencies.commitgate` 키가 있는지만** 확인하고, 없으면 설치 선행 안내와 함께 **fail-closed**로 중단한다.
  **값의 형태는 검증하지 않는다** — `npm i -D <tarball>`은 `file:…tgz`를 쓰므로 semver range 검증은 정당한 설치를 거부한다.
  lockfile 포맷 파싱·해결 버전 대조·설치 버전 완전 일치 검증은 **하지 않는다**(§4). (Done #6)
- **R7 혼합 설치 방지**: plain init이 Stage A 프로젝트에서 조용히 혼합 설치를 만들지 않는다. Stage A 서명을 감지하면 `commitgate migrate`
  안내와 함께 **fail-closed**로 중단한다. `req:doctor`는 **script 형태를 기준으로** Stage A/Stage B/mixed 설치 모드를 진단한다(FAIL 아님 — §6-4).
  🔴 **R7의 감지는 R6의 선행 설치 확인보다 먼저 수행되어야 한다.** Stage A 설치본에는 `devDependencies.commitgate`가 없으므로,
  순서가 뒤바뀌면 Stage A 사용자는 R6의 설치 안내만 받고 **migrate 안내에 도달하지 못한다**(정상 경로에서 R7 미달성). (Done #6)
- **R8 지원 경계**: npm packed install은 필수 end-to-end 지원이다. pnpm·yarn은 **node_modules linker에서 표준 local bin 해소를 쓰는 범위**로 지원한다.
  Yarn PnP와 nested workspace 하위 패키지 독립 설치는 **이번 릴리스의 문서화된 제한**이며, 자동 설정 변경·자동 재실행은 하지 않는다. (Done #6)
- **R9 재현성**: `req.config.json`(reviewModel/effort pin)·스키마·persona가 프로젝트에 pin되어 과거 리뷰 입력이 git 이력으로 재현된다.
  런타임 버전 고정은 **lockfile 커밋 권고**로 문서화한다. lockfile 내부 파서는 만들지 않는다. (constraints)
- **R10 보안 불변식 유지**: fail-closed, `safeSpawnSync`·shell 비사용, path confinement, gitignore·symlink 방어, `--strict`,
  `--dry-run`, `--force`, `--dir`, `--no-agent-entrypoints`의 현재 정상 경로를 약화시키지 않는다. (constraints)
- **R11 테스트·문서**: 단위 테스트·typecheck·packed-tarball smoke를 갱신해 통과시키고, Stage B 경로·비파괴 migration·읽기 전용 uninstall
  회귀 테스트를 추가한다. README(ko/en)·CLI 도움말·migration/removal 안내를 구현과 일치시킨다. (Done #7, #8)

## 4. 비목표(Non-goals) — 이번 범위에서 구현하지 않음

아래는 **Stage B 전환을 증명하는 데 필수적이지 않고**, r20~r30 비수렴의 직접 원인이다. 이번 REQ에서 구현하지 않으며,
그 부재는 결함이 아니라 **명시된 경계**다. 관찰 가치가 있는 것은 §7에 한 줄로 남긴다.

- `.commitgate/manifest.json` 신규 도입과 manifest schema, `createdByCommitgate`, 파일 hash, provenance, 설치 저장소 결속.
- manifest/hash를 근거로 한 삭제, `uninstall --apply`, "npm uninstall 한 번으로 모든 흔적 삭제".
- npm lockfile v1/v2/v3·pnpm·yarn 각각의 **내부 포맷 파서**, 선언 range/lockfile 해결 버전/설치 버전의 **완전 일치 게이트**,
  여러 lockfile 공존 시 정본 선출 알고리즘.
- 실행 패키지와 대상 `node_modules/commitgate`의 **realpath 동일성 검증**, 다른 cwd의 `--dir` 대상을 위한 **대상 로컬 bin 자동 재실행**.
- 모든 파일 쓰기 지점에 대한 **인위적 failure injection**과 다중 파일 완전 원자성 프레임워크.
- 언어 정책(R10 계열)과 관련 템플릿·persona 확장.
- **Yarn PnP 완전 지원**, nested workspace의 모든 배치 형태 지원.
- 비-git VCS, 자동 publish, 자동 upgrade/migration registry.
- 리뷰 로직(`review-codex` 게이트·`classifyReview`) 동작 변경, Stage B와 무관한 reviewer/provider 구조 변경. 전역 설치 요구.

## 5. 유지되는 이전 PM 결정

- 두 schema(`machine.schema.json`·`req.config.schema.json`)는 **프로젝트 MANAGED**로 유지.
- reviewer persona는 **SEED-ONCE**(부재 시에만 생성, `--force`도 덮지 않음), REQ 증거는 **프로젝트에 보존**.
- Stage A 프로젝트의 자동 삭제 금지, `uninstall` 읽기 전용 원칙.

## 6. 인수 기준

1. fresh project `npm install -D <packed tarball>` + `commitgate init` + `npm run req:*` 동작. (R1/R2)
2. 새 설치에 `scripts/req/**` 없음, 대상 `package.json`에 `tsx`·`ajv`·`cross-spawn` 직접 주입 없음,
   다섯 `req:*` 값이 `commitgate <verb>`. (R3)
3. `devDependencies.commitgate` 미선언 시 init·`migrate --apply` fail-closed + 설치 선행 안내. 값 형태는 검증하지 않음
   (`file:…tgz` 설치도 통과). (R6)
4. Stage A 서명 감지 시 plain init fail-closed + migrate 안내. **Stage A 서명 ∧ commitgate 미선언인 프로젝트에서
   `migrate` 안내가 나온다**(설치 선행 안내가 아니라 — 순서 회귀). doctor가 Stage A/Stage B/mixed를 script 형태로 진단하며
   **FAIL을 내지 않는다**. (R7)
5. `migrate` 기본 dry-run 무부작용, `--apply`는 정확한 Stage A 값만 전환, 사용자 정의 script 보존,
   `scripts/req/**`·schema·persona·config·진입점·증거 미삭제. (R5)
6. `uninstall`이 대상 tree를 변경하지 않음(전후 snapshot 동일). (R4)
7. schema/persona/config/진입점/REQ 증거 보존. (R4/R5)
8. 기존 path/symlink/safe-spawn/gitignore/`--strict`/`--dry-run`/`--force`/`--dir`/`--no-agent-entrypoints` 회귀 통과. (R10)
9. README(ko/en)·CLI help가 구현과 일치. packed-tarball smoke·unit test·typecheck 통과. (R11)

## 7. 후속 backlog (이번 범위 밖 — 관찰 기록)

- 설치 provenance/manifest 기반 진단과 자동 정리(신뢰 가능한 증거 모델을 먼저 정의해야 함).
- lockfile 해결 버전 대조·실행 패키지 realpath 동일성 검증·`--dir` 대상 로컬 bin 재실행.
- Yarn PnP preflight fail-closed / doctor WARN, nested workspace 하위 패키지 독립 설치.
- 다중 파일 쓰기 원자성 확장과 failure injection 테스트 하네스.
- Stage B에서 대상 `cross-spawn` 하한 진단(`crossSpawnBelowFloor`)의 의미 재검토 — Stage B는 대상의 cross-spawn을 쓰지 않는다.
- 언어 정책(R10) 및 템플릿·persona 확장.

세부는 [02-plan.md](02-plan.md) phase Exit·[01-design.md](01-design.md) 참조.
