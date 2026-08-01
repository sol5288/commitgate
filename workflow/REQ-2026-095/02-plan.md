# REQ-2026-095 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

## Phase 1 — 안내·별칭·경고 (`phase-1-message-guidance`)

단일 phase(설계 「Phase별 구현」 참조 — 세 변경이 "메시지 전달" 한 축이라 나누면 리뷰 면적만 는다).

범위(9파일 — 코드 2 · 문서 4 · CHANGELOG 1 · 테스트 2):

- `scripts/req/req-next.ts` — `COMMIT_MESSAGE_PLACEHOLDER`에 `(한 줄)` 명시 +
  순수 helper `multiLineMessageHint(pm, target)` 신설 → `commitCmd`·`autoCommitCmd`를 쓰는
  **두 액션 모두**의 `diagnostics`에 부착(DEC-1·2·5). 렌더러 무변경.
- `scripts/req/req-commit.ts` — `parseArgs`에 `-F` 별칭(DEC-3) +
  순수 `looksLikeCollapsedMessage(msg)` 신설·경고 배선(DEC-4).
- `docs/troubleshooting.md`·`.en.md` — 증상·실측표·해법.
- `docs/workflow.md`·`.en.md` — 커밋 단계에 여러 줄 규칙 한 줄.
- `CHANGELOG.md` — 0.16.0 항목 합류.
- `tests/unit/req-next.test.ts`·`req-commit.test.ts` — 아래 가드.

회귀 가드:

1. 🔴 **두 경로 모두 안내를 받는다**(DEC-5): 사람 확인(AWAIT_HUMAN) 액션과 LOW 자동(RUN) 액션의
   `diagnostics`에 `--message-file`이 **둘 다** 들어 있다. 한쪽만 고치는 실수를 고정한다.
2. **RUN 명령은 여전히 실행 가능**(R1·R5): 액션의 `command`가 `-m <자리표시자>` 형태를 유지한다
   (`--message-file`로 **바뀌지 않았다**). REQ-2026-058 F-3 계약 무회귀.
3. **안내 명령이 현재 packageManager로 조립된다**(DEC-2): npm이면 `npm run … --`, pnpm이면 `pnpm …`.
4. 🔴 **문구가 npm을 지목한다**: 안내에 `npm`이 들어 있다(“pnpm 버그”로 좁히면 npm 사용자가
   자기는 안전하다고 오해한다 — 실측상 npm이 더 나쁘다).
5. **`-F` 별칭**: `parseArgs(['x','-F','p'])`가 `--message-file`과 동일 결과 ·
   `-m`과 함께 쓰면 기존 상호배타 오류 그대로.
6. 🔴 **`looksLikeCollapsedMessage` 판정 표**: 리터럴 `\n` 있고 실제 개행 없음 → `true` ·
   실제 개행이 하나라도 있으면 `false`(정상 여러 줄) · 리터럴 `\n` 없으면 `false` ·
   **빈 문자열·한 줄 평문 → `false`**.
7. 🔴 **경고는 차단하지 않는다**: 경고 조건을 만족해도 커밋 경로가 계속 진행된다(throw 없음).
8. **자동 복원 금지**: 경고가 떠도 메시지 문자열이 **변형되지 않는다**(전달값 동일).
9. 🔴 **경고가 실제로 나온다 — 배선 관측**(설계 r01 P1): 붕괴 조건의 `-m`으로 `req:commit`을
   **실제 진입점에서 실행**하고 경고 문구가 stderr에 **한 번 관측**됨을 단언한다.
   순수 판정(가드 6)과 무-throw(가드 7)만으로는 **경고 출력 배선이 통째로 빠져도 전부 통과**한다.
   이를 위해 경고는 doctor·게이트보다 **앞**에서 낸다 — 그래야 뒤 단계가 실패해도 관측되고,
   자문 성격상 커밋 성사 여부와 무관하게 사용자에게 보이는 것이 옳다.

Exit: `npx tsc --noEmit`(0) · `npx vitest run`(전량 그린) · `npm run docs:lint`(그린) · Codex phase 리뷰 승인.

## 완료

- 게이트 해당분(unit·typecheck·docs:lint) · 사용자 main 머지(별도 승인).
- 그 뒤 **0.16.0에 합류해 배포**(092·093·094·095 묶음 — 사용자 지시).

> 🔴 이 티켓은 risk=LOW다. `phaseCommit.autoApprove: "low-only"` 설정상 `req:next`가 자동 커밋을
> 지시할 수 있으나, **커밋 실행 전 사용자 승인을 받는다**(이 대화의 통제점 규약이 config보다 우선).
