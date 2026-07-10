# REQ-2026-011 요구사항

brownfield 설치 결함 수정 (palm-backend 요청서 D1·D2·D3·D4·D5·D8-B)

## 무엇을

CommitGate 0.4.0을 기존 프로젝트(palm-backend — Nuxt3 · pnpm · Windows)에 실제로 설치·운영하며 드러난 결함 중, **스키마 변경을 동반하지 않는 저위험·고효과 6건**을 수정한다.

| # | 결함 | 수정 |
|---|---|---|
| D8-B | `req:review-codex`가 staged diff 전문을 외부(Codex/OpenAI)로 전송한다는 사실이 문서 어디에도 없다 | README·계약 템플릿에 고지 추가 |
| D1 | 진입점 템플릿 4종이 `npm run …`을 하드코딩 → pnpm/yarn 프로젝트에 틀린 명령이 깔린다 | 템플릿을 pm-중립 bare 표기로 통일 |
| D2 | 런타임 문구가 pm 리터럴을 제각각 박아 둠(`req-next`는 npm, `req-new`·`req-doctor`·`review-codex`는 pnpm) | config 가용 지점은 `buildScriptInvocation`으로 파생, 그 전은 bare |
| D3 | `parseArgs` 4종이 POSIX end-of-options `--`를 "알 수 없는 옵션"으로 throw | bare `--`를 구분자로 흡수 |
| D4 | init이 안내하는 다음 명령 `req:new --run`이 clean 워킹트리를 요구해 100% 실패 | 안내에 커밋 단계 삽입 + clean-tree 에러에 복구 힌트 |
| D5 | `.claude`를 gitignore한 repo에서 진입점이 조용히 추적 제외 | `git check-ignore` preflight 경고, `--strict`면 차단 |

## 왜

- **D8-B**는 코드 변경 없이 즉시 반영 가능하고, 사용자가 모르고 자격증명을 외부로 보내는 것이 이 도구의 가장 큰 잔여 위험이다. 결함 수정이 아니라 **고지**다.
- **D1·D2·D3**은 하나의 실패로 합쳐진다. 도구가 준 문구를 따라도, 자기 pm으로 번역해도 첫 스텝이 죽는다.
  `pnpm req:next -- 2026-010` → `알 수 없는 옵션: --`. 올바른 형태는 어느 진입점에도 적혀 있지 않다.
- **D4**는 설치 직후 100% 재현되는 UX 결함이다. `console.log` 몇 줄로 해소된다.
- **D5**는 조용한 실패다. 로컬에서는 동작하므로 아무도 눈치채지 못하지만, 팀원·CI의 fresh clone에는 진입점이 없어
  **설치 목적(팀 전체 게이트)이 무력화된다.**

### 회귀 경위 (D1이 재발한 이유)

```
e09c2f3  2026-07-08  fix(init): correct per-package-manager run-command guidance
f66d45c  2026-07-09  feat(entrypoints): Claude Code·Cursor 진입점 설치 (REQ-2026-010 phase 3a)
```

`e09c2f3`이 init stdout을 pm-aware로 고친 **다음 날**, `f66d45c`가 템플릿에 npm 리터럴을 새로 넣어 같은 결함 클래스를 재도입했다. `runScriptCmd` 헬퍼에는 단위 테스트가 있으나(`tests/unit/init.test.ts:722`) **템플릿 본문을 지키는 테스트가 없어** CI가 잡지 못했다. 이 REQ는 그 가드를 만든다.

## 제약

1. **D1은 치환 렌더링을 쓰지 않는다.** `bin/uninstall.ts:229-230`이 설치본과 패키지 원본의 sha256을 비교해 `identical`/`differs`를 판정한다. init이 템플릿을 pm별로 렌더하면 설치본은 원본과 영원히 바이트가 달라져 `removable`에 들어가지 못하고, uninstall이 자기가 깐 파일을 지우지 못한다. 요청서 1안이 놓친 상호작용이다. → **pm-중립 bare 표기**로 해소한다(byte-identity 보존, 새 SSOT 축 없음).
2. **D3은 fail-closed를 약화시키지 않는다.** `--`는 옵션이 아니라 "여기부터 위치인자"라는 표준 마커다. 알 수 없는 **옵션**에 대한 throw는 그대로 남는다. `--` 이후 인자도 계속 옵션으로 파싱한다(그러지 않으면 `req:commit 2026-011 -- --run`이 `--run`을 위치인자로 삼켜 조용히 dry-run이 된다).
3. **D4의 clean-tree 게이트는 건드리지 않는다.** 의도된 fail-closed다(`req-new.ts:137` 주석). 스캐폴드를 화이트리스트로 통과시키면 목록 유지 부채가 생기고, 그 파일들이 feature 브랜치에 untracked로 남아 게이트에 구멍이 난다. 안내 문구만 고친다.
4. **D5는 preflight에서 검사한다.** 쓰기 전에 판정해야 `--strict`가 부분 설치 없이 차단할 수 있다. `git check-ignore`는 파일이 없어도 규칙 매칭이므로 가능하다.
5. `req.config.json` 스키마를 변경하지 않는다. 스키마 확장이 필요한 항목(D6·D7·D8-A)은 후속 REQ로 분리한다.

## 완료 기준

- 진입점 템플릿 4종에 `npm run req` / `pnpm req:` 리터럴이 없고, 그 부재를 강제하는 회귀 테스트가 CI에 있다.
- `parseArgs(['--', '2026-011'])`이 **`req-next`·`req-doctor`·`req-commit`·`req-new`** 4개 스크립트 전부에서 throw 없이 id를 인식한다(`review-codex`는 unknown 옵션을 throw하지 않아 대상 아님).
- npm 설정 repo에서 `req:new --run` 성공 안내가 `pnpm`을 포함하지 않는다.
- `.claude`를 통짜 무시하는 임시 repo에 `runInit`을 돌리면 경고가 나오고, `--strict`에서는 **파일을 하나도 쓰지 않고** throw한다.
- init의 "다음:" 안내를 순서대로 따르면 `req:new --run`이 clean-tree 게이트를 통과한다. 안내의 `git add` 목록은 `<pm> install`이 갱신하는 lockfile과, 마커 부재 시 생성되는 `AGENTS.commitgate.md`를 빠뜨리지 않는다.
- 설치 전 워킹트리에 **무관한 unstaged 변경**만 있으면 안내가 `git stash -u`(bare `git stash` 아님) 단계를 포함해 clean-tree를 만든다.
- 설치 전 워킹트리에 **staged 변경**이 있거나 **산출물과 겹치는 tracked·unstaged 변경**이 있으면, 안내는 `git add` 목록을 **내지 않고** 그 사실과 해소 방법을 알린다(잘못된 안내보다 안내 없음이 낫다). `--strict`면 파일을 하나도 쓰지 않고 throw한다.
  - **untracked 산출물**(`?? package.json` 등)은 여기에 해당하지 않는다. baseline이 없어 분리할 것이 없고, 차단하면 README의 `git init && npm init -y && npx commitgate --strict`가 항상 실패한다.
- README·`AGENTS.template.md`에 staged diff 외부 전송 고지가 있다.
- `npm test` 그린, `npm run typecheck` 그린.

## 비목표 (이번 REQ에서 하지 않음)

- **D6** 트렁크 하드코딩(`req-new.ts:141`·`req-doctor.ts:277`의 `'main'` 리터럴). 사용자 결정: `trunkBranch` config 필드 + `origin/HEAD` 자동감지만 추가하고 **경고는 유지**(하드스톱은 breaking이라 major에서). 스키마 변경 동반 → 후속 REQ.
- **D7** codex 호출 타임아웃(`reviewTimeoutMs`). 스키마 변경 동반 → 후속 REQ. liveness 문제이지 safety 문제가 아니다(타임아웃 부재가 잘못된 승인을 만들지 않는다).
- **D8-A** `preReviewCommand` 훅. 설계 논의 필요 → 후속 REQ.

## 조사 중 발견해 기록만 하는 결함 (후속 REQ 후보)

1. **`req:new`가 도구 자신의 스크래치 파일에 막힌다.** `req-next.ts:611-616`·`req-doctor`·`review-codex`는 `codex-response.json`·`.review-preview.txt`·`state.json`을 D10 clean-tree 검사에서 제외하는 **스크래치 집합**을 공유한다. 그러나 `req-new.ts:138`은 raw `git status --porcelain`을 써서 그 집합을 모른다. 리뷰를 한 번이라도 돌린 뒤 남는 `codex-response.json`이 **다음 티켓의 `req:new`를 막는다.** 이 REQ를 시작할 때 실제로 겪었다.
2. **`uninstall`이 사용자 소유 진입점을 오분류한다.** `bin/uninstall.ts:359`의 `introduced` 산출에 `match` 검사가 없어 `match='differs'`(사용자 편집·소유의 증거)인 파일도 "스캐폴딩 도입 커밋" 후보가 된다. 결과적으로 **사용자 자신의 무관한 커밋에 `git revert`를 권한다.** `&& t.match === 'identical'` 한 줄로 해소된다. init은 진입점을 skip-if-exists로 다뤄 소유하지 않는데(`bin/init.ts:256-261`) uninstall만 `tool`로 분류하는 SSOT 드리프트가 뿌리다.
3. **`req-next.ts:514`의 dead 변수 `state`.** `resolveLegacy` 본문에서 한 번도 쓰이지 않는다. 이 저장소 tsconfig에 `noUnusedLocals`가 없어 잡히지 않았고, init이 이 파일을 byte-복사하므로 **`noUnusedLocals: true`인 대상 repo에서는 설치만으로 `type-check`가 영구 red가 된다.**
4. **`git commit` 직접 호출은 게이트 전체를 우회한다.** git hook을 설치하지 않으므로 강제력은 "협조하는 에이전트를 계약 궤도에 유지하는 것"에 있다. `uninstall.ts:11`·`req-commit.ts:224,244`는 이미 그렇게 적고 있으나 README 상단에는 없다. → phase-1에서 README 상단에 반영한다.
5. **`review-codex.ts:1053`은 알 수 없는 옵션을 조용히 무시한다.** 나머지 4개 `parseArgs`가 `알 수 없는 옵션: -x`로 throw하는 것과 달리, `else if (!a.startsWith('-')) opts.reqId = a`는 매칭되지 않은 `-`-접두 인자를 아무 분기 없이 흘려보낸다. 오타난 플래그(`--dryrun`)가 침묵 속에 무시된다. 이 REQ의 D3 대상은 **throw하는 4곳**이므로 여기는 건드리지 않지만, 일관성 결함으로 기록한다.
