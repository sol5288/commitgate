# 보장과 한계 (안전 계약)

## 무엇을 보장하나요?

CommitGate가 막는 것은 단순한 명령 실수가 아니라 **리뷰받지 않은 변경이 커밋되는 상황**입니다.

- Codex 리뷰가 실패하거나 없으면 커밋할 수 없습니다.
- 승인된 staged tree와 지금 커밋하려는 staged tree가 다르면 막습니다.
- `state.json`, `responses/` 같은 워크플로 내부 파일을 source 커밋에 섞으면 막습니다.
- Codex CLI가 없거나 실행에 실패하면 조용히 통과하지 않고 실패합니다.
- 리뷰 종료코드는 outcome 기준입니다: `0` 승인, `1` 무효/fail-closed, `2` blocked(지적 없음+미승인), `3` needs-fix.
- 지적은 없지만 승인도 없는 응답은 NEEDS_FIX가 아니라 BLOCKED이며, 에이전트는 같은 리뷰를 반복하지 않습니다.
- 열린 `(review_kind, phase_id)` review series별로 재리뷰 시도를 계수합니다. 기본값 `{ autoBudget: 5, hardCap: 8 }`에서 1~5회차는 자동, 6~8회차는 회차마다 사람 예외 기록이 있어야 진행, `hardCap` 회를 소진하면 그 다음 시도(9회차부터)는 예외가 있어도 차단합니다 — 무한 재리뷰 루프를 막습니다. 승인되면 그 series가 닫히고, 미수렴 series를 사람이 `human-resolution`으로 종료하면 같은 키의 자동 재개가 막힙니다.
- 리뷰어는 한 호출에서 파악한 P1을 모두 `findings[]`에 함께 반환합니다(배칭). 한 건씩 내고 재검수받는 직렬 흐름이 리뷰 라운드를 부풀리던 문제를 줄입니다 — P1 기준을 낮추는 것이 아니라, 이미 아는 P1을 다음 라운드로 미루지 않는 것입니다.
- 설치 시 기존 `cross-spawn`이 검증 하한보다 낮으면 경고하고, `--strict`에서는 중단합니다.
- 승인 응답과 증거 파일은 `workflow/REQ-.../responses/`에 남습니다.
- 리뷰 시도가 **커밋되는 append-only 원장**(`workflow/REQ-.../responses/review-ledger.jsonl`)에 남습니다. 각 시도는 외부 호출 **전** `attempt-opened`, 판정 후 `attempt-closed`로 두 행이 되고, opened만 있고 closed가 없는 시도가 곧 "예산은 깎였는데 완료되지 않은 호출"입니다. 사람 예외 소비 여부도 여기 남습니다. design 승인과 phase 증거 확정 시 자동으로 커밋되며, 프롬프트·응답 **본문은 저장하지 않습니다**(해시까지만 — 본문은 아카이브가 보관). 원장 본문이 손상되면(잘린 JSONL 등) 다음 리뷰가 시작 전에 fail-closed로 멈춥니다.

한 줄로 말하면, **확실히 승인된 변경만 통과하고 애매하면 멈추는 방식**입니다.

### 보장하지 않는 것

방어선을 잘못 계산하지 않도록, 이 도구가 **하지 않는 일**을 분명히 해 둡니다.

- **하드 강제가 아닙니다.** git hook을 설치하지 않으므로 `req:commit` 대신 `git commit`을 직접 치면 doctor·승인 바인딩·증거 기록이 전부 우회됩니다. 운영 반영의 실제 방어선은 여전히 CI와 배포 파이프라인입니다.
- **staged 내용의 비밀을 지켜 주지 않습니다.** `req:review-codex`는 `git diff --cached` 전문을 Codex(OpenAI)로 전송하고, codex는 `--sandbox read-only`로 저장소 루트를 읽습니다. 마스킹·스크러빙·길이 상한이 없습니다. 결제·자격증명처럼 민감한 코드베이스라면 리뷰 전 staged diff를 육안으로 확인하는 절차를 계약(`AGENTS.md`)에 명문화하세요.
- **커밋 이후를 보장하지 않습니다.** 승인은 커밋 시점의 staged tree에 대한 것이고, 머지·태그·publish는 각각 별도 통제점입니다.

## 지원 범위

| 환경 | 상태 |
|---|---|
| **npm** | 완전 지원 — 매 릴리스 packed tarball smoke로 검증합니다 |
| **pnpm · yarn** (`node_modules` linker) | 지원 — `node_modules/.bin/commitgate`로 해소되는 표준 경로를 씁니다 |
| **Yarn PnP** | **이번 릴리스 미지원**(검증하지 않았습니다). `nodeLinker: node-modules`를 쓰세요 |
| **workspace/monorepo** | **워크스페이스 root 설치**를 지원합니다(root에 `req.config.json`·`workflow/`). 하위 패키지에 독립 설치하는 배치는 미지원 |

**재현성**: `req.config.json`의 리뷰 모델·추론강도 핀과 스키마·persona가 프로젝트에 남아 과거 리뷰 입력이 git 이력으로 재현됩니다. 런타임 버전은 **lockfile이 고정**하므로 `package-lock.json`(pnpm/yarn은 각 lockfile)을 **커밋하세요**.

### Companion Skills 발견 범위

**설치는 모든 환경에서 동일합니다.** 아래는 harness가 그 파일을 **발견하는지**에 대한 것입니다.

| harness | 발견 |
|---|---|
| **Claude Code** | `.claude/skills/<이름>/SKILL.md`를 native로 읽습니다 |
| **Cursor (editor)** | `.claude/skills`를 호환 경로로 읽습니다 |
| **Cursor (CLI)** | ⚠️ **버전·실행 모드별 동작 차이 가능 — 보장하지 않습니다** |
| **Codex** | **제품 범위 밖** — companion entrypoint를 설치하지 않습니다. CommitGate에서 Codex는 **Reviewer**이고 이 5종은 **Builder 보조**입니다 |

⚠️ **근거는 벤더 1차 문서입니다 — CommitGate 팀이 실측한 것이 아닙니다.** 확인 시점 **2026-07-17**, 확인 환경 win32 x64 / Node v20.19.5.
벤더가 동작을 바꾸면 이 표는 낡을 수 있습니다.

⚠️ **Cursor CLI를 "지원"·"미지원" 어느 쪽으로도 단정하지 않습니다.** Cursor는 editor·CLI 양쪽의 Agent Skills 지원을
발표했지만, `.claude/skills` 호환 경로의 CLI 발견은 버전·모드에 따라 차이가 보고돼 있고 우리는 검증하지 못했습니다.
발견되지 않아도 **핵심 워크플로에는 영향이 없습니다** — 스킬은 품질 보조 레이어이고 계약 정본은 `AGENTS.md`입니다.

우회를 위해 `.cursor/skills`에 **이중 설치하지 않습니다** — 그 경로도 CLI에서 동작이 불확실하고, 같은 내용이 두 곳에
깔리면 drift 위험이 생깁니다. 벤더가 고치면 **우리 변경 없이** 동작합니다(같은 경로를 읽으므로).
