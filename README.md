# CommitGate

🌐 **한국어** · [English](./README.en.md)

**AI 코딩 변경을 Codex 리뷰 승인 없이는 커밋하지 못하게 막는 커밋 게이트입니다.**

AI 에이전트가 코드를 빠르게 만들더라도, 리뷰 없이 바로 커밋되면 위험합니다. CommitGate는 변경을 티켓 단위로 묶고, Codex가 승인한 staged tree만 커밋되게 합니다. 승인 후 코드가 바뀌거나 증거가 부족하면 기본적으로 막습니다.

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

# 그다음 설치:
npx commitgate
npm install
codex --version
codex login status
```

그다음 AI 코딩 에이전트에게 아래 프롬프트를 붙여넣습니다.

```text
이 요청은 일반 구현으로 처리하지 말고, 이 프로젝트에 설치된 CommitGate를 사용해라.

새 REQ 티켓을 만들고 다음 흐름을 끝까지 진행해라:
req:new → 설계문서 작성 → Codex design 리뷰 → 구현·테스트 → req:doctor → Codex phase 리뷰 → req:commit

자동으로 진행할 것:
- `req:review-codex`가 NEEDS_FIX/exit 3을 반환하면 findings를 수정하고 재리뷰한다.
- BLOCKED/exit 2를 반환하면 같은 리뷰를 재시도하지 말고 사람에게 보고하거나 리뷰 대상을 바꾼다. 스레드 고착이 의심되면 `--fresh-thread`로 한 번만 회복을 시도할 수 있다.
- 리뷰 대상은 git add 한 파일만이다.
- `state.json`과 `responses/`는 직접 `git add`하지 않는다.

멈춰서 확인받을 때(각 항목은 그 문장 그대로 승인받아야 하며, 한 승인은 다음 단계로 이월되지 않는다):
- req:commit --run 직전
- [경로 A · 선택] [I1] feature branch push + PR 생성 직전 / [I2] required checks green 확인 후 PR merge 직전
- [경로 B] [B1] protected branch에 direct push 직전 — "branch protection bypass를 사용한 direct push 승인"을 따로 받는다. 이 push는 required checks를 우회하고, CI는 사후에 돈다
- [R1/R2/R3] tag 생성·push / npm publish / GitHub release — CI green 확인 후 각각 별도 승인
- reset, clean, force push 같은 destructive 작업 전
- 요구사항 범위를 바꿔야 할 때
- Codex 리뷰가 BLOCKED를 반환하거나 제한된 재시도 후에도 판단이 불명확할 때

요구사항:
- 무엇을:
- 왜:
- 제약:
- 완료 기준:
```

첫 응답은 보통 이렇게 나와야 합니다.

```text
REQ-2026-002 발행
브랜치: feat/req-2026-002-profile-edit-api
phase:
- phase-1: PATCH /profile 구현
- phase-2: 테스트와 회귀 확인
통제점: req:commit --run 직전 / [B1] main direct push 직전 (또는 [I1] PR 생성 → [I2] merge)
```

이후에는 에이전트가 설계, 구현, 테스트, Codex 리뷰를 진행합니다. 사용자는 통제점에서만 확인하면 됩니다.

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
- 설치 시 기존 `cross-spawn`이 검증 하한보다 낮으면 경고하고, `--strict`에서는 중단합니다.
- 승인 응답과 증거 파일은 `workflow/REQ-.../responses/`에 남습니다.

한 줄로 말하면, **확실히 승인된 변경만 통과하고 애매하면 멈추는 방식**입니다.

---

## 설치가 하는 일

`npx commitgate`는 대상 프로젝트에 아래 파일과 설정을 추가합니다. 기존 파일은 기본적으로 덮어쓰지 않습니다.

| 추가 항목 | 설명 |
|---|---|
| `scripts/req/` | `req:new`, `req:review-codex`, `req:doctor`, `req:commit` 스크립트 |
| `workflow/*.schema.json` | Codex 응답과 설정 검증 스키마 |
| `req.config.json` | 프로젝트별 설정 |
| `AGENTS.md` | 에이전트와 Reviewer가 읽는 규칙 템플릿 |
| `package.json` 스크립트 | `req:*` 명령과 필요한 devDependencies |

미리보기만 하려면:

```sh
npx commitgate --dry-run
```

보안 하한 경고를 설치 실패로 취급하려면:

```sh
npx commitgate --strict
```

기존 `cross-spawn`이 검증 하한보다 낮으면 파일을 복사하기 전에 중단합니다.

> `workflow/machine.schema.json`과 `workflow/req.config.schema.json`은 `req.config.json`의 `ticketRoot` 설정과 무관하게 **항상 `workflow/` 아래**에 복사됩니다.

---

## 제거하려면

먼저 알아둘 것: **`npx commitgate`는 전역 설치가 아닙니다.** npx는 패키지를 npm 캐시(`_npx/<hash>/`)에 받아 한 번 실행할 뿐이고, 전역 `node_modules`에도 PATH에도 아무것도 남기지 않습니다. 실제 "설치물"은 위 표대로 **대상 repo에 추가된 파일과 `package.json` 변경**입니다.

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

> git은 빈 디렉터리를 추적하지 않습니다. 파일을 다 지운 뒤 `git status`가 clean이어도 빈 `scripts/`·`workflow/`가 파일시스템에 남을 수 있습니다.

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

대부분의 사용자는 위 프롬프트 방식으로 충분합니다. 아래는 내부에서 어떤 명령이 실행되는지 이해하거나 직접 디버깅할 때만 보면 됩니다.

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
| `npx commitgate` | 프로젝트에 CommitGate 설치 |
| `npx commitgate --dry-run` | 파일을 쓰지 않고 설치 계획 확인 |
| `npx commitgate --strict` | 낮은 `cross-spawn` 버전 경고를 설치 실패로 처리 |
| `npx commitgate uninstall` | 제거 계획 확인 (읽기 전용 — 아무것도 지우지 않음) |
| `req:new <slug> --run` | REQ 티켓, 브랜치, 설계문서 생성 |
| `req:review-codex <id> --kind design --run` | 설계 리뷰 |
| `req:review-codex <id> --kind phase --run` | 구현 리뷰 |
| `req:doctor <id>` | 게이트 상태 확인 |
| `req:commit <id> --run -m "message"` | 승인된 변경 커밋 |

---

## 설정

대부분은 기본값으로 충분합니다. 필요하면 프로젝트 루트의 `req.config.json`을 수정하세요.

| 항목 | 기본값 | 설명 |
|---|---|---|
| `branchPrefix` | `"feat/req-"` | 새 브랜치 prefix |
| `ticketRoot` | `"workflow"` | REQ 티켓 폴더 |
| `packageManager` | 자동 감지 | `npm`, `pnpm`, `yarn` |
| `designDocs` | `00/01/02` 문서 | 설계 문서 파일명 |

빈 `branchPrefix`나 프로젝트 밖으로 나가는 경로는 거부됩니다.

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

현재 버전은 **Stage A: vendored scaffold 모델**입니다. 즉 `npx commitgate`가 대상 프로젝트에 워크플로 파일을 복사합니다.

현재 운영 중인 검증입니다.

- GitHub Actions에서 `ubuntu-latest`, `macos-latest`, `windows-latest` × Node 18/20/22 매트릭스를 실행합니다.
- `npm run smoke`는 pack tarball 설치본의 `commitgate` bin을 실행합니다.
- Windows `.cmd` 래퍼 주입 회귀 테스트가 패키지 매니저와 Codex wrapper 경로를 보호합니다.

아래는 후속 범위입니다.

- `node_modules`에서 직접 실행하는 라이브러리 모델
- 비-git VCS 지원
- 더 다양한 설계문서 템플릿

---

## License

[MIT](./LICENSE) © 2026 sol5288
