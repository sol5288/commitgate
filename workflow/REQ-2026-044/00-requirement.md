# REQ-2026-044 요구사항 — CommitGate Quality Overlay v2 (companion skill)

## 무엇을 / 왜

CommitGate 패키지에 Claude Code용 companion skill **`commitgate-quality`** 를 추가한다.
설치 후 경로는 `.claude/skills/commitgate-quality/SKILL.md` 이며, 기존 4종 companion skill
(`commitgate-tdd`·`commitgate-discovery`·`commitgate-diagnosing-bugs`·`commitgate-research`)과
**동일한 전달·설치·seed-once·opt-out·uninstall 경로**로 제공된다.

**왜**: 현재 CommitGate는 권한·리뷰·승인·커밋 게이트는 강하지만, 새 세션의 Builder가
① 설계 정본(SSOT)을 REQ 문서에 **복제**하거나, ② 실존하지 않는 기존 API·라우트·환경변수를 **가정**하거나,
③ 역할·권한·상태·입력 **조합의 테스트 oracle 범위를 누락**하는 품질 문제를 남길 수 있다.
Quality Overlay는 Superpowers 방법론의 장점 중 **요구 정제·설계/계획 품질·Test-First·증거 기반 검증**만
방법론 텍스트로 흡수해 이 문제를 CommitGate 워크플로와 **충돌 없이** 줄인다.
경계는 하나다 — "**Quality Overlay는 방법, CommitGate는 권한.**"

## 완료 기준 (검증 가능)

1. 새 설치에서 `.claude/skills/commitgate-quality/SKILL.md`가 기존 companion skill과 **동일한 안전한 설치 방식**(seed-once·confinement·symlink 거부·opt-out·uninstall)으로 제공된다. → `init.test.ts`·`uninstall.test.ts`·`scripts/smoke.mjs`.
2. 새 세션이 설계·계획·AGENT 구현에서 이 스킬을 **언제 읽어야 하는지** 안다(발견 포인터 + 명시 경로 문서). → `templates/CLAUDE.template.md`·`docs/agent-prompt.md`/`.en.md`.
3. Quality Overlay가 `req:next`·`review-codex`·`req:commit`·`state.json`·`responses/`의 권한을 침범하지 않는다 → (a) 스킬 본문에 필수 경계 문구 존재(협력적 지침), (b) 기존 D11 targeted 가드 상속, (c) 문서가 "방법이지 강제가 아니며 **실제 강제는 CommitGate 게이트**"임을 명시. **모든 스킬 문장·셸 문법을 검사하는 일반 정적 보안 스캐너는 만들지 않는다**(범위 밖 — 게이트가 강제).
4. 스킬 본문이 정본(SSOT) 복제를 **금지**하고 참조 방식을 요구한다(본문 명문 + 리뷰).
5. 기존 companion skill·기존 설치·사용자 편집 파일 보존(seed-once, `--force`에도 미덮음) 정책이 회귀하지 않는다.
6. 설치·템플릿·문서 관련 테스트를 추가 또는 갱신한다(payload·init·uninstall·migrate·smoke·doc-containment).
7. 프로젝트가 정의한 `typecheck`·`test`·`smoke` 검증을 실제 실행하고 결과를 보고한다.
8. CommitGate REQ 워크플로 전체를 따른다(설계 승인 전 구현 금지, 사람 통제점에서 정확한 승인 문구 요청·정지).

## 제약 (정본 우선순위·불변식)

정본 계약은 저장소 루트 `AGENTS.md`(이 repo에서는 `AGENTS.template.md`)와 `req:next` 출력이다.
이 스킬은 그 아래 계층의 **방법론 자산**이며 다음을 침범하지 않는다.

1. `AGENTS.md`와 `req:next`가 항상 이 스킬보다 우선한다.
2. CommitGate만 상태 전이, 리뷰 실행·판정, 증적 기록, 커밋 권한을 가진다.
3. `req:next`의 `RUN`/`AGENT`/`AWAIT_HUMAN`/`DONE`/`BLOCKED` 의미를 변경하지 않는다 (SSOT: `AGENTS.template.md`).
4. `git commit`/`git push`/`req:commit` 직접 호출을 추가하지 않는다.
5. `state.json`·`responses/`를 Builder가 수정하거나 stage하게 만들지 않는다.
6. 자동 worktree 생성, 병렬 구현 에이전트, 태스크별 독립 커밋을 추가하지 않는다.
7. 기존 사용자 파일 보존(seed-once) 정책과 companion skill 설치 경로를 깨지 않는다 (SSOT: `docs/companion-skills-req-plan.md` §5.3 D3·§5.4 D4·§5.5 D5·§5.7 D7).
8. `AGENTS.md`(계약 정본)를 품질 방법론으로 비대하게 만들지 않는다. 진입점에는 **짧은 발견 포인터만** 추가한다.
9. 기존 REQ의 승인된 `00/01/02`를 새 형식에 맞추기 위해 재작성하지 않는다.
10. 한국어·영어 문서·템플릿의 의미를 일치시킨다.

강제력 수준은 정직하게 표기한다: 이 스킬의 경계는 **협조적 텍스트**이며 도구가 강제하는 게이트가 아니다
(SSOT: `docs/ssot-design/04-user-roles-and-permissions.md`).

## 스킬 적용 범위 (언제 읽는가)

`commitgate-quality`는 다음 상황에서만 방법을 적용한다.

- (a) REQ의 `00/01/02` 설계·계획을 새로 작성/수정할 때
- (b) `req:next`가 `AGENT`를 반환한 구현 phase
- (c) 버그·회귀·성능 문제를 진단하는 `AGENT` 작업

`RUN`·`AWAIT_HUMAN`·`DONE`·`BLOCKED`에서는 이 스킬이 다음 행동을 **결정하지 못한다**. 다음 행동은 `req:next`가 정본.

## 발견 경로 (새 세션이 존재·시점을 아는 방법)

- 새 설치의 Claude Code 진입점(`templates/CLAUDE.template.md`, 항상 로드되는 `CLAUDE.md`)에
  **한 줄짜리 짧은 포인터**만 추가한다. 의미: "설계·계획 작성 또는 AGENT 구현 시 `commitgate-quality`를 읽어
  방법을 적용하되, 다음 행동·승인·커밋은 `req:next`와 `AGENTS.md`만 따른다."
- 자동 발견은 native지만 **호출은 model-decided(확률적)**라는 사실을 문서에 숨기지 않는다.
  명시적 사용 경로(`/commitgate-quality` 또는 직접 파일 읽기)도 함께 문서화한다.
- 기존 사용자 `CLAUDE.md`·`AGENTS.md`를 임의로 덮어쓰지 않는다(seed-once 유지).

## 대표 예시 (정상 경로)

새 세션이 `req:new`로 REQ를 열고 `00/01/02`를 작성한다 → `CLAUDE.md` 포인터를 보고
`commitgate-quality`를 읽어 SSOT 참조·조합 검증·검증 명령 실증을 적용한다 → `req:review-codex --kind design`으로
설계 승인 → phase마다 `req:next`가 `AGENT` → `commitgate-tdd`의 Red→Green 루프로 구현 → 승인·커밋.
**다음 행동·승인·커밋은 전 구간 `req:next`/`AGENTS.md`가 정본이고, 스킬은 방법만 제공한다.**

## 예외·실패 경계

- 스킬 미설치 사용자의 CommitGate 핵심 워크플로가 **완전히 동일**하게 동작한다(무해성).
- `.claude/`가 gitignore된 repo: 기존 companion 경고 축(기본=WARN, `--strict`=fail-closed)을 그대로 상속.
- `.claude/skills/commitgate-quality`가 symlink/파일이면 기존 confinement가 **쓰기 0회로 거부**.
- 사용자가 스킬을 편집했으면 `--force`에도 보존(seed-once).

## 비목표 (이번 범위 밖)

- Superpowers 플러그인·스킬·런타임의 설치·실행·의존성 추가.
- 자동 worktree, 병렬 구현 sub-agent, 태스크별 독립 커밋, 스킬 호출을 결정론화하는 hook 도입.
- **모든 스킬 문장·셸 문법을 정규식으로 검사하는 일반 정적 보안 스캐너**(우회 문법 완전 차단) — 범위 밖. 강제는 CommitGate 실행 게이트가 담당(SSOT: `docs/ssot-design/04`).
- **사람 예외 기록 전용 명령(`req:review-exception`)** — 안전 게이트 상태 전이 변경이므로 **별도 REQ**(§01 DEC-7 후속).
- companion 전달 파이프라인(설치기·payload·confinement) 자체의 재설계 — 이미 존재·검증됨(REQ-2026-020~024).
- 기존 4종 skill 본문 재작성, 기존 REQ 문서 재작성.
- 기존 사용자 `CLAUDE.md`/`AGENTS.md` 자동 병합·덮어쓰기, 기존 설치로의 포인터 자동 backfill(§01 DEC-5 — 후속 옵션).
- upstream 자동 동기화·자동 upgrade·manifest.

## 미결 (→ 01-design에서 확정)

- 스킬 본문이 area 4(Test-First)·area 5(버그 진단)를 자체 서술할지 기존 `commitgate-tdd`/`commitgate-diagnosing-bugs` 참조로 다룰지(내부 중복 최소화) → **DEC-1**.
- attribution: Pocock 파생물로 MIT 고지를 붙일지 → **DEC-2**(리뷰 observation: 적절).
- 발견 포인터 위치(quickstart 블록 vs CLAUDE 진입점) → **DEC-5**.
- 권한 경계를 텍스트로 어디까지 강제할지 → **DEC-7**: 협력적 지침 + 경계문구 존재 검증만. **일반 정적 스캐너 폐기**(범위 초과). 실제 강제는 CommitGate 게이트.
