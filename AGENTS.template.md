# AGENTS.md (AI REQ workflow — Codex/Builder 계약)

> 이 파일은 `commitgate`(init)가 대상 repo에 `AGENTS.md`가 없을 때 생성한 **템플릿**이다.
> 프로젝트 고유 규칙(SSOT 경로·포트·참조 프로젝트·phase 문서 등)은 여기에 직접 채워 넣어라.
> Codex CLI는 repo 루트의 `AGENTS.md`를 리뷰 컨텍스트로 읽는다.

## 역할

- **Builder(Claude 등)**: REQ 티켓 단위로 설계→구현→테스트. `req:new`로 티켓·브랜치 생성.
- **Reviewer(Codex)**: `req:review-codex`가 조립한 프롬프트로 design/phase 리뷰. 구조화 응답(`workflow/machine.schema.json`)만 승인 근거.

## 절대 규칙 (어기면 리뷰에서 reject)

### 1. Test-First
각 phase에서 게이트를 통과시키는 테스트를 먼저 작성(Red) → 최소 구현(Green) → 리팩토링. 테스트 없는 구현은 reject.

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
- HIGH 영향 phase는 `req:commit --run` 직전 사용자 확인(`state.user_commit_confirmed`).

## 사람에게 보고해야 할 때

- HIGH commit 실행 직전
- main merge / push 직전
- destructive 작업(reset/clean/force push) 필요
- 설계 범위 변경 또는 비목표 추가 필요
- Codex 리뷰 BLOCKED(exit 2) 또는 제한된 재시도 후 판단 불명확
- git·Codex CLI·Node·패키지매니저 등 필수 전제 미충족(fail-closed)

## 워크플로 명령

| 명령 | 용도 |
|---|---|
| `req:new <slug> --run` | REQ 티켓 생성(채번·브랜치·`00/01/02` 스캐폴드) |
| `req:review-codex <id> --kind design\|phase [--phase <p>] --run` | Codex 리뷰 조립·호출·승인 반영 |
| `req:doctor <id>` | 일관성 게이트(D-체크) |
| `req:commit <id> [--run] [--message-file <f>]` | 승인된 phase 커밋 + evidence-finalize |

설정은 repo 루트의 `req.config.json`(선택). 자세한 계약은 `README.md` 참조.
