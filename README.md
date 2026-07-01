# CommitGate 🚦

**AI가 짠 코드를, 다른 AI가 리뷰하고 승인해야만 커밋되게 하는 "커밋 관문(gate)".**

> 한 줄 요약: **만드는 AI(Builder)** 와 **검사하는 AI(Reviewer)** 를 짝지어, **리뷰·승인·증거 없이는 커밋이 통과하지 못하게** 막아줍니다.

[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

---

## 🤔 이게 뭔가요? (비유로)

공항 보안 검색대를 떠올려 보세요. 아무리 급해도 **검색대를 통과하지 않으면** 탑승구로 갈 수 없죠.

CommitGate도 똑같습니다. 코드를 아무리 많이 만들어도 **"검사 → 승인"이라는 관문을 통과하지 않으면 `git commit`이 막힙니다.**

- 🛠️ **Builder(만드는 쪽)** — 당신, 또는 당신의 AI 코딩 도구(예: Claude Code). 요구사항을 설계하고 코드를 짭니다.
- 🔎 **Reviewer(검사하는 쪽)** — **Codex CLI**. Builder가 만든 걸 **독립적으로 다시 검토**해서 통과/보완을 판정합니다.
- 🚦 **CommitGate** — 그 사이에 서서, **Reviewer가 승인한 코드만** 커밋되게 하는 규칙(관문).

즉, "혼자 만들고 혼자 커밋"이 아니라 **"만든 AI ↔ 검사한 AI"의 교차 검증**을 강제합니다.

## 🎯 어떤 문제를 푸나요?

AI는 코드를 **빠르게** 만들지만, 검증 없이 그대로 커밋되면 위험합니다. CommitGate는:

- ✅ 모든 변경이 **리뷰를 반드시 거치게** 합니다.
- ✅ 승인은 **"리뷰한 바로 그 코드"에 묶입니다.** (승인 후 몰래 코드를 바꿔치기 못 함 — 지문처럼 대조)
- ✅ 무언가 애매하거나 빠지면 **일단 막습니다(fail-closed).** "확실할 때만 통과"가 기본값이라 안전합니다.
- ✅ 누가 언제 무엇을 승인했는지 **증거가 파일로 남습니다.**

## 🔄 동작 흐름 한눈에

```
① 티켓 만들기      →  ② 설계 작성  →  ③ 설계 리뷰(Codex)  →  ④ 코드 구현
      req:new                            req:review-codex

   →  ⑤ 관문 점검   →  ⑥ 구현 리뷰(Codex)  →  ⑦ 승인되면 커밋
        req:doctor        req:review-codex           req:commit
```

각 단계에서 **통과하지 못하면 다음으로 못 넘어갑니다.**

---

## 📦 준비물 (Prerequisites)

시작 전에 아래 4가지가 필요합니다. 터미널에서 하나씩 확인해 보세요.

| 필요한 것 | 확인 명령 | 없으면 |
|---|---|---|
| **Git** (필수) | `git --version` | [git-scm.com](https://git-scm.com) 에서 설치 |
| **Node.js 18.17+** (필수) | `node --version` | [nodejs.org](https://nodejs.org) 에서 설치 |
| **Codex CLI** (리뷰용) | `codex --version` | OpenAI Codex CLI 설치 (없으면 리뷰만 안 되고 나머지는 됨) |
| **패키지 매니저** | `npm --version` | Node 설치 시 `npm`은 기본 포함 (또는 `pnpm`/`yarn`) |

> 💡 **Reviewer = Codex CLI** 입니다. 리뷰를 실제로 돌리려면 Codex CLI가 설치되어 있어야 해요. 없으면 리뷰 명령이 "안전하게 실패(fail-closed)"합니다 — 조용히 통과되는 일은 없습니다.

---

## 🚀 설치 (딱 한 줄)

**당신의 프로젝트 폴더**(= git 저장소, `package.json` 있는 곳)에서:

```sh
npx commitgate
```

이 명령이 자동으로 해주는 일 (기존 파일은 **덮어쓰지 않아요**):

1. 워크플로 스크립트(`scripts/req/`)와 스키마를 복사합니다.
2. `req.config.json`(설정 파일)을 만들어 둡니다.
3. `package.json`에 `req:*` 명령들과 필요한 devDependencies(`tsx`, `ajv`)를 추가합니다.
4. `AGENTS.md`(Reviewer가 읽는 규칙 파일)가 없으면 템플릿을 만들어 줍니다.

설치 후, 방금 추가된 의존성을 받습니다:

```sh
npm install
```

> `--dry-run` 을 붙이면 **실제로 바꾸지 않고** 무엇을 할지 미리 볼 수 있어요: `npx commitgate --dry-run`

---

## 👣 처음부터 끝까지 따라하기

작은 기능 하나를 예로, 전체 흐름을 그대로 밟아 봅시다. (명령은 `npm` 기준이며, `npm run` 뒤 인자는 `--` 다음에 씁니다. `pnpm`을 쓰면 `pnpm req:new my-feature --run` 처럼 `--` 없이 됩니다.)

### 1단계 — 작업 티켓 만들기

```sh
npm run req:new -- my-feature --run
```

- 새 브랜치(`feat/req-...`)가 생기고, `workflow/REQ-2026-001/` 폴더에 설계 문서 3종이 만들어집니다.
- 출력에 **티켓 번호**(예: `REQ-2026-001`)가 나옵니다. 이후 명령에선 번호만 씁니다 → `2026-001`

### 2단계 — 설계 문서 작성

`workflow/REQ-2026-001/` 안의 세 파일을 채웁니다:

- `00-requirement.md` — **무엇을** 왜 만드는가
- `01-design.md` — **어떻게** 만들 것인가
- `02-plan.md` — 어떤 **순서/단계**로 진행할 것인가

### 3단계 — 설계 리뷰 받기 (Codex)

작성한 설계를 검사대에 올립니다(= `git add`):

```sh
git add workflow/REQ-2026-001/00-requirement.md workflow/REQ-2026-001/01-design.md workflow/REQ-2026-001/02-plan.md
npm run req:review-codex -- 2026-001 --kind design --run
```

- Codex가 설계를 읽고 **승인** 또는 **보완 요청(NEEDS_FIX)** 을 돌려줍니다.
- 보완 요청이면 지적사항을 반영하고 **다시 `git add` → 위 명령을 재실행**하세요. 승인될 때까지 반복합니다.

### 4단계 — 코드 구현 + 테스트

설계가 승인되면 실제 코드를 짜고 테스트를 작성합니다.

### 5단계 — 관문 점검

내 변경을 검사대에 올리고, 게이트 상태를 미리 확인합니다:

```sh
git add <내가-바꾼-코드-파일들>
npm run req:doctor -- 2026-001
```

- 여러 항목(설계 승인 유효한지, 검사대에 올린 코드와 승인된 코드가 같은지, 워킹트리가 깨끗한지 등)을 점검해 **PASS/FAIL** 을 보여줍니다.

> ⚠️ **중요:** `git add` 는 **당신이 만든 코드/문서만** 올리세요. `state.json` 이나 `responses/` 같은 워크플로 내부 파일은 **올리지 마세요.** (도구가 알아서 관리합니다. 실수로 올리면 커밋 단계에서 막힙니다.)

### 6단계 — 구현 리뷰 받기 (Codex)

```sh
npm run req:review-codex -- 2026-001 --kind phase --run
```

- Codex가 **구현 코드**를 리뷰합니다. 역시 승인될 때까지 반영 → 재실행 반복.
- 승인되면 `commit_allowed=true` 가 되어 커밋이 열립니다.

### 7단계 — 커밋

```sh
npm run req:commit -- 2026-001 --run -m "feat: my-feature 구현"
```

- 관문(doctor 게이트)을 마지막으로 통과한 뒤 **코드 커밋 + 증거 커밋** 을 남깁니다.
- 승인되지 않았거나, 승인 후 코드가 바뀌었으면 **여기서 막힙니다.** (그게 CommitGate의 핵심)

🎉 끝! 이제 리뷰·승인·증거가 모두 남은 상태로 안전하게 커밋되었습니다.

---

## 📋 명령어 치트시트

| 명령 | 하는 일 |
|---|---|
| `npx commitgate` | 프로젝트에 CommitGate 설치(스캐폴딩) |
| `req:new <이름> --run` | 새 작업 티켓 + 브랜치 + 설계문서 생성 |
| `req:review-codex <번호> --kind design --run` | **설계** 리뷰(Codex) |
| `req:review-codex <번호> --kind phase --run` | **구현** 리뷰(Codex) |
| `req:doctor <번호>` | 관문 점검(통과/실패 표시) |
| `req:commit <번호> --run -m "메시지"` | 승인된 코드 커밋(+증거) |

> `-m "메시지"` 대신 여러 줄 메시지는 `--message-file 메시지.txt` 로 파일에서 읽을 수 있습니다.

---

## ⚙️ 설정 (`req.config.json`, 선택)

프로젝트 루트의 `req.config.json` 으로 동작을 바꿀 수 있습니다. **파일이 없으면 기본값**으로 잘 동작하니, 처음엔 신경 쓰지 않아도 됩니다.

| 항목 | 기본값 | 뜻 |
|---|---|---|
| `branchPrefix` | `"feat/req-"` | 새로 만드는 브랜치 이름 앞부분 |
| `ticketRoot` | `"workflow"` | 티켓 폴더 위치 |
| `packageManager` | 자동 감지 | `npm` / `pnpm` / `yarn` |
| `designDocs` | `00-/01-/02-*.md` | 설계문서 3종 파일명 |

잘못된 값(예: 빈 `branchPrefix`, 폴더 밖으로 벗어나는 경로)은 **안전하게 거부**됩니다.

---

## ❓ 자주 묻는 질문 / 문제 해결

**Q. `codex` 명령이 없다고 나와요.**
A. Reviewer(Codex CLI)가 설치되어 있어야 리뷰가 돌아갑니다. 설치 전에는 리뷰 명령이 "조용히 통과"하지 않고 **명확히 실패**합니다 — 이게 정상 동작(fail-closed)입니다.

**Q. 커밋 단계에서 "staged tree != approved" 같은 오류가 나요.**
A. **승인받은 코드와, 지금 검사대(git add)에 올린 코드가 다르다**는 뜻입니다. 승인 후에 코드를 바꿨다면 6단계(구현 리뷰)를 다시 받아 재승인하세요. (승인 바꿔치기를 막는 안전장치입니다.)

**Q. "비-코드 staged 금지(state/responses)" 오류가 나요.**
A. `git add` 로 `state.json` 이나 `responses/` 를 올렸기 때문입니다. 그 파일들은 **올리지 말고**(도구가 관리), 내가 만든 코드/문서만 올리세요.

**Q. `npx commitgate` 를 두 번 실행하면 덮어써지나요?**
A. 아니요. **이미 있는 파일은 건너뜁니다**(멱등). 강제로 덮어쓰려면 `--force` 를 붙이세요.

**Q. Windows인데 커밋 메시지 줄바꿈이 이상해요.**
A. 여러 줄 메시지는 `-m` 대신 `--message-file 파일.txt` 를 쓰면 깔끔합니다.

---

## 🔒 어떻게 "안전"을 보장하나요? (fail-closed)

CommitGate의 원칙은 **"확실히 승인됐을 때만 통과, 조금이라도 애매하면 막는다"** 입니다.

- 설계문서가 없거나 형식이 안 맞으면 → 미승인 취급
- Codex가 설치 안 됨 / 리뷰 실패 → 통과 아님, 명확히 실패
- 승인된 코드 지문과 지금 코드가 다르면 → 커밋 거부
- 워킹트리가 지저분하면(리뷰 안 한 변경 섞임) → 리뷰/커밋 거부

즉, **"막히는 게 기본, 통과가 예외"** 라 실수로 미검증 코드가 새어 나갈 틈을 줄입니다.

---

## 📄 라이선스

[MIT](./LICENSE) © 2026 sol5288

> 이 워크플로는 `palm-kiosk-app`의 REQ-2026-017 portability kit에서 독립 패키지로 추출되었고, **자기 자신을 이 워크플로로 리뷰·승인(dogfood)** 하여 검증되었습니다.
