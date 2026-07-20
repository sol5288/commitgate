# REQ-2026-044 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**
각 phase는 종료 시 **전체 스위트 green**을 유지한다(교차-phase 파손 방지 — 특히 `package-payload.test.ts`의
doc-containment 단언이 스킬 목록 추가와 **같은 phase**에서 문서와 함께 움직이도록 배치).

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고.
> 세 phase 모두 5~6파일. 검증 명령은 `package.json` scripts에 있는 것만 쓴다(추측 금지).

## Phase 1 — 스킬 자산 + payload 계약 (`phase-1-skill-asset`)

**목표**: `commitgate-quality` 스킬 자산을 만들고 payload·귀속·frontmatter·경계문구 존재·doc-containment 계약을 통과시킨다.

- **범위(파일)**: `skills/commitgate-quality/SKILL.md`(신규) · `skills/ATTRIBUTION.md` · `docs/agent-prompt.md` · `docs/agent-prompt.en.md` · `tests/unit/package-payload.test.ts`.
- **정본 참조**: DEC-1(우산+참조 구조) · DEC-2(MIT 귀속) · DEC-3(model-invocation) · DEC-4(하위셋) · **DEC-7(협력적 지침 + 경계문구 존재 검증 — 정적 스캐너 아님)** · `skills/ATTRIBUTION.md`(UPSTREAM_SHA `d574778…`) · `docs/companion-skills-req-plan.md` §5.8 D8(본문 골격).
- **SKILL.md 본문 계약(권한 경계 — DEC-7, 협력적 지침)**: `## 경계` 절이 다음 문구를 **명문**으로 담는다 — "`git commit`·`git push`·`req:commit` 직접 호출 금지." · "`state.json`·`responses/`를 직접 수정하거나 스테이징하지 않는다." · "다음 행동은 `req:next`가 정본이다." **실제 강제는 CommitGate 게이트**임을 본문·문서에 명시(스킬은 방법, 강제 아님).
- **공개 seam / 실패해야 할 동작**: `tests/unit/package-payload.test.ts` — `COMPANION_SKILLS`에 `commitgate-quality` 추가 시 (a) 타르볼에 `skills/commitgate-quality/SKILL.md` 존재, (b) MIT 고지 verbatim, (c) `UPSTREAM_SHA` 존재, (d) frontmatter `name`=디렉터리·kebab·≤64, (e) body에 `req:next`·`req:commit` 포함, (f) `disable-model-invocation` 미설정, (g) **기존** D11 body-guard(`npm run`/HEAD 이동 git/숨은 승인 게이트 0) 상속(**확장 없음**), (h) `COMPANION_DOCS`(agent-prompt ko/en) `.toContain('commitgate-quality')`.
- **경계문구 존재 oracle(DEC-7, positive only) — 이 phase에서 추가**: `commitgate-quality` 본문에 아래가 존재(regression: 문구 삭제·약화 시 실패). **정적 스캐너·우회 문법 검사 없음**(01-design DEC-7 정본).
  - `/(git commit|git push)[^\n]*(금지|하지 않는다)/` · `/req:commit[^\n]*(금지|하지 않는다|직접 호출)/`
  - `/(state\.json|responses)[^\n]*(직접 수정|수정하거나)[^\n]*(않는다|금지)/` · `/(state\.json|responses)[^\n]*스테이징[^\n]*(않는다|금지)/`
  - `/req:next[^\n]*(정본|계산)/`
- **Red→Green**: 위 단언(목록·하위셋 편입 + 경계문구 존재)을 **먼저** 추가해 실패 확인(스킬 파일 부재·문서 미언급·경계문구 부재) → `SKILL.md`(경계 문구 + "게이트가 실제 강제" 명문 포함) 작성 + ATTRIBUTION 행 + agent-prompt 행으로 통과.
- **TC 상태 전이**: package-payload 신규/확장 단언 red→green. 기존 4종 단언 무변경 유지.
- **검증**: `npx vitest run tests/unit/package-payload.test.ts` → `npm run typecheck` → `npm test`(전체 green 확인) → `npm run docs:lint`(agent-prompt 링크).
- **stage 범위**: 위 5파일만. `git add`로 개별 지정. `state.json`·`responses/` 스테이징 금지.
- **비목표**: 설치기(`bin/init.ts`)·smoke·CLAUDE 포인터는 Phase 2/3.
- **Exit**: typecheck 0 · 전체 단위 green · docs:lint 통과 · Codex phase 리뷰 승인.

## Phase 2 — 설치·uninstall·migrate·smoke 배선 (`phase-2-install-wiring`)

**목표**: 5번째 스킬을 설치 SSOT 배열에 넣고 설치/멱등/보존/symlink 거부/uninstall/smoke를 통과시킨다.

- **범위(파일)**: `bin/init.ts`(`KIT_COMPANION_SKILLS` +1엔트리, help "4종"→"5종") · `tests/unit/init.test.ts` · `tests/unit/uninstall.test.ts` · `tests/unit/migrate.test.ts` · `scripts/smoke.mjs`(배열 + 카운트).
- **정본 참조**: `bin/init.ts:108-113`(KIT_COMPANION_SKILLS) · `:459-496`(planCompanionSkills seed-once) · `docs/companion-skills-req-plan.md` §5.3 D3·§5.4 D4·§5.7 D7 · 기존 회귀 케이스(`init.test.ts:2280/2518/2535/2770`, `uninstall.test.ts:946`, `migrate.test.ts:327`, `smoke.mjs:23-28`).
- **공개 seam / 실패해야 할 동작**: fresh init이 `.claude/skills/commitgate-quality/SKILL.md`를 정확 경로에 생성; 재실행 멱등; 사용자 편집 파일이 `--force`에도 보존; `.claude/skills/commitgate-quality`가 symlink이면 쓰기 0회 거부; `KIT_COMPANION_SKILLS.map(dest)`===`DESTS`(5개) 핀; uninstall planner가 5종 각 1회; `smoke` packed-install에 5종 존재.
- **Red→Green**: 테스트 목록(`DESTS`·`:2518` 핀·`SKILLS`·`COMPANIONS`·`uninstall :946`=5·`smoke` 배열)을 **먼저** 갱신해 실패 확인(init이 quality 미설치) → `KIT_COMPANION_SKILLS`에 1엔트리 추가로 통과(설치/보존/confinement 코드 **무변경**, 배열 파생).
- **TC 상태 전이**: init/uninstall/migrate/smoke 목록 단언 red→green. seed-once·symlink 신규 케이스 green.
- **검증**: `npx vitest run tests/unit/init.test.ts tests/unit/uninstall.test.ts tests/unit/migrate.test.ts` → `npm run typecheck` → `npm test` → `npm run smoke`.
- **stage 범위**: 위 5파일만.
- **비목표**: CLAUDE 발견 포인터·문서 카운트·CHANGELOG는 Phase 3.
- **Exit**: typecheck 0 · 전체 단위 green · smoke PASS(5종) · Codex phase 리뷰 승인.

## Phase 3 — 발견 포인터 + 문서·CHANGELOG (`phase-3-discovery-docs`)

**목표**: 새 세션 발견 포인터를 Claude Code 진입점에 1줄 추가하고 **설치 산출물 회귀 oracle**로 고정하며, 잔여 문서 카운트·CHANGELOG를 맞춘다.

- **범위(파일, 7 — ≤8)**: `templates/CLAUDE.template.md`(포인터 1줄) · `tests/unit/init.test.ts`(설치 산출물 oracle) · `docs/quick-start.md`·`.en.md`(카운트) · `docs/guarantees.md`·`.en.md`(카운트) · `CHANGELOG.md`(Unreleased).
- **정본 참조**: DEC-5(포인터 위치·문안) · DEC-6(정직 표기) · `templates/CLAUDE.template.md:25-27`(기존 진입점 포인터 인근, quickstart 블록 **밖**) · 제약 #8(`AGENTS.template.md`·quickstart 블록 불변) · 설치 산출물은 seed-once 복사(`bin/init.ts:83-84,1218` `KIT_CLAUDE_TEMPLATE_REL`→`CLAUDE.md`) · 기존 설치-산출물 내용 테스트 `tests/unit/init.test.ts:324-333`(신규 설치 CLAUDE.md에 Quick Start 블록 `QS_RE` 검증하는 describe).
- **공개 seam / 실패해야 할 동작 (구체 oracle)**: `tests/unit/init.test.ts`의 신규-설치 CLAUDE.md 내용 describe(`QS_RE` 테스트 형제, :324-333 인근)에 **형제 `it` 1개 추가** — fresh init 후 `readFileSync(join(dir, 'CLAUDE.md'), 'utf8')`가 `commitgate-quality`(발견 포인터)를 **포함**한다고 단언한다. 포인터가 템플릿에 없으면 이 단언이 **실패**해야 한다(설치 산출물의 발견 포인터 회귀를 잡는 oracle). 동시에 기존 `QS_RE`(quickstart 블록)·`AGENTS.md` 불변 단언은 그대로 통과해야 한다(계약·블록 byte 불변 확인).
- **Red→Green**: 위 형제 `it`를 **먼저** 추가해 실패 확인(템플릿에 포인터 부재) → `templates/CLAUDE.template.md`에 포인터 1줄 추가로 green. 문서 카운트("4종"→"5종")는 관측 가능 텍스트로 갱신.
- **TC 상태 전이**: init.test.ts 신규 CLAUDE.md-포인터 단언 red→green. 기존 `QS_RE`·seed-once·`--force` 보존 단언 무변경.
- **검증**: `npx vitest run tests/unit/init.test.ts` → `npm test`(전체) → `npm run docs:lint` → `npm run smoke`(재확인).
- **stage 범위**: 위 7파일만. (init.test.ts는 Phase 2의 목록 단언과 별개 델타 — 같은 파일 교차-phase 편집 정상.)
- **비목표**: 기존 설치 backfill 자동화(후속 옵션). quickstart 블록 확장(DEC-5 대안 — Codex 요구 시에만).
- **Exit**: 전체 단위 green · docs:lint 통과 · smoke PASS · Codex phase 리뷰 승인.

## Phase 4 — 상태별 제어흐름 문구 수정 (`phase-4-state-flow-fix`)

**배경**: 통합 前 사람 리뷰에서 P1 발견 — `commitgate-quality` 스킬이 `RUN`·`AWAIT_HUMAN`·`DONE`·`BLOCKED`를 한 줄로 "즉시 `req:next`로 돌아가라"로 뭉개, 각 kind의 상이한 계약 의미를 왜곡한다. 수정은 **`req:next`의 5개 kind 전부**(`RUN`·`AGENT`·`AWAIT_HUMAN`·`DONE`·`BLOCKED`)를 상태별로 분리해야 한다(delta-r01 P1: `AGENT` 누락 시 필요한 작업을 건너뛰고 다음 게이트로 진행 가능). 이는 **DEC-7(협력적 지침)의 상태별 계약을 명확히 하는 P1 수정**이며, `00-requirement.md`·`01-design.md`의 요구·설계 결정을 **변경하지 않는다**(문구 명확화 + 수량 표기 정합만).

**목표**: SKILL.md의 상태별 지시를 `AGENTS.md` 계약과 일치시키고(5개 kind 전부), 회귀 테스트로 고정하며, stale 수량 표기·진단 메시지를 정리한다.

- **범위(파일)**: `skills/commitgate-quality/SKILL.md`(frontmatter+본문 5-kind 분리) · `tests/unit/package-payload.test.ts`(5-kind 회귀 oracle + P2 주석) · `tests/unit/init.test.ts`·`tests/unit/migrate.test.ts`·`tests/unit/uninstall.test.ts`(P2 제목·주석 5종/5개) · `scripts/smoke.mjs`(진단 메시지 `${present.length}/4` → 동적).
- **정본 참조**: `AGENTS.template.md` 빠른 시작(RUN/AGENT/AWAIT_HUMAN/DONE/BLOCKED의 kind별 의미) · DEC-6/DEC-7(협력적 지침·정직 표기) · 완료 기준 3(권한 불변식 비침범).
- **공개 seam / 실패해야 할 동작(회귀 oracle)**: `package-payload.test.ts`에 SKILL.md의 **5개 kind** 문구 검증 — (a) `RUN`=출력 명령을 그대로 실행 후 `req:next`, (b) `AGENT`=그 phase 작업을 구현·검증·`git add` 한 뒤 `req:next`(필요 작업을 건너뛰지 않는다), (c) `AWAIT_HUMAN`=멈추고 승인 문장 수령, (d) `DONE`=완료 보고·통합/릴리즈 비추정, (e) `BLOCKED`=재시도 금지·사람 보고를 각각 담고, (f) 여러 kind를 한 줄로 "즉시 `req:next`"로 뭉개는 결함 문구가 **없음**을 단언. 결함 문구가 있거나 어느 kind가 빠지면 실패.
- **P2(수량 정합)**: 배열은 이미 5종을 검증하나 제목·주석·smoke 진단이 stale "4종/4개" → 5종/5개. smoke `${present.length}/4`는 하드코딩 대신 **`${COMPANION_SKILL_RELS.length}`** 사용(스킬 누락 시 정확히 x/5 안내 — 단순 주석이 아니라 사용자 대면 진단).
- **Red→Green**: 상태별 회귀 oracle을 **먼저** 추가(현 SKILL.md의 뭉갠 문구가 실패) → SKILL.md 상태별 분리로 통과.
- **검증**: `npx vitest run tests/unit/package-payload.test.ts` → `npm run typecheck` → `npm run docs:lint` → `npm run smoke`(진단 문구 확인).
- **stage 범위**: 위 파일만. `state.json`·`responses/` 스테이징 금지.
- **비목표**: `00/01` 요구·설계 결정 변경(이 phase는 문구 명확화·수량 정합뿐) · 언어 응답 정책(실제 적용 프로젝트의 `CLAUDE.md` 소관 — 이 범용 스킬 밖).
- **Exit**: typecheck 0 · package-payload green · docs:lint 통과 · smoke PASS · Codex phase 리뷰 승인.

## 완료

- 게이트 해당분(unit·typecheck·docs:lint·smoke) 전부 green · 4 phase Codex 승인(Phase 4 = 통합 前 리뷰 P1 수정).
- 사용자 main 머지·릴리즈는 **별도 통제점**(I1/I2 또는 B1, R1~R3) — `req:next`가 지시.
