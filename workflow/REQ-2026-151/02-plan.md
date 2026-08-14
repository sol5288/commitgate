# REQ-2026-151 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님).

> **테스트 실행 계층(REQ-2026-100)**: 게이트는 테스트를 **실행하지 않는다**.
> - **phase 진행 중**: 변경 영역 테스트 + `tests/unit/dispatch.test.ts`.
> - **통합 직전 1회**: **전체 스위트**(`npm test`) + `verify-range --strict`.
>   🔴 이번 세션에서 전량 실행이 계약 스위트가 못 본 회귀 3건을 잡았다 — 생략하지 않는다.

🔴 **선행**: 설계 승인 직후 `state.json` 의 `phases[]` 에 아래 두 id 를 선언한다.

```
phase-1-terminal-reentry-guard · phase-2-consumed-state-commitment
```

## Phase 1 — 종결 재진입 차단 (`phase-1-terminal-reentry-guard`)

범위: `req-commit.ts` 정상 `--run` 경로에 **source 커밋 前** HEAD 정본 lifecycle 판정 · 안내 · 테스트.

Exit:
- 🔴 **실 CLI e2e**: `dev-complete` 티켓에서 `req:commit --run` →
  ① exit≠0 ② **HEAD SHA·커밋 수 불변** ③ `approvals.jsonl`·아카이브·state 에 **새 더러움 없음**.
  (지금은 source 커밋이 만들어지고 그 뒤 교착한다 — 이 오라클이 그것을 고정한다.)
- 🔴 안내가 **그 상태에서 실제로 성공하는 명령**을 준다 — **micro-REQ 하나뿐**이다(설계 r01 P1:
  대체 REQ 경로는 `--resolve replace` 가 열린 series 를 요구하는데 종결 티켓에는 없다).
- 🔴 **출력에 꺾쇠(`<`)가 없다**(고정 문자 부재 검사). slug 는 **산출**하고, 사람-결정 인자를 내지
  않는다. 셸 안전 판정을 통과한다.
- 🔴 **e2e 가 안내 전체의 실행 가능성을 본다**: 차단 뒤 남은 staged 변경 상태에서
  `git stash push` → `req:new … --run` → `git stash pop` 세 줄이 **순서대로 성공**하고,
  마지막에 그 변경이 새 티켓 브랜치에 **복원**돼 있다(설계 r02 P1: 한 줄만 내면 clean-tree 로 막힌다).
- 🔴 **차단 대상은 `dev-complete`·`migrated-complete`·`abandoned` 뿐** — `series-terminal` 은
  차단하지 않는다(대체 REQ 흐름이 그 상태를 지난다). 회귀 테스트로 고정.
- 🔴 **판정 실패는 차단하지 않는다** — 추가 안전장치가 새 교착을 만들면 안 된다(주입 실패로 실증).
- 🔴 **정상(미종결) 티켓 무회귀**: 커밋 경로가 한 글자도 달라지지 않는다.
- 🔴 판정 입력이 `scanTicketIntake` 다 — 소스 가드(REQ-2026-094: 술어만 같고 입력이 갈리면 판독이 갈린다).
- 계약 스위트: `npx vitest run tests/unit/req-commit.test.ts tests/unit/req-doctor.test.ts tests/unit/close-proof.test.ts tests/unit/dispatch.test.ts`
- Codex 승인.

## Phase 2 — 소비 state 결속 (`phase-2-consumed-state-commitment`)

범위: evidence-finalize 가 매니페스트 소비 행에 `consumed_state_sha256` 기록 ·
checkpoint 판정에 판별자 D 추가 · 신규 거부 사유 `state-mismatch` · 테스트.

Exit:
- 🔴 **정상 crash window 가 한 번에 수렴**한다(실 CLI) — 첫 오라클.
- 🔴 crash window 안에서 다음을 각각 고치면 **거부**된다:
  임의 필드 추가 · `risk_level` · `policy_snapshot` · `phases` · `user_commit_confirmed`.
- 🔴 `consumed_state_sha256` 이 **없는 옛 행**은 D 를 건너뛰고 A/B/C 로 판정한다(하위호환 —
  옛 crash window 를 막지 않는다). 그때 남는 위험은 이 REQ 이전과 같다.
- 🔴 매니페스트 새 키는 **선택**이다 — 검증기가 옛 행을 거부하지 않는다(회귀 테스트).
- 🔴 해시는 `serializeState` 정본으로 계산한다 — checkpoint 커밋의 바이트 대조와 같은 함수(소스 가드).
- 🔴 **`consumeState` 를 두 번 부르지 않는다**(설계 r01 관찰) — `consumed_at` 이 갈려 정상 crash
  window 가 `state-mismatch` 로 거부된다. 같은 객체를 해시와 `writeState` 에 함께 쓴다(소스 가드).
- 🔴 **변이 검사**: D 판정을 빼면 "임의 필드 추가 거부" 테스트가 실제로 red.
- 계약 스위트 + `npx vitest run tests/unit/evidence-recovery.test.ts tests/unit/evidence-recovery-wiring.test.ts tests/unit/evidence-module.test.ts`
- Codex 승인.

## 완료
- 게이트 해당분 · **통합 직전 전체 스위트 1회 + `verify-range --strict`** · CHANGELOG.
- 🔴 CHANGELOG 는 **하위호환 구멍**(옛 행에는 결속이 없어 D 를 건너뜀)을 감추지 않는다.
- 통합은 `stopGate: "auto"` 다. 사전 위임 또는 `[B1]` direct push 를 사람이 승인한다.
