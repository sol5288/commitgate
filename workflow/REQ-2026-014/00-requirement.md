# REQ-2026-014 요구사항 — Stage B 하이브리드 런타임 모델 전환 (축소 범위)

> **범위 조정(PM 결정, 설계 재검수 r16 이후)**: 로컬 manifest는 파일 생성 주체의 신뢰 가능한 증거가 될 수 없다.
> 따라서 **manifest 기반 프로젝트 파일 자동 삭제**(구 설계의 `uninstall --apply`·`createdByCommitgate`·hash 삭제 증명)를
> **이번 REQ에서 제외**한다. 자동 삭제/provenance 증명 관련 설계·검수는 중단한다.

## 1. 배경

현재 CommitGate는 **Stage A: vendored scaffold** 모델이다. `npx commitgate`(=`bin/init.ts`)가 실행 코드 `scripts/req/**`와
런타임 devDependency(`tsx`·`ajv`·`cross-spawn`)를 **대상 프로젝트에 복사·주입**한다. 업데이트·제거가 어렵고 복사본 버전이 갈라진다.

## 2. 목표(What)

실행 코드와 런타임 의존성은 대상 프로젝트에 복사하지 않고, `npm install -D commitgate`로 설치된 패키지(`node_modules/commitgate`)에서
실행한다. 사용자 경험(`npm run req:*`)은 유지하되 내부적으로 로컬 `commitgate` bin을 dispatch한다. 프로젝트 고유 거버넌스·감사 데이터는
프로젝트에 보존한다. 런타임 패키지 제거는 `npm uninstall -D commitgate`가 담당하고, `commitgate uninstall`은 **읽기 전용 제거 계획**만 제공한다.

## 3. 요구(정규화, 축소 범위)

- **R1 런타임 실행**: 새 임시 git 프로젝트에서 `npm install -D <packed tarball>` 후 초기화 시, 복사된 `scripts/req/**` 없이 모든
  `req:*` 명령이 로컬 패키지 bin(`commitgate <verb>`)을 통해 동작한다. (Done #1)
- **R2 UX 보존**: 기존 `npm run req:new -- …`/`req:next`/`req:review-codex`/`req:doctor`/`req:commit` 명령 형식·인자 전달(`--` 통과)이 유지된다. (Done #2)
- **R3 무주입**: 새 설치는 `scripts/req/**`를 복사하지 않고, 직접 devDependency(`tsx`·`ajv`·`cross-spawn`)를 대상 `package.json`에
  주입하지 않는다. 기존 프로젝트별 설정·persona·계약·티켓 증거는 계속 동작한다. (Done #3)
- **R4 읽기 전용 제거(자동 삭제 제외)**: `commitgate uninstall`은 **읽기 전용 제거 계획만** 출력한다. 프로젝트 파일 자동 삭제(`--apply`)와
  hash/manifest 기반 삭제 증명은 **범위 밖**이다. 런타임 코드는 `npm uninstall -D commitgate`로 제거된다. 프로젝트 내 schema, reviewer persona,
  `req.config.json`, AGENTS/Claude/Cursor 진입점, workflow 티켓·감사 증거는 **사용자/프로젝트 데이터로 보존**한다. (Done #4)
- **R5 비파괴 마이그레이션**: Stage A 설치본을 감지하고, migration은 **비파괴적**이다 — 기존 `scripts/req/**`·schema·persona·증거를 **자동
  삭제하지 않는다**(정리는 읽기 전용 planner 또는 git revert 안내로만). 전환 전에 **로컬 CommitGate 설치 및 실행 패키지와 대상의 버전·경로 일치를
  fail-closed로 검증**한다. `req:*` 스크립트는 **정확히 Stage A 주입값일 때만** `commitgate <verb>`로 전환하고, 사용자 정의 script는 **절대 덮어쓰지 않고
  보존·수동 안내**한다. (Done #5)
- **R6 PM/워크스페이스/PnP**: npm·pnpm·yarn을 고려한다. workspace/monorepo 결정은 테스트/명시로 검증하고, **Yarn PnP는 이번 릴리스에서
  완전 지원하지 않는다** — `nodeLinker: node-modules` 제한을 preflight/doctor/문서로 안내하되 **자동 설정 변경은 금지**한다. (Done #6)
- **R7 재현성**: 런타임 패키지 버전·기본 스키마·리뷰 동작 변경이 과거 REQ 감사 재현성을 훼손하지 않도록 버전·lockfile 전략을 설계한다. (constraints)
- **R8 보안 불변식 유지**: fail-closed, safe spawn, path confinement, gitignore·symlink 방어, `--strict`, `--no-agent-entrypoints` 동작을 약화시키지 않는다. (constraints)
- **R9 테스트·문서**: 단위 테스트·typecheck·packed-tarball smoke를 갱신해 통과시키고, Stage B 경로·비파괴 migration·읽기 전용 uninstall 회귀
  테스트를 추가한다. README(ko/en)·CLI 도움말·migration/removal 안내를 구현과 일치시킨다. (Done #7, #8)

## 4. 비목표(Non-goals)

- **프로젝트 파일 자동 삭제**(`uninstall --apply`, manifest/hash 삭제 증명, `createdByCommitgate`) — 이번 REQ에서 제외(PM 결정).
- "npm uninstall 한 번으로 모든 흔적 삭제".
- 비-git VCS 지원. 리뷰 로직(review-codex 게이트) 동작 변경. 전역 설치 요구. Yarn PnP 완전 지원.

## 5. 유지되는 이전 PM 결정

- 두 schema(`machine.schema.json`·`req.config.schema.json`)는 **프로젝트 MANAGED**로 유지.
- reviewer persona와 REQ 증거는 **프로젝트에 보존**.
- Yarn PnP는 완전 지원하지 않고 제한 안내(위 R6).

## 6. 인수 기준(설계 재검수 확인 항목)

1. fresh project `npm install -D <packed tarball>` + init + `npm run req:*` 동작.
2. 새 설치에 `scripts/req/**` 및 직접 runtime devDependency가 없음.
3. Stage A migration의 비파괴성 및 사용자 script 보존.
4. 로컬 패키지 미설치·버전 불일치 fail-closed.
5. schema/persona/REQ 증거 보존.
6. npm/pnpm/yarn 및 Yarn PnP 제한 안내.

세부는 [02-plan.md](02-plan.md) phase Exit·[01-design.md](01-design.md) 참조.
