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

**AI가 고친 코드는, 다른 AI의 검사를 통과해야만 저장됩니다.**

AI에게 코딩을 시키면 결과가 아주 빨리 나옵니다. 문제는 그 결과를 **누가 검사하느냐**입니다. 만든 AI가 자기 것을 검사하면 같은 착각을 두 번 하기 쉽고, 다른 AI에게 복사해 붙여 넣자니 번거로운 데다 **어디까지 검사받았는지, 검사 뒤에 코드가 또 바뀌지는 않았는지**를 사람이 계속 기억해야 합니다.

CommitGate는 그 왕복을 자동으로 돌립니다. **검사에 통과하기 전에는 저장이 막힙니다.**

```text
        요구사항을 말한다
               |
               v
  +--------------------+
  |  code-writing AI   |   코드를 만든다
  +--------------------+
               |
               v
  +--------------------+
  |  reviewing AI      |   그 변경을 검사한다
  +--------------------+
               |
               v
        고칠 점이 있나?  --- 있다 ---> 위로 돌아가 다시 만든다
               |
             없다 (= 승인)
               |
               v
  +--------------------+
  |  save (= commit)   |   승인받은 그 변경만 저장된다
  +--------------------+
               |
               v
      남은 작업이 있나?  --- 있다 ---> 위로 돌아가 다시 만든다
               |
             없다
               |
               v
  +--------------------+
  |  human check       |   사람은 여기서만 확인한다
  +--------------------+       (작업 마무리 · 합치기)
```

**중요한 건 반복이 아니라 마지막 약속입니다.** 검사에 통과한 **바로 그 변경분**만 저장됩니다 — 승인을 받은 뒤에 코드가 한 줄이라도 바뀌면 그 승인은 낡은 것으로 보고 **검사를 다시 요구**합니다.

기본 설정에서 **사람은 중간마다 멈추지 않습니다.** 작업 하나가 끝나는 지점과 결과를 합치는 지점에서만 확인합니다. 매 단계마다 직접 보고 넘기고 싶다면 그렇게 바꿀 수 있습니다 — 아래 [사람이 멈추는 지점](#사람이-멈추는-지점)을 보세요.

| 원래는 사람이 챙기던 일 | CommitGate가 대신하는 것 |
|---|---|
| 만든 변경을 다른 AI에 복사해 검사 요청 | 이번에 저장할 변경분을 검사하는 AI에게 자동 전달 |
| 검사 뒤에 코드가 바뀌었는지 눈으로 대조 | 승인된 내용과 지금 저장할 내용을 묶어 두고, 달라지면 재검사 요구 |
| 저장·공유·배포 전에 무엇을 확인할지 판단 | 다음에 할 일과 사람이 확인할 지점을 도구가 계산 |
| 모든 단계에 사람이 개입 | 정해진 확인 지점에서만 승인을 요청 |

## 무엇을 보장하고, 무엇은 보장하지 않나

| 보장합니다 | 보장하지 않습니다 |
|---|---|
| 🔒 **Codex 리뷰 승인 없이는 커밋되지 않습니다** — 검사하는 AI가 통과시키기 전에는 저장이 막힙니다 | 저장한 **뒤**의 일 — 합치기·버전 태그·배포는 각각 따로 확인받습니다 |
| 🔁 승인 뒤에 변경이 달라지면 **다시 검사받아야** 합니다 | 보낸 코드의 **비밀** — 가리거나 걸러 주지 않습니다 |
| 🧯 **애매하면 막습니다(fail-closed)** — 지적도 승인도 없는 애매한 답, 검사 도구가 없거나 실패한 경우 전부 막습니다 | **강제로 못 하게 막는 것** — 사람이 마음먹고 우회하는 것까지 막지는 않습니다 |

아래 두 가지는 표에 넣지 않았습니다. **시작하기 전에 읽어야 하는 내용**입니다.

> ⚠️ **리뷰는 staged diff 전문을 외부(Codex·OpenAI)로 전송합니다.** 이번에 저장할 변경 내용이 **잘린 곳 없이 통째로** 나갑니다. 검사하는 AI는 그 변경뿐 아니라 **프로젝트 폴더의 다른 파일도 읽을 수 있습니다**(읽기 전용). 가리기·걸러내기·길이 제한이 **없으니**, 검사를 돌리기 전에 비밀번호·API 키·개인정보가 섞여 있지 않은지 확인하세요.
>
> ⚠️ **git hook을 설치하지 않습니다 — 우회할 수 있습니다.** 이 도구를 거치지 않고 직접 저장하면 검사도 기록도 전부 건너뛰어집니다. CommitGate의 힘은 **협조하는 AI를 정해진 절차 안에 붙잡아 두는 데** 있지, 사람이 작정하고 돌아가는 것을 물리적으로 막는 데 있지 않습니다.

무엇을 보장하고 무엇은 보장하지 않는지 전문은 **[보장과 한계](https://github.com/sol5288/commitgate/blob/main/docs/guarantees.md)**.

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
