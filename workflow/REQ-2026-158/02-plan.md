# REQ-2026-158 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: 문서 9종 + 테스트 1개다. 축이 하나이므로 `max_files` 를
> 선언해 한 phase 로 간다.

> **테스트 실행 계층(REQ-2026-100)**: 게이트는 테스트를 **실행하지 않는다**.
> - **phase 진행 중**: `setup-docs-parity` · `docs-stale-claims` · `readme-landing` · `dispatch` + `docs:lint`.
> - **통합 직전 1회**: **전체 스위트**(`npm test`) + `bin/verify-range.ts --base main --head HEAD --strict`.

🔴 **선행**: 설계 승인 직후 `state.json` 의 `phases[]` 에 아래 id 를 선언한다.

```
phase-1-review-budget-doc-drift
```

## Phase 1 — 잔여 드리프트 (`phase-1-review-budget-doc-drift`)

Exit — **고정 회차 표현 제거**(높음 3건):
- 🔴 `README.md:59` · `README.en.md:59` 의 "자동 5회 · 6~8회 사람 예외 · 9회부터 차단"이 사라지고
  DEC-2 의 **짧은 형**으로 바뀐다.
- 🔴 `docs/workflow.md` · 영문판의 재리뷰 예산 절에서 "(기본 6~8)" 이 사라진다.
- 🔴 `docs/configuration.md` · 영문판 **요약 표**(14행)가 상세절과 **모순되지 않는다** —
  같은 파일 안에서 한쪽만 고쳐 둔 것이 이번 결함의 한 건이다.

Exit — **setup 설명 완성**(보통·낮음 2건):
- 🔴 `AGENTS.template.md` 가 **네 축**(모델·추론강도·`stopGate`·`reviewBudget.onSoftLimit`)을 적고,
  "에이전트가 스스로 실행하면 안 되는 이유"를 **두 정책 축의 이름으로** 다시 쓴다.
- 🔴 README(한/영) **명령 표의 setup 행**이 네 축을 모두 말한다.

Exit — **초보자 기준**:
- 🔴 내부 용어를 처음 쓸 때 괄호로 쉬운 뜻을 붙인다 — "판정이 나온 리뷰(승인·수정 요청처럼 결과가
  정상적으로 나온 리뷰)".
- 🔴 `stopGate` 와 `onSoftLimit` 을 **한 문장에 섞지 않는다**.
- 🔴 **`auto` 가 두 곳에 있다**는 것을 quick-start 에 **한 번** 표로 명시하고, 그 아래에
  **둘 다 `hardCap` 을 해제하지 않는다**를 붙인다. 다른 문서는 링크만 한다.

Exit — **회귀 가드**(`tests/unit/setup-docs-parity.test.ts` 확장):
- 🔴 **공개 문서 전체**(README 한/영 · quick-start 한/영 · workflow 한/영 · configuration 한/영 ·
  guarantees 한/영 · `AGENTS.template.md`)에 금지 문자열(`6~8` · `6–8` · `rounds 6` · `round 9` ·
  `9회부터`)이 없다.
  🔴 워크플로 티켓의 **과거 설계문서는 대상에서 뺀다** — 그때의 사실이고 고치면 안 된다.
- 🔴 `configuration`(한/영) **요약 표 행**이 `onSoftLimit` 과 **두 계수 기준의 차이**를 말한다.
- 🔴 `AGENTS.template.md` 가 **`buildQuestions({})` 의 모든 키**를 적는다 — 🔴 키 목록을 손으로 적지
  않고 **소스에서 파생**한다. 축이 늘면 자동으로 red.
- 🔴 README(한/영) **명령 표의 setup 행**이 네 축을 말한다 — 같은 방식으로 소스에서 파생.
- 🔴 **변이 검사 4건**: ① README:59 에 "6~8회"를 되돌리면 red ② workflow 에 "(기본 6~8)"을
  되돌리면 red ③ `AGENTS.template.md` 에서 축 하나를 빼면 red ④ README 명령 표에서 리뷰 예산을
  빼면 red.

Exit — **무회귀**:
- 🔴 `npm run docs:lint` 통과. README→docs 는 절대 blob URL, 한글 heading 앵커는 쓰지 않는다.
- 🔴 REQ-2026-157 의 기존 20건이 그대로 통과한다.
- 🔴 **코드·기본값·선택지를 한 줄도 바꾸지 않는다** — `git diff --stat` 에 `scripts/`·`bin/` 이 없다.

- 계약 스위트: `npx vitest run tests/unit/setup-docs-parity.test.ts tests/unit/docs-stale-claims.test.ts tests/unit/readme-landing.test.ts tests/unit/dispatch.test.ts` + `npm run docs:lint`
- Codex 승인.

## 완료
- 게이트 해당분 · **통합 직전 전체 스위트 1회 + `verify-range --strict`** · CHANGELOG.
- 🔴 CHANGELOG 는 **가드 범위가 결함 범위보다 좁았다**는 원인을 적는다 — 서술을 고친 것이 아니라
  검사 대상을 넓힌 것이 이번의 본체다.
- 통합은 `stopGate: "auto"` 다. 사전 위임 또는 `[B1]` direct push 를 사람이 승인한다.
