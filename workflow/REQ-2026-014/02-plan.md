# REQ-2026-014 계획 — phase 분해 (최소 완결 범위)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **범위 조정(PM)**: [00-requirement.md](00-requirement.md) §4의 비목표(manifest·lockfile 파서·버전 완전 일치·realpath 동일성·
> 자동 재실행·failure injection·PnP 완전 지원)는 **구현하지 않는다**. 신규 모듈은 `bin/migrate.ts` **하나뿐**이다.
> 기존 preflight·보안 방어·`REQ_SCRIPTS` SSOT를 **재사용**하고 새 프레임워크를 만들지 않는다.

> **Granularity 정책**: phase 1개는 리뷰 가능한 크기(코드 변경 8파일 이하 권고). 초과 시 doctor D18 WARN.

공통 Exit(모든 phase): `typecheck 0` · `vitest run` 그린 · 해당 phase Codex 리뷰 승인.

## Phase 1 — 런타임 dispatch + runCli 진입 (`phase-1-dispatch`) — **완료·승인·커밋됨**

범위: `bin/commitgate.mjs` verb 테이블 확장(req:new/next/review-codex/doctor/commit → scripts/req/*.ts; uninstall→bin/uninstall.ts;
**`migrate` verb는 등록하지 않음**(bin/migrate.ts는 Phase 3 생성 — 깨진 명령 노출 방지); **첫 인자가 `-` 옵션이거나 없으면 init에 argv 전체 전달**;
비-옵션 미지 토큰만 throw — 설계 D3). `scripts/req/*.ts` 5개에 `runCli(argv)` + `main(argv=process.argv.slice(2))` 진입 추가(기존 `if(isMain) main()` 가드 보존).
신규 `bin/dispatch.mjs`·`bin/dispatch.d.mts`·`tests/unit/dispatch.test.ts`.

> **상태**: 구현 커밋 `95d94b8`, 증적 finalize `1d2e9e6`. `phase-1-dispatch-r01-approved.json`에서 findings 0건 승인.
> 소비 이력은 `state.json.consumed_approvals`. **이 phase는 재구현하지 않는다.**

## Phase 2 — Stage B init (`phase-2-init-runtime`)

범위: **`bin/init.ts` 단일 파일**(+ 테스트). 신규 lib 모듈 없음.

- `scripts/req/**` 복사 제거 — 대상에 실행 코드를 두지 않는다(R3).
- `REQ_DEV_DEPS`(`tsx`·`ajv`·`cross-spawn`) 주입 제거 — 대상 `package.json`을 건드리지 않는다(R3).
  `REQ_DEV_DEPS` **상수 자체는 유지**한다(`bin/uninstall.ts`가 기존 Stage A 설치본 분류에 import).
- `req:*` 주입값을 `commitgate <verb>`로 변경(`STAGE_B_REQ_SCRIPTS`). 기존 주입 규칙 `if (!(k in scripts))`를
  **그대로 재사용** → 사용자 정의 `req:*` 미덮어씀은 **기존 동작**이며 회귀 테스트로 고정한다.
- 🔴 **preflight 순서 = D19 → D14**(설계 §5.1 순서 계약, design r20 P1). Stage A 설치본에는 `devDependencies.commitgate`가
  **없으므로**(`REQ_DEV_DEPS`는 ajv·cross-spawn·tsx뿐), D14를 먼저 두면 Stage A 사용자가 **migrate 안내에 영원히 도달하지 못한다**.
  **순서 자체를 회귀 테스트로 고정**한다.
- **1) Stage A 서명 감지(D19)**: 대상 `req:*` 값 중 하나라도 정확히 `REQ_SCRIPTS` 값이거나 `scripts/req/**`가 존재하면
  **fail-closed** + 안내("이미 Stage A 설치본입니다 — `commitgate migrate`로 전환하세요"). 조용한 혼합 설치 방지(R7).
- **2) 선행 설치 확인(D14 축소)**: 대상 `package.json`에 `devDependencies.commitgate` **키가 없으면 fail-closed**
  + 안내("먼저 `npm install -D commitgate` 후 `commitgate init`"). **키 존재만 — 값 형태(semver range) 검증 금지**
  (`npm i -D <tgz>`는 `file:…tgz`를 쓴다). `--dir` 대상 기준. **lockfile 파싱·버전 대조·realpath 검증 없음**(§4 비목표).
- MANAGED/SEED-ONCE 자산(스키마 2종·persona·진입점·계약·`workflow/.gitignore`) 설치는 **현행 유지**. persona는 SEED-ONCE.
- 기존 preflight·보안 방어(`assertGitWorkTree`·`assertConfinedDest`·symlink·gitignore·dirty 분류·Preflight→Apply 2단계) **재사용**.
  **새 manifest·새 트랜잭션 프레임워크 없음**.
- `--strict`/`--dry-run`/`--force`/`--dir`/`--no-agent-entrypoints` 현재 정상 경로 보존(R10).

**테스트(설계 §9.1 blast radius 측정치 기준)** — 파일 3개, 대부분 기계적:

- `tests/unit/init.test.ts`: 픽스처 `tmpTarget` 기본 pkg에 `devDependencies.commitgate` 추가(1줄 — 없으면 D14가 `runInit` 86곳을 전부 throw시킨다).
  `pkg` 명시 override 6곳 개별 조정. 핵심 단언 flip: 무복사·무주입·`req:*`=`commitgate <verb>`.
  **fail-closed 7건 재-앵커** — `existsSync('scripts/req/req-new.ts')===false`는 Stage B에서 성공 경로에도 참이라 공허해진다.
  Stage B가 실제 쓰는 경로(`req.config.json`·스키마)로 바꿔 "무쓰기" 증명력을 되살린다.
  **신규**: `devDependencies.commitgate` 미선언 fail-closed · Stage A 감지 fail-closed · 사용자 정의 `req:*` 보존 ·
  🔴 **순서 회귀**: "Stage A 서명 ∧ commitgate 미선언" 픽스처에서 **migrate 안내로 throw**(설치 선행 안내가 **아님**) — D19가 D14보다 먼저임을 고정.
  **불변**: 보안 회귀 14건(symlink/confinement 4·zero-write snapshot 4·gitignore preflight 6)과 순수 함수 테스트는 손대지 않는다.
- `tests/unit/uninstall.test.ts`: **픽스처만** 조정. `runInit`을 설치 픽스처로 쓰면서 vendored `scripts/req/**`에 의존하는
  단언(:420-422, :584-615)은 **Stage A 픽스처를 직접 시드**하도록 바꾼다. `bin/uninstall.ts` **소스는 이 phase에서 건드리지 않는다**
  (Stage A 프로젝트 분류 기능은 계속 필요 — Phase 3에서 안내만 조정).
  > ⚠️ 이 파일을 Phase 2에 포함하는 이유: init이 vendoring을 멈추는 순간 **같이 깨진다**. Phase 3으로 미루면 Phase 2가 공통 Exit(`vitest run` 그린)를 만족할 수 없다.
- `tests/unit/req-config.test.ts`: `runInit` 2곳 — 자체 픽스처에 동일한 devDep 선언 추가.

**손대지 않는 것**: `installGuidance` 블록 29건. 2단계 `<pm> install`은 Stage B에서 **중복이지 오류가 아니다**(선행 설치로 이미 완료).
문구 정합은 Phase 5에서 판단한다.

Exit: 공통 + fresh init이 `scripts/req/**`·devDep 없이 `commitgate <verb>` 스크립트만 생성 + 선행설치/Stage A 거부 + 보안 회귀 14건 무변경 그린.

## Phase 3 — 비파괴 migrate + Stage B uninstall 안내 (`phase-3-uninstall-migrate`)

범위: 신규 `bin/migrate.ts` · `bin/commitgate.mjs`(`migrate` verb 등록) · `bin/uninstall.ts`(Stage B 안내 조정) + 테스트.

- 신규 `bin/migrate.ts`: `REQ_SCRIPTS`/`assertGitWorkTree`를 `./init`에서 **직접 import**
  (`bin/uninstall.ts`가 이미 쓰는 패턴 — init은 uninstall/migrate를 import하지 않아 순환 없음. **신규 `ownership.ts` 불필요**).
- 🔴 대상 root는 **`--dir`(기본 cwd)로만** 해소 — `resolveRoot`는 config 부재 시 **패키지 자신의 root를 반환**해
  CommitGate의 package.json을 재작성할 수 있다(설계 §5.3). init/uninstall과 같은 방식.
- **기본 dry-run**: 계획만 출력, 파일 쓰기 0건.
- `--apply`: `package.json`의 `req:*` 중 **현재 값이 정확히 `REQ_SCRIPTS` 주입값인 키만** `commitgate <verb>`로 전환.
  판정 술어는 **`bin/uninstall.ts:295-303`의 `cur === injected`를 재사용**(네 번째 비교문 금지).
  사용자 정의 값은 **보존 + 수동 조치 안내**. **package.json 한 파일의 안전한 쓰기로 끝낸다** — 광범위한 rollback 프레임워크 없음.
- `--apply` 전 `devDependencies.commitgate` **키 존재만** 확인(Phase 2와 동일 축소 규칙 — 값 형태 검증 금지). 없으면 fail-closed.
- **비파괴**: `scripts/req/**`·schema·persona·`req.config.json`·진입점·`workflow/REQ-*` 증거를 **삭제하지 않는다**.
  정리는 읽기 전용 uninstall planner 또는 git revert 안내로만.
- `bin/dispatch.mjs`의 `VERB_MODULES`에 `migrate` **1줄** 등록(파일 생성과 동시 — Phase 1에서 의도적으로 미등록).
- **migrate는 동기(sync) 구현**이어야 한다 — launcher가 `runCli`를 await하지 않는다(설계 §5.3).
- `bin/uninstall.ts`: **이미 읽기 전용**(node:fs 조회 API만 import, `--apply` 없음 — 검증됨). Stage B 기준으로
  런타임 제거 안내(`npm uninstall -D commitgate`)와 수동 정리 후보 표시만 조정. **삭제 기능을 추가하지 않는다.**
  🔴 안내는 **문자열 출력만** — npm을 **spawn하지 않는다**(기존 계약이나 현재 테스트로 고정돼 있지 않다 — 설계 §5.2).
  vendored `scripts/req/**` 분류 로직은 **유지**한다 — 기존 Stage A 프로젝트가 uninstall의 실제 대상이다.

테스트:
- 신규 `tests/unit/migrate.test.ts`: dry-run 무부작용(전후 sha256 snapshot 동일)·exact-match만 전환·사용자 정의 script 보존·
  `scripts/req/**`·schema·persona·config·진입점·증거 미삭제·`devDependencies.commitgate` 미선언 `--apply` fail-closed.
- `tests/unit/dispatch.test.ts`: **의도된 tripwire 재작성** — 현재 `'migrate' in VERB_MODULES === false`와
  `resolveDispatch(['migrate','--dry-run']) === {unknown:'migrate'}`를 단언한다. verb 등록과 함께 Stage B 기대값으로 바꾼다.
  **Phase 1 회귀가 아니라 Phase 1이 설계한 전이다.**
- `tests/unit/uninstall.test.ts`: Stage B 안내 문구 단언 조정(읽기 전용 전후 snapshot 동일 포함).

Exit: 공통 + migrate 비파괴·exact-match 전환·사용자 script 보존 + uninstall 읽기 전용(Done #4, #5).

## Phase 4 — 설치 모드 진단 + 지원 경계 (`phase-4-repro-pm`)

범위: `scripts/req/req-doctor.ts` **doctor D19** 1건(+ 테스트).

- doctor가 **script 값의 형태(shape)만으로** 설치 모드를 진단한다: Stage A / Stage B / mixed / none·custom.
  **manifest·lockfile·버전 드리프트·PnP 탐지에 의존하지 않는다.** mixed면 `commitgate migrate` 안내.
- 🔴 **level은 WARN이 상한 — FAIL 금지**(설계 D-DOC1). **CommitGate 자신의 package.json이 Stage A 형태**이고
  `req:commit`이 doctor를 exit≠0에 throw하는 하드 게이트로 spawn하므로, FAIL이면 **이 저장소의 req:commit이 영구 차단**된다.
  Stage A는 결함이 아니라 정당한 설치 형태다 → **mixed만 WARN**, 나머지는 OK.
- **`bin/init.ts`를 import하지 않는다**(설계 D-DOC2 — 레이어 역전). 순수 export 함수 `classifyInstallMode(scripts)`로 shape 판정.
- `DoctorInputs` 신규 필드는 **반드시 optional**(required면 `req-doctor.test.ts`의 `const base: DoctorInputs` 리터럴이 tsc 오류).
- package.json 읽기는 `main()`에서만 + **`stripBom` 적용**. D19 블록은 **D17 뒤 `return c` 앞에 append**.
- 예약 결번 `D1/D4/D4a/D7/D7b/D8/D12/D14`는 **재사용 금지**.
- 지원 경계는 **문서로 확정**(Phase 5 README 반영): npm packed install = 필수 지원. pnpm/yarn = node_modules linker
  표준 local bin 해소 범위. Yarn PnP·nested workspace 하위 패키지 독립 설치 = **이번 릴리스 제한**. lockfile 커밋 = 재현성 권고.
- **자동 설정 변경·자동 재실행·lockfile 파서 없음.** package manager 내부 구현 조합을 전수 탐색하지 않는다.

`tests/unit/req-doctor.test.ts`: Stage A/Stage B/mixed/none 각 정상 경로 판정 + **"절대 FAIL을 내지 않는다"** 단언
(기존 D18 granularity 블록이 같은 패턴의 템플릿). 기존 테스트는 id 집합을 열거하지 않으므로 append로 깨지지 않는다.

Exit: 공통 + 설치 모드 진단 4종 + D19가 FAIL을 내지 않음 + 제한이 문서·메시지와 일치(Done #6).

## Phase 5 — 문서·smoke (`phase-5-docs-smoke`)

범위: `README.md`/`README.en.md` · CLI help · `scripts/smoke.mjs` + smoke/통합 테스트.

- README(ko/en): Stage B 설치 순서(`npm i -D commitgate` **선행** → `commitgate init`), 무복사·무주입,
  비파괴 migration, 읽기 전용 제거(`npm uninstall -D commitgate` + 계획), 지원 경계(pnpm/yarn/PnP/workspace), lockfile 커밋 권고.
- CLI help: `init`/`uninstall`/`migrate`.
- packed-tarball smoke: **기존 `scripts/smoke.mjs`에 추가만 한다 — 새 하네스를 만들지 않는다.**
  이미 `npm pack`(L30) → 임시 git 대상 → `npm install -D <tgz>`(L47) → 실제 init(L55) → uninstall(L64)을 한다.
  추가 지점은 **L55(실제 init) 뒤, L64 앞**:
  (a) `existsSync(join(target,'scripts','req')) === false`,
  (b) 대상 `package.json`의 devDependencies/dependencies에 `tsx`·`ajv`·`cross-spawn` 키 **없음**,
  (c) 다섯 `req:*` 값이 `commitgate <verb>` 형태 — 검증 목록은 **`bin/dispatch.mjs`의 `VERB_MODULES`에서 파생**(`req:` 접두 필터)해
      하드코딩 대신 SSOT 1개 유지,
  (d) **실제 dispatch 검증** — 아래 방식으로.

  > 🔴 **(d) 정정(design r20 P1)**: 앞선 계획은 `req:doctor`를 **rc=0 성공 명령**으로 쓰려 했으나 **불가능하다** —
  > `req-doctor.ts:393`이 `throw new Error('REQ id 또는 --ticket <dir> 필요')`이고 **fresh smoke 대상에는 티켓이 없다** → exit 1 → smoke 실패.
  > 실제로 **fresh·티켓 없는 대상에서 rc=0으로 끝나는 `req:*` verb는 하나도 없다**(new=clean tree 필요, next/doctor=티켓 필요,
  > commit=승인 필요, review-codex=live Codex 필요). 그러므로 성공 종료가 아니라 **"어느 모듈에 도달했는가"** 로 dispatch를 증명한다.
  >
  > **방식**: 대상에서 **`npm run req:doctor`** 를 실행하고 **exit≠0 + `req-doctor` 자신의 사용법 오류**
  > (`REQ id 또는 --ticket <dir> 필요`)가 나오는지 단언한다. 이것이 Stage B 사슬 **전체**를 증명한다:
  > npm script(`commitgate req:doctor`) → `node_modules/.bin/commitgate` 해소 → launcher가 tsx 등록 →
  > dispatch가 **패키지 안의** `scripts/req/req-doctor.ts`로 라우팅 → 그 모듈의 `parseArgs`가 실제로 실행됨.
  > **판별력이 있다**: 미등록 verb였다면 launcher의 `알 수 없는 명령: …`(다른 메시지)가 났을 것이고,
  > bin 해소가 실패했다면 npm의 `commitgate: not found`가 났을 것이다. 세 메시지는 서로 구분된다.
  > **단언은 "doctor가 통과한다"가 아니라 "dispatch가 도달한다"임을 주석으로 명시**한다(오해 방지).
  >
  > 대안(더 무겁고 이번 범위 밖): 설치분 커밋 + git identity 설정 + `req:new --run`으로 티켓을 만들어 rc=0 doctor를 얻는 것.
  > smoke에 git 신원·커밋·브랜치 생성을 얹는 비용 대비 이득이 없다. → backlog.

  review/commit dispatch는 Phase 1 단위 테스트 + script 값 검증으로 커버.
  > 기존 단언(L56-61: `workflow/.gitignore` 존재 + check-ignore 효과)은 **Stage A 비의존이라 그대로 유효** — 재작성하지 않는다.
  > smoke의 init 대상은 **fresh**라 D19(Stage A 서명) fail-closed는 발동하지 않는다.
- **vitest에 넣지 않는다**: `vitest.config.ts`에 testTimeout 설정이 없어 기본 5000ms이고 `npm pack`+`npm install`은 초과한다.
  smoke는 이미 `npm test` 밖 + CI 별도 스텝(3×3 매트릭스)이다.
- **npm 캐시 격리**: 현재 smoke.mjs의 `npm pack`/`npm install`/`npx`는 **개발자의 실제 npm 캐시를 건드린다**.
  이 저장소의 기존 규약(REQ-2026-009)은 격리된 `npm_config_cache`를 요구한다. 이 파일을 수정하는 김에 일회용 캐시를 주입한다.
- `package.json` `files[]`는 **변경 불필요**: `bin`이 디렉터리 통째 화이트리스트라 `bin/migrate.ts`가 자동 포함되고,
  **`scripts/req`는 반드시 남겨야 한다**(패키지 자신의 bin이 그리로 dispatch한다 — Stage B가 없애는 것은 *대상으로의 복사*이지 tarball 항목이 아니다).
- Stage A fixture의 `migrate` dry-run/`--apply`와 사용자 정의 script 보존은 **별도 시드 대상**으로 증명한다(기존 fresh 대상에 겹쳐 쓰지 않는다).
- `uninstall` planner 전후 snapshot 동일(대상 tree 미변경) 확인.

Exit: 공통 + `npm run smoke` 그린, 문서-구현 일치(Done #7, #8).

## 완료
- 게이트 해당분(unit·typecheck·smoke) · 사용자 main 머지(별도 승인).

### 티켓 종료 후 후속 (phase 범위 밖)
- **SSOT 동기화**: doctor **D19** 신설로 `docs/ssot-design/`의 D-check 표·열거·용어집과 특히
  `12-traceability-matrix.md:19`의 리터럴 **`D2~D18`** 이 stale이 된다. 관련 지점:
  `07-business-rules-and-state-machines.md`(표·목록), `05-user-flows-and-ui-spec.md`, `00-document-control.md`(용어집·번호공간 충돌),
  `11-test-strategy-and-acceptance.md`, `02-repository-and-runtime.md`.
  > 이 저장소의 관례상 SSOT 반영은 **티켓 phase 안이 아니라 종료 후 별도 `docs(ssot):` 커밋**이다
  > (REQ-2026-018: finalize `696faa6` → SSOT 동기화 `8bc02de`). 같은 방식으로 처리한다.
- **stale SSOT 정정**: `docs/ssot-design/10-operations-deployment-and-observability.md`가 아직
  "`scripts/req/*.ts`에는 `runCli`이 없고"라고 기술한다 — Phase 1(`95d94b8`)이 5개 전부에 추가해 **이미 거짓**이다.
  이 문장을 믿는 리뷰어는 Phase 3 설계를 오판한다.
