# REQ-2026-165 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **테스트 실행 계층(REQ-2026-100)**: 게이트는 테스트를 **실행하지 않는다**.
> phase 중에는 **변경한 소스를 import 하는 테스트만**, **전체 스위트는 통합 직전 1회**(~17분).

## Phase 1 — 술어를 leaf 로 (`phase-1-install-shape-leaf`)

범위: `scripts/req/lib/install-shape.ts`(신규) · `scripts/req/req-doctor.ts`(re-export) · 관련 테스트.

- `classifyInstallMode` · `unprotectedRepoRootScratch` 를 leaf 로 옮기고 `req-doctor` 가 **re-export** 한다.
- 🔴 **동작 변경 0** — 기존 호출부·테스트가 그대로 통과해야 한다(`successorSlug` 이동과 같은 방식).

Exit: typecheck 0 · `req-doctor`·`doctor-*` 테스트 전부 그린(무회귀) · Codex phase 리뷰 승인.

## Phase 2 — 축 판정 (`phase-2-upgrade-status`)

범위: `scripts/req/lib/upgrade-status.ts`(신규) · `tests/unit/upgrade-status.test.ts`(신규).

- `UPGRADE_AXES` 를 **순회**해 축별 `AxisState`(`ok`|`action`|`unknown`|`manual`)를 낸다.
- 판정은 **순수**, 입력 수집(`collectUpgradeStatusInput`)은 분리(설계 DEC-2).
- 🔴 술어 **재구현 0** — 기존 함수를 부른다.
- 🔴 판정 불가는 `unknown` 이지 `action` 이 아니다. `caret-range` 는 `manual`.

Exit: typecheck 0 · 신규 테스트 그린(축 전수 · 각 상태 · 판정 불가) ·
**변이 검사**(등록부에 축을 더하면 판정 결과 개수가 따라 늘어남 — 목록 하드코딩 부재 증명) ·
Codex phase 리뷰 승인.

## Phase 3 — `check` C7 배선 (`phase-3-check-c7`)

범위: `bin/check.ts` · 기존 check 테스트 확장.

- `CheckItem.id` 에 `'C7'` 추가(**뒤에만** — 기존 순서 계약 불변).
- `collectInputs` 가 축 상태를 수집해 `runChecks` 로 넘긴다(순수 유지).
- 축별 줄 + 정본 링크. 🔴 **WARN 상한** · 미수집이면 점검 불요.
- `--help` 의 점검 항목에 C7 추가(기존 help 가드가 모든 id 를 요구한다).

Exit: typecheck 0 · `collectInputs` → `runChecks` **실경로** 테스트 그린 ·
**실제 소비자 설치본(`45_MBTI_kiosk`)에서 8축이 나오는지 실행 확인** ·
exit 계약 회귀(축 WARN 만으로 exit 1 이 되지 않음) · Codex phase 리뷰 승인.

## Phase 4 — 문서 + CHANGELOG (`phase-4-docs-changelog`)

범위: `docs/upgrade.md` · `docs/upgrade.en.md` · `CHANGELOG.md`.

- 정본 표 앞에 **"확인 방법: `npx commitgate check`"** 를 명시한다(축 표가 곧 그 출력의 설명이 되게).
- 🔴 REQ-2026-164 의 가드가 살아 있으므로 표 구조를 깨지 않는다(축 행·토큰 불변).

Exit: `npm run docs:lint` 그린 · `upgrade-axes` 가드 그린 · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(typecheck·docs:lint) · **통합 직전 전체 스위트 1회** · 사용자 main 머지(별도 승인).
