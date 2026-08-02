# REQ-2026-107 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

> **테스트 실행 계층(REQ-2026-100)**: 게이트는 테스트를 **실행하지 않는다**. 아래는 비용을 줄이기 위한 실행 시점 권고다.
> - **phase 진행 중**: 변경한 소스를 import하는 테스트만(빠른 피드백). 예: `grep -rl "<변경한 모듈>" tests/`
> - **통합(main 병합) 직전 1회**: **전체 스위트**. 범위 한정은 이것을 **대체하지 않는다** — 영향 분석은 놓친 회귀를 통과시킨다.

## Phase 1 — D18을 리뷰 게이트와 같은 판정으로 (`phase-1-d18-parity`)

**선행 조건: 없음.**

범위(3파일):

- `scripts/req/req-doctor.ts`
  - `DoctorInputs`에 `declaredMaxFiles?: number | null`·`stagedCodeFiles?: string[]` 추가(DEC-2·3)
  - D18이 `judgePhaseArea`(review-codex 정본)를 호출하도록 전환(DEC-1). **판정 로직을 복사하지 않는다**
  - 메시지에 임계 출처(선언/권고)를 반영(DEC-4). 기존 `gate` 종속 문구는 유지
  - `main()`이 `declaredPhaseMaxFiles(state, state.current_phase)`·`phaseCodeFiles(staged, ticketRel)`로 새 입력을 채운다
  - 🔴 D13은 **건드리지 않는다**(계속 `codeChanges`)
- `tests/unit/req-doctor.test.ts` — 회귀:
  1. 선언 `max_files: 20` + 10파일 → **OK**(오탐 없음) ← 이 REQ가 고치는 것
  2. 선언 없음 + 10파일 → **WARN**(기존 동작 보존)
  3. 선언 `max_files: 5` + 10파일 → WARN이고 문구가 **선언 상한 5**를 가리킨다(DEC-4)
  4. D18이 WARN이어도 **exit code는 0**(FAIL 아님 — 교착 방지 계약)
- `CHANGELOG.md` — Unreleased 항목. **소비자 관측 변화가 있는 첫 항목**임을 명시(A트랙과 구분)

🔴 **변이검사**: `judgePhaseArea` 호출에서 `declared` 인자를 `null`로 고정하면 회귀 1이 실패해야 한다. 편집으로 되돌린다(`git checkout --` 금지).

🔴 **실제 실행 확인**: 순수 테스트는 배선 끊김을 못 잡는다(REQ-099·105에서 3연속 실증). `max_files`를 선언한 실제 티켓에서 `npx tsx scripts/req/req-doctor.ts <REQ>`를 돌려 D18 출력을 눈으로 확인한다.

Exit: typecheck 0 · `req-doctor` 테스트 그린 · 변이검사 · 실제 실행 확인 · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(typecheck·해당 시 lint) · **통합 직전 전체 스위트 1회** · 사용자 main 머지(별도 승인).
