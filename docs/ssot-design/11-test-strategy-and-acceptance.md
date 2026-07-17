# 11. 테스트 전략·인수 기준

## 1. 테스트 개요

- 러너: **Vitest**(`npm test` = `vitest run`). 전 테스트는 `tests/unit/**/*.test.ts`([vitest.config.ts](../../vitest.config.ts)).
- 별도 `integration/` 폴더 없음 — "통합"은 실제 `git` 서브프로세스, 임시 sandbox, 또는 `tsx`로 CLI를 스폰하는 테스트를 뜻한다.
- 핵심 목(mock): `createFakeReviewerAdapter`(라이브 codex 없이 리뷰 흐름 검증). 픽스처: 임시 repo(`mkdtempSync`/repo 내부 `.tmp/`), 헤르메틱 git(`user.email/name` 주입, `core.excludesFile`·`.git/info/exclude` 비움), sha256 스냅샷 워커(무-쓰기 단언), `spawnSync`/`tsx` e2e(60s 타임아웃).
- **npm 캐시 격리 불요**: 어떤 vitest 테스트도 npm을 호출하지 않음. 배포 산출물 위생은 디스크상 `files[]` 해석으로 검증(`package-payload.test.ts`).
- **smoke는 vitest 밖의 별도 검증**(`npm run smoke` = [scripts/smoke.mjs](../../scripts/smoke.mjs), §3): 여기서만 npm/npx/git을 실제로 호출하며, **일회용 `npm_config_cache`로 개발자의 실제 캐시와 격리**한다.

## 2. 테스트 인벤토리(17개 파일)

| 파일 | 대상 모듈 | 유형 | 핵심 커버리지 |
|---|---|---|---|
| `init.test.ts`(최대) | `bin/init.ts` | 혼합(순수+실git) | 설치 축 SSOT, **Stage B 무복사·무주입**, **D19(Stage A 서명)→D14(선행 설치) 순서 고정**, pm-중립 진입점 바이트동일, 멱등, config 병합, cross-spawn 하한, dirty 분류, gitignore 프리플라이트, `workflow/.gitignore` |
| `uninstall.test.ts` | `bin/uninstall.ts` | 통합(실git) | 스냅샷 무-쓰기, 읽기전용 git 허용목록, 쓰기 API 미포함 구조 단언, ambiguous keep, revert 안내, unknown-kit 보호, **Stage B 런타임 제거 안내**(`npm uninstall -D commitgate` 문자열 출력 — npm을 spawn하지 않음) |
| `migrate.test.ts` | `bin/migrate.ts` | 혼합(순수+실git) | `decideScripts` 4분류(convert/stage-b/custom/absent), 기본 dry-run 부작용 0건, `--apply` **바이트 정확 일치만 전환**, **비파괴**(변경=`package.json` 한 파일·삭제 0건), 멱등, `devDependencies.commitgate` 미선언 시 fail-closed, BOM 이식성 |
| `dispatch.test.ts` | `bin/dispatch.mjs` | 단위(순수) | verb→패키지 내부 모듈 라우팅(verb 토큰 소비), 옵션 선행·argv 없음 → init에 argv 전체 전달(하위호환), 비-옵션 미지 토큰 fail-closed(`unknown`) |
| `package-payload.test.ts` | 배포 페이로드 | 단위(디스크) | 금지 문자열 0회, 필수 파일 포함, NUL 바이트 텍스트 판정 |
| `pm-derived-strings.test.ts` | new/next/review 힌트 | 단위(순수) | pm별 호출형식, pm 리터럴 소스 누출 0 |
| `porcelain.test.ts` | `lib/porcelain.ts` | 혼합 | `-z` 파싱, 백슬래시 파일명 보존, rename 양열, truncated fail-closed |
| `req-adapters-cmd.test.ts` | `safeSpawnSync`(Win) | 통합(실.cmd) | `.cmd` 래퍼 주입 차단 + argv 리터럴 보존(win 전용) |
| `req-adapters.test.ts` | `lib/adapters.ts` | 단위(목) | 주입 방어, git 어댑터, codex exec/resume argv·model/effort 주입, strict 스키마(**P1 전용 축소·P1 정의 4요소·아카이브 하위호환·경로부재 throw**), fake reviewer |
| `req-args.test.ts` | 4 파서 | 단위 | POSIX `--` 흡수, 이후 옵션 파싱, 미지 옵션 throw |
| `req-commit.test.ts` | `req-commit.ts`+D9 | 단위 | manifest 빌드·검증, userConfirmGate, evidencePreflight, consume, 복구, `--message-file` |
| `req-config.test.ts` | `lib/config.ts` | 혼합 | stripBom, DEFAULTS, 스키마 fail-closed, confinement, model/effort 병합, 스키마 드리프트 가드 |
| `req-doctor.test.ts` | `req-doctor.ts` | 단위 | D2/D3/D5/D6/D9/D10/D11/D13/D15/D16/D17/D18/**D19** 입력 테이블. D19=`classifyInstallMode` 형태 판정(stage-a/stage-b/mixed/none/custom) + **mixed만 WARN·어떤 입력에도 FAIL 없음**(WARN 상한 회귀) |
| `req-new.test.ts` | `req-new.ts` | 혼합+e2e | slug/채번/브랜치/초기state, 레거시 clean-tree, `req:new --run` 스폰 e2e |
| `req-next.test.ts` | `req-next.ts` | 혼합+e2e | 결정 테이블 10분기, phases 무결성, 읽기전용 허용목록, 무-쓰기 회귀 스폰 |
| `req-review-codex.test.ts`(대형) | `review-codex.ts` | 혼합 | 프롬프트 조립 순서, 페르소나 fail-closed·심링크 가드, 바인딩, validateVerdict(1.1/R10), applyVerdict, 회로차단, stateless 연속성 |
| `scratch.test.ts` | `lib/scratch.ts` | 단위 | scratch 판정, 아카이브명, responses/ 예외 |

## 3. 기능별 인수 기준(Given/When/Then)

재구현 완료를 판정하는 대표 기준. 전부 현재 구현 근거가 있다.

### 설치(Stage B 런타임 패키지 모델)
- **Given** git repo + package.json, **When** **2단계** — `npm install -D commitgate` → `npx commitgate init`, **Then** **관리 자산만** 배치(스키마 2종·`review-persona.md`·`req.config.json`·진입점)하고 `package.json`의 `req:*` 다섯 키를 `commitgate <verb>`로 채운다. **`scripts/req/**` 실행 코드를 복사하지 않고**(무복사), **`tsx`·`ajv`·`cross-spawn`을 대상 devDeps에 주입하지 않는다**(무주입 — 이들은 `commitgate` 패키지의 runtime `dependencies`다). 커밋은 없음. 근거 `planInstall`/`STAGE_B_REQ_SCRIPTS`([bin/init.ts](../../bin/init.ts)) · `init.test.ts`.
- **Given** 기존 `req:*` 키가 이미 있음, **When** init, **Then** 덮지 않는다(`if (!(k in scripts))` — Stage A 시절부터의 기존 동작).
- **Given** `devDependencies.commitgate` 미선언, **When** init, **Then** D14 preflight fail-closed(**쓰기 0건**) + 선행 설치 안내. **키 존재만** 확인하고 값 형태는 검증하지 않는다(`npm i -D <tgz>`는 `file:…tgz`를 쓴다).
- **Given** Stage A(vendored scaffold) 설치본, **When** init, **Then** **D19(Stage A 서명 감지) → D14(선행 설치 확인)** 순서로 preflight가 돌아 `commitgate migrate` 안내로 무-쓰기 중단. **순서가 계약이다** — Stage A 설치본에는 `devDependencies.commitgate`가 없으므로 뒤집으면 Stage A 사용자가 migrate 안내에 영원히 도달하지 못한다(design r20 P1).
- **Given** 기존 `AGENTS.md`(마커 없음), **When** 설치, **Then** 기존 파일 보존 + `AGENTS.commitgate.md` 사본 배치 + WARN.
- **Given** cross-spawn < 7.0.6, **When** `--strict` 설치, **Then** 파일 쓰기 전 throw.

### 마이그레이션·제거(Stage A → Stage B)
- **Given** Stage A 설치본, **When** `commitgate migrate`(**기본 dry-run**), **Then** 전환 계획만 출력하고 부작용 0건.
- **Given** Stage A 설치본, **When** `commitgate migrate --apply`, **Then** `req:*` 중 **현재 값이 정확히 Stage A 주입값인 키만** `commitgate <verb>`로 전환. 쓰기 범위는 **`package.json` 한 파일**이고 커밋하지 않는다. 사용자 정의 값은 **덮지 않고 보존 + 수동 조치 안내**(한 글자만 달라도 사용자 값).
- **Given** Stage A 설치본, **When** `migrate --apply`, **Then** **비파괴** — `scripts/req/**`·스키마·persona·config·진입점·`workflow/REQ-*` 증거를 **삭제하지 않는다**(삭제 0건 전수 단언). 근거 `planMigrate`/`decideScripts`([bin/migrate.ts](../../bin/migrate.ts)) · `migrate.test.ts`.
- **Given** 임의 설치본, **When** `commitgate uninstall`, **Then** **read-only 안내 전용** — `node:fs` 조회 API만 쓰고 `--apply`가 없다. 런타임 제거는 **사용자가 package manager로**(`npm uninstall -D commitgate`) 하며 안내는 **문자열 출력만 — npm을 spawn하지 않는다**. 근거 [bin/uninstall.ts](../../bin/uninstall.ts) · `uninstall.test.ts`.

### Stage B 실행 검증(packed tarball smoke · [scripts/smoke.mjs](../../scripts/smoke.mjs))
로컬 소스가 아니라 **`npm pack` tarball을 임시 repo에 설치해 그 bin을 실행**한다 → 실제 배포 아티팩트(`bin` 해소·`files` whitelist·deps 설치)를 검증한다. **이 검증은 이미 실행 완료됐다**(2026-07-17 보고: typecheck 0 · 테스트 **925/925** · smoke **rc=0** · CI **9/9 success**(3 OS × Node 18/20/22)).
- **Given** packed tarball을 `npm i -D`로 설치한 fresh 대상, **When** `npx commitgate`, **Then** `scripts/req/`가 대상에 생기지 않고(무복사) `tsx`·`ajv`·`cross-spawn`이 대상 deps/devDeps에 없다(무주입). 사용자의 `devDependencies.commitgate` 선언은 보존된다.
- **Given** 같은 대상, **When** `package.json` 확인, **Then** `req:*` 다섯 값이 전부 `commitgate <verb>`다. 검증 목록은 하드코딩이 아니라 `VERB_MODULES`([bin/dispatch.mjs](../../bin/dispatch.mjs))에서 파생한다 — verb 누락 시 smoke가 잡는다.
- **Given** fresh·티켓 없는 대상, **When** `npm run req:doctor`, **Then** **exit≠0 + req-doctor 자신의 사용법 오류**(`REQ id 또는 --ticket`). 이것으로 사슬 전체(npm script → `node_modules/.bin/commitgate` 해소 → launcher의 tsx 등록 → dispatch → **패키지 안의** `req-doctor.ts` 도달 → 그 모듈의 `parseArgs` 실행)가 증명된다.
  - ⚠️ **이것은 "dispatch가 도달한다"는 증명이지 "doctor가 통과한다"는 증명이 아니다.** fresh·티켓 없는 대상에서 rc=0으로 끝나는 `req:*` verb는 **하나도 없다**(new=clean tree 필요, next/doctor=티켓 필요, commit=승인 필요, review-codex=live Codex 필요). 판별력은 메시지로 확보한다 — 미등록 verb면 launcher의 "알 수 없는 명령", bin 해소 실패면 npm의 "not found"로 서로 다르게 갈린다.
- **Given** 설치된 대상, **When** `commitgate uninstall`, **Then** rc=0 + 실행 전후 대상 tree 동일(읽기 전용).
- **Given** **별도** Stage A 시드 대상(fresh 대상에 겹쳐 쓰지 않는다 — Stage A 서명이 생기면 init의 D19가 발동해 다른 것을 검증하게 된다), **When** `migrate` → `migrate --apply`, **Then** dry-run 무부작용 + exact-match만 전환 + 사용자 값·vendored 파일 보존.

### 티켓/브랜치
- **Given** 더티 워킹트리, **When** `req:new --run`, **Then** throw(clean 요구).
- **Given** clean 트리, **When** `req:new foo --run`, **Then** `feat/req-<id>-foo` 브랜치 + 티켓 4문서 + 스캐폴드 커밋.

### 리뷰 승인 불변식
- **Given** codex 응답 `commit_approved=yes` + `findings≠[]`, **When** 검증, **Then** 무효(R10).
- **Given** `commit_approved=no` + `findings=[]`, **When** 분류, **Then** blocked(exit 2), 2회 누적 시 codex 미호출.
- **Given** 승인 후 코드 수정, **When** `req:commit`, **Then** stale throw(재리뷰).

### 차단 채널 P1 전용(REQ-2026-018 · `req-adapters.test.ts`)
- **Given** 원본 `machine.schema.json`, **When** `deriveStrictOutputSchema`, **Then** 파생 출력 스키마의 `findings[].severity.enum === ["P1"]`이고 원본 문자열은 불변(순수).
- **Given** 원본 스키마, **When** severity `description` 검사, **Then** P1 정의 4요소(카테고리 한정·정상 경로·재현 증거·배제 규칙)를 **각각** 포함. 넷 중 하나라도 빠지면 실패 — 특히 카테고리 한정·배제 규칙이 빠지면 severity inflation 경로가 열린 채 통과한다.
- **Given** 저장소의 모든 `responses/*.json` 아카이브, **When** 원본 스키마로 AJV 검증, **Then** 전부 통과하고 집합에 `P2`·`P3`가 **실제로 존재**(0건이면 하위호환을 고정하지 못하므로 이 단언이 회귀를 실효화한다).
- **Given** `findings[].severity.enum` 경로가 없거나 파손된 스키마, **When** 파생, **Then** 조용히 통과하지 않고 **throw**(fail-closed).

### 게이트
- **Given** 미추적 비-scratch 파일 존재, **When** 리뷰/doctor, **Then** D10 FAIL.
- **Given** 유효 design 승인 없음 + 허용 목록(현재 티켓 문서·scratch·현재 티켓 responses) 외 변경, **When** doctor, **Then** D13 FAIL.
- **Given** `main` 브랜치에서 phase≠DONE, **When** doctor, **Then** D11 FAIL.

### 커밋
- **Given** HIGH 티켓 + `user_commit_confirmed` 없음, **When** `req:commit --run`, **Then** userConfirmGate throw.
- **Given** 승인 + 증거 일치, **When** `req:commit --run`, **Then** 소스 커밋 + evidence-finalize 커밋 + consume.

### 보안
- **Given** shell 메타문자 인자, **When** `safeSpawnSync`, **Then** 명령 주입 미발생(부작용 파일 없음).
- **Given** 심볼릭링크로 루트 밖을 가리키는 페르소나, **When** 로드, **Then** fail-closed throw.

### 읽기 전용성
- **Given** `req:next` 실행, **When** 임의 상태, **Then** `.git/index`·objects·state.json 바이트 불변(무-쓰기 회귀).

### 수명주기 의미
- **Given** 신규 티켓, **When** design 승인→phase 승인→승인 소비까지 진행, **Then** 논리 진행은 `design_approved`·`commit_allowed`·`consumed_approvals`에서 파생되고 `state.phase` 자동 전이를 전제로 하지 않는다.
- **Given** 모든 `phases[]`가 소비되고 트리가 clean, **When** `req:next`, **Then** `DONE`을 반환하되 state 파일을 쓰지 않는다.

## 4. 알려진 미검증 영역
- 라이브 Codex 왕복(실제 모델 판정)은 CI 미검증 — `verify:overrides`(수동)로만 override 실효성 확인.
- codex usage limit·타임아웃 실패 경로의 진단 정확성 — 미구현 항목과 연동([09-security-and-reliability.md](09-security-and-reliability.md) §4, [gaps-and-decisions.md](gaps-and-decisions.md)).
- 비-git VCS — 현재 범위 밖.
- **Yarn PnP·nested workspace·lockfile/manifest 파서·자산 업그레이드/3-way merge — Stage B 범위가 아니다.** smoke는 npm + 단일 패키지 대상만 실행한다. 지원한다고 읽지 말 것.
- **자산↔런타임 버전 skew를 자동 감지할 수단이 없다.** `node_modules` realpath 검증은 제거됐고, 애초에 그 검증도 package upgrade 뒤의 자산 skew를 해결하지 못했다. D19는 `req:*` **값의 형태만** 보며 lockfile·`node_modules`·버전 skew를 **검증하지 않는다**.
- **smoke의 읽기 전용/무부작용 단언은 파일 크기만 비교한다**([scripts/smoke.mjs](../../scripts/smoke.mjs) `snapshot`) → 동일 크기 내용 변경을 놓칠 수 있다. (`migrate.test.ts`·`uninstall.test.ts`의 vitest 스냅샷은 sha256이다 — 이 한계는 smoke 한정.)
- fresh clone에서 scratch `state.json`을 승인 아카이브·manifest·git으로 재구축하는 경로 — 기능 자체가 없음(G-09).
- 직접 `git commit`으로 로컬 게이트를 우회한 커밋을 CI에서 증거 검증하는 경로 — 기능 자체가 없음(G-05/STR-01).
- 자산 3-way upgrade·rollback — 설치 manifest가 없어 기능 자체가 없음(G-10. 위 skew 항목과 같은 gap의 다른 축이다 — 하나는 *감지*, 이것은 *갱신*).
- ⚠️ Stage B 변경 자체는 `main`에 bypass direct push된 뒤 CI가 실행됐다. §3의 **CI 9/9 success는 사실이지만 이 사례에서 병합을 사전에 막은 게이트가 아니라 post-check였다**([04](04-user-roles-and-permissions.md) B1).
- NEEDS_FIX 절대 라운드 상한·escalation·delta design review — 미구현(G-06a/b).
- 사용자 가치 지표(VCCR, 리뷰 P50/P95, 온보딩 시간) — 집계 기능 없음(G-11).

## 5. 재구현 시 필요한 테스트 데이터/목
- **fake reviewer**: 승인/needs-fix/blocked/invalid 응답을 canned payload로 주입하는 더블(라이브 codex 불요).
- **헤르메틱 git repo**: 임시 디렉터리 + 빈 excludes로 전역 gitignore 영향 제거.
- **recorder 픽스처**(Windows): `.cmd` 래퍼 + `.cjs` recorder(`"type":"module"`이라 `.cjs` 필수)로 argv/부작용 관찰.
