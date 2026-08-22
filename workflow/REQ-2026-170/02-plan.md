# REQ-2026-170 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

> **테스트 실행 계층(REQ-2026-100)**: 게이트는 테스트를 **실행하지 않는다**. 아래는 비용을 줄이기 위한 실행 시점 권고다.
> - **phase 진행 중**: 변경한 소스를 import하는 테스트만(빠른 피드백). 예: `grep -rl "<변경한 모듈>" tests/`
> - **통합(main 병합) 직전 1회**: **전체 스위트**. 범위 한정은 이것을 **대체하지 않는다** — 영향 분석은 놓친 회귀를 통과시킨다.

## Phase 1 — 경계 경유 (`phase-1-boundary`)

범위 (2파일):
- `scripts/req/lib/intake-batch.ts` — `cross-spawn` 직접 import 제거, `adapters.safeSpawnSyncStatus` 경유.
  🔴 `listHeadTreeEntries` 는 `maxBuffer: 256 * 1024 * 1024` 를 **명시**한다(DEC-5 — 경계 기본값은 64 MiB).
  헤더 주석의 의존 목록·스폰 정책 갱신.
- `tests/unit/intake-batch.test.ts` — **추가만**: `adapters` 를 감싸 `listHeadTreeEntries` 가 경계에
  넘기는 옵션을 캡처하고 `maxBuffer === 256 * 1024 * 1024` 를 단정한다. 값이 기본값으로 새면 red.

Exit:
- typecheck 0
- `external-call-boundary`·`intake-batch`·`intake-scan-cost` green
  (🔴 `SPAWNING_FILES` 등록부를 **고치지 않고** green 이어야 한다)
- `maxBuffer` 회귀 테스트 green + **변이 검사**(명시를 지우면 red)
- **전체 스위트 green** — 이 REQ 의 존재 이유가 전체 스위트 red 이므로 그것으로 닫는다
- Codex phase 리뷰 승인

## 완료
- 게이트 해당분(typecheck·해당 시 lint) · **통합 직전 전체 스위트 1회** · 사용자 main 머지(별도 승인).
- 🔴 이 티켓은 REQ-2026-169 브랜치 위에 쌓여 있다 — 통합은 두 티켓을 **한 묶음(delivery set)**으로 처리한다.
  티켓 scope 위임은 범위에 다른 티켓이 있어 `scope-out-of-range` 로 거부된다.
