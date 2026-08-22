# REQ-2026-174 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

> **테스트 실행 계층(REQ-2026-100)**: 게이트는 테스트를 **실행하지 않는다**. 아래는 비용을 줄이기 위한 실행 시점 권고다.
> - **phase 진행 중**: 변경한 소스를 import하는 테스트만(빠른 피드백). 예: `grep -rl "<변경한 모듈>" tests/`
> - **통합(main 병합) 직전 1회**: **전체 스위트**. 범위 한정은 이것을 **대체하지 않는다** — 영향 분석은 놓친 회귀를 통과시킨다.

## Phase 1 — 판정·안내·계약 (`phase-1-absorb`)

범위 (4~5파일):
- `scripts/req/lib/config.ts` — `highRiskCarriedByDelegation(sg: StopGate): boolean`(순수).
  🔴 값을 하드코딩하지 않고 **판단을 함수로** 둔다 — `stopGate` 값이 늘 때 판단 지점이 하나다.
- `scripts/req/req-next.ts` — 묶음 없음 분기의 `requireHighConfirm` 을 그 함수로 파생 ·
  `autoDelegationAction` 문구에 "이것이 유일한 사람 확인"을 명시(DEC-3).
- `AGENTS.template.md` (+ HIGH 확인 지점을 말하는 문서 전수) — `stopGate` 별 확인 자리 정합(DEC-4).
- `tests/unit/next-high-confirm.test.ts` — **신규**.

Exit:
- typecheck 0 · `next-policy-guidance`·`next-delegate-flags`·`req-next` green
- 🔴 **오라클 5종**:
  1. `auto` + HIGH + 묶음 없음 → `req:confirm` 을 요구하지 **않는다**(위임 발급 안내)
  2. `merge` + HIGH → **여전히** `req:confirm` 을 요구한다(무회귀)
  3. `auto` + HIGH + **묶음 있음** → 그 경로 불변
  4. 안내가 `--high-risk` 를 담고 **그것이 유일한 확인**임을 말한다
  5. 🔴 **게이트 무회귀**: `--high-risk` 없는 위임은 `integrate` 가 `high-risk-unacked` 로 막는다
- 🔴 **변이 3종**:
  ① 조건을 `defersToIntegration` 으로 되돌림 → 오라클 2 red
  ② `auto` 에서도 확인을 계속 요구 → 오라클 1 red
  ③ `integrate` 의 `high-risk-unacked` 제거 → 오라클 5 red
- **커밋 전 전체 스위트 1회** — 단일 phase 라 커밋 뒤에는 phase 를 더할 수 없다
  (REQ-2026-169 에서 겪어 micro-REQ 를 하나 더 만들었다)
- Codex phase 리뷰 승인

## 완료
- 게이트 해당분(typecheck·해당 시 lint) · **통합 직전 전체 스위트 1회** · 사용자 main 머지(별도 승인).
