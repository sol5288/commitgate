# REQ-2026-049 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> 게이트 명령은 `typecheck`(`tsc --noEmit`) · `test`(`vitest run`) · `smoke` · `docs:lint`다(이 저장소에 `lint` 스크립트는 없다).
>
> 🔴 이 REQ의 최종 완료기준은 **9/9 CI 성공 + fresh-clone 검증**이다. 로컬 그린은 필요조건일 뿐 충분조건이 아니다 — 결함 A가 정확히 "로컬은 통과, CI는 실패"였다.

## Phase 1 — 테스트 Git identity hermetic (`phase-1-hermetic-git-identity`)

범위: `vitest.config.ts`에 `setupFiles` 추가 + `tests/setup/git-hermetic.ts` 신규 — `GIT_CONFIG_GLOBAL`·`GIT_CONFIG_SYSTEM`을 빈 파일로, `GIT_CONFIG_NOSYSTEM=1`(DEC-1). 🔴 `GIT_AUTHOR_*`/`GIT_COMMITTER_*`는 **심지 않는다**(심으면 결함이 다시 가려진다). 그 위에서 저장소를 만드는 **모든** 헬퍼에 repo-local `user.email`·`user.name`을 설정(DEC-2).

대상: `req-review-codex`(5) · `init`(2) · `porcelain`(1) · `migrate` · `quickstart` · `req-config` · `sync` · `req-new`(:310). 이미 repo-local인 곳(`evidence-module`·`req-next`·`uninstall`)은 무변경.

🔴 **성공 기준 = 전역 config 차단 상태에서 전체 스위트 그린.** 이것이 완료기준 2의 오라클이다.

음성 대조: setupFiles가 실제로 전역을 차단하는지 확인(차단 하에서 repo-local 없는 임시 저장소의 `git commit`이 실패함을 단언).

Exit: `tsc --noEmit` 0 · **전체 스위트 그린** · `req:doctor` PASS · Codex phase 리뷰 승인.

## Phase 2 — DONE 게이트 fail-closed (`phase-2-done-gate-failclosed`)

범위: `verifyCommittedDesignEvidence`를 DEC-3의 8단계로 재작성 + `EvidencePorts.headArchiveNames` 추가(DEC-4, `git ls-tree` 기반 — **워킹 디렉터리 미조회**).

음성 대조 테스트(완료기준 4 전량):
1. **빈 inventory**(`[]`) → 미완 (공허 참 회귀 고정)
2. **inventory에서 needs-fix 누락** → 미완(집합 완전성)
3. **inventory에 잉여 항목** → 미완
4. **top-level `response_sha256` 불일치** → 미완(존재만으로 통과 금지)
5. **`response_path`가 HEAD의 임의 blob**(아카이브 아님/타 티켓) → 미완(`validateManifest` confinement·파일명)
6. **extra field 주입** → 미완
7. **`response_path`가 `-needs-fix.json`** → 미완(approved 파일명 규칙)
8. **매니페스트 malformed·중복 행** → 미완
9. 🔴 **워킹 트리만 고치고 HEAD는 손상** → 미완(온디스크를 보지 않음을 증명)
10. **HEAD state 파손·`phases` 비배열·부재** → 미완
11. 정상 완비 → durable(위양성 없음)

Exit: `tsc --noEmit` 0 · 전체 스위트 그린 · `req:doctor` PASS · Codex phase 리뷰 승인.

## Phase 3 — 문서 보정 (`phase-3-docs`)

범위: 미발행 `0.9.8` CHANGELOG 항목을 **실제 보장에 맞게 보정**(DONE 게이트가 무엇을 검증하는지, 테스트 hermetic). troubleshooting 한/영에 BLOCKED 사유가 세분화됨을 반영. **버전은 올리지 않는다**(0.9.8 미발행 — DEC-5).

> 리뷰 주의: 앞 phase의 런타임을 문서화하므로 diff-scoped 리뷰에서 근거 부재 오탐이 날 수 있다. `codex-request.md`의 phase 경계 절에 선행 phase 커밋 SHA를 적어 해소한다.

Exit: `tsc --noEmit` 0 · 전체 스위트 그린 · `docs:lint` 0 · `smoke` 0 · `req:doctor` PASS · Codex phase 리뷰 승인.

## 완료

- 게이트 해당분 + **🔴 `[I1]` PR 생성 → `[I2]` 9/9 CI green 확인 후 merge**(사용자 승인). **branch protection bypass 금지**(DEC-6).
- **fresh-clone 검증** 후에야 "P1 해결" 선언 가능. `0.9.8` publish/tag/release는 **계속 보류**.
- 비목표: REQ-048 커밋 수정 · 버전 상향 · publish · 승인 판정 로직 변경 · doctor/req:commit FAIL 추가.
