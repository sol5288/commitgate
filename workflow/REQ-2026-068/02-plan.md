# REQ-2026-068 계획 — phase 분해

설계 승인 후 phase별 진행.

## Phase 1 — 전역 차단 + 오라클 (`phase-1-hermetic-maintenance`)

범위(DEC-1~DEC-3): `tests/setup/git-hermetic.ts` · `tests/unit/git-hermetic.test.ts` ·
`tests/unit/req-review-codex.test.ts`(afterEach 한 줄). 코드 3파일.

순서:
1. `HERMETIC_GITCONFIG`에 `[gc] auto = 0` · `[maintenance] auto = false`를 더한다(DEC-1).
   🔴 두 키를 **모두** — git 버전에 따라 자동 실행 경로가 다르다.
2. 🔴 오라클(DEC-3): 임시 저장소를 **실제로 `git init`** 하고 `git config --get gc.auto` == `0`,
   `maintenance.auto` == `false`를 확인한다. 문자열 단언만 하면 tautology다.
3. identity 차단 4경로 회귀 가드가 그대로 통과하는지 확인(기존 테스트 무수정).
4. 실패한 `req-review-codex.test.ts`의 `afterEach`에 `maxRetries`/`retryDelay`(DEC-2).
   🔴 나머지 19개 파일은 건드리지 않는다 — 원인이 사라졌고, 무관한 diff는 리뷰를 흐린다.

Exit: typecheck 0 · `npm test` green · Codex 승인 · **전 OS CI green**(이 REQ의 실질 오라클).

## 완료
- 게이트 해당분 · 사용자 main 통합(별도 승인).
- 🔴 로컬 green은 이 REQ의 증명이 아니다 — 실패는 macOS 한 job에서만 났다. **CI가 오라클**이다.
