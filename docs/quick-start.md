# Quick Start (설치와 첫 실행)

아래는 가장 짧은 사용 경로입니다. 프로젝트 루트는 **git 저장소이고 `package.json`이 있는 폴더**여야 합니다.

```sh
# 아직 git 저장소가 아니거나 package.json이 없는 새 폴더라면 먼저:
git init
npm init -y

# 1) CommitGate를 devDependency로 설치합니다 — 실행 코드가 여기 들어옵니다:
npm install -D commitgate

# 2) 프로젝트에 설정·계약·스키마와 req:* 스크립트를 깝니다:
npx commitgate init

# 3) 리뷰 모델·추론강도를 고르고 codex 로그인까지 마칩니다(대화형):
npx commitgate setup

# 준비 상태를 언제든 확인할 수 있습니다(비대화형·읽기 전용):
npx commitgate check
```

> 🔴 **3단계는 건너뛸 수 없습니다.** 신규 설치에서 setup을 마치지 않으면 `req:new`를 비롯한 워크플로 명령이 막힙니다 — 리뷰 모델·추론강도가 확인되지 않고 codex 로그인도 안 된 상태로 리뷰를 호출하면, 그 실패가 **리뷰 예산까지 차감**하기 때문입니다.
> **사람이 터미널에서 직접 실행합니다.** 대화형 전용이라 파이프·CI·에이전트 세션에서는 질문 없이 즉시 종료합니다 — 에이전트는 이 명령을 실행하지 않고 **사용자에게 실행을 요청**합니다.
> 이미 CommitGate를 쓰던 프로젝트는 **막히지 않습니다**(기존 설치본 예외 — [설정](./configuration.md#setup-완료-마커) 참조).
> setup은 `req.config.json`을 바꾸므로 워킹트리가 dirty해집니다. 아래 설치 커밋에 함께 담으세요.

### setup이 묻는 것

세 가지를 묻고, 각 질문은 **↑/↓로 고르고 Enter로 확정**합니다(Ctrl+C 취소). 값은 `req.config.json`에 기록됩니다.

| 질문 | 기본값 | 선택지 |
|---|---|---|
| 리뷰 모델 (`reviewModel`) | `gpt-5.6-terra` | `gpt-5.6-sol` · `gpt-5.6-terra` · `gpt-5.6-luna` · **직접 입력…** · 비움(codex 전역 설정 상속) |
| 추론강도 (`reviewReasoningEffort`) | `medium` | `none` · `minimal` · `low` · `medium` · `high` · `xhigh` · 비움 |
| 멈춤 지점 (`stopGate`) | `req` | `phase` · `req` · `merge` |

- **모델**은 목록에 없는 값을 쓸 수 있어 "직접 입력…" 항목이 있습니다. 나머지 두 질문은 스키마 enum이라 목록에서만 고릅니다.
- **비움**은 값을 지우는 것이 아니라 *codex 전역 설정을 따르겠다*는 뜻입니다.
- **멈춤 지점**이 사람 확인 위치를 정합니다 — `phase`=매 phase 커밋 전 · `req`=REQ를 완성시키는 커밋 · `merge`=묶음(delivery set) 종료(묶음이 없으면 `req`처럼 REQ 통합 직전). 위험도 `HIGH` 취급을 포함한 정본은 [워크플로 — HIGH 위험 티켓의 사람 확인](./workflow.md#high-위험-티켓의-사람-확인)입니다.
- setup은 마지막에 **codex 로그인 상태**를 확인하고, 필요하면 로그인까지 진행합니다.
- 값을 나중에 바꾸려면 setup을 다시 실행하거나 `req.config.json`을 직접 고치면 됩니다.

> **설치는 왜 두 단계인가요?** CommitGate는 실행 코드를 프로젝트에 **복사하지 않습니다**. 1단계가 런타임을 `node_modules/commitgate`에 넣고, 2단계는 프로젝트에 **거버넌스 자산**(설정·계약·스키마·persona)과 `req:* = commitgate <verb>` 스크립트만 깝니다.
> 런타임 제거는 `npm uninstall -D commitgate` 한 번입니다. **업데이트는 아래 [업그레이드 (0.x)](./upgrade.md) 절을 따르세요** — 런타임(`node_modules`)은 `npm`으로 올리지만, 프로젝트에 깔린 vendored 자산(스키마·persona)은 `commitgate sync`로 따로 맞춰야 하고, 0.x 캐럿 범위(`^0.y`)는 minor를 자동으로 넘지 않습니다.
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
| `.claude/skills/commitgate-*/SKILL.md` | **Companion Skills** 5종 — 아래 참조 (기존 파일 보존) |
| `package.json` 스크립트 | `req:new`·`req:next`·`req:review-codex`·`req:doctor`·`req:commit` = `commitgate <verb>` (없는 키만) |

### 설치하지 **않는** 것

| 항목 | 어디에 있나 |
|---|---|
| `scripts/req/**` 실행 코드 | `node_modules/commitgate` — 프로젝트에 복사하지 않습니다 |
| `tsx` · `ajv` · `cross-spawn` | `commitgate` 패키지의 runtime dependency — 대상 `package.json`에 주입하지 않습니다 |

프로젝트에 남는 것은 **거버넌스·감사 데이터**(설정·계약·스키마·persona·`workflow/REQ-*` 증거)뿐입니다. **실행 코드**는 패키지에만 있으므로 `npm update commitgate`로 갱신되고 복사본이 갈라질 일이 없습니다. 다만 프로젝트에 깔린 **vendored 자산**(스키마·persona)은 런타임과 별개라, minor 업그레이드 때 [업그레이드 (0.x)](./upgrade.md) 절을 따라 `commitgate sync`를 함께 실행해야 런타임과 갈라지지 않습니다.

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

## 준비물

| 필요 | 확인 명령 | 비고 |
|---|---|---|
| Git | `git --version` | 필수 |
| Node.js 20+ | `node --version` | 필수 |
| npm, pnpm, yarn 중 하나 | `npm --version` | npm 기준으로 안내 |
| Codex CLI | `codex --version` | 리뷰 실행에 필요 |

> 💳 **리뷰는 무료가 아닙니다.** CommitGate 자체는 MIT 오픈소스지만, 리뷰는 Codex를 **실제로 호출**하므로 로그인한 계정(ChatGPT 계정 또는 OpenAI API 키)의 **사용량·요금이 발생합니다.** 드는 비용은 선택한 모델과 변경 크기에 따라 다르므로 여기에 적지 않습니다 — 계정의 요금 정책을 확인하세요.
> 한 series의 재리뷰 횟수에는 상한이 있습니다(기본: 자동 5회 · 6~8회는 사람 예외 필요 · 9회부터 차단) — [설정 — `reviewBudget`](./configuration.md)을 보세요.

Codex CLI가 없다면:

```sh
npm install -g @openai/codex
codex login
codex login status
```

Windows에서 설치 직후 `codex` 명령을 못 찾으면 새 터미널을 열어 PATH를 다시 읽게 하세요.
