# REQ-2026-149 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님).

> **테스트 실행 계층(REQ-2026-100)**: 게이트는 테스트를 **실행하지 않는다**.
> - **phase 진행 중**: 변경 영역 테스트 + `tests/unit/dispatch.test.ts`.
> - **통합 직전 1회**: **전체 스위트**(`npm test`) + `verify-range --strict`.

🔴 **선행**: 설계 승인 직후 `state.json` 의 `phases[]` 에 아래 두 id 를 선언한다.

```
phase-1-placeholder-and-shell-safe · phase-2-pathspec-and-series-binding
```

## Phase 1 — 예약 placeholder + 셸 안전 (`phase-1-placeholder-and-shell-safe`)

범위: `lib/placeholders.ts`·`lib/shell-safe.ts`(신규 leaf) · **안내를 내는 곳**(`nonconvergence.ts` ·
`req-next.ts` · `req-review-exception` 의 `runResolve`)이 등록부를 참조해 렌더링하고 공용 셸 판정을
씀 · **값을 받는 곳**(`req-review-exception` 의 `--resolve`·`--close-stale` · `req-close --abandon` ·
`req-confirm --method` · **`req-delegate --sentence`**)이 예약값을 거부.

Exit:
- 🔴 **도구가 낸 원문 명령을 그대로 실행하면 거부**된다 — `--resolve replace` · `req:close --abandon` ·
  `req:confirm --method` · 🔴 **`req:delegate --sentence`**(149-r01 P1: 그 값이 **main 병합 권한**을
  연다 — 가장 중대한 자리다) 전부. 정규화 후 비교라 `"  승인  문장 "` 도 걸린다.
- 🔴 **e2e**: `stopGate:"auto"` 티켓에서 `req:next` 가 낸 `req:delegate` 줄을 **값 수정 없이** 실행하면
  위임이 **발급되지 않는다**. 실제 사람 문장이면 발급된다(무회귀).
- 🔴 **안내를 내는 표면과 값을 받는 표면의 짝이 맞는지** 소스 가드로 고정한다 — 한쪽만 늘면 고리가
  다시 열린다. **이 REQ 는 표면을 세 번 놓쳤다**(148-r01 `--abandon` · 148-r07 `req:confirm` ·
  149-r01 `req:delegate`). 손으로 유지되는 목록은 또 놓친다 — 가드가 **등록부에 없는 사람-결정
  인자를 내는 코드**를 잡아야 한다.
- 🔴 **보고와 검증이 같은 등록부를 참조**한다 — 소스 가드로 고정(문자열을 두 벌 두지 않는다).
- 🔴 보고에 "이 값을 바꿔서 실행하십시오"가 있다.
- 🔴 **거부는 무조건이다** — 예약 문자열은 출처와 무관하게 거부된다(구별할 방법이 없다).
  거부 메시지가 **무엇이 자리표시자이고 무엇을 쓰라는지** 말한다.
- 🔴 예약이 아닌 값은 짧아도(`"x"`) 통과한다 — 이 REQ 는 값의 진정성을 판정하지 않는다(무회귀).
- 🔴 셸 판정은 **허용 목록**이다(금지 목록 아님). `%PATH%`·`!VAR!` 가 든 **유효 branch** 에서
  `req:next` 가 command 를 내지 않고 값을 데이터로 보여 준다.
- 🔴 **파생값도 검사한다**(설계 r04 P1): `feat/req-…-%PATH%` 에서 `successorSlug` 는
  `%PATH%-successor` 가 된다. hardCap 보고의 `req:new` 줄과 `runResolve` 의 `req:new` 안내 **둘 다**
  그 값을 명령으로 내지 않는다.
- 🔴 **정상 `series_id` 는 반드시 통과한다**(설계 r05 P1): `design:-#1`·`phase:phase-1-x#2` 로
  `--close-stale`·`--resolve --series` 안내가 **사라지지 않는지** 확인한다. `#` 이 허용 목록에 없으면
  정상 상태에서 안내가 통째로 없어진다.
- 🔴 명령을 내는 **세 표면**(`req:next` · hardCap 보고 · `runResolve`)이 같은 판정을 쓴다 — 소스 가드.
- 🔴 정상 branch·REQ id·티켓 경로는 전부 통과한다(무회귀).
- 🔴 판정 지점이 **하나**임을 소스 가드로 고정(`req-next` 가 자체 정규식을 두지 않는다).
- 계약 스위트: `npx vitest run tests/unit/placeholders.test.ts tests/unit/next-policy-guidance.test.ts tests/unit/nonconvergence.test.ts tests/unit/req-close.test.ts tests/unit/confirm-verb.test.ts tests/unit/delegate-verb.test.ts tests/unit/dispatch.test.ts`
- Codex 승인.

## Phase 2 — 파킹 pathspec + series 결속 (`phase-2-pathspec-and-series-binding`)

범위: 파킹 `git commit … -- "<티켓>"`(보고·`runResolve` 양쪽) · `closeSeriesHumanResolutionById` ·
`runResolve` 가 그것을 씀.

Exit:
- 🔴 **실 git e2e**: 티켓 안 untracked 아카이브 + 티켓 **밖 staged 파일**을 동시에 두고 출력 순서대로
  실행 → 새 커밋에 티켓 밖 파일이 **없고**, 그 파일이 **staged 로 남는다**.
- 🔴 안내 두 곳(보고·`runResolve`)이 **같은 형태**다 — 한쪽만 고치면 다른 쪽이 위험하다.
- 🔴 **실 CLI e2e**: 같은 `(design, null)` 에 열린 series 두 개(`design:-#1`·`design:-#2`)를 두고
  `--series design:-#2` 로 replace → **`design:-#1` 은 그대로**이고 `#2` 만 닫힌다.
- 🔴 `#` 이 든 phase id 원문 대조 무회귀(REQ-2026-145 계약).
- 🔴 `ticketRel` 이 안전하지 않으면 명령 대신 데이터.
- 계약 스위트(phase-1 목록) **에 더해** `npx vitest run tests/unit/resolve-replace.test.ts tests/unit/req-review-exception.test.ts`
- Codex 승인.

## 🔴 이 REQ 가 고치지 **않는** 것

외부 리뷰 결함 3(완료 티켓의 임의 state 수정이 D10 예외로 커밋될 수 있음)은 **후속 REQ** 다
(설계 DEC-3 참조 — 리뷰 7라운드의 P1 이 전부 그 하나에서 나와 분리했다). 그때까지 그 결함은 남아 있다.
CHANGELOG 도 그렇게 적는다.

## 완료
- 게이트 해당분 · **통합 직전 전체 스위트 1회 + `verify-range --strict`** · CHANGELOG.
- 🔴 CHANGELOG 는 DEC-1 을 **"사람 검증"이라고 쓰지 않는다** — 도구가 자기 출력을 되받는 고리를
  끊었을 뿐이다.
- 통합은 `stopGate: "auto"` 다. 사전 위임 또는 `[B1]` direct push 를 사람이 승인한다.
