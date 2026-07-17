---
name: commitgate-diagnosing-bugs
description: 버그·회귀·성능 문제를 피드백 루프부터 만들어 좁혀 간다. 뭔가 깨졌다/던진다/느리다는 보고를 받았을 때, 또는 phase 구현 중 원인 불명 실패를 만났을 때 쓴다. 재현→최소화→가설→계측→수정→회귀 테스트 순서이며, 끝나면 req:next 로 돌아간다.
---

# CommitGate — 버그 진단

어려운 버그를 위한 규율. **정당한 이유 없이 단계를 건너뛰지 않는다.**

## 전제

버그·회귀·성능 문제일 때만 쓴다. 일반 기능 구현이면 `commitgate-tdd`다.

REQ 안에서 쓴다면 `req:next`가 `AGENT`일 때다. **끝나면 반드시 `req:next`로 돌아간다.**
진단 결과가 요구·설계를 바꾼다면 `00-requirement.md`/`01-design.md`/`02-plan.md`에 반영해야 하고, 설계가 바뀌면 **재승인**이 필요하다.

## 방법

### Phase 1 — 피드백 루프를 만든다

**이게 이 스킬의 전부다.** 나머지는 기계적이다. *이 버그*에 빨간불이 켜지는 **팽팽한** pass/fail 신호가 있으면 원인은 찾아진다.
없으면 코드를 아무리 노려봐도 소용없다. **여기에 불균형하게 많이 투자한다.**

만드는 법 — 대략 이 순서로 시도한다:

1. **실패하는 테스트** — 버그에 닿는 seam이면 unit·integration·e2e 아무거나.
2. **CLI 호출** — 픽스처 입력으로 돌리고 stdout을 known-good과 diff.
3. **스크립트 재현** — 실제 입력/이벤트를 디스크에 저장해 해당 코드 경로에 격리 재생.
4. **일회용 하네스** — 최소 부분만 띄워 함수 하나로 버그 경로를 때린다.
5. **속성/퍼즈 루프** — "가끔 틀림"이면 랜덤 입력 1000개를 돌려 실패 양상을 찾는다.
6. **차등 루프** — 같은 입력을 구/신 버전에 넣고 출력을 diff.

🔴 **활성 REQ worktree에서 HEAD를 움직이지 마라** — 이분 탐색(bisect)·`reset`·`checkout`으로 과거 상태를 오가는 조사는 이 워크트리에서 **금지**한다. REQ 상태와 staged 승인 바인딩이 깨지고, 승인된 tree가 사라지면 커밋이 막힌다.

🔴 **진단·조사를 위한 커밋은 금지**다 — 진단은 커밋 사유가 **아니다**. 미승인 변경을 커밋하면 리뷰 게이트를 우회하는 것이라, 사람이 승인해도 허용되지 않는다.

**그래서 이분해야 하면 이렇게 한다 — 대개 물어볼 필요가 없다:**

- **이미 커밋되어 있고 깨끗한 승인 baseline**이 있으면, 그것을 활성 worktree **밖의** 버릴 clone/사본으로 복제해 거기서 bisect한다. **사람 승인 없이 진행한다** — 이건 Phase 1 사다리의 일회용 하네스와 같은 급의 **진단 기법**이지 범위 변경이 아니다.
- 활성 worktree의 HEAD·인덱스·작업물은 건드리지 않는다. **결과(원인 커밋·증상 경계)만** 가져오고 clone은 버린다.
- 복제할 **깨끗한 승인 baseline이 없다면** 멈추고 사람에게 보고한다 — 미승인 변경을 커밋해서 baseline을 만드는 것은 위 금지에 걸린다.
- 진단 결과가 **설계·계획·비목표를 바꿔야** 하면 보고해 재승인을 받는다 — 이미 계약의 보고 사유다.

> 멈추는 기준은 **"bisect가 필요해서"가 아니라 "경계를 어기지 않고는 못 해서"** 다. 승인된 범위 안의 진단은 네가 진행한다.

**루프를 조인다.** 일단 루프가 생기면 제품처럼 다룬다 — 더 빠르게(불필요한 초기화 제거), 신호를 더 날카롭게("안 죽었다"가 아니라 **정확한 증상**을 단언), 더 결정적으로(시간 고정·RNG 시드·파일시스템 격리).
**30초짜리 flaky 루프는 없는 것보다 조금 나을 뿐이고, 2초짜리 결정적 루프는 초능력이다.**

비결정적 버그는 깨끗한 재현이 목표가 아니라 **재현율**이 목표다. 50%면 디버깅 가능하고 1%면 불가능하다 — 될 때까지 올린다.

**완료 기준**: 이미 **최소 한 번 실행해 본** 명령 하나를 댈 수 있고(호출과 출력을 붙인다), 그것이 ① 이 버그의 코드 경로를 실제로 밟으며 **사용자가 말한 바로 그 증상**을 단언하고 ② 결정적이고 ③ 초 단위로 빠르고 ④ 무인 실행 가능할 때.

🔴 **그 명령이 존재하기 전에 이론을 세우려고 코드를 읽고 있다면 멈춰라** — 가설로 직행하는 것이 이 스킬이 막으려는 바로 그 실패다. **red 가능한 명령이 없으면 Phase 2로 가지 않는다.**

루프를 도저히 못 만들겠으면 **그렇다고 명시적으로 말한다.** 시도한 것을 나열하고, 재현 환경 접근·캡처된 아티팩트(로그 덤프·HAR)·임시 계측 허가를 요청한다. **루프 없이 가설로 넘어가지 않는다.**

### Phase 2 — 재현 + 최소화

루프를 돌려 빨간불을 확인한다. **사용자가 말한 그 실패 양상**인지 확인한다 — 근처의 다른 실패면 엉뚱한 버그를 고치게 된다.

빨간불이 켜지면 **여전히 빨간불인 가장 작은 시나리오**로 줄인다. 입력·호출자·설정·데이터·단계를 **하나씩** 잘라내고 매번 다시 돌린다.
**남은 요소 전부가 필수일 때** 끝이다 — 하나라도 빼면 초록이 된다.

### Phase 3 — 가설

**아무것도 테스트하기 전에 3~5개 가설을 순위 매겨 만든다.** 하나만 세우면 첫 그럴듯한 생각에 닻이 내린다.

각 가설은 **반증 가능**해야 한다: "X가 원인이면, Y를 바꾸면 버그가 사라진다 / Z를 바꾸면 심해진다."
예측을 못 대면 그건 느낌이다 — 버리거나 날카롭게 한다.

**순위 목록을 사용자에게 보여 준다.** 도메인 지식으로 즉시 재정렬해 주는 경우가 많다. 싼 체크포인트다. 단, 사용자가 자리에 없으면 막히지 말고 진행한다.

### Phase 4 — 계측

각 프로브는 Phase 3의 **특정 예측에 대응**해야 한다. **한 번에 한 변수만** 바꾼다.

1. 가능하면 **디버거/REPL** — 중단점 하나가 로그 열 줄을 이긴다.
2. 가설을 가르는 **경계에 표적 로그**.
3. **"전부 찍고 grep" 금지.**

모든 디버그 로그에 **고유 접두사**(`[DEBUG-a4f2]`)를 붙인다 — 정리가 grep 한 번이 된다.

**성능은 다른 갈래다.** 로그가 아니라 기준 측정치(타이밍 하네스·프로파일러·쿼리 플랜)를 먼저 잡고 이분한다. **재고 나서 고친다.**

### Phase 5 — 수정 + 회귀 테스트

**수정 전에** 회귀 테스트를 쓴다 — 단, **올바른 seam이 있을 때만.**

올바른 seam이란 버그가 실제로 일어나는 호출 지점의 **진짜 패턴**을 밟는 곳이다. 너무 얕은 seam(버그는 여러 호출자가 필요한데 단일 호출자 테스트)이면 거짓 안심을 준다.

**올바른 seam이 없으면 그 자체가 발견이다.** 기록한다 — 아키텍처가 버그를 못 잡게 막고 있다는 뜻이다.

있으면: 최소 재현을 그 seam의 실패 테스트로 → 실패 확인 → 수정 → 통과 확인 → **원래(최소화 전) 시나리오로 Phase 1 루프 재실행.**

### Phase 6 — 정리 + 사후

끝났다고 선언하기 전에 필수:

- 원래 재현이 더는 재현되지 않는다(Phase 1 루프 재실행)
- 회귀 테스트가 통과한다(또는 seam 부재를 문서화했다)
- 모든 `[DEBUG-...]` 계측을 제거했다(접두사 grep)
- 일회용 프로토타입을 지웠다
- **맞았던 가설을 커밋/PR 메시지에 적는다** — 다음 사람이 배운다

**그리고 묻는다: 무엇이 이 버그를 막을 수 있었나?** 답이 아키텍처 변경이면 **수정이 들어간 뒤에** 제안한다 — 지금이 시작할 때보다 아는 게 많다.
CommitGate에서는 그 제안을 **후속 REQ 또는 backlog**로 보낸다. 현재 phase에 끌어들이지 않는다.

## 경계

- **`git commit`·`git push`·`req:commit` 직접 호출 금지.** `state.json`·`responses/` 스테이징 금지.
- 진단 결과 자체는 승인 근거가 **아니다.** 설계를 바꾸면 `00`/`01`/`02`에 반영하고 **재승인**을 받는다.
- 계측·프로토타입을 남긴 채 phase 리뷰에 올리지 않는다.
- 끝나면 **반드시 `req:next`로 돌아간다.** 다음 행동을 추측하지 않는다. 계약 정본은 저장소 루트의 `AGENTS.md`다.

## 출처·라이선스

Adapted from https://github.com/mattpocock/skills @ `d574778f94cf620fcc8ce741584093bc650a61d3` (v1.1.0).
Upstream: `skills/engineering/diagnosing-bugs/SKILL.md`.
적응 내용: CommitGate의 `req:next` 복귀·재승인 경계를 추가하고, 루프 구성 사다리에서 이 저장소에 해당 없는 항목(헤드리스 브라우저·HITL 스크립트)을 덜어 냈다.
upstream의 **이분 탐색 하네스(`git bisect run`) 항목은 채택하지 않고 명시적 금지로 뒤집었다** — 활성 REQ worktree에서 HEAD가 움직이면
REQ 상태와 staged 승인 바인딩이 깨진다. 대신 이미 커밋된 깨끗한 승인 baseline의 버릴 clone에서 수행하게 했고,
그 경로는 **사람 승인을 요구하지 않는다** — "bisect가 필요하다"는 범위 변경이 아니므로 거기에 승인 게이트를 걸면
`req:next`=AGENT의 정상 진행을 막는 계약 위반이 된다. 멈추는 기준은 경계 위반(깨끗한 baseline 부재 → 미승인 커밋 필요,
또는 설계·비목표 변경)일 때로 한정했다.
"무엇이 이 버그를 막을 수 있었나"의 후속 조치도 upstream처럼 다른 스킬로 넘기지 않고 **후속 REQ·backlog**로 보내게 했다.

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
