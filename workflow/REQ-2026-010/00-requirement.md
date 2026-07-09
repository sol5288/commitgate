# REQ-2026-010 요구사항

## 무엇을

CommitGate 사용자가 매번 손으로 붙여넣던 세 종류의 프롬프트를, 각각이 **실제로 강제되는 계층**으로 내린다.

| | 지금 (수동 프롬프트) | 목표 (강제 계층) |
|---|---|---|
| P1 | "CommitGate를 사용해라 + 요구사항 4칸" | 에이전트 진입점 파일(`.claude/`, `.cursor/`) — init이 설치 |
| P2 | "너는 PM이다 / 리뷰 프레임에 갇히지 마라" | `req:review-codex`가 조립하는 **프롬프트에 도구가 항상 주입** |
| P3 | "끊지 말고 끝까지 이어서" | `req:next` 상태기계 명령 — 다음 행동을 도구가 계산 |

## 왜

### P2를 에이전트 지시문에 두면 fail-closed가 깨진다

Codex에게 가는 프롬프트를 조립하는 주체는 Builder(Claude)가 아니라 `review-codex.ts`의 `assembleReviewPrompt()`다. 페르소나를 에이전트 지시문(스킬/규칙)에만 두면:

- 사람이 `npm run req:review-codex ... --run`을 직접 실행하면 페르소나가 누락된다.
- Cursor·다른 에이전트가 실행해도 누락된다.
- **누락돼도 리뷰는 성공(exit 0)한다.** 약한 리뷰가 통과했다는 신호가 어디에도 없다.

이는 `AGENTS.md` §3(승인 바인딩 fail-closed 우회 금지)이 D9(staged tree 일치)·D10(워킹트리 clean)·리뷰어 실패에 적용하는 원칙과 어긋난다. 리뷰 **품질 계약**만 "에이전트가 기억하기를 바라는" 계층에 남길 이유가 없다.

### P3를 문장으로 두면 컨텍스트 길이에 비례해 신뢰도가 떨어진다

"끊지 말고 이어서 하라"는 LLM의 의지에 의존한다. 워크플로의 다음 행동은 `state.json` + git 상태의 **결정론적 함수**이므로, 도구가 계산해서 한 줄로 알려줄 수 있다. exit code 계약(0/1/2/3)을 이미 그렇게 설계했다.

### P1은 진입 편의라서 지시문 계층이 맞다

요구사항 4칸을 채우게 하고 워크플로를 시작시키는 것은 강제 대상이 아니다. 실수해도 게이트가 막는다. 다만 Claude Code·Cursor·Codex CLI가 각각 다른 파일을 읽으므로, **본문 SSOT 하나 + 얇은 포인터들**로 배포한다.

## 제약

- **fail-closed 우회 금지**: 페르소나 도입이 D9/D10/승인 바인딩을 약화시켜선 안 된다.
- **본문 중복 금지**: 진입점 파일들이 `AGENTS.md` 본문을 복붙하면 drift 부채가 된다(REQ-2026-009에서 겪은 문제와 동종).
- **비파괴 설치**: 기존 파일(`CLAUDE.md` 등)은 부재 시에만 생성. 현행 `AGENTS.md` 정책과 동일.
- **혼합 버전 무해**: `--force` 없는 재설치로 구 스크립트 + 신규 페르소나 파일이 공존해도 깨지지 않아야 한다.
- **승인 루프 폭주 방지**: 페르소나가 findings를 무제한 늘리면 `blocked_review` 회로차단기와 맞물려 티켓이 진행 불가가 된다. 차단(findings) / 비차단(observations) 경계를 페르소나 본문이 명시해야 한다.
- **통제점 불변**: `req:commit --run` 직전, `[I1]/[I2]/[B1]`, `[R1]~[R3]`은 그대로 사람 승인. `req:next`는 그 지점에서 반드시 멈춘다.
- **공개 payload 계약 확장**: `files[]`·init 복사물·uninstall 분류가 함께 갱신돼야 한다. minor bump(`0.4.0`).
- 과거 `workflow/REQ-2026-00*` 감사 기록은 수정하지 않는다.
- tag / `npm publish` / GitHub release / main 반영은 이 티켓에서 **수행하지 않는다**(각각 별도 통제점).

## 완료 기준

1. `req.config.json`에 `reviewPersonaPath`가 있고, 기본값이 활성 경로(`workflow/review-persona.md`)이며, 경로가 해소됐는데 파일이 없으면 **throw**한다(silent skip 금지). `null` 명시는 의도적 비활성.
2. `assembleReviewPrompt`가 persona를 **첫 블록**으로 내보내고, 그 사실이 단위 테스트로 고정된다.
3. 기본 페르소나 본문이 `machine.schema.json` 필드(`findings`/`observations`/`next_action`/`commit_approved`)로 번역돼 있고, "승인은 findings 0건" 규칙과 모순되지 않는다.
4. `req:next <id>`가 `RUN` / `AGENT` / `AWAIT_HUMAN` / `DONE` / `BLOCKED` 중 하나를 출력하고, 판정 코어가 순수 함수로 분리돼 테스트된다. `--json`으로 machine-readable 출력.
5. `npx commitgate`가 `.claude/skills/commitgate/SKILL.md`, `.claude/commands/req.md`, `.cursor/rules/commitgate.mdc`, `CLAUDE.md`(부재 시)를 설치하고, 본문은 `AGENTS.md`를 가리킨다.
6. `npx commitgate uninstall`이 위 신규 파일을 올바른 분류(tool vs ambiguous)로 계획에 포함한다.
7. `npm pack --dry-run --json` payload에 `workflow/review-persona.md`·`templates/*`·`scripts/req/req-next.ts`가 포함되고, 금지 문자열 0건이 유지된다.
8. `npm test` green, `npm run typecheck` 0, `npm run smoke` 통과.
9. 이 티켓 자체가 CommitGate 워크플로(design 리뷰 → phase별 구현 → phase 리뷰 → `req:commit`)로 처리된다 — dogfood.
