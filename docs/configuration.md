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

**리뷰 모델·추론강도 고정**: `req:review-codex`는 codex 인자에 `-c model=`·`-c model_reasoning_effort=`를 주입해 **모델과 추론강도를 고정**합니다. 고정하지 않으면 리뷰가 사용자 전역 `~/.codex/config.toml`(예: `model_reasoning_effort="ultra"`)을 상속해 리뷰 1회가 수 분·토큰 과다가 됩니다. 기본값은 `gpt-5.6-terra`/`high`이고, 프로젝트의 codex가 그 모델을 지원하지 않으면 `req.config.json`에서 바꾸거나 `null`로 두어 전역 설정을 상속시킵니다. override가 실제로 존중되는지는 `npm run verify:overrides`(codex CLI 필요)로 확인할 수 있습니다.

**재리뷰는 stateless**: 재리뷰는 매번 **새 codex 스레드**로 시작합니다(이전 대화를 resume해 누적하지 않음 — 토큰 증가와 findings 심화·이동을 막습니다). 직전 같은 대상의 NEEDS_FIX findings만 참고용으로 프롬프트에 담겨 해소 여부(closure)를 확인합니다.
