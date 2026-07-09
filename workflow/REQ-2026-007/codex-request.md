# REQ-2026-007 리뷰 요청

## 리뷰 종류/범위
리뷰 종류는 프롬프트의 **REVIEW_KIND**를 따른다. design=설계문서 00/01/02(구현 diff 없음 정상), phase=staged diff(구현 코드). 각 리뷰는 해당 종류의 권위 아티팩트만 심사.

## 배경
`npx commitgate`로 설치한 사용자를 위한 제거 경로가 없다(README 2종에 언급 0건). 그러나 `runInit`은 `copied/skipped/configAction/packageJsonAdded/agentsCreated`를 계산만 하고 **디스크에 원장을 남기지 않는다** — `main()`이 console.log만 한다. 따라서 uninstall 시점에 "CommitGate가 만든 파일"과 "사용자가 원래 갖고 있던 파일"을 구분할 수 없다.

구체적 오삭제 위험(전부 init 코드 경로에서 확인):
- `AGENTS.md`는 부재 시에만 생성 → init 생성본과 사용자 소유본이 디스크상 동일하게 보인다.
- `req.config.json`은 기존 파일에 누락 키만 **병합**(`{...existingCfg, ...patch}`) → 원본 미보존, un-merge 불가.
- `package.json`은 **부재 키만** 주입 → 사용자의 기존 `req:doctor`/`cross-spawn`은 init 소유가 아니다.
- 설정된 `ticketRoot`(기본 `workflow/`)에는 `state.json`·`approvals.jsonl` 등 감사 증거가 쌓인다.

또한 CommitGate는 git hook·git config를 건드리지 않는 **순수 in-tree 스캐폴더**이므로 되돌리기의 정본은 git이다.

## 변경 요약
- `npx commitgate uninstall` 추가. **읽기 전용 removal planner** — repo를 읽고 제거 계획 + 사용자가 직접 실행할 명령만 출력한다. 파일을 생성·수정·삭제하지 않고, mutating git 명령(`restore`/`clean`/`revert`/`checkout`/`reset`/`add`/`commit`/`rm`)을 실행하지 않는다.
- 아티팩트를 `tool`(패키지 원본과 sha256 비교) / `ambiguous`(AGENTS.md·req.config.json·package.json 키 — 자동 제거 대상에서 항상 제외) / `evidence`(설정된 `ticketRoot` 하위 `REQ-*` — 삭제 금지)로 분류.
- **설치 경로 ≠ 설정 경로 분리(design R1 P2 반영)**: `runInit`은 스키마를 `PACKAGE_ROOT` 상대경로 그대로 재현하므로 `ticketRoot`/`schemaPath`와 무관하게 항상 `workflow/machine.schema.json`·`workflow/req.config.schema.json`에 복사한다. 제거 후보는 그 **실제 복사 경로**(init.ts가 `KIT_SCHEMA_RELPATHS`로 노출, runInit과 planner가 공유)로 잡고, 증거 보호만 `loadConfig`의 `ticketRoot`로 해소한다. `ticketRoot=docs/req-tickets`인 repo에서도 `workflow/*.schema.json` 잔여물이 tool로 분류되고, 존재하지 않는 `docs/req-tickets/req.config.schema.json`을 footprint로 주장하지 않는다.
- 커밋 전/후 안내 분기, `git checkout HEAD -- package.json`(인덱스 기준 아님) 안내, 빈 디렉터리 잔여 경고, `_npx` 캐시 정리 안내(`npm cache clean --force`가 제거 명령이 아니라는 경고 포함).
- verb dispatch는 `bin/commitgate.mjs`에서(순환 import 회피). `bin/init.ts`는 `export` 추가 + help 1줄만 변경 — init 동작 불변.
- README 2종에 제거/정리 섹션.

## 리뷰 포인트
- **읽기 전용 계약이 구조적으로 지켜지는가**: `bin/uninstall.ts`가 fs 쓰기 API를 import하지 않고, git 호출이 read-only allowlist(`rev-parse`/`status`/`ls-files`/`log`)에 갇히며, npm을 spawn하지 않는가. 삭제 플래그(`--run`/`--force`)를 두지 않은 선택이 타당한가.
- **원장 부재를 정직하게 반영했는가**: `tool` 분류의 sha256 비교 결과를 "사용자 소유"라 단정하지 않고 "편집됐거나 다른 버전이 설치함"으로만 표기하는가. `ambiguous` 3종이 예외 없이 자동 제거에서 제외되는가.
- **설치 경로와 설정 경로를 올바르게 분리했는가**(design R1 P2): 제거 후보 스키마는 init의 실제 복사 경로(`KIT_SCHEMA_RELPATHS`, 항상 `workflow/`)에서, 증거 보호는 `loadConfig`의 `ticketRoot`에서 나오는가. `ticketRoot` 재설정 repo에서 `workflow/` 잔여물을 놓치거나 없는 경로를 주장하지 않는가. `runInit`과 planner가 같은 상수를 공유해 드리프트가 생기지 않는가. `loadConfig` 실패 시 DEFAULTS 강등 + 명시 출력이 planner에서만 허용되는 결정이 안전한가.
- **안내 자체의 정확성**: `git checkout -- package.json`(인덱스 기준)이 아니라 `git checkout HEAD -- package.json`인가. "다른 미커밋 편집도 함께 버려진다"는 경고가 있는가. 빈 디렉터리 잔여를 알리는가. 커밋 후 경로가 단일 도입 커밋이 아닐 때 단일 `git revert`를 권하지 않는가.
- **하위호환**: 인자 없는 `npx commitgate`와 기존 플래그가 불변인가. `bin/init.ts` 변경이 `export`+help로 한정되는가. `package.json` `files`의 `"bin"` 디렉터리 엔트리로 `bin/uninstall.ts`가 배포에 포함되는가(smoke가 검증).
- **테스트가 불변식을 실제로 고정하는가**: 파일 스냅샷 before/after 동일, git 서브커맨드 allowlist, 소스에 쓰기 API 부재, AGENTS.md/req.config.json/package.json 오삭제 지시 없음, 커밋 전/후 분기, `ticketRoot` 존중, `npm cache clean --force` 경고.
- 결함 없으면 findings 없이 승인(비차단 의견은 observations).
