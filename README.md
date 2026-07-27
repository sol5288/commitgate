# CommitGate

🌐 **한국어** · [English](./README.en.md)

**AI 코딩 변경을 Codex 리뷰 승인 없이는 커밋하지 못하게 막는 커밋 게이트입니다.**

[![CI](https://github.com/sol5288/commitgate/actions/workflows/ci.yml/badge.svg)](https://github.com/sol5288/commitgate/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/commitgate.svg)](https://www.npmjs.com/package/commitgate)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

<p align="center">
  <img src="https://raw.githubusercontent.com/sol5288/commitgate/main/assets/commitgate-workflow-hero.webp" alt="개발 AI와 독립 검수 AI가 검토한 뒤 사람이 확인하고 최종 커밋 게이트를 통과하는 모습" width="1200">
</p>

## CommitGate란?

AI 코딩 에이전트는 설계·구현·테스트를 아주 빠르게 처리합니다. 하지만 한 에이전트가 자기 변경까지 검수하면, 같은 가정과 같은 작업 맥락 안에서 결함을 놓치기 쉽습니다. 그래서 만든 변경을 다른 AI에 복사해 붙여 넣고 다시 검수하게 되는데, 그 과정이 번거롭고 **어느 diff를 검수했는지·검수 뒤 코드가 바뀌었는지**를 계속 사람이 챙겨야 합니다.

CommitGate는 그 교대 작업을 REQ 워크플로로 묶습니다.

```text
        요구사항
           │
           ▼
    ┌─────────────┐
    │  builder AI │   설계 · 구현 · 테스트
    └──────┬──────┘
           │ git add
           ▼
    ┌─────────────┐
    │ staged tree │
    └──────┬──────┘
           │ req:review-codex
           ▼
    ┌──────────────────┐
    │ Codex (Reviewer) │   지적(P1)이면 → 수정 후 위로 되돌아가 재검수
    └──────┬───────────┘
           │ 승인
           ▼
    ┌──────────────────┐
    │    req:commit    │   ◀── 사람이 AWAIT_HUMAN 통제점에서 확인
    └──────────────────┘       (커밋 · 통합 · 릴리스)
       승인된 그 tree만 커밋됩니다
```

**핵심은 화살표가 아니라 마지막 상자입니다.** 사람 확인과 Codex 승인을 통과한 **바로 그 staged tree**만 커밋됩니다 — 승인 뒤에 코드가 한 줄이라도 바뀌면 stale로 보고 다시 리뷰를 요구합니다.

| 매번 직접 챙기던 일 | CommitGate가 연결하는 흐름 |
|---|---|
| 개발 AI의 변경을 다른 모델에 복사해 검수 요청 | 현재 **staged tree**를 Codex Reviewer에게 검수 요청 |
| 검수 뒤 코드가 바뀌었는지 수동 대조 | 승인된 tree와 현재 staged tree를 바인딩해 변경 시 재검수 요구 |
| 커밋·push·릴리스 전에 무엇을 확인할지 판단 | `req:next`가 다음 행동과 사람 확인 지점을 계산 |
| 모든 단계에 사람이 개입 | `AWAIT_HUMAN` 통제점에서만 명시적인 승인 요청 |

## 무엇을 보장하고, 무엇은 보장하지 않나

| 보장합니다 | 보장하지 않습니다 |
|---|---|
| 🔒 Codex 리뷰 승인 없이는 커밋되지 않습니다 | 커밋 **이후**(머지·태그·publish는 각각 별도 통제점) |
| 🔁 승인 후 staged 변경이 바뀌면 다시 리뷰를 요구합니다 | staged 내용의 **비밀** — 마스킹·필터가 없습니다 |
| 🧯 애매하면 막습니다(fail-closed) — 지적 없는 미승인 응답, Codex CLI 부재·실행 실패 | **하드 강제** — git hook을 설치하지 않습니다 |

두 가지는 표로 넘기지 않고 따로 적습니다. 시작하기 전에 읽어야 합니다.

> ⚠️ **리뷰는 staged diff 전문을 외부(Codex·OpenAI)로 전송합니다.** `req:review-codex`는 `git diff --cached` 전체를 보내고, codex는 `--sandbox read-only`로 저장소 루트를 읽어 diff에 없는 파일도 읽힐 수 있습니다. 마스킹·필터·길이 상한이 **없으니**, 리뷰 전 staged 내용에 자격증명·토큰·개인정보가 없는지 확인하세요.
>
> ⚠️ **git hook을 설치하지 않습니다 — 우회할 수 있습니다.** `req:commit` 대신 `git commit`을 직접 치면 게이트·승인 바인딩·증거 기록이 전부 우회됩니다. 강제력은 **협조하는 에이전트를 계약 궤도에 유지**하는 데 있지, 사람의 우회를 물리적으로 막는 데 있지 않습니다.

전문은 **[보장과 한계](https://github.com/sol5288/commitgate/blob/main/docs/guarantees.md)**.

## 준비물

| 필요 | 확인 명령 | 비고 |
|---|---|---|
| Git | `git --version` | 필수 |
| Node.js 18.17+ | `node --version` | 필수 |
| npm · pnpm · yarn 중 하나 | `npm --version` | 아래 안내는 npm 기준 |
| **Codex CLI** | `codex --version` | 🔴 **리뷰 실행에 필요** — 없으면 설치는 성공하고 리뷰 단계에서 막힙니다 |

Codex CLI 설치·로그인 방법은 **[Quick Start](https://github.com/sol5288/commitgate/blob/main/docs/quick-start.md)**에 있습니다.

## 3분 설치

git 저장소이고 `package.json`이 있는 폴더에서 세 단계면 됩니다.

```sh
npm install -D commitgate     # 1) 런타임 설치 — 실행 코드가 node_modules/commitgate 에 들어옵니다
npx commitgate init           # 2) 설정·계약·스키마 + req:* 스크립트를 프로젝트에 깝니다
npx commitgate setup          # 3) 리뷰 모델·추론강도·멈춤 지점을 고르고 codex 로그인까지 (대화형)
```

🔴 **3단계는 건너뛸 수 없습니다.** setup을 마치지 않으면 `req:new`를 비롯한 워크플로 명령이 막힙니다. **사람이 터미널에서 직접** 실행해야 합니다 — 대화형 전용이라 에이전트 세션·CI에서는 질문 없이 즉시 종료합니다.

설치는 파일만 놓고 **커밋하지 않습니다.** `req:new`는 clean 워킹트리를 요구하므로 설치분을 먼저 커밋하세요 — 설치 출력의 `다음:` 안내가 stage할 정확한 경로를 알려 줍니다(`-A`/`.` 전체 stage는 쓰지 마세요). 경로 명시 stage와 전체 첫 흐름은 **[Quick Start](https://github.com/sol5288/commitgate/blob/main/docs/quick-start.md)**.

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

에이전트는 `req:next`가 시키는 대로 **설계 → Codex 리뷰 → 구현 → 재리뷰 → 커밋**을 진행합니다. 다음 행동은 항상 `req:next`가 `state.json`과 git 상태에서 **계산**합니다(읽기 전용 — 에이전트가 추측하지 않습니다). 사용자는 통제점(`AWAIT_HUMAN`)에서 승인 문장을 줄 때만 개입하면 됩니다. (Claude Code가 아니면 `/req` 없이 요구사항만 줘도 `AGENTS.md`·`.cursor/rules`가 규칙을 로드합니다.)

### AI가 더 꼼꼼하게 일하도록 돕습니다

CommitGate는 게이트(리뷰·승인·커밋)로 품질을 **강제**하는 것에 더해, AI가 요구를 제대로 이해하고 실수를 줄이도록 **방법을 안내하는** companion skill(`commitgate-quality`)도 함께 설치합니다.

예를 들어 AI가 작업 전에 기존 코드·문서를 먼저 확인하고, 큰 작업을 작은 단계로 나누고, 바꾼 뒤 필요한 검사를 하도록 **안내**합니다 — 협조적 지침이라 항상 발동하지는 않으며, 실제로 커밋을 막는 것은 게이트입니다. ([자세히](https://github.com/sol5288/commitgate/blob/main/docs/agent-prompt.md))

## 사람이 멈추는 지점

setup의 세 번째 질문(`stopGate`)이 **사람이 어디서 확인하는지**를 정합니다. 이 값 하나가 정지 지점을 단독으로 결정합니다.

| 값 | 언제 멈추나 | 이런 경우에 |
|---|---|---|
| `phase` | **매 phase 커밋 전** | 변경을 하나하나 직접 보고 넘기고 싶을 때 |
| `req` *(기본값)* | **REQ를 완성시키는 커밋** | 티켓 단위로 확인하고 중간은 맡기고 싶을 때 |
| `merge` | **여러 REQ를 묶은 delivery set이 끝날 때** | 큰 작업을 묶어 한 번에 검토하고 싶을 때 |

어느 값이든 **Codex 리뷰 게이트와 통합(main 병합) 승인은 그대로**입니다 — `stopGate`가 옮기는 것은 *사람 정지* 위치뿐입니다. 위험도 `HIGH` 취급과 확인 범위(`scope`) 대응은 **[워크플로](https://github.com/sol5288/commitgate/blob/main/docs/workflow.md)**의 "HIGH 위험 티켓의 사람 확인" 절이 정본입니다.

## 자주 쓰는 명령

| 명령 | 용도 |
|---|---|
| `npm run req:new -- <slug> --run` | REQ 티켓·브랜치·설계문서 생성 |
| `npm run req:next -- <id>` | **다음 행동 계산** (읽기 전용) |
| `npm run req:doctor -- <id>` | 게이트 상태 점검 |
| `npm run req:commit -- <id> --run -m "..."` | 승인된 변경 커밋 |
| `npm run req:confirm -- <id> --scope <s> --method "..." --run` | HIGH 위험 티켓의 사람 확인 기록 |

`req:*`는 PATH 실행 파일이 아니라 `package.json` 스크립트입니다(npm은 인자 전달에 `--` 필요). 전체 명령과 `pnpm`/`yarn` 표기는 **[워크플로](https://github.com/sol5288/commitgate/blob/main/docs/workflow.md)**에 있습니다.

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
