# 08. 아키텍처·모듈 명세

## 1. 런타임 구성 개요

CommitGate는 **로컬 CLI 프로세스**의 집합이다. 서버·데몬·장기 실행 컴포넌트가 없다. 각 명령은 짧게 실행되고 종료하며, 상태는 전부 파일(git 저장소)에 있다. 외부 프로세스로 `git`(항상)과 `codex`(리뷰 시)를 스폰한다.

```mermaid
flowchart TB
    subgraph bin["bin/ (설치·진입)"]
        LAUNCH["commitgate.mjs<br/>tsx 등록·verb 동적 import<br/>(부작용 경계)"]
        DISPATCH["dispatch.mjs<br/>resolveDispatch·VERB_MODULES<br/>(순수 결정 로직)"]
        INIT["init.ts<br/>설치 코어"]
        MIGRATE["migrate.ts<br/>Stage A→B 전환"]
        UNINST["uninstall.ts<br/>제거 플래너"]
    end
    subgraph cmds["scripts/req/ (워크플로 CLI)"]
        NEW[req-new.ts]
        NEXT[req-next.ts]
        REVIEW[review-codex.ts]
        DOCTOR[req-doctor.ts]
        COMMIT[req-commit.ts]
    end
    subgraph lib["scripts/req/lib/ (공유)"]
        CONFIG[config.ts]
        ADAPT[adapters.ts]
        PORC[porcelain.ts]
        SCRATCH[scratch.ts]
    end
    LAUNCH -. resolveDispatch import .-> DISPATCH
    LAUNCH --> INIT & MIGRATE & UNINST
    LAUNCH --> NEW & NEXT & REVIEW & DOCTOR & COMMIT
    UNINST -.imports SSOT 상수.-> INIT
    MIGRATE -.imports SSOT 상수.-> INIT
    NEW & NEXT & REVIEW & DOCTOR & COMMIT --> CONFIG
    NEW & NEXT & REVIEW & DOCTOR & COMMIT --> ADAPT
    NEW & NEXT & REVIEW & DOCTOR --> PORC
    NEW & NEXT & REVIEW & DOCTOR --> SCRATCH
    NEW -.helpers: writeState·WorkflowState.-> REVIEW
    NEXT -.helpers 재사용.-> REVIEW
    DOCTOR -.helpers 재사용.-> REVIEW
    COMMIT -.helpers 재사용.-> REVIEW
    COMMIT -.isConfinedArchivePath import + runDoctor 스폰.-> DOCTOR
    ADAPT --> GIT[(git)]
    ADAPT --> CODEX[(codex)]
```

의존 방향: 모든 명령 → lib → 프로세스(git/codex). 단 lib 중 **config·adapters는 5개 명령 전부**가 직접 import하고, **porcelain·scratch는 `req-new`·`req-next`·`review-codex`·`req-doctor` 4개만** 직접 import한다(`req-commit`은 porcelain·scratch를 직접 import하지 않고 `review-codex`/`req-doctor`를 통해 간접 사용). 추가로 **명령 계층 내부에 공유 헬퍼 허브**가 있다 — `review-codex.ts`가 `writeState`·`WorkflowState`와 바인딩/검증 헬퍼를 export하고 `req-new`·`req-next`·`req-doctor`·`req-commit`이 모두 이를 import한다([scripts/req/req-new.ts](../../scripts/req/req-new.ts):15 `import { writeState, type WorkflowState } from './review-codex'` 등). 또 `req-commit`은 `req-doctor`의 `isConfinedArchivePath`를 import하고 실행 시 `req-doctor`를 자식 프로세스로 스폰한다. 방향은 항상 `→ review-codex`(그리고 `req-commit → req-doctor`)로 단일하여 **순환 의존은 없다.** `uninstall.ts`와 `migrate.ts`는 `init.ts`의 SSOT 상수(`REQ_SCRIPTS`·`KIT_*`)를 import해 설치기·제거기·전환기 간 드리프트를 원천 차단한다.

**Stage B에서 `bin/`은 설치 진입점이자 워크플로 진입점이다**(REQ-2026-014). 대상 저장소의 `req:*`가 `commitgate <verb>`이므로 다섯 워크플로 CLI도 이 런처를 거쳐 **패키지 안에서** 실행된다 — 대상에 복사된 사본이 아니다. `bin/` 내부는 **결정과 부작용이 분리**돼 있다: [bin/dispatch.mjs](../../bin/dispatch.mjs)의 `resolveDispatch`·`VERB_MODULES`는 argv→모듈 결정만 하는 순수 함수라 프로세스 없이 검증되고([tests/unit/dispatch.test.ts](../../tests/unit/dispatch.test.ts)), [bin/commitgate.mjs](../../bin/commitgate.mjs)는 `tsx/esm/api` register와 동적 import라는 부작용만 담당한다.

## 2. 모듈별 명세

### 2.1 `lib/config.ts` — 설정 SSOT
- **책임**: `req.config.json` 로드·검증·경로 confinement, `DEFAULTS` 병합, pm별 스크립트 호출 조립.
- **공개 인터페이스**: `loadConfig(opts): ResolvedConfig`, `resolveRoot`, `buildScriptInvocation(pm, script, args)`, `DEFAULTS`, `DEFAULT_REVIEW_PERSONA_RELPATH`, `CONFIG_SCHEMA`.
- **소유 데이터**: 없음(파싱만). **의존**: `ajv`(간접), fs.
- **오류 처리**: 스키마 위반·경로 이탈 → throw(fail-closed). nullable은 `!==undefined` 병합으로 명시적 null 보존.

### 2.2 `lib/adapters.ts` — 프로세스 경계
- **책임**: shell 없는 안전 spawn, git/codex 어댑터.
- **공개 인터페이스**: `safeSpawnSync`, `createGitAdapter(root, run?)`, `createCodexReviewerAdapter(run?)`, `createFakeReviewerAdapter(result)`(테스트 더블), `parseThreadId`, `deriveStrictOutputSchema`.
- **의존**: `cross-spawn`, node fs/os/crypto. **리프 모듈**(req 스크립트 의존 없음).
- **오류 처리**: `res.error` 또는 `status!==0` → throw `명령 실패(exit=...)`.

### 2.3 `lib/porcelain.ts` — git status 파서
- **책임**: `git status --porcelain=v1 -z --untracked-files=all` 디코딩 단일 지점.
- **공개**: `parseStatusZ`, `entryPaths`, `isUntracked`, `isRenameOrCopy`, `formatStatusEntry`, `STATUS_Z_ARGS`.
- **오류**: 레코드 형식 오류·truncated rename → throw.

### 2.4 `lib/scratch.ts` — scratch 판정 SSOT
- **책임**: clean-tree에서 무시할 도구 산출물 정의(두 범위: 현재 티켓 리뷰 scratch vs req:new 넓은 예외).
- **공개(export)**: `reviewScratchPaths`, `TOOL_OUTPUT_BASENAMES`, `isToolOutputScratch`, `isAllowedResponsesScratch`, `isArchiveFileName`, `sourceCommitForbiddenStaged`, `REVIEW_LEDGER_RELNAME`, `ARCHIVE_BASE_RE` (2026-08-01 전수 검증). (`ARCHIVE_NAME_RE`은 export되지 않는 모듈 내부 `const`이며 `isArchiveFileName`을 통해서만 노출된다. `ARCHIVE_BASE_RE`는 두 술어의 단일 원천이라 export된다 — `req-next.ts`의 `PHASE_ID_RE`와 `review-codex.ts`의 호출 전 가드가 이것을 쓴다, REQ-2026-096.)
- **핵심 안전**: `state.json`·`responses/**`는 req:new 예외에서 **제외**(증거 변조 구멍 차단). responses/ scratch는 미추적 아카이브 1개만 허용.

### 2.5 `req-new.ts` — 티켓 생성
- **책임**: REQ 채번, 브랜치·티켓·문서·초기 state 생성, 스캐폴드 커밋.
- **공개(테스트 대상)**: `validateSlug`, `nextReqId`, `branchName`, `buildInitialState`, `findReqNewDirtyEntries`.
- **의존**: config, adapters, porcelain, scratch, **review-codex(`writeState`·`WorkflowState`)**. **부작용**: 브랜치·파일·커밋.

### 2.6 `req-next.ts` — 결정 엔진(읽기 전용)
- **책임**: state+git → 다음 행동(kind). **쓰기 없음**(`createReadOnlyGit` 허용목록 + `--no-optional-locks`).
- **공개**: `resolveNext`, `NEXT_EXIT_CODES`, `nextPhaseId`, `createReadOnlyGit`.
- **소유 데이터**: 없음. **오류**: state 신뢰불가 → BLOCKED(진단 포함).

### 2.7 `review-codex.ts` — 리뷰 오케스트레이터
- **책임**: 프롬프트 조립, 바인딩 캡처, codex 호출, 응답 검증(AJV+도메인), verdict 적용, 아카이브, 증거 핀.
- **공개(재사용)**: `validateVerdict`, `validateResponseStructure`, `captureGitBinding`, `captureDesignBinding`, `captureIndexHash`, `findUnstagedOrUntracked`, `applyVerdict`, `classifyReview`, `REVIEW_EXIT_CODES`, `loadReviewPersona`, `writeState`, `loadState`.
- **의존**: 전 lib + codex. **오류**: 페르소나/응답/바인딩 이상 → throw 또는 비-0 exit.

### 2.8 `req-doctor.ts` — 일관성 게이트
- **책임**: D-체크 실행, FAIL 시 exit 1. `review-codex` 헬퍼 재사용.
- **공개(export)**: `runChecks`, `finalizeD9Check`, `phaseGranularityWarnings`. (`evidenceProblems`은 export되지 않는 모듈 내부 함수로, D16/D17 검사가 내부에서 호출한다.)
- **부작용**: 티켓 상태·소스 파일 변경 없음(검사만, 자동 수정 없음). 단 `req:next`와 달리 read-only git 어댑터를 쓰지 않으므로, `git write-tree`가 `.git/objects`에 tree object를, `git status`가 `.git/index` stat-cache를 갱신할 수 있다.

### 2.9 `req-commit.ts` — 커밋 래퍼
- **책임**: doctor 게이트 → HIGH 확인 → 소스 커밋 → evidence-finalize → consume. 복구/설계확정 모드.
- **공개(테스트)**: `buildManifestEntry`, `validateManifest`, `consumeState`, `userConfirmGate`, `evidencePreflight`, `resolveMessageSource`, `buildCommitArgs`, `resolveRecoverySource`.
- **부작용**: 2커밋 + state 쓰기. `req:doctor`를 자식 프로세스로 스폰(fail-closed).

### 2.10 `bin/dispatch.mjs` / `bin/commitgate.mjs` / `bin/init.ts` / `bin/migrate.ts` / `bin/uninstall.ts`

- **dispatch.mjs**: `resolveDispatch(argv)` → `{entry, rest}` 또는 `{unknown}`. **부작용 없는 순수 결정 로직**이라 런처와 유닛 테스트가 공유한다. verb 표의 SSOT는 `VERB_MODULES`다:

  | `argv[0]` | 위임 대상 | 비고 |
  |---|---|---|
  | `req:new`·`req:next`·`req:review-codex`·`req:doctor`·`req:commit` | `../scripts/req/<모듈>.ts` | **패키지 안**에서 실행(Stage B 무복사) |
  | `init` | `init.ts` | |
  | `migrate` | `migrate.ts` | |
  | `uninstall` | `uninstall.ts` | |
  | 없음, 또는 `-`로 시작 | `init.ts`(argv **전체** 전달) | 하위호환 — `npx commitgate --dry-run` 등 |
  | 그 외 비-옵션 토큰 | `{unknown}` → **fail-closed** | 오타를 조용히 init으로 보내지 않는다 |

  알려진 verb는 토큰을 소비하고 나머지만 `rest`로 넘긴다. 각 대상 모듈은 `runCli(argv)`(예외 → 1줄 메시지 + exit 1 경계)를 export한다.
- **commitgate.mjs**: `tsx/esm/api` `register()` 후 `resolveDispatch` 결과를 **동적 import**해 `runCli(rest)` 호출, `unknown`이면 1줄 오류 + exit 1. 플래그 파싱은 하지 않는다(각 모듈 `parseArgs`의 책임). ⚠️ `runCli`를 **await 없이** 호출하므로 대상 모듈은 전부 sync여야 한다 — async면 오류가 unhandledRejection이 되고 exit code가 소실된다.
- **init**: 프리플라이트(git work tree → package.json 존재·shape → **Stage B 전제** → cross-spawn 하한 → config 스키마 → dest confinement → gitignore·더티) → Apply(**관리 자산 배치** + `req:* = commitgate <verb>` 주입). 프리플라이트 throw 시 **파일을 하나도 쓰지 않는다**가 계약이다.
  - **Stage B 전제는 순서가 계약**이다: `detectStageA`(설계결정 D19 — Stage A 서명이면 무쓰기 중단 + `commitgate migrate` 안내) **→** `commitgateDeclared`(설계결정 D14 — `devDependencies.commitgate` **키 존재만** 확인, 값 형태는 미검증. `npm i -D <tgz>`는 `file:…tgz`를 쓴다). 뒤집으면 Stage A 설치본에는 `devDependencies.commitgate`가 **없으므로** 사용자가 항상 D14에서 먼저 죽어 migrate 안내에 영원히 도달하지 못한다. 여기의 D19/D14는 REQ-2026-014의 **설계 결정 ID**이며 doctor D-체크와 다른 번호 공간이다([07 §3](07-business-rules-and-state-machines.md)).
  - `planInstall`은 `scripts/req/**`를 **복사하지 않고**, `tsx`·`ajv`·`cross-spawn`을 **주입하지 않는다** — 런타임과 그 의존은 `commitgate` 패키지의 `dependencies`에 있다.
  - SSOT 상수: `KIT_*`(복사 축) · **`REQ_SCRIPTS` = Stage A 서명 SSOT**(`detectStageA`·`migrate`·`uninstall`이 바이트 정확 일치 판정에 사용 — "무엇을 주입하는가"가 아니라 **"과거에 무엇을 주입했는가"의 기록**) · **`STAGE_B_REQ_SCRIPTS`** = 실제 주입값(키는 `REQ_SCRIPTS`에서 파생해 SSOT 단일 유지) · **`REQ_DEV_DEPS`는 legacy 분류용으로만 남는다**(주입에 쓰이지 않고 `uninstall`이 Stage A 설치본 분류에 읽는다).
- **migrate**: `package.json`의 `req:*` 중 **현재 값이 정확히 Stage A 주입값인 키만** `commitgate <verb>`로 전환(`decideScripts` → `convert`/`stage-b`/`custom`/`absent`). 불변식: **기본 dry-run**(`--apply`에서만 쓰기) · 쓰기 범위 **`package.json` 한 파일**(그래서 다중 파일 rollback 프레임워크가 없다) · **비파괴**(`scripts/req/**`·스키마·persona·config·진입점·`workflow/REQ-*` 증거를 삭제하지 않고 안내만) · 사용자 정의 값 **미덮어씀**(보존 + 수동 조치 안내 — 한 글자만 달라도 사용자 값) · **커밋하지 않음** · **동기 구현**(런처가 await하지 않는다). `--apply` 전 `commitgateDeclared` 확인. 대상 root는 **`--dir`(기본 cwd)로만** 해소한다 — `resolveRoot` fallback을 타면 CommitGate 패키지 자신의 `package.json`을 재작성한다.
- **uninstall**: init의 SSOT 상수 import, 파일 분류(identical/differs/ambiguous/evidence/unknown), 도입 커밋 탐색, 계획 출력. **read-only 안내 전용** — `node:fs` 조회 API만 import하고(**쓰기 API 미import = 구조적 계약**) 삭제 플래그(`--run`/`--force`)가 **없다**. git은 read-only 서브커맨드 allowlist(`rev-parse`·`status`·`ls-files`·`log`)만, 해시는 `node:crypto`로 계산(`git hash-object`는 objects/에 쓸 수 있다). **npm을 spawn하지 않는다** — 런타임 제거(`npm uninstall -D commitgate`)는 **문자열로 출력만** 하고 사용자가 package manager로 실행한다.

### 2.11 통합·검증 축 (0.22 — verify-range / attest / integrate)

커밋 **단위** 게이트(doctor·commit)와 층이 다른 **범위(range) 축**이다. "이 커밋이 승인됐는가"가 아니라
"이 **범위의 모든 커밋**이 승인 증거로 설명되는가"를 묻는다.

| 모듈 | 책임 | 비고 |
|---|---|---|
| `lib/verify-range.ts` | **순수 분류 코어**. `verifyRangeDeep(input)` → 심층 **6범주** `merge` / `bookkeeping` / `approved` / `attested` / `invalid-evidence` / `unproven` + `manifestProblems` | git·fs를 모른다 |
| `bin/verify-range.ts` `collectDeepInput` | **수집**(프로세스 수 상한 계약): `log`×2 + `ls-tree`×1 + merge당 `diff-tree` + blob 배치 ≤2. manifest 수 N에 비례하는 프로세스를 만들지 않는다 | `integrate`·`report`가 **이 함수를 공유**한다(수집 분기 금지) |
| `lib/git-batch.ts` | `git cat-file --batch` 1프로세스로 다수 blob 읽기 | 0.21의 manifest당 `git show` N+1(실측 ~29.5초)을 대체 |
| `lib/attestations.ts` + `bin/attest.ts` | `commitgate attest` — **정당한 예외의 명시 승인 기록**. 커밋 identity(tree 포함)에 결속 | 🔴 `invalid-evidence`(손상 증거)는 **attest로 면제되지 않는다** — 수정이 유일한 해법 |
| `lib/merge-gate.ts` | 통합 전제·strict 증거 판정의 **순수 코어**(`planIntegration`) + CI 실행 결정(`decideCiRun`) | 실행 순서를 bin이 하드코딩하지 않게 계획을 반환한다 |
| `lib/integration-coordinator.ts` | **준비 토큰(`PreparedIntegration`) + 재검증 + CAS 병합**. 검증한 feature/trunk SHA가 병합 직전까지 그대로일 때만, 그 SHA를 정확히 병합한다 | 아래 §2.11.1 |
| `lib/github-ci-run.ts` (`GithubCiRunPort`) | GitHub CI **실행**(workflow_dispatch) 포트 | 아래 §2.11.2 |
| `bin/integrate.ts` | 인자 파싱·질문·출력·감사 로그(`workflow/.integrate-runs.jsonl`)만 | 판정·실행은 위 두 모듈이 소유 |

#### 2.11.1 병합 결속 불변식 (compare-and-swap)

> 검증한 feature SHA와 trunk SHA가 병합 직전까지 그대로일 때만, 검증한 feature SHA를 정확히 병합한다.

CI 대기(최대 `timeoutMinutes`분)와 사람의 [y/N] 확인 사이에 ref가 움직일 수 있으므로, 병합 직전
`rev-parse` 한 번으로 끝내지 않는다. 실행 순서:

1. 재검증 — 현재 브랜치 · `refs/heads/<feature>` · `refs/heads/<trunk>` · worktree clean · merge/rebase 진행 여부
2. `git checkout --detach <trunkHeadSha>` (브랜치 이름이 아니라 **SHA**)
3. `git merge --no-ff <featureHeadSha>` (여기도 **SHA**)
4. 생성된 merge commit의 부모가 `[trunkHeadSha, featureHeadSha]` 인지 대조
5. `git update-ref refs/heads/<trunk> <mergeSha> <trunkHeadSha>` — **compare-and-swap**
6. `git checkout <trunk>`

2~5 사이에 trunk가 움직이면 5가 실패하고 **trunk ref는 변하지 않는다**. 어떤 실패에서도 `merge --abort`를
시도하고 원래 feature 브랜치로 복귀한다. 자동 reset·stash·브랜치 삭제·push는 하지 않는다.

#### 2.11.2 GitHub CI 실행 포트 — 확정 정책

🔴 **기본 실행하지 않는다.** `.github/workflows/ci.yml`은 `workflow_dispatch` 전용이고, push·tag·PR로
Actions가 자동으로 도는 경로는 **없다**. 실행 조건은 (a) `--run-github-ci` 명시, 또는 (b) `req.config.json`에
사용자 소유 `githubCi` 설정이 있고 대화형 [y/N]에서 `y`인 경우뿐이다. **질문의 기본값은 No**이며
Enter·빈 문자열·`n`은 모두 미실행이다. 설정이 없으면 질문하지 않고 생략한다(생략은 정상 상태).

- **run 식별은 추정하지 않는다.** dispatch 요청에 `return_run_details=true`(boolean)를 실어 응답의
  `workflow_run_id`만 쓴다. 목록 조회로 이번 run을 추측하는 경로는 **삭제**됐다(포트에 `listRuns`가 없다).
  ID를 얻지 못하면 조용히 다른 방법으로 넘어가지 않고 실패한다.
- **정체 대조**: `head_sha` == 결속한 feature SHA · `event` == `workflow_dispatch` · `head_branch` == 요청 브랜치 ·
  (응답에 있으면) workflow path 일치. 폴링마다 확인한다.
- **성공은 `success`뿐**이다. `skipped`(요청했는데 실행되지 않음)·`neutral`(판정 없음)은 통과가 아니다.
  이 축은 조회 축(`judgeCheckRunsPayload`)보다 **의도적으로 엄격하다**.
- 실패·timeout·식별 불가면 **병합하지 않는다**.

### 2.12 관측 축 (0.22 — report / doctor 스키마 v2)

| 모듈 | 책임 |
|---|---|
| `lib/report.ts` + `bin/report.ts` | `.doctor-runs` · `.review-calls` · `.verify-runs` 세 로그 + verify-range 심층 요약의 **읽기 전용 집계**. 범위 옵션 `--base` / `--head` / `--last N`. verify-range 수집 실패는 null로 삼키지 않고 `verification_available` / `verification_unavailable_reason`(additive 필드)로 사유를 드러낸다 |
| doctor 관측 스키마 **v2** | 행마다 `evaluations[]`(`applicable` · `outcome` · `blocked` · `reason_code`)를 남겨 **검사별 적용 가능 분모**를 연다. v1 행과 **하위호환**이며, report는 v2 행만 분모로 집계하고 v1 행 수를 함께 표기한다(추정 금지) |

### 2.13 테스트 외부 호출 kill switch (0.22)

테스트 setup이 `COMMITGATE_TEST=1`을 설정하고(자식 프로세스로 상속), production 어댑터의 **현재 알려진**
외부 호출 경로 — codex · `gh` · `git ls-remote` · `fetch` — 가 spawn 이전에 즉시 실패한다(`assertNotTestEnv`).

🔴 이것은 **보편적 샌드박스가 아니다.** 새 모듈이 새 방식으로 밖에 나가면 kill switch는 그것을 모른다.
그래서 `tests/unit/external-call-boundary.test.ts`가 **경계 자체를 고정**한다: 프로세스를 스폰하거나
원격·과금 대상을 다루는 production 파일의 allowlist를 유지하고, 목록 밖에서 그런 코드가 생기면 red다.
**로컬 git은 막지 않는다** — 정상 동작이고 원격 효과가 없다.

## 3. end-to-end 시퀀스

### 3.1 설계 리뷰(`req:review-codex --kind design --run`)
```mermaid
sequenceDiagram
    participant B as Builder
    participant R as review-codex
    participant G as git
    participant C as codex
    B->>R: --kind design --run
    R->>R: loadConfig·loadState·페르소나 로드
    R->>G: rev-parse HEAD / write-tree (바인딩)
    R->>G: ls-files -s -- 00/01/02 (designHash)
    R->>G: show :00/:01/:02 (본문)
    R->>R: 프롬프트 조립 → .review-preview.txt
    R->>R: findUnstagedOrUntracked (clean 확인)
    R->>C: exec --sandbox read-only -c model/effort (stdin)
    C-->>R: JSONL + last message
    R->>G: write-tree (사후 무변경 확인)
    R->>R: AJV+validateVerdict → applyVerdict
    R->>R: responses/design-rNN-approved.json 아카이브
    R->>R: design_approval_evidence 핀 · writeState
    R-->>B: outcome(exit 0/1/2/3)
```

### 3.2 phase 리뷰 → 커밋
```mermaid
sequenceDiagram
    participant B as Builder
    participant RV as review-codex
    participant DC as req-doctor
    participant CM as req-commit
    participant G as git
    participant C as codex
    B->>RV: --kind phase --phase p --run
    RV->>G: diff --cached (권위 아티팩트)
    RV->>C: 리뷰 요청
    Note over RV: 승인 시 approved_diff_hash=write-tree,<br/>commit_allowed=true
    B->>CM: --run -m "..."
    CM->>DC: runDoctor (자식 프로세스, fail-closed)
    CM->>CM: userConfirmGate(HIGH)
    CM->>G: write-tree == approved_diff_hash? (stale 검사)
    CM->>CM: evidencePreflight
    CM->>G: commit (소스, 승인 코드만)
    CM->>G: add responses/* + approvals.jsonl → commit (evidence-finalize)
    CM->>CM: consumeState (commit_allowed 소비)
```

## 4. 일관성·장애 경계
- **캐시/큐/외부 스토리지 없음** — 상태는 오직 git + 티켓 파일. 단 `state.json`의 런타임 변경은 git에 자동 내구화되지 않으므로 “git에 전부 재구축 가능”을 뜻하지 않는다. 동시성 이슈는 단일 로컬 사용자 가정으로 최소화(`추론`).
- **git 인덱스 stat-cache**: `req:next`는 `--no-optional-locks`로 인덱스 재기록을 방지(읽기 순수성 보장).
- **codex 장애**: fail-closed throw. 부분 승인 없음.
- **아카이브 쓰기 실패**: swallow되어 증거가 핀되지 않음 → 다음 doctor/commit에서 증거 부재로 차단(`추론` — 안전 방향).
- **evidence-finalize 중단 복구**: `pending_evidence_for` 마커 + `--finalize`(고아 소스 커밋 복구 포함)로 재개.

## 5. 아키텍처 평가

### 5.1 강점

- **불변 아티팩트 중심**: git tree·blob index·sha256을 경계 값으로 사용해 설명 문자열보다 강한 동일성을 얻는다.
- **순수 코어 분리**: `resolveNext`, `validateVerdict`, manifest·doctor 판정의 많은 부분이 fake adapter로 테스트 가능하다.
- **프로세스 경계 집중**: git/codex 실행을 adapter에 모아 shell 주입·Windows wrapper 회귀를 한 곳에서 통제한다.
- **읽기 전용 명령의 구조적 제한**: `req:next`는 허용 git subcommand를 코드로 제한해 우발 쓰기를 막는다.
- **실패 후 안전 방향**: 응답·증거·아카이브가 불완전하면 커밋이 열리는 대신 doctor/commit에서 닫힌다.

### 5.2 구조적 제약

- **`review-codex.ts`가 공유 도메인 허브이자 CLI 오케스트레이터**다. new/next/doctor/commit이 state type·바인딩·검증 헬퍼를 command 파일에서 import한다. 현재 순환은 없지만 CI verifier·state rebuild·provider 확장을 추가하면 결합도가 빠르게 커진다.
- **state 계약이 선언적 schema가 아니라 분산된 사용 지점 검증**에 있다. 필드 조합의 유효성을 한 곳에서 설명·버전 관리하기 어렵다.
- **증거 읽기 로직이 doctor/commit에 분산**돼 있었다. 0.22에서 범위 검증 축은 `lib/verify-range.ts`(순수 분류)와
  `bin/verify-range.ts`의 `collectDeepInput`(수집)으로 모였고, `integrate`·`report`가 **그 같은 수집·분류를
  공유한다**(수집 분기 금지). doctor/commit의 커밋 단위 판정은 여전히 별도 축이다.
- **자산↔런타임 skew는 부분적으로 감지된다.** Stage B(REQ-2026-014)가 실행 코드를 `node_modules/commitgate`로 옮기면서 vendored 사본(Stage A)의 문제 — 대상 repo마다 흩어진 실행 코드의 계약 버전·보안 패치를 일관되게 유지하기 어려움 — 은 줄었다. 런타임 갱신 지점이 package manager 하나로 모이기 때문이다. 그러나 대상에 남는 **관리 자산**(스키마·persona·config·계약·진입점)은 여전히 **설치 시점의 사본**이고, 패키지를 올려도 자동으로 따라오지 않는다. 현재 방어는 doctor **D20**(배포 자산 content-hash 대조 → WARN)과 `commitgate sync --apply`(스키마 축 재동기화·persona 부재 복원)이다. **여전히 없는 것**: 설치 원장, 3-way merge, rollback([07 §3.1](07-business-rules-and-state-machines.md)).
- **Codex adapter와 외부 전송 정책이 같은 호출 경로에 결합**되어 payload manifest·scanner·격리 컨텍스트를 넣을 명시적 policy port가 없다.

### 5.3 목표 seam

목표 설계를 구현할 때 파일을 한 번에 재작성하지 않고 다음 seam을 먼저 추출한다.

| 목표 모듈 | 책임 | 소비자 |
|---|---|---|
| `domain/state` | versioned state/event type, reducer, invariant | next·review·doctor·repair |
| `domain/evidence` | archive/manifest 읽기·검증·commit 매핑 | doctor·commit·CI verify·report |
| `domain/policy` | profile, 전송·라운드·통제점 판정 | review·next·CI verify |
| `ports/reviewer` | provider 중립 request/result 계약 | Codex·향후 local/enterprise adapter |
| `ports/repository` | read-only/mutating git capability 분리 | 전 명령 |
| `application/*` | use-case orchestration, 오류 코드 | CLI·CI wrapper |

추출 순서는 **evidence reader → state reducer → policy evaluator → CLI adapter**가 안전하다. 먼저 증거 해석을 하나로 만들면 STR-01(CI verifier)과 STR-02(state rebuild)가 같은 코어를 공유한다([14-product-strategy-and-roadmap.md](14-product-strategy-and-roadmap.md) §10).
