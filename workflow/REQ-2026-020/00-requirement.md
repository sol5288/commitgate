# REQ-2026-020 요구사항 — Companion Skills 내부 번들·설치

## 1. 배경

CommitGate는 **거버넌스 레이어**다 — `req:next`가 다음 행동을 계산하고, Codex 리뷰·승인·증거가 커밋을 게이트한다.
그러나 "무엇을 만들지 정리하는 법", "테스트를 어떻게 먼저 쓰는지", "버그를 어떻게 좁히는지"에 대한 **방법론은 비어 있다**.
Builder는 매번 즉흥적으로 한다.

Matt Pocock의 공개 skills(MIT)에 그 방법론이 정리되어 있다. 이를 **외부 installer 없이** CommitGate 패키지 안에
고정·감사 가능한 형태로 선별 번들해, 설치 시 함께 깔리게 한다.

**이번 REQ는 REQ-A(번들·설치)다.** REQ 문서 템플릿·persona 리뷰 관점 보강은 **REQ-B로 분리**한다(§4).
근거: REQ-2026-015/016/017이 연속 terminal된 원인이 설계 표면 확장이었다. 두 영역은 파일도 리뷰 축도 겹치지 않는다.

> 🔴 **2차 범위 축소(PM 결정 — 설계 리뷰 11회 도달).** opt-out·gitignore·uninstall(구 phase-3)과
> 공존·문서·smoke(구 phase-4)를 **이번 REQ에서 분리**해 후속 REQ로 옮긴다(§4 비목표).
>
> 근거는 **CommitGate 자체의 알려진 결함**이다 — 설계 문서 hash가 한 글자만 바뀌어도 승인 전체가 무효화되고
> **전체 설계가 재검수**된다(Stage B 중단 사유와 동일). 설계 문서 하나가 6개 phase를 덮으니, phase-2b를
> 승인받으려 할 때마다 phase-3·4까지 재검수돼 **무관한 phase의 새 지적이 계속 나왔다**(r09·r10이 실제로 phase-3 oracle 지적).
> 표면을 줄이면 이 되먹임이 끊긴다. **findings는 전부 유효했다** — 문제는 발견이 아니라 검수 면적이다.
>
> 이번 REQ의 완료 상태: companion skills가 **패키지에 실리고 안전하게 설치된다**. 그 자산의 문서·정리 안내는 후속 REQ다.

선행 사실: Stage B(REQ-2026-014) 완료·`0.7.0` 배포로 `commitgate init` verb가 존재한다. 이 REQ는 그 위에서만 성립한다.

> **이 REQ는 REQ-2026-019의 재구현이다.** 019는 Phase 1 HIGH 커밋의 `user_commit_confirmed.confirmed_at`을
> 에이전트가 실제 시계를 읽지 않고 **지어내** 증적이 무효화되어 PM BLOCKED·폐기됐다(브랜치
> `feat/req-2026-019-companion-skills-bundle` 감사 보존, merge 금지).
> **설계 내용은 019의 design r04 승인본(findings 0)을 재사용하되 승인은 이 REQ에서 새로 받는다** — 오염된 것은 증적이지 내용이 아니다.
> 019 리뷰에서 나온 P1 3건(§D8 라이선스·§D4-1 상위 confinement·§D4-3 leaf lstat)은 이미 반영되어 있고,
> PM이 지적한 **본문 결함 4건은 R12로 신규 반영**한다.

## 2. 목표(What)

`commitgate init`이 선별된 4종 companion skill을 대상 프로젝트에 함께 설치한다. 스킬은 **실행 코드가 아니라
instruction asset**이며, CommitGate의 권한 경계를 침범하지 않는 **품질 보조 레이어**다.

## 3. 요구(정규화)

- **R1 번들**: 패키지에 harness-neutral `skills/` 소스 4종(`commitgate-discovery`·`commitgate-tdd`·
  `commitgate-diagnosing-bugs`·`commitgate-research`)과 attribution을 포함한다. packed tarball에 실제로 담긴다. (Done #1)
- **R2 설치 시점**: `npm install` 자체는 대상 프로젝트를 수정하지 않는다. **postinstall 훅을 도입하지 않는다**(현재 없음 — 유지가 요구).
  파일 설치는 명시적 `commitgate init`에서만 일어난다. (Done #2)
- **R3 설치 경로**: `.claude/skills/commitgate-<name>/SKILL.md` 4종. `.agents/skills/`·`.cursor/skills/`에는 설치하지 않는다.
  발견 지원은 **Claude Code ✅ · Cursor IDE ✅ · Cursor CLI ❌(알려진 벤더 버그 — 문서화된 제한) · Codex ❌(설계상 불필요)**.
  Cursor CLI 제한을 우회하려 이중 설치하지 않는다 — 워크어라운드 경로도 CLI에선 동작이 불확실하다(§D1). (Done #3)
- **R4 seed-once**: 대상에 같은 경로 파일이 이미 있으면 **`--force`로도 덮지 않는다.** 사용자가 수정한 스킬은 보존된다. (Done #4)
- **R5 opt-out**: `--no-agent-entrypoints`는 companion skills도 건너뛴다(companion은 `.claude/` 아래에 산다).
  **`--no-companion-skills`는 도입하지 않는다** — 그 플래그는 기존 entrypoint의 gitignore 경고와 충돌해
  R6를 약화시켜야만 성립한다(design-r05 P1). 신규 플래그 표면 0. (Done #5)
  ⚠️ help·README 문서화는 **후속 REQ**(2차 축소 — §4).
- **R6 보안 동등**: 신규 asset도 기존 설치 자산과 같은 수준의 path confinement·symlink 방어·`--dry-run`·`--strict`·`--dir`
  정책을 받는다. 기존 정상 경로를 약화시키지 않는다. ⚠️ **gitignore 경고 축(WARN/strict)은 후속 REQ**(2차 축소 — §4).
  이번 REQ는 기존 gitignore 동작을 **바꾸지 않는다** — companion을 계약 포인터에 섞지 않았으므로 기존 경고는 그대로다. (constraints)
- **R7 권한 경계**: 스킬은 `git commit`·`git push`·`req:commit` 직접 호출·`state.json`/`responses` stage를 하지 않는다.
  `req:next`의 `RUN`/`AGENT`/`AWAIT_HUMAN`/`BLOCKED`/`DONE` 의미를 바꾸지 않는다. 리뷰 실행·승인 판정·상태 전이·커밋은
  CommitGate만 담당한다. 외부·companion 리뷰 결과를 Codex 승인 증거로 인정하지 않는다. (constraints)
- **R8 얇은 포인터**: 스킬 본문은 *방법론*만 담고 *계약*을 복제하지 않는다. `AGENTS.md`가 계약 정본이라는 원칙을 유지한다.
  `AGENTS.template.md`에는 긴 스킬 본문을 넣지 않는다. (constraints)
- **R9 라이선스·출처**: upstream MIT 고지와 `Copyright (c) 2026 Matt Pocock`, 기준 commit SHA를 보존한다.
  고지는 **설치된 파일에 동행**한다. (Done #1)
- **R10 무해성**: companion skills를 설치하지 않은 사용자의 CommitGate 핵심 워크플로가 **완전히 동일하게** 동작한다.
  기존 Claude/Cursor/Codex 사용자, 타사 skills가 이미 설치된 프로젝트 모두에서 회귀가 없다. (Done #6)
- **R11 테스트**: 단위 테스트·typecheck를 통과시킨다. packed tarball에 `skills/**`가 실림을 고정한다. (Done #7)
  ⚠️ **README(ko/en)·CLI help·CHANGELOG·packed-tarball smoke·공존 fixture는 후속 REQ**(2차 축소 — §4).
- **R12 본문이 정상 사용자 경로를 깨지 않는다**: 스킬 **본문**이 다음을 어기지 않으며, 이를 **테스트로 고정**한다. (Done #8)
  - **R12-a 패키지매니저 중립**: 검증 명령을 `npm run …`으로 하드코딩하지 않는다. `02-plan.md`의 phase별 명령과
    대상의 감지된 packageManager(`req.config.json`)를 따른다. CommitGate는 npm/pnpm/yarn을 지원하므로 npm 단정은 사용자를 깬다.
  - **R12-b 숨은 승인 지점 금지**: `AGENT` 단계에 계약에 없는 사람 승인 지점을 만들지 않는다. 승인된 `01`/`02` 범위 안의
    판단은 에이전트가 하고, **범위 변경이 필요할 때만** 사람에게 보고한다(그건 이미 계약의 보고 사유다).
  - **R12-c 활성 worktree 파괴 금지**: HEAD를 움직이는 조사(`git bisect run`·`reset`·`checkout`)를 활성 REQ worktree에서
    유도하지 않는다. REQ 상태·staged 승인 바인딩이 깨진다.
  - **R12-d harness 분기**: 진입 흐름을 특정 harness 전용 명령(`/req`)으로 단정하지 않는다. Claude Code면 `/req`,
    그 외엔 `AGENTS.md`의 진입 흐름을 따르게 한다.

  근거: 019 phase-1은 upstream 원문을 CommitGate 권한 모델에 **적응하지 않고 옮겨** 위 4건을 전부 어겼다.
  Codex phase 리뷰는 이를 잡지 못했다(리뷰 축이 diff 정합성이지 본문 의미가 아니다) → **테스트가 필요하다.**

## 4. 비목표(Non-goals) — 이번 범위에서 구현하지 않음

그 부재는 결함이 아니라 **명시된 경계**다.

- 🔴 **2차 축소로 분리된 것 — 후속 REQ(가칭 REQ-A2)**:
  - companion의 **gitignore WARN/`--strict` 축**(구 D6·phase-3). userDiffers 격리 fixture 포함(design-r09/r10 설계는 보존 — 재사용).
  - **uninstall `toolEntries`**에 companion 4종 추가(구 D7·phase-3).
  - **공존 fixture**(타사 skills 선설치/후설치), **Stage A migrate 미추가** 검증, **packed-tarball smoke**(구 phase-4).
  - **README(ko/en)·CLI help·CHANGELOG**(구 phase-4). 🔴 그때 **Cursor CLI 지원 표기를 버전·모드와 함께 재검증·재승인**해야 한다(§D1).
  - 이번 REQ는 이 축들을 **바꾸지 않는다** — 기존 gitignore·uninstall 동작이 그대로 유지되는지만 회귀로 확인한다(R10).
- **REQ 문서 템플릿(`00/01/02`) 섹션 보강과 reviewer persona의 리뷰 관점 추가 → REQ-B로 분리.**
  P1-only 차단 정책은 어느 쪽에서도 약화하지 않는다.
- Matt 계열 `to-spec`·`to-tickets`·`implement`·`triage`·`wayfinder`·외부 `code-review`·외부 `handoff`·
  자동 병렬 sub-agent orchestration·codebase-wide architecture scan. (CommitGate의 REQ·`req:next`·독립 Codex Reviewer·
  증거/커밋 바인딩과 권한이 겹치거나 비용·범위를 크게 늘린다.)
- **`.agents/skills/` 이중 설치**(Codex 커버리지). Codex는 read-only 샌드박스의 Reviewer이고 4종은 전부 Builder용이다.
- **신규 manifest·파일 hash provenance·자동 삭제·자동 upgrade 프레임워크.** 자산↔버전 skew 탐지 수단이 없다는 것은
  REQ-2026-014가 이미 **수용한 위험**이다(§5).
- **upstream 자동 동기화.** baseline은 수동 pin이다.
- 스킬 호출을 결정론적으로 만드는 hook 도입.
- `uninstall --apply` 또는 자동 정리. uninstall은 읽기 전용 유지.

## 5. 유지되는 이전 결정 (REQ-2026-014 실측)

- `bin/`에 **rollback 코드가 0줄**이다. init의 보장은 "쓰기 **전에** 실패"(Preflight→Apply)이지 "실패 후 되돌림"이 아니다.
  → 이번 REQ도 **트랜잭션성을 약속하지 않는다**. 신규 원자성 프레임워크를 만들지 않는다.
- **confinement는 repo 전역이 아니다.** `assertConfinedDest`는 호출 1곳뿐이고 `assertEntrypointPathsUsable`은
  `statSync`라 symlink를 따라간다. → "전역 confinement가 있다"고 쓰면 과장이다. 신규 경로에 **명시적으로** 추가해야 한다.
- **자산↔런타임 버전 skew 탐지 수단이 0**이다(REQ-014 `01-design.md` §5.1-1a에서 수용한 위험). companion skills도 동일하게
  **고친 스킬이 기존 설치에 자동 반영되지 않으며 drift 신호도 없다**.
- 두 schema는 프로젝트 MANAGED, persona는 SEED-ONCE, REQ 증거는 프로젝트 보존.
- **launcher는 `runCli`를 await하지 않는다** → verb 구현은 동기여야 한다.

## 6. 대표 예시·실패 경계

**정상 경로**: fresh git 프로젝트 → `npm i -D commitgate` → `commitgate init` → `.claude/skills/commitgate-*/SKILL.md` 4종 생성.
Builder(Claude Code)가 `/commitgate-discovery`로 요구를 정리 → `req:new` → `req:next` 루프.

**실패·예외**:
- `.claude/skills/commitgate-tdd/SKILL.md`를 사용자가 수정 → 재-init·`--force` 모두 **보존**(R4).
- `.claude`가 symlink → **쓰기 전에** 거부(R6).
- 타사 `tdd` skill이 이미 존재 → `commitgate-` 접두사로 **충돌 없음**(R3).
- companion skills 미설치 → 핵심 워크플로 **무변경**(R10).

## 7. 용어

- **companion skill**: 패키지에 번들된 instruction asset. 실행 코드가 아니고 승인 권한이 없다.
- **seed-once**: 부재 시에만 생성하고 `--force`도 무시하는 설치 semantics(기존 `workflow/.gitignore` 방식).
- **auto-discovered, model-invoked**: harness가 스킬을 자동 발견하지만 호출은 모델 판단이다. **"auto-invoked"가 아니다.**

## 8. 인수 기준

1. packed tarball에 `skills/**` 4종 + attribution이 포함된다. (R1)
2. `npm install`이 대상을 수정하지 않는다(postinstall 훅 부재). (R2)
3. fresh init에 `.claude/skills/commitgate-*/SKILL.md` 4종이 정확한 경로에 생성된다. (R3)
4. 같은 init 재실행이 멱등적이고, 사용자가 수정한 스킬은 `--force`에도 보존된다. (R4)
5. `--no-agent-entrypoints`에서 설치되지 않는다. (R5)
6. symlink·디렉터리·특수파일 dest는 **쓰기 0회로 거부**(대상·외부 양쪽 snapshot 무변화). `--dry-run`도 같은 preflight를
   수행하되 무부작용. preflight 실패 시 core 자산도 생성되지 않는다. (R6)
7. 각 SKILL.md에 MIT 고지·`Copyright (c) 2026 Matt Pocock`·baseline SHA가 있다 — **설치된 파일에서** 확인. (R9)
8. 기존 회귀 무변경: 기존 entrypoint·gitignore·uninstall·`req:next --json` 의미·`req:doctor` 정상. (R10)
9. typecheck·전체 test 통과. packed tarball에 `skills/**` 4종 + attribution이 실린다. (R11)
10. 스킬 본문에 `npm run` 하드코딩 0건 · HEAD 이동/진단용 commit·stage 유도 0건 · 각 본문이 `req:next` 정본과
    커밋 금지 경계를 담고 · discovery가 harness를 분기한다 — **테스트로 고정**. (R12)

⚠️ 구 인수 기준 8·9(공존 fixture·Stage A migrate·uninstall planner)와 10의 README·smoke 절은 **2차 축소로 후속 REQ**(§4).

세부는 [01-design.md](01-design.md) · [02-plan.md](02-plan.md).
