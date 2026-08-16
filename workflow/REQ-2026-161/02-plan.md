# REQ-2026-161 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> 🔴 **순서 규칙(DEC-7 · phase-2 r02 P1)**: **복구가 진단보다 먼저 착륙한다.** 진단(C6·D33)이 가리키는
> `sync --apply --scripts` 가 없는 상태로 진단을 먼저 내면, WARN 이 안내한 명령이 미지 옵션 오류로 죽는다 —
> 이 REQ 가 고치려는 결함(도구가 시킨 명령이 실행 시점에 없다)을 중간 상태에서 그대로 재현하는 것이다.

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

> **테스트 실행 계층(REQ-2026-100)**: 게이트는 테스트를 **실행하지 않는다**. 아래는 비용을 줄이기 위한 실행 시점 권고다.
> - **phase 진행 중**: 변경한 소스를 import하는 테스트만(빠른 피드백). 예: `grep -rl "<변경한 모듈>" tests/`
> - **통합(main 병합) 직전 1회**: **전체 스위트**. 범위 한정은 이것을 **대체하지 않는다** — 영향 분석은 놓친 회귀를 통과시킨다.

## Phase 1 — 명령 표면 술어 (`phase-1-command-surface-predicate`)

범위: `scripts/req/lib/command-surface.ts`(신규) · `tests/unit/command-surface.test.ts`(신규).

- `expectedReqScripts()` — `bin/dispatch.mjs` 의 `VERB_MODULES` 에서 `req:*` verb 를 파생해
  `{ verb: 'commitgate <verb>' }` 맵을 만든다. **하드코딩 목록 없음**(DEC-6).
- `missingReqScripts(scripts)` — 부재 키 정렬 배열. 입력이 `null`/`undefined`/비객체면 `[]`(판정 불가는
  "부족"이 아니다).
- `commandSurfaceGuidance(missing)` — 해소 명령 **한 문장**(DEC-4). 세 소비자가 공유한다.

Exit: typecheck 0 · `tests/unit/command-surface.test.ts` 그린 · 기대 집합이 `init.ts` 의
`STAGE_B_REQ_VERBS` 와 **같은 집합**임을 검증(복제 목록으로 비교하지 않는다 — tautology 회피) ·
Codex phase 리뷰 승인.

## Phase 2 — `sync --scripts` 백필 (`phase-2-sync-scripts-optin`)

범위: `bin/sync.ts` · 기존 sync 테스트 확장.

- `Opts` 에 `scripts?: boolean` 추가. 플래그 없으면 **`package.json` 을 열지도 않는다**(기본 미접촉).
- 계획(dry-run)에 백필 대상 키를 출력, `--apply` 에서만 쓴다.
- **insert-only** — `if (!(k in scripts))`. 기존 값은 읽고 다시 쓰지 않는다.
- 계획 출력의 opt-in 안내 줄에 `--scripts` 를 추가(`--persona`·`--gitignore` 와 같은 형태).

Exit: typecheck 0 · sync 테스트 그린(플래그 없음 → package.json 미접촉 **회귀 고정** · `--scripts`
dry-run → 계획만 · `--scripts --apply` → 부재만 삽입·기존 값 바이트 불변) · Codex phase 리뷰 승인.

## Phase 3 — `check` C6 배선 (`phase-3-check-c6`)

범위: `bin/check.ts` · 기존 check 테스트 확장.

- `CheckItem.id` 유니온에 `'C6'` 추가(타입이 배선 누락을 잡는다).
- `CheckInputs` 에 `packageScripts` 추가 — 읽기는 `collectInputs` 가, 판정은 `runChecks` 가(순수 유지).
- 🔴 **dogfood skip**(설계 r01 P1): `collectInputs` 가 `packageRoot() !== 대상 루트` 를 수집해
  `CheckInputs` 로 넘기고, 같으면 C6 는 **점검 불요(OK)** 다. 이 저장소는 `req:*` 가 5개(Stage A 형태)이고
  `VERB_MODULES` 는 12개라, skip 이 없으면 **정상 dogfood 경로가 7개 누락 WARN** 을 낸다.
- 부족하면 WARN + 누락 verb 이름 + `commandSurfaceGuidance()`. 부족 없으면 OK.
- 🔴 `package.json` 을 읽지 못한 경우는 **OK(점검 불요)** 다 — C1 이 실패했을 때 C4 가 취하는 것과
  같은 규율(같은 원인을 두 번 세지 않는다).

Exit: typecheck 0 · `collectInputs` → `runChecks` **실경로**가 도는 테스트 그린(순수 판정만 테스트하면
배선 끊김을 못 잡는다) · **이 저장소 루트에서 `commitgate check` 가 C6 를 WARN 으로 내지 않음**을
고정하는 테스트 · Codex phase 리뷰 승인.

## Phase 4 — `doctor` D33 배선 (`phase-4-doctor-d33`)

범위: `scripts/req/req-doctor.ts` · **`docs/ssot-design/07-business-rules-and-state-machines.md`** ·
기존 doctor 테스트 확장.

- `D_CHECK_IDS` 에 `'D33'` 등재(등재를 타입이 강제 — REQ-2026-099 DEC-3a).
- 🔴 **07 정본 표에 D33 행을 같은 phase 에서 추가한다**(설계 r01 P1 · 수량·설명 문구 포함).
  `tests/unit/docs-stale-claims.test.ts` 가 `D_CHECK_IDS` ↔ 07 표 ID 집합을 **양방향** 대조하므로,
  등재만 하고 표를 미루면 그 시점부터 **전체 스위트가 red** 이고 완료 기준 6 에 도달할 수 없다.
  같은 테스트가 "등재 id 는 런타임에서 방출되는가"도 보므로 미계산 경로에서도 `applicable:false` 로
  **반드시 방출**한다.
- `Inputs` 에 optional 필드 추가(`undefined` = 미계산 → `applicable:false`. 기존 테스트 base 리터럴 무손상).
- `packageRootDiffers === false`(dogfood)면 D20/D21/D22 와 **같은 기준으로** skip.
- WARN 상한. 메시지는 누락 verb + `commandSurfaceGuidance()`.
- `main()` 이 대상 repo `package.json` 의 `scripts` 를 읽어 채운다(읽기는 `readPackageScripts` 하나).

Exit: typecheck 0 · doctor 실경로 테스트 그린(부족 있음 → WARN · 부족 없음 → OK · dogfood → skip ·
미계산 → 점검 불요) · **`tests/unit/docs-stale-claims.test.ts` 그린**(07 표 ↔ `D_CHECK_IDS` 양방향 ·
런타임 방출) · **변이 검사**로 D33 배선이 실제로 도는지 확인(입력 채우는 줄을 지우면 red) ·
Codex phase 리뷰 승인.

## Phase 5 — 문서 정합 (`phase-5-docs-parity`)

범위: `docs/workflow.md` · `docs/workflow.en.md` · `docs/upgrade.md` · `docs/upgrade.en.md` ·
`bin/delivery.ts`(help 문자열) · 가드 테스트.

- 묶음의 `stopGate` 조건을 `merge` **와** `auto` 둘 다로. `stopGate: "merge"` **전수 grep** 후
  묶음 문맥의 것을 모두 갱신(DEC-5 — 새 절 추가는 갱신이 아니다).
- `auto` + 묶음의 정지 회계를 적는다: 묶음당 `seal`·`approve`·위임 **3회 고정**(멤버 수 무관) vs
  티켓별 통합 = 티켓 수.
- `upgrade` 문서의 절차에 **명령 표면 축**을 추가 — `sync` 가 `package.json` 을 안 건드린다는 기존
  서술은 유지하되, `--scripts` opt-in 과 `check`/`doctor` 진단을 함께 적는다.
- 회귀 가드: 묶음 문맥에서 `merge` 만 단독으로 말하는 문장이 남아 있으면 red(고정 문자열 + 변이 검사).

Exit: `npx remark` 링크 검증 통과 · 가드 테스트 그린 · Codex phase 리뷰 승인.

## Phase 6 — CHANGELOG (`phase-6-changelog`)

범위: `CHANGELOG.md` Unreleased.

- 두 축(명령 표면 skew 진단·복구 / 묶음 × `auto` 문서 정합)을 각각 적는다.
- 업그레이드 소비자 안내: `sync --apply --scripts` 와 그것이 필요한 이유(새 verb 는 기존 설치본에
  자동으로 생기지 않는다).

Exit: Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(typecheck·해당 시 lint) · **통합 직전 전체 스위트 1회** · 사용자 main 머지(별도 승인).
