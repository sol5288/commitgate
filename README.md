# CommitGate

🌐 **한국어** · [English](./README.en.md)

**표준 REQ 경로에서 AI 코딩 변경을 Codex 리뷰 승인 없이 커밋하지 못하게 하고,
정당한 예외는 승인으로 꾸미지 않고 기록하는 커밋 게이트입니다.**

[![npm version](https://img.shields.io/npm/v/commitgate.svg)](https://www.npmjs.com/package/commitgate)
[![node](https://img.shields.io/node/v/commitgate.svg)](https://nodejs.org)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

<p align="center">
  <img src="https://raw.githubusercontent.com/sol5288/commitgate/main/assets/commitgate-workflow-hero.webp" alt="개발 AI와 독립 검수 AI가 검토한 뒤 사람이 확인하고 최종 커밋 게이트를 통과하는 모습" width="1200">
</p>

> **어디부터 보면 되나요?**
> ⚡ 일단 써보고 싶다 → [3분 설치](#3분-설치) · 🔍 뭘 보장하는지부터 → [보장과 한계](#무엇을-보장하고-무엇은-보장하지-않나) · 🆘 막혔다 → [막혔을 때](#막혔을-때) · 📖 용어가 낯설다 → [용어 사전](#용어-사전)

## CommitGate란?

**AI가 고친 코드는, 다른 AI의 검사를 통과해야만 저장됩니다.**

AI에게 코딩을 시키면 결과가 아주 빨리 나옵니다. 문제는 그 결과를 **누가 검사하느냐**입니다. 만든 AI가 자기 것을 검사하면 같은 착각을 두 번 하기 쉽고, 다른 AI에게 복사해 붙여 넣자니 번거로운 데다 **어디까지 검사받았는지, 검사 뒤에 코드가 또 바뀌지는 않았는지**를 사람이 계속 기억해야 합니다.

CommitGate는 그 왕복을 자동으로 돌립니다. **검사에 통과하기 전에는 저장이 막힙니다.**

```text
  요구사항을 말한다
       |
       v
  +--------------------+
  |  code-writing AI   |  코드를 만든다
  +--------------------+
       |
       v
  +--------------------+
  |  reviewing AI      |  그 변경을 검사한다
  +--------------------+
       |
       +-- 고칠 점이 있다 --> 위로 돌아가 다시 만든다
       |
       v  (고칠 점 없다 = 승인)
  +--------------------+
  |  save (= commit)   |  승인받은 그 변경만 저장된다
  +--------------------+
       |
       +-- 남은 작업이 있다 --> 위로 돌아가 다시 만든다
       |
       v
  +--------------------+
  |  human check       |  사람이 확인하러 들어온다 (마무리 · 합치기)
  +--------------------+
```

**중요한 건 반복이 아니라 마지막 약속입니다.** 검사에 통과한 **바로 그 변경분**만 저장됩니다 — 승인을 받은 뒤에 코드가 한 줄이라도 바뀌면 그 승인은 낡은 것으로 보고 **검사를 다시 요구**합니다.

기본 설정에서 **phase 커밋마다 사람을 부르지는 않습니다** — 작업 하나가 끝나는 지점과 결과를 합치는 지점에서 확인합니다. 다만 재검사가 자동 한도를 넘겨 계속 돌면, 기본값에서는 그 회차마다 사람이 예외를 승인해야 합니다. 매 단계마다 직접 보고 넘기도록 바꿀 수도 있습니다 — 어디서 멈추는지는 아래 [사람이 멈추는 지점](#사람이-멈추는-지점)이 정본입니다.

> 💳 **되돌아가는 화살표가 무한 반복은 아닙니다.** 한 단계(phase)의 재검사는 **자동 5회**까지입니다. 6~8회는 사람이 예외를 기록해야 진행되고, **9회부터는 예외로도 막힙니다.** 리뷰는 유료 호출이라 상한이 있습니다 — 값은 [설정](https://github.com/sol5288/commitgate/blob/main/docs/configuration.md)에서 조정합니다.

| 원래는 사람이 챙기던 일 | CommitGate가 대신하는 것 |
|---|---|
| 만든 변경을 다른 AI에 복사해 검사 요청 | 이번에 저장할 변경분을 검사하는 AI에게 자동 전달 |
| 검사 뒤에 코드가 바뀌었는지 눈으로 대조 | 승인된 내용과 지금 저장할 내용을 묶어 두고, 달라지면 재검사 요구 |
| 저장·공유·배포 전에 무엇을 확인할지 판단 | 다음에 할 일과 사람이 확인할 지점을 도구가 계산 |
| 모든 단계에 사람이 개입 | 정해진 확인 지점에서만 승인을 요청 |

## 0.22.0에서 달라진 점 — CI 비용은 줄이고, 합치기 전 증거는 더 꼼꼼하게

0.22.0은 서로 목적이 다른 세 가지 검사를 분리했습니다. 가장 중요한 원칙은
**GitHub CI는 선택이지만, 로컬 승인 증거 검증은 생략하지 않는다**는 것입니다.

| 검사 | 무엇을 확인하나 | 언제 필요한가 | 비용·네트워크 |
|---|---|---|---|
| **Codex 리뷰** | 이번 코드에 결함이 없는지 | 표준 REQ의 `req:commit` 전 | Codex 외부 호출·사용량 발생 |
| **`verify-range --strict`** | 범위 안의 각 커밋에 승인·부기·예외 증거가 있는지 | `integrate`와 릴리즈 전 | 로컬 Git만 사용·GitHub Actions 비용 없음 |
| **GitHub CI** | 여러 OS·Node 버전 같은 원격 환경에서도 동작하는지 | 사용자가 원할 때만 | Actions 사용량·비용이 생길 수 있음 |

자동차에 비유하면 Codex 리뷰는 **수리 상태 검사**, `verify-range --strict`는 **정비 기록 확인**,
GitHub CI는 **여러 도로 환경에서의 시험 주행**입니다. 시험 주행을 매번 하지 않더라도 정비 기록은
확인해야 합니다.

### 머지할 때는 이렇게 동작합니다

```sh
npx commitgate integrate          # 먼저 계획과 strict 검증 결과만 확인(dry-run)
npx commitgate integrate --run    # 실제 로컬 머지 — 마지막 확인의 기본값은 No
```

`integrate`는 clean worktree인지 확인하고, 승인 증거를 **항상 strict로 검증한 뒤**, 사람의 최종 확인을
받아 로컬에서 머지합니다. 중간에 브랜치가 바뀌면 다시 검증하고, 충돌하면 가능한 경우 원래 상태로
복구합니다. **push는 하지 않습니다.**

GitHub CI 실행 설정이 있는 프로젝트에서는 머지 전에 다음처럼 묻습니다.

```text
GitHub CI workflow를 실행하시겠습니까?
GitHub Actions 사용량 또는 비용이 발생할 수 있습니다. [y/N]
```

Enter·빈 입력·`n`은 모두 **실행하지 않음**입니다. 설정이 없으면 질문 자체가 나오지 않습니다.
명시적으로 실행하려면 `integrate --run --run-github-ci`를 사용합니다.

> ⚠️ **CommitGate가 CI를 실행하지 않는 것과 저장소 자체 CI가 자동 실행되지 않는 것은 다른 말입니다.**
> 프로젝트의 `.github/workflows/*.yml`이 `push`·`pull_request`·tag에 반응하도록 작성돼 있으면,
> CommitGate가 실행을 요청하지 않아도 push 뒤에 저장소의 워크플로가 자동으로 돌 수 있습니다.

`verify-range --check-github-ci`는 이미 존재하는 GitHub check-run을 **조회만** 하고 워크플로를 실행하지
않습니다. 반대로 `integrate --run --run-github-ci`는 설정된 워크플로를 실제로 실행합니다.

### 정당한 예외는 승인으로 꾸미지 않고 기록합니다

긴급 수정처럼 정식 Codex 리뷰를 받지 못한 커밋은 다음처럼 사유를 남길 수 있습니다.

```sh
npx commitgate attest <commit-sha> --reason "운영 장애 긴급 수정 — 사용자 승인" --run
```

`attest`는 **리뷰를 받은 것처럼 만드는 명령이 아닙니다.** 누가 어떤 커밋을 왜 예외로 인정했는지
append-only 기록에 남겨 `verify-range`가 `attested`로 구분하게 합니다. 손상된 승인 증거를 고치거나
덮어쓰지는 못합니다.

그 밖에도 0.22.0은 커밋을 승인·부기·머지·attested·손상 증거·미입증의 6범주로 심층 분류하고,
`check`의 C5가 업그레이드 후 남은 옛 `AGENTS.md` 정책을 알려 줍니다. `report`의 승인 증거 계산은
이 저장소 실측 기준 약 29.5초에서 1.2초로 빨라졌습니다(환경과 이력 크기에 따라 다릅니다).

### 0.21.x에서 업그레이드한다면

```sh
npm install -D commitgate@^0.22.0
npx commitgate sync --apply --gitignore
npx commitgate check
```

C5가 WARN이면 `AGENTS.md`를 통째로 교체하지 말고,
`node_modules/commitgate/AGENTS.template.md`와 비교해 **CommitGate 계약 부분만** 수동으로 병합하세요.
프로젝트 고유 지침을 보존하기 위해 `sync`는 `AGENTS.md`를 자동 수정하지 않습니다.
자세한 절차는 [업그레이드](https://github.com/sol5288/commitgate/blob/main/docs/upgrade.md)에 있습니다.

## 무엇을 보장하고, 무엇은 보장하지 않나

| 보장합니다 | 보장하지 않습니다 |
|---|---|
| 🔒 **표준 REQ 경로에서는 Codex 리뷰 승인 없이는 커밋되지 않습니다** — 검사하는 AI가 통과시키기 전에는 `req:commit`이 막힙니다 | 커밋 승인이 이후 작업까지 승인하는 것 — 합치기·버전 태그·배포는 각각 따로 확인받습니다 |
| 🔁 승인 뒤에 변경이 달라지면 **다시 검사받아야** 합니다 | 보낸 코드의 **비밀** — 가리거나 걸러 주지 않습니다 |
| 🧾 직접 만든 커밋도 `verify-range`에서 **미입증으로 드러납니다** — 통합·릴리즈의 strict 검사에서 차단됩니다 | **강제로 못 하게 막는 것** — 사람이 마음먹고 직접 `git commit`으로 우회하는 것까지 막지는 않습니다 |
| 🧯 **애매하면 막습니다(fail-closed)** — 지적도 승인도 없는 애매한 답, 검사 도구가 없거나 실패한 경우 전부 막습니다 | 정식 리뷰가 없었던 예외를 리뷰 승인으로 바꾸는 것 — `attest`는 예외 사유만 투명하게 기록합니다 |

아래 두 가지는 표에 넣지 않았습니다. **시작하기 전에 읽어야 하는 내용**입니다.

> ⚠️ **리뷰는 staged diff 전문을 외부(Codex·OpenAI)로 전송합니다.** 이번에 저장할 변경 내용이 **잘린 곳 없이 통째로** 나갑니다. 검사하는 AI는 그 변경뿐 아니라 **프로젝트 폴더의 다른 파일도 읽을 수 있습니다**(읽기 전용). 가리기·걸러내기·길이 제한이 **없으니**, 검사를 돌리기 전에 비밀번호·API 키·개인정보가 섞여 있지 않은지 확인하세요.
>
> ⚠️ **git hook을 설치하지 않습니다 — 우회할 수 있습니다.** 이 도구를 거치지 않고 직접 저장하면 검사도 기록도 전부 건너뛰어집니다. CommitGate의 힘은 **협조하는 AI를 정해진 절차 안에 붙잡아 두는 데** 있지, 사람이 작정하고 돌아가는 것을 물리적으로 막는 데 있지 않습니다.

무엇을 보장하고 무엇은 보장하지 않는지 전문은 **[보장과 한계](https://github.com/sol5288/commitgate/blob/main/docs/guarantees.md)**.

## 준비물

| 필요 | 확인 명령 | 비고 |
|---|---|---|
| Git | `git --version` | 필수 |
| Node.js 20+ | `node --version` | 필수 |
| npm · pnpm · yarn 중 하나 | `npm --version` | 아래 안내는 npm 기준 |
| **Codex CLI** | `codex --version` | 🔴 **리뷰 실행에 필요** — 없으면 설치는 성공하고 리뷰 단계에서 막힙니다 |

> 💳 **리뷰는 무료가 아닙니다.** CommitGate 자체는 MIT 오픈소스지만, 검사는 Codex를 **실제로 호출**하므로 로그인한 계정(ChatGPT 계정 또는 OpenAI API 키)의 **사용량·요금이 발생합니다.** 얼마가 드는지는 선택한 모델과 변경 크기에 따라 다르므로 여기에 적지 않습니다 — 계정의 요금 정책을 확인하세요. 한 단계당 호출 횟수 상한은 위 [CommitGate란?](#commitgate란)에 있습니다.

Codex CLI 설치·로그인 방법은 **[Quick Start](https://github.com/sol5288/commitgate/blob/main/docs/quick-start.md)**에 있습니다.

## 3분 설치

**0) 폴더를 준비합니다.** git 저장소이고 `package.json`이 있어야 합니다. 아직 아니라면 그 폴더에서:

```sh
git init      # 아직 git 저장소가 아니라면
npm init -y   # package.json 이 없다면
```

**1~3) 설치합니다.**

```sh
npm install -D commitgate     # 1) 런타임 설치 — 실행 코드가 node_modules/commitgate 에 들어옵니다
npx commitgate init           # 2) 설정·계약·스키마 + req:* 스크립트를 프로젝트에 깝니다
npx commitgate setup          # 3) 리뷰 모델·추론강도·멈춤 지점을 고르고 codex 로그인까지 (대화형)
```

🔴 **3단계는 건너뛸 수 없습니다.** setup을 마치지 않으면 `req:new`를 비롯한 워크플로 명령이 막힙니다. **사람이 터미널에서 직접** 실행해야 합니다 — 대화형 전용이라 에이전트 세션·CI에서는 질문 없이 즉시 종료합니다. 질문은 세 개이고 ↑/↓로 고르면 됩니다.

**4) 설치분을 커밋합니다.** 설치는 파일만 놓고 **커밋하지 않는데**, `req:new`는 저장하지 않은 변경이 없는 상태를 요구합니다.

```sh
git add -- <설치 출력의 `다음:` 안내가 알려 준 경로들>
git status                                  # 의도한 것만 담겼는지 눈으로 확인
git commit -m "chore: install commitgate"
```

> 🔴 **`git add -A`나 `git add .`를 쓰지 마세요.** 프로젝트에 원래 있던 무관한 변경과 `.env` 같은 파일까지 함께 담기고, **이어지는 리뷰가 그 내용을 통째로 외부(Codex)로 전송합니다.** 설치 출력이 stage할 정확한 경로를 알려 주니 그것만 적으세요.

경로를 명시해 stage하는 법과 전체 첫 흐름은 **[Quick Start](https://github.com/sol5288/commitgate/blob/main/docs/quick-start.md)**에 있습니다.

> ↩️ **마음이 바뀌면 되돌릴 수 있습니다.** `npx commitgate uninstall`은 **아무것도 지우지 않고 제거 계획만 출력**합니다 — 무엇이 없어지는지 먼저 보고 결정하세요([제거하기](https://github.com/sol5288/commitgate/blob/main/docs/uninstall.md)).

## 첫 REQ 실행

에이전트에게 요구사항만 주면 됩니다.

```text
/req 프로필 수정 API를 추가해줘

- 무엇을: PATCH /profile 로 닉네임·소개글 수정
- 왜: 지금은 가입 후 프로필을 바꿀 방법이 없다
- 제약: 기존 인증 미들웨어 재사용, 스키마 변경 없음
- 완료 기준: 단위 테스트 통과, 권한 없는 사용자는 403
```

첫 응답은 보통 이렇게 티켓·브랜치·phase 계획과 통제점을 세웁니다.

```text
REQ-2026-002 발행
브랜치: feat/req-2026-002-profile-edit-api
phase:
- phase-1: PATCH /profile 구현
- phase-2: 테스트와 회귀 확인
통제점: req:commit --run 직전 / [B1] main direct push 직전 (또는 [I1] PR 생성 → [I2] merge)
```

에이전트는 `req:next`가 시키는 대로 **설계 → Codex 리뷰 → 구현 → 재리뷰 → 커밋**을 진행합니다. 다음 행동은 항상 `req:next`가 `state.json`과 git 상태에서 **계산**합니다(읽기 전용 — 에이전트가 추측하지 않습니다).

### 사용자는 무엇을 하나요 — "승인 문장" 주고받기

사람이 필요한 지점에 오면 `req:next`가 멈추고(`AWAIT_HUMAN`) **뭐라고 답해야 하는지를 그대로 알려 줍니다.**

```text
[req:next] AWAIT_HUMAN  REQ-2026-002
  phase 승인이 살아 있다. 커밋 전 사람 확인이 필요하다.

  통제점: req:commit --run 직전
  승인 문장: "req:commit --run 승인"
  승인 후 실행: $ npm run req:commit -- 2026-002 --run -m "<이 phase의 conventional 커밋 메시지>"
```

여기서 사용자가 할 일은 하나입니다 — **`승인 문장:` 에 적힌 그대로** 에이전트에게 답해 주는 것입니다.

```text
req:commit --run 승인
```

명령을 직접 외울 필요는 없습니다. 승인 문장은 통제점마다 다르고, **그때그때 화면에 인쇄됩니다.** 승인하지 않으면 그 지점을 넘어가지 않습니다.

(Claude Code가 아니면 `/req` 없이 요구사항만 줘도 `AGENTS.md`·`.cursor/rules`가 규칙을 로드합니다.)

### AI가 더 꼼꼼하게 일하도록 돕습니다

CommitGate는 게이트(리뷰·승인·커밋)로 품질을 **강제**하는 것에 더해, AI가 요구를 제대로 이해하고 실수를 줄이도록 **방법을 안내하는** companion skill(`commitgate-quality`)도 함께 설치합니다.

예를 들어 AI가 작업 전에 기존 코드·문서를 먼저 확인하고, 큰 작업을 작은 단계로 나누고, 바꾼 뒤 필요한 검사를 하도록 **안내**합니다 — 협조적 지침이라 항상 발동하지는 않으며, 실제로 커밋을 막는 것은 게이트입니다. ([자세히](https://github.com/sol5288/commitgate/blob/main/docs/agent-prompt.md))

## 사람이 멈추는 지점

멈추는 자리를 만드는 축은 **둘**입니다. setup이 묻는 `stopGate`가 **커밋·통합에서 사람이 확인하는 자리**를 정하고, 리뷰 예산(`reviewBudget.onSoftLimit`)이 **재리뷰가 길어질 때 따로 멈출지**를 정합니다.

### 커밋·통합에서 — `stopGate`

| 값 | 언제 멈추나 | 이런 경우에 |
|---|---|---|
| `phase` | **매 phase 커밋 전** | 변경을 하나하나 직접 보고 넘기고 싶을 때 |
| `req` *(기본값)* | **REQ를 완성시키는 커밋** | 티켓 단위로 확인하고 중간은 맡기고 싶을 때 |
| `merge` | 여러 REQ를 delivery set으로 **묶었으면 그 묶음이 끝날 때**, 묶지 않았으면 **그 REQ의 통합 직전** | 큰 작업을 묶어 한 번에 검토하고 싶을 때 |
| `auto` | `merge`와 같되, **사전 위임**이 있으면 통합에서도 멈추지 않음 | 시작할 때 범위를 정해 위임하고 끝까지 맡기고 싶을 때 |

🔴 `merge`를 골라도 **정지가 없어지지는 않습니다.** delivery set을 만들지 않았다면 `req`와 같은 자리 — 그 REQ를 main에 통합하기 직전 — 에서 멈춥니다.

🔴 **`auto`는 "무제한 자동"이 아닙니다.** 값을 바꾸는 것만으로는 아무 권한도 생기지 않습니다 — 사람이 `npx commitgate req:delegate ... --run`으로 **사전 위임**을 기록해야 하고, 그 위임이 정한 대상·브랜치·기준 SHA 안에서만 통합합니다. 위임이 없으면 `merge`처럼 멈춥니다. `hardCap`·HIGH 위험·BLOCKED 리뷰·범위 밖 변경은 위임이 있어도 막습니다. **리뷰 호출은 줄지 않습니다** — 사람이 기다리지 않을 뿐 비용은 그대로입니다. 자세히는 **[설정](https://github.com/sol5288/commitgate/blob/main/docs/configuration.md)**의 "stopGate: auto" 절을 보세요.

어느 값이든 **Codex 리뷰 게이트와 통합(main 병합) 승인은 그대로**입니다 — `stopGate`가 옮기는 것은 *사람 정지* 위치뿐입니다. 위험도 `HIGH` 취급과 확인 범위(`scope`) 대응은 **[워크플로](https://github.com/sol5288/commitgate/blob/main/docs/workflow.md)**의 "HIGH 위험 티켓의 사람 확인" 절이 정본입니다.

### 재리뷰가 길어질 때 — `reviewBudget.onSoftLimit`

한 리뷰가 소프트 한도(`autoBudget`)를 넘겨 계속 돌면, `stopGate`와 **무관하게** 이 축이 그다음을 정합니다.

| 값 | 소프트 한도를 넘긴 회차에서 |
|---|---|
| `ask` *(기본값)* | 회차마다 **사람의 예외 승인**이 필요합니다 — `stopGate`가 `merge`여도 여기서 멈춥니다 |
| `auto` | 사람 승인 없이 진행하고, 그 근거를 리뷰 원장에 남깁니다 |

`hardCap`에 이르면 **두 값 모두에서** 막힙니다 — 자동 진행을 골라도 무한 반복은 하지 않습니다. 기본값과 설정 방법은 **[설정](https://github.com/sol5288/commitgate/blob/main/docs/configuration.md)**의 "리뷰 예산" 절이 정본입니다.

## 막혔을 때

**먼저 이것부터 실행하세요.** 읽기 전용이라 아무것도 고치지 않고, 어떤 게이트에도 배선되어 있지 않습니다 — 결과가 나빠도 이 명령 때문에 새로 막히는 일은 없습니다.

```sh
npx commitgate check
```

```text
[OK] C1: req.config.json 유효(또는 부재 — 기본값 사용)
[OK] C2: 리뷰어 CLI 확인: codex-cli 0.144.1
[OK] C3: 리뷰어 로그인 확인: Logged in using ChatGPT
[OK] C4: 리뷰 모델·추론강도 고정: gpt-5.6-terra / medium
[OK] C5: 계약 문서에 폐기된 CommitGate 서술 없음(AGENTS.md · AGENTS.commitgate.md)
PASS — OK 5 · WARN 0
```

버전·모델 이름은 환경마다 다릅니다. 봐야 할 것은 숫자가 아니라 **`[OK]`인지 `FAIL`인지**입니다.

| 증상 | 원인 | 조치 |
|---|---|---|
| `setup을 아직 마치지 않았습니다`라며 `req:new`가 막힌다 | 설치 3단계를 건너뛰었다 | `npx commitgate setup` — **사람이 터미널에서 직접** |
| 리뷰가 `codex 종료 코드 1`로 죽는다 | 미설치·미로그인이 흔합니다 | 🔴 **다시 돌리기 전에** `npx commitgate check` — 이 실패는 리뷰 예산을 차감합니다 |
| `req:new`가 워킹트리를 이유로 막힌다 | 저장하지 않은 변경이 남아 있다 | 위 [3분 설치](#3분-설치)의 4) 커밋 블록 |

더 많은 증상과 답은 **[문제 해결](https://github.com/sol5288/commitgate/blob/main/docs/troubleshooting.md)**에 있습니다.

## 자주 쓰는 명령

**작업 흐름** — `package.json` 스크립트라 `npm run`으로 부르고, npm은 인자 전달에 `--`가 필요합니다.

| 명령 | 용도 |
|---|---|
| `npm run req:new -- <slug> --run` | REQ 티켓·브랜치·설계문서 생성 |
| `npm run req:next -- <id>` | **다음 행동 계산** (읽기 전용) |
| `npm run req:doctor -- <id>` | 게이트 상태 점검 |
| `npm run req:commit -- <id> --run -m "..."` | 승인된 변경 커밋 |
| `npm run req:confirm -- <id> --scope <s> --method "..." --run` | HIGH 위험 티켓의 사람 확인 기록 |

**설치·진단** — 이쪽은 `npx commitgate <명령>`으로 직접 실행합니다.

| 명령 | 용도 |
|---|---|
| `npx commitgate setup` | 리뷰 모델·멈춤 지점 선택 + codex 로그인 (대화형·필수) |
| `npx commitgate check` | 준비 상태 진단 (읽기 전용) |
| `npx commitgate report` | 로컬 리뷰·검증·CI 선택 이력 요약 (읽기 전용) |
| `npx commitgate verify-range --strict` | 커밋 범위의 승인 증거 심층 검증 — 미입증·손상 증거가 있으면 실패 |
| `npx commitgate integrate` | strict 검증과 로컬 머지 계획 확인 (기본: dry-run) |
| `npx commitgate integrate --run` | 최종 확인 후 실제 로컬 머지 (push 안 함, GitHub CI 기본 미실행) |
| `npx commitgate attest <sha> --reason "..." --run` | 정식 리뷰가 없었던 정당한 예외 사유 기록 |
| `npx commitgate sync --apply --gitignore` | 업그레이드 자산 적용 + 로컬 로그의 `.gitignore` 규칙 백필 |
| `npx commitgate uninstall` | 제거 **계획만** 출력 (아무것도 지우지 않음) |

전체 명령과 `pnpm`/`yarn` 표기는 **[워크플로](https://github.com/sol5288/commitgate/blob/main/docs/workflow.md)**에 있습니다. 각 명령의 옵션은 `npx commitgate <명령> --help`로 볼 수 있습니다.

## 용어 사전

<details>
<summary>낯선 단어가 나오면 여기를 펼치세요</summary>

| 용어 | 뜻 |
|---|---|
| **REQ (티켓)** | 요구사항 하나를 담는 작업 단위. `REQ-2026-002` 같은 번호가 붙고 전용 브랜치가 생깁니다 |
| **phase** | 한 REQ를 나눈 작업 단계. 단계마다 따로 검사받고 따로 저장됩니다 |
| **stage (staged)** | git에서 "이번에 저장할 것"으로 골라 둔 상태. `git add`가 그 일을 합니다 |
| **staged diff** | 그렇게 골라 둔 변경 내용. **검사하는 AI에게 통째로 전송되는 것이 바로 이것**입니다 |
| **워킹트리가 clean하다** | 저장(커밋)하지 않은 변경이 하나도 없는 상태 |
| **commit (커밋)** | git에 변경을 확정해 저장하는 것. 이 도구가 말하는 "저장"이 이것입니다 |
| **branch (브랜치)** | 작업을 따로 떼어 두는 작업선. REQ마다 하나씩 생깁니다 |
| **main 병합(merge)** | 브랜치에서 한 작업을 본줄기(`main`)에 합치는 것. 사람 승인이 필요한 지점입니다 |
| **fail-closed** | 애매하면 통과시키지 않고 **막는** 쪽을 고르는 설계 원칙 |
| **AWAIT_HUMAN** | 도구가 사람 승인을 기다리며 멈춘 상태. 화면에 승인 문장이 함께 인쇄됩니다 |
| **delivery set** | 여러 REQ를 하나로 묶은 상위 단위. `stopGate: merge`에서 쓰이며 **선택**입니다 — 묶지 않으면 REQ 하나마다 통합 직전에 멈춥니다 |
| **strict 검증** | 증거가 애매하면 경고로 넘기지 않고 실패시키는 검사. GitHub CI가 아니라 로컬 Git 기록을 봅니다 |
| **attestation** | 정식 리뷰가 없었던 커밋을 승인으로 위장하지 않고, 예외 사유와 대상을 남기는 기록 |
| **GitHub CI** | GitHub Actions에서 실행되는 원격 검사. CommitGate에서는 선택 사항이며 기본 실행하지 않습니다 |
| **devDependency** | 개발할 때만 필요하고 실제 서비스에는 안 들어가는 패키지. CommitGate가 여기 설치됩니다 |
| **companion skill** | AI에게 일하는 방법을 안내하는 지침 파일. 강제가 아니라 권고입니다 |

</details>

## 더 알아보기

| 문서 | 내용 |
|---|---|
| [Quick Start](https://github.com/sol5288/commitgate/blob/main/docs/quick-start.md) | 설치·준비물·첫 실행 |
| [워크플로](https://github.com/sol5288/commitgate/blob/main/docs/workflow.md) | `req:next` 루프·kind·페르소나·명령어 |
| [에이전트 가이드](https://github.com/sol5288/commitgate/blob/main/docs/agent-prompt.md) | 진입점·요구 전달·companion skills |
| [보장과 한계](https://github.com/sol5288/commitgate/blob/main/docs/guarantees.md) | 안전 계약·지원 범위 |
| [설정](https://github.com/sol5288/commitgate/blob/main/docs/configuration.md) | `req.config.json` |
| [업그레이드 (0.x)](https://github.com/sol5288/commitgate/blob/main/docs/upgrade.md) | 런타임 갱신·`sync`·`quickstart`·`migrate` |
| [제거하기](https://github.com/sol5288/commitgate/blob/main/docs/uninstall.md) | 안전한 제거 절차 |
| [문제 해결](https://github.com/sol5288/commitgate/blob/main/docs/troubleshooting.md) | FAQ |
| [개발·현재 범위](https://github.com/sol5288/commitgate/blob/main/docs/development.md) | CI·검증·로드맵 |

## License

[MIT](./LICENSE) © 2026 sol5288
