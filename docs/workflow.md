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

> **phase 자동 커밋(opt-in).** 기본값은 매 phase 커밋 전에 `AWAIT_HUMAN`으로 멈춥니다. `req.config.json`에
> `"phaseCommit": { "autoApprove": "low-only" }`를 두면, **LOW 위험** 티켓의 Codex 승인 phase는 사람 정지 없이
> 자동 커밋되고(`req:next`가 `req:commit --run`을 RUN으로 지시), 사람 확인은 **feature→main 병합 직전 한 번**으로
> 모입니다(종단이 `DONE` 대신 `AWAIT_HUMAN`(통합)). **HIGH 티켓은 정책과 무관하게 매 phase 확인**을 유지합니다.
> 이때도 Codex 리뷰 게이트는 그대로입니다 — 제거되는 것은 LOW phase의 *사람 정지*뿐입니다.

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

`req:*`는 PATH에 잡히는 실행 파일이 아니라 **`package.json` 스크립트**입니다. npm은 인자 전달에 `--` 구분자가 필요합니다.

```sh
npm  run req:next -- 2026-002    # npm
pnpm req:next 2026-002           # pnpm
yarn req:next 2026-002           # yarn
```

**대체 REQ (`--successor-of`)**: 어떤 review series가 미수렴이라고 판단해 사람이 그것을 `human-resolution`으로 **대체(replace)** 종결한 경우에만, `req:new --successor-of <REQ-id>`로 부모 이력(시도 합계·종결 기록)을 보존한 대체 REQ를 만들 수 있습니다. 부모에 유효한 replace 종결 기록이 없으면 티켓 생성이 fail-closed로 막힙니다 — 일반적인 새 REQ 생성 자체를 도구가 막는 것은 아닙니다.
