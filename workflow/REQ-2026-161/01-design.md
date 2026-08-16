# REQ-2026-161 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

### 명령 표면 SSOT 는 이미 있다

`bin/dispatch.mjs` 의 `VERB_MODULES` 가 정본이고, `bin/init.ts` 가 거기서 파생한다:

```ts
export const STAGE_B_REQ_VERBS: string[] = Object.keys(VERB_MODULES).filter((v) => v.startsWith('req:')).sort()
export const STAGE_B_REQ_SCRIPTS: Record<string, string> = Object.fromEntries(
  STAGE_B_REQ_VERBS.map((k) => [k, `commitgate ${k}`]),
)
```

주입도 이미 insert-only 다(`bin/init.ts` — `if (!(k in scripts))`). **즉 "무엇이 있어야 하는가"와
"어떻게 채우는가"는 이미 풀려 있다.** 없는 것은 ① 부족하다는 **판정**과 ② 그 판정에 도달하는 **표면**이다.

🔴 `bin/dispatch.mjs` 는 **54줄 · import 0** 의 순수 모듈 맵이다. 그래서 `req-doctor` 가 이것을 참조해도
`bin/init.ts`(~1250줄 · cross-spawn·semver·git spawn)를 끌어오는 레이어 역전이 **생기지 않는다** —
`req-doctor.ts` 가 문서로 금지한 것은 `init.ts` import 이지 명령 표면 참조가 아니다.

### 왜 D19 가 못 잡는가

```ts
const REQ_SCRIPT_KEYS = ['req:new', 'req:next', 'req:review-codex', 'req:doctor', 'req:commit'] as const
export function classifyInstallMode(scripts: Record<string, string>): InstallMode {
  const values = REQ_SCRIPT_KEYS.map((k) => scripts[k]).filter((v): v is string => typeof v === 'string')
  …
}
```

`filter(isString)` 이 **부재 키를 조용히 떨어뜨린다.** 5개 중 5개가 Stage B 형태이므로 `'stage-b'` 가
나오고, 그 뒤 `req:delegate`·`req:repolicy` 가 없어도 `OK` 다. 목록이 5개로 고정된 것도 의도된 것이다
(주석: "키가 늘면 이 목록도 늘려야 한다") — **모드 판정에는 표본 5개면 충분**하기 때문이다.

## 핵심 설계 결정

### DEC-1 — 판정은 **순수 술어 하나**, 표면은 둘(`check` C6 · `doctor` D33)

`scripts/req/lib/command-surface.ts`(신규)에 순수 술어를 둔다:

```ts
export function missingReqScripts(scripts: Record<string, string> | null | undefined): string[]
```

- 입력은 `package.json` 의 `scripts` 맵. 기대 집합은 `VERB_MODULES` 에서 **파생**한다(하드코딩 금지).
- 출력은 **부재 키 이름 배열**(정렬). `[]` = 부족 없음. `null`/`undefined` 입력 = 판정 불가 → `[]`
  (없는 것을 "부족"으로 읽지 않는다).

🔴 **왜 술어 하나인가**: REQ-2026-094 가 남긴 교훈 — *술어만 공유하면 부족하고 입력 획득까지 맞춰야
한다*. 그래서 술어와 **입력 획득**(`package.json` 읽기)을 같은 모듈에 두고 두 표면이 그것만 부른다.
두 곳에서 각자 읽으면 한쪽이 `scripts` 부재를 다르게 다루는 순간 판정이 갈라진다.

🔴 **왜 두 표면인가**: 실측에서 두 층 모두 침묵했고, 두 층이 잡는 시점이 다르다.
- `check` — 티켓 없이 도는 **설치 스코프** 진단. `docs/upgrade.md` 의 업그레이드 절차가 이미
  `npx commitgate check` 를 부른다. 업그레이드 **직후**가 이 skew 가 생기는 시점이다.
- `doctor` — 티켓 진행 중 매번 도는 층. 실측에서 사용자는 `doctor` 는 계속 돌리고 `check` 는 거의
  안 돌렸다. `check` 에만 두면 **실제로 막히는 사람은 끝까지 못 본다.**

🔴 **dogfood skip 은 두 표면 **모두**의 계약이다**(설계 r01 P1). 이 저장소 자신의 `package.json` 은
`req:*` 를 **5개**(`req:new`·`req:next`·`req:review-codex`·`req:doctor`·`req:commit`)만, 그것도 Stage A
형태(`tsx scripts/req/*.ts`)로 갖는다. 반면 `VERB_MODULES` 의 `req:*` 는 **12개**다. 그래서 skip 이 없으면
**패키지 루트에서 `commitgate check` 를 돌리는 정상 dogfood 경로가 7개 누락 WARN 을 낸다** — 요구 완료
기준 3 을 정면으로 위반한다.

D33 에만 skip 을 걸고 C6 를 빠뜨리는 것은 **한쪽만 고친 것**이다. 두 표면이 같은 술어를 쓰므로
**같은 skip 판정**(`packageRoot() !== 대상 루트`)도 함께 쓴다. `check` 는 지금 패키지 루트를 알지
못하므로 `collectInputs` 가 그 사실을 수집해 `CheckInputs` 로 넘긴다(판정은 `runChecks` 안에서 —
순수 유지).

### DEC-2 — `doctor` 는 D33(신규)이다. **D19 를 고치지 않는다**

D19 는 "설치 **모드**"(Stage A / B / mixed / custom), D33 은 "표면 **집합**"이다. 질문이 다르므로
체크도 다르다. 한 체크에 두 질문을 섞으면 **한쪽 답이 다른 쪽을 가린다** — 지금 `OK Stage B` 가
부재를 가린 것이 정확히 그 형태다.

D33 은 `D_CHECK_IDS` 등록부에 먼저 추가한다(REQ-2026-099 DEC-3a — 등재를 타입이 강제한다).

🔴 **등재는 정본 표 갱신과 같은 phase 여야 한다**(설계 r01 P1). `tests/unit/docs-stale-claims.test.ts`
가 `D_CHECK_IDS` 와 `docs/ssot-design/07-business-rules-and-state-machines.md` 의 D-체크 표 ID 집합을
**양방향으로** 대조한다(`only(A,B)` · `only(B,A)` 둘 다 `[]` 요구). 등재만 하고 표를 미루면 그 순간부터
**전체 스위트가 red** 라, 완료 기준 6(통합 직전 전체 스위트 그린)에 도달할 수 없다.

그래서 07 정본 표의 D33 행 추가는 **문서 phase 로 미루지 않고 D33 배선 phase 안에** 둔다. 같은 테스트가
"등재된 id 는 런타임에서 실제로 방출되는가"(`only(D_CHECK_IDS, runtime)`)도 보므로, 미계산 경로에서도
`applicable:false` 로 **반드시 방출**해야 한다.

**level 은 WARN 상한**이다. 기존 D20/D21/D22 와 같은 계열이고, FAIL 로 두면 스크립트 하나가 없는
설치본의 **모든 커밋이 벽돌**이 된다(REQ-2026-087 이 되돌린 실수의 반복).

**dogfood skip**: `packageRootDiffers === false`(패키지 루트 == 대상 루트)면 D20/D21/D22 와 **같은
기준으로** skip 한다. 이 저장소 자신의 `package.json` 은 `req:*` 를 `tsx scripts/req/*.ts` 로 두므로
skip 하지 않으면 스스로 영구 WARN 이 된다.

### DEC-3 — 복구는 `sync --apply --scripts`(opt-in 축). `sync` 기본 동작은 불변

세 후보를 놓고 골랐다:

| 안 | 판정 |
|---|---|
| `init` 재실행 | ❌ 동작은 하지만(멱등·insert-only) **부수효과가 넓다** — kit 파일 재seed·config 키 병합·설치 커밋 stage. 스크립트 2개를 얻으려고 설치 전체를 다시 돌리는 셈 |
| `sync` 기본 확장 | ❌ 세 문서가 "`sync` 는 package.json 을 건드리지 않는다"고 명시한다. 기본을 바꾸면 공표한 계약이 깨진다 |
| **`sync --scripts`(opt-in)** | ✅ `--persona`(REQ-2026-050) · `--gitignore`(REQ-2026-047)와 **정확히 같은 형태** — 플래그가 없으면 완전 미접촉이라 기본 계약이 그대로 유지되고, 축 하나만 좁게 열린다 |

의미론은 `--gitignore` 축을 그대로 따른다: **없는 키만 백필, 기존 값은 한 글자도 안 바꾼다.**
값은 `STAGE_B_REQ_SCRIPTS` 에서 온다(`commitgate <verb>`).

🔴 **덮어쓰기 경로를 만들지 않는다.** 사용자가 `req:new` 를 자기 래퍼로 바꿔 뒀을 수 있고, 그것은
`init` 이 Stage A 시절부터 보존해 온 값이다. 부재만 채우면 이 REQ 는 **어떤 기존 동작도 바꾸지 않는다.**

### DEC-4 — 안내 문장은 **한 곳**에서 나온다

D33 · C6 · `sync` 계획 출력이 같은 해소 명령을 말해야 한다. 문자열을 세 곳에 적으면 갈라진다
(`lib/control-points.ts` 가 같은 이유로 존재한다). `command-surface.ts` 가 안내 문자열 빌더를
함께 내보내고 세 소비자가 그것을 쓴다.

### DEC-5 — 문서: 묶음의 `stopGate` 조건은 `merge` **와** `auto` 다

`defersToIntegration(sg): sg is 'merge' | 'auto'` 가 코드의 정본이다. 문서 3곳이 `merge` 만 적어
**코드가 지원하는 조합을 문서가 부정**하고 있다:

- `docs/workflow.md` §"delivery set" · `docs/workflow.en.md` 대응 절
- `bin/delivery.ts` `printHelp()` — `req.config.json 의 stopGate: "merge" 를 함께 쓰면 …`

🔴 **새 문장을 덧붙이는 것으로 끝내지 않는다**(REQ-2026-073 교훈 — *새 절 추가 ≠ 갱신*). 안전 속성을
바꾸는 서술이므로 `stopGate: "merge"` 를 **전수 grep** 해서 묶음 문맥의 것을 모두 고친다.

또한 `auto` + 묶음이 **정지 횟수에 어떤 의미인지**를 적는다 — 묶음당 `seal` · `approve` · 위임 발급
**3회 고정**(멤버 수와 무관)이고, 티켓별 통합은 티켓 수만큼이다. 이것이 사용자가 조합을 고를 근거다.

### DEC-6 — 회귀 가드는 "하드코딩 목록이 없다"를 고정한다

`VERB_MODULES` 에 verb 를 추가하면 진단·복구가 **자동으로** 따라와야 한다(요구 제약). 테스트는
`missingReqScripts` 의 기대 집합이 `Object.keys(VERB_MODULES).filter(req:)` 와 **같음**을 확인한다.
목록을 복제한 테스트는 tautology 가 되므로(REQ-2026-031 교훈 — *expected 를 SUT 로 구성하면 tautology*)
기대값은 **dispatch 에서** 오고, 검사는 "`init` 의 `STAGE_B_REQ_VERBS` 와 같은 집합인가"로 한다.

## Phase별 구현

| phase | 내용 |
|---|---|
| 1 | `lib/command-surface.ts` 순수 술어 + 안내 빌더 + 단위 테스트 |
| 2 | `bin/sync.ts` `--scripts` opt-in 백필 + 테스트 |
| 3 | `bin/check.ts` C6 배선(+ **dogfood skip**) + 실경로 테스트 |
| 4 | `req-doctor.ts` D33 등록·판정·배선(+ dogfood skip) + **07 정본 표 갱신** + 실경로 테스트 |
| 5 | 문서 — `workflow`(한/영) · `upgrade`(한/영) · `delivery` help + 전수 grep 가드 |
| 6 | CHANGELOG |

### DEC-7 — **복구가 진단보다 먼저 착륙한다**(phase-2 r02 P1)

처음 계획은 진단(C6·D33)을 먼저 놓고 복구(`sync --scripts`)를 뒤에 뒀다. 그러면 진단이 착륙한 시점에
`sync` 는 아직 `--scripts` 를 파싱하지 못하므로, **WARN 이 안내한 명령이 미지 옵션 오류로 죽는다.**

🔴 그것은 **이 REQ 가 고치려는 결함과 정확히 같은 계열**이다 — "도구가 시킨 명령이 실행 시점에 없다".
자기가 고치는 병을 중간 상태에서 재현하는 계획은 틀린 계획이다(REQ-2026-160 이 같은 실수를 했다:
안내한 탈출구가 실행 불가였다).

그래서 순서를 뒤집는다: **복구 수단이 존재한 뒤에만 그것을 가리키는 진단을 낸다.** 이 규칙은 phase
순서에만 적용되는 것이 아니라, `commandSurfaceGuidance` 가 가리키는 명령을 바꿀 때마다 유효하다.

🔴 phase 2·3·4 는 **배선 phase** 다. 순수 테스트만으로는 배선 끊김을 못 잡는다(REQ-2026-096~099 에서
3연속 실증). 각 phase 는 **실제 경로로 도는 테스트**(`runChecks`/`runChecks` 입력 수집/`sync` 계획
생성)를 exit 조건에 포함한다.

## 변경 파일

- 신규: `scripts/req/lib/command-surface.ts` · `tests/unit/command-surface.test.ts`
- 수정: `bin/check.ts` · `scripts/req/req-doctor.ts` · `bin/sync.ts`
- 정본 표(D33 배선 phase 와 **같은 phase**): `docs/ssot-design/07-business-rules-and-state-machines.md`
- 문서: `docs/workflow.md` · `docs/workflow.en.md` · `docs/upgrade.md` · `docs/upgrade.en.md` ·
  `bin/delivery.ts`(help 문자열) · `CHANGELOG.md`
- 테스트: 위 신규 + 기존 `check`/`doctor`/`sync` 테스트 확장

## 하위호환·안전

- **판정은 전부 advisory** — `check` C6 는 WARN(리포트 exit 계약 불변), D33 은 WARN 상한. 기존 커밋
  경로에 새 차단 지점이 생기지 않는다.
- **`sync` 기본 동작 불변** — `--scripts` 없이는 `package.json` 을 열지도 않는다. 기존 테스트가
  "미접촉"을 고정하고 있으면 그대로 그린이어야 한다.
- **쓰기는 insert-only** — 기존 키를 읽고 다시 쓰지 않는다. `package.json` 의 다른 필드·키 순서·
  들여쓰기 보존은 `init` 이 쓰는 것과 같은 직렬화 경로를 재사용한다.
- **legacy(Stage A) 설치본**: `detectStageA` 계열이 잡는 별개 축이다. D33 은 부재만 말하고
  Stage A 를 Stage B 로 끌고 가지 않는다 — 그 전환은 `migrate` 의 몫이다.
- **dogfood 자기보호**: 이 저장소에서 D33 은 skip 이라 자기 자신을 WARN 으로 만들지 않는다.
