---
name: commitgate-tdd
description: CommitGate phase 구현을 Red→Green→Refactor 루프로 돌린다. req:next 가 AGENT 를 반환해 phase 를 구현할 때 쓴다. 테스트를 먼저 쓰고, 최소 구현으로 통과시키고, stage 한 뒤 req:next 로 돌아간다. 직접 커밋하지 않는다.
---

# CommitGate — Test-First 구현 루프

`AGENTS.md`의 절대 규칙 1(Test-First)을 **실행 가능한 순서**로 편 것이다. 규칙 자체는 `AGENTS.md`가 정본이다.

## 전제

**`req:next`가 `AGENT`를 반환해 phase 구현을 지시했을 때만 유효하다.** 아니면 이 스킬을 쓰지 말고 즉시 `req:next`로 돌아가라.

구현 전에 그 phase의 인수 기준을 `02-plan.md`에서 확인한다. **그 phase의 인수 기준만 구현한다** — 다음 phase 기능을 미리 만들지 않는다.

## 방법

### 1. Seam을 먼저 정한다

**seam**은 테스트를 붙이는 공개 경계다 — 내부를 들추지 않고 동작을 관찰하는 지점.

테스트를 쓰기 전에 **어느 seam에서 테스트할지 적는다.** 전부를 테스트할 수는 없다 — seam을 먼저 정하는 것이
노력을 임계 경로에 쓰는 방법이다.

**근거는 이미 승인되어 있다.** `02-plan.md`의 phase별 테스트 oracle과 `01-design.md`의 인수 기준이 seam을 정해 뒀다.
그것을 따른다. 문서가 seam을 특정하지 않았으면 **승인된 인수 기준을 관찰할 수 있는 공개 경계**를 네가 고른다 —
그 판단은 이미 승인된 범위 안이다.

⚠️ **여기서 사람 승인을 새로 만들지 마라.** `req:next`가 `AGENT`를 준 것은 "그 범위 안에서 구현하라"는 뜻이다.
사람에게 가야 할 때는 **승인된 범위를 벗어나야 할 때뿐**이다 — 인수 기준이 틀렸거나, seam이 없어서 설계를 바꿔야 하거나,
비목표를 건드려야 할 때. 그건 이미 계약의 보고 사유이고, 그때는 설계를 고쳐 **재승인**을 받는다.

### 2. Red — 실패하는 테스트를 먼저

게이트를 통과시킬 테스트를 **먼저** 쓰고, **실제로 실패하는 것을 눈으로 본다.**
실패를 보지 않은 테스트는 통과해도 아무것도 증명하지 않는다.

### 3. Green — 통과시킬 최소 구현

그 테스트를 통과시킬 **딱 그만큼만** 쓴다. 다음 테스트를 앞질러 가거나 추측성 기능을 넣지 않는다.

### 4. Refactor

동작을 바꾸지 않고 정리한다. 테스트는 계속 초록이어야 한다.

### 5. 검증하고 stage

- 관련 단위 테스트 → typecheck → 전체 테스트 순으로 돌린다.
  ⚠️ **명령을 추측하지 마라.** `02-plan.md`의 그 phase 검증 명령을 그대로 쓰고, 없으면 프로젝트의 script 정의와
  `req.config.json`의 `packageManager`(npm·pnpm·yarn)를 보고 맞춘다. **패키지매니저를 단정하면 다른 매니저를 쓰는 프로젝트가 깨진다.**
- staged 범위를 **그 phase의 파일로 제한**한다. `git add -A` 금지.
- `git diff --cached --check`(공백)·`--stat`(범위) 확인.
- **`state.json`·`responses/`는 스테이징하지 않는다** — 스크래치로 남겨야 D10이 통과한다.

### 6. `req:next`로 돌아간다

stage했으면 끝이다. 다음 행동은 `req:next`가 계산한다.

## 좋은 테스트

공개 인터페이스로 **동작**을 검증한다. 구현이 통째로 바뀌어도 테스트는 안 바뀌어야 한다.
좋은 테스트는 명세처럼 읽힌다 — 이름만 보고 어떤 기능이 있는지 알 수 있다.

### 안티패턴

- **구현 결합** — 내부 협력자를 mock하거나, private을 테스트하거나, 옆문(인터페이스 대신 DB 직접 조회)으로 검증한다.
  징후: 동작은 그대로인데 리팩토링하면 테스트가 깨진다.
- **동어반복** — 단언이 기대값을 코드와 **같은 방식으로** 다시 계산한다(`expect(add(a,b)).toBe(a+b)`, 손으로 같은 식으로 만든 스냅샷).
  통과가 구조적으로 보장되니 코드와 절대 어긋날 수 없다. **기대값은 독립적인 근거에서 와야 한다** — 알려진 리터럴, 손으로 푼 예제, 명세.
- **수평 분할** — 테스트를 다 쓰고 구현을 다 쓴다. 뭉텅이 테스트는 *상상한* 동작을 검증한다 — 실제 동작이 아니라 *모양*을 테스트하게 되고,
  진짜 변경에 둔감해진다. 대신 **수직 슬라이스**로 간다: 테스트 하나 → 구현 하나 → 반복. 각 테스트가 **예광탄**이라 직전 사이클에서 배운 것에 반응한다.

## 경계

- **`git commit`·`git push`·`req:commit` 직접 호출 금지.** 커밋은 CommitGate의 통제점이다 — 리뷰 승인 후 `req:next`가 지시하고 사용자가 승인한다.
- **`state.json`·`responses/` 스테이징 금지.**
- 리뷰 실행·승인 판정·상태 전이는 CommitGate만 한다. 이 스킬은 승인 근거가 **아니다.**
- 테스트를 건너뛰거나 비활성화해 게이트를 통과시키지 않는다. 실패하면 원인을 고친다.
- 다음 행동을 추측하지 않는다 — **`req:next`가 정본이다.** 계약 정본은 저장소 루트의 `AGENTS.md`다.

## 출처·라이선스

Adapted from https://github.com/mattpocock/skills @ `d574778f94cf620fcc8ce741584093bc650a61d3` (v1.1.0).
Upstream: `skills/engineering/tdd/SKILL.md`.
적응 내용: CommitGate의 phase 루프(`req:next`=AGENT → stage → `req:next`)에 맞추고, 커밋·스테이징 권한 경계를 추가했다.
upstream은 리팩토링을 루프에서 빼 `code-review` 스킬로 넘기지만, CommitGate는 Codex 리뷰가 그 역할을 하므로 리팩토링을 루프 안에 둔다(`AGENTS.md` 규칙 1과 일치).
upstream의 *"seam을 사용자에게 확인받아라"*는 **채택하지 않았다** — CommitGate에서 seam 근거는 이미 승인된 `01-design.md`/`02-plan.md`이고,
`AGENT` 단계에 새 사람 승인 지점을 만드는 것은 계약 위반이다. 사람에게 가는 경우는 **승인된 범위를 벗어날 때**로 한정했다.
검증 명령도 upstream처럼 특정 매니저를 단정하지 않고 `02-plan.md`·감지된 `packageManager`를 따르게 했다.

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
