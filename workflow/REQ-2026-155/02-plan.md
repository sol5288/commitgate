# REQ-2026-155 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고.

> **테스트 실행 계층(REQ-2026-100)**: 게이트는 테스트를 **실행하지 않는다**.
> - **phase 진행 중**: 변경 영역 테스트 + `tests/unit/dispatch.test.ts`.
> - **통합 직전 1회**: **전체 스위트**(`npm test`) + `bin/verify-range.ts --base main --head HEAD --strict`.
>   🔴 `verify-range` 는 `scripts/req/` 가 아니라 **`bin/`** 이고 인자는 `--base`/`--head` 다.

🔴 **선행**: 설계 승인 직후 `state.json` 의 `phases[]` 에 아래 두 id 를 선언한다.

```
phase-1-checkpoint-verb-guard · phase-2-raw-input-fidelity
```

## Phase 1 — checkpoint verb 가드 (`phase-1-checkpoint-verb-guard`)

범위: `req:confirm`·`req:review-exception`·`review-codex`(design 승인)에 복구 창 거부 추가 ·
`req:repolicy` 는 기존 유지 · **소스 가드**.

Exit:
- 🔴 **결함 1 재현 e2e**: `pending_evidence_for` + 결속이 있는 상태에서 `req:confirm … --run` 이
  **거부**하고 **state 를 쓰지 않으며** 커밋 수가 불변이다. (지금은 통과해 결속을 깬다.)
- 🔴 **거부 뒤 복구가 실제로 이어진다**: 그 상태에서 `req:commit --finalize --run` 이 **성공**하고
  커밋된 state 해시가 매니페스트 결속과 일치한다. 🔴 **복구 자신은 막히지 않는다** — 유일한 나갈 길이다.
- 🔴 **네 verb 전부** 복구 창에서 거부한다(`req:confirm` · `req:repolicy` · `req:review-exception` ·
  `review-codex` design 승인). 각각 회귀 테스트.
- 🔴 **dry-run 은 막지 않는다** — `--run` 없는 호출은 종전대로 동작한다(각 verb 별 확인).
- 🔴 **복구 창이 아니면 전부 무회귀** — 기존 테스트가 그대로 통과한다.
- 🔴 **안내가 실행 가능하다**: `npx commitgate req:commit <REQ> --finalize --run` 을 주고
  **아무것도 쓰지 않았음**을 말한다.
- 🔴 **소스 가드**: `commitStateCheckpoint(` 를 부르는 모든 파일이 그 호출 **앞뒤 60줄 창** 안에서
  `inRecoveryWindow` 를 참조한다. 예외는 `req-commit.ts` **하나**이고 목록에 명시한다.
  🔴 **변이 검사**: 어느 verb 의 가드를 지우면 이 소스 가드가 **red** 다(새 호출부 추가도 같다).
  🔴 근사임을 주석에 적는다(정확한 AST 분석은 과하다 — 창을 벗어난 배치는 못 잡는다).
- 계약 스위트: `npx vitest run tests/unit/repolicy-verb.test.ts tests/unit/req-confirm.test.ts tests/unit/req-review-exception.test.ts tests/unit/evidence-recovery-wiring.test.ts tests/unit/dispatch.test.ts`
- Codex 승인.

## Phase 2 — raw 입력 충실도 (`phase-2-raw-input-fidelity`)

범위: git 경로 `\`→`/` 변환 제거 5곳 · `isNegation` 의 `trim()` 제거.

Exit:
- 🔴 **결함 2 재현**: POSIX 리터럴 역슬래시 아카이브 경로에서 **plan 과 D10 의 판정이 같다**.
  ① plan 이 `ready` 면 D10 도 통과 ② plan 이 blocked 면 D10 도 차단. **둘이 갈리지 않는다.**
  (지금은 plan=ready · D10=차단으로 갈려 안내한 명령이 실행 불가다.)
- 🔴 **결함 3 재현**: `max_files` 게이트가 `workflow\REQ-2026-001/large.ts`(티켓 **밖**)를
  **코드 파일로 센다**. (지금은 변환 뒤 티켓 내부로 보여 제외된다.)
- 🔴 **`stagedNames()`·`lib/scratch`·`phaseCodeFiles` 가 raw 경로를 돌려준다** — 역슬래시가 든
  경로가 그대로 나온다(각각 회귀 테스트).
- 🔴 **`allowedScratch` 의 `norm` 도 뺀다.** 뺀 뒤 전량 스위트가 통과해야 한다 — 실패하면
  **어딘가 OS 경로를 넣고 있다는 뜻**이고 그것이 진짜 결함이다(그때는 그 출처를 고친다).
- 🔴 **`toTicketRel` 의 변환은 남는다** — win32 `relative()` 산출물의 구분자 변환이다(소스 가드로
  구분을 고정).
- 🔴 **결함 4**: ` !literal`(선행 공백)이 **부정이 아니다**. `git check-ignore` 실측으로 근거를
  주석에 남긴다. `!literal`·`\!literal` 은 종전대로.
- 🔴 **틀린 테스트를 반대 계약으로 다시 쓴다** — 지금 "앞뒤 공백 무시"가 정답으로 고정돼 있다.
- 🔴 **변이 검사 3건**: ① 어느 한 곳이라도 `\`→`/` 를 되돌리면 해당 회귀가 red
  ② `isNegation` 에 `trim()` 을 되돌리면 선행 공백 테스트가 red
  ③ plan/D10 중 **한쪽만** 되돌리면 "판정이 갈리지 않는다" 테스트가 red.
- 🔴 **Windows·POSIX 무회귀**: 전량 스위트 통과(git 은 어느 쪽에서도 `/` 로 보고한다).
- 계약 스위트: `npx vitest run tests/unit/evidence-recovery-wiring.test.ts tests/unit/evidence-recovery.test.ts tests/unit/gitignore-coverage.test.ts tests/unit/terminal-reentry.test.ts tests/unit/hardblocked-report.test.ts tests/unit/req-review-codex.test.ts tests/unit/dispatch.test.ts`
- Codex 승인.

## 완료
- 게이트 해당분 · **통합 직전 전체 스위트 1회 + `verify-range --strict`** · CHANGELOG.
- 🔴 CHANGELOG 는 **REQ-2026-152~154 가 남긴 결함**임을 감추지 않는다. 특히 "관측된 것만 막는다"가
  부족했다는 것과, 경로 변환 자기모순이 **세 번째**라는 것을 적는다.
- 통합은 `stopGate: "auto"` 다. 사전 위임 또는 `[B1]` direct push 를 사람이 승인한다.
