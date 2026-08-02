# REQ-2026-110 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

> **테스트 실행 계층(REQ-2026-100)**: 게이트는 테스트를 **실행하지 않는다**. 아래는 비용을 줄이기 위한 실행 시점 권고다.
> - **phase 진행 중**: 변경한 소스를 import하는 테스트만(빠른 피드백). 예: `grep -rl "<변경한 모듈>" tests/`
> - **통합(main 병합) 직전 1회**: **전체 스위트**. 범위 한정은 이것을 **대체하지 않는다** — 영향 분석은 놓친 회귀를 통과시킨다.

## Phase 1 — D28: HIGH 확인 차단 진단 (`phase-1-d28-high-confirm`)

**선행 조건: 없음.**

범위(5파일):

- `scripts/req/req-doctor.ts`
  - `D_CHECK_IDS`에 `'D28'` 등재(DEC-5)
  - `DoctorInputs`에 `highConfirm?: { blocked: boolean; reason?: string }`(DEC-2). **`undefined` = 판정 불요 → OK**(무회귀)
  - D28 체크 추가: `blocked`면 **WARN**(사유 그대로, DEC-3), 아니면 OK. 🔴 **FAIL 분기를 만들지 않는다**(DEC-4 — 사유를 주석에 명시)
  - `main()`이 `userConfirmGate(state, cfg.stopGate, wouldCompleteReq({...}).complete)`로 입력을 채운다(DEC-1). 매니페스트는 `:1198`이 이미 읽는 것을 재사용
  - ⚠️ `./req-commit` import 후 **typecheck로 정적 순환이 없음을 확인**(spawn이라 없을 것으로 보지만 확인한다)
- `docs/ssot-design/07-business-rules-and-state-machines.md` — §3 표에 D28 행 추가(DEC-5)
- `tests/unit/req-doctor.test.ts` — 회귀:
  1. `highConfirm: {blocked:true, reason:'…req:confirm…'}` → D28 **WARN**이고 메시지에 사유가 **그대로** 들어 있다
  2. 같은 입력에서 **FAIL 0건**(exit 불변 — 진단이 게이트가 되지 않는다)
  3. `blocked:false` → OK · `undefined`(미지정) → OK(무회귀)
- `tests/unit/docs-stale-claims.test.ts` — "죽은 항목 탐지"에 D28이 발화하는 변형 추가(DEC-5)
- `CHANGELOG.md` — Unreleased

🔴 **변이검사**: D28을 등재만 하고 push하지 않으면 "죽은 항목 탐지"가 실패해야 한다. 편집으로 되돌린다(`git checkout --` 금지).

🔴 **실제 실행 확인**: 순수 테스트는 배선 끊김을 못 잡는다(REQ-099·105·107에서 반복 실증). HIGH 티켓을 만들어 `npx tsx scripts/req/req-doctor.ts <REQ>`로 D28 출력과 **exit 0**을 눈으로 확인한다.

Exit: typecheck 0 · `req-doctor`·`docs-stale-claims` 테스트 그린 · 변이검사 · 실제 실행 확인 · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(typecheck·해당 시 lint) · **통합 직전 전체 스위트 1회** · 사용자 main 머지(별도 승인).
