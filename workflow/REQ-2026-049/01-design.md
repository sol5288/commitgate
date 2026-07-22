# REQ-2026-049 설계 — DONE 게이트 fail-closed + 테스트 hermetic (P1)

> 정본: 코덱스 판정·지시(REQ-048은 P1 미해결). 본 문서는 그 지시를 현재 코드에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

**A. 테스트 Git identity** — 저장소를 만드는 테스트 헬퍼 13곳의 실태:

| 방식 | 파일 | 위험 |
|---|---|---|
| 인라인 `-c user.email=…` (호출마다) | `req-review-codex`(5) · `init`(2) · `porcelain`(1) | 🔴 repo-local 미설정 → **피시험 코드의 커밋이 전역 설정에 의존** |
| identity 아예 없음 | `migrate` · `quickstart` · `req-config` · `sync` · `req-new`(:310) | 🔴 동일 |
| repo-local `git config` | `evidence-module`(3) · `req-next`(2) · `uninstall`(1) · `smoke.mjs` | ✅ |

`vitest.config.ts`에 **`setupFiles`가 없다** → 전역/시스템 git config가 그대로 새어 들어와, 결함이 개발자 머신에서 드러나지 않는다.

**B. `verifyCommittedDesignEvidence`**(`scripts/req/lib/evidence.ts`) — 현재 검사:
1. HEAD 매니페스트 존재 · 2. 마지막 `kind=design` 행 존재 · 3. `Array.isArray(archive_inventory)` · 4. `headBlobSha256(response_path) !== null`(**존재만**) · 5. 각 inventory 항목 SHA 일치.

빠진 것: **`validateManifest` 미실행** · **top-level `response_sha256` 미대조** · **빈 배열 허용**(3의 `isArray([])`=참, 5의 `every`가 공허 참) · **집합 완전성 미확인**(HEAD의 needs-fix 라운드가 빠져도 통과).

## 핵심 설계 결정

### DEC-1 — 테스트 환경에서 global/system git config를 **차단**한다
`vitest.config.ts`에 `setupFiles`를 추가해 프로세스 환경에 다음을 심는다:

- `GIT_CONFIG_GLOBAL` → **빈 파일**(테스트 시작 시 생성). git ≥2.32에서 전역 config를 그 파일로 대체한다.
- `GIT_CONFIG_SYSTEM` → 빈 파일. 더해 `GIT_CONFIG_NOSYSTEM=1`(구버전 호환 이중 방어).
- `GIT_AUTHOR_*`/`GIT_COMMITTER_*`는 **심지 않는다** — 심으면 결함 A가 다시 가려진다. identity는 **repo-local config로만** 제공돼야 한다.

🔴 이것이 완료기준 2의 오라클이다: repo-local identity가 없는 헬퍼는 **로컬에서도 즉시 실패**하므로, "CI에서만 터지는" 상태가 구조적으로 불가능해진다.

### DEC-2 — 모든 git 저장소 헬퍼에 repo-local identity를 설정한다
`git init` 직후 `git config user.email`·`git config user.name`(repo-local)을 세팅한다. 인라인 `-c`는 **그 호출에만** 적용되므로 피시험 코드가 만드는 커밋을 보호하지 못한다 — 인라인 방식은 repo-local 설정으로 **대체**한다(인라인을 남겨 둬도 무해하나, 보호는 repo-local이 한다).

### DEC-3 — DONE 게이트를 fail-closed로 재작성한다 (정본)
`verifyCommittedDesignEvidence`가 **`HEAD`에서만** 다음을 순서대로 검증한다. 하나라도 어긋나면 즉시 미완(BLOCKED) + 사유:

1. **HEAD state 해석**: `HEAD:<ticket>/state.json`을 파싱해 `phases[].id`로 `validPhaseIds`를 만든다. 🔴 **읽기 불가·파손·`phases` 비배열이면 BLOCKED**(완료 선언은 해석 가능한 상태에서만).
2. **매니페스트 전체 검증**: `validateManifest(headManifest, { ticketRel, validPhaseIds })` 문제 0건이어야 한다 → 스키마·경로 confinement·`-approved.json` 파일명·SHA 형식·extra field·중복/주입이 여기서 전부 걸린다.
3. **design 행 선택**: 마지막 `kind==='design'` 행. 없으면 미완.
4. **top-level SHA 대조**: `headBlobSha256(row.response_path) === row.response_sha256`. **존재 확인으로 대체하지 않는다.**
5. **inventory 비어있지 않음**: `archive_inventory`가 배열이고 **길이 ≥ 1**.
6. **승인본 포함**: inventory에 `row.response_path`가 있고 그 `sha256 === row.response_sha256`.
7. **집합 완전성**: inventory의 경로 집합이 **HEAD에 존재하는 그 티켓 design 아카이브 전체 집합과 정확히 일치**(`-needs-fix`·`-approved` 모두). 빠짐(missing)과 잉여(extra) 모두 거부.
8. **각 항목 SHA 일치**: 모든 inventory 항목이 `headBlobSha256 === sha256`.

### DEC-4 — HEAD 아카이브 집합 조회 포트 추가
7을 위해 `EvidencePorts`에 **`headArchiveNames(responsesDirRel): string[]`** 를 더한다. 구현은 `git ls-tree -r --name-only HEAD -- <dir>`의 basename 중 `isArchiveFileName`인 것. 🔴 **워킹 디렉터리를 읽지 않는다** — 워킹 트리만 고치고 HEAD는 손상된 경우를 잡아야 하기 때문이다(음성 대조 항목).

### DEC-5 — 버전은 올리지 않는다
`0.9.8`은 아직 publish되지 않았다. 새 버전을 만들지 않고 **미발행 `0.9.8` 항목을 보정**한다(무엇이 실제로 보장되는지가 정확해야 한다).

### DEC-6 — 통합은 PR 경로
`[I1]` feature branch push + PR 생성 → `[I2]` required checks **9/9 green 확인 후** merge. **bypass 금지.** CI 성공이 이 REQ의 완료기준이므로 PR이 곧 검증 장치다.

## Phase별 구현

- **phase-1-hermetic-git-identity** — DEC-1 + DEC-2. setupFiles + 헬퍼 일괄 수정. 🔴 성공 기준: **전역 config가 차단된 상태에서 전체 스위트 그린**(= 결함 A가 로컬에서 재현·해소됨).
- **phase-2-done-gate-failclosed** — DEC-3 + DEC-4. 게이트 재작성 + 포트 확장 + 음성 대조 테스트.
- **phase-3-docs** — DEC-5. CHANGELOG 0.9.8 항목 보정 + troubleshooting 보강.

## 변경 파일

| Phase | 파일 |
|---|---|
| 1 | `vitest.config.ts` · `tests/setup/git-hermetic.ts`(신규) · 헬퍼 보유 테스트 8종 |
| 2 | `scripts/req/lib/evidence.ts` · `scripts/req/lib/evidence-ports.ts` · `tests/unit/evidence-module.test.ts` |
| 3 | `CHANGELOG.md` · `docs/troubleshooting.{md,en.md}` |

phase-1은 테스트 파일 수가 8을 넘을 수 있으나 **전부 동일한 기계적 변경**(identity 2줄 추가)이라 리뷰 면적은 작다. D18은 WARN 상한이라 게이트를 막지 않는다.

## 하위호환·안전

- **production 런타임 무변경**(phase-1) — 테스트 환경·픽스처만 바뀐다.
- **게이트는 더 엄격해질 뿐**(phase-2). 통과하던 정상 증거는 계속 통과하고, 통과하면 안 되던 손상 증거만 막힌다.
- **legacy 티켓은 여전히 검사 대상 아님**(marker 부재) — 기존 소비자 무회귀.
- `req:doctor`·일반 `req:commit`에는 **여전히 FAIL 게이트를 추가하지 않는다**.
- 이 REQ 자신(`REQ-2026-049`)은 marker를 갖고 생성됐으므로 **새 게이트가 실제로 자신에게 적용된다**(도그푸딩).
