---
name: commitgate-research
description: 외부 기술 선택·라이브러리·규격을 1차 출처로 조사한다. 근거가 필요한 결정(어떤 라이브러리를 쓸지, 이 API가 실제로 어떻게 동작하는지, 이 규격이 뭘 요구하는지)일 때 쓴다. 조사 결과는 보조 자료이며 승인 근거가 아니다 — 설계에 영향을 주면 00/01 문서에 반영해야 한다.
---

# CommitGate — 근거 조사

**근거가 필요한 경우에만** 쓴다. 코드베이스 안에서 답이 나오는 질문은 그냥 코드를 읽어라 — 이 스킬이 아니다.

## 전제

REQ 안에서 쓴다면 `req:next`가 `AGENT`일 때다. 조사는 **보조**이지 그 자체가 진행이 아니다.

쓸 때: 외부 라이브러리·프레임워크 선택, 규격·프로토콜 확인, 벤더 API의 실제 동작, 버전 간 차이.
쓰지 말 때: 이 저장소가 어떻게 동작하는지(코드를 읽어라), 이미 아는 것(추측을 조사로 포장하지 마라).

## 방법

### 1차 출처를 따른다

**1차 출처**로 조사한다 — 공식 문서, 소스 코드, 규격, 퍼스트파티 API. 그것을 **요약한 2차 글이 아니다.**
**모든 주장을 그것을 소유한 출처까지 되짚는다.**

블로그·튜토리얼·AI 요약은 출발점일 수는 있어도 **근거가 아니다.** 블로그가 X라고 하면 벤더 문서에서 X를 확인한다.
둘이 어긋나면 **1차가 이기고, 어긋났다는 사실 자체를 기록한다.**

### 정직하게 등급을 매긴다

각 주장에 신뢰도를 붙인다:

- **verified-primary** — 1차 출처에서 직접 확인했다. URL을 댈 수 있다.
- **secondary** — 2차 출처만 있다. 1차로 확인 못 했다.
- **unverified** — 확인하지 못했다. **추측하지 말고 이렇게 표시한다.**

**모르면 모른다고 한다.** 라이선스·보안·호환성처럼 틀리면 비싼 주제에서 추측한 확신은 최악이다.

### 간결하게 정리한다

- **결론** — 질문에 대한 답. 먼저.
- **출처** — 각 주장마다. URL 또는 파일 경로.
- **한계** — 확인하지 못한 것, 어긋난 것, 곧 바뀔 것.

가능하면 실측한다. 문서가 X라고 해도 **이 환경에서 실제로 X인지** 확인할 수 있으면 확인하는 편이 낫다.

## 경계

🔴 **조사 결과 자체는 승인 근거가 아니다.**

- 조사가 **설계 결정에 영향을 주면**, 핵심 결론과 인용을 `00-requirement.md` 또는 `01-design.md`에 **반영해야 한다.**
  그 문서가 정본이고, 그 문서가 Codex 리뷰를 받는다.
- 외부 조사 문서를 **정본화하지 않는다.** 별도 조사 노트를 만들어 놓고 그것을 근거로 설계 바인딩을 우회하지 않는다.
- 설계가 이미 승인된 뒤 조사가 그것을 뒤집으면, 조용히 구현을 바꾸지 말고 **설계를 고쳐 재승인**을 받는다.
- 조사를 이유로 범위를 넓히지 않는다. 흥미롭지만 범위 밖인 발견은 **backlog**로 보낸다.
- `git commit`·`git push`·`req:commit` 직접 호출 금지. `state.json`·`responses/` 스테이징 금지.
- 다음 행동을 추측하지 않는다 — **`req:next`가 정본이다.** 계약 정본은 저장소 루트의 `AGENTS.md`다.

## 출처·라이선스

Adapted from https://github.com/mattpocock/skills @ `d574778f94cf620fcc8ce741584093bc650a61d3` (v1.1.0).
Upstream: `skills/engineering/research/SKILL.md`.
적응 내용: upstream은 배경 에이전트를 띄워 결과를 저장소의 Markdown 파일로 남기지만, CommitGate는 **설계 문서가 정본**이므로 별도 노트 정본화를 금지하고 `00`/`01` 반영 의무와 신뢰도 등급을 추가했다.

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
