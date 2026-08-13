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
| `reviewReasoningEffort` | `"medium"` | codex 리뷰 추론강도. `none`·`minimal`·`low`·`medium`·`high`·`xhigh` 중 하나. `null`이면 전역 상속 |
| `reviewBudget` | `{ "autoBudget": 5, "hardCap": 8, "onSoftLimit": "ask" }` | 열린 `(review_kind, phase_id)` review series의 재리뷰 시도 예산. 기본값 기준 1~5회차는 자동. 6~8회차는 `onSoftLimit`이 정한다 — `"ask"`(기본)면 회차마다 그 series·회차에 바인딩된 사람 예외 기록이 있어야 진행하고, `"auto"`면 사람 승인 없이 진행하며 원장에 정책 근거를 남긴다. `hardCap` 회를 이미 소진하면 그 다음 시도(9회차부터)는 **두 값 모두에서** 차단. `hardCap ≤ 8`·`autoBudget ≤ hardCap`. 자세히는 [리뷰 예산](#리뷰-예산--reviewbudget) |
| `stopGate` | `"req"` | **커밋·통합에서 사람이 멈추는 지점을 정합니다**(권장 축). 🔴 리뷰 예산(`reviewBudget.onSoftLimit`)은 **별개의 축**이라, 이 값과 무관하게 재리뷰가 예산을 넘기면 따로 멈출 수 있습니다. `phase`=매 phase 커밋 전 확인 · `req`=REQ 안의 phase는 자율 커밋하고 확인을 **REQ를 완성시키는 커밋**으로 모음 · `merge`=여러 REQ를 delivery set으로 묶어 **묶음 전체가 끝날 때까지** 미룸(🔴 **묶음이 없으면 `req`처럼** 이 REQ의 통합 직전에 멈춥니다 — 이 값을 골랐다고 정지가 없어지지 않습니다) · `auto`=`merge`와 같되 **유효한 사전 위임이 있으면** 통합에서도 멈추지 않음(위임이 없으면 그대로 멈춥니다 — 아래 [`stopGate: "auto"`](#stopgate-auto--사전-위임-범위-안의-검증된-변경만-자동-통합합니다)). 위험도(`HIGH`)를 포함한 확인 지점 상세는 [워크플로 — HIGH 위험 티켓의 사람 확인](workflow.md#high-위험-티켓의-사람-확인)이 정본입니다. 통합(main 병합) 승인은 어느 값에서나 필요합니다 |
| `githubCi` | 미설정 (`null`) | `integrate`에서 사용자가 명시적으로 요청할 때 실행할 GitHub Actions 워크플로. 미설정이면 CI 실행을 묻지도, 추측해서 실행하지도 않습니다 |
| `phaseCommit` *(deprecated alias)* | `{ "autoApprove": "low-only" }` | phase 자동 커밋 정책. **`low-only`가 기본**이며 Codex 승인 phase를 사람 정지 없이 자동 커밋하고 사람 확인을 뒤로 모은다. `never`를 **명시하면** 매 phase 커밋 전에 사람이 확인한다. `"all"` 같은 값은 없다 — 의미 축은 `stopGate`이고, alias에 값을 늘리면 두 축이 또 갈라진다 |

빈 `branchPrefix`나 프로젝트 밖으로 나가는 경로는 거부됩니다.

### `stopGate`와 `phaseCommit`

`stopGate`가 **의미 축**이고 `phaseCommit.autoApprove`는 그것의 **deprecated alias**입니다. 매핑은 1:1입니다.

| `stopGate` | `phaseCommit.autoApprove` |
|---|---|
| `phase` | `never` |
| `req` | `low-only` |
| `merge` | `low-only` |
| `auto` | `low-only` |

- 둘 중 **하나만** 쓰면 나머지는 자동으로 파생됩니다. 기존에 `phaseCommit`만 쓰던 설정은 **그대로 동작**합니다.
- 둘 다 썼는데 **모순**이면 거부되고, 오류가 두 값·기대 매핑·해결 방법을 알려 줍니다.
- `commitgate setup`으로 `stopGate`를 고르면 legacy `phaseCommit` 키는 **자동으로 제거**됩니다
  (두 축이 모순인 파일이 남으면 이후 모든 명령이 막히기 때문입니다).
- 🔴 `merge`와 `req`는 **`phaseCommit.autoApprove`가 같습니다**(둘 다 phase는 자율 커밋). 그래서 legacy
  `phaseCommit`만 있는 설정은 보수적으로 `req`로 해소됩니다 — `merge`를 쓰려면 `stopGate`를 명시하세요.
- `merge`는 [delivery set](workflow.md#delivery-set--여러-req를-한-묶음으로)과 함께 쓸 때 **여러 REQ의 정지를
  묶음 하나로 미룹니다**. 묶음이 없으면 이 값은 `req`처럼 동작합니다 — `req:next` 종단이
  `AWAIT_HUMAN`(통합 feature→main)입니다.
- 어느 값이든 **phase 커밋에서는 멈추지 않고**(`phase` 제외) 정지는 종단에 모입니다. 다만 종단의 통제점 수는
  위험도에 따라 다릅니다: `LOW`는 통합 승인 **한 번**, `HIGH`는 `req:confirm` 기록 **뒤에** 통합 승인이라
  **두 번**입니다(`req`도 같습니다 — 확인 지점만 커밋에서 종단으로 옮겨진 것입니다).

### 리뷰 예산 — `reviewBudget`

```jsonc
"reviewBudget": { "autoBudget": 5, "hardCap": 8, "onSoftLimit": "ask" }
```

- `autoBudget`(기본 5): 여기까지는 사람 개입 없이 리뷰가 반복됩니다.
- `hardCap`(기본 8): **절대 호출 상한**. 9회차는 어떤 경로로도 실행되지 않습니다.
- `onSoftLimit`(기본 `ask`): `autoBudget`을 넘겼을 때 무엇을 할지.
  - `ask`: 6~8회차마다 `req:review-exception` 사람 승인이 필요합니다(현행).
  - `auto`: 사람 승인 없이 `hardCap`까지 진행하고, 원장에 **정책으로 통과했다는 사실**을 남깁니다.

#### `auto`가 없애는 것과 남기는 것

**없애는 것은 하나뿐입니다**: `autoBudget`을 넘긴 회차의 **사람 예외 승인**.

| 남는 정지 | 왜 |
|---|---|
| `hardCap` 도달 | **반복 백스톱** — 아래 참조 |
| 리뷰 `BLOCKED`(exit 2) | 리뷰어가 판정 자체를 못 한 상태입니다. 재시도가 답이 아닙니다 |
| 리뷰 승인(`findings` 0건) 요구 | 예산 축과 무관한 게이트입니다 |
| HIGH 사람 확인(`req:confirm`) | `stopGate`가 정하는 축입니다 |
| 통합·릴리즈 통제점(I1/I2/B1 · R1/R2/R3) | 어느 설정에서도 남습니다 |

🔴 **"자동 진행"은 리뷰를 건너뛰는 것이 아닙니다.** `auto`에서도 승인 없는 phase는 커밋되지 않습니다 —
바뀌는 것은 "한 번 더 돌려도 되는가"라는 **예산 질문**뿐입니다.

- `auto`에서는 `req:review-exception`이 예외를 **부여하지 않습니다** — 소비될 일이 없는 승인 기록을
  만들지 않기 위해서입니다. 사람 승인을 원하시면 `ask`로 두세요.
- 기존에 `{"autoBudget":3,"hardCap":6}`처럼 두 키만 쓰던 설정은 **그대로 유효**하고 `onSoftLimit`는
  `ask`로 채워집니다.

#### `hardCap`은 비용 상한이 아니라 반복 백스톱입니다

`autoBudget`은 "여기까지는 묻지 않는다"는 **비용** 축이고, `hardCap`은 "이 이상은 어떤 경로로도 돌지
않는다"는 **반복** 축입니다. 두 값은 같은 종류가 아닙니다.

- 기준이 다릅니다: `autoBudget`은 **판정을 낸 회차**(productive)를 세고, `hardCap`은 **나간 호출
  수**(dispatched)를 셉니다. 판정이 없던 회차(리뷰어 계약 위반 등)도 `hardCap`에서는 빠지지 않으므로,
  유효 리뷰를 `hardCap`번 받지 않고도 도달할 수 있습니다 — 무한 재시도를 막는 것이 목적이기 때문입니다.
- `hardCap`회(기본 8)를 쓰고도 끝나지 않았다면 필요한 것은 한 번 더가 아니라 **설계·분해의 재검토**입니다.
- 그래서 `auto`가 이 정지를 열지 않는 것은 **누락이 아니라 설계**입니다.

#### `stopGate: "auto"` — 사전 위임 범위 안의 **검증된** 변경만 자동 통합합니다

**"무제한 자동 실행"이 아닙니다.** 이 값을 고르는 것만으로는 아무 권한도 생기지 않습니다 —
권한은 설정이 아니라 **레코드**(`workflow/delegations.jsonl`)에서 나옵니다. 위임이 없으면 `merge`와
똑같이 통합 직전에 멈춥니다.

| | 설정(`stopGate: "auto"`) | 레코드(사전 위임) |
|---|---|---|
| 무엇을 정하나 | 어느 **모드**로 도는가 | 무엇을 **해도 되는가** |
| 어떻게 바뀌나 | 파일 편집 | 사람 승인 문장 → `req:delegate`가 기록 |
| 없으면 | — | **통합이 막힙니다** |

```sh
npx commitgate req:delegate --scope ticket:2026-140 --source feat/req-2026-140-x \
  --sentence "<사람이 말한 승인 문장 그대로>" [--allow-push] [--allow-bypass] [--high-risk] --run
npx commitgate req:delegate --status                      # 지금 무엇이 위임돼 있나
npx commitgate req:delegate --revoke <id> --reason "..." --run   # 철회
```

시각·SHA·만료는 **도구가 읽습니다** — 사람이 적을 자리가 없습니다(REQ-2026-019 폐기 사유).
만료는 기본 12시간이고 상한이 72시간입니다. 무기한 위임은 만들 수 없습니다.

**위임이 있어도 다음은 그대로 막습니다.**

| 막는 것 | 왜 |
|---|---|
| `hardCap` 도달 | 비용 상한은 자율 모드에서도 무한화되지 않습니다 |
| HIGH 위험(별도 위임 없음) | `--high-risk`로 명시 위임해야 합니다 |
| BLOCKED·미판정 리뷰 | 판정이 끝나지 않은 변경은 통합하지 않습니다 |
| trunk가 움직임 / 대상 브랜치가 다름 | 위임은 **그 기준선에 대한** 위임입니다 |
| 위임 대상 밖 티켓·delivery가 범위에 섞임 | 식별자를 적었으면 그 범위를 실제로 지킵니다 |
| 귀속을 판정할 수 없는 커밋 · attested 커밋 | 차단 지점에서 "모르겠음"은 통과가 아닙니다 |
| 이미 소비·철회·만료된 위임 | 권한은 **정확히 한 번**만 쓰입니다 |

**비용**: `auto`는 리뷰 호출을 줄이지 않습니다. 사람이 기다리지 않을 뿐 Codex 리뷰는 그대로 돌고
그만큼 사용량이 발생합니다. 재리뷰 예산은 `reviewBudget`가 따로 정합니다(위 [리뷰 예산](#리뷰-예산--reviewbudget)).

**push·bypass는 기본 불허입니다.** `--allow-push` 없이는 로컬 병합까지만 하고 push하지 않습니다.
push를 위임했다면 `--allow-bypass`도 필요합니다 — 병합으로 만들어진 merge SHA는 required check가
돌아간 적이 없어 **push 자체가 우회**이기 때문입니다. 우회를 실제로 썼다면 그 사실이 원장(`executed` 행)과
최종 보고에 남습니다.

🔴 **도구가 보장하지 못하는 것**: 승인 문장이 실제로 사람에게서 왔는지는 검증할 수 없습니다.
`req:confirm`과 같은 한계이며, 도구가 보장하는 것은 **시각·SHA·만료·소비의 정직성**입니다.

#### 이미 쓰던 프로젝트가 `auto`로 올라가려면

`stopGate`를 `req`·`merge`로 두고도 리뷰 6회차에서 멈춘다면 이 축이 아직 `ask`입니다. 둘 중 하나로 바꿉니다.

```sh
npx commitgate setup      # 네 번째 질문에서 고릅니다(사람이 터미널에서 실행)
```

또는 `req.config.json`을 직접 편집합니다.

```jsonc
"reviewBudget": { "autoBudget": 5, "hardCap": 8, "onSoftLimit": "auto" }
```

예산 정지를 실제로 만나면 `req:next`가 그 자리에서 이 방법을 함께 안내합니다(`hardCap` 도달에는 안내하지
않습니다 — 그 정지는 설정으로 열리지 않기 때문입니다).

### 정책 스냅샷 — 티켓은 만들어질 때의 `stopGate`로 끝까지 간다

`req:new`는 그 시점의 `stopGate` 해소값을 티켓의 `state.json`(`policy_snapshot.stop_gate`)에 **고정**하고,
게이트(`req:next`·`req:commit`·`req:confirm`·`req:doctor`·`delivery integrate`)는 그 값을 봅니다.

🔴 **파생 축도 함께 동결됩니다.** `phaseCommit.autoApprove`(phase 자동 커밋 여부)는 `stopGate`에서 파생되는
값인데, 그것만 현재 config에서 읽으면 **한 티켓이 두 정책으로 판정**됩니다 — 커밋 게이트는 통과시키는데
`req:next`는 멈추라고 하는 상태입니다. 두 축은 항상 같은 해소에서 나옵니다.

왜냐하면 게이트가 매번 `req.config.json`을 다시 읽으면 **티켓 하나가 여러 정책으로 진행**되기 때문입니다.
phase-1·2를 `phase`로 확인받고 중간에 설정을 `merge`로 바꾸면 나머지는 확인 없이 자동 커밋됩니다 —
이미 받은 확인의 의미가 사후에 바뀝니다.

- 설정을 바꿔도 **진행 중 티켓은 영향받지 않습니다.** 새 티켓부터 새 정책으로 시작합니다.
- 차이가 생기면 `req:doctor`가 **D32 WARN**으로 알립니다(FAIL이 아닙니다 — 진행을 막지 않습니다).
- 진행 중 티켓에 새 정책을 적용하려면:

  ```sh
  npx commitgate req:repolicy <REQ> --reason "<왜 바꾸는가>" --run
  ```

  🔴 게이트 우회가 아닙니다. 바뀌는 것은 "어디서 멈추는가"뿐이고 **이미 기록된 사람 확인은 지워지지
  않습니다** — 새 정책이 요구하는 `scope`와 다르면 그 지점에서 다시 요구됩니다.
- 스냅샷이 없는 **기존 티켓**(이 기능 이전에 만들어진 것)은 예전처럼 `req.config.json`을 따릅니다.

### 선택적 GitHub CI 실행 — `githubCi`

GitHub Actions 사용량·비용을 사용자가 통제할 수 있도록 **기본값은 미설정**입니다. CI를 실행할
가능성을 열어 두려는 프로젝트만 워크플로 파일명을 직접 적습니다.

```json
{
  "githubCi": {
    "workflow": "ci.yml",
    "timeoutMinutes": 30
  }
}
```

- `workflow`는 `.github/workflows/` 아래의 **파일명 하나**입니다. 경로나 URL이 아니라 `ci.yml`처럼
  적습니다.
- `timeoutMinutes`는 dispatch부터 완료까지 기다리는 전체 시간이며 1~120분, 기본값은 30분입니다.
- 설정을 추가하는 것만으로 CI가 실행되지는 않습니다. 대화형 `integrate --run`에서 `y`로 답하거나,
  비대화형에서 `integrate --run --run-github-ci`를 명시해야 합니다.
- 질문은 `[y/N]`이고 기본값은 No입니다. Enter·빈 입력·`n`은 모두 미실행입니다.
- 설정이 없으면 질문 자체를 생략합니다. `--run-github-ci`를 명시했는데 설정이 없으면 워크플로를
  추측하지 않고 실패합니다.
- GitHub CI를 실행하지 않아도 통합 실패가 아닙니다. 다만 `integrate`의 로컬
  `verify-range --strict`는 항상 실행됩니다.
- 이 설정은 CommitGate가 `workflow_dispatch`로 실행할 대상을 정할 뿐입니다. 저장소 자체 워크플로가
  `push`·`pull_request`·tag에 반응하는지는 `.github/workflows/*.yml`의 실제 트리거를 확인하세요.

기존 결과를 **조회만** 하려면 `verify-range --check-github-ci`를 사용합니다. 조회는 워크플로를 실행하지
않으므로 새 GitHub Actions 사용량을 발생시키지 않습니다. 자세한 실행 순서는
[워크플로 — 통합 seam](workflow.md#통합-seam--commitgate-integrate-022)을 참고하세요.

## 대화형 설정 — `commitgate setup`

리뷰 모델·추론강도·**정지 지점**은 파일을 직접 고치는 대신 마법사로 설정할 수 있습니다.
**codex 로그인까지 함께 처리**합니다.

```sh
npx commitgate setup
```

묻는 것은 넷입니다.

| 질문 | 설정 키 |
|---|---|
| 리뷰 모델 | `reviewModel` |
| 리뷰 추론강도 | `reviewReasoningEffort` |
| 사람이 멈추는 지점 | `stopGate` |
| 리뷰 예산을 넘겼을 때 | `reviewBudget.onSoftLimit` |

🔴 **정지를 만드는 축은 둘입니다.** `stopGate`로 자율 진행을 골라도 리뷰가 예산을 넘기면 따로 멈추므로,
한쪽만 열어 두면 워크플로가 여전히 끊깁니다. 그래서 두 축을 같은 화면에서 함께 묻습니다.
`reviewBudget`의 `autoBudget`·`hardCap`은 **묻지 않고 기존 값을 보존**합니다(파일에서 직접 조정하세요).

- **추론강도·멈춤 지점처럼 값이 정해진 항목은 ↑/↓로 고르고 Enter로 확정**합니다. Ctrl+C로 취소합니다.
  목록의 첫 줄이 **현재 값 유지**이고 커서가 거기서 시작하므로, Enter만 누르면 아무것도 바뀌지 않습니다.
  값을 비울 수 있는 항목에는 **비움 — codex 전역 설정 상속** 항목이 함께 나옵니다.
- **리뷰 모델도 목록**에서 고릅니다(`gpt-5.6-sol` · `gpt-5.6-terra` · `gpt-5.6-luna`). 🔴 이 목록은 enum이
  아니라 **추천**입니다 — 목록 끝의 **"직접 입력…"**으로 어떤 모델이든 쓸 수 있고, 스키마는 자유 문자열
  그대로입니다. 비우려면 직접 입력에서 `-` 를 입력하세요.
- 각 항목은 **현재 값이 기본 답변**입니다. 유지하면 **파일에 기록되지 않습니다** —
  고르지 않은 값이 고정되지 않도록 **건드린 키만** 씁니다.
- codex에 로그인돼 있지 않으면 `codex login`을 실행하고, **끝난 뒤 다시 확인**합니다.
  로그인이 확인되지 않으면 **설정을 저장하지 않습니다** — `req.config.json`은 그대로입니다.
- 저장은 **원자적**입니다(같은 폴더에 임시 파일을 쓰고 교체). 중간에 중단해도 기존 설정이 깨지지 않으며,
  다시 실행하면 이어서 진행할 수 있습니다.
- 저장 후 **`req.config.json`을 커밋하라는 안내**가 나옵니다. 진행 중인 티켓이 있으면 커밋하지 않은
  설정 변경이 `req:doctor`의 D10·D13에 걸립니다.

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
