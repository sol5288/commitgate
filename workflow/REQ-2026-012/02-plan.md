# REQ-2026-012 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

Phase 순서는 초안과 반대다(설계 D2). `req:new`의 새 술어가 Phase 1의 산출물을 import하므로, SSOT 추출이 먼저다.

## Phase 1 — porcelain·scratch SSOT (`phase-1-porcelain-scratch-ssot`)

범위: `scripts/req/lib/porcelain.ts`·`scripts/req/lib/scratch.ts` 신설. 호출부 4곳(`req-next`·`req-doctor`·`review-codex`·`bin/init`)의 git 호출을 `--porcelain=v1 -z --untracked-files=all`로 전환하고 `-c core.quotePath=false`를 뗀다. `bin/init.ts`의 `parsePorcelainLine`·`unquoteGitPath` 삭제(죽은 코드). `isAllowedResponsesScratch`를 `review-codex.ts`에서 이관.

**계약(설계 D11 개정).** 초안의 "동작을 한 케이스도 바꾸지 않는다"는 요구를 **철회한다.** C-인용 경로에서 그 요구는 "unquote된 값만 반환한다"와 양립하지 않는다. `-z`는 인용 자체를 없애므로 딜레마가 사라진다. 정확한 계약:

- 인용을 유발하지 않는 경로(사실상 전부) → 판정 불변.
- 인용을 유발하는 경로(`"`·`\`·제어문자·비-ASCII+`quotePath=true`) → **판정이 바뀐다. 그 변화가 이 phase가 고치는 버그다.**

회귀 케이스(전부 신규). git 2.46.0에서 실측한 입력이다.

| # | 입력(`-z` 원문) | 기대 |
|---|---|---|
| 1 | `?? a\b.txt` (역슬래시 포함) | 경로 `a\b.txt` 단일. 기존 `statusPaths`는 `"a/b.txt"`로 뭉갰다 |
| 2 | `R  new\0old\0` — **X열** rename (`git mv`) | `{ path:'new', origPath:'old' }`. `-z`는 **NEW가 먼저**다(` -> `와 순서 반대) |
| 3 | ` R new\0old\0` — **Y열** rename (`mv` + `git add -N new`) | 동일하게 `origPath` 소비. **X만 검사하면 `old`가 독립 레코드로 새어 나온다** |
| 4 | `RM new\0old\0` — X=R, Y=M | `origPath` 소비 |
| 5 | ` C new\0old\0` — Y열 copy | `origPath` 소비 |
| 6 | `R  new\0` — truncated(`origPath` 없음) | **throw** (fail-closed). `undefined` 반환 금지 |
| 7 | 경로에 ` -> `가 든 rename | delimiter로 오인하지 않는다 |
| 8 | 공백·비-ASCII 경로 | 인용 없이 원문 그대로 |
| 9 | `-z` 출력의 후행 `\0` | `GitAdapter.exec`의 `.replace(/\s+$/,'')`에 지워지지 않는다(JS `\s`는 NUL 불일치) |

**3·5·6이 이 phase의 핵심이다.** `origPath` 소실은 스타일 문제가 아니라 보안 회귀다 — `findUnstagedOrUntracked`(`review-codex.ts:869-875`)와 `statusPaths`(`req-doctor.ts:197`)가 rename의 src·dest를 둘 다 검사해 "비허용 → 허용 경로 rename"으로 `responses/` 주입·코드 삭제를 우회하는 것을 막는다(주석 A2-P2-1). `origPath`가 없으면 그 차단이 뚫린다.

Exit: typecheck0 · 기존 738 단위 그린 · 위 9개 회귀 그린 · rename 우회 시나리오(비허용 경로 → `responses/` 아래로 rename)가 D10/D13에서 여전히 FAIL · Codex phase 리뷰 승인.

리스크: 6~8파일로 granularity 경계. D18 WARN이 나오면 1a(porcelain `-z`) / 1b(scratch SSOT)로 런타임 분할.

## Phase 2 — gitignore 정합 (`phase-2-gitignore`)

범위: `.gitignore`에 `workflow/**/codex-response.json` 추가. `templates/workflow.gitignore` 신설. `bin/init.ts`에 `src ≠ dest` kit 파일 축(`KIT_GITIGNORE`) 추가. `bin/uninstall.ts` 소유권 분류 반영. `package-payload`·`init`·`uninstall` 테스트.

### `--force` 정책 — 확정 (설계 D12, design R1 P2-2)

`planInstall`의 `add()`는 `existsSync && !force`일 때만 skip한다(`init.ts:534`) — `force=true`면 소유권을 보지 않고 덮는다. `workflow/.gitignore`는 `add()` 경로를 타지 **않는다**. `AGENTS.md`/`CLAUDE.md`와 동일 정책(`init.ts:887-888`).

| 상태 | `npx commitgate` | `npx commitgate --force` |
|---|---|---|
| 부재 | 생성 | 생성 |
| 존재 · 템플릿과 바이트 동일 | skip, 무경고 | skip, 무경고 |
| 존재 · 다름(사용자 편집) | **보존** + WARN(누락 규칙 나열) | **보존** + WARN — 덮지 않는다 |

`add()`를 우회하므로 다음 둘을 **직접** 해야 한다(설계 D4).

- `ownedSkips` 편입: 바이트 동일 skip이 `stageList`에 들어가야 한다. 빠뜨리면 커밋 전에 `npx commitgate`를 두 번 돌린 사용자의 워킹트리가 dirty로 남고, 이어지는 `req:new --run`이 죽는다(`init.ts:458-461`이 기록한 실패 클래스).
- 멱등성: 별도 분기의 `existsSync` 검사. 회귀 테스트 — 연속 두 번 실행 시 두 번째의 `copied`에 이 파일이 없다.

### `--no-agent-entrypoints` 독립성 — 확정 (설계 D13, design R1 P2-3)

`init.ts:546-547`의 src≠dest 복사는 `if (!facts.agentEntrypointsSkipped)` 안에 있다. `KIT_GITIGNORE`를 그 루프에 합치면 안 된다.

- `npx commitgate --no-agent-entrypoints` → `.claude/`·`.cursor/`·`CLAUDE.md`는 생략되지만 `workflow/.gitignore`는 **설치되고 stage 목록에 든다**.
- `uninstall`의 tool artifact 분류도 `agentEntrypointsSkipped`와 무관하게 이 파일을 인식한다.

### 패턴 형태 — fixture 단언으로 고정 (설계 D5-1)

중첩 `.gitignore`의 패턴은 **그 파일 기준 상대 경로**다. 루트용 문자열(`workflow/**/…`)을 kit 파일에 그대로 넣으면 아무것도 무시하지 않으면서 테스트는 통과할 수 있다 — 규칙이 무효여도 `git status`에 파일이 보이는 것을 아무도 단언하지 않기 때문이다. 다음을 **명시적 수용 기준**으로 고정한다.

- `templates/workflow.gitignore`의 각 라인은 `workflow/`로 시작하지 **않는다**. (정적 단언 — 회귀 시 즉시 실패)
- 실제 fixture repo에서, `workflow/.gitignore`를 kit 내용으로 깐 뒤:

| 파일 | `git status --porcelain=v1 -z --untracked-files=all` |
|---|---|
| `workflow/REQ-2026-001/codex-response.json` | 미표시 |
| `workflow/REQ-2026-001/.review-preview.txt` | 미표시 |
| `workflow/REQ-2026-001/.codex-abc.tmp` | 미표시 |
| `workflow/REQ-2026-001/state.json` | **표시**(tracked 대상 — 절대 무시하지 않는다) |
| `workflow/REQ-2026-001/responses/design-r01-approved.json` | **표시** |
| `workflow/notes/codex-response.json` (티켓 밖) | **표시** (앵커드 `/REQ-*/` 이므로) |

- **역-단언**: 패턴을 `workflow/**/codex-response.json`으로 바꾸면 첫 행이 "표시"로 뒤집힌다. 이 단언이 없으면 잘못된 패턴이 조용히 통과한다.
- 루트 `.gitignore`(항목 1)는 `workflow/**/codex-response.json`을 쓴다. 두 파일의 패턴 형태가 **다르다**는 사실 자체를 주석으로 남긴다.

Exit: typecheck0 · 단위 그린 · 위 fixture 단언 전부 · `npm run smoke` 그린(tarball에 `templates/workflow.gitignore` 포함 확인 — npm이 `.gitignore`를 지우므로 이 단언이 실질적이다) · 설치 후 `workflow/.gitignore` 존재 · 두 번 설치 시 멱등 · Codex phase 리뷰 승인.

## Phase 3 — `req:new` 예외 + 회귀 테스트 (`phase-3-req-new-predicate`)

범위: `req-new.ts`의 clean-tree 검사를 `--porcelain=v1 -z --untracked-files=all`로 바꾸고 `lib/scratch.ts`의 술어(설계 D7)로 필터. 허용 목록에 없는 엔트리가 하나라도 있으면 throw. `tests/unit/req-new.test.ts`에 clean-tree 단언 신설(현재 0건).

**테스트 fixture는 gitignore 규칙 없이 만든다.** 규칙이 있으면 두 scratch 파일이 porcelain에 나타나지 않아 술어가 한 줄도 실행되지 않는다(설계 D6). 규칙 있는 fixture에서만 테스트하면 통과해도 아무것도 검증하지 않는다.

수용 케이스:

| 워킹트리 상태 | 기대 |
|---|---|
| `?? <t>/codex-response.json` 만 | 통과 |
| `?? <t>/.review-preview.txt` 만 | 통과 |
| ` M <t>/state.json` | throw |
| `?? <t>/responses/design-r01-approved.json` | throw |
| `M  src/foo.ts` (staged, 워킹트리 clean) | throw |
| `?? <t>/codex-response.json.bak` | throw |
| `?? other/codex-response.json` (티켓 밖) | throw |
| rename `R` 로 `<t>/codex-response.json` 이 dest | throw (코드 ≠ `??`) |

Exit: typecheck0 · 단위 그린 · 위 8케이스 회귀 · `req:new --run`이 `codex-response.json`만 남은 트리에서 통과(수동 실측) · Codex phase 리뷰 승인.

## 완료

- 게이트 해당분(unit·typecheck) · `npm run smoke` 그린 · 사용자 main 머지(별도 승인).
- `--risk HIGH`이므로 각 phase의 `req:commit --run` 직전 사용자 확인(`state.user_commit_confirmed`).

## 후속 분리 (이 REQ에서 하지 않음)

- 가변 `ticketRoot`에서 gitignore 규칙·`KIT_COPY_RELPATHS`가 빗나가는 문제.
- kit 규칙 갱신이 기존 설치본에 전파되지 않는 문제(설계 D12의 대가). 설치 manifest REQ에서 다룬다.
- `req:next`가 빈 설계 문서에도 `--kind design --run`을 지시하는 문제 — 설계를 *작성하라*는 `AGENT` 단계가 없다. REQ-2026-012 생성 직후 실측됨.

> `statusPaths`의 인용 해제 누락은 **Phase 1에서 함께 고친다**(설계 D11). `-z` 전환이 인용 자체를 없애므로 별도 REQ로 미룰 수 없다 — 미루면 새 파서와 옛 시맨틱이 공존해야 하고, 그 요구가 초안의 모순이었다.
