# REQ-2026-049 리뷰 요청 — DONE 게이트 fail-closed + 테스트 hermetic (P1)

## 배경

REQ-2026-048이 `main`(`cc1e755`)에 통합됐으나 **P1은 해결되지 않았다**는 판정을 받았다. 이 REQ는 REQ-048을 **수정하지 않고** clean `cc1e755`에서 갈라져 두 결함을 고친다.

**결함 A — CI 6/9 실패.** `cc1e755` CI는 macOS 3개만 성공하고 ubuntu·windows 6개가 실패했다. 원인은 production이 아니라 테스트 fixture다 — 헬퍼들이 `git -c user.email=… -c user.name=…`처럼 **호출마다 인라인으로만** identity를 주고 repo-local config를 설정하지 않아, REQ-048이 도입한 **자동 evidence commit**(bare `git commit`)이 **runner 전역 설정에 의존**했다. 로컬 Windows에서 317개가 통과한 것도 로컬 identity 덕분이라 검증 근거가 못 된다.

**결함 B — DONE 게이트 fail-open.** `verifyCommittedDesignEvidence`가 커밋된 매니페스트에 `validateManifest`를 돌리지 않고 마지막 design 행만 느슨히 읽는다. 그래서 `archive_inventory: []`(공허 참), `response_path`를 HEAD의 임의 blob으로 지정, `response_sha256` 불일치가 **전부 통과**한다. "HEAD blob에서 매니페스트·아카이브·SHA를 검증한다"는 완료기준을 충족하지 못한다.

## ⚠️ 리뷰어 필독 — phase 경계

이 REQ는 **phase별로 따로 커밋·리뷰**된다(02-plan). **현재 staged diff에 없다고 해서 REQ가 그것을 안 한다는 뜻이 아니다.**

- **phase-1(커밋 `28a0970`, 통합됨) — 테스트 환경·fixture 전용.** `vitest.config.ts` setupFiles + `tests/setup/git-hermetic.ts` + 저장소 헬퍼 8종의 repo-local identity. **production 런타임은 한 줄도 바꾸지 않는다.** 결함 A(CI 6/9 실패)만 다룬다.
- **phase-2(커밋 `539990a`, 통합됨) — DONE 게이트 fail-closed(결함 B).** `verifyCommittedDesignEvidence` 8단계 재작성 · `validateManifest` 호출 · top-level SHA 대조 · inventory 비어있지 않음 · HEAD 아카이브 **집합 정확 일치** · `headArchiveNames` 포트 추가 · 음성 대조 11종. **이 코드는 phase-1 diff에 없는 것이 정상이다.**
- **phase-3(현재 리뷰 대상) — 문서 보정 + 앞선 리뷰 관찰 정리.** 미발행 `0.9.8` CHANGELOG 항목을 **실제 보장에 맞게** 보정 · troubleshooting 한/영 · migrate fixture 중복 identity 제거(phase-1 관찰). **버전 상향 없음**(0.9.8 미발행).

phase-1을 별도로 둔 이유: 결함 A는 **결함 B의 수정을 검증할 수 없게 만드는 선행 장애**다. 전역 identity에 기대는 테스트 위에서 게이트를 고치면 그 검증이 다시 환경에 좌우된다. 그래서 오라클(전역 차단)을 먼저 세운다.

## 변경 요약

3 phase.

1. **phase-1** — `vitest.config.ts`에 `setupFiles` 추가(`GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM`을 빈 파일로, `GIT_CONFIG_NOSYSTEM=1`) + 저장소를 만드는 **모든** 테스트 헬퍼에 repo-local identity. 🔴 `GIT_AUTHOR_*`는 심지 않는다 — 심으면 결함이 다시 가려진다. 성공 기준은 **전역 차단 상태에서 전체 스위트 그린**.
2. **phase-2** — 게이트 8단계 fail-closed 재작성: HEAD state 파싱(파손 시 BLOCKED) → `validateManifest` 전량 → design 행 → **top-level SHA 대조** → inventory **비어있지 않음** → **승인본 정확 SHA 포함** → **HEAD의 design 아카이브 전체 집합과 정확히 일치** → 각 항목 SHA 일치. 이를 위해 `headArchiveNames` 포트 추가(`git ls-tree` — **워킹 디렉터리 미조회**).
3. **phase-3** — 미발행 `0.9.8` CHANGELOG 항목 보정 + troubleshooting. **버전 상향 없음**(0.9.8 미발행).

**통합은 PR 경로**(`[I1]`→`[I2]` 9/9 green 확인 후 merge). **bypass 금지.** publish/tag/release는 계속 보류.

> phase-2 구현 중 확인한 제약(설계에 없던 사실): `state.json`은 스캐폴드 이후 **재커밋되지 않으므로**(evidence 커밋은 pathspec으로 `responses/`만 담는다) HEAD의 `phases`는 **항상 `[]`**다(REQ-047/048/049 실측). 따라서 `validPhaseIds`를 HEAD state에서 만들면 **정상 증거가 전부 차단**된다. 그래서 `validPhaseIds`는 **매니페스트 자신의 phase 행 id**로 구성해 **phase_id 멤버십 검사만** 무효화했다 — 그 바인딩은 커밋 시점에 `evidencePreflight`가 이미 강제한다. 무효화되는 것은 그 하나뿐이며 스키마·confinement·approved 파일명·SHA·extra field·중복·design 행 제약은 전부 강제되고, 그 사실을 전용 테스트로 고정했다.

## 리뷰 포인트

1. **DEC-1의 차단 방식** — `GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM`/`GIT_CONFIG_NOSYSTEM` 조합이 지원 git 버전 범위에서 충분한가. `GIT_AUTHOR_*`를 심지 않는 결정이 옳은가(심으면 편하지만 결함이 다시 숨는다).
2. **DEC-2의 완전성** — 저장소를 만드는 헬퍼를 빠짐없이 찾았는가(`git init` 13곳 조사). 앞으로 새 헬퍼가 추가될 때 이 규율이 깨지지 않게 할 수단이 필요한가(예: 차단 자체가 오라클이므로 충분한지).
3. **DEC-3의 8단계가 fail-open을 남기지 않는가** — 특히 ①빈 inventory ②집합 완전성(빠짐·잉여) ③top-level SHA ④`validateManifest`가 실제로 confinement·파일명·extra field를 다 막는지. 더 필요한 검사가 있는가.
4. **집합 완전성의 경계** — "HEAD의 그 티켓 design 아카이브 **전체**와 정확히 일치"가 재승인(design 행 2개) 상황에서 옳은가. 마지막 행의 inventory가 이전 라운드까지 포함하므로 일치하지만, 그 전제가 깨지는 경우가 있는가.
5. **DEC-4의 조회원** — `git ls-tree -r --name-only HEAD -- <dir>`가 워킹 디렉터리를 전혀 보지 않음이 확실한가. 경로 인용(비ASCII·공백)에서 안전한가.
6. **phase-1의 파일 수** — 테스트 8종을 한 phase에서 고치는 것이 리뷰 면적으로 적절한가(변경은 기계적 2줄이지만 D18 권고를 넘는다).
7. **놓친 축** — 음성 대조 11종 외에 고정해야 할 시나리오가 있는가. 특히 "워킹 트리만 고치고 HEAD 손상" 케이스의 구성이 실제로 온디스크 미조회를 증명하는가.
