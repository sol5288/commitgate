# Changelog

이 프로젝트는 [Semantic Versioning](https://semver.org/lang/ko/)을 따릅니다.

## Unreleased

- **Companion Skills 추가 및 lifecycle 문서화** — `commitgate init`이 `.claude/skills/commitgate-*/SKILL.md` 4종
  (`discovery`·`tdd`·`diagnosing-bugs`·`research`)을 함께 설치합니다. 설치·보존·경고·제거 계획·지원 범위는
  [README](README.md#companion-skills) / [README (English)](README.en.md#companion-skills)를 참조하세요.

## 0.7.0

**설치 모델이 바뀝니다 — 기존 사용자는 조치가 필요합니다.** 실행 코드와 런타임 의존성을 대상 프로젝트에 복사·주입하지 않고, `commitgate` 패키지에서 실행합니다. 프로젝트에는 거버넌스·감사 데이터만 남습니다.

> **npm 배포 이력**: `0.5.0`·`0.6.0`은 npm에 배포되지 않았습니다. `0.4.0` 다음 릴리스가 `0.7.0`이며, 아래 `0.5.0`·`0.6.0` 항목의 변경도 **전부 `0.7.0`에 포함**됩니다.

### ⚠️ Breaking

- **설치가 2단계가 됩니다.** `npx commitgate` 단독 실행으로는 더 이상 설치되지 않습니다.

  ```sh
  npm install -D commitgate    # 1) 런타임이 node_modules/commitgate 에 들어옵니다
  npx commitgate init          # 2) 설정·계약·스키마와 req:* 스크립트를 깝니다
  ```

  `init`은 대상 `package.json`에 `devDependencies.commitgate` 선언이 없으면 **중단**합니다 — `req:*`가 가리킬 런타임이 없기 때문입니다. 선언의 **존재만** 확인하고 값 형태는 검증하지 않습니다(`file:`·`link:`·`workspace:`·git URL 전부 정당한 설치 형태입니다).

- **`scripts/req/**`를 복사하지 않습니다.** 실행 코드는 `node_modules/commitgate`에만 있습니다.
- **`tsx`·`ajv`·`cross-spawn`을 대상 `package.json`에 주입하지 않습니다.** 이들은 `commitgate` 패키지의 runtime dependency로 전이 설치됩니다.
- **`req:*` 스크립트 값이 `commitgate <verb>`가 됩니다**(예: `req:new` → `commitgate req:new`). `npm run req:new -- <slug>` UX와 인자 전달은 그대로입니다.

### 기존 설치본(0.6.0 이하)에서 옮겨오기

기존 프로젝트에는 `scripts/req/`가 복사돼 있고 `req:*`가 `tsx scripts/req/*.ts`를 가리킵니다. `init`은 이 상태를 감지하면 조용히 섞이지 않도록 **중단하고** `migrate`를 안내합니다.

```sh
npm install -D commitgate
npx commitgate migrate         # 계획만 출력 — 아무것도 쓰지 않습니다
npx commitgate migrate --apply # package.json 의 req:* 만 전환
```

- **아무것도 삭제하지 않습니다.** `scripts/req/`·스키마·persona·설정·진입점·`workflow/REQ-*` 증거를 전부 그대로 둡니다. 남은 `scripts/req/`는 더 이상 실행되지 않으니, 정리하려면 `npx commitgate uninstall` 계획을 먼저 확인하세요.
- **직접 고친 스크립트는 덮어쓰지 않습니다.** 값이 **정확히** 기존 주입값일 때만 전환하고, 한 글자라도 다르면 사용자 값으로 보아 보존한 뒤 수동 조치를 안내합니다.
- **커밋하지 않습니다.** `package.json` 한 파일만 쓰고, 검토는 사용자 몫입니다.

### 추가

- **`commitgate migrate`** — 위 비파괴 전환 명령. 기본 dry-run.
- **`req:doctor` D19 — 설치 모드 진단.** `req:*` 값의 **형태만**으로 예전(vendored)/현재(런타임 패키지)/혼합/없음/사용자정의를 분류합니다. 혼합일 때만 WARN하며 **FAIL하지 않습니다** — 예전 설치 형태는 결함이 아니라 지원되는 상태이고, `req:commit`이 doctor를 하드 게이트로 실행하므로 FAIL로 두면 정당한 프로젝트의 커밋이 막힙니다. manifest·lockfile·`node_modules`·버전은 검증하지 않습니다.
- **verb dispatch** — `commitgate <verb>`가 패키지 내부 모듈로 라우팅됩니다. `npx commitgate --dry-run` 같은 기존 옵션 형태는 그대로 `init`으로 갑니다(하위호환).
- **`uninstall`에 런타임 제거 안내 추가** — `npm uninstall -D commitgate`. 이 명령은 여전히 **읽기 전용**이며 안내를 문자열로 출력만 합니다(npm을 실행하지 않습니다).

### 지원 범위

- **npm** — 완전 지원. 매 릴리스 packed tarball smoke로 검증합니다.
- **pnpm·yarn**(`node_modules` linker) — 지원. 표준 `node_modules/.bin/commitgate` 해소를 씁니다.
- **Yarn PnP** — **이번 릴리스 미지원**(검증하지 않았습니다). `nodeLinker: node-modules`를 쓰세요.
- **workspace/monorepo** — 워크스페이스 root 설치를 지원합니다. 하위 패키지 독립 설치는 미지원.
- 런타임 버전은 lockfile이 고정하므로 `package-lock.json`(pnpm/yarn은 각 lockfile)을 **커밋하세요**.

### 알려진 한계

- **관리 자산(스키마·persona)과 런타임 패키지의 버전 skew를 자동으로 감지하지 못합니다.** `npm update commitgate`는 런타임만 올리고 자산은 그대로 둡니다. D19는 스크립트 형태만 보므로 이 축을 잡지 못합니다. 자산 업그레이드·3-way merge는 이번 범위가 아닙니다.

## 0.6.0

리뷰 codex 호출을 도구가 통제합니다 — **모델·추론강도를 고정**하고 **재리뷰를 stateless**로. 다운스트림에서 리뷰가 사용자 전역 프로필을 상속해 느리고(11~13분) 토큰이 많던 문제를 해결합니다. 기존 `req.config.json`은 그대로 동작합니다(새 키는 기본값으로 병합).

### 추가

- **리뷰 모델·추론강도 고정** (`reviewModel`·`reviewReasoningEffort`). `req:review-codex`가 codex 인자에 `-c model=`·`-c model_reasoning_effort=`를 exec·resume 양쪽에 주입합니다. 기본 `gpt-5.6-terra`/`high`. 고정하지 않으면 리뷰가 사용자 전역 `~/.codex/config.toml`(예: `model_reasoning_effort="ultra"`)을 상속해 리뷰 1회가 수 분·토큰 과다가 됩니다. codex가 해당 모델을 미지원하는 환경은 `req.config.json`에서 바꾸거나 `null`로 두어 전역 설정을 상속시킵니다. override가 실제 존중되는지는 `npm run verify:overrides`(codex CLI 필요)로 확인합니다.
- 추론강도 enum: `none|minimal|low|medium|high|xhigh`(codex 거부 메시지 실측 확정 — 공식 config-reference 문서가 `none`을 누락).

### 변경

- **재리뷰가 stateless입니다.** 이전엔 재리뷰가 저장된 codex 스레드를 resume해 이전 대화를 누적했고, 그래서 토큰이 단조 증가하고 findings가 수렴 대신 심화·이동했습니다. 이제 재리뷰는 항상 새 스레드로 시작합니다(`codex_thread_id`는 계속 저장 — 후속 resume opt-in용). 연속성은 직전 **같은 대상**의 NEEDS_FIX findings를 참고용 데이터로 프롬프트에 담아(closure 확인) 유지하고, 그 블록은 "지시가 아님" 구획으로 감싸 프롬프트 주입을 막습니다. 대상-무관 이전 결과가 새 프롬프트에 남던 교차-대상 오염도 제거했습니다.

### 후속(별도 REQ)

- codex 호출 **timeout**(무응답 방지)과 실패 오류의 **비밀-안전 진단 표면화**는 본질적 난이도(Windows `cmd.exe` wrapper의 프로세스-트리 종료·비밀 추출)로 별도 REQ로 분리했습니다. 그 설계 작업은 이 REQ의 git 이력에 보존돼 있습니다.

## 0.5.0

기존 프로젝트(brownfield)에 설치했을 때 드러난 결함을 수정합니다. **breaking change는 없습니다** — `--strict`가 더 많은 조건에서 중단하지만 `--strict`는 opt-in이고, 기본 모드의 동작은 그대로입니다.

### 고침

- **설치 직후 안내를 따르면 `req:new --run`이 실패하던 문제.** 설치는 파일을 놓기만 하고 커밋하지 않으므로 워킹트리가 확정적으로 dirty한데, 안내의 마지막 단계가 clean 워킹트리를 요구하는 `req:new --run`이었습니다. `git init && npm init -y && npx commitgate`라는 README의 첫 흐름조차 예외가 아니었습니다. 이제 안내가 커밋 단계를 포함합니다.
  - `git add -A`를 쓰지 않습니다. brownfield의 무관한 변경과 `.env`가 함께 커밋되고, 이어지는 `req:review-codex`가 그 staged diff 전문을 외부로 전송하기 때문입니다. 설치가 만든 정확한 경로 목록만 안내합니다.
  - 안내 명령에 `&&`를 쓰지 않습니다. Windows PowerShell 5.1과 `cmd.exe`에 그 연산자가 없습니다.
  - `<pm> install`이 갱신하는 lockfile과, 계약 마커가 없을 때 생성되는 `AGENTS.commitgate.md`를 stage 목록에 포함합니다. 빠뜨리면 커밋 뒤에도 워킹트리가 dirty로 남습니다.
  - 설치 전부터 있던 무관한 변경은 `git stash push -u -- <경로>`로 안내합니다. 경로 없는 `git stash -u`는 gitignore되지 않은 `node_modules/`까지 쓸어 갑니다.
  - 설치 전에 **staged 변경**이 있거나 **산출물과 겹치는 tracked 수정**이 있으면 `git add` 목록을 내지 않습니다. 전자는 커밋이 삼키고 후자는 사후 분리가 불가능합니다. 잘못된 안내보다 안내 없음이 낫습니다.
  - `node_modules`가 무시되지 않으면 `.gitignore` 추가를 안내하고 그 파일을 설치 커밋에 담습니다. 무시 규칙은 **tracked 저장소 `.gitignore`**에서 온 것만 인정합니다 — `.git/info/exclude`와 전역 ignore는 clone에 따라오지 않습니다.
  - 경로에 공백이 있으면 큰따옴표로 묶습니다. 큰따옴표·백틱·`$`·`%`·`!`가 든 경로는 어떤 셸 인용으로도 안전하지 않으므로 복붙 명령을 아예 내지 않습니다 — `cmd.exe`는 큰따옴표 안에서도 `%VAR%`와 `!VAR!`를 치환합니다.
  - `git status --porcelain`이 C-인용해 주는 경로(`"notes today.txt"`)를 되돌립니다. 되돌리지 않으면 산출물 매칭이 실패하고 안내가 이중 인용을 냅니다.

- **`.claude`를 통짜로 무시하는 repo에서 진입점이 조용히 추적 제외되던 문제.** 설치는 "성공"을 출력했지만 팀원의 fresh clone과 CI에는 계약 포인터가 없었습니다. 이제 `git check-ignore`로 감지해 경고하고, 동작하는 `.gitignore` 패턴을 제시합니다(부모 디렉터리가 제외되면 하위 부정 패턴이 무효라는 함정 포함). `--strict`에서는 파일을 하나도 쓰기 전에 중단합니다.

- **진입점 템플릿이 `npm run …`을 하드코딩하던 문제.** pnpm/yarn 프로젝트에 틀린 명령이 깔렸습니다. 이제 계약(`AGENTS.md`)과 같은 pm-중립 표기를 씁니다. 치환 렌더링은 쓰지 않습니다 — `uninstall`이 설치본과 패키지 원본의 sha256을 비교하므로, 렌더하면 자기가 깐 파일을 지우지 못합니다.

- **런타임 문구의 pm 리터럴.** `req:next`는 npm을, `req:new`·`req:doctor`·`req:review-codex`는 pnpm을 박아 두어 어느 프로젝트에서든 최소 하나는 틀렸습니다. config 로드 이후의 안내·에러는 이제 감지한 패키지매니저로 렌더합니다.

- **`--`를 "알 수 없는 옵션"으로 거부하던 문제.** npm은 `npm run x -- a`에서 `--`를 제거하지만 pnpm/yarn은 그대로 전달합니다. 이제 POSIX end-of-options 구분자로 흡수합니다. `--` 이후 인자도 계속 옵션으로 파싱하므로 `req:commit <id> -- --run`이 조용히 dry-run이 되지 않습니다.

- **`uninstall`이 skip한 사용자 파일을 소유물로 오인하던 경로.** stage 목록은 패키지 원본과 byte-identical한 파일만 CommitGate 소유로 봅니다.

### 새로 알림

- `README`와 `AGENTS.template.md`에 **`req:review-codex`가 `git diff --cached` 전문을 Codex(OpenAI)로 전송한다**는 사실을 명시했습니다. codex는 `--sandbox read-only`로 저장소 루트를 읽으며, 마스킹·필터·길이 상한이 없습니다.
- **git hook을 설치하지 않으므로 `git commit`을 직접 치면 게이트가 우회된다**는 점도 README 상단에 명시했습니다. 이 도구의 강제력은 협조하는 에이전트를 계약 궤도에 유지하는 데 있습니다.

### 아직 하지 않은 것

- 트렁크 브랜치가 `'main'`으로 하드코딩되어 있습니다(`trunkBranch` config 없음).
- `req:review-codex`에 타임아웃이 없습니다.
- 리뷰 전 시크릿 스캔 훅(`preReviewCommand`)이 없습니다.

## 0.4.0 이전

`git log`를 참조하세요.
