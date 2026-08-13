# REQ-2026-129 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

> **테스트 실행 계층(REQ-2026-100)**: 게이트는 테스트를 **실행하지 않는다**. 아래는 비용을 줄이기 위한 실행 시점 권고다.
> - **phase 진행 중**: 변경한 소스를 import하는 테스트만(빠른 피드백). 예: `grep -rl "<변경한 모듈>" tests/`
> - **통합(main 병합) 직전 1회**: **전체 스위트**. 범위 한정은 이것을 **대체하지 않는다** — 영향 분석은 놓친 회귀를 통과시킨다.

## Phase 1 — 스냅샷 기록 + 해소 함수 배선 (`phase-1-snapshot-core`)

범위(DEC-1·DEC-2·DEC-3·DEC-5):
- `WorkflowState`에 선택 필드 `policy_snapshot`(state는 AJV 검증을 받지 않으므로 스키마 변경 없음).
- `lib/config.ts`: `effectiveStopGate(state, cfg)` 신설(손상값은 config로 폴백).
- `req:new`: 해소값을 스냅샷에 기록.
- 소비자 배선 **다섯 곳 전부**: `req:next` · `req:commit` · `req:confirm` · `bin/delivery` ·
  **`req:doctor`의 기존 D28 HIGH 확인 판정**.
  🔴 doctor 를 뒤 phase 로 미루면 그 사이 릴리스에서 D28만 config 를 보고 나머지는 스냅샷을 봐서
  **같은 티켓을 두 정책으로 판정**한다(설계가 금지한 상태). 배선은 한 phase 에서 끝낸다.

Exit: typecheck0 · 진리표(스냅샷 있음/없음/손상) 그린 · **다섯 소비자가 같은 값을 쓴다는 일관성 테스트**
(스냅샷≠config 상황에서 D28과 `req:commit` 게이트가 같은 판정) · 기존 stopGate 테스트 무회귀 · Codex 승인.

## Phase 2 — `req:repolicy` 채택 경로 (`phase-2-repolicy-verb`)

범위(DEC-4 후반): 신규 verb(파싱 fail-closed · DRY-RUN 기본 · append-only `adopted` 기록 ·
실제 시계 주입 · state checkpoint 커밋) + `bin/dispatch.mjs`·Stage B 스크립트 주입 배선.

🔴 **배선 끊김은 순수 테스트가 못 잡는다**(REQ-2026-090·099 실측) — dispatch 해석과 Stage B 목록을
실제 진입점으로 검사한다.

Exit: typecheck0 · verb 테스트 그린(거부·DRY-RUN 무기록·기록 형식) · dispatch/Stage B 배선 검사 · Codex 승인.

## Phase 3 — 드리프트 진단 + 문서 (`phase-3-drift-doctor-docs`)

범위(기존 D28 전환은 phase-1에서 끝났고, 여기서는 **새 체크만** 추가한다):
`req:doctor` 새 체크(스냅샷↔config 불일치·손상 스냅샷 → **WARN**, 채택 명령 안내) ·
`docs/configuration*.md`(정책 스냅샷 절) · `docs/workflow*.md`(해당 시) · `CHANGELOG.md` ·
D-체크 표 등재(REQ-2026-099 — 등록부 누락 금지).

Exit: typecheck0 · doctor 체크 테스트 그린 · `npm run docs:lint` · 문서 가드 그린 · Codex 승인.

## 완료
- 게이트 해당분(typecheck·해당 시 lint) · **통합 직전 전체 스위트 1회** · 사용자 main 머지(별도 승인).
