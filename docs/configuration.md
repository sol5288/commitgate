# 설정 (req.config.json)

대부분은 기본값으로 충분합니다. 필요하면 프로젝트 루트의 `req.config.json`을 수정하세요.

| 항목 | 기본값 | 설명 |
|---|---|---|
| `branchPrefix` | `"feat/req-"` | 새 브랜치 prefix |
| `ticketRoot` | `"workflow"` | REQ 티켓 폴더 |
| `packageManager` | 자동 감지 | `npm`, `pnpm`, `yarn` |
| `designDocs` | `00/01/02` 문서 | 설계 문서 파일명 |
| `reviewPersonaPath` | `"workflow/review-persona.md"` | 리뷰 프롬프트 첫 블록. `null`이면 비활성 — 단 delta design 리뷰에는 내장 delta 계약이 주입된다 |
| `reviewModel` | `"gpt-5.6-terra"` | codex 리뷰 모델(`-c model=`로 고정). `null`이면 codex 전역 설정을 상속 |
| `reviewReasoningEffort` | `"high"` | codex 리뷰 추론강도. `none`·`minimal`·`low`·`medium`·`high`·`xhigh` 중 하나. `null`이면 전역 상속 |
| `reviewBudget` | `{ "autoBudget": 5, "hardCap": 8 }` | 열린 `(review_kind, phase_id)` review series의 재리뷰 시도 예산. 기본값 기준 1~5회차는 자동, 6~8회차는 회차마다 그 series·회차에 바인딩된 사람 예외 기록이 있어야 진행, `hardCap` 회를 이미 소진하면 그 다음 시도(9회차부터)는 예외가 있어도 차단. `hardCap ≤ 8`·`autoBudget ≤ hardCap` |
| `phaseCommit` | `{ "autoApprove": "never" }` | phase 자동 커밋 정책. `never`(기본)면 매 phase 커밋 전에 사람 확인(현행). `low-only`면 **LOW 위험** 티켓의 Codex 승인 phase를 사람 정지 없이 자동 커밋하고 사람 확인은 feature→main 병합 직전 한 번으로 모은다. HIGH 티켓은 어느 값에서도 매 phase 확인(`userConfirmGate` 백스톱). `"all"` 같은 값은 없다(HIGH livelock 방지) |

빈 `branchPrefix`나 프로젝트 밖으로 나가는 경로는 거부됩니다.

## 대화형 설정 — `commitgate setup`

리뷰 모델·추론강도는 파일을 직접 고치는 대신 마법사로 설정할 수 있습니다. **codex 로그인까지 함께 처리**합니다.

```sh
npx commitgate setup
```

- 각 항목은 **현재 값이 기본 답변**입니다. Enter를 누르면 그대로 유지되고 **파일에 기록되지 않습니다** —
  고르지 않은 값이 고정되지 않도록 **건드린 키만** 씁니다.
- 값을 비워 codex 전역 설정을 상속하려면 `-` 를 입력하세요(`none`은 추론강도의 **유효한 값**이라 쓸 수 없습니다).
- codex에 로그인돼 있지 않으면 `codex login`을 실행하고, **끝난 뒤 다시 확인**합니다.
  로그인이 확인되지 않으면 **설정을 저장하지 않습니다** — `req.config.json`은 그대로입니다.
- 저장은 **원자적**입니다(같은 폴더에 임시 파일을 쓰고 교체). 중간에 중단해도 기존 설정이 깨지지 않으며,
  다시 실행하면 이어서 진행할 수 있습니다.

> 🔴 **사람이 터미널에서 직접 실행하는 명령입니다.** 대화형 전용이라 파이프·CI·에이전트 세션에서는
> 질문을 하나도 하지 않고 즉시 종료합니다. Claude·Codex 같은 에이전트는 이 명령을 실행하지 않고
> **사용자에게 실행을 요청**합니다(`AGENTS.md`의 "사람 전용 명령" 절).

> **자격증명은 저장하지 않습니다.** `req.config.json`은 커밋되는 파일이므로 여기에는 모델·추론강도 같은
> 설정만 들어갑니다. 인증 정보는 codex 자신의 저장소(`~/.codex/`)에 남습니다.

> `req.config.json`은 git이 추적하는 파일이라, setup으로 값을 바꾸면 워킹트리가 dirty해집니다.
> `req:new`는 clean 트리를 요구하므로 **설정 변경을 먼저 커밋**하세요.
>
> setup은 **아무것도 강제하지 않습니다** — 실행하지 않아도 모든 명령이 기본값으로 그대로 동작합니다.

**리뷰 모델·추론강도 고정**: `req:review-codex`는 codex 인자에 `-c model=`·`-c model_reasoning_effort=`를 주입해 **모델과 추론강도를 고정**합니다. 고정하지 않으면 리뷰가 사용자 전역 `~/.codex/config.toml`(예: `model_reasoning_effort="ultra"`)을 상속해 리뷰 1회가 수 분·토큰 과다가 됩니다. 기본값은 `gpt-5.6-terra`/`high`이고, 프로젝트의 codex가 그 모델을 지원하지 않으면 `req.config.json`에서 바꾸거나 `null`로 두어 전역 설정을 상속시킵니다. override가 실제로 존중되는지는 `npm run verify:overrides`(codex CLI 필요)로 확인할 수 있습니다.

**재리뷰는 stateless**: 재리뷰는 매번 **새 codex 스레드**로 시작합니다(이전 대화를 resume해 누적하지 않음 — 토큰 증가와 findings 심화·이동을 막습니다). 직전 같은 대상의 NEEDS_FIX findings만 참고용으로 프롬프트에 담겨 해소 여부(closure)를 확인합니다.
