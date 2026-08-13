# 워크플로 — req:next가 이끄는 흐름

## 에이전트는 `req:next`가 시키는 대로 진행합니다

다음 행동을 에이전트가 추측하지 않습니다. 도구가 `state.json`과 git 상태에서 계산합니다.

```sh
npm run req:next -- 2026-002
```

```text
[req:next] RUN  REQ-2026-002
  phase `phase-1`의 staged 변경을 리뷰받는다.

  $ npm run req:review-codex -- 2026-002 --kind phase --phase phase-1 --run
```

| kind | 뜻 | exit |
|---|---|---|
| `RUN` | 출력된 명령을 그대로 실행하고 다시 `req:next` | 0 |
| `AGENT` | 도구가 대신 못 하는 작업(구현·문서 작성·`git add`) | 0 |
| `AWAIT_HUMAN` | **통제점** — 출력된 승인 문장을 그대로 받기 전엔 진행 금지 | 10 |
| `DONE` | 이 티켓에서 도구가 할 일 없음. 통합은 별도 통제점 | 11 |
| `BLOCKED` | 사람에게 보고. 같은 리뷰 재시도 금지 | 2 |

`--json`으로 기계 판독할 수 있습니다. **읽기 전용**이라 어떤 상태도 바꾸지 않습니다.

이 루프를 끊지 말고 반복하면 설계 → Codex 리뷰 → 구현 → 재리뷰 → 커밋이 진행됩니다. 사용자는 `AWAIT_HUMAN`에서만 확인하면 됩니다.

> **사람이 어디서 멈추는지는 `stopGate` 하나가 정합니다.** 기본값 `req`에서는 REQ 안의 phase가 사람 정지 없이
> 자동 커밋되고(`req:next`가 `req:commit --run`을 RUN으로 지시), 사람 확인은 **REQ를 완성시키는 커밋**과
> **통합 직전**으로 모입니다(종단이 `DONE` 대신 `AWAIT_HUMAN`(통합)). 매 phase 멈추려면 `stopGate: "phase"`입니다.
> 값별 확인 지점과 위험도(`HIGH`)의 취급은 아래 [HIGH 위험 티켓의 사람 확인](#high-위험-티켓의-사람-확인)이 정본입니다.
> 어느 값에서도 **Codex 리뷰 게이트는 그대로**입니다 — `stopGate`가 옮기는 것은 *사람 정지*뿐입니다.

## 리뷰어 페르소나는 도구가 주입합니다

`req:review-codex`는 `workflow/review-persona.md`를 프롬프트 **첫 블록**으로 넣습니다. 사람이 직접 실행하든, Cursor가 실행하든, Claude가 실행하든 동일합니다 — 에이전트가 잊을 수 있는 자리에 두지 않습니다. 파일이 없거나 비어 있으면 리뷰가 fail-closed로 멈춥니다.

내용을 프로젝트에 맞게 고치거나, `req.config.json`의 `reviewPersonaPath`로 다른 파일을 지정할 수 있습니다. `null`로 두면 비활성화됩니다 — 다만 **delta design 리뷰에는 내장 delta 계약이 주입된다**(승인 baseline 이후 변경분만 재검토하도록 리뷰어에게 거는 계약이라, 설정 persona와 무관하게 붙습니다).

## 설계 재리뷰는 delta로 좁혀집니다

설계가 한 번 승인되면 그 시점의 설계 문서(기본 `00/01/02`, `designDocs` 설정으로 변경 가능)를 baseline으로 기억합니다. 이후 설계를 고쳐 재리뷰하면, 리뷰어에게 **변경된 문서와 그 직접 영향 범위만** 심사하도록 프롬프트를 구성합니다. 변경 문서는 `[변경됨 — 심사 대상]`, 미변경 문서는 `[승인 baseline — 변경 없음, 참조]`로 표시하고, 승인된 영역을 다시 문제 삼지 말라는 계약을 겁니다. 미변경 문서는 본문 대신 생략 표식만 전달해 토큰을 아낍니다. 승인 후 작은 편집이 전체 재리뷰를 유발해 승인이 되돌려지던 문제를 줄입니다.

변경이 너무 근본적이라 delta로 판단할 수 없으면 리뷰어가 `full_review_requested: "yes"`(그때 `commit_approved: "no"`)로 전체 재리뷰를 요청합니다. 그러면 baseline이 비워져 다음 설계 리뷰가 full 모드로 돌아가고, 그 설계가 다시 승인되면 새 baseline이 잡혀 delta가 재개됩니다.

main에 반영하는 경로는 **PR 경유(선택)**와 **direct push** 둘 다 유효합니다. PR은 의무가 아닙니다. 다만 protected branch로 직접 push하면 branch protection을 **우회**하므로 "branch protection bypass를 사용한 direct push 승인"을 따로 받아야 합니다 — bypass 권한이 있다는 사실은 승인이 아닙니다. tag, npm publish, GitHub release는 반영과 묶이지 않는 **별도 통제점**이고 각각 따로 승인받습니다. **GitHub CI는 이 어느 단계의 전제도 아닙니다** — 이 저장소의 `ci.yml`은 `workflow_dispatch` 전용이라 push·tag·PR로 자동 실행되지 않고, 검사를 원하면 사람이 직접 실행합니다. 실행했으면 run 결과를, 생략했으면 **생략했다는 사실**을 보고에 남깁니다. 자세한 계약은 [AGENTS.template.md](../AGENTS.template.md)와 [docs/RELEASING.md](../docs/RELEASING.md)를 참고하세요.

## 재리뷰 예산 — 몇 번까지 돌 수 있습니까

같은 `(리뷰 종류, phase)`의 재리뷰 횟수에는 예산이 있습니다(`req.config.json`의
[`reviewBudget`](configuration.md#리뷰-예산--reviewbudget)).

- 1~`autoBudget`회(기본 5)는 사람 개입 없이 돕니다.
- `autoBudget`을 넘긴 회차(기본 6~8)의 처리는 **`onSoftLimit`이 정합니다**:
  `"ask"`(기본)면 회차마다 `req:review-exception` 사람 승인이 필요하고,
  `"auto"`면 사람 승인 없이 진행하며 원장에 **정책으로 통과했다**는 사실이 남습니다.
- `hardCap`(기본 8)을 소진하면 그다음 회차는 **두 값 모두에서** 차단됩니다. 그때는 종료하거나
  정합한 대체 REQ를 만듭니다.

🔴 이 정지는 **비용 통제**이지 안전 게이트가 아닙니다. `"auto"`로 두어도 리뷰 승인·증거·통합 통제점은
그대로이고, `hardCap`도 그대로입니다. `"auto"`에서는 `req:review-exception`이 예외를 부여하지 않습니다 —
소비될 일이 없는 승인 기록을 만들지 않기 위해서입니다.

`auto`가 **정확히 무엇을 없애고 무엇을 남기는지**와 `hardCap`이 왜 열리지 않는지는
[설정 — 리뷰 예산](configuration.md#리뷰-예산--reviewbudget)이 정본입니다. 기존 프로젝트가 이
정책으로 올라가는 방법도 거기에 있습니다.

🔴 **이 축의 `auto`와 `stopGate: "auto"`는 다른 것입니다.** 앞은 재리뷰 회차의 사람 예외를,
뒤는 통합 지점의 사람 확인을 각각 다룹니다. `stopGate: "auto"`는 **사전 위임 기록이 있을 때만**
통합을 진행합니다 — 상세는 [설정](configuration.md#stopgate-auto--사전-위임-범위-안의-검증된-변경만-자동-통합합니다)에 있습니다.
🔴 **둘 다 `hardCap`을 열지 않습니다.**

`stopGate`를 `req`·`merge`로 두어 자율 진행을 설정했다면 이 축도 함께 보십시오. 예산 정지는
`stopGate`가 정한 지점과 **무관하게** 끼어들기 때문에, 한쪽만 열어 두면 워크플로가 여전히 끊깁니다.

## 관측 요약 — commitgate report

도구가 로컬에 쌓는 관측 로그 3종(`.doctor-runs` · `.review-calls` · `.verify-runs`)을 한 번에
요약합니다(읽기 전용 — 아무것도 쓰지 않고 네트워크도 쓰지 않습니다):

```sh
npx commitgate report                   # doctor 발화·리뷰 수렴·증거·CI 선택 요약
npx commitgate report --json            # 기계용
npx commitgate report --base v0.21.0    # evidence 범위를 명시(릴리스 범위 점검 등)
npx commitgate report --last 50         # HEAD~50..HEAD
```

evidence 섹션의 기본 범위는 trunk와의 merge-base..HEAD 라, trunk 위에서는 빈 범위(0 커밋)입니다 —
출력이 그 사실과 함께 `--base`/`--last` 안내를 표기합니다. 범위·계산 시각·6범주 분류(0.22 심층
검증과 동일)가 함께 나옵니다. 0.22에서 report의 증거 계산이 manifest당 git 프로세스를 만들던
구조를 배치 읽기로 바꿨습니다(이 저장소 실측 29.5초 → 1.2초 — 환경에 따라 다릅니다).

검사별 발화·FAIL 수와 경고 피로(WARN-only 비율), 리뷰 대상당 호출 분포와 프롬프트 크기·소요
분위수, trunk 대비 승인 증거 요약(verify-range), GitHub CI opt-in/생략 분포를 보여줍니다.
원천 로그가 없으면 그 섹션은 "데이터 없음"으로 표기합니다 — 추정하지 않습니다.

## 머지 직전 로컬 검증 — GitHub CI는 선택입니다

**GitHub CI는 CommitGate의 필수 조건이 아닙니다.** GitHub Actions는 사용량·비용이 발생할 수 있으므로 CommitGate는 CI를 요구하지도, 자동 실행하지도 않습니다. 통합 승인 전에 로컬만으로 이 범위의 승인 증거를 확인할 수 있습니다:

```sh
npx commitgate verify-range            # trunk와의 merge-base..HEAD를 심층 분류
npx commitgate verify-range --strict   # 미입증·손상 증거가 있으면 exit 1 (게이트로 쓸 때)
npx commitgate attest <sha> --reason "release 커밋" --run   # 정당한 예외의 명시 승인(append-only 기록)
```

release·setup·수동 충돌 정정처럼 승인 증거가 없는 것이 정상인 커밋은 `attest`로 이유와 함께 예외 승인을 기록하면 `attested`로 분류됩니다(--strict·integrate 통과). 기록은 `workflow/attestations.jsonl`에 append-only로 커밋되는 감사 데이터이며 서명이 아닙니다 — 로컬 git identity·시각·이유가 남습니다. **손상 증거는 attest로 구제되지 않습니다** — 수정이 답입니다.

범위의 각 커밋을 **승인 소비** · **도구 부기** · **머지** · **attested**(예외 승인 기록) · **손상 증거** · **미입증**의 6범주로 **심층 분류**합니다(0.22). 표시자 매칭이 아니라 검증입니다 — 승인 소비는 매니페스트 행 스키마·응답 아카이브 실재·SHA-256 일치·중복 소비 부재까지 확인하고, 부기는 trailer에 더해 변경 경로가 전부 워크플로 경로인지 확인하며(사용자 코드 혼입 시 손상 증거), 머지는 conflict resolution/evil-merge 변경이 있으면 미입증으로 내립니다. 검증할 수 없는 경우(blob 읽기 실패 등)는 손상으로 단정하지 않고 미입증 + 축소 표기로 남깁니다. GitHub 인증·`gh`·네트워크 없이 동작하며, 미입증 커밋은 우회 단정이 아니라 "증거로 입증되지 않음"의 표시입니다(설치 스캐폴드·릴리스 커밋 등 규정된 워크플로 외 커밋도 여기 나옵니다). squash/rebase로 재작성된 이력은 소비 시점 SHA와 달라 미입증으로 나옵니다 — 이 검사는 주어진 범위를 있는 그대로 보고합니다.

대화형 실행에서는 마지막에 **"기존 GitHub CI 결과를 조회하시겠습니까? 워크플로를 실행하지 않습니다(GitHub API 조회 1회). [y/N]"** 를 묻습니다. 기본값은 No이고, Enter나 `n`이면 조회 없이 계속합니다(생략은 정상 상태입니다). `y` 또는 `--check-github-ci`일 때만 head SHA의 check-runs를 **1회 조회**하며(워크플로를 실행하지 않으므로 Actions 사용량을 새로 발생시키지 않습니다), 명시적으로 요청한 조회가 실패하면 조용히 넘어가지 않고 exit 1로 멈춥니다. 비대화형에서는 플래그가 없으면 생략합니다. 선택은 실행 단위이며 저장되지 않습니다. 기존 `--github-ci`/`--no-github-ci`는 deprecated alias로 동작이 유지됩니다(동일 의미 — 조회).

## 통합 seam — `commitgate integrate` (0.22)

verify-range가 **보고**라면 `integrate`는 **절차**입니다 — 통합 직전 검사를 실제 `git merge`와 결속합니다:

```sh
npx commitgate integrate          # dry-run — 전제·증거 검사 결과와 실행 계획만 출력
npx commitgate integrate --run    # 실제 통합(대화형이면 마지막에 [y/N] 최종 확인)
```

순서: ① 전제 확인(feature 브랜치·clean worktree·진행 중 merge/rebase 없음) → ② 승인 증거 검증
(**항상 strict** — 미입증 커밋·manifest 손상이 있으면 병합하지 않고 목록을 보여줍니다. 통과하면
feature/trunk 두 SHA를 **결속**합니다) → ③ GitHub CI **실행** opt-in(아래) → ④ 사람의 최종 확인 →
⑤ **재검증 후 병합** → ⑥ 감사 로그 1행(`workflow/.integrate-runs.jsonl` — gitignored).
**push는 하지 않습니다.**

⑤가 "재검증 후"인 이유: ③의 CI 대기와 ④의 확인 사이에 시간이 흐릅니다. 그동안 다른 창에서 커밋
하나가 얹히면 **검사하지 않은 커밋이 trunk로 들어갈 수 있습니다.** 그래서 병합 직전에 현재 브랜치·
양쪽 ref SHA·워킹트리 clean·merge/rebase 진행 여부를 다시 확인하고, 하나라도 바뀌었으면 병합하지
않고 재실행을 안내합니다. 병합은 브랜치 **이름**이 아니라 결속한 **SHA**로 하며, 만들어진 merge
commit의 부모가 그 두 SHA인지 확인한 뒤에야 `git update-ref`의 비교·교환으로 trunk를 갱신합니다 —
그 사이 trunk가 움직였으면 교환이 거부되고 trunk는 그대로 남습니다. 충돌이나 실패에서는
`merge --abort` 후 원래 feature 브랜치로 돌아갑니다(자동 reset·stash 없음).

CI **실행**(조회와 다릅니다)은 `req.config.json`에 사용자 소유 설정이 있을 때만 가능합니다:

```json
{ "githubCi": { "workflow": "ci.yml", "timeoutMinutes": 30 } }
```

실행은 `--run --run-github-ci` 명시(CI 실행은 실제 통합 실행 중의 한 단계라 `--run`이 함께 필요합니다 — dry-run은 CI에 닿지 않습니다) 또는(설정이 있을 때) `--run` 대화형 **"GitHub CI workflow를 실행하시겠습니까? GitHub Actions 사용량 또는 비용이 발생할 수 있습니다. [y/N]"** 의 `y` 뿐입니다. **기본값은 No**이며 Enter·빈 문자열·`n`은 모두 미실행입니다. 설정이 없으면 질문하지 않고 생략합니다(생략은 정상 — 실패가 아닙니다).

실행하기로 했을 때의 규칙:

- 실행 전 원격 브랜치 SHA가 **결속한 feature SHA**와 같아야 합니다(다르면 자동 push 없이 명확히 실패).
- **run은 추정하지 않습니다.** dispatch 요청이 돌려준 run id로만 그 실행을 조회하며,
  head SHA·이벤트(`workflow_dispatch`)·브랜치·워크플로가 요청한 것과 일치하는지 매번 대조합니다.
  id를 받지 못하면(구형 GitHub API·구형 `gh`) 목록에서 추측하지 않고 실패합니다 — `gh`를 v2.87.0 이상으로 올리세요.
- **`success`만 통과입니다.** `failure`·`cancelled`·`timed_out`은 물론 `skipped`(요청한 검사가 실행되지 않음)와
  `neutral`(판정 없음)도 통과로 보지 않습니다.
- 실패·timeout·식별 불가는 전부 **병합하지 않습니다**. 선택은 실행 단위이며 저장되지 않습니다.

> 참고: `.github/workflows/ci.yml`을 이 저장소처럼 **`workflow_dispatch` 전용**으로 두면
> push·tag·PR로 Actions가 자동으로 도는 일이 없어, 실행 시점을 사람이 온전히 통제할 수 있습니다.

> `delivery integrate`(feature→delivery 브랜치, delivery set 내부)와는 층이 다릅니다 — 이 명령은 feature→trunk 통합입니다.

## 수동 명령

대부분의 사용자는 `req:next`가 시키는 대로만 하면 됩니다. 아래는 내부에서 어떤 명령이 실행되는지 이해하거나 직접 디버깅할 때만 보면 됩니다.

```sh
# 1. 티켓과 브랜치 생성
npm run req:new -- my-feature --run

# 2. 설계 문서 작성 후 stage
git add workflow/REQ-2026-001/00-requirement.md workflow/REQ-2026-001/01-design.md workflow/REQ-2026-001/02-plan.md

# 3. 설계 리뷰
npm run req:review-codex -- 2026-001 --kind design --run

# 4. 코드 구현 후 stage
git add <changed-source-files>

# 5. 게이트 점검
npm run req:doctor -- 2026-001

# 6. 구현 리뷰
npm run req:review-codex -- 2026-001 --kind phase --run

# 7. 승인된 코드 커밋
npm run req:commit -- 2026-001 --run -m "feat: my feature"
```

중요: source 커밋에는 내가 만든 코드와 문서만 stage하세요. `state.json`과 `responses/`는 도구가 관리합니다.

🔴 **여러 줄 커밋 메시지는 `-m`으로 넘기면 안 됩니다.** 패키지 매니저와 `npx`가 인자를 셸 명령
문자열로 다시 조립하면서 **개행 이후를 버리거나**(npm·npx) **리터럴 `\n` 두 글자로 바꿉니다**(pnpm).
CommitGate가 받는 시점에 이미 망가져 있어 복원할 수 없습니다. 파일로 넘기세요.

```sh
npm run req:commit -- 2026-001 --run --message-file commit-message.txt
npm run req:commit -- 2026-001 --run -F commit-message.txt   # 같은 뜻(git commit -F 규약)
```

한 줄 메시지는 `-m`으로 계속 써도 안전합니다. 자세한 실측표는
[문제 해결](./troubleshooting.md)에 있습니다.

## delivery set — 여러 REQ를 한 묶음으로

요구사항이 커서 REQ를 나눠 진행하거나, 여러 설계 문서를 순차로 구현할 때가 있습니다. 그럴 때
`stopGate: "merge"` + `commitgate delivery` 로 REQ들을 하나의 묶음으로 묶고, **묶음 전체가 끝날 때까지**
main 병합 정지를 미룰 수 있습니다.

```sh
npx commitgate delivery create payment-improvement --run       # delivery/payment-improvement 브랜치 + 레코드
npx commitgate delivery begin payment-api --slug payment-improvement --run   # REQ 생성 + 묶음에 등록
# … 평소대로 설계·리뷰·phase·req:commit …
npx commitgate delivery integrate --slug payment-improvement --run           # 단일 merge commit 으로 반영
npx commitgate delivery begin payment-ui --slug payment-improvement --run    # 다음 REQ
# …
npx commitgate delivery seal    --slug payment-improvement --confirm "seal payment-improvement"    --run
npx commitgate delivery approve --slug payment-improvement --confirm "approve payment-improvement" --run
```

- 한 번에 **활성 REQ는 하나**입니다. 앞의 REQ가 종결돼야 다음 `begin`이 통과합니다 — 이 순차 불변식이
  병합 충돌을 구조적으로 없앱니다.
- `integrate`는 **승인된 완료 REQ만** 반영합니다. feature ref에 커밋된 `dev-complete` 증거·승인
  매니페스트·응답 파일 무결성·승인 트리 provenance를 확인하고, **승인 이후의 코드 커밋이 있으면 거부**합니다.
  `--force` 류 우회는 없습니다.
- `seal` 이후에는 `begin` 할 수 없습니다. 되돌리려면 `reopen` — 승인이 있었다는 사실은 이력에 남습니다.
- 🔴 **도구는 `delivery` → `main` 을 병합하지 않습니다.** `approve`는 승인을 기록할 뿐이고, 실제 병합은
  기존 통제점표(I1/I2/B1)에서 사람이 실행합니다.
- 🔴 **승인은 그 시점의 묶음 내용에 결속됩니다.** `approve`는 승인 직전 묶음 브랜치 tip을 레코드에
  남기고(`approval.base_sha`), 그 뒤 **묶음 레코드 밖을 건드린 커밋**이 들어오면 게이트가 다시
  `AWAIT_HUMAN`(재승인)을 냅니다 — 승인한 내용과 병합될 내용이 다르기 때문입니다.
  재승인은 `reopen` → `seal` → `approve` 순서입니다(상태가 아직 `approved`라 `approve`만으로는 되지 않습니다).
  승인 자체가 만드는 레코드 커밋은 이 판정에서 제외되므로 승인이 자기 자신을 무효화하지 않습니다.
  이 결속이 없는 옛 레코드는 예전처럼 통과합니다.
- 브랜치 위치에 의존하지 않습니다 — 도구가 필요한 곳으로 옮겼다가 **원래 브랜치로 되돌립니다**.

`stopGate: "merge"` 를 켜면 `req:next` 종단도 묶음을 봅니다: 묶음이 아직 열려 있으면 `DONE`(다음 REQ를
열 수 있다), 닫혔고 모든 member가 종결됐으면 `AWAIT_HUMAN`. 같은 판정을 `integrate`와 `seal`도
전이 직후에 냅니다 — 마지막 `integrate` 뒤에 `seal` 한 사용자는 `req:next`를 다시 부를 이유가 없기 때문입니다.

🔴 **묶음에 속하지 않은 REQ 는 `req` 와 똑같이 멈춥니다**: 종단이 `AWAIT_HUMAN`(통합 feature→main)이고,
`HIGH` 티켓이면 그 직전에 `req:confirm --scope req` 를 요구합니다. `merge` 를 골랐다고 해서 정지가
사라지지는 않습니다 — 묶음이 없으면 이 REQ 다음에 올 것이 다음 REQ 가 아니라 **통합**이기 때문입니다.

## 에이전트는 언제 묻지 않습니까

`req:next`의 `kind`가 정지 여부를 정합니다. `RUN`·`AGENT`·`DONE`이면 에이전트는 **확인을 구하지 않고**
그대로 진행합니다. 묻고 기다리는 것은 멈추는 것과 같은 효과라, 설정으로 정한 정지 지점이 세션마다
늘어나기 때문입니다.

도구 통제점이 아닌 판단(설계 선택지·구현 방식)은 `stopGate`가 `req`·`merge`일 때 에이전트가 권장안을
택하고 그 근거를 `01-design.md`에 남긴 뒤 계속합니다. `phase`를 고르셨다면 이 자율 규칙은 적용되지 않습니다.

멈추는 자리는 정해져 있습니다: 통제점표(I1/I2/B1·R1/R2/R3), HIGH 확인, destructive 작업, 설계 **범위**
변경, 리뷰 `BLOCKED`, 전제 미충족, `AWAIT_HUMAN`/`BLOCKED`, `commitgate setup`,
그리고 **확인 문장(`--confirm`)을 요구하는 명령**(`req:rebind`·`delivery seal`/`approve`/`reopen`).
마지막 항목이 중요한 이유는 그런 명령이 `AGENT` 상태의 **진단 줄**로 나올 수 있기 때문입니다 —
`kind`만 보고 판단하면 에이전트가 사람의 확인 문장을 대신 써 넣게 됩니다.

설계를 손대야 할 때는 **정정**과 **범위 변경**을 가릅니다. 같은 목표를 유지한 채 방법을 고치는 것은
정정이고 자율로 진행한 뒤 설계 재승인을 받습니다. `00-requirement.md`를 고쳐야 한다면 범위 변경이고,
그때는 멈추고 보고합니다.

정본은 `AGENTS.md`(설치 시 생성되는 계약)입니다.

## phase 분해는 사람이 채웁니다

`req:new`는 티켓을 만들 때 `state.json`의 `phases[]`를 **빈 배열로** 둡니다. `02-plan.md`에 phase를
분해한 뒤 그 id들을 `phases[]`에 채워야 phase 리뷰가 돕니다.

```jsonc
"phases": [
  { "id": "phase-1-model", "approved": false },
  { "id": "phase-2-verb",  "approved": false }
]
```

🔴 **채우기 전에 `--kind phase`로 리뷰하면 거부됩니다.** 그 상태에서는 승인이 나와도 커밋할 수 없기
때문입니다 — 커밋 경로가 `phases[]`를 유효 id 목록으로 쓰므로, 비어 있으면 어떤 phase 승인도 통과하지
못합니다. 예전에는 이 실패가 `req:commit` 시점까지 미뤄져 **유료 리뷰 호출 1회를 버렸습니다.**

> 예전 티켓(`phases[]` 추적 이전)은 그대로 동작합니다. 다만 그런 티켓에 `--phase`를 주면
> **조용히 무시되지 않고 거부**됩니다 — 무시되면 자기가 지정한 phase에 승인이 붙었다고 잘못 믿게 됩니다.

## 설계를 다시 승인했다면 — `req:rebind`

리뷰가 P1을 내면 설계 문서를 고치게 되고, 그러면 **설계 재승인**이 걸립니다. 그때마다 `design_hash`가
바뀌고 **앞서 승인된 phase는 옛 해시에 묶인 채** 남습니다. 완료 증거(`dev-complete`)는 모든 phase가
현재 설계에 결속돼야 발행되므로, 그 상태에서는 **티켓이 종결되지 않고 다음 REQ도 열리지 않습니다.**

**벽에 부딪히기 전에 알려줍니다.** 결속이 끊긴 phase가 생기면 `req:next`가 그때부터 진단 줄에
실행할 명령을 그대로 붙이고, `req:doctor`도 **D26**으로 같은 사실을 냅니다.

```
[req:next] AGENT  REQ-2026-086
  phase `phase-4`를 구현하고 …
  - ⚠️ 설계 재승인으로 앞선 phase의 결속이 끊겼습니다 — 지금 재결속하지 않으면 마지막 phase를 마쳐도 티켓이 닫히지 않습니다.
  - npx commitgate req:rebind REQ-2026-086 --phase phase-1-x --confirm "rebind REQ-2026-086 phase-1-x" --run
```

이 안내는 **아무것도 막지 않습니다.** 진행 중에 결속이 끊긴 것 자체는 오류가 아니고, 마지막에 재결속하면
됩니다 — 다만 그 사실을 **마지막에 처음 알게 되지 않도록** 미리 보여줄 뿐입니다.
결속이 온전한 티켓에는 이 줄이 **하나도 붙지 않습니다.**

```sh
# 어느 phase가 옛 해시에 묶였는지 계획만 보기
npx commitgate req:rebind 2026-069 --phase phase-1-x
# 재결속(확인 문구 필요)
npx commitgate req:rebind 2026-069 --phase phase-1-x --confirm "rebind REQ-2026-069 phase-1-x" --run
```

🔴 **이 명령은 판단을 대신하지 않습니다.** "이 설계 변경이 그 phase의 검수를 무효화하는가"는 도구가
알 수 없습니다 — 사람이 확인 문구로 답하고, 그 사실이 `approvals.jsonl`에 **append**되어 감사에 남습니다
(누가·언제·어느 해시에서 어느 해시로). 기존 승인 행은 고치지 않으므로 "원래 어느 설계로 검토됐는가"도
그대로 남습니다.

재결속이 **마지막 남은 결속을 채우면 그 자리에서 `dev-complete`를 발행**하고 티켓이 종결됩니다.
아직 승인 전인 phase가 남아 있으면 기록만 남기고 넘어갑니다 — 중간 재결속은 정상입니다.

**중단됐다면 그냥 다시 실행하세요.** 재결속은 두 커밋(재결속 기록 → `dev-complete`)으로 이뤄집니다.
두 번째가 실패한 뒤 다시 실행하면 "이미 재결속됨"은 **실패가 아니라 no-op**으로 지나가고 완료 판정을
다시 수행합니다. 티켓 스크래치(`state.json`)가 사라진 저장소에서는 HEAD에 커밋된 state로 판정합니다 —
그것도 비어 있으면 "아직 완료가 아니다"라고 하지 않고 **판정하지 못했다는 사실**을 알립니다.

## 리뷰가 "원장 무결성 실패"로 막힌다면 — `--close-stale`

리뷰 실행이 **중간에 죽으면** 원장에 `attempt-opened` 만 남습니다. 다음 리뷰는 같은 번호를 다시 열려다
이렇게 막힙니다.

```text
리뷰 원장 무결성 실패(fail-closed): 같은 자연키의 기존 행과 내용이 다름(attempt=2 attempt-opened)
```

원장은 append-only 라 그 행을 지울 수 없고, 지워서도 안 됩니다 — 그 회차에 **호출은 실제로 나갔기**
때문입니다. 대신 **버렸다고 기록**합니다.

```sh
npx commitgate req:review-exception <REQ> --close-stale <series_id> --reason "<왜 버리는가>" --run
```

- 원장에 `attempt-closed`(판정 `abandoned`)를 남기고, `state` 의 회차를 원장에 맞춥니다.
- 사유는 **필수**입니다. 근거 없는 종결은 기록이 아닙니다.
- 열린 회차가 여럿이면 **가장 이른 것**부터 닫습니다 — 다시 실행하면 순서대로 해소됩니다.
- 🔴 **비용은 사라지지 않습니다.** 버린 회차는 `hardCap`(총 호출 상한)에 그대로 남고,
  `autoBudget`(사람 없이 도는 회차)에서만 빠집니다 — 판정을 받지 못했기 때문입니다.
- 🔴 이 명령 자체가 중간에 죽어도 **다시 실행하면 수렴합니다.** 이미 기록된 행을 다시 만들지 않고
  남은 부분만 맞춥니다.

## 티켓이 완료됐는데도 `req:new`가 막힌다면

`dev-complete`가 발행된 뒤에 phase를 하나 더 붙이면서 설계를 재승인하면, 그 완료 증거는 **옛
`design_ref`를 담은 채 낡습니다.** 도구는 이 상태를 미종결로 보고, `req:new`는 그 티켓을 이유로 차단합니다.

이때 `req:new`의 차단 메시지가 **그 티켓에 실제로 적용되는 명령**을 함께 출력합니다.

```text
🔴 미종결 durable 티켓이 있어 새 REQ를 만들 수 없습니다(HEAD 커밋 증거 기준):
  - REQ-2026-088: developing — 미종결 durable 티켓(developing) …
      설계 재승인으로 앞선 phase의 결속이 끊겼습니다(2개) — 재결속하면 종결됩니다.
      npx commitgate req:rebind REQ-2026-088 --phase phase-0 --confirm "rebind REQ-2026-088 phase-0" --run
```

- 끊긴 phase가 **전부 재결속 가능**하면 위처럼 `req:rebind`를 안내합니다. 이때 `req:close --migrate`는
  **거부하고 같은 안내를 냅니다** — 사람 확인을 거치는 강한 경로가 살아 있는데 사후 스탬프로 우회하면,
  감사 기록에서 "사후 확인"과 "자기증명 종결"이 구별되지 않기 때문입니다.
- 끊긴 phase 중 하나라도 `phase_design_ref`가 없으면(그 필드 도입 이전 승인) 재결속으로는 닫을 수 없으므로
  `req:close --migrate`를 안내하고, 그 경로가 실제로 종결합니다.

> 예전에는 이 상태에서 **지원 명령 3개가 모두 거부**했습니다(`--migrate`는 낡은 완료 증거를 보고 "이미
> 종결"이라며 아무것도 하지 않았습니다). 종결 여부를 판정하는 술어가 두 곳에서 서로 달랐던 것이 원인이고,
> 지금은 한 함수를 공유합니다.

**`req:close --migrate`와 다릅니다.** 그건 자기증명이 불가능한 **레거시 티켓**을 운영자가 사후 확인해
종결하는 escape hatch이고 `reconstructed: true`로 기록됩니다. 정상 흐름에서 매번 그것을 쓰면 기록이
"사후 확인"으로 남아 자기증명 종결과 구별되지 않습니다.

> **실측**: REQ-2026-066·067은 설계를 각각 4회 재승인해 종결이 막혔고, 재승인이 0회인 REQ-2026-068은
> 그대로 `dev-complete`로 자가 종결했습니다. 차이는 재승인 횟수뿐입니다.

## HIGH 위험 티켓의 사람 확인

위험도가 `HIGH`인 티켓은 **`stopGate`가 정한 지점을 사람 확인 없이 넘지 못합니다.** 커밋마다 확인받는다는 뜻이 **아닙니다** — 아래 표의 지점에서만 요구합니다.

| `stopGate` | 확인 지점 | 확인 `scope` |
|---|---|---|
| `phase` | 매 phase 커밋 전 | `phase` |
| `req` | **REQ를 완성시키는 커밋** | `req` |
| `merge` (묶음에 속함) | `delivery integrate` | `delivery` |
| `merge` (묶음 없음) | **`req:next` 종단**(통합 직전) | `req` |

```sh
npx commitgate req:confirm 2026-071 --scope req --method "<무엇을 근거로 승인했는지>" --run
```

🔴 **`req`·`delivery` 범위는 아직 작성되지 않은 변경까지 미리 승인합니다.** `--scope req`는
"이 REQ의 남은 phase 전부"를, `--scope delivery`는 "이 묶음의 남은 REQ 전부"를 승인한다는 뜻입니다.
매 변경을 보고 승인하고 싶다면 `stopGate: "phase"`를 쓰세요.

🔴 **범위는 크기 순서가 아니라 진술입니다.** 각 지점은 자기 `scope`와 **정확히 일치**하는 확인만
받습니다 — 넓은 확인으로 좁은 지점을 통과할 수 없습니다. 그러면 `phase`가 보장하려던
"매 phase 새 확인"이 확인 한 번으로 사라지기 때문입니다.

🔴 HIGH 티켓도 `req`·`merge` 에서는 **중간 phase 가 자동 커밋**됩니다 — 정지 지점을 `stopGate` 가 단독으로
정하기 때문입니다. 단 `risk_level` 이 `LOW` 도 `HIGH` 도 아니면(누락·오타·`MEDIUM`) 어떤 값에서도
자동 커밋하지 않습니다.

확인은 **그 범위가 닫힐 때 소비**됩니다: `phase`는 커밋마다, `req`는 `dev-complete` 발행 시,
`delivery`는 `delivery approve`에서. 소비되면 다음 범위는 새 확인을 요구합니다.

> 시각은 **실제 시계**에서 읽습니다. 이 명령이 있기 전에는 `state.json`을 손으로 편집해야 했고,
> 그 방식은 타임스탬프를 지어낼 수 있었습니다.

## phase가 너무 크면 리뷰 직전에 알려줍니다

phase 하나의 코드 변경이 임계(기본 8파일)를 넘으면 `req:review-codex`가 **리뷰를 실행하기 직전에** 경고합니다.

```
phase 검수 면적 초과: 코드 변경 14파일 > 8(granularityMaxFiles)
리뷰 라운드는 면적에 비례해 늘어납니다(실측: >8파일 평균 2.4R vs ≤8파일 1.4R).
```

**기본값은 경고이며 리뷰는 그대로 진행됩니다** — 워크플로가 면적 때문에 멈추지 않습니다.
차단이 필요하면 `req.config.json`에 `"granularityGate": "block"`을 명시하세요(그때는 리뷰를 실행하지
않고, attempt·원장·커밋이 하나도 생기지 않아 소모되는 것이 없습니다).

**왜 커밋 직전이 아니라 리뷰 직전인가**: 아끼려는 것이 리뷰 라운드(유료 호출 + 대기 + 부기 커밋)이기
때문입니다. 그리고 이 시점의 시정은 **코드 재작성이 아니라 staging 재구성**이라 쌉니다.
경고만으로도 이 시점이 예전 D18(커밋 직전 · "다음부터 분할 권고")보다 훨씬 실행 가능합니다.

| 선택 | 방법 |
|---|---|
| **A. 지금 나눈다**(권장) | `git restore --staged <뺄 파일들>` — 코드는 한 줄도 안 바뀝니다. 빼낸 파일은 `state.json`의 `phases[]`에 항목을 추가해 다음 phase로 돌립니다 |
| **B. 원래 크다고 선언한다** | `phases[]`의 해당 항목에 `"max_files": 14`. 기계적 일괄 변경처럼 나누는 것이 오히려 검수를 해치는 경우입니다 |

`max_files`는 `state.json`에 남고 그 파일은 커밋되므로 **선언이 기록**됩니다. 값은 1 이상의 정수여야 하고,
그 밖의 값은 거부됩니다(오타로 게이트가 조용히 꺼지지 않도록).

임계는 `granularityMaxFiles`(기본 8)로 바꿉니다. design 리뷰는 영향받지 않습니다.

| `granularityGate` | 동작 |
|---|---|
| `"warn"` (**기본**) | 경고만 내고 리뷰를 진행합니다 — 워크플로가 멈추지 않습니다 |
| `"block"` | 초과하면 리뷰를 실행하지 않습니다. 위 A/B로 해소한 뒤 재실행합니다 |

> 0.13.0은 기본값이 `"block"`이었습니다. 0.13.1에서 **`"warn"`으로 정정**했습니다 — 막다른 길은 아니었지만
> (소모 0 · 탈출구 3개) 자동으로 넘어가지 않는 정지라 자율 워크플로가 끊겼기 때문입니다.
> 정책의 가치는 강도가 아니라 **시점**에 있고, 그 시점은 그대로입니다.

`req:doctor`의 **D18은 WARN 그대로**입니다. 차단(`block`)은 리뷰 전에 하고, 이미 승인받은 phase의 커밋은
막지 않습니다 — 막으면 승인이 소비되지도 커밋되지도 않는 교착이 됩니다.

## 히스토리에서 코드 커밋만 보기

CommitGate는 리뷰 1회·phase 1개마다 원장·증거·상태를 **별도 커밋**으로 남깁니다. 그래야 외부 호출이
실패해도 "시도했다"는 사실이 남습니다. 대가는 히스토리 밀도입니다 — 실측한 어느 구간에서는
108커밋 중 **79개(73%)가 부기 커밋**이었고 실제 코드 커밋은 23개뿐이었습니다.

커밋을 합치면 그 내구성이 깨지므로, 대신 도구가 만든 커밋에 trailer를 답니다.

```
chore(REQ-2026-085): state checkpoint — design 승인

CommitGate-Bookkeeping: true
```

코드 커밋만 보려면:

```bash
git log --oneline --invert-grep --grep=^CommitGate-Bookkeeping:\ true
```

- 이 표식은 **도구가 만든 커밋에만** 붙습니다. 사람이 손으로 쓴 `chore(REQ-…)` 커밋은 그대로 남습니다
  (그래서 subject 규약이 아니라 trailer를 씁니다).
- `req:commit -m "…"`으로 만드는 **여러분의 소스 커밋에는 붙지 않습니다** — 그건 코드 커밋입니다.
- ⚠️ 표식은 **0.13.0 이후 커밋에만** 있습니다. 그 이전 히스토리는 이 필터로 걸러지지 않습니다.

## 종결된 티켓이 아직 병합되지 않았다면 — D25

`req:doctor`가 **종결(`dev-complete`)됐는데 trunk에 도달하지 않은 티켓**을 세어 알립니다.

```
[req:doctor] WARN D25: 종결됐지만 trunk(main)에 없는 티켓 3건: REQ-2026-070, REQ-2026-071, REQ-2026-072 — …
```

쌓이면 각 브랜치가 서로의 조상이 되어 **순서를 바꿔 병합하거나 하나만 되돌릴 수 없게** 됩니다.
그래서 일찍 보이는 것이 중요합니다.

- 판정 근거는 **커밋된 종결 증거**(`responses/ticket-close.jsonl`)가 trunk 트리에 있는가입니다.
  병합 후 브랜치를 지워도 정답이 나옵니다.
- 지금 검사 중인 티켓 자신은 세지 않습니다(방금 끝난 티켓이 trunk에 없는 건 정상입니다).
- **WARN일 뿐 아무것도 막지 않습니다.** 병합 시점은 `stopGate`가 정하고 사람이 실행합니다.
- trunk 이름은 `req.config.json`의 `trunkBranch`(기본 `"main"`)입니다. `null`로 두면 D25가 꺼집니다.
  로컬에 그 ref가 없으면 조용히 통과합니다 — 오탐으로 doctor 출력 전체를 무시하게 만들지 않기 위해서입니다.

## 명령어 요약

| 명령 | 용도 |
|---|---|
| `npm install -D commitgate` | **런타임 설치 (선행 필수)** — 실행 코드가 `node_modules/commitgate`에 들어옵니다 |
| `npx commitgate init` | 프로젝트에 설정·계약·스키마와 `req:*` 스크립트 설치 |
| `npx commitgate init --dry-run` | 파일을 쓰지 않고 설치 계획 확인 |
| `npx commitgate init --strict` | 정합성 경고를 설치 실패로 처리 (gitignore된 계약 포인터, 설치 커밋을 안전하게 만들 수 없는 워킹트리 등) — 파일을 하나도 쓰기 전에 중단 |
| `npx commitgate init --no-agent-entrypoints` | `.claude/`·`.cursor/`·`CLAUDE.md` 설치 건너뛰기 |
| `npx commitgate sync [--apply] [--persona]` | 업그레이드 후 vendored **스키마 축**(machine·req.config schema)을 설치 패키지 사본으로 재동기화 (기본: 계획만). `--persona`는 페르소나 **부재 복원만**(사용자 수정본 미훼손). 자세히는 [업그레이드 (0.x)](./upgrade.md) |
| `npx commitgate quickstart [--apply]` | 기존 `CLAUDE.md`/`AGENTS.md`의 **commitgate 관리 블록**(`quickstart`·`autonomy`)을 멱등 동기화(기본: 계획만). 블록만 삽입/교체·나머지 바이트 보존·파일당 1회 쓰기. `AGENTS.md`는 계약 마커 있을 때만. 마커가 손상됐으면 **쓰지 않고** 알림. seed-once라 기존 파일에 안 닿는 블록을 백필 |
| `npx commitgate migrate [--apply]` | 예전 vendored 설치본 → 런타임 패키지 전환 (기본: 계획만, 비파괴) |
| `npx commitgate uninstall` | 제거 계획 확인 (읽기 전용 — 아무것도 지우지 않음) |
| `npm uninstall -D commitgate` | 런타임 제거 |
| `npm run req:new -- <slug> --run [--successor-of <REQ-id>]` | REQ 티켓, 브랜치, 설계문서 생성. `--successor-of`는 대체 REQ (아래 참조) |
| `npm run req:next -- <id> [--json]` | **다음 행동 계산** (읽기 전용) |
| `npm run req:review-codex -- <id> --kind design --run` | 설계 리뷰 |
| `npm run req:review-codex -- <id> --kind phase --phase <p> --run` | 구현 리뷰 |
| `npm run req:doctor -- <id>` | 게이트 상태 확인 |
| `npm run req:commit -- <id> --run -m "message"` | 승인된 변경 커밋 |
| `npm run req:rebind -- <id> --phase <p> --confirm "<문구>" --run` | 설계 재승인 뒤 앞선 phase를 현재 설계에 재결속 (위 참조) |
| `npm run req:confirm -- <id> --scope <s> --method "<문구>" --run` | HIGH 위험 티켓의 사람 확인 기록 (위 참조) |

`req:*`는 PATH에 잡히는 실행 파일이 아니라 **`package.json` 스크립트**입니다. npm은 인자 전달에 `--` 구분자가 필요합니다.

```sh
npm  run req:next -- 2026-002    # npm
pnpm req:next 2026-002           # pnpm
yarn req:next 2026-002           # yarn
```

**대체 REQ (`--successor-of`)**: 어떤 review series가 미수렴이라고 판단해 사람이 그것을 `human-resolution`으로 **대체(replace)** 종결한 경우에만, `req:new --successor-of <REQ-id>`로 부모 이력(시도 합계·종결 기록)을 보존한 대체 REQ를 만들 수 있습니다. 부모에 유효한 replace 종결 기록이 없으면 티켓 생성이 fail-closed로 막힙니다 — 일반적인 새 REQ 생성 자체를 도구가 막는 것은 아닙니다.
