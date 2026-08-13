# REQ-2026-128 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

> **테스트 실행 계층(REQ-2026-100)**: 게이트는 테스트를 **실행하지 않는다**. 아래는 비용을 줄이기 위한 실행 시점 권고다.
> - **phase 진행 중**: 변경한 소스를 import하는 테스트만(빠른 피드백). 예: `grep -rl "<변경한 모듈>" tests/`
> - **통합(main 병합) 직전 1회**: **전체 스위트**. 범위 한정은 이것을 **대체하지 않는다** — 영향 분석은 놓친 회귀를 통과시킨다.

## Phase 1 — 확인 scope SSOT 함수화 + delivery 판정 lib 이동 (`phase-1-scope-ssot`)

범위(DEC-2·DEC-4·DEC-5·DEC-6):
- `lib/evidence.ts`: `requiredConfirmScope(stopGate, {inDeliverySet})` 신설, `REQUIRED_CONFIRM_SCOPE` **제거**.
- `lib/delivery.ts`: `readDeliveryGate`·`mentionsMember` 이관(`req-next.ts` 는 re-export 유지).
- 소비자 배선: `req-next.ts`(안내) · `req-commit.ts`(`userConfirmGate`) · `req-confirm.ts`(입력 검증) · `bin/delivery.ts`(자격검사).
- `req-confirm.ts` 는 `inDeliverySet` 을 실제로 계산한다(`readDeliveryGate !== null`).

Exit: typecheck0 · `requiredConfirmScope` 진리표 5케이스 그린 · `req:confirm` 이 merge+묶음없음에서
`--scope req` 수용/`--scope delivery` 거부 · 기존 delivery/req-commit 테스트 무회귀 · Codex 승인.

## Phase 2 — merge 종단 정합 (`phase-2-merge-terminal`)

범위(DEC-1·DEC-3):
- `req-next.ts` 종단: `deliveryGate === null` 가지를 `DONE` → `AWAIT_HUMAN`(통합 feature→main).
  승인 문장·통제점은 일반 통합 경로와 같은 상수에서 파생.
- HIGH 2단계: 유효 확인(`scope==='req'`) 미기록이면 `req:confirm` 안내를 먼저 낸다.
- 기존 계약 테스트 `묶음이 없으면 DONE` 을 새 계약으로 **교체**(Red→Green).

Exit: typecheck0 · `stopGate=merge` 종단 그룹 전체 그린(`continue`=DONE 유지 회귀 포함) · Codex 승인.

## Phase 3 — 문서 정합 (`phase-3-docs`)

범위: `AGENTS.template.md`(§4 정지 지점) · `docs/workflow.md`/`.en` · `docs/configuration.md`/`.en` ·
`docs/guarantees.md`/`.en` 중 `merge` 종단을 서술한 곳 · `CHANGELOG.md`.
🔴 "새 절 추가 ≠ 갱신" — `merge` 를 언급하는 곳을 **전수 grep** 해서 옛 서술을 남기지 않는다.
등재된 폐기 주장(`lib/retired-claims.ts`)과 충돌하는 문자열이 생기는지 확인한다.

Exit: `npm run docs:lint` 통과 · 문서 가드 테스트 그린 · Codex 승인.

## 완료
- 게이트 해당분(typecheck·해당 시 lint) · **통합 직전 전체 스위트 1회** · 사용자 main 머지(별도 승인).
