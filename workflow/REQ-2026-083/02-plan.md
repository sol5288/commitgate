# REQ-2026-083 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

## Phase 1 — 런타임 안내 배선 (`phase-1-runtime-guidance`)

범위 (DEC-1 · DEC-2 · DEC-5):
- `scripts/req/lib/adapters.ts` — `CODEX_INSTALL_HINT` 상수 도입(설치 명령 + 새 터미널 안내). 표기 정본.
- `bin/init.ts` `installGuidance` — 🔴 **setup을 `req:new` 앞에** 삽입(순서 수정). `unsafe` 조기 반환 경로도 확인.
- `bin/setup.ts:612-615` — codex 미설치 메시지에 힌트 동반. 🔴 **로그인 블록(628-639)은 건드리지 않는다**(DEC-3).
- `bin/check.ts:62` — C2 실패 메시지에 힌트 동반. 읽기 전용 성질 유지.

Exit: typecheck0 · 단위 그린 · Codex phase 리뷰 승인.

## Phase 2 — 회귀 가드 (`phase-2-guards`)

범위 (DEC-4):
- **G-A**(순서): `installGuidance` 출력에서 `commitgate setup` 위치 < `req:new` 위치 — `tests/unit/init.test.ts`.
- **G-B**(동반): 메시지 빌더 배열의 **모든** 항목이 `CODEX_INSTALL_HINT`를 포함 — `tests/unit/codex-missing-guidance.test.ts`(신규).
  개수 하한(≥3) 단언으로 공회전 방지. 배열에 "새 표면은 여기 등록" 주석.
- 🔴 **두 가드 모두 변이 검사**로 실제 검출 확인. 검사 문자열이 **유일 등장**인지 먼저 확인한다
  (REQ-2026-082에서 2회 등장 문자열로 가드가 공회전한 전례).
- 신규 테스트는 **스폰 없이 import만**(스위트 지연 96%가 스폰 — REQ-2026-075).

Exit: typecheck0 · 전체 스위트 그린 · Codex phase 리뷰 승인.

## Phase 3 — CHANGELOG (`phase-3-changelog`)

범위:
- `CHANGELOG.md` `## Unreleased` 신설(0.12.1 위).
- 🔴 **phase별 구현 커밋·확인할 파일 표를 처음부터 포함** — REQ-2026-082 phase-3이 이것 없이 diff-scoped
  리뷰에서 2회 반려됐고, 그 표를 넣은 뒤 통과했다.

Exit: `docs:lint` 그린 · 단위 그린 · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(unit·typecheck) · 사용자 main 머지(별도 승인).
- 🔴 배포는 **별도 승인**(R1/R2/R3). 이 REQ는 `Unreleased`까지만 만든다.
