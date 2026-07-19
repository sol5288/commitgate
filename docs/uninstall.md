# 제거하기

CommitGate는 두 곳에 있습니다. **런타임**(`node_modules/commitgate`)과 **프로젝트에 깔린 거버넌스 파일**입니다.

런타임은 package manager가 지웁니다:

```sh
npm uninstall -D commitgate      # pnpm remove -D commitgate · yarn remove commitgate
```

프로젝트 파일은 아래 계획을 보고 직접 정리하세요. 먼저 알아둘 것: **`npx commitgate`는 전역 설치가 아닙니다.** npx는 패키지를 npm 캐시(`_npx/<hash>/`)에 받아 한 번 실행할 뿐이고, 전역 `node_modules`에도 PATH에도 아무것도 남기지 않습니다.

제거 계획을 먼저 확인하세요. 이 명령은 **아무것도 지우지 않고** 계획만 출력합니다:

```sh
npx commitgate uninstall
```

repo를 읽어 (1) CommitGate가 설치한 파일 중 패키지 원본과 바이트가 동일한 것, (2) 편집돼서 직접 확인이 필요한 것, (3) 자동 제거하면 안 되는 것, (4) 감사 증거를 분류해 보여주고, 커밋 여부에 맞는 되돌리기 명령을 출력합니다. 삭제는 사용자가 검토한 뒤 직접 실행합니다.

## 왜 자동으로 지워주지 않나요?

`init`은 **무엇을 새로 만들었는지 디스크에 기록하지 않습니다.** 그래서 제거 시점에는 아래를 구분할 수 없습니다.

- `AGENTS.md`는 **없을 때만** 생성됩니다. 이미 있었다면 그대로 두므로, init이 만든 파일과 사용자가 쓴 파일이 디스크상 같아 보입니다.
- `req.config.json`은 이미 있으면 **누락된 키만 병합**합니다. 원본을 보관하지 않아 병합을 되돌릴 수 없습니다.
- `package.json`은 **없는 키만** 주입합니다. 원래 있던 `req:doctor`나 `cross-spawn`은 CommitGate 소유가 아닙니다. `ajv`·`cross-spawn`·`tsx`는 다른 패키지도 흔히 쓰는 devDependency입니다.
- `ticketRoot`(기본 `workflow/`)에는 REQ 티켓의 `state.json`과 `approvals.jsonl` — 이 도구의 **감사 증거** — 가 쌓입니다.

원장이 없는 상태에서 일괄 삭제하면 사용자 데이터를 파괴합니다. CommitGate는 git hook을 설치하지 않고 git config도 건드리지 않는 순수 in-tree 스캐폴더이므로, 되돌리기의 정본은 git입니다.

## 아직 커밋하지 않았다면

```sh
git status --porcelain -uall     # 무엇이 추가됐는지 확인
git diff -- package.json         # 주입된 req:* 스크립트와 devDependencies 확인
```

확인한 뒤 직접 되돌립니다. `package.json`은 반드시 `HEAD` 기준으로 복원하세요.

```sh
git checkout HEAD -- package.json
```

> ⚠️ `HEAD`를 빼면 **인덱스**에서 복원되어, `git add` 이후에는 주입된 `req:*` 스크립트가 그대로 남습니다.
> ⚠️ 이 명령은 `package.json`의 **다른 미커밋 편집도 함께 버립니다.** 먼저 위 diff를 확인하세요.

파일 삭제는 `npx commitgate uninstall`이 나열해 준 경로만 지우세요. `scripts/req/`나 `workflow/`를 디렉터리째 지우면 그 안의 사용자 파일이나 티켓 증거가 함께 사라집니다.

> git은 빈 디렉터리를 추적하지 않습니다. 파일을 다 지운 뒤 `git status`가 clean이어도 빈 `scripts/`·`workflow/`·`.claude/`·`.cursor/`가 파일시스템에 남을 수 있습니다.

## 이미 커밋했다면

스캐폴딩을 추가한 커밋을 되돌립니다.

```sh
git log --diff-filter=A --format='%H %s' -- req.config.json
git revert <sha>
```

`npx commitgate uninstall`이 도입 커밋 후보를 찾아 줍니다. 그 커밋에 다른 변경이 섞여 있으면 revert가 무관한 작업까지 되돌리므로, 먼저 `git show <sha>`로 확인하세요. 도입 커밋이 여러 개로 흩어져 있으면 단일 revert로는 되돌릴 수 없습니다.

## npx 캐시 정리 (repo와 무관)

전역 설치 여부부터 확인합니다.

```sh
npm ls -g commitgate            # 비어 있으면 전역 설치가 아님
npm uninstall -g commitgate     # 전역으로 설치했던 경우에만
```

npx가 받아 둔 패키지는 npm 캐시의 `_npx/` 아래에 남습니다.

```powershell
# Windows (PowerShell)
Remove-Item -Recurse -Force "$(npm config get cache)\_npx"
```

```sh
# macOS / Linux
rm -rf "$(npm config get cache)/_npx"
```

> ⚠️ **`npm cache clean --force`는 CommitGate 제거 명령이 아닙니다.** 이 명령은 `_cacache`만 비우고 `_npx`는 그대로 둡니다. repo의 스캐폴딩과도 아무 관련이 없습니다.
