# 계획 — CommitGate Companion Skills 내부 번들 (Stage B 후속 REQ)

> 상태: **계획 문서. 티켓 미생성.** Stage B(REQ-2026-014)가 진행 중이므로 착수하지 않는다.
> 작성일 2026-07-17. 근거는 모두 아래 §2에 1차 출처와 함께 기록한다.

## 0. 결론 요약

1. **이번 작업은 Stage B의 독립 후속 REQ다.** Stage B 문서·상태·승인 증적을 일절 수정하지 않았다.
2. **Stage B는 하드 선행 의존이다.** 목표가 요구하는 `npx commitgate init`은 **main에 존재하지 않는다**(실측: `알 수 없는 인자: init`). `init` verb는 Stage B의 `bin/dispatch.mjs` `VERB_MODULES`에만 있다.
3. **같은 파일 충돌.** 이번 REQ의 확장 지점은 `bin/init.ts`인데, Stage B Phase 2가 지금 그 파일을 재작성 중이다(미커밋 WIP +130줄). 병행 착수는 충돌을 보장한다.
4. **두 REQ로 분할한다**(PM 결정). REQ-015/016/017이 연속 terminal된 원인이 설계 표면 확장이었다.

## 1. Stage B와의 범위 분리 — 실측 근거

| 항목 | 실측값 |
|---|---|
| Stage B 브랜치 | `feat/req-2026-014-stage-b-runtime-package` (worktree `D:/1_projects/61_commitgate-req014-stage-b`) |
| 설계 승인 | r21 승인, `design_approved=true`, hash `af32f66e…` |
| Phase 1 | 승인·소비 완료 (`phase-1-dispatch` → `95d94b8`) |
| Phase 2 | **승인·커밋 완료** — Codex 승인 `2026-07-16T17:14:31Z`, 커밋 `46b740e`(+ evidence `ec30c2c`) `2026-07-16T23:26:01Z`, `user_commit_confirmed` 기록됨 |
| Phase 3 | **진행 중** — `?? bin/migrate.ts`, `M bin/{dispatch.mjs,uninstall.ts}` 미커밋 |
| `req:next -- 2026-014` | `{"kind":"AGENT","detail":"phase \`phase-3-uninstall-migrate\`를 구현하고…"}` |

🔴 **Stage B에는 지금 활동 중인 다른 작업자가 있다.** 이 계획을 세우는 동안 Stage B HEAD가 `14f5b76` → `ec30c2c`로 움직였다(Phase 2 리뷰·승인·HIGH 커밋이 그 사이 완료). 이 문서를 쓴 세션은 Stage B를 **읽기만** 했다.

→ `req:next`가 **AGENT**를 반환하고 다른 작업자가 활동 중이므로 Stage B는 진행 중이다. 지시서 §0의 분기에 따라 **계획만** 수립한다. CommitGate의 보장 모델("하나의 REQ는 하나의 활성 worktree와 협조적 작업자만")상, 같은 worktree에 두 번째 작업자가 들어가는 것은 **지원 범위 밖**이다.

Stage B `00-requirement.md` §4 비목표에 이미 **"언어 정책(R10 계열)과 관련 템플릿·persona 확장"**이 명시되어 있고, §7 후속 backlog에도 동일 항목이 있다. 지시서 §5(문서·persona 보강)는 **Stage B가 이미 후속으로 밀어 둔 영역**이다. 별도 REQ로 처리하는 것이 기존 설계 결정과 일치한다.

## 2. 확정 사실 — 지시서 전제 정정 (모두 1차 출처 검증)

### 2.1 정정 ① — 세 harness 모두 native skill 디렉터리를 가진다

지시서는 "자동 발견을 보장할 수 없는 harness에는 거짓으로 auto-invoked라고 주장하지 말고 pointer로 연결"을 지시했다. 이 우회로는 **불필요**하다.

| harness | native skill 경로 | 1차 출처 |
|---|---|---|
| Claude Code | `.claude/skills/<name>/SKILL.md` (project), `~/.claude/skills/…` (user) | code.claude.com/docs/en/skills |
| Codex CLI | `.agents/skills/` (repo root·cwd·`$HOME`) | learn.chatgpt.com/docs/build-skills.md |
| Cursor | `.cursor/skills/`, `.agents/skills/`, **+ `.claude/skills/` 호환 읽기** | cursor.com/docs/skills |

**그러나 진짜 정정은 다른 쪽이다.** discovery는 native지만 **invocation은 세 harness 모두 model-decided(확률적)**이다.

- Claude Code: "skill descriptions are loaded into context so Claude knows what's available, but full skill content only loads when invoked." 게다가 listing 예산(context의 ~1%) 초과 시 **description이 조용히 drop된다** — "drops descriptions starting with the skills you invoke least." 문서 스스로 결정론적 강제는 hooks로 하라고 안내한다.
- Codex: progressive disclosure. name/description/path만 preload(8,000자 또는 context 2%), "loads the full SKILL.md instructions only when it decides to use a skill."
- Cursor: "agent decides when they are relevant based on context."

→ **README·CLI help에 "auto-invoked"라고 쓰면 거짓이다.** 정확한 표현은 **"자동 발견(auto-discovered) · 모델 판단 호출(model-invoked)"**. 결정론적 주입 계층은 여전히 Codex=`AGENTS.md`(무조건 concat), Cursor=`alwaysApply:true` 뿐이며, 이것이 **`AGENTS.md`가 계약 정본으로 남아야 하는 이유**다.

### 2.2 정정 ② — 레포에 이미 skill 개념이 있다

`bin/init.ts:69-73`:

```ts
export const KIT_AGENT_ENTRYPOINTS = [
  { src: 'templates/claude-skill.md', dest: '.claude/skills/commitgate/SKILL.md' },
  { src: 'templates/claude-command.md', dest: '.claude/commands/req.md' },
  { src: 'templates/cursor-rule.mdc', dest: '.cursor/rules/commitgate.mdc' },
] as const
```

이미 모든 대상 repo에 `.claude/skills/commitgate/SKILL.md`가 깔린다. 신규 4종은 **이것과 공존**해야 하며, `commitgate-*` 접두사는 타사 충돌뿐 아니라 **기존 `commitgate` 스킬과의 구분**에도 필요하다.

바로 위 `init.ts:67`에 이번 설계의 핵심 제약이 이미 문장으로 있다:

> 본문 SSOT는 `AGENTS.md`다. 여기 깔리는 파일은 **얇은 포인터**이며 계약 본문을 복제하지 않는다 — 복제하면 drift 부채가 된다.

### 2.3 확인 — upstream은 MIT다 (raw LICENSE 직접 확인)

| 항목 | 값 |
|---|---|
| repo | `https://github.com/mattpocock/skills` |
| license | **MIT** — raw LICENSE 1068 B, 첫 줄 `MIT License` / `Copyright (c) 2026 Matt Pocock`. blob `f1dd2c09…`가 GitHub license API가 MIT로 분류한 blob과 동일 |
| 기준 baseline | **`v1.1.0` = `d574778f94cf620fcc8ce741584093bc650a61d3`** (2026-07-08) |
| registry | **없음** — `package.json`이 `"private": true`, `registry.npmjs.org/mattpocock-skills` → 404. **git SHA만 pin 가능** |
| `npx skills` 설치기 | **Matt의 것이 아니다** — npm `skills`는 `vercel-labs/skills`. 콘텐츠 취득에 설치기는 불필요 |

대상 4종의 upstream 경로: `skills/productivity/grilling`, `skills/engineering/{domain-modeling,tdd,diagnosing-bugs,research}`.
⚠️ `skills/deprecated/ubiquitous-language`는 `domain-modeling`의 폐기된 조상 — baseline으로 쓰지 않는다.
⚠️ 경로는 버전 간 이동한다(`in-progress/review` → `engineering/code-review`). **경로를 식별자로 쓰지 않는다. SHA로 pin한다.**

**법적 판단:** 아이디어(Beck TDD, Evans DDD, Zeller delta-debugging)는 prior art이며 Pocock의 것이 아니다. 그러나 **특정 표현·순서·조어**("seams", "tracer bullet", "red-capable", 6-phase 구조)는 그의 것이다. 우리 스킬은 CommitGate 권한 경계를 넣기 위해 **어차피 파생물**이 된다 → **MIT 고지를 붙인다.** 회피를 위한 paraphrase는 하지 않는다.

### 2.4 정정 ③ — "versioned"에는 메커니즘이 없다

- `docs/ssot-design/gaps-and-decisions.md` G-10: "설치기는 파일을 복사하지만 설치 당시 패키지 버전·파일별 원본 sha를 대상 repo에 기록하지 않는다. `--force`는 갱신 수단이지만 사용자 수정과 구버전 원본을 3-way로 구분하는 upgrade 계획이 아니다."
- REQ-2026-014 `00-requirement.md` §4: `.commitgate/manifest.json`·파일 hash·provenance는 **명시된 비목표**.

→ 이번 REQ의 "versioned"는 **패키지 측 기록일 뿐**이다: SKILL.md 안의 upstream SHA 고지 + `skills/ATTRIBUTION.md`. **upgrade 자동화는 없다.** 설계 문서에 다음을 명시한다: **"스킬을 고친 새 버전은 기존 설치에 자동 반영되지 않으며, drift를 알려 주는 신호도 없다."**

### 2.5 실측 — 신규 asset이 상속하지 못하는 것들

| 사실 | 실측 근거 |
|---|---|
| skip은 **존재 검사**일 뿐 | `bin/init.ts:553` `if (existsSync(destAbs) && !force)` — 사용자 수정 탐지 **없음**. `--force`가 조용히 덮는다 |
| sha256은 **skip 축이 아니라 ownership 축** | `init.ts:557` — 이미 skip된 파일이 `ownedSkips`(→ `git add` 대상)에 낄지만 결정 |
| confinement 호출부는 **1곳뿐** | `grep -rn assertConfinedDest bin/ scripts/ tests/` → 정의 `:318` + 호출 `:851`(`KIT_GITIGNORE.dest` 하드코딩). **끝** |
| `applyCopies`는 무방비 | `:614-620` bare `mkdirSync(recursive)` + `copyFileSync`, 검사 0 |
| `assertEntrypointPathsUsable`는 symlink 방어가 **아니다** | `:594-611` `existsSync`/`statSync`는 symlink를 **따라간다**. dest 목록 `:595` 하드코딩 |
| `files[]`에 `skills` 없음 | `package.json:42-55` 12개 화이트리스트. 누락 시 tarball에서 `walkFiles` ENOENT |
| uninstall: byte-identical은 **충분조건이 아니다** | `bin/uninstall.ts:64` "origin 판별 불가 → 항상 자동 제거 대상에서 제외". `:53` `differs`는 "사용자 수정"이 아니라 **"수정됨 OR 다른 버전이 깐 것"** |

### 2.6 실측 — `commitgate init`은 main에 없다

```
$ node bin/commitgate.mjs init --dry-run      # main
commitgate: 알 수 없는 인자: init
```

`bin/commitgate.mjs:23`은 `uninstall`만 특수 분기하고 나머지는 `bin/init.ts`의 `parseArgs`(`:1138-1167`)로 떨어져 미지 토큰에 throw한다. Stage B의 `bin/dispatch.mjs` `VERB_MODULES`에만 `init: 'init.ts'`가 있다(실측: Stage B에서 `init` verb 정상 동작, Stage A 서명 감지 후 migrate 안내로 fail-closed).

→ **지시서 §1의 "`npx commitgate` 또는 `npx commitgate init`" 양쪽 지원은 Stage B 없이는 성립하지 않는다.**

## 3. 범위 분리 — 두 REQ (제안 결정)

> **이 문서의 "제안 결정"은 대화에서 합의한 설계 방향일 뿐 CommitGate 승인 증적이 아니다.** 정본은 `req:review-codex` 승인과 `approvals.jsonl`이며, 제품 정책으로 확정되면 CLI help·README에 명시해야 한다.

### REQ-A — companion skills 번들·설치 (선행)
skills 소스 번들 · attribution · `files[]` · init 설치 · confinement · seed-once · opt-out · uninstall · 테스트 · 문서.

### REQ-B — REQ 문서·리뷰 보강 (REQ-A 머지 후)
지시서 §5: `00/01/02` 템플릿 섹션 + persona의 명세충족/구현품질 2관점. **P1-only 차단 정책 무변경.**

분할 이유: 두 영역은 파일도 리뷰 축도 겹치지 않는다. REQ-A는 설치기, REQ-B는 리뷰 계약이다. 묶으면 설계 표면이 REQ-015~017을 죽인 크기가 된다.

## 4. REQ-A 요구 (초안 R1~R10)

- **R1 번들**: 패키지에 harness-neutral `skills/` 소스 4종 + attribution 포함. 실행 코드 아님, instruction asset.
- **R2 설치 시점**: `npm install` 자체는 대상을 수정하지 않는다(**현재 postinstall 훅 없음 — 유지가 요구**). 설치는 명시적 `commitgate init`에서만.
- **R3 설치 경로**: `.claude/skills/commitgate-<name>/SKILL.md` 4종. (제안 — §5.1)
- **R4 seed-once**: 대상에 같은 경로 파일이 있으면 **`--force`로도 덮지 않는다.** (제안 — §5.3)
- **R5 opt-out**: `--no-agent-entrypoints`는 companion skills도 건너뛴다. 추가로 `--no-companion-skills`를 제공한다.
- **R6 보안 동등**: 신규 asset도 기존 설치 자산과 **같은 수준**의 path confinement·symlink·gitignore·dry-run·strict 정책을 받는다.
- **R7 권한 경계**: 스킬은 `git commit`/`git push`/`req:commit` 직접 호출/`state.json`·`responses` stage를 하지 않는다. `req:next`의 5개 kind 의미를 바꾸지 않는다. **강제력은 협조적 텍스트 수준임을 명시한다.**
- **R8 얇은 포인터 유지**: 스킬 본문은 *방법론*만 담고 *계약*을 복제하지 않는다(`init.ts:67`).
- **R9 라이선스**: MIT 고지 + `Copyright (c) 2026 Matt Pocock` + baseline SHA를 **설치된 파일에 동행**시킨다.
- **R10 무해성**: companion skills 미설치 사용자의 CommitGate 핵심 워크플로가 **완전히 동일**하게 동작한다.

## 5. REQ-A 설계 (초안)

### 5.1 D1 설치 경로 — `.claude/skills/` 단독

**제안 결정: `.claude/skills/commitgate-<name>/SKILL.md` 만.** `.agents/skills/`는 설치하지 않는다. 확정 시 CLI help·README에 명시.

근거: CommitGate에서 **Codex는 read-only 샌드박스의 Reviewer**다. 4종은 전부 **Builder용**(요구정리·TDD·버그진단·조사)이라 Codex에 불필요하다. Builder는 Claude Code 또는 Cursor이고, **Cursor는 `.claude/skills/`를 호환 읽기**하므로 이 한 경로가 Builder 전체를 덮는다. 기존 `KIT_AGENT_ENTRYPOINTS` 선례와도 일치하고, `.claude/` 아래이므로 `--no-agent-entrypoints`(D7)에 자연히 걸린다.

정직한 지원 매트릭스(README에 그대로):

| harness | 발견 | 호출 |
|---|---|---|
| Claude Code | ✅ native | 모델 판단 또는 `/commitgate-*` |
| Cursor | ✅ `.claude/skills` 호환 읽기 | 모델 판단 또는 `/` 선택 |
| Codex | ❌ (`.agents/skills`만 스캔) | — (설계상 불필요: Reviewer) |

### 5.2 D2 패키지 payload

- `package.json` `files[]` **+= `"skills"`** — 누락 시 tarball에서 `walkFiles` ENOENT(과거 P1 유형).
- `.npmignore` 없음 → 루트 `.gitignore`가 화이트리스트 내부에도 적용된다. **스킬 파일명에 dot-prefix 금지**(npm이 dot-basename을 strip — `templates/workflow.gitignore`가 non-dot인 이유).
- 런타임 해소는 기존 `PACKAGE_ROOT` 방식을 그대로 쓴다.

### 5.3 D3 seed-once (force-immune)

**제안 결정: `--force`로도 덮지 않는다.** 확정 시 CLI help(`--force` 설명)·README에 명시. `add()` 경로(`:553`)를 쓰지 않고 `workflow/.gitignore`(D12, `:866-869`) 방식을 따른다: 부재 시에만 생성, `opts.force` 무시, 자체 `sha256File` ownership 계산 후 `ownedSkips` push.

근거: 스킬은 **사용자가 고치라고 만든 자산**이다. `add()` 경로면 `--force`가 손수정을 조용히 날린다 — 이 REQ에서 가장 현실적인 데이터 손실 경로다. persona가 이미 SEED-ONCE로 취급되는 것과 같은 논리다.

비용(정직하게 계상): `sha256File` + `ownedSkips` + `PlanFacts`(`:498-511`) + `InstallPlan`(`:466-495`) + `uninstall.ts` `toolEntries`(`:218-226`).

### 5.4 D4 보안 동등성 — 신규 코드 필요

상속되지 않으므로 **명시적으로 추가**한다:

1. preflight에 `assertConfinedDest(targetRoot, <skills dest root>)` 호출(`:851` 인근). 현재 호출부는 1곳뿐이다.
2. `assertEntrypointPathsUsable`의 하드코딩 dest 목록(`:595`)에 skills 디렉터리 추가.
3. 회귀 테스트: `.claude/skills`가 symlink이거나 파일일 때 **쓰기 0회로 거부**(`tests/unit/init.test.ts:47-59`의 `snapshot()` 재사용).

`.claude/`는 `workflow/`처럼 공유 부모를 통한 우연한 보호가 **없다**.

### 5.5 D5 opt-out

- `--no-agent-entrypoints` → skills도 skip(D7 의미 유지, 신규 표면 0).
- `--no-companion-skills` → entrypoint는 깔되 skills만 skip. `InitOptions`·`parseArgs`·`printHelp`·`PlanFacts`에 추가.

### 5.6 D6 gitignore 축 — 경고한다. 침묵하지 않는다

`.claude/`가 gitignore된 repo에서 fresh init이 companion skills를 "설치했다"고 보고했는데 팀원 clone에는 없는 상황은 **제품 기대 위반**이다. 기본 설치가 skills를 포함한다고 약속하는 이상 조용한 누락은 허용되지 않는다.

| 경로 | 동작 |
|---|---|
| 기본 설치 | **WARN** — 설치는 하되 "`.claude/`가 ignore되어 팀원 clone에는 스킬이 없다"와 추적 방법(`git add -f` 또는 ignore 규칙 조정)을 안내 |
| `--strict` | **설치 전 fail-closed** — 기존 strict 의미(WARN → preflight throw)와 동일 |
| `--no-companion-skills` | **의도적 미설치** — 경고 없음 |

구현: `findIgnoredArtifacts`(`:303`)가 이미 ignored∧untracked를 잡아낸다. 기존 gitignore WARN/strict 축(`:902`, `:909`)에 skills 경로를 태우되, **`CONTRACT_POINTER_RELPATHS`(`:126-131`) 자체에 넣을지는 구현 시 판단**한다 — 그 상수는 "계약 포인터"라는 의미를 갖고 companion skills는 계약 포인터가 아니므로, 같은 WARN/strict 동작을 주되 의미가 다른 별도 목록이 더 정확할 수 있다. 어느 쪽이든 **경고는 반드시 난다.**

기존 계약 포인터처럼 강제 추적까지 요구하지는 않는다 — skills는 없어도 핵심 워크플로가 동일하게 동작하므로(R10) fail-closed는 `--strict`에서만이다.

### 5.7 D7 uninstall

`toolEntries`(`:218-226`)에 4종 추가. read-only 유지. 단 **정직하게**: `differs`는 "사용자 수정"이 아니라 "수정됨 **또는** 다른 버전이 깐 것"이며, `uninstall.ts:64`상 origin 판별 불가 파일은 **byte-identical이어도 자동 제거 대상에서 빠질 수 있다.** "byte-identical이면 정리 후보"라고 단정하지 않는다.

### 5.8 D8 스킬 본문 설계

공통 골격(4종 동일):

```markdown
---
name: commitgate-tdd
description: <≤1024자, 언제 쓰는지>
---
<!-- Adapted from github.com/mattpocock/skills @ d574778f94cf620fcc8ce741584093bc650a61d3 (v1.1.0)
     MIT License — Copyright (c) 2026 Matt Pocock. See skills/ATTRIBUTION.md. -->

## 전제
`req:next`가 AGENT일 때만 유효. 아니면 즉시 `req:next`로 복귀.

## 방법
<적응된 원칙 — 방법론만>

## 경계
commit·push·`req:commit`·state/responses stage 금지. 다음 행동은 `req:next`가 정본.
```

- frontmatter는 **open standard 준수**로 쓴다(name: 소문자+하이픈, 부모 디렉터리명과 일치, ≤64자 / description ≤1024자). Claude Code는 관대하지만(전 필드 optional) 거기 기대면 API·claude.ai 이식성이 깨진다.
- **`commitgate-discovery`만 `disable-model-invocation: true`** — 지시서가 "사용자 호출형"으로 규정했고, upstream `grill-me`도 같은 패턴이다. 나머지 3종은 모델 호출 허용.
- **MIT 고지는 설치된 SKILL.md 본문에 동행**시킨다. 별도 LICENSE 파일을 대상에 깔지 않는다 — MIT §2는 고지가 "copies or substantial portions"를 따라다닐 것을 요구하므로, 파일 자체에 붙는 편이 확실하고 대상 트리도 덜 어지럽힌다.
- 패키지 측에 `skills/ATTRIBUTION.md`(upstream repo·SHA·MIT 전문). 루트 `LICENSE`는 sol5288 단독 저작권이므로 **건드리지 않는다**(현재 NOTICE/THIRD-PARTY 파일 없음 — 신규 표면).

### 5.9 D9 강제력의 정직한 수준

`docs/ssot-design/04-user-roles-and-permissions.md`: "CommitGate에는 로그인 세션·토큰·RBAC 같은 애플리케이션 인증/인가가 존재하지 않는다" / "현재 권한 모델은 협조적 에이전트의 행동 분리 + 아티팩트 무결성".

→ **"스킬은 commit할 수 없다"는 강제가 아니라 SKILL.md 안의 문장이다.** 기존 포인터와 같은 급이다. 설계 문서·README는 이 수준을 그대로 표기한다. 절대 표현("우회 불가")을 쓰지 않는다.

## 6. REQ-A phase 계획 (초안)

| phase | 범위 | 테스트 oracle |
|---|---|---|
| `phase-1-skill-bundle` | `skills/**` 4종 + `ATTRIBUTION.md` + `files[]` | payload 테스트: `npm pack` 목록에 skills 포함; 각 SKILL.md에 MIT 고지·baseline SHA 존재; frontmatter가 open standard 준수; dot-prefix 없음 |
| `phase-2-init-install` | seed-once 설치 + confinement + `assertEntrypointPathsUsable` | fresh init에 4종 정확 경로 생성; 재실행 멱등; 손수정 파일이 `--force`에도 보존; symlink `.claude/skills` 거부 시 쓰기 0회 |
| `phase-3-optout-uninstall` | `--no-agent-entrypoints`/`--no-companion-skills` + uninstall `toolEntries` | 두 플래그에서 미설치; uninstall이 대상 tree 무변경(전후 snapshot 동일) |
| `phase-4-coexist-docs-smoke` | 공존 fixture + README(ko/en)·help·CHANGELOG | Matt skills 선설치/CommitGate 선설치 양쪽에서 타사 파일 보존·`AGENTS.md` 정본 유지·`req:next --json` 의미 불변·`req:doctor` 정상; Stage A migrate가 skills를 조용히 추가하지 않음; packed-tarball smoke |

각 phase: 관련 unit test → `npm run typecheck` → `npm test` → staged 범위 제한 → `req:next`가 지시하는 리뷰. **P1만 수정, observation은 backlog.**

## 7. 비목표 (이번 범위 밖 — 명시된 경계)

- `to-spec`·`to-tickets`·`implement`·`triage`·`wayfinder`·외부 `code-review`·외부 `handoff`·자동 병렬 sub-agent orchestration·codebase-wide architecture scan.
- 신규 manifest·자동 삭제·자동 upgrade 프레임워크(§2.4 — G-10 및 REQ-014 비목표와 충돌).
- `.agents/skills/` 이중 설치(§5.1).
- upstream 자동 동기화. baseline은 **수동 pin**이며 upstream은 8일간 39커밋으로 움직인다.
- 스킬 호출을 결정론적으로 만드는 hook 도입.

## 8. 착수 절차 (Stage B 완료 후)

1. Stage B가 Phase 2~5 완료·승인·**main 머지**될 때까지 대기.
2. `git checkout main && git pull` 후 **번호부터 dry-run으로 확인**. `nextReqId`는 워킹트리 `workflow/`만 스캔하므로 미머지 티켓과 충돌한다(REQ-018에서 실증). main에 014·018이 함께 있으면 019가 나와야 한다.
3. `req:new <slug> --run` → `00/01/02`를 §4~§6으로 채운다 → design 리뷰 → phase 루프.
4. **`req:next`가 유일한 다음 행동 정본이다.**
5. **HIGH 확인 시점 — 리뷰 승인 後, `req:commit --run` 직전.**

   > HIGH 확인은 phase 리뷰 승인 후, `req:next`가 요구하는 `req:commit --run` 직전의 통제점에서만 받는다. 설계·phase 리뷰 전에 미리 받은 확인은 커밋 실행 승인으로 해석하지 않는다.

   `state.json`은 **스크래치**이므로 `user_commit_confirmed` 기록이 staged tree 바인딩(D9)을 바꾸지 않는다 — "리뷰 전에 미리 기록해야 D9 stale을 피한다"는 것은 **오해다**.

   실측 근거(REQ-2026-014 `approvals.jsonl`, 두 HIGH phase 모두 `approved_at` → `confirmed_at` → `consumed_at` 순):

   | phase | approved_at | confirmed_at | consumed_at |
   |---|---|---|---|
   | `phase-1-dispatch` | 13:03:42Z | 13:22:38Z | 13:23:52Z |
   | `phase-2-init-runtime` | 17:14:31Z | 23:25:10Z | 23:26:01Z |

   계약 근거: `AGENTS.template.md` §4 "HIGH 영향 phase는 `req:commit --run` 직전 사용자 확인(`state.user_commit_confirmed`)". 승인은 그 통제점 고유의 문장으로만 유효하며 이월되지 않는다(§5).
6. `state.json`·`responses/`는 **스테이징하지 않는다**(D10이 스크래치로 인정). `git add <ticket>/` 통짜 금지 — 문서만 개별 지정.

## 9. 남은 미검증 항목

- Codex가 `.codex/skills`도 여전히 읽는지는 OpenAI 1차 문서에 없다(Cursor 문서는 legacy-compat로 분류). **`.agents/skills`만 1차 확인됨.** — D1이 `.claude/skills` 단독이므로 이번 결정에 영향 없음.
- Claude Code가 open standard의 name 규칙을 **강제**하는지는 양쪽 다 명시 없음. → 준수해서 쓰면 무관.
- Claude Code precedence "enterprise > personal > **project**"는 문서 인용이나 직관과 반대다. 사용자의 `~/.claude/skills/commitgate-tdd`가 프로젝트 것을 **이긴다**. 설계가 여기 의존하면 실측 필요.
- pointer 추적 신뢰도는 **양 벤더 모두 미문서화**(부재 증거이지 "안 된다"는 벤더 진술이 아님).
