# CommitGate 후속 개선 설계 & 가이드 (#1 · #2 · #3)

> 상태: **설계/가이드 문서** — 구현 전. Codex 보안 리뷰에서 non-blocking 후속으로 분류된 3건.
> 대상 이슈: [#1](https://github.com/sol5288/commitgate/issues/1) · [#2](https://github.com/sol5288/commitgate/issues/2) · [#3](https://github.com/sol5288/commitgate/issues/3)
> 이 문서는 "무엇을·왜·어떻게"만 정의한다. 실제 구현은 별도(가급적 CommitGate 워크플로 자신으로 dogfood — §6).

---

## 0. 공통 배경 (세 이슈가 공유하는 맥락)

**P1 보안 수정 요약.** 초기 배포(0.1.0)의 `codex`·패키지매니저 호출은 `execFileSync(..., { shell: true })`였다. 이 경로는 인자에 shell 메타문자(`& | < > ^ " ...`)가 들어오면 **명령 주입**이 가능했고(실제 재현됨), 공백 포함 경로도 깨졌다. 0.1.1에서 이를 **`cross-spawn` 기반 `safeSpawnSync`**(`scripts/req/lib/adapters.ts`)로 교체해 shell을 제거했다.

**보안 경계가 `cross-spawn`에 위임됐다는 사실이 핵심.** 즉 "주입이 막힌다"는 보장은 이제 **cross-spawn의 동작**에 의존한다. 여기서 세 후속이 파생된다.

- **#1**: 우리는 대상 repo에 `cross-spawn@^7.0.6`을 주입하지만, 이미 낮은 버전이 있으면 **비파괴 정책상 보존**한다 → 경계가 검증 안 된 버전에 얹힐 수 있다.
- **#2**: 이 경계를 **Windows에서만** 검증했다 → POSIX(cross-spawn의 다른 코드경로)는 미검증.
- **#3**: 정식 회귀 테스트는 `node -e`로 도는데, 실제 공격면인 **Windows `.cmd`(codex.cmd·npm.cmd) 경로**는 임시 smoke로만 확인됐다 → 회귀 가드에 안 들어가 있다.

> 참고(정확성): `cross-spawn`의 **주입 안전성(no-shell)은 모든 버전의 설계 특성**이다. 우리가 하한을 `7.0.6`으로 잡은 이유는 (a) ReDoS 취약점 **CVE-2024-21538**(cross-spawn `<7.0.5`·`<6.0.6` 영향, 7.0.5/6.0.6에서 수정)과 (b) 우리가 **실제로 검증한 버전대**를 고정하기 위함이다.

---

## 1. #1 — init: 기존 `cross-spawn` 버전 하한 진단

### 배경
`bin/init.ts`는 대상 `package.json`에 `req:*` 스크립트와 devDeps(`ajv`·`tsx`·`cross-spawn`)를 주입한다. 주입 규칙은 **멱등·비파괴**: `if (!(key in devDeps))` 일 때만 추가한다(`REQ_DEV_DEPS`). 따라서 대상이 이미 `cross-spawn: "^6.0.0"` 같은 낮은 버전을 갖고 있으면 **그대로 보존**하고, 우리가 원하는 `^7.0.6`으로 올리지 않는다.

### 왜 해야 하나
CommitGate의 존재 이유는 **fail-closed 안전**이다. 그런데 보안 경계(safeSpawnSync)가 **검증되지 않은 낮은 cross-spawn 버전** 위에서 "조용히" 돌아가는 것은 이 철학과 모순된다. 특히 `<7.0.5`는 ReDoS(CVE-2024-21538)에 노출된다. 비파괴 정책(사용자 선택 존중)과 보안 하한 강제 사이의 **긴장**을 명시적으로 해소해야 한다 — 지금은 아무 신호 없이 낮은 버전을 수용한다.

### 목표
init이 대상의 기존 `cross-spawn`(dev 또는 일반 deps) 버전이 **하한(`7.0.6`) 아래일 수 있으면 감지**하고, 사용자에게 **명확히 알린다**. 정책은 기본 "경고", 선택적 "fail-closed".

### 어떻게 (설계)

**D1. 정책 = 경고(default) + `--strict`(fail-closed) 옵션.**
- 기본은 **WARN**: 비파괴/멱등 계약을 깨지 않는다. init은 "설치 편의" 도구이고, 사용자가 고른 의존성 버전에서 하드 실패하는 건 과하다.
- `--strict` 플래그: 하한 미만이면 **throw**(fail-closed). 보안을 강제하고 싶은 팀/CI용.
- (근거: 하한 미만이어도 **주입 자체는 여전히 안전**하다 — no-shell은 설계 특성. 리스크는 ReDoS·미검증 동작이라 "경고"가 비례적이다.)

**D2. 검사 대상.** `devDependencies`와 `dependencies` **둘 다**의 `cross-spawn`. (사용자가 일반 dep로 둘 수 있음.)

**D3. 버전 비교 semantics — 여기가 설계의 핵심 난점.**
- range spec(`package.json`)과 실제 설치 버전(lockfile/`node_modules`)은 다르다.
  - `^7.0.0`은 range상 7.0.0을 허용하지만, npm은 **설치 시 최신 7.x(≥7.0.6)**를 받는다 → 실제로는 안전.
  - `~7.0.1`·`7.0.1`(핀)·`^6.0.0`은 **하한 미만으로 잠길 수 있음** → 위험.
- 따라서 단순 `minVersion(range) < 7.0.6` 판정은 `^7.0.0`에서 **오탐**을 낸다.
- **권고 판정 로직(2단계):**
  1. 가능하면 **실제 설치 버전**을 우선 확인: `<target>/node_modules/cross-spawn/package.json`의 `version`, 없으면 lockfile(`package-lock.json`/`pnpm-lock.yaml`/`yarn.lock`)에서 해소된 버전. 이게 있으면 `semver.lt(installed, '7.0.6')`로 정확 판정.
  2. 설치 전(해소 버전 없음)이면 range로 판정하되 **오탐 최소화**: `semver.subset(range, '>=7.0.6')`가 `false`이고 **동시에** `semver.minVersion(range)`가 하한 미만이며 range가 상한이 좁아(캐럿·틸드 아닌 핀/6.x 등) 하한에 도달 못 하는 경우만 경고. 애매하면(예: `^7.x`) **INFO 수준 안내**로 낮춘다.
- **의존성**: 정확한 semver 비교를 손으로 하면 또 버그다. `semver`(사실상 표준, 초경량) 도입 권고.
  - ⚠️ **위치 정정**: `bin/init.ts`가 `semver`를 import하면 이는 `npx commitgate` 실행 시 필요한 **commitgate 패키지의 런타임 `dependencies`**다. 대상 repo에 주입하는 `REQ_DEV_DEPS`가 **아니다** — target 복사본(`scripts/req/*`)은 semver를 쓰지 않는다. 따라서 `ajv`·`cross-spawn`·`tsx`처럼 **commitgate 자신의 `dependencies`**에 추가한다.
  - 대안: dep 추가 없이 "설치 버전 파일 읽기 + 단순 major/patch 비교"로 좁게 구현(오탐/미탐 감수). 트레이드오프 문서화 필요.

**D4. 하한의 단일 출처(SSOT).** 경고 기준 버전은 `REQ_DEV_DEPS['cross-spawn']`(현재 `^7.0.6`)에서 파생 — 하드코딩 이중화 금지.

**D5. 메시지.** 예: `⚠️ 기존 cross-spawn@6.1.0 감지 — CommitGate 보안 경계는 >=7.0.6 검증분입니다. 'npm i -D cross-spawn@^7.0.6' 권장(설치는 계속 진행). --strict면 여기서 중단.`

### 수용 기준 / 테스트 계획
- 대상 devDeps `cross-spawn`이 `6.x`·`~7.0.1`·`7.0.1` → **경고 emit**, `--strict`면 throw + **부분 설치 없음**(preflight 단계에서 판정).
- `^7.0.6`·`>=7.0.6`·(설치버전 7.0.9) → 경고 없음.
- `^7.0.0`(캐럿) → 오탐 없이 통과(또는 INFO). 이 케이스를 테스트로 고정.
- `dependencies`에 있는 경우도 감지.
- 하한 SSOT 변경 시 판정도 따라감(단위 테스트로 가드).

### 리스크 / 트레이드오프
- semver 도입 = **commitgate `dependencies`** 1개 추가(공급망 표면; target 주입 아님). vs 손수 비교의 오탐/버그.
- fail-closed를 default로 하면 기존 사용자 설치를 깨뜨림 → default는 WARN이 안전(`--strict`는 opt-in).

---

## 2. #2 — Linux/macOS CI smoke

### 배경
지금까지의 모든 검증(386 유닛 테스트·tsc·pack·init smoke·`.cmd` 주입 실측)은 **Windows에서만** 수행됐다. 그러나 `cross-spawn`은 **플랫폼별로 코드경로가 다르다**: POSIX에서는 `.cmd` 래퍼가 없어 바이너리를 직접 exec하고, Windows에서는 cmd.exe 경유 escaping을 탄다. 즉 **POSIX 경로는 배포됐지만 한 번도 자동 검증된 적이 없다.**

### 왜 해야 하나
- CommitGate는 `engines.node>=18.17`로 **전 플랫폼 배포**된다. npm/CI 사용자의 다수가 Linux/macOS다. 미검증 = 미지의 회귀 리스크.
- 플랫폼 의존 코드가 실제로 있다: 런처(`bin/commitgate.mjs`, `tsx/esm/api` register), init의 git probe(`realpathSync.native`·`git rev-parse`), `safeSpawnSync`의 POSIX 경로, `npx commitgate` 설치 흐름.
- 배포 게이트를 **"전 플랫폼 CI green"**으로 끌어올려, "Windows에서만 됐다"를 blocker에서 제거.

### 목표
GitHub Actions로 **{ubuntu, macos, windows} × {Node 18·20·22}** 매트릭스에서 install→typecheck→test→pack→**npx 설치 smoke**를 자동 실행. main push·PR·태그에서 동작. 이걸 **배포 전 게이트**로 채택.

### 어떻게 (설계)

**D1. 워크플로 파일** `.github/workflows/ci.yml`
- trigger: `push`(main), `pull_request`, `push tags v*`.
- matrix: `os: [ubuntu-latest, macos-latest, windows-latest]`, `node: [18, 20, 22]`(18은 18.17 이상 보장).
- steps: `actions/checkout` → `actions/setup-node`(matrix node) → `npm ci` → `npm run typecheck` → `npm test` → `npm pack` → **smoke**.

**D2. smoke 잡 — 반드시 `npm pack` tarball 기반(로컬 소스 실행 아님).**
- ⚠️ **정정**: `node bin/commitgate.mjs ...`는 **로컬 소스 실행**이라 "설치 smoke"가 아니다. 실제 배포 아티팩트(`bin` 필드 해소·`files` whitelist·deps 설치)를 검증하려면 **pack tarball을 설치해 그 bin을 실행**해야 한다.
- 흐름:
  1. `npm pack` → `commitgate-x.y.z.tgz` 생성.
  2. 임시 target dir: `git init` + `git config user.{email,name}`(req:new가 커밋하므로) + `npm init -y`.
  3. `npm i -D <절대경로>/commitgate-x.y.z.tgz` (배포본 설치 — deps·bin 해소 검증).
  4. `npx commitgate --dry-run` (설치된 패키지의 bin 실행) → **rc=0**.
  5. (선택) 실제 init(`npx commitgate`) 후 파일 존재·`package.json` 스크립트/주입 devDeps 검증.
- 재사용 가능한 `npm run smoke`(pack→설치→bin 실행)로 캡슐화 권고 — 로컬 셀프체크에도 동일 사용.
- **경계 명시:** `req:review-codex`(design/phase 리뷰)와 `req:commit`은 **live Codex + 인증**이 필요 → CI(시크릿 없이)에서 **실행 불가**. 따라서 CI smoke는 **설치·스캐폴드·doctor(리뷰 전 게이트)·config**까지만 커버한다.
- **리뷰 로직은 이미 크로스플랫폼 유닛 테스트가 커버**(`createFakeReviewerAdapter`로 live codex 없이 review-codex 플로 검증) → CI가 그 유닛을 전 OS에서 돌리는 것으로 로직 회귀는 잡힌다. **못 잡는 건 오직 live Codex 왕복**뿐이고, 이는 시크릿 정책상 별도(수동/사용자 환경).

**D3. 배포 게이트 연동(문서).** `RELEASING`/README에 "**CI 전 매트릭스 green 후에만 `npm publish`**" 명문화. (선택) publish를 tag 트리거 + environment protection으로 반자동화하되, **2FA 때문에 완전 자동 publish는 불가** → 태그가 CI green을 확인하고 사람이 최종 `npm publish`.

### 수용 기준
- 3 OS × 3 Node 전부 typecheck 0 · test green · pack 성공 · **pack tarball 설치본의 `commitgate` bin 실행 rc=0**(로컬 소스 실행 아님).
- macOS/Linux 신규 실패 발견 시 이슈화(이번 작업의 부산물로 기대되는 값).
- `npm run smoke`(pack→설치→bin 실행)가 로컬에서도 동일 동작(개발자 셀프체크).

### 리스크 / 주의
- macos runner 비용/큐 지연 → 필요 시 macos는 Node 1개(20)로 축소.
- `.cmd` 테스트(#3)는 windows runner에서만 유효 → 플랫폼 가드 필수(#3와 물림).

---

## 3. #3 — `.cmd` 메타문자 주입을 정식 테스트로 편입

### 배경
P1 재검증 때 PM이 **임시 smoke**로 Windows `.cmd`에 `x & echo INJECTED | ... > out.txt`를 넘겨 **주입이 안 됨(out.txt 미생성)**을 확인했다. 그런데 리포지토리의 **정식 회귀 테스트**(`tests/unit/req-adapters.test.ts [P1]`)는 `node -e`(일반 실행 파일)로 검증한다 — 이는 크로스플랫폼이지만 **cross-spawn의 `.cmd` 경로를 타지 않는다**(cross-spawn은 대상이 `.cmd`/`.bat`일 때만 cmd.exe 래핑 로직을 탄다).

### 왜 해야 하나
실제 공격면은 **Windows `.cmd` 래퍼**(codex.cmd·npm.cmd·pnpm.cmd·yarn.cmd)다. 즉 **가장 위험한 경로가 회귀 가드에 없다.** 미래의 변경(누가 shell:true 재도입, 혹은 cross-spawn 업그레이드로 escaping 동작 변화)이 이 경로를 깨도 현재 테스트로는 못 잡는다. 임시 smoke는 재현 불가능한 1회성 증거일 뿐이다.

### 목표
**Windows 전용(플랫폼 가드) 정식 회귀 테스트**를 추가해 `.cmd` 대상 주입 방어를 CI(#2의 windows runner)에서 상시 검증.

### 어떻게 (설계)

**D1. 플랫폼 가드.** vitest에서 `const winIt = process.platform === 'win32' ? it : it.skip`(또는 `describe.runIf(process.platform==='win32')`). 비-Windows에서는 skip(테스트 실패 아님).

**D2. 픽스처 — 실제 wrapper(npm/codex.cmd)처럼 node recorder를 호출하는 `.cmd`.**
- ⚠️ `echo ARGV=%*`는 batch 재확장(`%*`)으로 fixture 자체가 취약하고, "원문 인자 도착" 검증에도 부적합하다.
- 대신 codex.cmd·npm.cmd와 **동형**으로, `.cmd`가 **node recorder**를 호출하게 한다:
  ```
  @echo off
  node "%~dp0recorder.js" %*
  ```
  `recorder.js`는 `process.argv.slice(2)`(받은 argv)를 **JSON 파일로 기록**.

**D3. 검증 — 부작용 부재 + argv 리터럴 일치(stdout 파싱 아님).**
- `safeSpawnSync(tempCmd, ['x & echo INJECTED> injected.txt', 'a|b', 'c>d'])` 실행.
- 단언 **두 가지만**:
  1. `injected.txt`가 **생성되지 않음** = 주입된 2차 명령 미실행(주입 차단).
  2. recorder가 기록한 argv가 **원본 인자 배열과 정확히 동일**(리터럴 전달).
- ⚠️ **stdout에서 `INJECTED` 부재를 단언하지 말 것** — 인자 자체에 `INJECTED` 문자열이 리터럴로 들어있는 게 정상이라 "원문 도착"과 충돌한다.
- 임시 파일 정리(afterEach/finally).

**D4. `node -e` 테스트와의 관계.** 둘은 **상보적**이다 — `node -e`(전 OS, 일반 exec 경로) + `.cmd`(Windows, 래퍼 경로). 둘 다 유지.

### 수용 기준
- windows runner에서 `.cmd` 주입 테스트 **통과**, 비-Windows에서 **skip**(통과로 집계).
- 만약 누군가 `safeSpawnSync`를 shell 경유로 되돌리면 이 테스트가 **red**가 되어 회귀를 잡음(테스트의 존재 이유).

### 리스크 / 주의
- `.cmd`의 `%*` 재확장은 실제 npm/codex.cmd wrapper와 **동일한 경로**다 — fixture가 이를 그대로 재현하므로 "테스트가 곧 실환경". cross-spawn이 제 역할을 하면 통과, 못 하면 red(그게 목적).
- recorder+argv 비교라 특수문자(`% ! ^`)에도 견고(stdout 파싱 안 함). 단, 인자에 개행·NUL은 제외(recorder JSON 경계).

---

## 4. 우선순위 / 순서 권고

| 순서 | 이슈 | 이유 |
|---|---|---|
| **1** | **#3** (.cmd 정식 테스트) | 가장 저비용 + 보안 핵심경로를 회귀 가드에 즉시 고정. 코어 무변경. |
| **2** | **#2** (CI 매트릭스) | 인프라 토대 — #3(Windows)·유닛 전체를 전 OS에서 상시 실행하고 **배포 게이트**가 됨. |
| **3** | **#1** (버전 하한 진단) | 정책 결정(WARN/strict)·semver 도입 여부 등 **판단이 필요**해 마지막. #2가 있으면 전 OS에서 검증됨. |

> #3는 #2의 windows 잡에서 돌아가므로 두 개를 함께 묶어 한 REQ로 처리해도 좋다. #1은 정책·의존성 결정이 얽혀 별도 REQ 권장.

## 5. 비목표
- 코어 승인 바인딩(D9/D10/D11)·safeSpawnSync 자체 로직 변경(이미 검증됨).
- Stage B(라이브러리 모델)·비-git VCS·2종 설계문서.
- CI에서의 **live Codex 리뷰 자동화**(시크릿·2FA 정책상 범위 밖 — FakeReviewerAdapter 유닛으로 로직만 커버).
- 완전 자동 `npm publish`(2FA로 불가 — 사람 최종 실행 유지).

## 6. (권장) 이 후속들을 CommitGate 워크플로로 처리하기
이 저장소는 CommitGate 자신이다. 세 개선을 **dogfood**로 태우면 도구의 유용성을 다시 증명하고 증거도 남는다.

- 각 이슈를 `req:new`로 티켓화 → 이 문서를 `01-design.md`의 씨앗으로 → design 리뷰 → phase 구현 → phase 리뷰 → `req:commit`.
- 제안 티켓 분해:
  - **REQ-A**: #2 + #3 (CI 매트릭스 + `.cmd` 정식 테스트) — 물려 있어 한 REQ.
  - **REQ-B**: #1 (버전 하한 진단) — 정책·semver 결정 포함, 독립 REQ.
- 각 REQ의 통제점은 평소와 동일(req:commit·push·범위변경).

---

### 부록: 관련 코드 좌표
- P1 경계: `scripts/req/lib/adapters.ts` (`safeSpawnSync`, `defaultCodexRunner`), `scripts/req/req-commit.ts` (`runDoctor`)
- 주입 규칙: `bin/init.ts` (`REQ_DEV_DEPS`, preflight/apply)
- 현행 P1 테스트: `tests/unit/req-adapters.test.ts` (`[P1] safeSpawnSync`)
- 하한 SSOT: `package.json` `dependencies.cross-spawn` = `bin/init.ts` `REQ_DEV_DEPS['cross-spawn']` = `^7.0.6`
