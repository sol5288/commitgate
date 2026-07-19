# 에이전트 진입점과 요구 전달

**긴 프롬프트를 붙여넣을 필요가 없습니다.** 설치가 에이전트 진입점을 함께 깝니다.

| 파일 | 읽는 도구 |
|---|---|
| `AGENTS.md` | Codex CLI, Cursor — **계약 정본** |
| `.claude/skills/commitgate/SKILL.md` | Claude Code (자동 발견 — 호출은 모델 판단) |
| `.claude/commands/req.md` | Claude Code (`/req` 명시 호출) |
| `.cursor/rules/commitgate.mdc` | Cursor (`alwaysApply`) |
| `CLAUDE.md` | Claude Code (항상 로드) — 부재 시에만 생성 |

> **신규 설치에서 `CLAUDE.md`와 `AGENTS.md`는 맨 앞에 자립형 Quick Start**(요구 4칸 확인 → `req:new` → `req:next` 루프)를 담습니다. 항상 읽히는 채널이라, 에이전트가 계약 본문을 더 읽지 않아도 첫 요청에서 올바른 첫 행동을 고릅니다. 기존 `CLAUDE.md`/`AGENTS.md`가 있으면 보존되므로 새로 주입되지 않습니다 — **기존 파일에도 넣으려면 `npx commitgate quickstart --apply`**(관리 블록만 삽입·나머지 보존·멱등).

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

## Companion Skills

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

### 경계 — 반드시 알아 두세요

- 🔴 **`AGENTS.md`가 계약 정본입니다.** 스킬은 **방법론**이지 계약이 아닙니다.
  스킬을 설치하지 않아도 **핵심 워크플로는 완전히 동일하게** 동작합니다.
- 🔴 **스킬 결과는 승인 증거가 아닙니다.** companion skills의 산출물도, 외부 Matt skills를 따로 돌린 결과도
  CommitGate·Codex의 **승인 근거가 되지 않습니다**. 리뷰 실행·승인 판정·상태 전이·커밋은 **CommitGate만** 담당하며,
  다음 행동은 `req:next`가 정본입니다.
- 스킬은 **협조적 텍스트**입니다 — 스킬이 커밋을 막는 게 아니라, 막는 건 CommitGate의 게이트입니다.

### 설치·보존·옵션

- **`--no-agent-entrypoints`**: `.claude/` 계층 전체를 건너뜁니다(companion 4종 포함).
- **기존 파일 보존(seed-once)**: 스킬은 **고치라고 만든 자산**입니다. 수정한 스킬은 **`--force`로도 덮어쓰지 않습니다.**
  `AGENTS.md`·`CLAUDE.md`·`workflow/.gitignore`도 같은 정책입니다.
- **gitignore 경고**: `.claude/`를 gitignore하면 팀원의 fresh clone에 스킬이 전달되지 않습니다.
  설치는 진행하되 **경고**하고 추적 방법을 안내합니다. **`--strict`면 설치 전에 중단**합니다.
- **타사 skill과 공존**: 타사 `tdd`·`grill-me` 등은 `.claude/skills/<이름>/`, companion은 `.claude/skills/commitgate-<이름>/` —
  **경로가 달라 서로 건드리지 않습니다.**

### 출처

Matt Pocock의 MIT 공개 skills를 기준 SHA `d574778f94cf620fcc8ce741584093bc650a61d3`에서 적응해
**패키지 payload로 포함**합니다. **외부 skill installer를 실행하거나 런타임 의존하지 않습니다** —
패키지 안에 고정된 사본입니다. 각 SKILL.md에 MIT 고지 전문이 동행하며, 자세한 출처는 패키지의
`skills/ATTRIBUTION.md`에 있습니다.
