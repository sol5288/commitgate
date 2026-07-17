---
name: commitgate-discovery
description: 모호한 요구를 REQ Brief로 정리한다. req:new 로 티켓을 만들기 전에 사용자가 직접 부른다. "뭘 만들지 아직 모르겠다", "이거 정리부터 하자", "요구사항 좀 잡아줘" 같은 상황에서 쓴다. 파일·브랜치·커밋을 만들지 않는다.
disable-model-invocation: true
---

# CommitGate — 요구 정리(Discovery)

`req:new` **전에** 쓴다. 산출물은 **REQ Brief 텍스트 하나뿐**이다.

## 전제

- 이 스킬은 **티켓 생성 전** 단계다. 이미 REQ가 있고 `req:next`가 `AGENT`를 반환했다면 이 스킬이 아니다 — 그 작업을 하라.
- **파일·브랜치·커밋·`state.json`을 만들거나 바꾸지 않는다.** Brief는 대화 안에 머문다.

## 방법

### 사실과 결정을 가른다

**사실**은 찾고, **결정**은 묻는다.

- 코드베이스를 뒤져 알 수 있는 것(현재 구조·기존 관례·의존성·무엇이 이미 있는지)은 **묻지 말고 직접 찾는다.**
- 트레이드오프가 있는 선택은 **사용자의 것**이다. 하나씩 내놓고 답을 기다린다.

### 한 번에 하나씩 묻는다

질문을 몰아서 던지면 사용자는 압도된다. **하나 묻고, 답을 받고, 다음으로 간다.**
설계 트리의 가지를 하나씩 내려가며 결정 간 의존을 먼저 푼다.

**각 질문에는 네가 추천하는 답을 함께 낸다.** "어떻게 할까요?"보다 "A를 추천합니다. 이유는 X. 어떻게 할까요?"가 훨씬 빠르다.

### Brief가 채워졌는지 본다

다음이 다 차면 충분하다. 빈 칸이 있으면 그게 다음 질문이다.

- **무엇을 / 왜** — 해결하려는 문제. 기능 목록이 아니라 문제.
- **제약** — 지켜야 하는 것(호환성·보안·성능·기한).
- **완료 기준** — 무엇이 참이면 끝인가. 검증 가능한 문장으로.
- **비목표** — 이번에 **하지 않을** 것. 명시된 경계는 결함이 아니다.
- **대표 예시** — 정상 경로 하나를 구체적으로.
- **예외·실패** — 무엇이 잘못될 수 있고 그때 어떻게 되나.
- **용어** — 프로젝트 용어·새로 만드는 용어·기존 용어와 충돌하는 것.
- **미결 질문** — 아직 답이 없는 것. 비워 두지 말고 **명시**한다.

### 용어를 벼린다

- 사용자가 흐릿한 낱말("처리한다", "관리한다", "제대로")을 쓰면 **그 자리에서 되묻는다.**
- 같은 것을 두 이름으로 부르고 있으면 드러낸다. 새 용어를 만들면 기존 용어와 충돌하는지 확인한다.
- 구체적인 시나리오로 압박한다 — "그럼 X가 비어 있으면요?"

## 경계

- **합의 전에 실행하지 않는다.** 사용자가 "이해가 맞다"고 확인하기 전에 Brief를 코드나 티켓으로 옮기지 않는다.
- Brief가 충분해지면 기존 CommitGate 흐름으로 넘긴다. **진입 명령은 harness마다 다르다:**
  - **Claude Code**: `/req` 로 시작한 뒤 `req:new` → `req:next` 반복.
  - **그 외(Codex CLI·Cursor 등)**: `/req` 같은 command가 **없다.** 저장소 루트 `AGENTS.md`의 워크플로 명령 표를 보고
    `req:new` → `req:next` 반복으로 들어간다.

  어느 쪽이든 티켓 생성 후의 정본은 `req:next`다.
- Brief는 승인 근거가 **아니다.** 요구·설계의 정본은 `00-requirement.md`·`01-design.md`이고, 승인 정본은 Codex 리뷰다.
- `git commit`·`git push`·`req:commit` 직접 호출·`state.json`/`responses` 스테이징을 하지 않는다.
- 다음 행동을 추측하지 않는다 — **`req:next`가 정본이다.** 계약 정본은 저장소 루트의 `AGENTS.md`다.

## 출처·라이선스

Adapted from https://github.com/mattpocock/skills @ `d574778f94cf620fcc8ce741584093bc650a61d3` (v1.1.0).
Upstream: `skills/productivity/grilling/SKILL.md`, `skills/engineering/domain-modeling/SKILL.md`.
적응 내용: CommitGate의 REQ Brief 산출물과 `req:new` 전 권한 경계를 추가하고, 용어 관리는 별도 `CONTEXT.md`/ADR 없이 Brief 안으로 축약했다.
진입 흐름은 harness별로 분기했다 — `/req`는 Claude Code 전용 command이므로 단정하지 않는다.

```
MIT License

Copyright (c) 2026 Matt Pocock

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
