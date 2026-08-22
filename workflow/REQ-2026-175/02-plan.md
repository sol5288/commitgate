# REQ-2026-175 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

> **테스트 실행 계층(REQ-2026-100)**: 게이트는 테스트를 **실행하지 않는다**. 아래는 비용을 줄이기 위한 실행 시점 권고다.
> - **phase 진행 중**: 변경한 소스를 import하는 테스트만(빠른 피드백). 예: `grep -rl "<변경한 모듈>" tests/`
> - **통합(main 병합) 직전 1회**: **전체 스위트**. 범위 한정은 이것을 **대체하지 않는다** — 영향 분석은 놓친 회귀를 통과시킨다.

## Phase 1 — 안내 정합 (`phase-1-parity`)

범위 (4파일):
- `scripts/req/lib/terminal-reentry.ts` — **신규**. `terminalReentryProblem` 이관 +
  `computeTerminalReentry(ports)`(scanTicketIntake → dirtyGitignores → narrowing → 문구).
- `scripts/req/req-commit.ts` — 그 함수 호출로 교체(**동작 동일**) · 기존 export 는 re-export.
- `scripts/req/req-next.ts`
  - `NextInput.terminalReentry?: () => string | null` — **지연 공급자**(DEC-2, 완성된 문구)
  - 살아 있는 승인 블록 **진입 지점 한 곳**에서 검사(DEC-5) → 종결이면 `BLOCKED`(DEC-4)
  - 안내는 `terminalReentryProblem` **그대로**(DEC-1)
  - `main()` 에서 `scanTicketIntake` 로 공급자 배선
- `tests/unit/next-terminal-parity.test.ts` — **신규**

Exit:
- typecheck 0
- 🔴 **오라클 6종**:
  1. `dev-complete`·`migrated-complete`·`abandoned` → `BLOCKED`, `req:commit` 을 지시하지 않는다
  2. 🔴 `series-terminal` 은 **막지 않는다**(`req:commit` 도 안 막는다 — 대체 REQ 흐름)
  3. 🔴 판정 불가(`undefined`·`null`) → **종전 동작**(무회귀)
  4. 🔴 안내가 `req:commit` 거부 문구와 **문자열 동일** — 세 변형 전부:
     (a) 미커밋 `.gitignore` 없음 (b) 안전한 미커밋 `.gitignore` (c) **narrowing**(명령열 없음)
  5. 🔴 `req:confirm` 갈래(HIGH)도 막힌다 — 확인만 받고 막히면 승인이 낭비된다
  6. 🔴 **지연**: 종결이 아닌 경로에서 공급자가 **호출되지 않는다**
- 🔴 **변이 4종**:
  ① 검사 제거 → 오라클 1 red
  ② `series-terminal` 도 막게 → 오라클 2 red
  ③ 문구를 손으로 쓴 것으로 교체 → 오라클 4 red
  ⑤ 공급자가 `narrowing` 을 빼고 계산 → 오라클 4(c) red(실행 불가 안내를 낸다)
  ④ `main()` 배선 제거 → 호출부 테스트 red
- **커밋 전 전체 스위트 1회** — 단일 phase 라 커밋 뒤에는 phase 를 더할 수 없다
- Codex phase 리뷰 승인

## 완료
- 게이트 해당분(typecheck·해당 시 lint) · **통합 직전 전체 스위트 1회** · 사용자 main 머지(별도 승인).
