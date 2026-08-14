# REQ-2026-150 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님).

> **테스트 실행 계층(REQ-2026-100)**: 게이트는 테스트를 **실행하지 않는다**.
> - **phase 진행 중**: 변경 영역 테스트 + `tests/unit/dispatch.test.ts`.
> - **통합 직전 1회**: **전체 스위트**(`npm test`) + `verify-range --strict`.
>   🔴 이번 세션에서 전량 실행이 계약 스위트가 못 본 회귀 3건을 잡았다 — 생략하지 않는다.

🔴 **선행**: 설계 승인 직후 `state.json` 의 `phases[]` 에 `phase-1-checkpoint-attribution` 을 선언한다.

## Phase 1 — checkpoint 증거 귀속 (`phase-1-checkpoint-attribution`)

범위: `evidence-recovery.ts` 의 checkpoint 분기가 A/B/C 를 전부 만족할 때만 `Ready` ·
`buildRecoveryFacts` 가 `parentManifest`·`headStateText` 를 함께 조립 · 두 호출부 배선.

Exit:
- 🔴 **정상 crash window 가 한 번에 수렴한다**(실 git): evidence-finalize 커밋 → 소비 state write →
  checkpoint 전 중단 → `--finalize --run` 1회로 완료. **이것이 첫 오라클**이다.
- 🔴 **완료된 티켓의 임의 수정 3종이 전부 거부**된다:
  ① 임의 필드 수정 ② `approval_consumed_at` 만 변조 ③ **매니페스트 행을 워킹 `consumed_approvals`
  에 복사**(REQ-2026-148 r04 가 기각한 판별자를 재주입하는 변이).
- 🔴 **legacy 티켓**(HEAD state 에 `consumed_approvals` 키 없음 + 매니페스트에 옛 행)이 거부된다 —
  A 가 막는다(B 만으로는 통과했을 자리, 148-r06).
- 🔴 **첫 phase 의 첫 소비**는 통과한다(`consumed_approvals` 부재를 빈 배열로 본다).
- 🔴 판정 입력에 **워킹 `state.json` 내용이 들어가지 않는다**(더러움 범위 확인만) — 소스 가드.
- 🔴 **변이 검사**: A 판정(`parentManifest` 대조)을 빼면 "복사 변이 거부" 테스트가 실제로 red.
- 🔴 두 호출부가 **같은 조립 함수**를 쓴다 — 소스 가드(doctor 통과·commit 거부 교착 방지).
- 계약 스위트: `npx vitest run tests/unit/evidence-recovery.test.ts tests/unit/evidence-recovery-wiring.test.ts tests/unit/req-commit.test.ts tests/unit/req-doctor.test.ts tests/unit/dispatch.test.ts`
- Codex 승인.

## 완료
- 게이트 해당분 · **통합 직전 전체 스위트 1회 + `verify-range --strict`** · CHANGELOG.
- 🔴 CHANGELOG 는 **막지 못하는 것**(evidence-finalize 뒤 추가 커밋이 있으면 복구가 열리지 않음)을
  함께 적는다. 안전한 쪽으로 틀리는 선택이고, 감춰 두면 사용자가 원인을 못 찾는다.
- 통합은 `stopGate: "auto"` 다. 사전 위임 또는 `[B1]` direct push 를 사람이 승인한다.
