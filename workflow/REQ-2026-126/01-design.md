# REQ-2026-126 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

| 사실 | 위치 | 확인 |
|---|---|---|
| verify-range 코어는 순수·재사용 가능(`verifyRange`/`computeExit`) | `scripts/req/lib/verify-range.ts` | 읽음 |
| CI 조회 축은 `--check-github-ci`로 정리됨(REQ-125) — 실행 축 없음 | `bin/verify-range.ts` | 읽음 |
| `delivery integrate`는 feature→**delivery 브랜치** 통합(trunk 아님) — merge --no-ff·abort 복구·clean/merge-in-progress 가드 관례 | `bin/delivery.ts:625-700` | 읽음 |
| config에 github/CI 키 없음 — additive 확장 지점(RawConfig/ResolvedConfig/DEFAULTS/schema) | `scripts/req/lib/config.ts:101-180` | 읽음 |
| 로컬 로그 유지 규칙 3종 세트(템플릿 앵커·smoke 단언·troubleshooting 표) | `docs/upgrade.md`·REQ-025/038 전례 | 읽음 |
| 저장소 전체에 workflow_dispatch 호출 없음 | grep 실측 | 실측 |

## 핵심 설계 결정

### DEC-1 · verb 이름은 top-level `integrate` — `delivery integrate`와 층이 다름을 문서로 구별

`commitgate integrate` = **현재 feature 브랜치 → trunk** 로컬 통합. `delivery integrate` =
delivery set 내부(feature→delivery 브랜치) 통합. help·docs 양쪽에 한 줄씩 구별 문구.
`merge`라는 이름은 기각 — git merge 자체와 혼동되고, "게이트를 소유한 통합"이라는 의미가 안 담긴다.

### DEC-2 · MergeGate 코어(순수) — 외부 인터페이스 2개

```ts
// scripts/req/lib/merge-gate.ts (git/fs/network/clock 모름)
interface IntegrationFacts {
  currentBranch: string; trunkBranch: string | null; branchPrefix: string
  worktreeClean: boolean
  mergeInProgress: boolean; rebaseInProgress: boolean   // 독립 사실 — 각각 단독으로도 거부(r02 P1)
  trunkExists: boolean
  // 미입증 목록을 보존한다(r03 P1) — plan이 차단 사유에 커밋 목록을 렌더한다(R1-3 "목록 표시").
  verify: { counts: {merge;bookkeeping;approved;unproven}; manifestProblems: number
            unproven: { sha: string; subject: string }[] } | null
}
planIntegration(facts): IntegrationPlan
type IntegrationPlan = {
  ok: boolean
  problems: string[]   // 차단 사유 — 미입증은 각 항목(sha 8자리·subject)이 줄로 포함된다
  steps: string[]      // ok일 때 실행 단계(순서 있는 렌더 가능 계획 — r04 P1): checkout <trunk> →
                       // merge --no-ff <feature> → 감사 로그 1행. bin은 이 steps를 그대로 렌더/실행하고
                       // 순서를 하드코딩하지 않는다(R3 — MergeGate가 계획을 소유).
}
decideCiRun(opts: {flag: boolean|null; configured: boolean; interactive: boolean}): 'run'|'skip'|'ask'|'fail-no-config'
```

실행 단계(체크아웃→merge→복구)는 bin이 소유하되 **순서를 함수 하나(`executeIntegration`)에 캡슐화** —
bin의 runCli는 수집→plan→질문→execute→로그 5줄 흐름만 갖는다. 실패 시 복구:
`merge --abort`(시도) → `checkout <원래 브랜치>`(시도) → 안 되면 수동 안내 출력(자동 reset 금지).

- strict 판정: `unproven > 0 || manifestProblems > 0` → 차단(요구 R1-3). `--strict` 플래그 없음 —
  integrate는 **항상 strict**다(verify-range의 보고 모드와 구별되는 존재 이유).

### DEC-3 · CI 실행 포트 — 식별은 "dispatch 이전 최신 run id 스냅샷 + 이후 초과분" 아닌 **시각·event·ref 필터**

```ts
// scripts/req/lib/github-ci-run.ts
interface GithubCiRunPort {
  dispatch(workflow: string, ref: string): Promise<void>                       // POST .../workflows/{w}/dispatches
  listRuns(workflow: string, ref: string, createdSince: string): Promise<RunInfo[]> // event=workflow_dispatch 필터
  getRun(id: number): Promise<RunInfo>
  remoteBranchSha(ref: string): Promise<string | null>                         // git ls-remote 기반(gh 아님) — null=원격 부재
}
type RunInfo = { id: number; status: string; conclusion: string | null; created_at: string; head_sha: string }
awaitCiRun(port, {workflow, ref, expectedHeadSha, timeoutMinutes, now, sleep}): Promise<CiRunResult>
type CiRunResult = {
  ok: boolean
  reason: string | null      // 실패 사유 = dispatch-실패 | 원격브랜치없음 | 원격SHA≠로컬HEAD(push 필요·자동 push 없음)
                             //   | run-미출현 | 다중후보-식별불가 | timeout | red | cancelled | head_sha-불일치
  runId: number | null       // 선택(식별)된 run — 감사 로그용(r02 P1). 식별 전 실패면 null
  conclusion: string | null  // 선택 run의 실제 conclusion — 감사 로그용. 미완료·미식별이면 null
}
```

- **HEAD 결속(설계 리뷰 r01 P1)**: dispatch 전에 `remoteBranchSha(ref) === expectedHeadSha`(병합할
  로컬 HEAD)를 대조 — 불일치·부재는 실패(미push 커밋을 CI green으로 오인하는 우회 방지). 후보 필터에도
  `head_sha === expectedHeadSha`를 포함하고, 완료 판정 직전 선택 run의 head_sha를 재확인한다.
- 후보가 2개 이상이면 **식별 불가 실패**(오연결 금지 — 요구 R2). 폴링 간격 10초.
- **T 기록 순서(r03 P1)**: `T = now()`를 **dispatch 이전에** 기록하고, 최초·후속 `listRuns`는 전부
  그 동일한 T를 `createdSince`로 쓴다. dispatch가 즉시 run을 만들어도 `created_at >= T`가 보장돼
  자기 run이 후보에서 빠지지 않는다. fake 테스트가 호출 순서(now → dispatch → listRuns(T))와
  T 값 동일성을 단언한다.
- **단일 시계(r02 P1)**: run 출현 대기와 완료 대기를 별도 상한으로 나누지 않는다 — T부터
  `timeoutMinutes` 하나가 전체 마감이다(출현이 늦어도 마감 안에 완료되면 성공. GitHub 대기열 지연이
  정상 실행을 실패로 만들지 않는다).
- `now`/`sleep` 주입 — fake로 시간을 돌린다. 실제 어댑터는 `gh api`(safeSpawnSync)·`git ls-remote`.
- 테스트는 **fake port만** 사용. 실제 gh 스폰 코드는 어댑터 팩토리에만 존재.

### DEC-4 · config `githubCi` (additive)

`RawConfig.githubCi?: { workflow: string; timeoutMinutes?: number }` →
`ResolvedConfig.githubCi: { workflow: string; timeoutMinutes: number } | null`(기본 null=미구성).
스키마: `additionalProperties:false` 객체·`workflow` 필수(비어 있지 않은 문자열)·
`timeoutMinutes` 정수 1~120 기본 30. loadConfig 검증은 기존 관례(잘못된 값 throw).

### DEC-5 · 확인·실행 의미론

- 기본 dry-run: plan·차단 사유·"실행하려면 --run" 출력, 병합 없음(도구 관례).
- `--run` + 대화형: (CI 질문이 있으면 먼저) → 최종 "`<feature>` 를 `<trunk>` 에 병합합니다. 계속하시겠습니까? [y/N] "
  기본 No. `--run` + 비대화형: `--run` 자체가 확정 동작(help·docs 명시).
- CI 질문 문구(고정): `GitHub CI workflow를 실행하시겠습니까? GitHub Actions 사용량 또는 비용이 발생할 수 있습니다. [y/N] `
  — config 부재 시 질문 생략(생략=정상). 선택은 저장하지 않는다.

### DEC-6 · 감사 로그 `workflow/.integrate-runs.jsonl`

`{ at, trunk, feature, base, head, counts, manifest_problems, ci: 'skipped'|'run-ok'|'run-fail'|null(dry-run),
  ci_run_id: number|null, ci_conclusion: string|null, merged: boolean, merge_sha: string|null, exit }`
— CiRunResult의 runId/conclusion을 그대로 기록(r02 P1). CI 출력 본문·커밋 메시지 미기록.
gitignore 미대상이면 기록 생략+경고(`sync --apply --gitignore` 안내). 유지 규칙 3종 세트 동반
(이 저장소 root `.gitignore`에도 규칙 추가 — REQ-025/038 skew 전례 방지).

## Phase별 구현

**Phase 1 (`phase-1-ci-run-port`)** — config `githubCi` 축(schema·config.ts) +
`scripts/req/lib/github-ci-run.ts`(awaitCiRun 순수 판정 + gh/git 어댑터 팩토리 + fake) +
`tests/unit/github-ci-run.test.ts`(식별·다중후보 실패·timeout·red·cancelled·미출현·원격 부재).

**Phase 2 (`phase-2-merge-gate-core`)** — `scripts/req/lib/merge-gate.ts`(planIntegration·decideCiRun) +
`tests/unit/merge-gate.test.ts`(전제 거부 — trunk 위 실행·prefix 불일치·dirty·**merge/rebase 각각 단독**·
trunk 부재 — ·strict 차단·CI 결정표).

**Phase 3 (`phase-3-integrate-verb`)** — `bin/integrate.ts`(수집·질문·executeIntegration·감사 로그·렌더) +
`dispatch.mjs`/`init.ts` 각 1행 + `.gitignore`·`templates/workflow.gitignore`·`scripts/smoke.mjs`·
troubleshooting 표 + `tests/unit/integrate-verb.test.ts`(fake 포트 dry-run/차단/CI 분기 +
**실 git 충돌 복구 1건**).

**Phase 4 (`phase-4-docs`)** — `docs/workflow.md`/`.en` integrate 절(delivery와 구별 포함) ·
`docs/upgrade.md`/`.en` 0.22 절에 integrate·githubCi 항목 · CHANGELOG Unreleased.

## 변경 파일

| 파일 | 변경 | phase |
|---|---|---|
| `workflow/req.config.schema.json` · `scripts/req/lib/config.ts` | githubCi 축 | 1 |
| `scripts/req/lib/github-ci-run.ts` + 테스트 | 신규 | 1 |
| `scripts/req/lib/merge-gate.ts` + 테스트 | 신규 | 2 |
| `bin/integrate.ts` + 테스트 | 신규 | 3 |
| `bin/dispatch.mjs` · `bin/init.ts` | verb·help 각 1행 | 3 |
| `.gitignore` · `templates/workflow.gitignore` · `scripts/smoke.mjs` · `docs/troubleshooting.md`/`.en` | 로그 유지 규칙 | 3 |
| `docs/workflow.md`/`.en` · `docs/upgrade.md`/`.en` · `CHANGELOG.md` | 문서 | 4 |

## 테스트 oracle (완료 기준 ↔ 검증)

| 완료 기준 | 오라클 | 잡는 결함 |
|---|---|---|
| 1·2 | planIntegration 표(전제 6종 — merge/rebase 독립 — ·미입증>0·manifest>0 차단·**차단 사유에 미입증 sha·subject 목록 포함**·**ok 시 steps 순서 산출**) + dry-run이 plan.steps를 렌더하고 merge 미호출(fake git 호출 기록) | 검증 생략 병합·rebase 중 통합·목록 없는 불투명 차단·bin 순서 하드코딩 |
| 3 | decideCiRun 결정표 + awaitCiRun fake 시나리오(원격SHA 불일치·head_sha 불일치·**늦은 출현 후 마감 내 성공=ok**·runId/conclusion 반환·**now→dispatch→listRuns(T) 호출 순서와 T 동일성**) | config 추측·무한 대기·조용한 실패·미push HEAD 우회·대기열 지연 오실패·자기 run 제외 |
| 4 | listRuns 필터 인자(createdSince·ref) + head_sha 필터 단언 + 다중 후보 → 실패 | 과거 run 오연결 |
| 5 | 실 git repo에서 충돌 유발 → abort·브랜치 복귀·worktree clean 단언 | 파괴적 실패 |
| 6 | 로그 1행 스키마 + smoke `git check-ignore` | 로그 유실·skew |
| 7 | 테스트 내 gh 스폰 부재(fake 주입 구조) — 어댑터 팩토리는 인자 조립만 단위 검증 | 실호출 유출 |

## 하위호환·안전

- 신규 verb·additive config — 미사용 시 동작 변화 0. push·PR·자동 CI 실행 경로 없음.
- revert로 완전 복구(로그 파일은 로컬·gitignored).
