# CommitGate

🌐 **한국어** · [English](./README.en.md)

**AI 코딩 변경을 Codex 리뷰 승인 없이는 커밋하지 못하게 막는 커밋 게이트입니다.**

AI 에이전트가 코드를 빠르게 만들더라도, 리뷰 없이 바로 커밋되면 위험합니다. CommitGate는 변경을 티켓 단위로 묶고, Codex가 승인한 staged tree만 커밋되게 합니다. 승인 후 코드가 바뀌거나 증거가 부족하면 기본적으로 막습니다.

> **⚠️ 시작하기 전에 두 가지를 알아 두세요.**
>
> 1. **리뷰는 staged diff를 외부로 전송합니다.** `req:review-codex`는 `git diff --cached` **전문**을 Codex(OpenAI)로 보냅니다. codex는 `--sandbox read-only`로 저장소 루트를 읽으므로 diff에 없는 파일도 읽힐 수 있습니다. 마스킹·필터·길이 상한은 **없습니다.** 리뷰 전에 staged 내용에 자격증명·토큰·개인정보가 없는지 확인하세요.
> 2. **git hook을 설치하지 않습니다.** `req:commit` 대신 `git commit`을 직접 치면 게이트·승인 바인딩·증거 기록이 전부 우회됩니다. CommitGate의 강제력은 **협조하는 에이전트를 계약 궤도에 유지하는 것**에 있지, 사람의 우회를 막는 데 있지 않습니다.

[![CI](https://github.com/sol5288/commitgate/actions/workflows/ci.yml/badge.svg)](https://github.com/sol5288/commitgate/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/commitgate.svg)](https://www.npmjs.com/package/commitgate)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

---

## Quick Start

아래는 가장 짧은 사용 경로입니다. 프로젝트 루트는 **git 저장소이고 `package.json`이 있는 폴더**여야 합니다.

```sh
# 아직 git 저장소가 아니거나 package.json이 없는 새 폴더라면 먼저:
git init
npm init -y

# 1) CommitGate를 devDependency로 설치합니다 — 실행 코드가 여기 들어옵니다:
npm install -D commitgate

# 2) 프로젝트에 설정·계약·스키마와 req:* 스크립트를 깝니다:
npx commitgate init

codex --version
codex login status
```

> **왜 두 단계인가요?** CommitGate는 실행 코드를 프로젝트에 **복사하지 않습니다**. 1단계가 런타임을 `node_modules/commitgate`에 넣고, 2단계는 프로젝트에 **거버넌스 자산**(설정·계약·스키마·persona)과 `req:* = commitgate <verb>` 스크립트만 깝니다.
> 그래서 업데이트는 `npm update commitgate` 한 번이고, 런타임 제거는 `npm uninstall -D commitgate`입니다.
> `init`은 `devDependencies.commitgate` 선언이 없으면 **중단**합니다 — `req:*`가 가리킬 런타임이 없기 때문입니다.

설치는 파일을 놓기만 하고 커밋하지 않습니다. `req:new`는 **clean 워킹트리를 요구**하므로, 설치분을 먼저 커밋하세요. 설치 출력의 `다음:` 안내가 stage할 정확한 경로 목록을 알려 줍니다.

```sh
git add -- <설치 출력이 알려 준 경로들>
git status                    # 의도한 것만 staged 인지 눈으로 확인
git commit -m "chore: install commitgate"
```

> **전체를 담는 stage(`-A` / `.`)를 쓰지 마세요.** 기존 프로젝트의 무관한 변경과 `.env` 같은 미추적 파일이 함께 커밋되고, 이어지는 `req:review-codex`가 그 staged diff 전문을 외부로 전송합니다.
> 설치 전부터 있던 무관한 변경은 설치 커밋 뒤에 **경로를 명시해** 치우세요: `git stash push -u -- <경로들>`.
> `-u` 없이는 untracked가 남아 `req:new`가 막히고, 경로 없이 `git stash -u`만 쓰면 `node_modules/`처럼 무시되지 않은 디렉터리까지 딸려 갑니다. 설치 출력이 그 경로 목록도 알려 줍니다.

**긴 프롬프트를 붙여넣을 필요가 없습니다.** 설치가 에이전트 진입점을 함께 깝니다.

| 파일 | 읽는 도구 |
|---|---|
| `AGENTS.md` | Codex CLI, Cursor — **계약 정본** |
| `.claude/skills/commitgate/SKILL.md` | Claude Code (자동 발견 — 호출은 모델 판단) |
| `.claude/commands/req.md` | Claude Code (`/req` 명시 호출) |
| `.cursor/rules/commitgate.mdc` | Cursor (`alwaysApply`) |
| `CLAUDE.md` | Claude Code (항상 로드) — 부재 시에만 생성 |

에이전트에게 요구사항만 주면 됩니다.

```text
/req 프로필 수정 API를 추가해줘

- 무엇을: PATCH /profile 로 닉네임·소개글 수정
- 왜: 지금은 가입 후 프로필을 바꿀 방법이 없다
- 제약: 기존 인증 미들웨어 재사용, 스키마 변경 없음
- 완료 기준: 단위 테스트 통과, 권한 없는 사용자는 403
```

Claude Code가 아니면 슬래시 커맨드 없이 요구사항만 주어도 됩니다(`.cursor/rules`·`AGENTS.md`가 규칙을 로드합니다). 네 칸이 비어 있으면 에이전트가 먼저 물어봅니다.

첫 응답은 보통 이렇게 나옵니다.

```text
REQ-2026-002 발행
브랜치: feat/req-2026-002-profile-edit-api
phase:
- phase-1: PATCH /profile 구현
- phase-2: 테스트와 회귀 확인
통제점: req:commit --run 직전 / [B1] main direct push 직전 (또는 [I1] PR 생성 → [I2] merge)
```

### 에이전트는 `req:next`가 시키는 대로 진행합니다

다음 행동을 에이전트가 추측하지 않습니다. 도구가 `state.json`과 git 상태에서 계산합니다.

```sh
npm run req:next -- 2026-002
```

```text
[req:next] RUN  REQ-2026-002
  phase `phase-1`의 staged 변경을 리뷰받는다.

  $ npm run req:review-codex -- 2026-002 --kind phase --phase phase-1 --run
```

| kind | 뜻 | exit |
|---|---|---|
| `RUN` | 출력된 명령을 그대로 실행하고 다시 `req:next` | 0 |
| `AGENT` | 도구가 대신 못 하는 작업(구현·문서 작성·`git add`) | 0 |
| `AWAIT_HUMAN` | **통제점** — 출력된 승인 문장을 그대로 받기 전엔 진행 금지 | 10 |
| `DONE` | 이 티켓에서 도구가 할 일 없음. 통합은 별도 통제점 | 11 |
| `BLOCKED` | 사람에게 보고. 같은 리뷰 재시도 금지 | 2 |

`--json`으로 기계 판독할 수 있습니다. **읽기 전용**이라 어떤 상태도 바꾸지 않습니다.

이 루프를 끊지 말고 반복하면 설계 → Codex 리뷰 → 구현 → 재리뷰 → 커밋이 진행됩니다. 사용자는 `AWAIT_HUMAN`에서만 확인하면 됩니다.

### 리뷰어 페르소나는 도구가 주입합니다

`req:review-codex`는 `workflow/review-persona.md`를 프롬프트 **첫 블록**으로 넣습니다. 사람이 직접 실행하든, Cursor가 실행하든, Claude가 실행하든 동일합니다 — 에이전트가 잊을 수 있는 자리에 두지 않습니다. 파일이 없거나 비어 있으면 리뷰가 fail-closed로 멈춥니다.

내용을 프로젝트에 맞게 고치거나, `req.config.json`의 `reviewPersonaPath`로 다른 파일을 지정할 수 있습니다. `null`로 두면 비활성화됩니다 — 다만 **delta design 리뷰에는 내장 delta 계약이 주입된다**(승인 baseline 이후 변경분만 재검토하도록 리뷰어에게 거는 계약이라, 설정 persona와 무관하게 붙습니다).

### 설계 재리뷰는 delta로 좁혀집니다

설계가 한 번 승인되면 그 시점의 설계 문서(기본 `00/01/02`, `designDocs` 설정으로 변경 가능)를 baseline으로 기억합니다. 이후 설계를 고쳐 재리뷰하면, 리뷰어에게 **변경된 문서와 그 직접 영향 범위만** 심사하도록 프롬프트를 구성합니다. 변경 문서는 `[변경됨 — 심사 대상]`, 미변경 문서는 `[승인 baseline — 변경 없음, 참조]`로 표시하고, 승인된 영역을 다시 문제 삼지 말라는 계약을 겁니다. 미변경 문서는 본문 대신 생략 표식만 전달해 토큰을 아낍니다. 승인 후 작은 편집이 전체 재리뷰를 유발해 승인이 되돌려지던 문제를 줄입니다.

변경이 너무 근본적이라 delta로 판단할 수 없으면 리뷰어가 `full_review_requested: "yes"`(그때 `commit_approved: "no"`)로 전체 재리뷰를 요청합니다. 그러면 baseline이 비워져 다음 설계 리뷰가 full 모드로 돌아가고, 그 설계가 다시 승인되면 새 baseline이 잡혀 delta가 재개됩니다.

main에 반영하는 경로는 **PR 경유(선택)**와 **direct push** 둘 다 유효합니다. PR은 의무가 아닙니다. 다만 protected branch로 직접 push하면 required checks를 **우회**하므로 "branch protection bypass를 사용한 direct push 승인"을 따로 받아야 합니다 — bypass 권한이 있다는 사실은 승인이 아닙니다. 그리고 이때 CI는 push **이후에** 도는 **사후 검증**이라, 그 사실을 보고에서 생략하지 않습니다. tag, npm publish, GitHub release는 반영과 묶이지 않는 별도 통제점이고 CI green 이후에 요청합니다. 자세한 계약은 [AGENTS.template.md](AGENTS.template.md)와 [docs/RELEASING.md](docs/RELEASING.md)를 참고하세요.

---

## 무엇을 보장하나요?

CommitGate가 막는 것은 단순한 명령 실수가 아니라 **리뷰받지 않은 변경이 커밋되는 상황**입니다.

- Codex 리뷰가 실패하거나 없으면 커밋할 수 없습니다.
- 승인된 staged tree와 지금 커밋하려는 staged tree가 다르면 막습니다.
- `state.json`, `responses/` 같은 워크플로 내부 파일을 source 커밋에 섞으면 막습니다.
- Codex CLI가 없거나 실행에 실패하면 조용히 통과하지 않고 실패합니다.
- 리뷰 종료코드는 outcome 기준입니다: `0` 승인, `1` 무효/fail-closed, `2` blocked(지적 없음+미승인), `3` needs-fix.
- 지적은 없지만 승인도 없는 응답은 NEEDS_FIX가 아니라 BLOCKED이며, 에이전트는 같은 리뷰를 반복하지 않습니다.
- 열린 `(review_kind, phase_id)` review series별로 재리뷰 시도를 계수합니다. 기본값 `{ autoBudget: 5, hardCap: 8 }`에서 1~5회차는 자동, 6~8회차는 회차마다 사람 예외 기록이 있어야 진행, `hardCap` 회를 소진하면 그 다음 시도(9회차부터)는 예외가 있어도 차단합니다 — 무한 재리뷰 루프를 막습니다. 승인되면 그 series가 닫히고, 미수렴 series를 사람이 `human-resolution`으로 종료하면 같은 키의 자동 재개가 막힙니다.
- 리뷰어는 한 호출에서 파악한 P1을 모두 `findings[]`에 함께 반환합니다(배칭). 한 건씩 내고 재검수받는 직렬 흐름이 리뷰 라운드를 부풀리던 문제를 줄입니다 — P1 기준을 낮추는 것이 아니라, 이미 아는 P1을 다음 라운드로 미루지 않는 것입니다.
- 설치 시 기존 `cross-spawn`이 검증 하한보다 낮으면 경고하고, `--strict`에서는 중단합니다.
- 승인 응답과 증거 파일은 `workflow/REQ-.../responses/`에 남습니다.

한 줄로 말하면, **확실히 승인된 변경만 통과하고 애매하면 멈추는 방식**입니다.

### 보장하지 않는 것

방어선을 잘못 계산하지 않도록, 이 도구가 **하지 않는 일**을 분명히 해 둡니다.

- **하드 강제가 아닙니다.** git hook을 설치하지 않으므로 `req:commit` 대신 `git commit`을 직접 치면 doctor·승인 바인딩·증거 기록이 전부 우회됩니다. 운영 반영의 실제 방어선은 여전히 CI와 배포 파이프라인입니다.
- **staged 내용의 비밀을 지켜 주지 않습니다.** `req:review-codex`는 `git diff --cached` 전문을 Codex(OpenAI)로 전송하고, codex는 `--sandbox read-only`로 저장소 루트를 읽습니다. 마스킹·스크러빙·길이 상한이 없습니다. 결제·자격증명처럼 민감한 코드베이스라면 리뷰 전 staged diff를 육안으로 확인하는 절차를 계약(`AGENTS.md`)에 명문화하세요.
- **커밋 이후를 보장하지 않습니다.** 승인은 커밋 시점의 staged tree에 대한 것이고, 머지·태그·publish는 각각 별도 통제점입니다.

---

## 설치가 하는 일

`npx commitgate init`은 대상 프로젝트에 아래 파일과 설정을 추가합니다. 기존 파일은 기본적으로 덮어쓰지 않습니다.

| 추가 항목 | 설명 |
|---|---|
| `workflow/*.schema.json` | Codex 응답과 설정 검증 스키마 |
| `workflow/review-persona.md` | Codex 리뷰 프롬프트에 주입되는 리뷰어 페르소나 (없을 때만 생성) |
| `req.config.json` | 프로젝트별 설정 |
| `AGENTS.md` | 계약 정본 (없을 때만 생성) |
| `CLAUDE.md` | Claude Code 지침 포인터 (없을 때만 생성) |
| `.claude/skills/commitgate/SKILL.md` | Claude Code 스킬 (포인터) |
| `.claude/commands/req.md` | `/req` 슬래시 커맨드 (포인터) |
| `.cursor/rules/commitgate.mdc` | Cursor 규칙 (포인터) |
| `.claude/skills/commitgate-*/SKILL.md` | **Companion Skills** 4종 — 아래 참조 (기존 파일 보존) |
| `package.json` 스크립트 | `req:new`·`req:next`·`req:review-codex`·`req:doctor`·`req:commit` = `commitgate <verb>` (없는 키만) |

### Companion Skills

CommitGate는 **거버넌스 레이어**입니다 — `req:next`가 다음 행동을 계산하고, 리뷰·승인·증거가 커밋을 게이트합니다.
그런데 "무엇을 만들지 정리하는 법", "테스트를 어떻게 먼저 쓰는지" 같은 **방법론**은 비어 있었습니다.
Matt Pocock의 공개 skills(MIT)를 CommitGate의 권한 경계에 맞게 적응해 4종을 함께 설치합니다.

| 스킬 | 언제 |
|---|---|
| `commitgate-discovery` | `req:new` **전** — 모호한 요구를 REQ Brief로 정리. **사용자 호출형** |
| `commitgate-tdd` | `req:next`가 `AGENT`일 때 — Red → Green → Refactor → stage |
| `commitgate-diagnosing-bugs` | 버그·회귀·성능 — 피드백 루프 → 재현·최소화 → 가설 → 계측 → 수정 |
| `commitgate-research` | 외부 기술 선택 — 1차 출처 조사, 결론·출처·한계 |

**자동 발견 · 모델 판단 호출.** harness가 스킬을 자동으로 **발견**하지만, 쓸지 **판단하는 건 모델**입니다 —
확률적이며 항상 뜬다고 기대하면 안 됩니다. Claude Code에서는 `/commitgate-<이름>`으로 **직접 호출**할 수도 있습니다.
다른 harness에서는 그 harness가 제공하는 호출 방식을 쓰거나, `AGENTS.md`의 진입 흐름을 따르세요.

**권장 흐름**: `commitgate-discovery`로 요구 정리 → `/req`(Claude Code) 또는 `AGENTS.md` 진입 → `req:new` → `req:next` 반복.

#### 경계 — 반드시 알아 두세요

- 🔴 **`AGENTS.md`가 계약 정본입니다.** 스킬은 **방법론**이지 계약이 아닙니다.
  스킬을 설치하지 않아도 **핵심 워크플로는 완전히 동일하게** 동작합니다.
- 🔴 **스킬 결과는 승인 증거가 아닙니다.** companion skills의 산출물도, 외부 Matt skills를 따로 돌린 결과도
  CommitGate·Codex의 **승인 근거가 되지 않습니다**. 리뷰 실행·승인 판정·상태 전이·커밋은 **CommitGate만** 담당하며,
  다음 행동은 `req:next`가 정본입니다.
- 스킬은 **협조적 텍스트**입니다 — 스킬이 커밋을 막는 게 아니라, 막는 건 CommitGate의 게이트입니다.

#### 설치·보존·옵션

- **`--no-agent-entrypoints`**: `.claude/` 계층 전체를 건너뜁니다(companion 4종 포함).
- **기존 파일 보존(seed-once)**: 스킬은 **고치라고 만든 자산**입니다. 수정한 스킬은 **`--force`로도 덮어쓰지 않습니다.**
  `AGENTS.md`·`CLAUDE.md`·`workflow/.gitignore`도 같은 정책입니다.
- **gitignore 경고**: `.claude/`를 gitignore하면 팀원의 fresh clone에 스킬이 전달되지 않습니다.
  설치는 진행하되 **경고**하고 추적 방법을 안내합니다. **`--strict`면 설치 전에 중단**합니다.
- **타사 skill과 공존**: 타사 `tdd`·`grill-me` 등은 `.claude/skills/<이름>/`, companion은 `.claude/skills/commitgate-<이름>/` —
  **경로가 달라 서로 건드리지 않습니다.**

#### 출처

Matt Pocock의 MIT 공개 skills를 기준 SHA `d574778f94cf620fcc8ce741584093bc650a61d3`에서 적응해
**패키지 payload로 포함**합니다. **외부 skill installer를 실행하거나 런타임 의존하지 않습니다** —
패키지 안에 고정된 사본입니다. 각 SKILL.md에 MIT 고지 전문이 동행하며, 자세한 출처는 패키지의
`skills/ATTRIBUTION.md`에 있습니다.

### 설치하지 **않는** 것

| 항목 | 어디에 있나 |
|---|---|
| `scripts/req/**` 실행 코드 | `node_modules/commitgate` — 프로젝트에 복사하지 않습니다 |
| `tsx` · `ajv` · `cross-spawn` | `commitgate` 패키지의 runtime dependency — 대상 `package.json`에 주입하지 않습니다 |

프로젝트에 남는 것은 **거버넌스·감사 데이터**(설정·계약·스키마·persona·`workflow/REQ-*` 증거)뿐입니다. 실행 코드는 패키지에만 있으므로 `npm update commitgate` 한 번으로 갱신되고, 복사본 버전이 갈라지지 않습니다.

`req:*` 스크립트는 설치된 패키지 bin을 호출합니다 — `npm run req:new -- <slug>` → `commitgate req:new <slug>` → `node_modules/.bin/commitgate`.

진입점 파일들은 **얇은 포인터**입니다. 계약 본문은 `AGENTS.md` 하나에만 있습니다.

`.claude/`·`.cursor/`를 다른 도구가 쓰고 있다면 건너뛸 수 있습니다.

```sh
npx commitgate --no-agent-entrypoints
```

기존 `AGENTS.md`가 있는데 CommitGate 계약 마커(`<!-- commitgate:contract -->`)가 없으면, 계약 템플릿을 `AGENTS.commitgate.md`로 함께 놓고 병합을 안내합니다. 기존 파일은 건드리지 않습니다.

미리보기만 하려면:

```sh
npx commitgate --dry-run
```

정합성 경고를 설치 실패로 취급하려면:

```sh
npx commitgate --strict
```

**파일을 하나도 쓰기 전에** 중단합니다. 대상은 다음과 같습니다.

- 계약 포인터(`.claude/`·`.cursor/`·`AGENTS.md`·`CLAUDE.md`)가 `.gitignore`에 걸려 팀·CI에 공유되지 않을 때
- `workflow/.gitignore` 정책 파일이 무시돼 fresh clone·CI에 scratch 규칙이 전달되지 않을 때
- 설치 전 워킹트리에 staged 변경이 있거나 설치 산출물과 겹치는 수정이 있어, 설치분만 담은 커밋을 만들 수 없을 때
- 기존 `cross-spawn`이 검증 하한보다 낮을 때(프로젝트가 그 패키지를 이미 쓰는 경우)

> `--strict`는 **선행 `npm install -D commitgate`가 남긴 `package.json`·lockfile 변경도** preexisting-dirty로 봅니다. 권장 순서: `npm i -D commitgate` → **커밋** → `npx commitgate init --strict` → 설치분 커밋.

> `workflow/machine.schema.json`과 `workflow/req.config.schema.json`은 `req.config.json`의 `ticketRoot` 설정과 무관하게 **항상 `workflow/` 아래**에 복사됩니다.

---

## 예전 설치본에서 옮겨오기 (`migrate`)

`scripts/req/`가 프로젝트에 복사돼 있고 `req:*`가 `tsx scripts/req/*.ts`를 가리킨다면 **예전(vendored) 설치본**입니다. `init`은 이 상태를 감지하면 조용히 섞이지 않도록 **중단하고** 이 명령을 안내합니다.

```sh
npm install -D commitgate      # 아직 devDependency가 아니라면 먼저
npx commitgate migrate         # 계획만 출력 — 아무것도 쓰지 않습니다
npx commitgate migrate --apply # package.json 의 req:* 만 전환
```

`migrate`가 하는 일은 **하나**입니다: `req:*` 중 **현재 값이 정확히 예전 주입값인 키만** `commitgate <verb>`로 바꿉니다.

- **아무것도 삭제하지 않습니다.** `scripts/req/`·스키마·persona·설정·진입점·`workflow/REQ-*` 증거를 전부 그대로 둡니다. 남은 `scripts/req/`는 더 이상 실행되지 않으니, 정리하려면 `npx commitgate uninstall` 계획을 먼저 확인하세요.
- **직접 고친 스크립트는 덮어쓰지 않습니다.** 값이 한 글자라도 다르면 사용자 값으로 보고 보존한 뒤 수동 조치를 안내합니다.
- **커밋하지 않습니다.** `package.json` 한 파일만 쓰고, 검토는 사용자 몫입니다.

`req:doctor`도 설치 모드(예전/현재/혼합)를 진단해 알려 줍니다.

---

## 지원 범위

| 환경 | 상태 |
|---|---|
| **npm** | 완전 지원 — 매 릴리스 packed tarball smoke로 검증합니다 |
| **pnpm · yarn** (`node_modules` linker) | 지원 — `node_modules/.bin/commitgate`로 해소되는 표준 경로를 씁니다 |
| **Yarn PnP** | **이번 릴리스 미지원**(검증하지 않았습니다). `nodeLinker: node-modules`를 쓰세요 |
| **workspace/monorepo** | **워크스페이스 root 설치**를 지원합니다(root에 `req.config.json`·`workflow/`). 하위 패키지에 독립 설치하는 배치는 미지원 |

**재현성**: `req.config.json`의 리뷰 모델·추론강도 핀과 스키마·persona가 프로젝트에 남아 과거 리뷰 입력이 git 이력으로 재현됩니다. 런타임 버전은 **lockfile이 고정**하므로 `package-lock.json`(pnpm/yarn은 각 lockfile)을 **커밋하세요**.

### Companion Skills 발견 범위

**설치는 모든 환경에서 동일합니다.** 아래는 harness가 그 파일을 **발견하는지**에 대한 것입니다.

| harness | 발견 |
|---|---|
| **Claude Code** | `.claude/skills/<이름>/SKILL.md`를 native로 읽습니다 |
| **Cursor (editor)** | `.claude/skills`를 호환 경로로 읽습니다 |
| **Cursor (CLI)** | ⚠️ **버전·실행 모드별 동작 차이 가능 — 보장하지 않습니다** |
| **Codex** | **제품 범위 밖** — companion entrypoint를 설치하지 않습니다. CommitGate에서 Codex는 **Reviewer**이고 이 4종은 **Builder 보조**입니다 |

⚠️ **근거는 벤더 1차 문서입니다 — CommitGate 팀이 실측한 것이 아닙니다.** 확인 시점 **2026-07-17**, 확인 환경 win32 x64 / Node v20.19.5.
벤더가 동작을 바꾸면 이 표는 낡을 수 있습니다.

⚠️ **Cursor CLI를 "지원"·"미지원" 어느 쪽으로도 단정하지 않습니다.** Cursor는 editor·CLI 양쪽의 Agent Skills 지원을
발표했지만, `.claude/skills` 호환 경로의 CLI 발견은 버전·모드에 따라 차이가 보고돼 있고 우리는 검증하지 못했습니다.
발견되지 않아도 **핵심 워크플로에는 영향이 없습니다** — 스킬은 품질 보조 레이어이고 계약 정본은 `AGENTS.md`입니다.

우회를 위해 `.cursor/skills`에 **이중 설치하지 않습니다** — 그 경로도 CLI에서 동작이 불확실하고, 같은 내용이 두 곳에
깔리면 drift 위험이 생깁니다. 벤더가 고치면 **우리 변경 없이** 동작합니다(같은 경로를 읽으므로).

---

## 제거하려면

CommitGate는 두 곳에 있습니다. **런타임**(`node_modules/commitgate`)과 **프로젝트에 깔린 거버넌스 파일**입니다.

런타임은 package manager가 지웁니다:

```sh
npm uninstall -D commitgate      # pnpm remove -D commitgate · yarn remove commitgate
```

프로젝트 파일은 아래 계획을 보고 직접 정리하세요. 먼저 알아둘 것: **`npx commitgate`는 전역 설치가 아닙니다.** npx는 패키지를 npm 캐시(`_npx/<hash>/`)에 받아 한 번 실행할 뿐이고, 전역 `node_modules`에도 PATH에도 아무것도 남기지 않습니다.

제거 계획을 먼저 확인하세요. 이 명령은 **아무것도 지우지 않고** 계획만 출력합니다:

```sh
npx commitgate uninstall
```

repo를 읽어 (1) CommitGate가 설치한 파일 중 패키지 원본과 바이트가 동일한 것, (2) 편집돼서 직접 확인이 필요한 것, (3) 자동 제거하면 안 되는 것, (4) 감사 증거를 분류해 보여주고, 커밋 여부에 맞는 되돌리기 명령을 출력합니다. 삭제는 사용자가 검토한 뒤 직접 실행합니다.

### 왜 자동으로 지워주지 않나요?

`init`은 **무엇을 새로 만들었는지 디스크에 기록하지 않습니다.** 그래서 제거 시점에는 아래를 구분할 수 없습니다.

- `AGENTS.md`는 **없을 때만** 생성됩니다. 이미 있었다면 그대로 두므로, init이 만든 파일과 사용자가 쓴 파일이 디스크상 같아 보입니다.
- `req.config.json`은 이미 있으면 **누락된 키만 병합**합니다. 원본을 보관하지 않아 병합을 되돌릴 수 없습니다.
- `package.json`은 **없는 키만** 주입합니다. 원래 있던 `req:doctor`나 `cross-spawn`은 CommitGate 소유가 아닙니다. `ajv`·`cross-spawn`·`tsx`는 다른 패키지도 흔히 쓰는 devDependency입니다.
- `ticketRoot`(기본 `workflow/`)에는 REQ 티켓의 `state.json`과 `approvals.jsonl` — 이 도구의 **감사 증거** — 가 쌓입니다.

원장이 없는 상태에서 일괄 삭제하면 사용자 데이터를 파괴합니다. CommitGate는 git hook을 설치하지 않고 git config도 건드리지 않는 순수 in-tree 스캐폴더이므로, 되돌리기의 정본은 git입니다.

### 아직 커밋하지 않았다면

```sh
git status --porcelain -uall     # 무엇이 추가됐는지 확인
git diff -- package.json         # 주입된 req:* 스크립트와 devDependencies 확인
```

확인한 뒤 직접 되돌립니다. `package.json`은 반드시 `HEAD` 기준으로 복원하세요.

```sh
git checkout HEAD -- package.json
```

> ⚠️ `HEAD`를 빼면 **인덱스**에서 복원되어, `git add` 이후에는 주입된 `req:*` 스크립트가 그대로 남습니다.
> ⚠️ 이 명령은 `package.json`의 **다른 미커밋 편집도 함께 버립니다.** 먼저 위 diff를 확인하세요.

파일 삭제는 `npx commitgate uninstall`이 나열해 준 경로만 지우세요. `scripts/req/`나 `workflow/`를 디렉터리째 지우면 그 안의 사용자 파일이나 티켓 증거가 함께 사라집니다.

> git은 빈 디렉터리를 추적하지 않습니다. 파일을 다 지운 뒤 `git status`가 clean이어도 빈 `scripts/`·`workflow/`·`.claude/`·`.cursor/`가 파일시스템에 남을 수 있습니다.

### 이미 커밋했다면

스캐폴딩을 추가한 커밋을 되돌립니다.

```sh
git log --diff-filter=A --format='%H %s' -- scripts/req/req-new.ts
git revert <sha>
```

`npx commitgate uninstall`이 도입 커밋 후보를 찾아 줍니다. 그 커밋에 다른 변경이 섞여 있으면 revert가 무관한 작업까지 되돌리므로, 먼저 `git show <sha>`로 확인하세요. 도입 커밋이 여러 개로 흩어져 있으면 단일 revert로는 되돌릴 수 없습니다.

### npx 캐시 정리 (repo와 무관)

전역 설치 여부부터 확인합니다.

```sh
npm ls -g commitgate            # 비어 있으면 전역 설치가 아님
npm uninstall -g commitgate     # 전역으로 설치했던 경우에만
```

npx가 받아 둔 패키지는 npm 캐시의 `_npx/` 아래에 남습니다.

```powershell
# Windows (PowerShell)
Remove-Item -Recurse -Force "$(npm config get cache)\_npx"
```

```sh
# macOS / Linux
rm -rf "$(npm config get cache)/_npx"
```

> ⚠️ **`npm cache clean --force`는 CommitGate 제거 명령이 아닙니다.** 이 명령은 `_cacache`만 비우고 `_npx`는 그대로 둡니다. repo의 스캐폴딩과도 아무 관련이 없습니다.

---

## 준비물

| 필요 | 확인 명령 | 비고 |
|---|---|---|
| Git | `git --version` | 필수 |
| Node.js 18.17+ | `node --version` | 필수 |
| npm, pnpm, yarn 중 하나 | `npm --version` | npm 기준으로 안내 |
| Codex CLI | `codex --version` | 리뷰 실행에 필요 |

Codex CLI가 없다면:

```sh
npm install -g @openai/codex
codex login
codex login status
```

Windows에서 설치 직후 `codex` 명령을 못 찾으면 새 터미널을 열어 PATH를 다시 읽게 하세요.

---

## 수동 명령

대부분의 사용자는 `req:next`가 시키는 대로만 하면 됩니다. 아래는 내부에서 어떤 명령이 실행되는지 이해하거나 직접 디버깅할 때만 보면 됩니다.

```sh
# 1. 티켓과 브랜치 생성
npm run req:new -- my-feature --run

# 2. 설계 문서 작성 후 stage
git add workflow/REQ-2026-001/00-requirement.md workflow/REQ-2026-001/01-design.md workflow/REQ-2026-001/02-plan.md

# 3. 설계 리뷰
npm run req:review-codex -- 2026-001 --kind design --run

# 4. 코드 구현 후 stage
git add <changed-source-files>

# 5. 게이트 점검
npm run req:doctor -- 2026-001

# 6. 구현 리뷰
npm run req:review-codex -- 2026-001 --kind phase --run

# 7. 승인된 코드 커밋
npm run req:commit -- 2026-001 --run -m "feat: my feature"
```

중요: source 커밋에는 내가 만든 코드와 문서만 stage하세요. `state.json`과 `responses/`는 도구가 관리합니다.

여러 줄 커밋 메시지는 `-m` 대신 파일을 사용하세요.

```sh
npm run req:commit -- 2026-001 --run --message-file commit-message.txt
```

---

## 명령어 요약

| 명령 | 용도 |
|---|---|
| `npm install -D commitgate` | **런타임 설치 (선행 필수)** — 실행 코드가 `node_modules/commitgate`에 들어옵니다 |
| `npx commitgate init` | 프로젝트에 설정·계약·스키마와 `req:*` 스크립트 설치 |
| `npx commitgate init --dry-run` | 파일을 쓰지 않고 설치 계획 확인 |
| `npx commitgate init --strict` | 정합성 경고를 설치 실패로 처리 (gitignore된 계약 포인터, 설치 커밋을 안전하게 만들 수 없는 워킹트리 등) — 파일을 하나도 쓰기 전에 중단 |
| `npx commitgate init --no-agent-entrypoints` | `.claude/`·`.cursor/`·`CLAUDE.md` 설치 건너뛰기 |
| `npx commitgate migrate [--apply]` | 예전 vendored 설치본 → 런타임 패키지 전환 (기본: 계획만, 비파괴) |
| `npx commitgate uninstall` | 제거 계획 확인 (읽기 전용 — 아무것도 지우지 않음) |
| `npm uninstall -D commitgate` | 런타임 제거 |
| `npm run req:new -- <slug> --run [--successor-of <REQ-id>]` | REQ 티켓, 브랜치, 설계문서 생성. `--successor-of`는 대체 REQ (아래 참조) |
| `npm run req:next -- <id> [--json]` | **다음 행동 계산** (읽기 전용) |
| `npm run req:review-codex -- <id> --kind design --run` | 설계 리뷰 |
| `npm run req:review-codex -- <id> --kind phase --phase <p> --run` | 구현 리뷰 |
| `npm run req:doctor -- <id>` | 게이트 상태 확인 |
| `npm run req:commit -- <id> --run -m "message"` | 승인된 변경 커밋 |

`req:*`는 PATH에 잡히는 실행 파일이 아니라 **`package.json` 스크립트**입니다. npm은 인자 전달에 `--` 구분자가 필요합니다.

```sh
npm  run req:next -- 2026-002    # npm
pnpm req:next 2026-002           # pnpm
yarn req:next 2026-002           # yarn
```

**대체 REQ (`--successor-of`)**: 어떤 review series가 미수렴이라고 판단해 사람이 그것을 `human-resolution`으로 **대체(replace)** 종결한 경우에만, `req:new --successor-of <REQ-id>`로 부모 이력(시도 합계·종결 기록)을 보존한 대체 REQ를 만들 수 있습니다. 부모에 유효한 replace 종결 기록이 없으면 티켓 생성이 fail-closed로 막힙니다 — 일반적인 새 REQ 생성 자체를 도구가 막는 것은 아닙니다.

---

## 설정

대부분은 기본값으로 충분합니다. 필요하면 프로젝트 루트의 `req.config.json`을 수정하세요.

| 항목 | 기본값 | 설명 |
|---|---|---|
| `branchPrefix` | `"feat/req-"` | 새 브랜치 prefix |
| `ticketRoot` | `"workflow"` | REQ 티켓 폴더 |
| `packageManager` | 자동 감지 | `npm`, `pnpm`, `yarn` |
| `designDocs` | `00/01/02` 문서 | 설계 문서 파일명 |
| `reviewPersonaPath` | `"workflow/review-persona.md"` | 리뷰 프롬프트 첫 블록. `null`이면 비활성 — 단 delta design 리뷰에는 내장 delta 계약이 주입된다 |
| `reviewModel` | `"gpt-5.6-terra"` | codex 리뷰 모델(`-c model=`로 고정). `null`이면 codex 전역 설정을 상속 |
| `reviewReasoningEffort` | `"high"` | codex 리뷰 추론강도. `none`·`minimal`·`low`·`medium`·`high`·`xhigh` 중 하나. `null`이면 전역 상속 |
| `reviewBudget` | `{ "autoBudget": 5, "hardCap": 8 }` | 열린 `(review_kind, phase_id)` review series의 재리뷰 시도 예산. 기본값 기준 1~5회차는 자동, 6~8회차는 회차마다 그 series·회차에 바인딩된 사람 예외 기록이 있어야 진행, `hardCap` 회를 이미 소진하면 그 다음 시도(9회차부터)는 예외가 있어도 차단. `hardCap ≤ 8`·`autoBudget ≤ hardCap` |

빈 `branchPrefix`나 프로젝트 밖으로 나가는 경로는 거부됩니다.

**리뷰 모델·추론강도 고정**: `req:review-codex`는 codex 인자에 `-c model=`·`-c model_reasoning_effort=`를 주입해 **모델과 추론강도를 고정**합니다. 고정하지 않으면 리뷰가 사용자 전역 `~/.codex/config.toml`(예: `model_reasoning_effort="ultra"`)을 상속해 리뷰 1회가 수 분·토큰 과다가 됩니다. 기본값은 `gpt-5.6-terra`/`high`이고, 프로젝트의 codex가 그 모델을 지원하지 않으면 `req.config.json`에서 바꾸거나 `null`로 두어 전역 설정을 상속시킵니다. override가 실제로 존중되는지는 `npm run verify:overrides`(codex CLI 필요)로 확인할 수 있습니다.

**재리뷰는 stateless**: 재리뷰는 매번 **새 codex 스레드**로 시작합니다(이전 대화를 resume해 누적하지 않음 — 토큰 증가와 findings 심화·이동을 막습니다). 직전 같은 대상의 NEEDS_FIX findings만 참고용으로 프롬프트에 담겨 해소 여부(closure)를 확인합니다.

---

## FAQ

**Codex CLI가 없으면 어떻게 되나요?**
리뷰 명령이 실패합니다. 조용히 승인 처리하지 않습니다.

**승인 후 코드를 조금 고치면 커밋되나요?**
안 됩니다. 승인된 staged tree와 달라지면 stale 승인으로 보고 다시 리뷰를 요구합니다.

**`state.json`이나 `responses/`는 왜 stage하면 안 되나요?**
워크플로 증거와 상태 파일입니다. source 커밋에 섞이면 승인 바인딩이 흐려지므로 `req:commit`이 막습니다.

**cross-spawn 버전 경고가 나오면 어떻게 하나요?**
대상 프로젝트의 기존 `cross-spawn`이 CommitGate가 검증한 하한보다 낮을 수 있다는 뜻입니다. `npm i -D cross-spawn@^7.0.6`으로 올리세요. CI나 보안 민감 환경에서는 `npx commitgate --strict`를 사용해 경고를 실패로 다루세요.

**두 번 설치하면 덮어쓰나요?**
아니요. 기존 파일은 건너뜁니다. 강제로 갱신하려면 `--force`를 사용하세요.

---

## 현재 범위

현재 버전은 **런타임 패키지 모델**입니다. 실행 코드와 런타임 의존성은 `node_modules/commitgate`에만 있고, 프로젝트에는 거버넌스·감사 데이터와 `req:* = commitgate <verb>` 스크립트만 남습니다. (예전 vendored scaffold 설치본은 [`migrate`](#예전-설치본에서-옮겨오기-migrate)로 전환합니다.)

현재 운영 중인 검증입니다.

- GitHub Actions에서 `ubuntu-latest`, `macos-latest`, `windows-latest` × Node 18/20/22 매트릭스를 실행합니다.
- `npm run smoke`는 pack tarball을 임시 프로젝트에 실제로 설치해, 대상에 `scripts/req/`가 **없고** `tsx`·`ajv`·`cross-spawn`이 **주입되지 않으며** 다섯 `req:*`가 패키지 bin을 가리키는지, 그리고 `npm run req:doctor`가 실제로 패키지 안의 모듈까지 dispatch되는지 확인합니다. `migrate` 비파괴성도 같은 방식으로 검증합니다.
- Windows `.cmd` 래퍼 주입 회귀 테스트가 패키지 매니저와 Codex wrapper 경로를 보호합니다.

아래는 후속 범위입니다.

- Yarn PnP 지원, 워크스페이스 하위 패키지 독립 설치
- 자산↔런타임 버전 드리프트 탐지
- 비-git VCS 지원
- 더 다양한 설계문서 템플릿

---

## License

[MIT](./LICENSE) © 2026 sol5288
