# REQ-2026-120 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

> **테스트 실행 계층(REQ-2026-100)**: 게이트는 테스트를 **실행하지 않는다**. 아래는 비용을 줄이기 위한 실행 시점 권고다.
> - **phase 진행 중**: 변경한 소스를 import하는 테스트만(빠른 피드백). 예: `grep -rl "<변경한 모듈>" tests/`
> - **통합(main 병합) 직전 1회**: **전체 스위트**. 범위 한정은 이것을 **대체하지 않는다** — 영향 분석은 놓친 회귀를 통과시킨다.

## Phase 1 — secret scan (`phase-1-secret-scan`)

범위: `scripts/req/lib/secret-scan.ts`(설계 DEC-1 — 고신뢰 패턴 7종·마스킹 앞 6자), config
`secretScan`(DEC-5 — 기본 `block`), 배선(전송 직전·`attempt-opened` **앞** — DEC-3),
`tests/unit/secret-scan.test.ts`(패턴별 차단·마스킹·오탐 무탐·차단 시 원장 미기록/codex 미호출).

Exit: typecheck 0 · `npx vitest run tests/unit/secret-scan.test.ts tests/unit/req-review-codex.test.ts` 그린 · Codex phase 리뷰 승인.

## Phase 2 — 크기 표면 (`phase-2-size-surface`)

범위: config `promptWarnBytes`(기본 256KiB)·`promptMaxBytes`(기본 null·opt-in)+교차검증(DEC-5),
분해 경고·상한 fail-closed(DEC-4 — 절단 경로 부재), guarantees 한/영 갱신(DEC-6), `CHANGELOG.md`,
테스트(경계·분해 합·상한 미호출).

Exit: typecheck 0 · 관련 테스트·docs 가드 그린 · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(typecheck·해당 시 lint) · **통합 직전 전체 스위트 1회** · 사용자 main 머지(별도 승인).
