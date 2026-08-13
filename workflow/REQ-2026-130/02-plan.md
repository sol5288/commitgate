# REQ-2026-130 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

> **테스트 실행 계층(REQ-2026-100)**: 게이트는 테스트를 **실행하지 않는다**. 아래는 비용을 줄이기 위한 실행 시점 권고다.
> - **phase 진행 중**: 변경한 소스를 import하는 테스트만(빠른 피드백). 예: `grep -rl "<변경한 모듈>" tests/`
> - **통합(main 병합) 직전 1회**: **전체 스위트**. 범위 한정은 이것을 **대체하지 않는다** — 영향 분석은 놓친 회귀를 통과시킨다.

## Phase 1 — 승인 결속 + staleness 판정(안내 층) (`phase-1-approval-binding`)

범위(DEC-1·DEC-2·DEC-3 + DEC-4의 **안내** 소비자 셋):
- `lib/delivery.ts`: `DeliveryApproval` 타입 · `OPTIONAL_RECORD_KEYS`에 `'approval'` · 형식 검증 ·
  `deliveryGateVerdict(r, ctx?)` staleness 분기(**git은 호출부가 실행** — 이 모듈의 무의존 계약 유지).
- `bin/delivery.ts`: `cmdApprove`가 전이 **직전** `rev-parse delivery/<slug>`(HEAD 아님 — 위치 비의존)를
  `base_sha`로 담는다 ·
  `cmdStatus`·전이 직후 게이트 출력이 `rev-list <base>..<branch> -- ':(exclude)<ticketRoot>/delivery/*'`를 넘긴다.
- `req-next`의 `readDeliveryGate`가 같은 계산을 넘긴다(이미 가진 `roGit` — 새 의존 없음).

Exit: typecheck0 · staleness 진리표(approval 없음 / 커밋 없음 / 레코드-only 커밋만 / 코드 커밋 있음 /
판정불가 null) 그린 · **실제 git repo 시나리오: approve 직후 게이트가 `continue`**(자기 무효화 회귀 가드)
**+ 코드 커밋 추가 후 `await-human`** · 기존 delivery 테스트 무회귀 · Codex 승인.

## Phase 2 — `commitgate integrate` 차단 배선 (`phase-2-integrate-block`)

범위(DEC-4 후반): 병합 소스가 `delivery/*` 이면 그 묶음 레코드를 읽어 승인 staleness를 판정하고,
stale이면 **병합하지 않는다**(재승인 안내). 안내 층과 같은 함수(`deliveryGateVerdict`)를 쓴다.

🔴 판정은 **소스 브랜치 이름**으로 한다 — `branchPrefix` 전제를 통과했는지와 별개다.
`branchPrefix`는 임의 문자열을 허용하는 지원 설정이라 `"delivery/"` 로 두면 delivery 브랜치가 전제를
통과한다(설계 r04 P1). 기본 설정에서 실행되지 않는다는 사실이 이 코드를 죽게 만들지 않는다.

🔴 `commitgate delivery integrate`(member→delivery)는 **건드리지 않는다** — 층이 다르다.

Exit: typecheck0 · **두 구성 회귀**(기본 `branchPrefix` = 전제에서 거부 · `"delivery/"` = 전제 통과 후
승인 staleness로 차단) · 정상 승인에서 통과 · 실제 진입점(`runIntegrate`)으로 검증 · Codex 승인.

## Phase 3 — 문서 (`phase-3-docs`)

범위: `docs/workflow.md`/`.en`의 delivery 절에 "승인은 그 시점 브랜치 내용에 결속된다 · 이후 커밋이
들어오면 재승인이 필요하다"를 넣고 `CHANGELOG.md` 갱신.

Exit: `npm run docs:lint` · 문서 가드 그린 · Codex 승인.

## 완료
- 게이트 해당분(typecheck·해당 시 lint) · **통합 직전 전체 스위트 1회** · 사용자 main 머지(별도 승인).
