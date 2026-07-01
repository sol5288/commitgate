# REQ-2026-002 계획 — phase 분해

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고.

## Phase 1 — `.cmd` 주입 정식 테스트 (#3) (`phase-1-cmd-injection-test`)
범위: `tests/unit/req-adapters-cmd.test.ts`(Windows-가드) + node recorder 픽스처. `.cmd`가 `node recorder.js %*` 호출 → `safeSpawnSync(..., { cwd: tmpDir })`에 메타문자 인자(주입 출력은 tmpDir 하위 절대경로) → (1) tmpDir의 `injected.txt` 미생성 (2) recorder argv == 원본. 비-Windows skip.
Exit: typecheck 0 · 기존 유닛 무손상 · (Windows) `.cmd` 테스트 green / (비-win) skip · Codex phase 리뷰 승인.

## Phase 2 — 크로스플랫폼 CI + smoke (#2) (`phase-2-ci-matrix-smoke`)
범위: `scripts/smoke.mjs`(pack→임시 target 설치→`npx commitgate --dry-run` rc=0) + `package.json` `scripts.smoke` + `.github/workflows/ci.yml`(3 OS × Node 18/20/22: `npm ci`→typecheck→test→smoke). 배포 게이트 문서 1줄.
Exit: 로컬 `npm run smoke` rc=0 · typecheck 0 · Codex phase 리뷰 승인 · (푸시 후) CI 매트릭스 green 확인.

## 완료
- 게이트 해당분(typecheck·unit·smoke) · 사용자 main 머지·push(별도 승인).
- #1(cross-spawn 버전 하한)은 **별도 REQ**.
