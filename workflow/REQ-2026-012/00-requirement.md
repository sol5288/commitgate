# REQ-2026-012 요구사항

`req:new`가 도구 자신의 스크래치 산출물에 막힌다. 근본 원인은 scratch 정책 중복이 아니라 `.gitignore` 한 줄 누락이다.

## 배경 — 재현되는 결함

`.gitignore`의 scratch 블록은 형제 두 규칙만 갖는다.

```
# req 워크플로 스크래치 산출물(티켓 내부)
workflow/**/.review-preview.txt
workflow/**/.codex-*.tmp
```

`codex-response.json`이 빠져 있다. 점(`.`)으로 시작하지 않아 누락된 것으로 보인다. 그 결과 리뷰를 한 번이라도 돌린 뒤 남는 `codex-response.json`이 **다음 티켓의 `req:new --run`을 막는다**. `req-new.ts:154`의 clean-tree 검사가 `git status --porcelain` 출력이 있으면 무조건 throw하기 때문이다.

이 REQ를 시작할 때 실제로 겪었다 — `?? workflow/REQ-2026-011/codex-response.json`. 티켓을 만들기 위해 그 파일을 손으로 지워야 했다.

REQ-2026-011 `00-requirement.md`의 후속 결함 #1이 이 현상을 "세 곳이 공유하는 scratch 집합을 `req-new.ts`가 모른다"로 기록했다. **그 진단은 증상을 원인으로 오인했다.** `.review-preview.txt`와 `.codex-*.tmp`는 이미 무시되므로 애초에 `git status`에 나타나지 않는다. 세 곳의 코드 레벨 예외가 필요한 이유는 오직 `state.json`(tracked, 리뷰 도중 도구가 수정) 때문이다.

## 근본 원인

`workflow/**/codex-response.json`이 `.gitignore`에 없다.

- 이 파일은 **한 번도 커밋된 적이 없다**(`git log --all -- 'workflow/**/codex-response.json'` → 공백).
- 승인 증거는 `responses/*.json`(tracked)과 `responses/approvals.jsonl`(tracked)이다. live 응답 파일은 순수 scratch다(`review-codex.ts:1083` — "respPath는 SCRATCH라 사후 무수정 검증 허용").
- `git status --porcelain`은 ignored 파일을 기본으로 제외한다. 규칙이 있었으면 `req-new.ts`의 raw 검사는 이 파일을 **보지 못했다**.

## 목표

1. `codex-response.json`이 `req:new`를 막지 않는다 — 이 저장소와, 앞으로 설치되는 대상 repo 모두에서.
2. 그 해소가 승인 증거 변조 경로를 열지 않는다. `state.json`과 `responses/**`는 계속 clean-tree 위반이다.
3. porcelain 파싱과 scratch 정의의 SSOT를 하나로 만든다 — DRY가 아니라 **정확성** 때문이다(§조사 결과 D8).

## 비목표 (이번 REQ에서 하지 않음)

- **가변 `ticketRoot` 대응.** `KIT_COPY_RELPATHS`는 `workflow/` 리터럴이고 `schemaPath`는 config 가변이라 이 긴장은 이미 존재한다(`init.ts:49-55`). 이번 REQ는 기본값(`workflow`)을 전제한다. 비-기본 `ticketRoot`에서 gitignore 규칙이 빗나가는 문제는 후속 REQ.
- **Stage B 전환·설치 manifest.** 별도 REQ.
- **`review-codex` 알 수 없는 옵션 fail-closed**(후속 #5), **`uninstall` 도입-커밋 필터**(#2), **dead `state` 제거**(#3). 각각 독립 REQ.
- 사용자 소유 `.gitignore` 자동 편집. D10에서 기각한다.

## 수용 기준

- 워킹트리에 `codex-response.json`만 있을 때 `req:new --run`이 통과한다. **gitignore 규칙이 없는 fixture**에서도 통과한다(레거시 설치본).
- ` M <ticket>/state.json`이 있으면 throw한다.
- `?? <ticket>/responses/xxx.json`이 있으면 throw한다.
- `M ` (staged, 워킹트리 clean)이 있으면 throw한다 — `findUnstagedOrUntracked`는 이것을 통과시키므로 재사용할 수 없다.
- gitignore 규칙이 있는 repo에서 `git status --porcelain --untracked-files=all`이 두 scratch 파일을 출력하지 않는다.
- `npx commitgate`를 두 번 실행해도 kit gitignore 파일이 중복 생성·추가되지 않는다(멱등).
- `npm run typecheck` 그린, `npm test` 그린, `npm run smoke` 그린.

## 조사 결과 — 적대적 검증으로 확정·기각된 것

설계 초안을 4개 렌즈(증거 변조·porcelain 파싱·gitignore 부작용·init 쓰기)로 공격하고, 각 발견을 독립 회의론자가 반증 시도했다.

### 확정 (설계에 반영)

**D8. porcelain 파서가 셋으로 갈라져 있고 둘은 경로를 망가뜨린다.**

- `bin/init.ts:266` `parsePorcelainLine` — 비-export 사설 함수. `unquoteGitPath`(`init.ts:232`)로 C-인용을 되돌리지만 rename에서 **dest만** 취한다.
- `req-doctor.ts:197` `statusPaths` — export. rename의 src·dest 둘 다 반환하지만 **인용 해제를 하지 않고** `body.replace(/\\/g,'/')`로 역슬래시를 뭉갠다.
- `review-codex.ts:864-877` `findUnstagedOrUntracked` — 세 번째 인라인 파서.

`core.quotePath=false`는 **비-ASCII 인용만** 끈다. `"`·`\`·제어문자가 든 경로는 여전히 C-인용되므로 뒤의 둘은 그런 경로를 오분류한다. 초안이 지시한 "`review-codex.ts`의 기존 `parsePorcelainLine` 재사용"은 **구현 불가**다 — 그 이름은 거기 없다.

**D14 (design R1). 해법은 `--porcelain=v1 -z`다.** 초안의 Phase 1 계약("unquote된 값만 반환" + "기존 동작 한 케이스도 불변")은 C-인용 경로에서 자기모순이었다. `-z`는 인용을 아예 하지 않으므로(실측: `core.quotePath=true`에서도) raw/decoded 이중성이 소멸한다. 대신 rename 필드 순서가 `<NEW>\0<OLD>\0`로 ` -> `와 반대다. 설계 D11 참조.

**D15 (design R2). `R`/`C`는 X열과 Y열 양쪽에 온다.** ` R new\0old\0`(worktree rename)을 실측했다. X만 검사하는 파서는 `old`를 독립 레코드로 오인하고 `origPath`를 잃는다. 그러면 `review-codex.ts:869-875`가 막는 "비허용 경로 → 허용 경로 rename" 우회가 다시 열린다 — **보안 회귀**다. truncated rename 레코드는 fail-closed로 throw한다. 설계 D11-1 참조.

**D9. Phase 순서가 뒤집혀 있었다.** 초안의 phase 2(`req:new` 예외)가 phase 3(SSOT 추출)의 산출물에 의존한다. 순서를 뒤집는다.

**D10. `init`은 `.gitignore`에 한 바이트도 쓰지 않는다.** `init.ts:473`이 명시한다 — "`.gitignore` — init이 쓰지는 않지만". Apply 블록(`init.ts:878-890`)의 `writeFileSync` 대상은 `req.config.json`과 `package.json` 둘뿐이다. node_modules 규칙조차 **탐지 후 안내**만 한다(`init.ts:1013-1014`). 초안의 "기존 쓰기 기계장치 재사용"은 거짓 전제였다.

새로 쓰면 세 가지가 깨진다.

- 비파괴 계약(`AGENTS.md`/`CLAUDE.md`와 동일 정책: 사용자 파일은 부재 시에만 생성).
- `stageList` SSOT. `gitignoreJoinsInstall`(`init.ts:394-397`)은 init 자신의 쓰기를 모르므로 `.gitignore`가 artifacts에서 빠지고, 설치 후 ` M .gitignore`가 unstaged로 남아 다음 `req:new --run`이 죽는다 — phase-6이 고친 실패 클래스의 재도입.
- 멱등성. 파일 단위 sha256 dedup(`init.ts:532-542`)은 **라인 append**에 무력하다.

**D11. npm은 `.gitignore`를 tarball에서 제외한다.** `files[]`에 넣어도 마찬가지다. 재현:

```
files: ["sub"] + sub/.gitignore + sub/normal.txt + sub/workflow.gitignore
→ npm pack → package/sub/normal.txt, package/sub/workflow.gitignore 만 포함
```

따라서 kit gitignore 파일은 비-점 이름으로 싣고 `src ≠ dest`로 복사해야 한다 — `KIT_AGENT_ENTRYPOINTS`(`init.ts:67-70`)와 동일 패턴.

**D12. gitignore 규칙이 생기면 `req:new`의 코드 레벨 예외는 발화하지 않는다.** ignored untracked 파일은 `--porcelain --untracked-files=all`에 나타나지 않는다(임시 repo에서 재현). 예외의 실효 조건은 **규칙이 없는 레거시 설치본**이다. 방어심층으로 유지하되, 테스트는 규칙 없는 fixture에서 돌려야 유효하다 — 그러지 않으면 예외 코드가 한 줄도 실행되지 않은 채 테스트가 통과한다.

**D13. `req-new.test.ts`에 clean-tree 단언이 하나도 없다.** slug 검증·id 채번·인자 파싱만 테스트한다. 새 술어는 회귀 가드 없이 출하될 뻔했다.

### 기각 (설계에 넣지 않음)

- **"예외가 승인 증거 변조를 연다"** — 기각. 예외는 승인을 **전혀 부여하지 않는다**. `req:new`는 `buildInitialState`로 `commit_allowed:false`인 새 state를 쓰고(`req-new.ts:167`) 갓 만든 티켓 디렉터리만 `git add`한다(`req-new.ts:185`). 승인은 `state.json`의 `commit_allowed=true` + `approval_evidence`로만 흐르고, `req:commit`은 `commit_allowed !== true`면 즉시 throw한다(`req-commit.ts:758`). 바인딩은 porcelain 문자열이 아니라 git `write-tree`(content-addressed)라 `assume-unchanged`·`skip-worktree`·`add`+`reset` 같은 `??` 우회로 위조할 수 없다. 이미 승인된 티켓에서 live 응답을 손대면 D-016-5가 잡는다(`req-doctor.ts:183`).
- **"`ticketRoot`를 정규식에 보간하면 메타문자 오버매칭"** — 기각. 저장소의 경로 매칭은 전부 문자열 기반이다(`isAllowedResponsesScratch`는 `startsWith`/`slice`/`includes`만 쓴다). 정규식을 쓰지 않는다.
- **"pre-write porcelain 스냅샷이 init의 `.gitignore` 쓰기로 낡는다"** — 기각. 전제(init이 쓴다)가 거짓이고, 설령 쓰더라도 `package.json`이 동일 경로로 이미 올바르게 처리된다.
- **"`-uall` 전환이 디렉터리 collapse를 제거한다"** — 근거 거짓. 기존 티켓 디렉터리는 항상 tracked 파일을 포함하므로 collapse가 애초에 없다. `-uall`은 유지하되 근거를 "다른 게이트와의 인자 정합"으로 바꾼다.
