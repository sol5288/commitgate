# REQ-2026-011 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

> 이 저장소는 eslint를 두지 않는다(`package.json`에 lint 스크립트 없음). 각 phase의 게이트 해당분은 **typecheck0 · 단위 그린**이다.

## Phase 1 — staged diff 외부 전송 고지 (`phase-1-external-transmission-notice`)

범위: `README.md`, `README.en.md`, `AGENTS.template.md`. 코드 변경 없음.

- `req:review-codex`가 `git diff --cached` 전문을 Codex(OpenAI)로 전송하고, codex가 `--sandbox read-only`로 저장소 루트를 읽는다는 사실을 명시.
- 마스킹·필터·길이 상한이 없다는 점, 리뷰 전 staged 내용에 자격증명이 없는지 확인하라는 지시.
- README 상단에 "git hook을 설치하지 않으므로 `git commit` 직접 호출은 게이트를 우회한다 — 강제력은 협조하는 에이전트를 계약 궤도에 유지하는 데 있다"를 함께 명시(요청서 부록).

Exit: typecheck0 · 단위 그린 · Codex phase 리뷰 승인.

## Phase 2 — 진입점 템플릿 pm-중립화 (`phase-2-pm-neutral-templates`)

범위: `templates/claude-command.md`, `templates/claude-skill.md`, `templates/cursor-rule.mdc`, `templates/CLAUDE.template.md`, `tests/unit/init.test.ts`.

- 명령 예시를 `AGENTS.template.md:84-88`과 같은 bare 표기로 통일: `req:new <slug> --run`, `req:next <REQ-id>`.
- "실행 형태는 저장소의 패키지매니저를 따른다. `commitgate` 설치 출력과 `req:next`의 `RUN` 출력이 정확한 형태를 준다" 한 줄 추가.
- **회귀 가드(신규)**: 설치된 진입점 4종과 `CLAUDE.md`에 `npm run req` / `pnpm req:` 리터럴이 없고 bare `req:next`가 있음을 단언. `f66d45c` 같은 재도입을 CI가 잡는다.

Exit: typecheck0 · 단위 그린 · Codex phase 리뷰 승인.

## Phase 3 — 런타임 문구 pm 파생화 (`phase-3-pm-derived-runtime-strings`)

범위: `scripts/req/req-next.ts`, `scripts/req/req-new.ts`, `scripts/req/req-doctor.ts`, `scripts/req/review-codex.ts`, `tests/`.

DEC-011-1 적용:

| 위치 | 처리 |
|---|---|
| `req-next.ts:589` (loadConfig 이후) | `buildScriptInvocation(cfg.packageManager, 'req:next', ['2026-010'])` |
| `req-new.ts:169` (loadConfig 이후) | `buildScriptInvocation(cfg.packageManager, 'req:review-codex', [id, '--run'])` |
| `review-codex.ts:1064` (cfg 인자) | `buildScriptInvocation(cfg.packageManager, 'req:review-codex', ['2026-001'])` |
| `req-new.ts:115` (loadConfig 이전) | bare `req:new camera-hardfail --run` |
| 헤더 주석 `req-next.ts:18`·`req-new.ts:10`·`req-doctor.ts:8`·`review-codex.ts:16` | bare |

`DEFAULTS.packageManager` 폴백은 쓰지 않는다(npm 프로젝트에 pnpm이 새는 경로).

테스트:
- npm 설정 repo에서 `req:new --run` 성공 안내에 `pnpm` 미포함.
- pnpm 설정 repo에서 `req:next` 인자 누락 throw 문구가 `pnpm req:next 2026-010` 형태.
- **`review-codex.ts:1064` throw 문구도 동일 검증**(design 리뷰 R1 observation — 같은 결함 클래스의 회귀 방지).

Exit: typecheck0 · 단위 그린 · Codex phase 리뷰 승인.

## Phase 4 — `--` end-of-options 흡수 (`phase-4-end-of-options`)

범위: `scripts/req/req-next.ts`, `scripts/req/req-new.ts`, `scripts/req/req-doctor.ts`, `scripts/req/req-commit.ts`, `tests/unit/req-args.test.ts`(신규).

DEC-011-3 적용. **throw하는 4곳만** `a.startsWith('-')` 분기 **앞에** `a === '--' → continue`.
`review-codex.ts`는 대상이 아니다(`:1053`이 unknown 옵션을 throw하지 않아 `--`가 이미 무해).

테스트 매트릭스(신규 파일) — **명령별로 실제 지원하는 플래그를 쓴다**(design 리뷰 R1 P2):

| parseArgs | `['--','2026-011']` | 구분자 뒤 플래그 유지 | 알 수 없는 옵션 |
|---|---|---|---|
| `req-next` | reqId 인식, throw 없음 | `['2026-011','--','--json']` → `json===true` | `['--bogus']` → throw |
| `req-doctor` | 〃 | `['2026-011','--','--finalize']` → `finalize===true` | 〃 |
| `req-commit` | 〃 | `['2026-011','--','--run']` → `run===true` | 〃 |
| `req-new` | slug 인식 | `['my-slug','--','--run']` → `run===true` | 〃 |

`req-next`·`req-doctor`에 `--run`을 주면 여전히 throw해야 한다(그 명령들은 `--run`을 지원하지 않는다) — 이것도 단언한다.

Exit: typecheck0 · 단위 그린 · Codex phase 리뷰 승인.

## Phase 5 — InstallPlan 추출 + gitignore preflight (`phase-5-install-plan-and-gitignore`)

범위: `bin/init.ts`, `tests/unit/init.test.ts`.

> 이 phase는 `runInit`의 preflight/apply 경계를 건드리는 **유일한 구조 변경**이다. 기존 `init.test.ts`가 그 경계(부분 설치 없음·멱등·`--force`)를 이미 지키고 있으므로 회귀는 그 스위트가 잡는다.

> phase-6(안내)의 stage 목록이 `InstallPlan`·`gitIgnoredArtifacts`·`preexistingDirtyPaths`를 입력으로 받으므로 **먼저** 온다(`git add <ignored path>`는 fatal).

DEC-011-5·DEC-011-9·DEC-011-10 적용.

- `planInstall(targetRoot, opts, pm): InstallPlan` — **쓰기 전에** 확정되는 계획(IO는 existsSync/readdirSync만). `planArtifactPaths(plan): string[]`이 산출물 경로 전수를 준다. preflight·apply·안내 셋이 **같은 계획을 읽는다**(R4-P2: `InitResult.copied`는 Apply에서야 채워지므로 preflight가 쓸 수 없다).
- `runInit`의 Apply는 `plan.copies`를 그대로 복사한다(`walkFiles` 재실행 없음). `copied`/`skipped`는 계획에서 파생.
- `preexistingDirty: PreexistingDirty` — **쓰기 전에** `git status --porcelain --untracked-files=all`을 찍어 `{staged, overlapping, unrelated}`로 3분류(DEC-011-11). `overlapping = unstaged·untracked ∩ planArtifactPaths(plan)`. 설치 후엔 산출물과 섞여 구분 불가.
- `--strict`: `staged` 또는 `overlapping`이 비어 있지 않으면 preflight throw(쓰기 0건). 기본 모드는 경고만(비-breaking).
- `LOCKFILE: Record<PackageManager, string>` = `{ npm: 'package-lock.json', pnpm: 'pnpm-lock.yaml', yarn: 'yarn.lock' }`.
- `findIgnoredArtifacts(targetRoot, paths)` — 경로별로 `git check-ignore -q -- <path>`(`0`=무시됨, `1`·`128`=무시 안 됨) **그리고** `git ls-files -- <path>`가 비어 있음(=untracked)일 때만 "제외 대상". tracked 파일은 ignore 규칙에 걸려도 `git add`가 되므로 제외하지 않는다.
- 검사 대상 = `planArtifactPaths(plan)` 전체(진입점만이 아니다 — R3 P3).
- `assertEntrypointPathsUsable` 직후, `agentsContractCopyCreated` 계산 뒤(preflight)에서 호출. 산출물 클래스로 심각도를 가른다:
  - **계약 포인터**(진입점 3종·`CLAUDE.md`·`AGENTS.md`·`AGENTS.commitgate.md`): WARN + 동작하는 `.gitignore` 패턴 제시(부모 디렉터리 제외 함정 포함). `--strict`면 throw.
  - **그 외**(lockfile 등): 경고 없이 stage 목록에서만 제외(무시하는 것이 합법적 정책).
- `InitResult.gitIgnoredArtifacts: string[]`·`InitResult.preexistingDirty: PreexistingDirty` 추가 → `main()` 요약에 노출.

테스트:

- (a) `.gitignore`에 `.claude`를 넣은 임시 repo, 기본 모드: 경고 출력 + `gitIgnoredArtifacts`에 진입점 2종이 담김. 설치는 계속된다.
- (b) 같은 repo, `--strict`: throw. **부분 설치 0건을 전수 검증**(design 리뷰 R1 P2 — `.claude/`·`scripts/req/` 부재만으론 부족):
  - init 실행 **전** 대상 repo의 전체 파일 목록과 각 파일 sha256을 스냅샷.
  - throw 후 다시 스냅샷 → **신규 파일 0개, 내용 변경 0개**를 단언.
  - 특히 `req.config.json`(신규 생성)·`package.json`(수정)·`AGENTS.md`·`CLAUDE.md`가 preflight보다 먼저 쓰이지 않았음을 커버한다.
- (c) lockfile을 `.gitignore`에 넣고 **untracked**인 repo: 경고 없이 `gitIgnoredArtifacts`에만 담기고 `--strict`가 throw하지 **않는다**(계약 포인터가 아니므로).
- (d) lockfile이 `.gitignore`에 걸리지만 **이미 tracked**인 repo: 제외되지 않는다(DEC-011-10).
- (e) staged `M src/foo.ts`가 있는 repo: `preexistingDirty.staged`에 담기고, `--strict`가 throw하며 **파일 0건 생성**.
- (f) unstaged `M package.json`(= 산출물과 겹침)이 있는 repo: `preexistingDirty.overlapping`에 담긴다. `unrelated`에는 담기지 **않는다**.

Exit: typecheck0 · 단위 그린 · Codex phase 리뷰 승인.

## Phase 6 — 설치 직후 안내 정합 (`phase-6-install-guidance`)

범위: `bin/init.ts`, `scripts/req/req-new.ts`, `README.md`, `README.en.md`, `tests/unit/init.test.ts`.

DEC-011-7·DEC-011-8 적용.

- `bin/init.ts:611-617` 안내 재작성:
  - `cd <root> && <pm> install` → **개별 줄로 분리**(PowerShell 5.1·cmd에 `&&` 없음).
  - 커밋 단계 삽입. **`git add -A` 금지** — `planArtifactPaths(plan)`에서 파생한 경로만 나열하고, `git status`로 눈 확인 단계를 넣는다.
  - 위험 고지 한 줄: "brownfield repo의 무관한 변경·미추적 파일(.env 등)이 함께 커밋되면 이어지는 `req:review-codex`가 그것을 외부로 전송합니다."
- `stageList(plan, r) = planArtifactPaths(plan) − r.gitIgnoredArtifacts` (phase-5의 SSOT 재사용 — 목록을 다시 손으로 나열하지 않는다).
- 안내는 `r.preexistingDirty`에 따라 **갈라진다**(DEC-011-11):
  - `staged` 또는 `overlapping`이 있으면 **`git add` 목록을 내지 않는다.** 두 목록을 이유와 함께 출력하고 "해소한 뒤 `git status`로 직접 확인하며 설치분만 커밋하십시오"로 끝낸다.
  - `unrelated`만 있으면 `git add` 목록을 내고, 설치 커밋 **뒤** 단계로 그 경로들과 `git stash -u`(또는 별도 커밋)를 지시한다. **`-u` 없이는 untracked가 남는다**(design 리뷰 R5 P2).
- `req-new.ts:139` clean-tree 에러 메시지에 한 줄: "방금 `npx commitgate`를 실행했다면 **설치분만** 먼저 커밋하십시오(`git add -A` 금지)."
- README·README.en Quick Start 순서 반영(동일 원칙).

테스트:
- `planArtifactPaths`가 `agentsCreated=false` + `contractCopyRel!==null`인 계획에서 **`AGENTS.commitgate.md`를 포함**한다(design 리뷰 R2 P2 회귀 가드).
- `planArtifactPaths`가 `packageJsonRel!==null`일 때 pm별 lockfile을 포함한다 — `npm→package-lock.json`, `pnpm→pnpm-lock.yaml`, `yarn→yarn.lock`(design 리뷰 R3 P2 회귀 가드).
- `stageList`가 `gitIgnoredArtifacts`의 경로를 제외한다.
- 안내 문자열에 `git add -A`가 없고 `&&`가 없다.
- `staged`가 있으면 안내에 `git add ` 목록이 **없다**. `overlapping`이 있어도 마찬가지(DEC-011-11 회귀 가드).
- `unrelated`만 있으면 안내에 `git stash -u`가 포함된다(bare `git stash`가 아님 — R5 P2 회귀 가드).
- **통합 A(clean brownfield)**: 기존 `AGENTS.md`(마커 없음) + 기존 tracked lockfile을 둔 임시 repo → `runInit` → lockfile을 수정해 `<pm> install`을 모사(실제 network install 없이) → 안내의 `git add` 목록대로 stage·commit → `git status --porcelain`이 **빈 문자열**(= `req:new --run`의 clean-tree 게이트 통과)임을 단언.
- **통합 B(unrelated dirty)**: 위와 같되 무관한 `M src/foo.ts`·`?? notes.txt`를 **unstaged로** 미리 둔다 → `runInit` → `preexistingDirty.unrelated`가 그 둘을 정확히 담고 `staged`·`overlapping`이 비었는지 단언(CommitGate 산출물은 담기지 **않는다**) → 안내대로 산출물 커밋 + `git stash -u` → `git status --porcelain`이 빈 문자열.
- **통합 C(staged dirty)**: staged `M src/foo.ts`를 둔 repo → `runInit`(기본 모드) → 안내에 `git add ` 목록이 없고 경고가 있다. `--strict` → throw + 파일 0건.

Exit: typecheck0 · 단위 그린 · Codex phase 리뷰 승인.

## Phase 7 — 문서·버전 (`phase-7-docs-version`)

범위: `package.json`(0.4.0 → 0.5.0), `CHANGELOG.md`, `README.md` 버전 언급.

breaking 없음(D3은 순수 확장, D5 기본 모드는 경고만) → minor.

Exit: typecheck0 · 단위 그린 · Codex phase 리뷰 승인.

## 완료

- 게이트 해당분(unit·typecheck) · 사용자 트렁크 머지(별도 승인).
- 후속 REQ로 넘기는 것: D6(`trunkBranch` config), D7(`reviewTimeoutMs`), D8-A(`preReviewCommand`), 그리고 `00-requirement.md`에 기록한 발견 **5건**(req:new 스크래치 집합, uninstall `match` 미검사, `req-next.ts:514` dead 변수, README 우회 고지, `review-codex` unknown-옵션 침묵). 이 중 "README 우회 고지"는 phase-1에서 처리한다.
