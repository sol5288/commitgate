# REQ-2026-050 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

> 이 계획은 자신이 도입하는 D1 기준(책임 계약·입력·산출물·선행 phase·독립 검증 명령)을 스스로 따른다.

## Phase 1 — persona 분해 점검 기준 (`phase-1-persona-criteria`)

| 항목 | 내용 |
|---|---|
| 책임 계약 | 기본 persona 본문이 ① phase 분해 심사 3항목 ② P1 정의 불변 문구 ③ kit 관리 마커를 갖는다 |
| 입력 | 현재 `workflow/review-persona.md`(변경 전) |
| 산출물 | 개정된 `workflow/review-persona.md` · `tests/unit/review-persona.test.ts` |
| 선행 phase | 없음 |
| 독립 검증 | `npx vitest run tests/unit/review-persona.test.ts` · `npm run typecheck` |

**범위**: persona 본문 개정 + 존재 계약 테스트. 코드 경로 변경 없음.

**Red 먼저**: 개정 전 persona에 대해 테스트가 실패해야 한다 — 마커 부재·분해 항목 부재·P1 불변 문구 부재 3건. 테스트는 `PACKAGE_ROOT/workflow/review-persona.md`를 직접 읽어 검증한다(SUT 상수를 기대값으로 재사용하지 않는다 — tautology 금지).

**Exit**: typecheck 0 · 단위 그린 · Codex phase 리뷰 승인.

**독립성 근거**: 마커가 추가돼도 이를 읽는 소비자는 phase-2까지 없다. `loadReviewPersona`는 본문 형식을 검사하지 않으므로 이 phase만 커밋해도 리뷰 동작이 깨지지 않는다.

## Phase 2 — sync managed-drift 경로 (`phase-2-sync-managed-drift`)

| 항목 | 내용 |
|---|---|
| 책임 계약 | `sync --persona`가 마커 유무로 2분기하고, 적용 전 실제 내용 diff를 보여주며, `--persona-apply`가 백업·diff 이중 fail-closed로 교체한다 |
| 입력 | phase-1이 도입한 마커 · 기존 `planSync` 5상태 |
| 산출물 | `bin/sync.ts`(status·plan·render·diff 러너·인자) · `tests/unit/sync.test.ts` · 문서 4종 |
| 선행 phase | phase-1 (마커가 없으면 판정이 성립하지 않는다) |
| 독립 검증 | `npx vitest run tests/unit/sync.test.ts` · `npm run typecheck` · 임시 git 저장소 fixture 실행 |

**범위**: `AssetStatus`에 `managed-drift` 추가 · `planSync`의 persona 분기 확장 · `renderPlan`의 GLYPH/LABEL · `git diff --no-index` 위임 러너(주입 가능) · `--persona-apply` 인자 · 백업 쓰기 · 문서.

**Red 먼저**

| # | oracle |
|---|---|
| ① | 마커 有·내용 다름 → status `managed-drift` |
| ② | 마커 無·다름 → status `preserved-differs` |
| ③ | `--persona-apply` 없으면 `writes` 0건(dry-run·apply 모두) — 두 status 모두 |
| ④ | 두 status 모두 `--apply` 없이도 **실제 내용 diff 행**(`+`/`-` 접두 실 변경행)이 출력에 포함 |
| ⑤ | diff가 200행 초과면 절단 표시 + shipped 절대경로가 출력에 포함 |
| ⑥ | `--persona-apply` 경로에서 diff 출력이 파일 쓰기보다 **먼저** 발생(순서 검증 — 러너/쓰기 stub의 호출 순서) |
| ⑦ | diff 러너가 exit≥2로 실패 → 교체 안 함(`writes` 0건) |
| ⑧ | 백업 쓰기 실패 → 교체 안 함 |
| ⑨ | `--persona-apply` 정상 경로 → `.bak` 생성 후 교체 — **`preserved-differs`(마커 無)에서도 성립**(pre-050 마이그레이션 정상 경로) |
| ⑩ | `--persona` 없이 `--persona-apply`만 → persona 축 완전 미접촉 |
| ⑪ | `preserved-differs` 출력에 "사용자 작성분일 수 있음" 경고가 포함되고 `managed-drift` 출력에는 없다(경고 강도 분기) |
| ⑫ | `unmanaged-null`·`unmanaged-custom`은 `--persona-apply`가 있어도 `writes` 0건 |

diff 러너는 주입 가능하게 두고 테스트는 stub을 쓴다 — 실제 `git`을 호출하지 않는다(④⑤는 stub이 반환한 텍스트로 검증). 실 git 경로는 임시 저장소 fixture 스모크로 별도 확인한다.

**Exit**: typecheck 0 · 단위 그린 · Codex phase 리뷰 승인.

**숨은 결합 점검**: phase-2의 인수 기준은 phase-1 산출물(마커)만 요구하고 후속 phase를 요구하지 않는다. phase-1은 phase-2 없이도 인수 기준이 성립한다(위 독립성 근거).

## 검증 fixture 정책

`44_yammy_sales`는 **읽기 전용 분석 대상**이다. 어떤 파일도 생성·수정·stage·commit·설치하지 않는다. migration 실동작 검증은 `git init`한 임시 저장소에 kit 자산을 복사해 수행하고, 완료 보고에 `44_yammy_sales` 무변경 확인 결과를 포함한다.

## 완료
- 게이트 해당분(unit·typecheck·lint) · 사용자 main 머지(별도 승인).
