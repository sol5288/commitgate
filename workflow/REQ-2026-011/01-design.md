# REQ-2026-011 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

### pm(패키지매니저) 인식이 세 층으로 갈라져 있다

| 층 | 위치 | 현재 |
|---|---|---|
| 감지·기록 | `bin/init.ts:167-172` `detectPackageManager` → `req.config.json` | 정상 |
| 동적 렌더 | `scripts/req/lib/config.ts:215-218` `buildScriptInvocation`, `bin/init.ts:180-182` `runScriptCmd` | 정상 |
| 정적 산출물·문자열 | `templates/*` 4종, 스크립트 헤더 주석·throw 문구 | **pm 리터럴 하드코딩** |

`bin/init.ts:177-182`의 doc-comment가 이미 규칙을 정확히 서술한다 — "안내 문구가 실제로 복붙 가능한 유효 커맨드가 되도록 pm별로 분기". 그 규칙이 세 번째 층에 적용되지 않았을 뿐이다.

`copyEntrypoints`(`bin/init.ts:250-267`)·`copyInto`(`:199-219`)·AGENTS/CLAUDE 복사(`:490,:492,:493`)는 전부 `copyFileSync`만 호출한다. `bin/init.ts` 안의 유일한 `.replace`(`:208`)는 경로 구분자 정규화이며 내용 치환이 아니다. `templates/` 전체에 플레이스홀더가 없다.

**현행 리터럴 전수:**

| 파일:라인 | 현재 | config 가용? |
|---|---|---|
| `templates/claude-command.md:28,29` | `npm run req:new -- <slug> --run` / `npm run req:next -- <REQ-id>` | — (정적) |
| `templates/claude-skill.md:38` | `npm run req:next -- <REQ-id>` | — (정적) |
| `templates/cursor-rule.mdc:36,37` | `npm run req:new -- …` / `npm run req:next -- …` | — (정적) |
| `templates/CLAUDE.template.md:13` | `npm run req:next -- <REQ-id>` | — (정적) |
| `scripts/req/req-next.ts:18` | 헤더 주석 `npm run req:next -- <REQ-id>` | — (주석) |
| `scripts/req/req-next.ts:589` | throw `예: npm run req:next -- 2026-010` | **가능** (`:578` loadConfig 이후) |
| `scripts/req/req-new.ts:10` | 헤더 주석 `pnpm req:new …` | — (주석) |
| `scripts/req/req-new.ts:115` | throw `예: pnpm req:new camera-hardfail --run` | **불가** (`:118` loadConfig 이전) |
| `scripts/req/req-new.ts:169` | 성공 안내 `pnpm req:review-codex <id> --run` | **가능** |
| `scripts/req/req-doctor.ts:8` | 헤더 주석 `pnpm req:doctor …` | — (주석) |
| `scripts/req/review-codex.ts:16` | 헤더 주석 `pnpm req:review-codex …` | — (주석) |
| `scripts/req/review-codex.ts:1064` | throw `예: pnpm req:review-codex 2026-001` | **가능** (`cfg` 인자) |

`req-new.ts:169`는 요청서 D2에 없으나 **동일 결함 클래스**다. 이 저장소(`req.config.json` = npm)에서 `req:new --run`을 실행하면 실제로 `pnpm req:review-codex …`가 출력된다 — REQ-2026-011 생성 시 재현됨. D2의 수정 원칙("리터럴 대신 파생")을 적용하면서 이것만 남기는 것은 자의적이므로 함께 고친다.

### `--`가 옵션으로 오인된다

```ts
// req-next.ts:562 / req-commit.ts:465 / req-doctor.ts:391 / req-new.ts:105  (동일 패턴)
} else if (a.startsWith('-')) throw new Error(`알 수 없는 옵션: ${a}`)
```

npm은 `npm run x -- a`에서 `--`를 제거해 스크립트에 `a`만 넘긴다. pnpm/yarn은 `--`를 **그대로 전달**한다. 따라서 npm 문구를 pnpm에 옮기면 첫 인자 파싱에서 죽는다.

`review-codex.ts:1053`은 **이 4곳과 다르다** — `else if (!a.startsWith('-')) opts.reqId = a`로, 매칭되지 않은 `-`-접두 인자를 throw 없이 흘려보낸다. 따라서 `--`가 이미 무해하게 무시되며 **D3 대상이 아니다.** (알 수 없는 옵션을 조용히 삼키는 것 자체는 별개의 일관성 결함 — `00-requirement.md` 후속 항목 5.)

각 명령이 실제로 지원하는 플래그(테스트 매트릭스의 근거):

| 스크립트 | 지원 플래그 |
|---|---|
| `req-next` | `--json` `--ticket` `--root` |
| `req-doctor` | `--finalize` `--ticket` `--root` |
| `req-commit` | `--run` `--finalize` `--finalize-design` `--message` `--message-file` `--ticket` `--root` |
| `req-new` | `--run` `--risk` `--title` `--root` |

`req-next`·`req-doctor`에는 `--run`이 **없다**. 이들에게 `--run`을 넘기면 DEC-011-3에 따라 여전히 throw해야 정상이다.

### init이 안내하는 첫 명령이 반드시 실패한다

`runInit`은 `scripts/req/**`·`workflow/*`·진입점·`req.config.json`을 만들고 `package.json`을 수정한다(`bin/init.ts:477-493`). `git add`/`commit`은 하지 않는다. 그 직후 안내(`bin/init.ts:611-617`)의 마지막 단계가 `req:new <slug> --run`인데, `req-new.ts:137-139`가 clean 워킹트리를 요구한다. `git status --porcelain`은 untracked(`??`)도 출력하므로 **스캐폴드 자체가 dirty로 잡힌다.**

### gitignore된 진입점을 감지하지 않는다

`assertEntrypointPathsUsable`(`bin/init.ts:227-244`)은 경로 중간 컴포넌트가 파일인지(ENOTDIR)만 검사한다. 저장소 전역에 `check-ignore|checkIgnore|isIgnored` 매치 **0건**. init은 `.gitignore`를 읽지도 쓰지도 않는다.

git 공식 문서 `gitignore(5)`: *"It is not possible to re-include a file if a parent directory of that file is excluded."* 따라서 사용자가 직관적으로 시도하는 `.claude` + `!.claude/skills/**`는 **동작하지 않는다.**

### staged diff 외부 전송이 문서화되어 있지 않다

`review-codex.ts:1144`가 `git diff --cached` 전문을 프롬프트에 싣고(`:127`), `adapters.ts:110`이 codex에 stdin으로 넘긴다. codex는 `--sandbox read-only`로 **repo 루트 전체**를 읽는다(`adapters.ts:147`). `assembleReviewPrompt`(`:90-130`)에 redact/truncate 없음. 저장소 전역 `redact|scrub|mask` 매치 0건. README·`AGENTS.template.md` 어디에도 고지 없음.

## 핵심 설계 결정

### DEC-011-1 — pm 문구는 "config 가용성"으로 갈라 처리한다 (D1 + D2 통합)

> **config 로드 이전(정적 템플릿·헤더 주석·early throw) → pm-중립 bare 표기.**
> **config 로드 이후(사용자 대면 안내·throw) → `buildScriptInvocation(cfg.packageManager, …)`으로 파생.**

두 결함을 하나의 규칙으로 덮는다. 부수 효과로 `DEFAULTS.packageManager = 'pnpm'`(`config.ts:87`)이 npm 프로젝트의 안내 문구로 새는 경로도 닫힌다 — 요청서가 제안한 "`DEFAULTS.packageManager`로 폴백"은 정확히 그 누수를 만들므로 **채택하지 않는다.** config 없이 문구를 만들어야 하는 지점은 bare로 쓴다.

bare 표기의 정본은 이미 `AGENTS.template.md:84-88`의 명령 표다(`req:new <slug> --run`). 진입점은 계약을 가리키는 **얇은 포인터**이므로 계약과 같은 표기를 쓰는 것이 옳다.

### DEC-011-2 — D1에 치환 렌더링을 쓰지 않는다 (요청서 1안 기각)

`bin/uninstall.ts:229-230`:

```ts
const match = existsSync(src) && sha256(dest) === sha256(src) ? 'identical' : 'differs'
```

`src` = 패키지 안의 템플릿 원본, `dest` = 대상 repo의 설치본. init이 pm별로 렌더하면 **두 바이트열은 절대 같아질 수 없다.** 결과:

- `plan.removable`(`uninstall.ts:380` = `match === 'identical'`)에 진입점이 들어가지 못한다 → uninstall이 자기가 깐 파일을 지우지 못하고 영원히 `review`로 남긴다.
- `mode` 산출(`:359-365`)이 왜곡된다.

이를 살리려면 uninstall도 동일한 `renderTemplate(src, pm)`으로 렌더한 뒤 비교해야 하고, 그러면 init·uninstall이 공유하는 **새 SSOT 축**(렌더러 + 토큰 목록)이 생긴다. 이 저장소가 `KIT_COPY_RELPATHS` / `KIT_SCHEMA_RELPATHS` / `package.json files[]` 세 축의 드리프트를 주석으로 경고하고 있는 이유가 바로 그 비용이다.

**bare 표기는 이 축을 만들지 않는다.** `copyFileSync` 그대로, byte-identity 그대로.

트레이드오프: 진입점 문서에서 복붙 즉시 실행되는 명령을 잃는다. 완화 — (a) init 콘솔의 "다음:" 안내가 이미 pm-aware이고, (b) `req:next`의 `RUN` 출력이 항상 정확한 명령을 준다(`req-next.ts:313,317`). 에이전트는 그 둘에서 정확한 형태를 얻는다. 진입점은 "형태"가 아니라 "궤도"를 가르치는 문서다.

### DEC-011-3 — `--`는 흡수하되 이후 인자는 계속 옵션으로 파싱한다

```ts
} else if (a === '--') {
  continue                     // POSIX end-of-options 마커. npm 사용자의 `-- <id>` 습관 흡수.
} else if (a.startsWith('-')) throw new Error(`알 수 없는 옵션: ${a}`)
```

엄격한 POSIX는 `--` 이후를 전부 위치인자로 본다. 그러나 이 도구에서는 **위험하다** — `req:commit 2026-011 -- --run`이 `--run`을 위치인자로 삼키면 사용자는 커밋했다고 믿지만 dry-run으로 끝난다. `continue`는 그 조용한 실패를 만들지 않고, 알 수 없는 **옵션**에 대한 throw도 유지한다.

### DEC-011-4 — clean-tree 게이트는 유지하고 안내를 고친다 (D4)

게이트를 화이트리스트로 뚫으면 (1) "무엇이 스캐폴드인가" 목록 유지 부채, (2) 그 파일들이 feature 브랜치에 untracked로 남아 D10에 구멍. 대신 안내에 커밋 단계를 넣고, 이미 막힌 사용자를 위해 `req-new.ts`의 clean-tree 에러에 한 줄을 덧붙인다.

### DEC-011-7 — 커밋 안내는 `git add -A`를 쓰지 않는다 (design 리뷰 R1 P2)

요청서가 제안한 `git add -A && git commit -m "chore: install commitgate"`를 **채택하지 않는다.**

brownfield repo는 정의상 기존 수정·미추적 파일을 갖고 있다. `git add -A`는 그것을 전부 담는다 — `.env`, 로컬 스크래치, 무관한 작업. 그 커밋이 REQ 브랜치의 base가 되고, 이어지는 `req:review-codex --run`은 **staged diff 전문을 외부(Codex/OpenAI)로 전송한다.** 즉 이 안내는 같은 REQ의 D8-B가 줄이려는 위험을 정확히 증폭시킨다.

init은 자기가 무엇을 썼는지 **정확히 안다**. 그 목록을 `git add`로 출력한다.

`git status` 확인 단계를 **명령의 일부로** 넣는다. 목록이 길어도 사용자가 한 번은 본다.

```
5. 설치분만 stage 하십시오. `git add -A` 는 쓰지 마십시오
   — brownfield repo의 무관한 변경·미추적 파일(.env 등)이 함께 커밋되고,
     이어지는 req:review-codex 가 staged diff 전문을 외부로 전송합니다.

     git add scripts/req/... workflow/... req.config.json package.json <lockfile>
     git status                       # 의도한 것만 staged 인지 눈으로 확인
     git commit -m "chore: install commitgate"
```

### DEC-011-9 — 설치 산출물은 **쓰기 전에** 계획으로 확정한다 (`InstallPlan` SSOT)

R1→R2→R3에서 **같은 결함이 세 번 다른 얼굴로 재발했다**: stage 목록에 `AGENTS.commitgate.md`가 빠졌고(R2), lockfile이 빠졌고(R3-P2), ignore 검사 대상과 stage 대상이 어긋났다(R3-P3). 뿌리는 하나 — **두 목록을 따로 손으로 관리했다.**

첫 시도는 `installedArtifacts(r: InitResult, pm)`이었으나 **성립하지 않는다**(R4-P2): `InitResult.copied`는 `copyInto`/`copyEntrypoints`가 **Apply 단계에서** 채운다. preflight의 ignore 검사가 그것을 볼 수 없다. 그것을 얻으려고 검사를 복사 뒤로 옮기면 `--strict`가 `scripts/req/**`·`req.config.json`·`package.json`을 이미 쓴 뒤에 throw하게 되어 "파일을 하나도 쓰지 않고 throw" 계약이 깨진다.

그래서 SSOT는 **쓰기 전에 계산되는 계획 객체**다.

```ts
export interface InstallPlan {
  copies: { srcAbs: string; destRel: string }[]  // 실제로 쓸 것(기존 파일 skip 반영)
  skips: string[]
  configRel: string | null        // req.config.json — 생성·병합 시
  packageJsonRel: string | null   // package.json — 주입 시
  lockfileRel: string | null      // LOCKFILE[pm] — 주입 시(install이 갱신)
  agentsRel: string | null        // AGENTS.md — 부재였을 때
  claudeMdRel: string | null      // CLAUDE.md — 부재였을 때
  contractCopyRel: string | null  // AGENTS.commitgate.md — 기존 AGENTS.md에 마커 없을 때
}

/** IO는 existsSync/readdirSync만. 어떤 쓰기보다 먼저 호출된다. */
export function planInstall(targetRoot: string, opts: InitOptions, pm: PackageManager): InstallPlan

/** 계획이 만들거나 수정할 repo-상대 경로 전수. ignore 검사와 stage 목록이 공유한다. */
export function planArtifactPaths(p: InstallPlan): string[]
```

소비처는 셋이고 **전부 같은 계획을 읽는다:**

1. **preflight** — `planArtifactPaths` → `findIgnoredArtifacts` → WARN 또는 `--strict` throw(쓰기 0건).
2. **apply** — `plan.copies`를 그대로 복사한다(`walkFiles` 재실행 없음). `copied`/`skipped`는 계획에서 파생.
3. **main() 안내** — `stageList = planArtifactPaths(plan) − gitIgnoredArtifacts`.

`LOCKFILE = { npm: 'package-lock.json', pnpm: 'pnpm-lock.yaml', yarn: 'yarn.lock' }` — `detectPackageManager`(`bin/init.ts:167-172`)와 같은 축이다. init이 `package.json`에 devDeps를 주입했으므로 안내 2단계의 `<pm> install`은 **반드시** lockfile을 바꾼다. 그것을 stage하지 않으면 커밋 후에도 `M pnpm-lock.yaml`이 남아 `req:new --run`이 clean-tree에서 죽는다.

`AGENTS.commitgate.md`는 병합용 임시 사본이지만 **stage 목록에 포함한다.** 대안(먼저 병합·삭제 후 stage)은 목록과 디스크 상태를 어긋나게 만들어 `git add <없는 경로>`가 fatal이 된다. 커밋한 뒤 병합·삭제하고 그 삭제를 **후속 커밋**으로 남기는 편이 결정적이다.

`InitResult`는 유지하되 `gitIgnoredArtifacts`·`preexistingDirtyPaths`를 추가한다.

### DEC-011-11 — 설치 전 워킹트리를 3분류하고, 안전할 때만 커밋 안내를 낸다 (design 리뷰 R4·R5)

stage 목록이 완벽해도 **D4의 실패 클래스가 남는다**(R4). 그리고 그 잔여를 "설치 커밋 뒤 stash하라"로 덮으려던 첫 시도는 **틀렸다**(R5):

1. **이미 staged된 변경은 `git commit`에 함께 들어간다.** 내가 `git add`를 아무리 명시해도, 커밋은 인덱스 **전체**를 담는다. `git add -A` 금지의 목적이 그대로 무너진다.
2. **산출물과 겹치는 기존 변경은 분리할 수 없다.** 사용자가 `package.json`을 고쳐 둔 상태에서 init이 같은 파일에 스크립트·devDeps를 주입하면, `git add package.json`은 두 변경을 **한 덩어리로** stage한다. 사후 분리는 불가능하다.
3. **`git stash`는 untracked를 stash하지 않는다.** `?? notes.txt`는 남아 clean-tree가 여전히 실패한다. `git stash -u`여야 한다.

그래서 preflight에서 **쓰기 전에** `git status --porcelain --untracked-files=all`을 찍고 3분류한다. 설치 후에 찍으면 CommitGate 산출물과 섞여 구분할 수 없다 — **쓰기 전에 찍는 것이 이 필드의 존재 이유다.**

```ts
export interface PreexistingDirty {
  staged: string[]       // 인덱스 ≠ HEAD (porcelain X 열이 공백·'?'가 아님)
  overlapping: string[]  // unstaged·untracked ∩ planArtifactPaths(plan)
  unrelated: string[]    // 나머지 (unstaged·untracked, 산출물과 무관)
}
```

| 분류 | 안전한가 | init의 행동 |
|---|---|---|
| `staged` 비어있지 않음 | ✗ 커밋이 그것을 삼킨다 | **`git add` 안내를 내지 않는다.** 이유를 밝히고 해소를 지시. `--strict`면 preflight throw(쓰기 0건) |
| `overlapping` 비어있지 않음 | ✗ 사후 분리 불가 | 〃 |
| `unrelated`만 있음 | ✓ 커밋은 인덱스만 담고, 그것들은 인덱스에 없다 | `git add <목록>` 안내 + 설치 커밋 **뒤** `git stash -u`(또는 별도 커밋) 단계 |
| 전부 비어있음 | ✓ | 평범한 `git add <목록>` 안내 |

`runInit`은 dirty repo에 설치하는 것 자체를 **막지 않는다**(기본 모드는 비파괴·비-breaking). 막는 것은 **안전하지 않은 안내를 내는 것**이다. 안내가 없으면 사용자는 `git status`를 보고 직접 판단한다 — 잘못된 안내보다 낫다.

```
⚠️  설치 전부터 워킹트리에 변경이 있어 안전한 커밋 안내를 만들 수 없습니다.

    staged (커밋에 함께 들어갑니다):
      M  src/foo.ts
    설치 산출물과 겹칩니다 (사후 분리 불가):
      M  package.json

    위를 커밋하거나 되돌린 뒤, `git status` 로 직접 확인하며 설치분만 커밋하십시오.
```

`unrelated`만 있을 때의 마지막 단계:

```
7. 설치 커밋 뒤, 아래 무관한 변경을 커밋하거나 `git stash -u` 하십시오
   (`req:new` 는 clean 워킹트리를 요구합니다. `-u` 없이는 untracked 가 남습니다):
      M  src/foo.ts
      ?? notes.txt
```

완료 기준도 이에 맞춰 정정한다 — clean 상태에서 시작한 repo에서는 안내를 순서대로 따르면 `req:new --run`이 통과한다. `unrelated`만 있으면 `git stash -u` 단계까지 포함해 통과한다. `staged`·`overlapping`이 있으면 **안내는 그 사실을 알리고 `git add` 목록을 내지 않는다.**

### DEC-011-10 — ignore 판정은 "ignored **그리고** untracked"일 때만 제외한다

`git add <path>`는 그 경로가 **ignored이면서 untracked**일 때만 fatal이다. tracked 파일은 ignore 규칙에 걸려도 add된다. `git check-ignore`는 인덱스를 보지 않으므로 단독으로 쓰면 tracked lockfile을 잘못 제외한다.

```
excluded(path) = checkIgnored(path) && !tracked(path)
```

`tracked(path)` = `git ls-files -- <path>` 출력 비어 있지 않음.

**심각도는 산출물 클래스로 가른다:**

| 클래스 | ignored일 때 |
|---|---|
| 계약 포인터 — 진입점 3종, `CLAUDE.md`, `AGENTS.md`, `AGENTS.commitgate.md` | **WARN + 동작하는 패턴 제시**. `--strict`면 throw. 설치 목적(팀·CI 공유)이 무력화되기 때문. |
| 그 외 — lockfile 등 | **조용히 stage 목록에서 제외.** lockfile을 무시하는 것은 합법적 repo 정책이다(라이브러리 등). 경고할 일이 아니다. |

`git check-ignore`는 파일이 존재하지 않아도 규칙 매칭이므로 lockfile이 아직 없어도(첫 `npm install` 전) preflight에서 판정할 수 있다.

### DEC-011-8 — 안내 명령에 shell 연산자를 쓰지 않는다 (design 리뷰 R1 P2)

`&&`는 Windows PowerShell 5.1과 `cmd.exe`에서 동작하지 않는다. 이 저장소는 PowerShell 5를 **명시 대상으로 인정**한다(`scripts/req/lib/config.ts:153`의 BOM 방어 주석, `README.md:230`의 PowerShell 절).

기존 `bin/init.ts:613`의 `cd ${targetRoot} && ${pm} install`이 이미 그 문제를 갖고 있다. phase-5에서 함께 고친다 — 각 명령을 **개별 줄**로 출력하고 연산자를 쓰지 않는다.

```
1. cd <targetRoot>
2. <pm> install
```

### DEC-011-5 — check-ignore는 preflight에서, exit code로 판정한다 (D5)

`git check-ignore -q -- <path>`의 종료코드: `0` = 무시됨, `1` = 무시 안 됨, `128` = 오류. **`128`은 "무시 안 됨"으로 취급**한다(오탐으로 설치를 막지 않는다 — git 버전차·비정상 상태에서 안전).

검사 대상은 진입점이 아니라 **`planArtifactPaths(plan)` 전체**다(DEC-011-9). 진입점만 검사하면 `AGENTS.commitgate.md`·lockfile이 빠져 안내의 `git add`가 fatal이 된다(design 리뷰 R3 P3).

preflight에 두는 이유: `--strict`가 **아무 파일도 쓰기 전에** throw해야 부분 설치가 없다. `assertEntrypointPathsUsable`이 이미 그 자리에 있으므로 바로 뒤에 붙인다. `git check-ignore`는 파일이 존재하지 않아도 규칙 매칭이므로 쓰기 전에 판정 가능하다.

`agentsContractCopyCreated`는 preflight(`bin/init.ts:464-472`)에서 이미 계산되므로 검사 시점에 알 수 있다. lockfile 경로는 `pm`에서 파생되므로 존재 여부와 무관하다.

경고 문구는 **동작하는 패턴을 제시**해야 한다. 부모 디렉터리 제외 시 하위 부정패턴이 무효라는 함정 때문이다(palm-backend에서 검증된 문구를 그대로 쓴다).

### DEC-011-6 — D8-B는 고지이지 방어가 아니다

`preReviewCommand` 훅(D8-A)은 후속 REQ다. 이번엔 **사용자가 사전에 알아야 할 사실**만 문서화한다. 방어 없이 고지만 넣는 것이 방어까지 미루는 것보다 낫다 — 모르고 보내는 것이 가장 큰 위험이기 때문이다.

## Phase별 구현

| phase | 결함 | 변경 |
|---|---|---|
| `phase-1-external-transmission-notice` | D8-B | `README.md`·`README.en.md`·`AGENTS.template.md`에 외부 전송 고지 |
| `phase-2-pm-neutral-templates` | D1 | `templates/*` 4종 bare화 + 회귀 가드 테스트 |
| `phase-3-pm-derived-runtime-strings` | D2 | 런타임 문구 파생/bare화 + 테스트 |
| `phase-4-end-of-options` | D3 | `parseArgs` 4종 + 테스트 |
| `phase-5-install-plan-and-gitignore` | D5 | `InstallPlan` 추출 + `findIgnoredArtifacts` preflight + `InitResult.gitIgnoredArtifacts`·`preexistingDirtyPaths` + 테스트 |
| `phase-6-install-guidance` | D4 | init 안내에 커밋 단계(`planArtifactPaths` − `gitIgnoredArtifacts`), 설치 전 dirty 처리 단계, clean-tree 에러 힌트, README Quick Start |
| `phase-7-docs-version` | — | CHANGELOG·버전 `0.4.0` → `0.5.0` |

phase 2·3은 파일이 겹치지 않는다(정적 템플릿 vs 런타임 스크립트). phase 3·4는 같은 4개 스크립트를 만지므로 **순차**로 둔다.

**phase 5가 6보다 먼저인 이유**(design 리뷰 R2·R4에서 파생): phase-6의 stage 목록은 `InstallPlan`과 `gitIgnoredArtifacts`·`preexistingDirtyPaths`를 입력으로 받는다. 셋 다 phase-5가 도입한다. 반대 순서면 phase-6이 존재하지 않는 것을 가정하게 된다.

## 변경 파일

```
templates/claude-command.md          phase-2
templates/claude-skill.md            phase-2
templates/cursor-rule.mdc            phase-2
templates/CLAUDE.template.md         phase-2
scripts/req/req-next.ts              phase-3, phase-4
scripts/req/req-new.ts               phase-3, phase-4, phase-6
scripts/req/req-doctor.ts            phase-3, phase-4
scripts/req/req-commit.ts            phase-4          (D3만 — pm 리터럴 없음)
scripts/req/review-codex.ts          phase-3          (D2만 — parseArgs가 throw하지 않아 D3 비대상)
bin/init.ts                          phase-5, phase-6
AGENTS.template.md                   phase-1
README.md                            phase-1, phase-6
README.en.md                         phase-1, phase-6
tests/unit/init.test.ts              phase-2, phase-5, phase-6
tests/unit/req-args.test.ts (신규)   phase-4
package.json / CHANGELOG.md          phase-7
```

phase당 코드 변경 8파일 이하 — D18 WARN 없음.

## 하위호환·안전

- **D1·D2**: 문구만 바뀐다. 실행 경로 불변. 기존 설치본은 `copyFileSync` skip-if-exists라 영향 없다(`--force` 재설치 시에만 갱신).
- **D3**: 순수 확장. 이전에 throw하던 입력이 이제 통과한다. **역방향 회귀 없음** — 이전에 통과하던 입력의 동작은 그대로다. 알 수 없는 옵션 throw 유지.
- **D4**: `console.log` 문구 + 에러 메시지 추가. 동작 불변. 기존 `bin/init.ts:613`의 `cd … && … install`을 개별 줄로 분리하는 것도 **출력 문자열만** 바뀐다(DEC-011-8).
- **D5**: 새 preflight 검사. **기본 모드는 경고만**(설치는 계속)이므로 기존 사용자 동작 불변. `--strict`에서만 throw가 늘어난다 — `--strict`의 계약이 "보안·정합 하한 미달이면 중단"이므로 의미상 일관.
- **D8-B**: 문서만.
- `req.config.json` 스키마 불변 → `tests/unit/req-config.test.ts:296`의 이중 사본 동등성 가드에 영향 없음.
- 버전: 새 경고·새 파서 수용 → **minor** `0.5.0`. breaking 없음.

### 검증

- `npm test`(vitest) 그린, `npm run typecheck` 그린.
- phase-5(D5) 자동 검증: `.claude` 통짜 무시 임시 repo → `runInit` 경고. `--strict`에서는 **init 전/후 전체 파일 스냅샷(경로 + sha256)이 동일**함을 단언한다 — 신규 0개·수정 0개. `.claude/`·`scripts/req/` 부재만 보면 `req.config.json`·`package.json`을 먼저 쓰고 나중에 throw하는 구현을 놓친다.
- phase-6(D4) 자동 검증: `planArtifactPaths()`가 `AGENTS.commitgate.md`(마커 부재 시)와 `LOCKFILE[pm]`을 포함하고, `stageList`가 ignored∧untracked 경로를 제외한다. 안내 문자열에 `git add -A`·`&&`가 없고, `preexistingDirtyPaths`가 있으면 그 처리 단계가 포함된다.
- phase-6 통합 검증: 기존 `AGENTS.md`(마커 없음) + 기존 lockfile을 둔 임시 repo → `runInit` → lockfile 수정을 모사(실제 network install 없이) → 안내의 `git add` 목록대로 stage·commit → `git status --porcelain`이 **빈 문자열**.
