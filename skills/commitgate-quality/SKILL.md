---
name: commitgate-quality
description: CommitGate REQ의 품질 방법 — 정본(SSOT) 경계·설계/계획 품질·Test-First·증거 기반 검증. 세 상황에서만 읽어 적용한다 — (a) 00/01/02 설계·계획을 새로 쓰거나 고칠 때, (b) req:next가 AGENT를 반환한 구현 phase, (c) 버그·회귀·성능 진단(AGENT). RUN·AWAIT_HUMAN·DONE·BLOCKED에서는 다음 행동을 결정하지 않는다 — 다음 행동·승인·커밋은 req:next와 AGENTS.md만 따른다. 강제가 아니라 방법이며, 실제 강제는 CommitGate 게이트다.
---

# CommitGate — 품질 오버레이 (설계·계획·구현 품질)

CommitGate의 권한·리뷰·승인·커밋 게이트를 **바꾸지 않고**, 설계·계획·구현의 품질을 높이는 **방법**이다.
게이트 권한은 CommitGate가, 품질 방법은 이 스킬이 담당한다 — **"방법은 여기, 강제는 게이트."**
이 스킬은 강제가 아니라 **협조적 지침**이다. 커밋을 막는 것은 이 텍스트가 아니라 CommitGate의 실행 게이트다.

## 전제

다음 세 상황에서만 이 방법을 적용한다.

- **(a)** REQ의 `00/01/02` 설계·계획을 새로 쓰거나 고칠 때
- **(b)** `req:next`가 `AGENT`를 반환한 구현 phase
- **(c)** 버그·회귀·성능 문제를 진단하는 `AGENT` 작업

`RUN`·`AWAIT_HUMAN`·`DONE`·`BLOCKED`에서는 이 스킬이 다음 행동을 **결정하지 않는다.** 그럴 땐 즉시 `req:next`로 돌아가라 — 다음 행동의 정본은 `req:next`다.

## 방법

### 1. 정본(SSOT) 경계 — 복제하지 말고 참조하라

도메인·아키텍처·API·보안·상세 test oracle의 정본은 **승인된 설계가 참조하는 정본 문서**(예: `docs/설계`·`docs/개발`·테스트케이스 추적표 등)다.

- `00/01/02`는 알고리즘·상수·API 계약·상세 test oracle을 **복제하지 않는다.** 정본 경로·절·TC-ID로 **참조**한다.
- 이미 정본에 있는 내용을 REQ 문서에 다시 쓰지 않는다 — 복제하면 drift 부채가 된다.
- 정본에 필요한 계약·oracle이 없으면 REQ 문서에 임시 복제하지 말고, **정본을 먼저 보완한 뒤 설계 재리뷰**를 받는다.

### 2. 설계 품질 — 가정한 것을 실증하라

- 새로 가정한 API·라우트·함수·환경변수·데이터 모델·기존 동작을 **실제 코드와 정본에서 먼저 확인**한다. 존재하지 않는 API를 기존 기능처럼 가정하지 않는다.
- 새로 만들어야 하면 요구 범위·변경 파일에 명시하고, 범위 밖이면 기존 계약을 쓰거나 사람에게 보고한다.
- 완료 기준마다 **정본 참조 · TC-ID · 공개 seam(사용자 관찰 가능 결과) · 검증 명령 · 실패 시 기대**를 추적 가능하게 한다.
- 역할·권한·상태·페이지·입력의 **조합**이 요구되면 일부 예시가 아니라 **요구된 조합 전체**를 검증 범위로 설계한다.
- 대안은 실제로 존재하고 품질·보안·성능·호환성에 영향을 줄 때만 비교한다. 형식적 나열은 하지 않는다.

### 3. 계획 품질 — 작은 수직 슬라이스

- phase는 리뷰 가능한 **작은 수직 슬라이스**로 나눈다.
- 각 phase는 목표·완료 조건 · 정본 참조·TC-ID · 수정 파일 범위 · 공개 seam과 실패해야 할 동작 · 검증 명령 · stage 범위 · 비목표를 갖는다.
- 검증 명령은 **추측하지 않는다.** `02-plan`·테스트 추적표·`package.json`(과 감지된 packageManager)이 정한 명령만 쓴다. 계획한 검증이 완료 조건을 증명하지 못하면 구현으로 덮지 말고 계획을 고쳐 **재리뷰**한다.
- 계획의 상세화가 **정본 복제로 변질되지 않게** 한다(§1).

### 4. Test-First 구현 — `commitgate-tdd`를 따른다

`AGENT` phase에서는 실패하는 테스트를 먼저(Red) → 최소 구현(Green) → 동작을 바꾸지 않는 리팩터 → 계획된 검증 → 명시적 stage → `req:next`.
단계별 루프의 정본은 형제 스킬 **`commitgate-tdd`**다 — 그것을 읽고 따른다.

- 좋은 테스트는 공개 인터페이스로 **동작**을 검증한다. 구현이 바뀌어도 테스트는 안 바뀌어야 한다.
- **동어반복**을 피한다 — 단언이 기대값을 코드와 **같은 방식으로** 다시 계산하면 통과가 구조적으로 보장되어 회귀를 못 잡는다. 기대값은 독립적 근거(알려진 리터럴·손계산·명세)에서 온다.
- 테스트를 통과시키는 **최소만** 쓴다. 승인된 범위 밖 기능·리팩터를 "개선"으로 끼워 넣지 않는다.

### 5. 버그·회귀·성능 진단 — `commitgate-diagnosing-bugs`를 따른다

원인 추측보다 **재현 가능한 피드백 루프**를 먼저 만든다: 재현 → 최소화 → 반증 가능한 가설 → 최소 계측 → 원인 확인 → 수정 → 회귀 테스트 → 임시 계측 제거 → 재검증.
단계별 루프의 정본은 형제 스킬 **`commitgate-diagnosing-bugs`**다.

### 요구 정제

요청에 무엇·왜·제약·완료 기준이 부족할 때만 정제한다. 확인 가능한 사실은 코드·문서에서 직접 확인하고, 사용자만 결정할 수 있는 것만 한 번에 하나씩 묻는다. 상세 방법의 정본은 형제 스킬 **`commitgate-discovery`**다(사용자 호출형).

## 리뷰 전 자가점검

CommitGate 리뷰를 요청하기 전에 확인한다.

- 변경이 승인된 phase와 비목표를 지키는가?
- 새 동작마다 실제 실패를 잡는 TC-ID와 공개 seam이 있는가? 동어반복이 아닌가?
- 새로 가정한 기존 API·계약을 실제로 확인했는가?
- 요구된 역할·권한·상태 조합이 빠지지 않았는가?
- 검증 명령을 **실제로 실행**했는가? 실행하지 않은 검증을 완료로 보고하지 않는다.
- 정본을 REQ 문서에 복제하지 않았는가? 설계 변경이 필요한 신호를 숨기지 않았는가?

자가점검은 **CommitGate 리뷰를 대체하지 않는다.** 스킬 산출물·자가점검은 승인 근거가 **아니다.**

## 경계

- **`git commit`·`git push`·`req:commit` 직접 호출 금지.** 커밋은 CommitGate의 통제점이다 — 리뷰 승인 후 `req:next`가 지시하고 사용자가 승인한다.
- **`state.json`·`responses/`를 직접 수정하거나 스테이징하지 않는다.** 스크래치로 남겨야 게이트(D10)가 통과한다.
- 리뷰 실행·승인 판정·상태 전이·커밋은 **CommitGate만** 한다. 이 스킬은 승인 근거가 **아니다.**
- 테스트를 건너뛰거나 비활성화해 게이트를 통과시키지 않는다. 실패하면 원인을 고친다.
- **다음 행동은 `req:next`가 정본이다.** 계약 정본은 저장소 루트 `AGENTS.md`다.
- 이 경계는 **협조적 텍스트**이며 강제가 아니다 — 실제 강제는 CommitGate 실행 게이트(이 스킬이 건드릴 수 없다)다.

## 출처·라이선스

이 스킬의 **원저작 합성**(정본 경계 §1·설계 품질 §2·계획 품질 §3·자가점검)은 CommitGate(sol5288)의 것이다.
Test-First(§4)·버그 진단(§5)·요구 정제의 **방법론 표현**은 Matt Pocock의 공개 skills(MIT)를 적응한 형제 스킬
(`commitgate-tdd`·`commitgate-diagnosing-bugs`·`commitgate-discovery`)이 정본이며, 이 스킬은 그 계열의 표현
(seam·red/green·동어반복·델타 디버깅·수직 슬라이스)을 재사용하고 그 스킬들을 가리킨다. 따라서 파생물로 취급해 아래 MIT 고지를 동행한다.

Adapted from https://github.com/mattpocock/skills @ `d574778f94cf620fcc8ce741584093bc650a61d3` (v1.1.0).
적응 범위: 방법론 표현(§4·§5·요구 정제)에 한한다. 원저작 합성(§1·§2·§3·자가점검)은 CommitGate의 것이며 Pocock의 것이 아니다 — 출처를 혼동하지 말 것.
자세한 출처·대응 관계는 패키지의 `skills/ATTRIBUTION.md`.

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
