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
| `stopGate` | `"phase"` | **사람이 멈추는 지점**(권장 축). `phase`=매 phase 커밋 전 확인 · `req`=REQ 안의 LOW phase는 자율 커밋하고 확인을 통합 직전 한 번으로 모음 · `merge`=여러 REQ를 delivery set으로 묶어 **묶음 전체가 끝날 때까지** 미룸. **HIGH 위험 티켓은 어느 값에서도 매 phase 확인**하고, 통합(main 병합) 승인도 어느 값에서나 필요합니다 |
| `phaseCommit` *(deprecated alias)* | `{ "autoApprove": "never" }` | phase 자동 커밋 정책. `never`(기본)면 매 phase 커밋 전에 사람 확인(현행). `low-only`면 **LOW 위험** 티켓의 Codex 승인 phase를 사람 정지 없이 자동 커밋하고 사람 확인은 feature→main 병합 직전 한 번으로 모은다. HIGH 티켓은 어느 값에서도 매 phase 확인(`userConfirmGate` 백스톱). `"all"` 같은 값은 없다(HIGH livelock 방지) |

빈 `branchPrefix`나 프로젝트 밖으로 나가는 경로는 거부됩니다.

### `stopGate`와 `phaseCommit`

`stopGate`가 **의미 축**이고 `phaseCommit.autoApprove`는 그것의 **deprecated alias**입니다. 매핑은 1:1입니다.

| `stopGate` | `phaseCommit.autoApprove` |
|---|---|
| `phase` | `never` |
| `req` | `low-only` |
| `merge` | `low-only` |

- 둘 중 **하나만** 쓰면 나머지는 자동으로 파생됩니다. 기존에 `phaseCommit`만 쓰던 설정은 **그대로 동작**합니다.
- 둘 다 썼는데 **모순**이면 거부되고, 오류가 두 값·기대 매핑·해결 방법을 알려 줍니다.
- `commitgate setup`으로 `stopGate`를 고르면 legacy `phaseCommit` 키는 **자동으로 제거**됩니다
  (두 축이 모순인 파일이 남으면 이후 모든 명령이 막히기 때문입니다).
- 🔴 `merge`와 `req`는 **`phaseCommit.autoApprove`가 같습니다**(둘 다 phase는 자율 커밋). 그래서 legacy
  `phaseCommit`만 있는 설정은 보수적으로 `req`로 해소됩니다 — `merge`를 쓰려면 `stopGate`를 명시하세요.
- `merge`는 [delivery set](workflow.md#delivery-set--여러-req를-한-묶음으로)이 있어야 의미가 있습니다.
  묶음이 없으면 `req:next` 종단은 그냥 `DONE`이고 다음 REQ를 열 수 있습니다.

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
> setup을 마치지 않으면 **워크플로 명령이 막힙니다**(아래 참조). 기존 설치본은 예외입니다.

### setup 완료 마커

setup을 마치면 `req.config.json`에 완료 사실이 기록됩니다.

```jsonc
"setup": { "completedVersion": "0.9.10", "completedAt": "2026-07-26T02:00:00.000Z" }
```

🔴 **이 마커의 의미는 "이 프로젝트의 설정이 끝났다"입니다 — "내가 로그인돼 있다"가 아닙니다.**
`req.config.json`은 커밋되어 팀이 공유하는 파일이고, **로그인은 개발자별**이라 마커가 팀원의 인증을
보증하지 않습니다.

**마커가 없으면 워크플로 명령이 막힙니다**: `req:new` · `req:next` · `req:review-codex` · `req:commit` ·
`req:close` · `req:reconstruct` · `req:review-exception`.
**막히지 않는 것**: `commitgate check` · `req:doctor`(진단 수단은 남깁니다) ·
`init`/`migrate`/`sync`/`uninstall`/`quickstart`/`setup`(setup 이전에 쓰이거나 setup 자체입니다).

**기존 설치본 예외(grandfather).** 이미 CommitGate로 작업하던 프로젝트는 마커가 없어도 막히지 않습니다.
판정 기준은 **유효한 티켓이 1개 이상**(`state.json`의 `id`가 디렉터리명과 일치) **이고 설치 신호가 2개 이상**
(`package.json`의 `req:*` 스크립트 · `req.config.json` · `workflow/machine.schema.json` ·
`AGENTS.md`의 계약 마커)입니다. 빈 `REQ-*` 디렉터리를 만들어 두는 것만으로는 예외가 되지 않습니다.
`req:doctor`의 **D24**가 판정 근거와 함께 상태를 알려 줍니다(WARN — 커밋을 막지 않습니다).


**리뷰 모델·추론강도 고정**: `req:review-codex`는 codex 인자에 `-c model=`·`-c model_reasoning_effort=`를 주입해 **모델과 추론강도를 고정**합니다. 고정하지 않으면 리뷰가 사용자 전역 `~/.codex/config.toml`(예: `model_reasoning_effort="ultra"`)을 상속해 리뷰 1회가 수 분·토큰 과다가 됩니다. 기본값은 `gpt-5.6-terra`/`high`이고, 프로젝트의 codex가 그 모델을 지원하지 않으면 `req.config.json`에서 바꾸거나 `null`로 두어 전역 설정을 상속시킵니다. override가 실제로 존중되는지는 `npm run verify:overrides`(codex CLI 필요)로 확인할 수 있습니다.

**재리뷰는 stateless**: 재리뷰는 매번 **새 codex 스레드**로 시작합니다(이전 대화를 resume해 누적하지 않음 — 토큰 증가와 findings 심화·이동을 막습니다). 직전 같은 대상의 NEEDS_FIX findings만 참고용으로 프롬프트에 담겨 해소 여부(closure)를 확인합니다.
