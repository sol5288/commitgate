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

main에 반영하는 경로는 **PR 경유(선택)**와 **direct push** 둘 다 유효합니다. PR은 의무가 아닙니다. 다만 protected branch로 직접 push하면 required checks를 **우회**하므로 "branch protection bypass를 사용한 direct push 승인"을 따로 받아야 합니다 — bypass 권한이 있다는 사실은 승인이 아닙니다. 그리고 이때 CI는 push **이후에** 도는 **사후 검증**이라, 그 사실을 보고에서 생략하지 않습니다. tag, npm publish, GitHub release는 반영과 묶이지 않는 별도 통제점이고 CI green 이후에 요청합니다. 자세한 계약은 [AGENTS.template.md](../AGENTS.template.md)와 [docs/RELEASING.md](../docs/RELEASING.md)를 참고하세요.

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

여러 줄 커밋 메시지는 `-m` 대신 파일을 사용하세요.

```sh
npm run req:commit -- 2026-001 --run --message-file commit-message.txt
```

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
- 브랜치 위치에 의존하지 않습니다 — 도구가 필요한 곳으로 옮겼다가 **원래 브랜치로 되돌립니다**.

`stopGate: "merge"` 를 켜면 `req:next` 종단도 묶음을 봅니다: 묶음이 아직 열려 있으면 `DONE`(다음 REQ를
열 수 있다), 닫혔고 모든 member가 종결됐으면 `AWAIT_HUMAN`. 같은 판정을 `integrate`와 `seal`도
전이 직후에 냅니다 — 마지막 `integrate` 뒤에 `seal` 한 사용자는 `req:next`를 다시 부를 이유가 없기 때문입니다.

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
| `merge` | `delivery integrate` | `delivery` |

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

## 명령어 요약

| 명령 | 용도 |
|---|---|
| `npm install -D commitgate` | **런타임 설치 (선행 필수)** — 실행 코드가 `node_modules/commitgate`에 들어옵니다 |
| `npx commitgate init` | 프로젝트에 설정·계약·스키마와 `req:*` 스크립트 설치 |
| `npx commitgate init --dry-run` | 파일을 쓰지 않고 설치 계획 확인 |
| `npx commitgate init --strict` | 정합성 경고를 설치 실패로 처리 (gitignore된 계약 포인터, 설치 커밋을 안전하게 만들 수 없는 워킹트리 등) — 파일을 하나도 쓰기 전에 중단 |
| `npx commitgate init --no-agent-entrypoints` | `.claude/`·`.cursor/`·`CLAUDE.md` 설치 건너뛰기 |
| `npx commitgate sync [--apply] [--persona]` | 업그레이드 후 vendored **스키마 축**(machine·req.config schema)을 설치 패키지 사본으로 재동기화 (기본: 계획만). `--persona`는 페르소나 **부재 복원만**(사용자 수정본 미훼손). 자세히는 [업그레이드 (0.x)](./upgrade.md) |
| `npx commitgate quickstart [--apply]` | 기존 `CLAUDE.md`/`AGENTS.md`에 Quick Start 블록을 멱등 주입(기본: 계획만). 관리 블록만 삽입·나머지 보존. `AGENTS.md`는 계약 마커 있을 때만. seed-once로 기존 파일에 안 닿는 [REQ-2026-039]를 백필 |
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
