# 문제 해결 (FAQ)

**설치할 때 `EBADENGINE Unsupported engine` 경고가 뜨거나 설치가 실패합니다.**
Node 버전이 요구를 못 맞춘 것입니다. CommitGate 0.12.0부터 **Node 20 이상**이 필요합니다(`engines: >=20`).

```text
npm warn EBADENGINE   required: { node: '>=20' },
npm warn EBADENGINE   current: { node: 'v18.20.4', npm: '10.7.0' }
```

기본 설정에서는 **경고만 뜨고 설치는 됩니다**(동작은 보장하지 않습니다). `--engine-strict`나
`.npmrc`의 `engine-strict=true`가 있으면 **설치가 실패**합니다(`npm error code EBADENGINE`).

해결: **Node 20 이상으로 올리세요.** 지금 올릴 수 없다면 `commitgate@^0.11`에 머무를 수 있지만,
🔴 **macOS + Node 18 조합에서 테스트 스위트가 간헐적으로 멈추는 문제는 0.11에도 그대로 있습니다** —
그 문제는 어느 버전에서도 고쳐지지 않았고, 0.12는 그 조건을 지원 대상에서 뺀 것입니다.
자세한 선택지는 [업그레이드](./upgrade.md)의 "0.11 → 0.12" 절에 있습니다.

**Codex CLI가 없으면 어떻게 되나요?**
리뷰 명령이 실패합니다. 조용히 승인 처리하지 않습니다.

**`setup을 아직 마치지 않았습니다`라며 `req:new`가 막힙니다.**
신규 설치에서 `commitgate setup`을 거치지 않은 상태입니다. **사용자가 터미널에서 직접** 실행해야 합니다 —
대화형 전용이라 에이전트가 실행하면 비-TTY로 즉시 종료합니다.

```sh
npx commitgate setup
```

메시지에 **판정 근거**(마커·유효 티켓 수·설치 신호)가 함께 나옵니다. 진단은 언제든 `npx commitgate check`로
할 수 있습니다 — 이 명령과 `req:doctor`는 막히지 않습니다.

**이미 CommitGate를 쓰던 프로젝트인데 막힙니다.**
기존 설치본 예외는 **유효한 티켓 ≥ 1 이고 설치 신호 ≥ 2**일 때 적용됩니다([설정](./configuration.md#setup-완료-마커)).
`workflow/REQ-*` 디렉터리가 있어도 `state.json`이 없거나 그 `id`가 디렉터리명과 다르면 **유효 티켓으로 세지
않습니다**(복사된 껍데기로 예외를 얻는 구멍을 막기 위해서입니다). 실제 설치본이라면 setup을 한 번 실행하는
것이 가장 빠른 해결입니다.

**리뷰가 로그인 문제로 멈춥니다 — 예산이 깎였나요?**
아니요. 0.9.11부터 리뷰 호출 **직전**에 리뷰어 설치·로그인을 확인하고, 미로그인이면 **예산을 차감하기 전에**
멈춥니다. 원장에도 아무 기록이 남지 않습니다. 메시지가 그 사실을 함께 알려 줍니다.
사용자가 터미널에서 `npx commitgate setup`(대화형) 또는 `codex login`을 실행하면 됩니다.

**"로그인 상태를 판정할 수 없습니다" 경고가 나오는데 리뷰는 진행됩니다. 고장인가요?**
아닙니다. **의도된 동작**입니다. 로그인 판정은 리뷰어 CLI의 출력 문자열을 읽어 하는데, 그 형식이 바뀌면
판정이 `unknown`이 됩니다. 이때 **차단하지 않는** 이유는 오탐 비용이 비대칭이기 때문입니다 —
잘못 통과시키면 호출이 스스로 실패할 뿐이지만(예산 1회), 잘못 차단하면 리뷰어 출력 변경 하나로
**모든 사용자의 모든 리뷰가 동시에 멈춥니다**. auth 확인은 승인 무결성 게이트가 아니라 **진단**입니다.

**리뷰가 `codex 종료 코드 1`로 죽습니다. 원인이 뭔가요?**
리뷰를 다시 돌리기 전에 **먼저 진단하세요** — 그 실패는 subprocess가 기동은 했다고 보므로
`dispatched`로 분류되어 **리뷰 예산까지 차감**합니다.

```sh
npx commitgate check
```

`C2`(CLI 설치)·`C3`(로그인)가 원인을 가려 줍니다. 미로그인이면 `npx commitgate setup`(대화형) 또는
`codex login`으로 해결하고, `C3`가 **WARN(판정 불가)** 이면 로그인 자체는 막지 않습니다 — codex의
`login status` 출력 형식이 달라졌을 뿐일 수 있으므로 리뷰를 그대로 시도해도 됩니다.

> `check`는 **읽기 전용**입니다. 아무것도 고치지 않고, 어떤 게이트에도 배선되지 않습니다 —
> 진단 결과가 나쁘다고 해서 기존 명령이 새로 막히지 않습니다.

**승인 후 코드를 조금 고치면 커밋되나요?**
안 됩니다. 승인된 staged tree와 달라지면 stale 승인으로 보고 다시 리뷰를 요구합니다.

**`state.json`이나 `responses/`는 왜 stage하면 안 되나요?**
워크플로 증거와 상태 파일입니다. source 커밋에 섞이면 승인 바인딩이 흐려지므로 `req:commit`이 막습니다.
도구가 알아서 별도 부기 커밋(evidence-finalize·state checkpoint)으로 남기므로 **사용자가 stage할 일이 없습니다.**

**phase 리뷰가 "승인해도 커밋할 수 없는 staged 구성입니다"라며 시작조차 안 됩니다.**
`git add -A`처럼 경로를 넓게 잡아 `state.json`(또는 `responses/` 아래 파일)이 인덱스에 들어간 상태입니다.
안내에 적힌 경로를 unstage하면 됩니다. **리뷰는 실행되지 않았으므로 예산도 깎이지 않았습니다.**

```sh
git restore --staged -- workflow/REQ-2026-001/state.json
```

unstage한 파일이 **수정된 채로 남아도 괜찮습니다** — `state.json`과 리뷰 원장은 D10이 스크래치로
관용합니다. 여기서 걱정이 되어 다시 `git add` 하면 원래 문제로 돌아갑니다.

🔴 **0.15.0 이하에서는 이 상황이 리뷰를 통과했고, 그 결과가 복구 불가능했습니다.** 승인은
`git write-tree`(인덱스 전체)에 묶이는데 `req:commit`은 "승인 tree와 일치할 것"과 "`state.json`·
`responses/`가 staged가 아닐 것"을 **동시에** 요구합니다. `state.json`이 승인 tree에 들어가면 유지해도
빼도 통과할 수 없고, 승인 행이 `approvals.jsonl`에 기록되지 못해 **티켓 자체가 종결 불가**가 됐습니다
(그 티켓 하나가 저장소 전체의 `req:new`를 막습니다). 그래서 이제 **리뷰를 시작하기 전에** 막습니다.

**cross-spawn 버전 경고가 나오면 어떻게 하나요?**
대상 프로젝트의 기존 `cross-spawn`이 CommitGate가 검증한 하한보다 낮을 수 있다는 뜻입니다. `npm i -D cross-spawn@^7.0.6`으로 올리세요. CI나 보안 민감 환경에서는 `npx commitgate --strict`를 사용해 경고를 실패로 다루세요.

**두 번 설치하면 덮어쓰나요?**
아니요. 기존 파일은 건너뜁니다. `--force`는 kit이 관리하는 **복사 자산**(스키마·`.claude`/`.cursor` 진입점 포인터)만 강제 갱신합니다. **수정한 스킬·`AGENTS.md`·`CLAUDE.md`·`workflow/.gitignore`는 `--force`로도 덮지 않습니다**(사용자 파일 보존 — [보장과 한계](./guarantees.md)·[에이전트 진입점](./agent-prompt.md) 참조).

**`req:doctor`가 `workflow/.review-calls.jsonl` 때문에 D10 FAIL을 내며 커밋이 전부 막힙니다.**
0.9.6 이하로 설치한 저장소에서 발생합니다. 리뷰 측정 로그(`workflow/.review-calls.jsonl`)는 `req:review-codex`가 저장소 루트에 남기는 스크래치인데, 그 버전의 배포 템플릿에 무시 규칙이 빠져 있어 `??`로 남고 D10이 클린 트리 위반으로 판정합니다. `workflow/.gitignore`에 누락 규칙을 보강하세요:

```
npx commitgate sync --gitignore --apply
```

기존 행은 변경·재정렬하지 않고 **없는 규칙만 말미에 추가**합니다(이미 있으면 아무것도 하지 않습니다). 0.9.7 이상에서는 `req:doctor`가 이 상황을 **D22 WARN**으로 미리 알려 줍니다(경고일 뿐 커밋을 막지 않습니다).

**이미 `workflow/.review-calls.jsonl`을 커밋해 버렸습니다.**
무시 규칙만 추가해서는 빠지지 않습니다 — git은 **이미 추적 중인 파일**을 `.gitignore`로 제외하지 않기 때문입니다. 추적에서만 제거하고(로컬 파일은 남습니다) 규칙을 유지하세요:

```
npx commitgate sync --gitignore --apply
git rm --cached workflow/.review-calls.jsonl
git commit -m "chore: stop tracking review-call measurement log"
```

이 로그는 측정 전용이라 커밋 대상이 아닙니다. 승인 원장(`responses/approvals.jsonl`)과 승인 아카이브는 이와 무관하게 계속 커밋됩니다.

**`req:next`가 `BLOCKED`을 내며 "커밋된 design 승인 증거가 완비되지 않았다"고 합니다.**
모든 phase가 끝났지만 **설계 승인 증거가 커밋 이력에 남지 않은** 상태입니다. 이대로 통합하면 fresh clone에 "설계가 리뷰·승인됐다"는 증거가 전혀 남지 않습니다. 안내된 복구 명령을 실행하세요:

```
npm run req:commit -- <REQ-id> --finalize-design --run
```

멱등입니다 — 이미 커밋돼 있으면 아무것도 하지 않고, 승인 직후 커밋만 실패한 상태라면 **중복 기록 없이 다시 커밋**합니다. 0.9.8부터 정상 경로에서는 `req:review-codex --kind design --run`이 승인 시 증거를 **자동으로 커밋**하므로 이 명령이 필요한 경우는 그 커밋이 실패했을 때뿐입니다.

게이트는 `HEAD`의 Git blob만 보고 판단하므로, **워킹 트리만 고쳐서는 해소되지 않습니다** — 반드시 커밋돼야 합니다. BLOCKED 사유는 무엇이 어긋났는지 구체적으로 알려 줍니다:

| 사유 | 뜻 |
|---|---|
| `state.json 없음` · `파싱 실패` · `phases가 배열이 아님` | 커밋된 티켓 상태를 해석할 수 없다 |
| `approvals.jsonl 없음` · `무결성 실패` | 매니페스트가 없거나 스키마·경로·파일명·SHA 형식이 어긋난다 |
| `design 승인 행이 없음` | 설계 승인이 매니페스트에 기록되지 않았다 |
| `승인 아카이브 SHA 불일치(HEAD ≠ manifest)` | 기록된 SHA와 커밋된 파일 내용이 다르다 |
| `archive_inventory가 비어 있음` | 라운드 증거가 하나도 기록되지 않았다 |
| `HEAD의 design 아카이브가 archive_inventory에 빠져 있음` | needs-fix 등 일부 라운드가 누락됐다 |
| `archive_inventory에 HEAD에 없는 항목이 있음` | 목록에 커밋되지 않은 경로가 섞였다 |

> 이 검사는 **`req:next`의 완료 판정에서만** 동작합니다. `req:doctor`나 일반 `req:commit`은 이것 때문에 실패하지 않습니다 — 기존 저장소의 커밋을 막지 않기 위한 의도적 경계입니다. 0.9.8 이전에 만들어진 티켓은 검사 대상이 아닙니다(기존 동작 유지).

**design 리뷰가 needs-fix를 반복했는데 그 응답들도 남나요?**
남습니다. 승인 시 매니페스트 행에 `archive_inventory`(각 아카이브의 경로·SHA-256)가 기록되고, **그 목록의 아카이브가 전부 함께 커밋**됩니다. 0.9.8 이전에는 승인본 1건만 커밋돼 needs-fix 라운드가 커밋 이력에 남지 않았습니다.

## 런타임 생성 파일 인벤토리

CommitGate 실행 중 소비 저장소에 만들어지는 파일과 그 처리 방침입니다.

| 파일 | 생성 위치 | ignore 정책 | init 배포 자산 | sync 소유자 | Git 영속 |
|---|---|---|---|---|---|
| `workflow/.review-calls.jsonl` | 저장소 루트의 `workflow/` | `workflow/.gitignore`의 `/.review-calls.jsonl` | 예(`templates/workflow.gitignore`) | `sync --gitignore` | 아니오(측정 전용) |
| `workflow/REQ-*/codex-response.json` | 티켓 직계 | `/REQ-*/codex-response.json` | 예(동일) | `sync --gitignore` | 아니오(스크래치) |
| `workflow/REQ-*/.review-preview.txt` | 티켓 직계 | `/REQ-*/.review-preview.txt` | 예(동일) | `sync --gitignore` | 아니오(스크래치) |
| `workflow/REQ-*/.codex-*.tmp` | 티켓 직계 | `/REQ-*/.codex-*.tmp` | 예(동일) | `sync --gitignore` | 아니오(임시) |
| `workflow/REQ-*/state.json` | 티켓 직계 | 없음(추적 대상) | 아니오(`req:new`가 생성) | 없음 | 예(스캐폴드만) — 실행 중 변경은 커밋하지 않는 작업 상태 |
| `workflow/REQ-*/responses/*-rNN-*.json` | 티켓 `responses/` | 없음(추적 대상) | 아니오 | 없음 | **예(승인 증거)** |
| `workflow/REQ-*/responses/approvals.jsonl` | 티켓 `responses/` | 없음(추적 대상) | 아니오 | 없음 | **예(승인 원장)** |

> **유지 규칙**: 저장소 루트에 새 런타임 스크래치를 추가할 때는 ① 이 표에 행을 추가하고 ② `templates/workflow.gitignore`에 **앵커형** 규칙을 넣고 ③ `scripts/smoke.mjs`에 그 경로의 `git check-ignore` 단언을 함께 추가한다. smoke 단언은 경로별이라 새 파일을 자동으로 덮지 않는다.
>
> 중첩 `.gitignore`(`workflow/.gitignore`) 규칙은 **그 디렉터리 기준 상대경로**다. 루트 `.gitignore`가 쓰는 `workflow/…` 형태를 복사하면 `workflow/workflow/…`를 찾아 무효가 된다.
