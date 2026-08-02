<!-- commitgate:contract -->
# AGENTS.md (AI REQ workflow — Codex/Builder 계약)

> 이 파일은 `commitgate`(init)가 대상 repo에 `AGENTS.md`가 없을 때 생성한 **템플릿**이다.
> 프로젝트 고유 규칙(SSOT 경로·포트·참조 프로젝트·phase 문서 등)은 여기에 직접 채워 넣어라.
> Codex CLI는 repo 루트의 `AGENTS.md`를 리뷰 컨텍스트로 읽는다.
>
> ⚠️ 첫 줄의 `<!-- commitgate:contract -->` 마커를 지우지 마라. `.claude/`·`.cursor/` 진입점 파일이
> "이 `AGENTS.md`가 CommitGate 계약인가"를 그 마커로 판별하고, `npx commitgate`도 부재 시 경고한다.

<!-- commitgate:quickstart -->
## CommitGate — 빠른 시작 (첫 요청에서 이대로)

이 저장소의 코드/문서 변경은 CommitGate REQ 워크플로로만 처리한다. 일반 구현으로 바로 커밋하지 않는다.

1. 요청이 [무엇 / 왜 / 제약 / 완료 기준]으로 정리되지 않았으면 **먼저 사용자에게 확인**한다. 추측해서 채우지 않는다.
2. `package.json`의 `req:new` 스크립트와 `req.config.json`의 `packageManager`를 확인해, 이 저장소의
   패키지매니저 실행 형식으로 `req:new <슬러그>`를 실행해 REQ 티켓·브랜치를 만든다. 형식을 추측하지 않는다.
3. 그다음부터 매 단계는 `req:next <REQ-id>`의 출력만 따른다. `kind`가 정본이다:
   - `RUN`         → 출력된 명령을 그대로 실행하고 다시 `req:next`
   - `AGENT`       → 구현·검증·명시적 `git add` 후 다시 `req:next`
   - `AWAIT_HUMAN` → **멈춘다.** 출력된 승인 문장을 그대로 받기 전에는 진행하지 않는다
   - `DONE`        → 이 티켓 종료. 통합·릴리즈는 별도 통제점
   - `BLOCKED`     → 사람에게 보고. **같은 리뷰를 재시도하지 않는다**
4. 리뷰가 `NEEDS_FIX`면 지적(findings)을 고친 뒤 다시 `req:next`로 돌아간다.
5. `state.json`·`responses/`는 직접 `git add` 하지 않는다 — 도구가 관리한다.
6. 커밋은 `req:next`가 `RUN`으로 지시할 때 `req:commit`으로만 한다. 스스로 `req:commit`을 호출하지 않는다.
   직접 `git commit`은 CommitGate 자체 스캐폴딩 산출물(`init`·`migrate`·`sync`가 쓴 파일)을 커밋할 때만 쓴다.
7. 테스트는 phase 진행 중엔 **변경한 소스를 import하는 것만**, **전체 스위트는 통합 직전 1회** 돌린다.
   게이트는 테스트를 실행하지 않는다 — 이건 비용 규칙이다(매 phase 전량은 티켓 시간을 크게 늘린다).
<!-- /commitgate:quickstart -->

> 위는 빠른 시작 요약이다. 아래가 정본 계약(절대 규칙·통제점·승인 문장)이다.

## 역할

- **Builder(Claude 등)**: REQ 티켓 단위로 설계→구현→테스트. `req:new`로 티켓·브랜치 생성.
- **Reviewer(Codex)**: `req:review-codex`가 조립한 프롬프트로 design/phase 리뷰. 구조화 응답(`workflow/machine.schema.json`)만 승인 근거.

## 절대 규칙 (어기면 리뷰에서 reject)

### 1. Test-First
각 phase에서 게이트를 통과시키는 테스트를 먼저 작성(Red) → 최소 구현(Green) → 리팩토링. 테스트 없는 구현은 reject.

#### 1-1. 테스트를 **언제** 돌리는가 (비용 규칙)

🔴 **게이트는 테스트를 실행하지 않는다.** `req:doctor`·`req:commit` 어디에도 테스트를 돌리는 코드가 없고, `req.config.json`에 테스트 설정도 없다. 아래는 게이트 요구가 아니라 **비용 권고**다 — 그러나 지키지 않으면 매 phase마다 전체 스위트를 돌려 REQ 하나에 수십 분이 든다.

| 시점 | 범위 | 목적 |
|---|---|---|
| 구현 중 | 빠른 순수 테스트 | 즉시 피드백 |
| **phase 리뷰 전** | **변경한 소스를 import하는 테스트** | 이 phase의 회귀 |
| **통합(main 병합) 직전 1회** | **전체 스위트** | 권위 판정 |

- 범위 한정은 **빠른 피드백 장치이지 전체 스위트의 대체재가 아니다.** 자동 영향 분석(`vitest --changed` 등)에 기대지 말 것 — 모듈 그래프가 넓은 저장소에서는 전부를 고르거나(느려짐) 놓친 회귀를 통과시킨다.
- 전량 검증을 **통합 직전**에 두는 이유: phase 커밋은 feature 브랜치라 되돌리기 싸고, main 병합은 비싸다. **main에 도달하는 경로에는 전량 검증이 그대로 남는다.**
- 통합 승인은 `stopGate` 값(`phase`/`req`/`merge`)과 무관하게 **항상** 존재하므로, 이 기준점은 설정에 종속되지 않는다.
- 역의존 찾기 예: `grep -rl "<변경한 모듈 경로>" tests/`

### 2. 게이트 통과 전 다음 phase 금지
`req:doctor` PASS + Codex phase 리뷰 승인(STEP_COMPLETE) 전에는 다음 phase로 진입하지 않는다.

### 3. 승인 바인딩(fail-closed) 우회 금지
- staged tree는 승인된 tree와 일치해야 한다(D9). 승인 후 재stage/설계 변경은 stale 승인으로 거부.
- 워킹트리는 리뷰 시점에 clean해야 한다(비-스크래치 unstaged/untracked → D10 FAIL).
- codex 미설치/실패는 silent 처리 금지 — 명확히 fail-closed.
- `req:review-codex` exit 0만 승인이다. exit 3(NEEDS_FIX)은 수정 후 재리뷰, exit 2(BLOCKED)는 같은 리뷰 재시도 금지. BLOCKED가 스레드 고착으로 의심되면 `--fresh-thread`로 1회만 회복 시도, 그래도 BLOCKED면 사람 보고.
- 승인(`commit_approved=yes`)은 `findings`가 0건일 때만이다. 지적이 하나라도 있으면 승인 불가(모순 → 거부). 비차단 코멘트를 `findings`에 섞지 말 것.
- 비차단(사소한/제안성) 코멘트는 optional `observations`(`{detail,file}`, **severity 없음**)에만 넣는다. `observations`는 승인/차단 판정에 영향 없고 승인 시에도 표출된다. `observations`만 있고 `findings`가 비어 있으면 승인 가능(단, `commit_approved=no`면 여전히 BLOCKED — observations는 findings를 대체하지 않음).

### 4. 커밋 정책
- 각 phase는 의미 있는 커밋. "WIP" 금지.
- 커밋 메시지 컨벤션: `test/feat/fix/refactor/docs/chore` 접두사. `[Codex]`/`[Claude]` 같은 메타 정보 금지(Reviewer 편향 방지).
- HIGH 영향 phase가 커밋에서 멈추는 **지점은 `stopGate`가 정한다**(`state.user_commit_confirmed`로 기록).
- **정지 지점은 `req.config.json`의 `stopGate` 하나가 정한다**(`userConfirmGate`):
  `phase`=매 phase 커밋 전 · `req`(기본값)=REQ를 끝내는 커밋 전 · `merge`=커밋에서는 멈추지 않음.
  LOW phase는 파생된 `phaseCommit.autoApprove`가 `low-only`일 때 사람 정지 없이 자동 커밋된다
  (`req:next`가 `req:commit --run`을 RUN으로 지시).
- **통합(main 병합) 승인은 어느 값에서도 필요하다.** 커밋에서 멈추지 않게 설정해도 사람 확인은
  feature→main **통합 통제점**(I1/I2/B1)으로 모인다 — `req:next` 종단이 `DONE`이 아니라
  `AWAIT_HUMAN`(통합)으로 멈춘다.

### 5. 승인 범위 해석 규칙

**승인은 승인받은 문장 그대로만 유효하다.** 한 통제점의 승인은 다음 통제점으로 **이월되지 않는다**.

- `PR 생성 승인`은 `PR merge 승인`이 아니다.
- `merge/push 승인`은 `required status checks bypass 승인`이 아니다.
- 통합 승인은 릴리즈 승인이 아니고, `tag` 승인은 `publish` 승인이 아니다.
- **권한이 있다는 사실은 승인이 아니다.** protected branch를 우회할 권한이 있어도, 우회하려면 그 우회 자체를 승인받아야 한다.
- 승인 문장이 모호하면 확대 해석하지 말고 **다시 묻는다**.

> PR을 생략할 수 있다는 것과, 우회를 보고하지 않아도 된다는 것은 다르다. 경로는 선택이지만 **투명성은 선택이 아니다.**

### 6. 리뷰 전 staged 내용 확인 (외부 전송)

`req:review-codex`는 `git diff --cached` **전문**을 Codex(OpenAI)로 전송한다. codex는 `--sandbox read-only`로 저장소 루트를 읽으므로 diff에 없는 파일(`.env` 등)도 읽힐 수 있다. 마스킹·스크러빙·길이 상한은 **없다.**

- 리뷰를 실행하기 전에 staged 내용에 자격증명·토큰·개인정보가 없는지 확인한다.
- 민감 코드베이스(결제·인증·개인정보)라면 이 확인을 생략하지 않는다. 확인 없이 리뷰를 돌리지 않는다.
- 이 절은 도구가 강제하지 않는다. **Builder의 의무다.**

## 사람 전용 명령 — 에이전트가 실행하지 않는다

아래 목록은 통제점표와 **범주가 다르다.** 통제점은 "멈추고 승인 문장을 받은 뒤 **에이전트가 실행**한다"이고,
여기는 **에이전트가 아예 실행하지 않는다** — 사용자에게 실행을 요청하고 결과를 받는다.

| 명령 | 이유 | 에이전트가 할 일 |
|---|---|---|
| `npx commitgate setup` | **대화형 전용**이다. 리뷰 모델·추론강도를 묻고 `codex login`을 실행한다. 비대화형에서 실행하면 아무 질문도 하지 않고 즉시 종료한다 | 사용자에게 *"터미널에서 `npx commitgate setup`을 실행해 주세요"* 라고 **요청**한다 |

이 규칙의 목적은 편의가 아니다. setup은 **리뷰 모델 같은 게이트 파라미터**를 바꾼다 — 에이전트가 스스로
실행할 수 있으면 게이트 정책을 스스로 완화하는 경로가 열린다. 명령 자체도 비대화형에서 fail-closed로
거부하지만, **계약이 먼저 막는 것이 옳다.**

## 사람에게 보고해야 할 때

각 통제점은 **고유한 승인 문장**을 가진다. 그 문장 그대로 승인받지 못했으면 실행하지 않는다.

protected branch에 변경을 넣는 경로는 **두 가지**이고 **둘 다 유효**하다. PR은 **의무가 아니라 선택**이다.

- **경로 A (PR 경유)**: `I1` → required status checks green → `I2`
- **경로 B (direct push)**: `B1` → push → **CI 사후 실행**

| # | 통제점 | 경로 | 멈추는 시점 | 승인 문장 |
|---|---|---|---|---|
| `I1` | 통합 — PR 열기 | A | feature branch를 원격에 push하고 PR을 생성하기 직전 | `feature branch push + PR 생성 승인` |
| `I2` | 통합 — PR 머지 | A | **required status checks가 전부 green으로 끝난 것을 확인한 뒤**, PR을 protected branch에 머지하기 직전 | `required checks green 확인 후 PR merge 승인` |
| `B1` | 통합 — direct push | B | protected branch에 **direct push**하기 직전 | `branch protection bypass를 사용한 direct push 승인` |
| `R1` | 릴리즈 — tag | — | 버전 tag 생성 및 tag push 직전 | `tag 생성·push 승인` |
| `R2` | 릴리즈 — publish | — | 패키지 publish 직전 | `npm publish 승인` |
| `R3` | 릴리즈 — release | — | GitHub release 생성 직전 | `GitHub release 생성 승인` |

- 경로 A: `I2`는 checks 결과를 본 뒤에만 요청한다 — green 전 선승인은 받지 않는다(승인자가 볼 근거가 아직 없다).
- 경로 B: **direct push는 required status checks를 우회한다.** 그래서 `B1` 승인이 따로 필요하다. 경로 B를 고르는 것 자체는 잘못이 아니다 — **우회 사실을 숨기는 것**이 잘못이다.
- **push 전에 멈춰라.** 대상이 protected branch로 알려져 있거나 확인이 안 되면 push하기 전에 보고한다. push 응답의 `remote: Bypassed rule violations`는 우회가 **이미 일어난 뒤**의 사후 신호이므로 사전 정지의 근거가 될 수 없다.
- **경로 B에서 CI는 사후 검증이다.** push 이후에 돌기 때문에, 그 green은 반영을 *사전에* 막아 준 게 아니다. 보고할 때 이 사실을 생략하지 않는다.
- `R1`·`R2`·`R3`는 반영(`I2` 또는 `B1`) 이후 **CI green을 확인한 뒤** 각각 따로 요청한다. 경로 B였다면 그 green이 push 뒤에 나왔다는 점을 함께 보고한다. 셋을 하나의 "릴리즈 승인"으로 뭉뚱그리지 않는다.

그 밖에 보고해야 할 때:
- HIGH commit 실행 직전
- destructive 작업(reset/clean/force push) 필요
- 설계 범위 변경 또는 비목표 추가 필요
- Codex 리뷰 BLOCKED(exit 2) 또는 제한된 재시도 후 판단 불명확
- git·Codex CLI·Node·패키지매니저 등 필수 전제 미충족(fail-closed)

## 워크플로 명령

| 명령 | 용도 |
|---|---|
| `req:new <slug> --run` | REQ 티켓 생성(채번·브랜치·`00/01/02` 스캐폴드) |
| `req:next <id> [--json]` | **다음 행동 계산**(읽기 전용). `RUN`/`AGENT`/`AWAIT_HUMAN`/`DONE`/`BLOCKED` |
| `req:review-codex <id> --kind design\|phase [--phase <p>] --run` | Codex 리뷰 조립·호출·승인 반영 |
| `req:doctor <id>` | 일관성 게이트(D-체크) |
| `req:commit <id> [--run] [--message-file <f>]` | 승인된 phase 커밋 + evidence-finalize |

**다음 행동을 추측하지 마라.** `req:next`가 state와 git에서 계산해 준다. `RUN`이면 그 명령을 그대로 실행하고, `AGENT`면 그 작업을 한 뒤 `git add` 하고, `AWAIT_HUMAN`이면 멈춰서 출력된 승인 문장을 그대로 받는다. 이 루프를 끊지 말고 반복한다.

**리뷰어 페르소나는 도구가 주입한다.** `req:review-codex`가 `workflow/review-persona.md`를 프롬프트 첫 블록으로 넣는다(`req.config.json`의 `reviewPersonaPath`). 사람이 직접 실행하든 다른 에이전트가 실행하든 동일하다 — 프롬프트에 손으로 붙여넣지 마라. 파일이 없거나 비어 있으면 fail-closed로 멈춘다.

설정은 repo 루트의 `req.config.json`(선택). 자세한 계약은 `README.md` 참조.
