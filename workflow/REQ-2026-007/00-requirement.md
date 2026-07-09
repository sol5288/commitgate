# REQ-2026-007 요구사항 — uninstall planner (읽기 전용) + 제거 문서화

## 무엇을
`npx commitgate`로 설치한 사용자가 **어떻게 되돌리는지** 알 수 있게 한다.

1. `npx commitgate uninstall` — **읽기 전용 removal planner**. repo 상태를 읽고 제거 계획과 "사용자가 직접 검토 후 실행할 명령"만 출력한다. **파일을 삭제하지 않는다.**
2. `README.md` / `README.en.md`에 제거·정리 섹션 추가.

## 왜
- 현재 두 README 어디에도 제거 안내가 없다(grep 확인). 설치는 문서화돼 있으나 되돌리기는 없다.
- 그런데 **실제 삭제를 수행하는 uninstaller는 만들면 안 된다.** `runInit`은 무엇을 생성했고 무엇이 이미 있었는지(`copied`/`skipped`/`configAction`/`packageJsonAdded`/`agentsCreated`)를 계산만 하고 stdout에 출력할 뿐, **디스크에 원장(manifest)을 남기지 않는다**([bin/init.ts](../../bin/init.ts) `main()`). 프로세스가 끝나면 create-vs-skip 판단이 소실된다.
- 그 결과 오삭제 위험이 실재한다:
  - `AGENTS.md`는 부재 시에만 생성된다(`agentsCreated`). init이 만든 경우와 사용자가 원래 갖고 있어 스킵된 경우가 **디스크상 구분 불가능**하다.
  - `req.config.json`은 기존 파일이 있으면 누락 키만 **병합**한다(`configAction: 'merged'`). 원본이 저장되지 않아 un-merge가 불가능하다.
  - `package.json`은 **부재 키만** 주입한다. 사용자가 이미 가진 `req:doctor`나 `cross-spawn`은 건드리지 않으므로, 7개 키를 일괄 제거하면 사용자 소유 항목을 지운다. `ajv`/`tsx`/`cross-spawn`은 흔한 공용 devDep이다.
  - 설정된 `ticketRoot`(기본 `workflow/`) 하위에는 REQ 티켓 `state.json`·`approvals.jsonl` 같은 **감사 증거**가 쌓인다.

## 제품 방향(비목표 포함)
- CommitGate는 git hook을 설치하지 않고 git config를 건드리지 않으며 repo 밖에는 npx 캐시 말고 아무것도 쓰지 않는다 — **순수 in-tree 스캐폴더**다. 이런 도구에서 되돌리기의 정본은 git이다.
- **비목표**: 파일을 삭제하는 uninstaller. `fs.rm`/`unlink`/`writeFile` 및 `git restore`/`git clean`/`git revert`/`git checkout`의 **실행**.
- **비목표**: init에 manifest 기록 추가(별도 티켓 사안). 본 티켓은 "원장이 없다"는 현실을 **설계 전제**로 받아들이고, 그 위에서 안전한 안내만 한다.

## 검증된 사실(문서·planner 출력에 반영)
- `npx commitgate`는 전역 설치가 아니다. 이 머신에서 `npm ls -g commitgate` → `(empty)`. 패키지는 npm 캐시의 `_npx/<hash>/`에만 들어간다.
- **`npm cache clean --force`는 `_npx`를 지우지 않는다.** npm 10.8.2 소스의 `cache.js clean()`은 `_cacache`만 `fs.rm`하며 `_npx` 참조가 없다. 격리 캐시(`npm_config_cache`)로 재현: clean 후 `_cacache` 삭제, `_npx` 전량 잔존.
- `git checkout -- package.json`은 **인덱스**에서 복원한다. `git add` 이후에는 주입된 `req:*` 스크립트가 그대로 남는다 → `git checkout HEAD -- package.json`이어야 한다. 또한 이 명령은 package.json의 **다른 미커밋 편집도 함께 버린다**.
- git은 빈 디렉터리를 추적하지 않는다. kit 파일 제거 후 `git status`가 clean이어도 빈 `scripts/`·`workflow/`가 파일시스템에 남는다.

## 완료 기준
- `npx commitgate uninstall`이 repo를 읽고 계획을 출력하며, 어떤 파일도 생성·수정·삭제하지 않는다(테스트로 고정).
- planner가 `AGENTS.md`·`req.config.json`·`package.json` 기존 값의 삭제를 지시하지 않는다(테스트로 고정).
- 설정된 `ticketRoot`(하드코딩 `workflow/` 아님)의 증거를 삭제 대상에서 제외한다(테스트로 고정).
- 미커밋 / 커밋됨 상황별 안내가 구분된다(테스트로 고정).
- README 2종에 제거 섹션(전역 설치 아님 · 설치 footprint · 미커밋 되돌리기 · 커밋 후 `git revert` · OS별 npx 캐시 제거 · `npm cache clean --force` 주의).
- vitest · tsc · smoke 그린 · design/phase CommitGate 승인.
