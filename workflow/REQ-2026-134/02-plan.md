# REQ-2026-134 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

> **테스트 실행 계층(REQ-2026-100)**: 게이트는 테스트를 **실행하지 않는다**. 아래는 비용을 줄이기 위한 실행 시점 권고다.
> - **phase 진행 중**: 변경한 소스를 import하는 테스트만(빠른 피드백). 예: `grep -rl "<변경한 모듈>" tests/`
> - **통합(main 병합) 직전 1회**: **전체 스위트**. 범위 한정은 이것을 **대체하지 않는다** — 영향 분석은 놓친 회귀를 통과시킨다.

## Phase 1 — 단일 resolver + 배선 (`phase-1-resolver`)

범위(DEC-1·DEC-2·DEC-3):
- `lib/config.ts`: `ExecutionPolicy` 타입 + `effectiveExecutionPolicy(state, cfg)`
  (스냅샷 → `AUTO_APPROVE_OF` 파생 · legacy → config 두 축 그대로).
- `req-next.ts` main: 세 입력(`stopGate`·`phaseCommitAutoApprove`·`deliveryGate`/`completesReq` 조건)을
  **정책 객체 하나**에서 파생.
- 회귀: 해소 진리표(스냅샷/legacy/손상) + **소스 검사** — `req-next.ts`에 `cfg.phaseCommit` 참조 0건.

Exit:
```sh
npm run typecheck
npx vitest run tests/unit/policy-snapshot.test.ts tests/unit/req-config.test.ts
```
· 진리표 그린 · 소스 검사 그린 · Codex 승인.

## Phase 2 — 교차 설정 재현(실 git main 배선) (`phase-2-crossconfig`)

범위(DEC-4): `req:next` **main()** 을 실제 git 저장소에서 태워 4종을 고정한다.

| # | 스냅샷 | config | 기대 |
|---|---|---|---|
| 1 | `merge` | `phase` | `RUN`(자동 커밋) |
| 2 | `phase` | `merge` | `AWAIT_HUMAN` |
| 3 | 없음 | `phase` | `AWAIT_HUMAN` |
| 4 | 없음 | `merge` | `RUN` |

🔴 3·4를 **함께** 둔다 — 한쪽만이면 "legacy가 config를 따른다"가 상수 고정과 구별되지 않는다.
🔴 순수 테스트로 대체하지 않는다 — 이 REQ가 고치는 결함은 **main이 입력을 잘못 만드는 것**이고
`resolveNext`는 이미 옳았다.

Exit: `npx vitest run tests/unit/policy-snapshot.test.ts` 그린(실 git 4종 포함) · Codex 승인.

## Phase 3 — 문서 (`phase-3-docs`)

범위: `docs/configuration.md`/`.en`의 정책 스냅샷 절에 **두 축이 함께 동결된다**는 사실 추가 · `CHANGELOG.md`.
🔴 기존 서술을 그대로 두고 새 문장만 붙이지 않는다(이 작업에서 반복한 실수).

Exit: `npm run docs:lint` · 문서 가드 그린 · Codex 승인.

## 완료
- 게이트 해당분(typecheck·해당 시 lint) · **통합 직전 전체 스위트 1회** · 사용자 main 머지(별도 승인).
