# REQ-2026-142 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

> **테스트 실행 계층(REQ-2026-100)**: 게이트는 테스트를 **실행하지 않는다**. 아래는 비용을 줄이기 위한 실행 시점 권고다.
> - **phase 진행 중**: 변경 영역 테스트 + **dispatch/verb 등록** + **정책 구조 가드**(사용자 지시 2026-08-14).
>   🔴 이번 세션에서 `runCli` 미export와 구조 가드 red 를 **전체 스위트에서야** 발견했다 — 그 둘이 매 phase 계약 스위트에 들어가는 이유다.
> - **통합(main 병합) 직전 1회**: **전체 스위트** + `verify-range --strict`. 범위 한정은 이것을 대체하지 않는다.

🔴 **선행**: 설계 승인 직후 `state.json` 의 `phases[]` 에 아래 세 id 를 선언한다(신규 티켓은 빈 배열이라
선언 전에는 phase 리뷰가 대상을 받지 못한다 — REQ-2026-141 r05 에서 실측).

```
phase-1-pin-archive-inventory · phase-2-recovery-plan · phase-3-d10-allowlist-and-execute
```

## Phase 1 — 승인 시점 inventory 핀 (`phase-1-pin-archive-inventory`)

범위: `PinnedArchiveInventory` 타입 · `items` 정규형 직렬화와 `inventory_sha256` · `buildApprovalEvidence`
가 승인 시점에 생성·핀 · 매니페스트 검증 무회귀.

Exit:
- 🔴 **정규형 해시**: 같은 목록이면 입력 순서가 달라도 같은 값 · 한 바이트라도 다르면 다른 값
- 🔴 `source_response_path` 가 `items` 안에 있다(결속)
- 🔴 **선택 키다** — 이 필드가 없는 옛 승인 evidence·매니페스트가 여전히 유효
- 계약 스위트: `npx vitest run tests/unit/evidence.test.ts tests/unit/req-review-codex.test.ts tests/unit/dispatch.test.ts tests/unit/stopgate-auto-equivalence.test.ts`
- Codex 승인.

## Phase 2 — 복구 판정(순수) (`phase-2-recovery-plan`)

범위: `lib/evidence-recovery.ts` — `planEvidenceRecovery` 6항 검증 · `RecoveryBlockedReason` 등록부 +
`Record<Reason,string>` 안내(사유를 늘리면 안내가 강제된다).

Exit:
- 🔴 **거부 사유 전수 발화**(각 사유가 실제 입력으로 재현)
- 🔴 `tree-mismatch` · `inventory-absent` · `pin-divergent` · `inventory-tampered` · `archive-mismatch` ·
  `inventory-unbound` · `foreign-files` 각각 독립으로 발화
- 🔴 **DEC-3a**: HEAD 에 소비 행이 있으면 워킹 state 에 핀이 **없어도** `Ready(resumeFrom:'checkpoint')`,
  없으면 같은 상태가 `inventory-absent` — "아직 안 만들었다"와 "이미 소비했다"를 구별한다
- 🔴 **허용 집합은 부분집합이다** — 중단 지점에 따라 일부만 더러워도 `Ready`(과잉 조임 금지)
- 🔴 무관 파일이 **하나만** 있어도 `Blocked`(소스 파일 · 다른 티켓 `responses/` · `…-r99-approved.json`)
- 계약 스위트 동일 + `npx vitest run tests/unit/evidence-recovery.test.ts`
- Codex 승인.

## Phase 3 — D10 배선 + 멱등 실행 (`phase-3-d10-allowlist-and-execute`)

범위: `findUnstagedOrUntracked` 에 `recoveryAllowlist` 인자 · `req-doctor.ts` 배선 ·
`executeEvidenceRecovery`(DEC-5 4단계·멱등 재개) · `req:commit --finalize` 가 **유일한 호출자**임을
소스 가드로 고정 · `docs/workflow*.md` 복구 절차 · CHANGELOG.

Exit (사용자 명시 10종):
- source commit 직후 중단 · archive 생성 후 중단 · stage 후 중단 · evidence-finalize commit 후 소비 전 중단
- 🔴 **소비 state write 후 checkpoint commit 전 중단**(r01 P1) — 재실행이 checkpoint 만 이어붙여 완주
- inventory SHA 불일치 · 허용되지 않은 untracked/staged 존재 · source tree 불일치
- 🔴 **재실행 멱등**(각 중단 지점에서 재실행이 이어붙어 완주)
- 🔴 **정상 D10 이 여전히 차단**(`recoveryAllowlist === undefined` 에서 판정 불변)
- 🔴 복구 성공 후 `verify-range --strict` 통과
- 계약 스위트 + `npx vitest run tests/unit/req-doctor.test.ts tests/unit/req-commit.test.ts`
- Codex 승인.

## 완료
- 게이트 해당분 · **통합 직전 전체 스위트 1회 + `verify-range --strict`** · 사람 승인으로 main 통합.
