# REQ-2026-069 계획 — phase 분해

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

## Phase 1 — rebind 행: 타입·검증·산입 규칙 (`phase-1-rebind-model`)

범위(DEC-1·DEC-4·DEC-5·DEC-7): `scripts/req/lib/evidence.ts` · `tests/unit/evidence-module.test.ts`.
**IO·verb 없음** — 순수 모델만. 행동 변화는 "rebind 행이 있을 때"로 한정된다.

순서:
1. `RebindEntry` 타입 + 직렬화. 🔴 `ReviewKind`(design|phase)를 **오염시키지 않는다** — rebind는
   리뷰가 아니라 결속 기록이다. 타입을 분리하고 `kind`만 매니페스트에서 공유한다.
2. `MANIFEST_KEYS` 확장 + `validateManifest`의 rebind 검증:
   `phase_id` 필수 · `from_design_ref`/`to_design_ref`가 64자 hex · `confirmation` 비어있지 않음 ·
   `confirmed_at` ISO. design/phase 행에는 이 키들이 **금지**(kind 격리).
3. 🔴 **무회귀 오라클**: rebind 행이 **없는** 매니페스트의 `validateManifest` 결과가 기존과
   **완전히 동일**한지 고정한다. 새 키가 기존 행을 "예상 외 필드"로 만들지 않아야 한다.
4. `evidencedPhaseIdsFromManifest` 산입 규칙(DEC-4): 결속 **또는** 유효 재결속.
   🔴 유효 재결속의 조건을 테스트로 고정한다 —
   ① `to_design_ref` == 조회 대상 designRef ② `from_design_ref` == 그 phase의 **실제** `phase_design_ref`
   ③ 대상 phase 행이 실제로 존재.
   음성: from 이 어긋난 행은 **산입하지 않는다**(아무 해시나 받으면 없던 승인을 지어낸다).
5. `designRef == null` 호출(레거시 경로)의 동작이 그대로인지 확인.

Exit: typecheck 0 · `npm test` green · 수용기준 1·5 · Codex 승인.

## Phase 2 — `req:rebind` verb (`phase-2-rebind-verb`)

범위(DEC-2·DEC-5·DEC-6): `scripts/req/req-rebind.ts` 신규 · `bin/dispatch.mjs` · `bin/init.ts` ·
`tests/unit/rebind-verb.test.ts` 신규.

순서:
1. 인자 파싱(fail-closed) — 값 자리에 온 옵션을 삼키지 않는다(REQ-2026-061 r01 P1과 같은 함정).
2. 🔴 **setup 완료 게이트**를 가장 앞에(다른 상태 변경 verb와 동일).
3. 판정(순수): 대상 phase가 존재하는가 · 이미 현재 해시에 결속됐는가(→ 거부) ·
   현재 design_ref가 있는가(없으면 거부 — DEC-5).
4. 확인 문구 검증 `rebind <REQ-id> <phase-id>`. 🔴 시각은 **실제 시계**.
5. append + 커밋. 🔴 매니페스트는 **append-only** — 기존 행을 고치지 않는다.
6. 🔴 verb 등록은 `VERB_MODULES` **한 곳**이다 — `STAGE_B_REQ_VERBS`는 하드코딩 목록이 아니라
   거기서 `req:` 접두를 필터해 **파생**된다(`bin/init.ts:189`, DEC-D3). 그래도 그 파생이 살아 있다는
   것을 테스트로 고정한다: 파생이 끊기면 소비자 프로젝트에 `npm run req:rebind`가 없다.
   **실측(2026-07-27)**: 임시 repo에 `commitgate`를 devDependency로 선언하고 `init`을 돌리니
   `scripts.req:rebind`가 주입됐다(총 9개 req:* 스크립트). phase-2 r01의 반대 지적은 정적 오독이다.

Exit: typecheck 0 · `npm test` green · 수용기준 2·3·4·6 · Codex 승인.

## Phase 3 — 문서 (`phase-3-docs`)

범위: docs 한/영 · CHANGELOG.

순서:
1. 🔴 **언제 쓰는 명령인지**를 앞세운다: "리뷰가 P1을 내서 설계를 고쳤고, 그 변경이 앞선 phase의
   검수를 무효화하지 않는다고 **사람이 판단**했을 때". 아무 때나 쓰는 우회로가 아니다.
2. `--migrate`와의 구별을 적는다 — 그건 레거시 티켓용 사후 종결이고 `reconstructed: true`다.
3. 실측 3건(066·067 막힘 / 068 통과)을 근거로 남긴다.

Exit: `docs:lint` green · Codex 승인.

## 완료
- 게이트 해당분 · 사용자 main 통합(B1 사전 승인 — 반영 시 우회 사실·CI 사후 검증 보고).
