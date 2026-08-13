# REQ-2026-135 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

> **테스트 실행 계층(REQ-2026-100)**: 게이트는 테스트를 **실행하지 않는다**. 아래는 비용을 줄이기 위한 실행 시점 권고다.
> - **phase 진행 중**: 변경한 소스를 import하는 테스트만(빠른 피드백). 예: `grep -rl "<변경한 모듈>" tests/`
> - **통합(main 병합) 직전 1회**: **전체 스위트**. 범위 한정은 이것을 **대체하지 않는다** — 영향 분석은 놓친 회귀를 통과시킨다.

## Phase 1 — 업그레이드 안내(정지를 만난 자리) (`phase-1-upgrade-hint`)

범위(DEC-4): 예산 소진 `AWAIT_HUMAN` 안내에 한 줄을 조건부로 덧붙인다.
조건 셋이 **모두** 참일 때만: `!hardBlocked` · `stopGate ∈ {req, merge}` · `onSoftLimit === 'ask'`.

Exit:
```sh
npm run typecheck
npx vitest run tests/unit/review-soft-limit-policy.test.ts tests/unit/req-next.test.ts
```
- `req`/`merge` + `ask` + 소프트 소진 → 안내가 **나온다**(설정 키와 setup 둘 다 언급).
- `hardCap` 도달 → 안내가 **나오지 않는다**(열 수 없는 정지를 열 수 있다고 말하면 거짓이다).
- `phase` → 나오지 않는다.
- `auto` → 애초에 이 정지가 없다(기존 테스트가 고정).
- Codex 승인.

## Phase 2 — 범위 명세·결정 기록·업그레이드 절 (`phase-2-scope-docs`)

범위(DEC-1·DEC-2·DEC-3·DEC-5):
- `docs/configuration.md`/`.en` 리뷰 예산 절 = **정본**: `auto` 범위 표(없애는 것/남기는 것) ·
  `hardCap`은 반복 백스톱 · `stopGate:"auto"` 미추가 결정과 근거 · 기존 프로젝트 업그레이드 절.
  🔴 `hardCap` 서술은 **설정값**("`hardCap`회, 기본 8")으로 적고 기준이 **dispatched**(void 포함)임을
  명시한다 — "8회 리뷰가 수렴하지 않았다"는 두 지점에서 틀린다.
- `docs/workflow.md`/`.en`은 그 정본을 **가리킨다**(표를 복사하지 않는다).
- `CHANGELOG.md`.

Exit: `npm run docs:lint` · 문서 가드 그린 · Codex 승인.

## 완료
- 게이트 해당분(typecheck·해당 시 lint) · **통합 직전 전체 스위트 1회** · 사용자 main 머지(별도 승인).
