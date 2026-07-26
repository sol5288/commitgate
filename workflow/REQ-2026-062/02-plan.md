# REQ-2026-062 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

## Phase 1 — 마커 스키마 + setup 기록 (`phase-1-marker`)

범위(설계 DEC-1·DEC-9): `scripts/req/lib/config.ts` · `workflow/req.config.schema.json` ·
`bin/setup.ts` · `tests/unit/setup.test.ts`. 코드 4파일.

순서:
1. `SetupMarker` 타입 + `CONFIG_SCHEMA.setup` 추가. 🔴 **`workflow/req.config.schema.json`도 같은 커밋에서**
   확장한다 — 한쪽만 고치면 소비자의 vendored 스키마가 신규 키를 `additionalProperties:false`로 거부해
   **모든 명령이 죽는다**. 기존 드리프트 가드 테스트가 이를 확인한다.
2. `setup`이 ⑦(유일한 쓰기)에서 마커를 함께 기록. `completedAt`은 **실제 시계**(주입 가능한 clock seam으로
   테스트한다 — 날조 금지, REQ-2026-019 재발 방지).
3. 패치가 비어도 마커는 쓴다. 단 **마커가 이미 있고 값 변경도 없으면** 쓰지 않는다(무의미한 diff 방지).
4. 마커가 있는 설정이 `loadConfig`를 통과하는지 확인(하위호환).

Exit: typecheck 0 · `npm test` green · Codex phase 리뷰 승인.

## Phase 2 — 공통 게이트 모듈 (`phase-2-gate-module`)

범위(설계 DEC-3~DEC-5·DEC-7): `scripts/req/lib/setup-gate.ts` 신규 ·
`tests/unit/setup-gate.test.ts` 신규. 코드 2파일. **아직 어디에도 배선하지 않는다**(행동 변화 0).

순서:
1. root 해소: 명시 root → `git rev-parse --show-toplevel` → cwd. 🔴 `resolveRoot`를 쓰지 않는다
   (package-root fallback이 소비자 repo 대신 패키지 자신을 보게 한다).
2. 증거 수집: 유효 티켓 수(`state.id` === 디렉터리명) + 설치 신호 4종.
3. 순수 판정 `setupGateVerdict(facts) → pass|block`. grandfather = 유효티켓≥1 AND 신호≥2.
4. 차단 메시지는 **"사용자에게 setup 실행을 요청하라"**(DEC-7) + **판정 근거 출력**(DEC-5).
5. 테스트: 신규설치 차단 / 마커 통과 / grandfather 통과 / **빈 REQ 디렉터리만은 grandfather 안 됨**(수용기준 4) /
   비-git 디렉터리에서 root 해소.

Exit: typecheck 0 · `npm test` green · Codex phase 리뷰 승인.

## Phase 3 — verb 배선 + doctor D24 (`phase-3-wiring`)

범위(설계 DEC-6·DEC-8): 워크플로 verb 7종 + `req-doctor.ts` + 테스트. 코드 8파일(권고 상한).

순서:
1. `req:new`·`req:next`·`req:review-codex`·`req:commit`·`req:close`·`req:reconstruct`·`req:review-exception`에
   preflight 배선. **가장 앞**에 둔다 — 다른 어떤 IO·판정보다 먼저.
2. 🔴 `req:doctor`·`commitgate check`에는 **넣지 않는다**(수용기준 6).
3. doctor **D24 = WARN 상한**. FAIL 금지(C1).
4. 테스트: 각 verb가 마커 없는 신규 설치에서 막히는지 / doctor·check는 통과하는지 / D24가 WARN인지.

Exit: typecheck 0 · `npm test` green · 수용기준 1~6 충족 · Codex phase 리뷰 승인.

## Phase 4 — 문서 (`phase-4-docs`)

범위: `docs/quick-start{,.en}.md` · `docs/configuration{,.en}.md` · `docs/troubleshooting{,.en}.md` ·
`CHANGELOG.md`. 코드 변경 0.

순서:
1. quick-start: setup이 **선택이 아니라 필수**가 됐음을 반영.
2. configuration: 마커의 의미(**팀 공유 설정 완료 사실**이지 로그인 아님 — DEC-2)와 grandfather 규칙.
3. troubleshooting: "setup을 먼저 실행하라고 막힙니다" 항목 + 업그레이드 사용자는 막히지 않는다는 설명.
4. CHANGELOG: **앞 phase 구현 포인터를 커밋·파일·심볼 단위로** 포함한다(docs-only phase가 diff-scoped
   리뷰에서 "구현이 없다"로 오탐한 전례 — REQ-2026-037·REQ-2026-061 phase-2).

Exit: `docs:lint` green · typecheck 0 · `npm test` green · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(unit·typecheck·docs:lint) · 사용자 main 통합(별도 승인).
- 🔴 **단독 릴리스 금지** — REQ-2026-060·061과 함께 원장 감사 REQ 뒤에 버전을 붙인다.
