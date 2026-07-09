# REQ-2026-007 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님).

## Phase 1 — planner core (`phase-1-planner-core`)

범위(코드 5파일):
- [bin/uninstall.ts](../../bin/uninstall.ts) **신규** — `collectFacts`(읽기 전용 IO) / `buildPlan`(순수) / `renderPlan`(순수) / `parseArgs` / `runUninstall` / `runCli`.
- [bin/commitgate.mjs](../../bin/commitgate.mjs) — `argv[0] === 'uninstall'` verb dispatch. 그 외 인자는 현행 init 경로로 그대로 전달.
- [bin/init.ts](../../bin/init.ts) — `PACKAGE_ROOT`·`REQ_SCRIPTS`·`REQ_DEV_DEPS`·`assertGitWorkTree`에 `export` 추가 + 인라인 스키마 배열을 `export const KIT_SCHEMA_RELPATHS`(= `workflow/machine.schema.json`, `workflow/req.config.schema.json`)로 승격해 `runInit`이 그 상수를 쓰게 함(D3b SSOT, 동작 불변) + `printHelp`에 `uninstall` 1줄.
- [tests/unit/uninstall.test.ts](../../tests/unit/uninstall.test.ts) **신규** — 아래 불변식 고정(Red 먼저).
- [scripts/smoke.mjs](../../scripts/smoke.mjs) — pack tarball 설치본에서 `npx --no-install commitgate uninstall` rc=0 1스텝 추가(배포 아티팩트의 verb 해소 검증).

### Test-First — 먼저 Red로 고정할 불변식
1. **읽기 전용(행동)**: 임시 repo의 전체 파일 스냅샷(경로 + sha256)이 planner 실행 전후 **동일**.
2. **읽기 전용(git)**: 주입한 `GitRunner`가 받은 서브커맨드가 전부 allowlist(`rev-parse`/`status`/`ls-files`/`log`) 안에 있고, `restore`/`clean`/`revert`/`checkout`/`reset`/`add`/`commit`/`rm`은 **0회**.
3. **읽기 전용(구조)**: `bin/uninstall.ts` 소스에 fs 쓰기 API 식별자(`writeFileSync`·`rmSync`·`unlinkSync`·`mkdirSync`·`copyFileSync`·`renameSync`·`appendFileSync`)가 등장하지 않음.
4. **AGENTS.md**: 템플릿과 다른 내용의 기존 `AGENTS.md`가 있을 때, 출력이 그 삭제를 지시하지 않고 `보존/수동 검토` 분류에 놓인다.
5. **req.config.json 병합 케이스**: 사용자 키(`branchPrefix: "team/"`)를 가진 config에 대해, 출력이 파일 삭제를 지시하지 않고 사용자 값 보존을 안내한다.
6. **package.json**: 기존 `req:doctor`(사용자 값)·기존 `cross-spawn`이 있을 때 `req:*` 4키 + devDep 3키의 **일괄 삭제를 지시하지 않는다**.
7. **커밋 전/후 분기**: kit 경로가 전부 untracked인 repo와 커밋된 repo에서 안내 섹션이 서로 다르다(후자만 도입 커밋 후보 sha + `git revert` 제시).
8. **ticketRoot 존중(증거 축)**: `req.config.json`의 `ticketRoot`가 `docs/req-tickets`인 repo에서, 증거 디렉터리를 하드코딩 `workflow/`가 아니라 설정값에서 인식한다.
9. **설치 경로 ≠ 설정 경로(D3b, custom-ticketRoot)**: 같은 `ticketRoot=docs/req-tickets` repo에서 —
   - `workflow/machine.schema.json`·`workflow/req.config.schema.json`(init이 실제로 복사한 잔여물)이 여전히 `tool`로 정확히 분류된다.
   - `docs/req-tickets/req.config.schema.json` 같은 **존재하지 않는 footprint를 주장하지 않는다**.
   - `docs/req-tickets/REQ-*`의 `approvals.jsonl`이 `evidence`로 보호된다.
   - `schemaPath`가 `workflow/machine.schema.json`이 아닐 때 그 경로는 제거 후보가 아니라 정보 행으로만 나온다.
10. **npx 캐시 섹션**: 출력에 `_npx` 제거 명령과 **`npm cache clean --force`가 제거 명령이 아니라는 경고**가 포함된다.
11. **package.json 안내 형태**: 출력에 `git checkout HEAD -- package.json`이 있고 인덱스 기준 `git checkout -- package.json`은 **없다**.

Exit: `npm run typecheck` 0 · `npm test` 그린 · `npm run smoke` 그린 · `req:doctor` PASS · Codex phase 리뷰 승인(STEP_COMPLETE).

## Phase 2 — 제거 문서화 (`phase-2-docs`)

범위(2파일): [README.md](../../README.md) · [README.en.md](../../README.en.md) — "설치가 하는 일" 섹션 **바로 뒤**에 제거/정리 섹션 신설 + cheat-sheet에 `uninstall` 행 추가.

필수 포함(00-requirement 검증된 사실 기준):
- `npx commitgate`는 **전역 설치가 아니다** — npm 캐시(`_npx/<hash>`)를 통해 실행된다.
- 대상 repo에 추가되는 것: `scripts/req/`, `workflow/machine.schema.json`·`workflow/req.config.schema.json`(← `ticketRoot` 설정과 무관하게 항상 `workflow/`), `req.config.json`, `AGENTS.md`, `package.json`의 `req:*` scripts + `ajv`/`cross-spawn`/`tsx` devDependencies.
- **미커밋**이면 `git status`/`git diff`로 확인 후 직접 되돌린다(`git checkout HEAD -- package.json` 주의사항 포함).
- **이미 커밋**했다면 스캐폴딩 도입 커밋을 `git revert`한다.
- Windows / macOS / Linux 별 npx 캐시(`_npx`) 제거 명령.
- ⚠️ `npm cache clean --force`는 `_npx`를 지우지 않으며 **CommitGate 제거 명령이 아니다**.
- `AGENTS.md`·`req.config.json`·`package.json` 기존 값과 `<ticketRoot>` 증거는 자동 제거 대상이 아니라는 경고.
- `npx commitgate uninstall`이 **아무것도 지우지 않는** 계획 출력 전용임을 명시.

Exit: `npm run typecheck` 0 · `npm test` 그린 · `req:doctor` PASS · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(unit·typecheck·smoke) · 사용자 main 머지(별도 승인).
