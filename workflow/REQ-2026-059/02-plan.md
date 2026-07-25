# REQ-2026-059 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

## Phase 1 — 픽스처 정리 결정화 (`phase-1-deterministic-fixture-cleanup`)

범위(설계 DEC-1·DEC-2·DEC-3): `tests/unit/state-checkpoint.test.ts`의 두 픽스처에
`gc.auto=0`·`maintenance.auto=false` 설정 + 정리 `rmSync`에 `maxRetries`/`retryDelay`. 변경 파일 1개.

순서:
1. 픽스처 생성부에 auto 유지보수 차단 설정 추가(원인 제거)
2. 정리부에 재시도 옵션 추가(보험)
3. `npm test` 전체 + `tsc --noEmit`
4. 반영 후 **CI 9 job green 확인**이 최종 오라클 — 실패가 ubuntu·node 20에서만 났으므로 로컬 통과만으로는
   해결을 주장할 수 없다

Exit: typecheck 0 · `npm test` green · Codex phase 리뷰 승인 · CI 9/9 green.

## 완료
- 게이트 해당분(unit·typecheck) · 사용자 main 통합(별도 승인).
