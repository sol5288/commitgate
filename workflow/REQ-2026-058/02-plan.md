# REQ-2026-058 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

## Phase 1 — 워크플로 안내·진단 (`phase-1-workflow-guidance`)

범위(설계 DEC-1·DEC-2·DEC-5): F-3 커밋 명령 자리표시자 + F-5 HEAD 부재 조회 stderr 억제(4 호출부).
변경 파일 6개.

Test-First 순서:
1. Red:
   - `req:next` AWAIT_HUMAN 명령 문자열에 메시지 자리표시자가 있고, LOW 자동 경로와 **같은 상수**를 쓴다
   - 승인 경로를 near-e2e로 돌렸을 때 **자식 stderr에 `fatal:`이 없다** —
     음성 대조: stderr 억제를 뺀 조회는 실제로 `fatal:`을 낸다는 것을 같은 픽스처로 먼저 확인
2. 구현(Green)
3. 전체 스위트

Exit: typecheck 0 · `npm test` green · Codex phase 리뷰 승인.

## Phase 2 — 설치·제거 안내 (`phase-2-install-uninstall-guidance`)

범위(설계 DEC-3·DEC-4·DEC-5): F-4 lockfile 문구 · F-6 revert 파급 경고(조건부) · F-7 `scripts/` 제거 ·
F-8 not-installed 증거 고지 · F-9 `_npx` 범위. 변경 파일 3개.

Test-First 순서:
1. Red(전부 순수 함수 문자열 단언):
   - 도입 커밋이 `workflow/.gitignore`를 담고 **보존할 티켓 증거가 있을 때만** revert 경고가 나온다
     (증거 없으면 나오지 않는다 — 소음 방지)
   - Stage B 설치본 계획에 `scripts/`가 없다
   - `not-installed`인데 티켓 증거가 있으면 그 사실이 출력된다
   - `_npx` 절이 "모든 npx 패키지"임을 밝힌다
   - Stage B 설치 안내에 잘못된 lockfile 인과 문장이 없다
2. 구현(Green)
3. 전체 스위트

Exit: typecheck 0 · `npm test` green · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(unit·typecheck) · 사용자 main 통합(별도 승인 — REQ-2026-057과 함께).
