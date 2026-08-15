# REQ-2026-158 설계

## DEC-1 — 가드의 적용 범위를 **공개 문서 전체**로 넓힌다

이 결함의 원인은 서술이 아니라 **가드 범위**다. REQ-2026-157 의 "회차 번호 금지" 검사는
quick-start 두 문서에만 걸려 있었다.

```
검사 대상 = 공개 사용자 문서 전체
  README.md · README.en.md
  docs/quick-start.md · .en.md
  docs/workflow.md · .en.md
  docs/configuration.md · .en.md
  docs/guarantees.md · .en.md
  AGENTS.template.md          ← 🔴 설치 프로젝트로 복사되는 계약
```

- 🔴 **목록을 테스트 안에 상수로 둔다.** 문서가 늘어날 때 자동으로 따라가지 않는 것은 알지만,
  glob 로 훑으면 워크플로 티켓(`workflow/REQ-*`)의 설계문서까지 걸려 **과거 기록을 고치라고**
  요구하게 된다. 기록은 그때의 사실이므로 고치면 안 된다.
- 🔴 **금지 문자열은 축자로 적는다**(`6~8` · `6–8` · `rounds 6` · `round 9` · `9회부터`).
  정규식으로 "회차 같은 것"을 잡으려 들면 그 패턴이 다음 결함이 된다.

## DEC-2 — 초보자용 정본 문장을 **하나로** 정하고 재사용한다

같은 사실을 다섯 곳에 각자 쓰면 또 갈라진다. **한 문단**으로 고정하고, 길이만 자리에 맞춘다.

**긴 형(quick-start·configuration·workflow):**

> 판정이 나온 리뷰(승인·수정 요청처럼 **결과가 정상적으로 나온** 리뷰)가 `autoBudget`(기본 5)회를
> 채우기 전까지는 자동으로 진행합니다. 채운 뒤는 `onSoftLimit` 이 정합니다 — `ask`(기본)면 회차마다
> 사람이 예외를 승인해야 하고, `auto` 면 승인 없이 진행합니다.
> **어느 값이든 `hardCap`(기본 8)에 도달하면 다음 리뷰는 실행되지 않습니다.**
> 🔴 두 한도는 **세는 것이 다릅니다** — `autoBudget` 은 판정이 나온 리뷰를, `hardCap` 은 **실제로
> 호출한 횟수**를 셉니다. 응답이 무효면 판정 수에는 안 들어가지만 호출 수에는 들어갑니다(돈은 이미
> 나갔으니까요). 그래서 "몇 번째부터"라고 고정해 말할 수 없습니다.

**짧은 형(README 첫 소개):** 앞 세 줄만.

## DEC-3 — 두 축을 **한 문장에 섞지 않는다**

- `stopGate` — 커밋·통합에서 **사람이 확인하는 안전 통제점**.
- `reviewBudget.onSoftLimit` — 재리뷰가 길어질 때 **추가 비용을 자동으로 허용할지**.

🔴 **`auto` 라는 이름이 두 곳에 있다**는 것을 quick-start 에 **한 번** 명시한다(정본):

| 어디의 `auto` | 뜻 |
|---|---|
| `stopGate: "auto"` | **사전 위임이 있을 때만** 통합까지 자동 진행 |
| `reviewBudget.onSoftLimit: "auto"` | 예산 초과 뒤 **사람 예외 승인 없이** 재리뷰 진행 |

- 🔴 **둘 다 `hardCap` 을 해제하지 않는다**를 그 표 아래에 붙인다.
- 🔴 다른 문서에서 반복하지 않는다 — 링크한다(DEC-2 와 같은 이유).

## DEC-4 — `AGENTS.template.md` 는 **네 축**을 적고 근거를 그것으로 바꾼다

```
setup 은 리뷰 모델 · 추론강도 · 멈춤 지점(stopGate) · 리뷰 예산 초과 정책(reviewBudget.onSoftLimit)
을 묻는다.
```

그리고 "에이전트가 스스로 실행하면 안 되는 이유"를 **두 정책 축**으로 다시 쓴다:

> setup 은 **어디서 사람이 확인하는지**(`stopGate`)와 **예산을 넘겼을 때 사람 승인 없이 계속할지**
> (`reviewBudget.onSoftLimit`)를 정한다. 에이전트가 스스로 실행할 수 있으면 **자기가 통과할 게이트를
> 자기가 고르는** 경로가 열린다.

- 🔴 지금의 "리뷰 모델 같은 게이트 파라미터"는 **어느 축인지 불분명**하다. 정책 축을 이름으로 적는다.

## DEC-5 — 회귀 가드는 **소스를 정본으로** 삼는다(기존 원칙 유지)

`tests/unit/setup-docs-parity.test.ts` 를 확장한다. 새 검사:

1. **공개 문서 전체**에 금지 문자열이 없다(DEC-1 목록 × 축자 문자열).
2. `docs/configuration.md`(한/영) **요약 표 행**이 `onSoftLimit` 과 **두 계수 기준의 차이**를 말한다.
3. `AGENTS.template.md` 가 **`buildQuestions({})` 의 모든 키**를 적는다 — 🔴 문자열 목록을 손으로
   적지 않고 **소스에서 파생**한다. 축이 늘면 자동으로 red 다.
4. README(한/영) **명령 표의 setup 행**이 네 축을 모두 말한다 — 같은 방식으로 소스에서 파생.

- 🔴 **문서끼리 비교하지 않는다.**
- 🔴 **변이 검사**로 각 검사가 실제로 잡는지 확인한다.

## Phase 분해

단일 phase — `phase-1-review-budget-doc-drift`. 문서 9종 + 테스트 1개, 축이 하나다.

## 변경 파일

`README.md` · `README.en.md` · `docs/workflow.md` · `docs/workflow.en.md` ·
`docs/configuration.md` · `docs/configuration.en.md` · `docs/quick-start.md` · `docs/quick-start.en.md` ·
`AGENTS.template.md` · `tests/unit/setup-docs-parity.test.ts` · `CHANGELOG.md`

## 안전

- 🔴 **코드·기본값·선택지를 바꾸지 않는다.**
- 🔴 워크플로 티켓의 **과거 설계문서는 고치지 않는다** — 그때의 사실이다. 가드 대상에서 뺀다.
- 🔴 `docs:lint` 통과 · README→docs 는 절대 blob URL · 한글 heading 앵커는 쓰지 않는다.
