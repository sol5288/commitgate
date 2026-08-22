# REQ-2026-172 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

> **테스트 실행 계층(REQ-2026-100)**: 게이트는 테스트를 **실행하지 않는다**. 아래는 비용을 줄이기 위한 실행 시점 권고다.
> - **phase 진행 중**: 변경한 소스를 import하는 테스트만(빠른 피드백). 예: `grep -rl "<변경한 모듈>" tests/`
> - **통합(main 병합) 직전 1회**: **전체 스위트**. 범위 한정은 이것을 **대체하지 않는다** — 영향 분석은 놓친 회귀를 통과시킨다.

## Phase 1 — 공유 코드 lib 재배치 (`phase-1-relocate`)

범위 (4파일) — 🔴 **동작 변경 0**(순수 이동):
- `scripts/req/lib/verify-range.ts` — `collectDeepInput` 를 여기로.
- `bin/verify-range.ts` — 이동한 함수 re-export(기존 import 경로 보존).
- `scripts/req/lib/integration-facts.ts` — **신규**. `readTicketFacts` 를 여기로.
- `bin/integrate.ts` — lib 에서 import + re-export.

Exit: typecheck 0 · `verify-range`·`integrate`·`delivery-verbs` 계열 **단정 무수정** 통과 ·
  Codex phase 리뷰 승인.

## Phase 2 — preflight 판정 + `req:delegate` 배선 (`phase-2-preflight`)

범위 (3파일):
- `scripts/req/lib/delegation-preflight.ts` — **신규**.
  - `Record<DelegationDenyReason, 'block' | 'not-yet-knowable' | 'request-dependent'>` 분류표(DEC-2)
  - 후보 `issued` 행 구성 → `delegationVerdict` **그대로** 호출(DEC-1)
  - 🔴 **ack 탐색 루프**(DEC-7): 사유가 하나씩 나오므로, 필요한 `--allow-attested`·`--high-risk` 를
    **한 번에 전부** 모은다. 사유가 반복되면 "그 ack 로 안 열린다" → 차단.
  - 거부 시 안내(DEC-4): 열리는 경우에만 **모든 필요 플래그를 합성한** 명령 하나를 낸다
- `scripts/req/req-delegate.ts` — 발급 **전** 호출, 거부면 원장 무변경 throw.
- 테스트 — 사유별 진리표(순수) + 실 git e2e(범위에 attested 가 있으면 발급 거부).

Exit: typecheck 0 · 위 테스트 green ·
  🔴 **조합 e2e**: HIGH 티켓 + 범위 귀속 불가가 전부 `attested` → 안내가
  `--allow-attested` **와** `--high-risk` 를 **둘 다** 담는다 ·
  🔴 **변이 3종**: ① 분류표에서 `scope-out-of-range` 를 `not-yet-knowable` 로 → red
  ② `trunk-moved` 를 `block` 으로 → **정상 발급 e2e 가 red**(과잉 차단을 잡는다)
  ③ ack 탐색을 1회차로 고정 → **조합 e2e 가 red**(플래그를 하나씩만 알려 준다) ·
  📊 발급 1회 소요 실측 기록(DEC-6) · Codex phase 리뷰 승인.

## Phase 3 — `req:next` 안내 정합 (`phase-3-next-hint`)

범위 (2파일): `scripts/req/req-next.ts` + 테스트.

- 🔴 **사실 획득 계약**(design-r02 P1): `NextInput.requiredDelegationAcks?: () => AckProbe` —
  **지연 공급자**. `auto` 종단 분기에서만 호출한다(다른 경로 비용 0).
  `main()` 이 phase-2 의 preflight 탐색을 그대로 감싸 주입한다 — `req:next` 가 자기 판정을 갖지 않는다.
- `delegateCommand()` 가 그 결과의 플래그를 **전부** 포함한다.
- 🔴 판정 불가면 **추측하지 않는다** — 안내에 "판정하지 못했다"를 붙이고 플래그를 빼지도 넣지도 않는다.

Exit:
- typecheck 0 · `req-next` green
- 🔴 **e2e 3종**(실 git · 범위를 실제로 만든다):
  1. LOW + 범위에 attested-only → 안내가 `--allow-attested` 를 담는다
  2. HIGH + 범위에 attested-only → 안내가 `--allow-attested` **와** `--high-risk` 를 **둘 다** 담는다
  3. 범위 판정 불가 → 플래그를 추측하지 않고 "판정하지 못했다"를 낸다
- 🔴 `req:next` 안내와 `req:delegate` 거부 안내가 **같은 문자열**이라는 단정
- 🔴 **변이**: 공급자를 주입하지 않으면(= 옛 동작) e2e 1·2 가 red
- 📊 `auto` 종단이 아닌 경로에서 공급자가 **호출되지 않는다**는 단정(지연 계약)
- **커밋 전 전체 스위트 1회**(REQ-2026-169 교훈 — 커밋 뒤에는 phase 를 더할 수 없다) · Codex phase 리뷰 승인

## 완료
- 게이트 해당분(typecheck·해당 시 lint) · **통합 직전 전체 스위트 1회** · 사용자 main 머지(별도 승인).
