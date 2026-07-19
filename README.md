# CommitGate

🌐 **한국어** · [English](./README.en.md)

**AI 코딩 변경을 Codex 리뷰 승인 없이는 커밋하지 못하게 막는 커밋 게이트입니다.**

[![CI](https://github.com/sol5288/commitgate/actions/workflows/ci.yml/badge.svg)](https://github.com/sol5288/commitgate/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/commitgate.svg)](https://www.npmjs.com/package/commitgate)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

AI 에이전트가 코드를 빠르게 만들어도, 리뷰 없이 바로 커밋되면 위험합니다. CommitGate는 변경을 티켓(REQ) 단위로 묶고, **Codex가 승인한 staged tree만** 커밋되게 합니다. 승인 후 코드가 바뀌거나 증거가 부족하면 기본적으로 막습니다.

## 무엇을 막아 주나요

- 🔒 **Codex 리뷰 승인 없이는 커밋되지 않습니다.** 리뷰가 실패하거나 아예 없으면 `req:commit`이 통과시키지 않습니다.
- 🔁 **승인 후 staged 변경이 바뀌면 다시 리뷰를 요구합니다.** 승인된 tree와 지금 커밋하려는 tree가 다르면 stale로 보고 막습니다.
- 🧯 **애매하면 막습니다(fail-closed).** 지적은 없지만 승인도 없는 응답, Codex CLI 부재·실행 실패는 조용히 통과하지 않습니다.

무엇을 보장하고 무엇은 보장하지 않는지 전문은 **[보장과 한계](https://github.com/sol5288/commitgate/blob/main/docs/guarantees.md)**.

## ⚠️ 시작 전에 알아 둘 것

- **리뷰는 staged diff 전문을 외부(Codex·OpenAI)로 전송합니다.** `req:review-codex`는 `git diff --cached` 전체를 보내고, codex는 `--sandbox read-only`로 저장소 루트를 읽어 diff에 없는 파일도 읽힐 수 있습니다. 마스킹·필터·길이 상한이 **없으니**, 리뷰 전 staged 내용에 자격증명·토큰·개인정보가 없는지 확인하세요.
- **git hook을 설치하지 않습니다 — 우회할 수 있습니다.** `req:commit` 대신 `git commit`을 직접 치면 게이트·승인 바인딩·증거 기록이 전부 우회됩니다. 강제력은 **협조하는 에이전트를 계약 궤도에 유지**하는 데 있지, 사람의 우회를 물리적으로 막는 데 있지 않습니다.

## 3분 시작

git 저장소이고 `package.json`이 있는 폴더에서 두 단계면 됩니다.

```sh
npm install -D commitgate     # 1) 런타임 설치 — 실행 코드가 node_modules/commitgate 에 들어옵니다
npx commitgate init           # 2) 설정·계약·스키마 + req:* 스크립트를 프로젝트에 깝니다
```

설치는 파일만 놓고 **커밋하지 않습니다.** `req:new`는 clean 워킹트리를 요구하므로 설치분을 먼저 커밋하세요 — 설치 출력의 `다음:` 안내가 stage할 정확한 경로를 알려 줍니다(`-A`/`.` 전체 stage는 쓰지 마세요). 준비물(Codex CLI 등)·경로 명시 stage·전체 첫 흐름은 **[Quick Start](https://github.com/sol5288/commitgate/blob/main/docs/quick-start.md)**.

그다음 에이전트에게 요구사항만 주면 됩니다.

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

에이전트는 `req:next`가 시키는 대로 **설계 → Codex 리뷰 → 구현 → 재리뷰 → 커밋**을 진행합니다. 사용자는 통제점(`AWAIT_HUMAN`)에서 승인 문장을 줄 때만 개입하면 됩니다. (Claude Code가 아니면 `/req` 없이 요구사항만 줘도 `AGENTS.md`·`.cursor/rules`가 규칙을 로드합니다.)

## 작동 방식

`req:new`가 티켓·브랜치·설계문서를 만들고, 매 단계의 다음 행동은 항상 `req:next`가 `state.json`과 git 상태에서 **계산**합니다(읽기 전용 — 에이전트가 추측하지 않습니다).

```text
req:new → 설계 리뷰 → 구현 → phase 리뷰 → 승인 → req:commit → (통합·릴리스는 별도 통제점)
```

루프 상세·`kind` 표·리뷰어 페르소나·delta 재리뷰는 **[워크플로](https://github.com/sol5288/commitgate/blob/main/docs/workflow.md)**, 에이전트 진입점·요구 전달·companion skills는 **[에이전트 가이드](https://github.com/sol5288/commitgate/blob/main/docs/agent-prompt.md)**를 보세요.

## 자주 쓰는 명령

| 명령 | 용도 |
|---|---|
| `npm run req:new -- <slug> --run` | REQ 티켓·브랜치·설계문서 생성 |
| `npm run req:next -- <id>` | **다음 행동 계산** (읽기 전용) |
| `npm run req:doctor -- <id>` | 게이트 상태 점검 |
| `npm run req:commit -- <id> --run -m "..."` | 승인된 변경 커밋 |

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
