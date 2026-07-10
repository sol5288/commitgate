# REQ-2026-012 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

### clean-tree 검사가 네 곳에 서로 다르게 있다

| 위치 | 명령 | scratch 예외 | staged(`M `) |
|---|---|---|---|
| `req-new.ts:154` | `status --porcelain` | 없음 | 위반 |
| `req-next.ts:624-628` | `status --porcelain -uall` | 고정 3종 | 통과 |
| `req-doctor.ts:497-501` | 〃 | 고정 3종 + 현재 티켓 응답 아카이브 | 통과 |
| `review-codex.ts:1198` | 〃 | 고정 3종 | 통과 |

뒤의 셋은 `findUnstagedOrUntracked`(`review-codex.ts:855`)를 공유한다. 그 함수는 이름 그대로 **unstaged 또는 untracked**만 flag한다 — `return x === '?' || y !== ' '`(`:876`). staged이고 워킹트리가 clean한 `M `는 통과시킨다. `req:new`는 그것도 막아야 하므로 **이 함수를 재사용할 수 없다.**

### porcelain 파서가 셋이다

- `bin/init.ts:266` `parsePorcelainLine` — 비-export. `unquoteGitPath`(`:232`, export) 사용. rename은 dest만.
- `req-doctor.ts:197` `statusPaths` — export. rename은 src·dest 둘 다. 인용 해제 없음.
- `review-codex.ts:864-877` — 인라인. rename 둘 다. 인용 해제 없음.

`core.quotePath=false`는 비-ASCII 인용만 끈다. `"`·`\`·제어문자가 든 경로는 여전히 C-인용되므로 뒤의 둘이 오분류한다.

### scratch 정의가 셋이다

`codex-response.json` · `.review-preview.txt` · `state.json` 이 세 곳에 각각 리터럴로 적혀 있다. `.gitignore`에는 `.review-preview.txt`와 `.codex-*.tmp`만 있고 `codex-response.json`이 빠져 있다.

## 핵심 설계 결정

**D1. 근본 수정은 `.gitignore` 한 줄이다.** `workflow/**/codex-response.json`을 scratch 블록에 넣는다. `git status`는 `--ignored` 없이는 ignored 파일을 내지 않으므로(플래그 조합과 무관) `req-new.ts`의 검사는 이 파일을 더 이상 보지 않는다.

**D2. Phase 순서를 초안과 반대로 한다.** 파서·scratch SSOT 추출이 먼저다. `req:new`의 새 술어가 그 산출물을 import하기 때문이다. 초안은 "`review-codex.ts`의 기존 `parsePorcelainLine` 재사용"이라 적었으나 그 이름은 거기 없다(`bin/init.ts`의 비-export 함수다). 순서를 뒤집지 않으면 구현자가 네 번째 파서를 손으로 쓴다.

**D3. 사용자 소유 `.gitignore`를 편집하지 않는다.** `init`은 지금도 `.gitignore`에 쓰지 않는다(`init.ts:473`). 쓰기 시작하면 (a) `AGENTS.md`/`CLAUDE.md`와 공유하는 비파괴 계약, (b) `gitignoreJoinsInstall`(`:394-397`)이 모르는 사이 `.gitignore`가 artifacts에서 빠져 `stageList`가 어긋나는 문제, (c) 라인 append에 무력한 sha256 멱등 dedup — 셋을 동시에 깬다.

**D4. 대신 `<ticketRoot>/.gitignore`를 kit 파일로 신설한다.** 중첩 `.gitignore`는 git의 정식 기능이고, `init`은 이미 대상 repo의 `workflow/` 안에 파일을 복사한다(`KIT_COPY_RELPATHS` = 스키마 2종 + `review-persona.md`). 사용자 `.gitignore`는 손대지 않는다.

**축을 나눠서 탄다.** `artifacts` → `stageList`, `uninstall`의 소유권 분류는 기존 축을 공유한다. 그러나 **복사 결정은 `add()`를 타지 않는다**(D12).

- `add()`의 skip-if-exists는 `existsSync(destAbs) && !force` — **`--force`면 무효**다(`init.ts:534`). D12는 `--force`에서도 보존을 요구하므로 자동으로 얻어지지 않는다.
- `ownedSkips`(바이트 동일 판정)는 `add()`의 skip 분기 안에서만 채워진다(`init.ts:536-538`). 별도 분기를 쓰면 **직접 채워야 한다** — 그러지 않으면 직전 실행이 깐 바이트 동일 파일이 `stageList`에서 빠져(`init.ts:458-461`의 근거), 커밋 전 두 번 실행한 사용자의 워킹트리가 dirty로 남는다.
- 멱등성은 별도 분기의 `existsSync` 검사로 보장한다. "무료"가 아니라 **명시적 요구사항**이다.

이 파일은 `.gitignore`라는 이유로 사용자 소유이면서(D12: 절대 덮지 않음) 동시에 도구가 심는 산출물이다(uninstall이 `identical`일 때 제거 대상으로 분류). 두 성질이 공존한다 — `AGENTS.md`가 정확히 같은 위치에 있다.

**D5. npm이 `.gitignore`를 tarball에서 지우므로 `src ≠ dest`로 싣는다.** 재현으로 확인했다 — `files[]`에 넣어도 제외된다. 패키지에는 `templates/workflow.gitignore`로 두고 대상의 `workflow/.gitignore`로 복사한다. `KIT_AGENT_ENTRYPOINTS`(`init.ts:67-70`)가 이미 쓰는 패턴이다.

> ⚠️ `KIT_COPY_RELPATHS`(src=dest)와 `KIT_AGENT_ENTRYPOINTS`(src≠dest)는 복사기와 uninstall planner에서 **다르게 다뤄진다**(`init.ts:60-64`). 새 파일은 후자 축에 넣어야 한다.

**D5-1. 중첩 `.gitignore`의 패턴은 그 파일 기준 상대 경로다 — 루트용 문자열을 그대로 복사하면 무효다.** `gitignore(5)`: 패턴 중간이나 앞에 슬래시가 있으면 **그 `.gitignore` 파일이 있는 디렉터리 기준**으로 해소된다. 실측:

| `workflow/.gitignore` 안의 패턴 | `workflow/REQ-2026-001/codex-response.json` |
|---|---|
| `workflow/**/codex-response.json` | **매칭 안 됨** (`workflow/workflow/...`를 찾는다) |
| `**/codex-response.json` | 무시됨 |
| `codex-response.json` | 무시됨 (슬래시 없는 패턴은 하위 모든 깊이에 매칭) |
| `/REQ-*/codex-response.json` | 무시됨 |
| (대조) **루트** `.gitignore`의 `workflow/**/codex-response.json` | 무시됨 |

따라서 두 파일은 **서로 다른 패턴 형태**를 갖는다. 루트 `.gitignore`(Phase 2 항목 1)는 `workflow/**/…`를, kit 파일 `templates/workflow.gitignore`(항목 2)는 `/REQ-*/…`를 쓴다. 후자를 **앵커드 형태**로 고른 이유는 fail-closed 정합이다 — `**/codex-response.json`은 티켓 디렉터리 밖에 흘러든 동명 파일까지 조용히 숨기지만, `/REQ-*/…`는 티켓 직계만 숨긴다.

중첩 `.gitignore`는 **untracked 상태에서도 동작한다**(실측). 그러나 팀원의 fresh clone과 CI에는 따라가지 않으므로 설치 커밋에 반드시 포함돼야 한다 — D4의 `artifacts` → `stageList` 자동 편입이 이것을 보장한다.

**D6. `req:new`의 코드 레벨 예외는 레거시 방어선이다.** D1이 적용된 repo에서는 두 scratch 파일이 porcelain에 아예 나타나지 않으므로 이 술어는 발화하지 않는다(재현 확인). 실효 조건은 gitignore 규칙이 없는 0.1.0–0.4.0 설치본이다. 그래도 유지한다 — 그 설치본들은 업그레이드해도 `.gitignore`를 자동으로 얻지 못한다(D3).

**D7. 예외 술어.** `parseStatusZ`가 낸 `StatusEntry` 중 다음을 **모두** 만족하는 것만 무시한다.

- `index === '?' && worktree === '?'` (untracked). ` M`·`M `·`A `·`R `·` R`·`AM`·`MM`는 무시하지 않는다. untracked 엔트리는 정의상 `origPath`를 갖지 않는다.
- `path`가 `<ticketRoot>/REQ-<4자리>-<숫자>/<basename>` 이고 `<basename>` ∈ {`codex-response.json`, `.review-preview.txt`}.

매칭은 **문자열 세그먼트 분해**로 한다(정규식 보간 금지 — 저장소 관례는 `startsWith`/`slice`/`includes`다). 그 외 **모든** 엔트리는 위반이다. 위반 판정은 `findUnstagedOrUntracked`가 아니라 "허용 목록에 없는 모든 엔트리"다(D 현재상태 §1의 `M ` 통과 문제).

**D8. `state.json`과 `responses/**`는 `req:new`에서 제외하지 않는다.**

- `state.json`은 **tracked**다(11개 티켓 전부 커밋됨). `req:new`는 main에서 clean 트리로 시작하므로, 수정된 `state.json`은 미커밋 워크플로 상태다. 제외하면 새 브랜치로 딸려 간다.
- `isAllowedResponsesScratch(line, ticketRel)`은 **현재 티켓** 기준이다. `req:new`는 티켓 생성 전이라 `ticketRel`이 없다. 적용하려면 "아무 티켓의 untracked 아카이브"를 허용해야 하는데 그것이 정확히 증거 변조 구멍이다.

즉 `req:new`의 예외 집합은 나머지 세 곳의 **진부분집합**이다. 셋을 같은 목록으로 통일하면 안 된다.

**D9. 안전 근거 — 이 예외는 승인을 부여하지 않는다.** 적대 검증에서 확인했다. 위조된 `codex-response.json`을 심어 두고 `req:new`를 통과시켜도, `buildInitialState`가 `commit_allowed:false`인 새 state를 쓰고(`req-new.ts:167`) 갓 만든 티켓 디렉터리만 stage한다(`:185`). 승인은 `state.json`의 `commit_allowed=true` + `approval_evidence`로만 흐르며 `req:commit`이 `commit_allowed !== true`면 throw한다(`req-commit.ts:758`). 승인 바인딩은 git `write-tree`(content-addressed)라 porcelain 우회에 면역이다. 이미 승인된 티켓의 live 응답 변조는 D-016-5가 잡는다(`req-doctor.ts:183`).

**D10. `--untracked-files=all` 추가의 근거는 "다른 게이트와의 인자 정합"이다.** 초안이 든 "디렉터리 collapse 제거"는 거짓이다 — 기존 티켓 디렉터리는 항상 tracked 파일을 포함하므로 collapse가 발생하지 않는다.

**모든 호출부의 git 명령은 단일 형태로 통일한다** — `git status --porcelain=v1 -z --untracked-files=all`. `-c core.quotePath=false`는 전부 뗀다(D11: `-z`에서 무의미). Phase 1·3의 어느 문서에도 다른 형태가 남으면 안 된다.

**D11. porcelain을 `-z`(NUL 구분)로 읽는다. C-인용 문제가 존재하지 않게 된다.** (design R1 P2-1)

초안의 Phase 1 계약은 자기모순이었다 — "`paths`는 unquote된 값만 반환" + "기존 `statusPaths`·`findUnstagedOrUntracked`의 동작을 한 케이스도 바꾸지 않는다"는 C-인용 경로에서 양립할 수 없다. `?? "a\\b.txt"`에서 기존 `statusPaths`는 `"a/b.txt"`(따옴표 포함, 역슬래시가 뭉개진 값)를 반환하는데, 디코드된 `a\b.txt`로부터 그 값을 재구성할 방법이 없다. 게다가 경로 자체에 ` -> `가 들어가면 delimiter 분할이 깨진다.

`--porcelain=v1 -z`가 이 딜레마를 제거한다. 실측:

| | 출력 |
|---|---|
| `--porcelain` (quotePath=true) | `R  renamed-from.txt -> "renamed to.txt"` |
| `--porcelain -z` | `R  renamed to.txt\0renamed-from.txt\0` |

- **인용이 발생하지 않는다.** `core.quotePath` 설정과 무관하다 → `-c core.quotePath=false`를 뗄 수 있다.
- **rename은 `<NEW>\0<OLD>\0`** — ` -> ` 형태(`old -> new`)와 **순서가 반대**다. 이 함정을 파서 주석과 테스트로 고정한다.
- 경로 안의 ` -> `가 더 이상 delimiter가 아니다.

**D11-1. `R`/`C`는 index 열(X)과 worktree 열(Y) **양쪽**에 온다.** (design R2 P2)

`git-status(1)`의 short-format 표는 `[ D] R`(worktree에서 rename됨)과 `[ D] C`(worktree에서 copy됨)를 명시한다. 실측(git 2.46.0):

| 시나리오 | `--porcelain` | `--porcelain -z` | X / Y |
|---|---|---|---|
| `git mv a b` | `R  a.txt -> b.txt` | `R  b.txt\0a.txt\0` | `R` / ` ` |
| 위 + worktree 수정 | `RM a.txt -> b.txt` | `RM b.txt\0a.txt\0` | `R` / `M` |
| `mv a c` + `git add -N c` (삭제 미-stage) | ` R a.txt -> c.txt` | ` R c.txt\0a.txt\0` | ` ` / **`R`** |

두 열 모두에서 추가 필드를 소비한다. **X만 검사하는 파서는 `a.txt`를 독립 레코드로 오인**하고 `origPath`를 잃는다.

이것은 스타일 문제가 아니라 **보안 회귀**다. `findUnstagedOrUntracked`(`review-codex.ts:869-875`)와 `statusPaths`(`req-doctor.ts:197`)는 rename의 src·dest를 **둘 다** 검사해 "비허용 경로 → 허용 경로 rename으로 코드 삭제·`responses/` 주입을 우회"하는 것을 막는다(주석 A2-P2-1). `origPath`가 소실되면 그 차단이 뚫린다.

파서 계약:

- `isRenameOrCopy = X ∈ {R,C} || Y ∈ {R,C}` → 다음 NUL 필드를 `origPath`로 하나 더 소비.
- 소비할 필드가 없으면(truncated 레코드) **throw**한다. `undefined`를 흘려보내지 않는다 — fail-closed.
- 레코드 형식이 `XY<space><path>`가 아니면 throw.

따라서 Phase 1의 계약을 다시 쓴다. **인용을 유발하지 않는 경로(사실상 전부)에서는 동작 불변이다. 인용을 유발하는 경로에서는 동작이 바뀌며, 그 변화가 곧 버그 수정이다.** "한 케이스도 바꾸지 않는다"는 요구를 철회한다 — 그것이 모순의 근원이었다. 바뀌는 케이스를 회귀 테스트로 열거한다.

> `GitAdapter.exec`는 `.replace(/\s+$/,'')`로 후행 공백만 제거한다. JS의 `\s`는 NUL에 매칭되지 않으므로 `-z` 출력의 후행 `\0`은 보존된다. 레코드 분해는 `split('\0').filter(Boolean)`로 한다.

**D12. `workflow/.gitignore`는 부재 시에만 생성하고 `--force`로도 덮지 않는다.** (design R1 P2-2)

`planInstall`의 `add()`는 `existsSync(destAbs) && !force`일 때만 skip한다(`init.ts:534`). 즉 `force=true`면 소유권·내용을 보지 않고 곧장 copy 대상에 넣는다. 팀이 `workflow/.gitignore`에 자기 규칙을 넣어 둔 repo에서 `npx commitgate --force`가 그것을 지운다.

`.gitignore`는 git 관례상 사용자 소유 파일이다. 따라서 `AGENTS.md`/`CLAUDE.md`와 **동일 정책**을 적용한다(`init.ts:887-888` — "부재 시에만 생성(--force로도 덮어쓰지 않는다)"). `KIT_COPY_RELPATHS`의 `add()` 경로를 타지 않고 별도 분기로 처리한다.

- 부재 → 생성.
- 존재 & 템플릿과 바이트 동일 → skip, 경고 없음.
- 존재 & 다름 → **보존** + WARN. 누락된 규칙을 나열해 사용자가 직접 병합하게 한다.
- `--force` → 위 정책을 바꾸지 않는다.

대가: kit 규칙이 갱신돼도 기존 설치본에 전파되지 않는다. 이것은 설치 manifest 부재의 한 증상이며(후속 REQ), 사용자 파일 clobber보다 나은 실패다.

**D13. `workflow/.gitignore`는 `--no-agent-entrypoints`와 독립이다.** (design R1 P2-3)

`init.ts:546-547`의 src≠dest 복사는 `if (!facts.agentEntrypointsSkipped)` 안에 있다. 새 항목을 그 루프에 합치면 `npx commitgate --no-agent-entrypoints`가 `workflow/.gitignore`까지 건너뛴다 — 그 옵션은 `.claude/`·`.cursor/`·`CLAUDE.md`만 생략한다고 문서화돼 있다.

`KIT_GITIGNORE`는 **별도 상수 + 별도 복사 분기**로 둔다. 설치·`artifacts`/`stageList` 편입·`uninstall` tool 분류 모두 `agentEntrypointsSkipped`와 무관하게 동작한다. 회귀 테스트로 고정한다.

## Phase별 구현

### Phase 1 — porcelain·scratch SSOT (`phase-1-porcelain-scratch-ssot`)

`-z` 전환 + SSOT 추출. 새 파일 둘.

- `scripts/req/lib/porcelain.ts` — `parseStatusZ(raw: string): StatusEntry[]`. 입력은 `git status --porcelain=v1 -z --untracked-files=all`의 원문. `split('\0')`로 레코드 분해. **`X` 또는 `Y`가 `R`/`C`면**(D11-1) 다음 필드를 `origPath`로 하나 더 소비한다(D11: `-z`는 NEW가 먼저다). 없으면 throw(fail-closed). `StatusEntry = { index, worktree, path, origPath?: string }` + `paths(e): string[]` 헬퍼(rename이면 둘 다). 인용이 없으므로 unquote 단계 자체가 없다.
- `scripts/req/lib/scratch.ts` — scratch 정의 SSOT.
  - `TOOL_OUTPUT_BASENAMES = ['codex-response.json', '.review-preview.txt']` — untracked 도구 산출물.
  - `reviewScratchPaths(ticketDirRel)` — 위 둘 + `state.json`. 기존 세 곳이 쓰던 3종.
  - `isToolOutputScratch(entry, ticketRoot)` — D7 술어. `req:new` 전용.
  - `isAllowedResponsesScratch`를 `review-codex.ts`에서 이곳으로 이동(doctor 전용 유지).

호출부 교체: `req-next.ts` · `req-doctor.ts` · `review-codex.ts` · `bin/init.ts`. 네 곳 모두 git 호출을 `-z`로 바꾸고 `-c core.quotePath=false`를 뗀다. `bin/init.ts:266`의 `parsePorcelainLine`과 `:232`의 `unquoteGitPath`는 **삭제**한다 — `-z` 아래에서 죽은 코드다.

> **계약(D11 개정).** 인용을 유발하지 않는 경로에서는 판정이 한 건도 바뀌지 않는다. 인용을 유발하는 경로(`"`·`\`·제어문자·비-ASCII+quotePath=true)에서는 **바뀌며, 그것이 이 phase가 고치는 버그다.** 초안의 "한 케이스도 바꾸지 않는다"는 요구는 자기모순이라 철회한다.
>
> 반드시 회귀로 고정할 케이스는 Phase 1 계획표(02-plan.md)에 있다. 핵심은 X/Y 양쪽 `R`/`C`와 truncated 레코드의 fail-closed다.

### Phase 2 — gitignore 정합 (`phase-2-gitignore`)

- `.gitignore` scratch 블록에 `workflow/**/codex-response.json` 추가 (루트 파일 → 슬래시 포함 패턴).
- `templates/workflow.gitignore` 신설. 내용은 `/REQ-*/` 앵커드 3규칙 (D5-1).
- `bin/init.ts`: `KIT_GITIGNORE = { src: 'templates/workflow.gitignore', dest: 'workflow/.gitignore' }`. **`KIT_AGENT_ENTRYPOINTS` 루프에 합치지 않는다**(D13 — `--no-agent-entrypoints`가 삼킨다). **`add()`를 타지 않는다**(D12 — `--force`가 사용자 파일을 덮는다). 부재 시에만 생성하는 별도 분기 + 존재·불일치 시 WARN.
- `artifacts`/`stageList` 편입은 `agentEntrypointsSkipped`와 무관하게 수행한다.
- `package.json` `files[]`에 `templates/`가 이미 있으므로 tarball 축은 자동. `tests/unit/package-payload.test.ts`가 이 사실을 고정하는지 확인하고, 아니면 단언을 추가한다(D11-npm: `.gitignore` 이름이면 npm이 지운다 — 이 단언이 실질적이다).
- `bin/uninstall.ts`의 tool artifact 목록이 새 파일을 `src ≠ dest` 축으로 인식하는지 확인.

### Phase 3 — `req:new` 예외 + 회귀 테스트 (`phase-3-req-new-predicate`)

- `req-new.ts:154`를 `git status --porcelain=v1 -z --untracked-files=all`로 바꾼다(D10 — Phase 1과 동일 형태, `core.quotePath` 제거). 출력을 `parseStatusZ`로 소비하고, `lib/scratch.ts`의 D7 술어로 필터한 뒤 **남는 엔트리가 하나라도 있으면** throw.

> Phase 1이 line parser를 삭제하므로 Phase 3가 `-z` 없는 명령을 쓰면 파싱 경계 자체가 없다 — 여러 status 줄이 한 `StatusEntry.path`로 합쳐진다. 두 phase의 명령은 반드시 같아야 한다.
- `tests/unit/req-new.test.ts`에 clean-tree 단언 신설 (현재 0건). fixture repo는 **gitignore 규칙 없이** 만든다(D6 — 규칙이 있으면 술어가 실행되지 않는다).

## 변경 파일

| Phase | 파일 | 성격 |
|---|---|---|
| 1 | `scripts/req/lib/porcelain.ts` | 신규 |
| 1 | `scripts/req/lib/scratch.ts` | 신규 |
| 1 | `scripts/req/req-next.ts` · `req-doctor.ts` · `review-codex.ts` · `bin/init.ts` | 호출부 교체 |
| 1 | `tests/unit/` — porcelain/scratch 단위 테스트 | 신규 |
| 2 | `.gitignore` · `templates/workflow.gitignore` | 규칙 |
| 2 | `bin/init.ts` · `bin/uninstall.ts` | kit 파일 축 |
| 2 | `tests/unit/init.test.ts` · `uninstall.test.ts` · `package-payload.test.ts` | 회귀 |
| 3 | `scripts/req/req-new.ts` | 술어 |
| 3 | `tests/unit/req-new.test.ts` | 회귀(신설) |

Phase 1이 6~8파일로 `granularityMaxFiles`(8) 경계다. `req:doctor`가 D18 WARN을 내면 1a(porcelain) / 1b(scratch)로 런타임 분할한다.

## 하위호환·안전

- **게이트 완화 방향이다.** `req:new`가 지금보다 더 많은 상태를 통과시킨다. D9가 그 완화가 승인 경로에 닿지 않음을 보인다. 그래도 `--risk HIGH`로 두어 `req:commit --run` 직전 사용자 확인을 강제한다.
- **기존 티켓 무영향.** `state.json` 포맷을 건드리지 않는다. `workflow/REQ-2026-001..011`은 읽기 전용이다.
- **레거시 설치본(0.1.0–0.4.0).** 사용자 `.gitignore`에 규칙을 자동으로 얻지 못한다(D3). Phase 3의 코드 레벨 예외가 이들을 커버한다. `workflow/.gitignore`는 이 설치본들에 **부재**하므로 재-`init`만으로 받는다 — D12의 보존 정책은 부재 시 생성을 막지 않는다.
- **`workflow/.gitignore`가 이미 있는 대상.** 보존한다. `--force`로도 덮지 않는다 — `AGENTS.md`/`CLAUDE.md`와 **동일 정책**이다(D12, `init.ts:887-888`). 내용이 템플릿과 다르면 WARN으로 누락 규칙을 나열해 사용자가 직접 병합하게 한다. 대가는 kit 규칙 갱신이 기존 설치본에 전파되지 않는다는 것이며, 이는 설치 manifest 부재의 증상이므로 후속 REQ로 분리한다. 사용자 파일 clobber보다 나은 실패다.
- **중첩 패턴 형태.** D5-1에서 실측으로 확정했다. 루트와 kit 파일이 같은 문자열을 쓰면 kit 쪽이 조용히 무효가 된다 — Phase 2가 이것을 fixture 단언으로 고정한다.
- **미검증.** 부모 디렉터리 제외 함정(`init.ts:605-613`)은 부정 패턴에만 적용되므로 이 규칙엔 무관하다고 보나, Phase 2에서 실측한다.
