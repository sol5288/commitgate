# REQ-2026-038 요구사항

vendored 자산 skew 감지·복구(`commitgate sync` + doctor D20 WARN) 및 0.x 업그레이드 경로 문서화

## 무엇을

소비 프로젝트가 CommitGate 런타임을 minor 넘어 업그레이드할 때(예: 0.7.0 → 0.8.1) 발생하는 **두 함정**을
도구 차원에서 닫는다.

1. **자산 skew 복구** — 신규 verb `commitgate sync`가 소비 repo의 vendored **스키마 축 계약**
   (`workflow/machine.schema.json`, `workflow/req.config.schema.json`)을 **설치된 패키지가 배포한 사본**으로
   재동기화한다. 페르소나는 opt-in(`--persona`)이며 사용자 수정본을 절대 덮지 않는다.
2. **skew 상시 감지** — `req:doctor`에 신규 검사 **D20**을 추가해, 런타임이 실제로 읽는 vendored
   `machine.schema.json`과 설치 패키지가 배포한 사본을 **content-hash**로 비교하고 불일치 시 **WARN**한다(FAIL 아님).
3. **업그레이드 경로 문서화** — README의 거짓 주장을 교정하고 0.x 캐럿 업그레이드 절차를 신설한다.

## 왜

두 함정은 "업데이트가 깨진다"는 한 증상 아래 있는 **서로 독립적인** 결함이다.

- **Trap 1 (캐럿 범위, 문서가 반대로 주장).** `npm install -D commitgate`는 0.x 캐럿을 쓴다. npm semver에서
  `^0.7.0` = `>=0.7.0 <0.8.0`이라 `npm/pnpm update`가 0.x minor를 넘지 못한다. 이 범위는 **소비자
  package.json**에 있고 패키지 매니저가 *갱신된 commitgate 코드가 존재하기도 전에* 강제하므로 **코드로 자가
  치유 불가** — 문서가 유일한 레버다. 그런데 README는 정반대를 두 번 단언한다:
  [README.md:40](../../README.md)("업데이트는 `npm update commitgate` 한 번"),
  [README.md:228](../../README.md)("복사본 버전이 갈라지지 않습니다" — vendored 자산에 대해 명백히 거짓).

- **Trap 2 (자산 skew).** 런타임은 게이트에 결정적인 두 계약을 **소비 repo의 vendored 사본에서만** 읽는다.
  node_modules의 최신 사본은 무시한다:
  - 스키마: [config.ts:288](../../scripts/req/lib/config.ts) `schemaPathAbs = resolve(rootAbs, 'workflow/machine.schema.json')`,
    `rootAbs`는 [config.ts:198-208](../../scripts/req/lib/config.ts) 상향 탐색으로 찾은 **소비자 루트**. 이 경로가
    codex `--output-schema`([adapters.ts:184-185](../../scripts/req/lib/adapters.ts))**와** 응답 검증
    ([review-codex.ts:1937](../../scripts/req/review-codex.ts)·[:1969](../../scripts/req/review-codex.ts)) **양쪽**을 결정한다.
  - 페르소나: [review-codex.ts:1802](../../scripts/req/review-codex.ts) `loadReviewPersona(cfg.reviewPersonaPathAbs, ...)`.

  `pnpm update`는 node_modules만 바꾸므로 vendored 계약은 stale로 남는다. 패키지의 올바른 사본
  ([review-codex.ts:1207](../../scripts/req/review-codex.ts) `MACHINE_SCHEMA_PATH`)은 `??` fallback일 뿐 프로덕션 경로가 안 닿는다.

- **검증된 실제 피해 (가설 아님).** `machine_schema_version`은 0.7.0과 0.8.1 **모두 `"1.1"`**이다(0.8.x는
  버전을 올리지 않고 `full_review_requested`를 *선택* 필드로 추가). 따라서 0.8.1 런타임 + 0.7.0 vendored 스키마:
  1. 버전 불일치 오류가 안 난다 → `full_review_requested`가 조용히 사라진다.
  2. strict output-schema가 stale 스키마에서 파생([adapters.ts:159-166](../../scripts/req/lib/adapters.ts)) +
     root `additionalProperties:false`([machine.schema.json:3](../../workflow/machine.schema.json)) → codex가 그 필드를
     **낼 수 없다** → design delta 리뷰의 full-review 에스컬레이션([review-codex.ts:1364](../../scripts/req/review-codex.ts)
     `delete nextState.design_baseline`)이 **영원히 발화하지 않는다**. 오류 없이 기능만 조용히 죽는다.
  3. stale 페르소나(4986B→7404B)는 배칭 지침이 없어 리뷰 라운드가 폭증한다.
  > ⚠️ 버전 문자열이 동일했으므로 **버전 비교식 검사는 이 사례를 놓친다. content-hash 비교만 잡는다.** → D20은 반드시 content-hash.

- **구조적 원인.** shipped vs vendored를 sha256 비교하는 코드는 [init.ts:710-731](../../bin/init.ts) 한 곳뿐인데
  owned/user skip 분류에만 쓰고 경고·게이트가 없으며 **업그레이드 시 실행되지 않는다**(`pnpm update`는 init을 안 부른다).
  런타임은 자기 패키지 버전을 읽지 않고 `--version` verb도 없다([dispatch.mjs:15-24](../../bin/dispatch.mjs)).
  [req-doctor.ts](../../scripts/req/req-doctor.ts) 13개 검사 중 자산 드리프트를 보는 것은 0개다.

- **이미 알려진 갭.** 이 문제는 SSOT에 **G-10**(`docs/ssot-design/gaps-and-decisions.md:64-72`)과 로드맵 P1
  **STR-06**(`docs/ssot-design/14-product-strategy-and-roadmap.md:107`)으로 등록돼 있다. 이 REQ는 그 갭을
  MVP 범위(content-oracle)로 **부분 해결**하고, 커밋 원장 기반 완전판(install manifest·persona 3-way·rollback)은
  STR-06 후속으로 남긴다. `commitgate migrate`는 [migrate.ts:15](../../bin/migrate.ts) package.json의 `req:*`만
  바꾸고 자산은 안 건드리므로 재사용 불가. node_modules realpath 검증은 문서화된 dead-end(`02-repository-and-runtime.md:154`).

## 제약

- **무회귀.** 기존 `req:*` 동작·리뷰/커밋 hot path 불변. doctor에는 additive WARN(D20)만 추가. 기존 REQ 증거
  아카이브(예: REQ-028)가 계속 검증 통과해야 한다.
- **Stage B 모델 준수.** sync는 devDependency를 주입하지 않는다(REQ-2026-014 R3 정신). 캐럿 범위를 자동 편집/설치하지 않는다.
- **confinement 단일 경로.** sync의 모든 쓰기는 [init.ts](../../bin/init.ts)의 `statWritableDest`/`assertConfinedDest`를
  **재사용**한다. 두 번째 confinement 구현 금지 — [init.ts:433](../../bin/init.ts)이 과거 symlink-escape 결함(REQ-2026-024)의 원인이라 명시.
- **fallback foot-gun 차단.** sync는 `--dir`(기본 cwd)로 대상 루트를 해소하고, `cfg.root === packageRoot()`이면 어떤
  쓰기 전에도 하드 거부한다([config.ts:207](../../scripts/req/lib/config.ts) fallback, [migrate.ts:21-23](../../bin/migrate.ts) 선례).
- **동기 runCli.** `bin/sync.ts`의 `runCli`는 **동기**여야 한다 — launcher가 `mod.runCli`를 await 없이 호출한다
  ([commitgate.mjs:38](../../bin/commitgate.mjs), [migrate.ts:18-19](../../bin/migrate.ts)). async면 exit code가 소실된다.
- **verb 등록 원자성.** `dispatch.mjs`의 `sync` 등록은 `bin/sync.ts`를 추가하는 **동일 phase**에서 한다
  ([dispatch.mjs:10-11](../../bin/dispatch.mjs): 없는 모듈 등록은 raw unhandled rejection).
- **세 축 구분 유지.** copy 축(`KIT_COPY_RELPATHS`) / schema 축(`KIT_SCHEMA_RELPATHS`) / tarball 축(package.json `files[]`).
- **협조적 단일 워크트리 모델.** sync는 init처럼 협조적 단일 워크트리를 전제하고 TOCTOU 원자성을 주장하지 않는다.

## 완료 기준 (R)

- **R1 — 문서(코드 없음).** [README.md:40](../../README.md)·[:228](../../README.md)의 거짓/오도 주장을 교정하고,
  "업그레이드(0.x)" 절을 신설한다: ① 0.x 캐럿이 minor를 막음 → `npm install -D commitgate@latest`(또는 범위 확대);
  ② 이어서 `commitgate sync`로 vendored 계약 재동기화; ③ Stage A면 `commitgate migrate`. `README.en.md` 미러.
  `CHANGELOG.md` 항목 추가. `gaps-and-decisions.md`(G-10)·`14-product-strategy-and-roadmap.md`(STR-06) 부분 해결 표기.
- **R2 — `commitgate sync` verb.** 신규 `bin/sync.ts`가 동기 `runCli(argv)`를 export한다. 기본 = plan/dry-run(쓰기 0건),
  `--apply`에서만 쓴다. `--dir <root>`(기본 cwd), `--persona`(페르소나 opt-in) 지원. `dispatch.mjs` VERB_MODULES에 등록.
- **R3 — 스키마 축만, 멱등.** `--apply` 시 `KIT_SCHEMA_RELPATHS`(machine.schema.json·req.config.schema.json)를
  `packageRoot()/<rel>` → `<root>/<rel>`로 `statWritableDest` 경유 복사. sha256 동일하면 skip(멱등). 변경 파일 목록 출력.
  **companion skills·`workflow/.gitignore`·`package.json`·`req:*`·`req.config.json`·에이전트 진입점은 절대 미접촉.**
- **R4 — packageRoot 가드.** `cfg.root === packageRoot()`(또는 대상 루트가 패키지 루트)면 쓰기 전 하드 거부(fail-closed).
- **R5 — 페르소나 보존.** `--persona` **없이는** 페르소나를 쓰지 않는다. `--persona`가 있어도 `reviewPersonaPath`가
  기본 경로가 아니거나 `null`이면 'unmanaged'로 보고하고 미접촉. 기본 경로여도 vendored 내용이 shipped와 다르면
  (사용자 수정 가능성) plan은 diff 안내만 하고, opt-in 없이는 덮지 않는다. **custom/null/사용자 수정 페르소나는 절대 미훼손.**
- **R6 — confinement 헬퍼 재사용.** `bin/init.ts`의 `statWritableDest`([init.ts:442](../../bin/init.ts))·
  `assertConfinedDest`([init.ts:399](../../bin/init.ts))·`sha256File`([init.ts:561](../../bin/init.ts))에 `export`만 추가한다(동작 무변경).
- **R7 — doctor D20 (WARN).** `runChecks`에 순수 검사 추가. `main()`이 `sha256(packageRoot()/workflow/machine.schema.json)`
  [shipped]와 `sha256(cfg.schemaPathAbs)`[vendored]를 계산해 optional DoctorInputs로 주입한다. 결정표(D19의 undefined→OK 선례):
  sha 미존재(dev repo/미설치)→OK; `packageRoot()===cfg.root`(dogfood)→OK; `cfg.schemaPath`가 non-default custom→OK(unmanaged);
  동일→OK; 상이→**WARN**('vendored machine.schema.json이 설치된 commitgate `<version>`과 불일치 — `commitgate sync` 실행.
  stale 스키마는 delta 리뷰 에스컬레이션을 조용히 비활성화'). **절대 FAIL 아님.**
- **R8 — req.config.schema.json은 cosmetic.** sync가 이 파일도 갱신하되(에디터 `$schema` 정합), 런타임은 인라인
  `CONFIG_SCHEMA`([config.ts:140-188](../../scripts/req/lib/config.ts))를 쓰므로 게이트 영향 0. **어떤 드리프트 WARN에도 등장 금지.**
- **R9 — 테스트·회귀망.** pkgRoot≠repoRoot 픽스처(repo 내부, 사용자 node_modules 미사용)로: sync plan/apply 정상경로;
  `cfg.root===packageRoot()` 거부; custom/null/수정 페르소나 미훼손; seed-once 자산 미접촉; D20 결정표(undefined→OK,
  동일→OK, 상이→WARN, custom→OK). 상시 회귀망 2개: (a) `MACHINE_SCHEMA_VERSION`([review-codex.ts:62](../../scripts/req/review-codex.ts))이
  shipped `machine.schema.json` enum에 존재; (b) 모든 KIT_COPY/KIT_SCHEMA 자산이 `package.json` `files[]`에 존재.
- **R10 — 무회귀 확인.** `typecheck` clean, 전체 `vitest` 통과. 기존 REQ 아카이브 doctor 검증 유지.

## 비목표 (이 REQ 아님)

- **① 커밋되는 install manifest / 자산별 sha 원장 / persona 3-way 자동분류 / `.bak` rollback** — STR-06 후속.
  (manifest-free content-oracle로 두 함정을 닫고, 037과 무효화할 baseline이 없다.)
- **② 캐럿 범위 자동 편집(`devDependencies.commitgate` 재작성) 또는 PM 자동 실행** — Stage B의 devDeps 미주입 원칙 위반.
  범위는 문서/출력 안내로만 다룬다.
- **③ 런타임이 stale 감지 시 패키지 스키마를 silent fallback으로 대체** — confinement 불변식·사용자 커스터마이즈 무력화.
  탐지+명시적 복구(sync)만, silent 대체 금지.
- **④ node_modules realpath 검증** — 문서화된 dead-end.
- **⑤ init/doctor가 sync를 자동 실행** — doctor는 읽기전용 advisory(P9). 복구는 사용자 명시 verb.
- **⑥ D20 FAIL 게이트화** — 본 REQ는 WARN. FAIL 승격은 별도 opt-in 논의(그때도 `packageRoot()===cfg.root` 가드 필수).
- **⑦ 새 `commitgate update` 오케스트레이터 / `--write-range` / inline doctor** — UX-first 후속 논의.
