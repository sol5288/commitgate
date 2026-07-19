# REQ-2026-038 설계 — 자산 skew 감지·복구(`commitgate sync` + doctor D20)

> 정본 결정은 SSOT(G-10 gaps-and-decisions·STR-06 roadmap). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.
> 범위: **MVP manifest-free**(content-oracle). D20 = **WARN**. 커밋 원장·persona 3-way·rollback은 STR-06 후속(비목표 ①).

## 현재 상태(변경 대상)

- **confinement 헬퍼(모듈 private)** — [init.ts](../../bin/init.ts)의 `assertConfinedDest`([:399](../../bin/init.ts))·
  `statWritableDest`([:442](../../bin/init.ts))·`sha256File`([:561](../../bin/init.ts))는 현재 `export`되지 않는다.
  [init.ts:433](../../bin/init.ts)이 "같은 규칙 두 벌이 REQ-2026-024 결함의 원인"이라 명시 → **재구현 금지, export해 재사용**.
- **이미 export된 것** — `PACKAGE_ROOT`([init.ts:43](../../bin/init.ts))·`KIT_SCHEMA_RELPATHS`([init.ts:53](../../bin/init.ts) =
  `['workflow/machine.schema.json','workflow/req.config.schema.json']`)·`assertGitWorkTree`([init.ts:298](../../bin/init.ts)).
  `DEFAULT_REVIEW_PERSONA_RELPATH`([config.ts:102](../../scripts/req/lib/config.ts) = `'workflow/review-persona.md'`).
- **verb dispatch** — [dispatch.mjs:15-24](../../bin/dispatch.mjs) `VERB_MODULES` 맵. [commitgate.mjs:36-38](../../bin/commitgate.mjs)이
  `mod.runCli(rest)`를 **await 없이** 호출. [dispatch.mjs:10-11](../../bin/dispatch.mjs): 없는 모듈 등록 = raw unhandled rejection →
  등록과 파일 추가는 동일 phase.
- **migrate 선례** — [migrate.ts](../../bin/migrate.ts): `--dir`(기본 cwd)로만 root 해소([:21-23](../../bin/migrate.ts)이
  resolveRoot→packageRoot fallback foot-gun을 경고), 기본 dry-run·`--apply`에서만 쓰기, **동기** `runCli`([:18-19](../../bin/migrate.ts)),
  package.json 한 파일만 쓰므로 rollback 프레임워크 없음. sync가 그대로 미러할 구조.
- **config 해소** — [config.ts:207](../../scripts/req/lib/config.ts) `resolveRoot`는 `--root` 미지정+config 미발견 시
  `packageRoot()`로 fallback. `loadConfig({root})`에 root를 **명시**하면 이 fallback을 타지 않는다.
  `DEFAULTS.schemaPath='workflow/machine.schema.json'`([:117](../../scripts/req/lib/config.ts)),
  `reviewPersonaPath` 기본 = `DEFAULT_REVIEW_PERSONA_RELPATH`([:121](../../scripts/req/lib/config.ts), `null`=비활성).
- **doctor** — [req-doctor.ts:27](../../scripts/req/req-doctor.ts)이 이미 `packageRoot`를 import. `DoctorInputs`([:46](../../scripts/req/req-doctor.ts))·
  순수 `runChecks`([:247](../../scripts/req/req-doctor.ts))·`main()`이 inp 조립([:583-609](../../scripts/req/req-doctor.ts)).
  D19가 **WARN 상한 자기보호** 선례([:406-411](../../scripts/req/req-doctor.ts): FAIL이면 이 repo·정당 소비자 커밋 영구 차단).
  `main()`은 이미 `cfg.schemaPathAbs`로 응답 구조를 검증([:527](../../scripts/req/req-doctor.ts)) — vendored 사본을 읽는 지점.
- **run vs 게이트** — `req:commit`이 이 doctor를 exit≠0에 throw하는 하드 게이트로 spawn한다(D19 주석 근거). **D20이 FAIL이면
  skew난 소비자의 모든 커밋이 sync 전까지 벽돌** → D20은 WARN.
- **package.json files[]** — [package.json:45-47](../../package.json)이 `workflow/machine.schema.json`·`req.config.schema.json`·
  `review-persona.md`를 tarball에 적재(shipped 사본의 출처). sync의 src = `PACKAGE_ROOT/<rel>`.

## 핵심 설계 결정

### D1. sync 대상 = 스키마 축(+opt-in persona)만 (R2·R3)

런타임이 실제로 읽는 게이트-결정 자산만 좁게 다룬다. `init --force`(넓은 blast radius: 진입점·config 재시드·Stage A throw·
설치 안내 전부)보다 훨씬 좁다.

- **스키마 축 = `KIT_SCHEMA_RELPATHS`**(machine.schema.json + req.config.schema.json). 이 둘은 계약이지 커스터마이즈
  대상이 아니므로 **`--force` 축**(무조건 갱신)이다. `machine.schema.json`은 게이트 결정(Trap 2 피해의 진원), `req.config.schema.json`은
  런타임 미사용·cosmetic(인라인 `CONFIG_SCHEMA` [config.ts:140-188](../../scripts/req/lib/config.ts)이 실제 검증)이나 에디터
  `$schema` 정합을 위해 함께 갱신. **cosmetic 파일은 어떤 드리프트 WARN에도 등장 금지**(R8).
- **seed-once 자산 제외** — companion skills([init.ts:108-113](../../bin/init.ts))·`workflow/.gitignore`([init.ts:96](../../bin/init.ts))는
  `--force`도 안 덮는 사용자 소유 축. sync도 미접촉.
- **미접촉** — package.json·`req:*`·req.config.json·에이전트 진입점·AGENTS.md/CLAUDE.md.

### D2. 쓰기 경로 = init confinement 재사용 (R6)

sync의 모든 쓰기는 `statWritableDest(targetRoot, destRel)`([init.ts:442](../../bin/init.ts))를 거친다 — 상위 컴포넌트
전부 + leaf를 `lstat`으로 검사해 symlink escape를 막고, 일반 파일/부재만 허용. `sha256File`로 바이트 동일 skip(멱등).
**두 번째 confinement 구현을 만들지 않는다**([init.ts:433](../../bin/init.ts) 경고). → R6에서 세 헬퍼에 `export`만 추가(동작 무변경).

### D3. root 해소 + packageRoot 하드 가드 (R4)

migrate와 동일하게 `--dir`(기본 cwd)로 `targetRoot`를 확정하고 `assertGitWorkTree(targetRoot)`로 검증한다. 그 다음:

```ts
const targetRoot = resolve(opts.dir)                 // 기본 cwd (migrate 방식)
assertGitWorkTree(targetRoot)                        // fake .git 거부
if (targetRoot === PACKAGE_ROOT)                     // 🔴 fail-closed 가드 (R4)
  throw new Error('sync 대상이 CommitGate 패키지 자신입니다 — 소비 repo에서 실행하세요.')
const cfg = loadConfig({ root: targetRoot })         // root 명시 → resolveRoot fallback 안 탐(config.ts:207)
```

- `loadConfig({root: targetRoot})`는 root를 **명시**하므로 [config.ts:207](../../scripts/req/lib/config.ts)의 packageRoot
  fallback을 원천 차단. `targetRoot===PACKAGE_ROOT` 가드는 그 위의 이중 방어(dogfood·오용 모두 거부).
- cfg에서 `schemaPath`·`reviewPersonaPath`(custom/null 여부)를 읽어 D4·D5 판정에 쓴다.

### D4. 스키마 축 재동기화 (R3) — plan/apply

`KIT_SCHEMA_RELPATHS`의 각 `rel`에 대해 `src=join(PACKAGE_ROOT,rel)`, `dest=join(targetRoot,rel)`:

```
st = statWritableDest(targetRoot, rel)               // confinement + leaf
if st===null                → 'new'    (dest 부재; apply: 복사)
else if sha(src)===sha(dest)→ 'in-sync'(skip)
else                        → 'stale'  (apply: copyFileSync 무조건 — 계약은 --force 축)
```

- plan(기본): 축별 상태표만 출력, 쓰기 0건. apply: `new`·`stale`만 `copyFileSync(src,dest)`. 변경 목록 출력 + 스테이징 안내.
- **schemaPath가 non-default custom 경로**면 그 vendored 파일은 kit 관리 자산이 아니다 → 'custom, unmanaged'로 보고, 미접촉.
  (단 리터럴 `workflow/*.json` 복사 자체는 KIT_SCHEMA_RELPATHS 기준이므로, custom schemaPath는 별도 파일 — 혼동 없음.)

### D5. 페르소나 = 명시 opt-in·custom/null 불가침 (R5)

**커스터마이즈의 정식 탈출구는 `reviewPersonaPath`를 사용자 파일로 지정하는 것**이다. 기본 경로(`workflow/review-persona.md`)는
kit 관리 위치로 간주한다.

```
--persona 없음                         → 페르소나 미접촉 (plan은 drift를 advisory로만 표시)
--persona + reviewPersonaPath===null   → 'unmanaged (disabled)', 미접촉
--persona + custom 경로(≠기본)          → 'unmanaged (custom path)', 미접촉
--persona + 기본 경로 + sha 동일        → in-sync, skip
--persona + 기본 경로 + 다름            → apply: shipped로 덮음(statWritableDest 경유). plan은 "기본 경로 persona를
                                          shipped로 교체(직접 커스터마이즈했다면 custom 경로로 옮기세요)" 경고.
```

- 이로써 **custom/null 페르소나는 어떤 경우에도 미훼손**. 기본 경로 페르소나는 명시적 `--persona`에서만 교체되며, manifest가
  없어 stale-kit과 사용자-편집을 구별할 수 없으므로 plan이 명확히 경고하고 opt-in을 요구한다(사용자 편집 보존 방향으로 fail).

### D6. doctor D20 — content-hash 드리프트 WARN (R7)

`main()`이 shipped/vendored sha와 판정 플래그를 계산해 optional `DoctorInputs`로 주입하고, `runChecks`는 순수 유지:

```ts
// main()
const shippedSchemaAbs = join(packageRoot(), 'workflow', 'machine.schema.json')
const shippedSchemaSha  = safeSha(shippedSchemaAbs)          // 없으면 null
const vendoredSchemaSha = safeSha(cfg.schemaPathAbs)         // 없으면 null
const packageRootDiffers = packageRoot() !== cfg.root
const schemaPathIsDefault = cfg.schemaPath === DEFAULTS.schemaPath
const installedVersion = safeReadVersion(join(packageRoot(),'package.json'))  // 메시지용
```

```ts
// runChecks D20 (순수, 결정표 — D19의 undefined→OK 선례)
if (!inp.packageRootDiffers)            OK  'dev repo/dogfood(점검 불요)'
else if (!inp.schemaPathIsDefault)      OK  'custom schemaPath(unmanaged)'
else if (shipped==null || vendored==null) OK '점검 불요'
else if (shipped===vendored)            OK  '자산 동기화됨'
else                                    WARN `vendored machine.schema.json이 설치된 commitgate ${ver}과 불일치 —
                                              \`commitgate sync\`. stale 스키마는 delta 리뷰 에스컬레이션을 조용히 비활성화`
```

- **절대 FAIL 아님**(D19 근거 [:406-411](../../scripts/req/req-doctor.ts)): `req:commit`의 하드 게이트로 spawn되므로 FAIL은
  skew난 소비자 커밋을 벽돌로 만든다. 확인된 피해는 데이터 손실이 아닌 조용한 기능 상실 → WARN이 정확한 강도.
- **dogfood-clean**: 소스 repo는 `packageRoot()===cfg.root` → 첫 분기에서 OK. content-hash라 037이 바꾼 값도 자동 반영(baseline 없음).
- **schema 전용**: persona는 D20에서 보지 않는다(커스터마이즈 모호성·게이트 미결정). persona drift는 `commitgate sync --persona` plan이 표시.

## Phase별 구현

각 phase ≤ 리뷰가능 크기(granularity ≤8 코드파일). 헬퍼 export → verb → 감지 → 문서 순(의존 방향).

| phase | 범위 | 변경 파일 |
|---|---|---|
| `phase-1-export-helpers` | R6 — `assertConfinedDest`·`statWritableDest`·`sha256File`에 `export` 추가. **동작 무변경**. export 존재 assert | `bin/init.ts`·`tests/unit/init.test.ts` |
| `phase-2-sync-verb` | D1~D5(R2·R3·R4·R5) — 신규 `bin/sync.ts`(동기 runCli·plan/apply·`--dir`·`--persona`·packageRoot 가드)·dispatch 등록·commitgate.mjs help | `bin/sync.ts`·`bin/dispatch.mjs`·`bin/commitgate.mjs`·`tests/unit/sync.test.ts`·`tests/unit/dispatch.test.ts` |
| `phase-3-doctor-d20` | D6(R7·R8) — D20 검사·DoctorInputs 필드·main() sha/version 계산. 상시 회귀망 2개(R9) | `scripts/req/req-doctor.ts`·`tests/unit/req-doctor.test.ts`·`tests/unit/init.test.ts`(files[] 세축)·`tests/unit/req-review-codex.test.ts`(schema-version enum) |
| `phase-4-docs` | R1 — README(ko/en) 거짓 주장 교정 + "업그레이드(0.x)" 절·CHANGELOG·SSOT(G-10/STR-06 부분 해결). **코드 없음** | 문서 |

## 변경 파일

- `bin/init.ts` — 세 헬퍼 `export`(동작 무변경, phase-1)
- `bin/sync.ts` — 신규 verb(phase-2)
- `bin/dispatch.mjs` — `sync` VERB_MODULES 등록(phase-2)
- `bin/commitgate.mjs` — help docstring(phase-2)
- `scripts/req/req-doctor.ts` — D20 + DoctorInputs 필드 + main() 계산(phase-3)
- `tests/unit/{sync,dispatch,req-doctor,init,req-review-codex}.test.ts` — 신규·갱신(phase-2·3)
- 문서: `README.md`·`README.en.md`·`CHANGELOG.md`·`docs/ssot-design/gaps-and-decisions.md`·`docs/ssot-design/14-product-strategy-and-roadmap.md`(phase-4)

**`scripts/req/review-codex.ts`·`workflow/machine.schema.json`·`state.json` 스키마·`scripts/req/lib/config.ts` 런타임 로직 무변경.**
(review 경로·게이트는 손대지 않는다. doctor 추가는 additive WARN뿐.)

## 하위호환·안전

- **무회귀**: sync는 신규 verb(기존 명령 무영향). doctor D20은 additive이며 dev repo/미설치/custom/동기화 상태에서 전부 OK →
  기존 소비자·이 repo의 doctor 결과 불변. 기존 REQ 아카이브(REQ-028 등) 검증 무영향(응답 구조 검증 경로 무변경).
- **confinement**: 모든 쓰기가 `statWritableDest` 단일 경로(재구현 없음). symlink escape 불가. `targetRoot===PACKAGE_ROOT`
  하드 가드 + `loadConfig({root})` 명시로 packageRoot fallback 이중 차단.
- **fail-closed 방향**: sync 기본 dry-run(쓰기 0건). persona는 opt-in이며 custom/null 불가침 — 애매하면 사용자 편집 보존 쪽으로 실패.
  D20은 sha 계산 불가·dogfood·custom·동일에서 OK(오탐으로 게이트 막지 않음), 상이에서만 WARN(게이트 안 막음).
- **게이트 무결성**: review/commit hot path·machine.schema.json·CONFIG_SCHEMA·state 스키마 무변경. Codex 리뷰 게이트·doctor 기존
  FAIL 검사(D2/D6/D9/D16 등) 전부 그대로.
- **Trap 1 한계(문서화)**: 캐럿 범위는 소비자 package.json에서 PM이 강제하므로 코드로 못 고친다. sync/문서는 "범위 확대 후
  sync"를 안내할 뿐 범위를 자동 편집하지 않는다(Stage B devDeps 미주입 원칙).
- **잔여 트레이드오프(문서화)**: manifest 없음 → persona의 stale-kit vs 사용자-편집을 자동 구별 못 함(그래서 opt-in·경고). 커밋
  원장·3-way·rollback은 STR-06 후속. content-oracle은 node_modules/commitgate 존재(Stage B)를 전제 — Stage A 소비자는 D20 OK(감지 없음, migrate 경로).
