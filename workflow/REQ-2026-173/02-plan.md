# REQ-2026-173 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

> **테스트 실행 계층(REQ-2026-100)**: 게이트는 테스트를 **실행하지 않는다**. 아래는 비용을 줄이기 위한 실행 시점 권고다.
> - **phase 진행 중**: 변경한 소스를 import하는 테스트만(빠른 피드백). 예: `grep -rl "<변경한 모듈>" tests/`
> - **통합(main 병합) 직전 1회**: **전체 스위트**. 범위 한정은 이것을 **대체하지 않는다** — 영향 분석은 놓친 회귀를 통과시킨다.

## Phase 1 — 판정(순수) + 사실 계산 (`phase-1-authorize`)

범위 (3파일):
- `scripts/req/lib/delegation.ts` — `TrunkAdvanceVerdict` 타입 · `DelegationCheckInput.trunkAdvance?` ·
  `trunk-moved` 분기에서 그 값을 본다. 🔴 `undefined` 면 **종전대로 거부**(무회귀).
- `scripts/req/lib/trunk-advance.ts` — **신규**. `authorizeTrunkAdvance()`.
  DEC-2 의 네 조건을 **전부** 확인하고, 하나라도 판정 불가면 `authorized: false`.
- `tests/unit/trunk-advance.test.ts` — **신규**(순수 + 실 git).

Exit:
- typecheck 0 · 새 테스트 green · 기존 `delegation-model`·`integrate-delegation` **단정 무수정** 통과
- 🔴 **변이 3종**:
  ① 조건 1(머지 sha 대조) 제거 → **미인가 병합이 통과** → red
  ② 조건 2(unproven) 제거 → 손으로 민 커밋이 통과 → red
  ③ `trunkAdvance === undefined` 를 통과로 바꿈 → 무회귀 테스트 red
- Codex phase 리뷰 승인

## Phase 2 — `integrate` 배선 + 정직한 기록 (`phase-2-wire-integrate`)

범위 (2파일): `bin/integrate.ts` + 테스트.
- `trunk_sha` 불일치일 때**만** `authorizeTrunkAdvance` 를 돌려 `delegationVerdict` 에 넘긴다.
- 🔴 통과했으면 **출력 한 줄 + `consumed.detail`** 에 그 사실을 남긴다(DEC-4).

Exit:
- typecheck 0
- 🔴 **실 git e2e**:
  1. 순차 통합 2건 — 앞 REQ 병합 후에도 뒤 REQ 위임이 **재발급 없이** 통과
  2. trunk 에 손으로 민 커밋이 있으면 **거부**
  3. 통과한 경우 원장 `consumed.detail` 에 그 사실이 있다
- 🔴 **변이**: 배선 제거(계산해 넘기지 않음) → e2e 1 이 red
- 📊 `authorizeTrunkAdvance` 1회 소요 실측 기록(DEC-6)
- Codex phase 리뷰 승인

## Phase 3 — `req:next` 안내 정합 (`phase-3-next-guidance`)

범위 (2파일): `scripts/req/req-next.ts` + 테스트.
trunk 이동이 인가된 경우 "다시 발급하라"고 말하지 않는다.

Exit:
- typecheck 0 · `req-next`·`next-delegate-flags` green
- 🔴 안내가 거짓이 되는 경우를 고정하는 테스트
- 🔴 **커밋 전 전체 스위트 1회** — 마지막 phase 라 커밋 뒤에는 phase 를 더할 수 없다
  (REQ-2026-169 에서 겪어 micro-REQ 를 하나 더 만들었다)
- Codex phase 리뷰 승인

## 완료
- 게이트 해당분(typecheck·해당 시 lint) · **통합 직전 전체 스위트 1회** · 사용자 main 머지(별도 승인).
