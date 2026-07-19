# REQ-2026-038 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님).

의존 방향: 헬퍼 export → verb → 감지 → 문서. 앞 phase가 뒤 phase의 재사용 표면을 연다.

## Phase 1 — confinement 헬퍼 export (`phase-1-export-helpers`)
범위: `bin/init.ts`의 `assertConfinedDest`·`statWritableDest`·`sha256File`에 `export`만 추가(D2/R6). **런타임 동작 무변경** —
sync가 confinement를 재구현하지 않고 재사용하기 위한 전제. `tests/unit/init.test.ts`에 export 존재·기존 동작 불변 assert.
Exit: typecheck0 · 기존 init 단위 전부 그린(회귀 없음) · Codex phase 리뷰 승인.

## Phase 2 — `commitgate sync` verb (`phase-2-sync-verb`)
범위: 신규 `bin/sync.ts`(D1~D5·R2·R3·R4·R5) — 동기 `runCli`, 기본 plan/dry-run·`--apply`·`--dir`·`--persona`,
`targetRoot===PACKAGE_ROOT` 하드 가드, 스키마 축 재동기화(statWritableDest·sha skip), persona opt-in·custom/null 불가침.
`bin/dispatch.mjs`에 `sync` 등록(동일 phase — 없는 모듈 등록 금지), `bin/commitgate.mjs` help. `tests/unit/sync.test.ts`(신규:
plan/apply·packageRoot 거부·custom/null/기본-경로 persona·seed-once 미접촉·멱등)·`tests/unit/dispatch.test.ts`(sync 라우팅).
Exit: typecheck0 · sync·dispatch 단위 그린 · Codex phase 리뷰 승인.

## Phase 3 — doctor D20 content-hash WARN + 회귀망 (`phase-3-doctor-d20`)
범위: `scripts/req/req-doctor.ts`에 D20 순수 검사 + `DoctorInputs` optional 필드(shipped/vendored sha·packageRootDiffers·
schemaPathIsDefault·installedVersion) + `main()` 계산(D6·R7·R8). `tests/unit/req-doctor.test.ts` 결정표(undefined/dogfood/custom→OK,
동일→OK, 상이→WARN, **절대 FAIL 아님**). 상시 회귀망(R9): `tests/unit/init.test.ts`(KIT_COPY/KIT_SCHEMA ⊆ package.json files[]),
`tests/unit/req-review-codex.test.ts`(`MACHINE_SCHEMA_VERSION` ∈ shipped machine.schema.json enum).
Exit: typecheck0 · doctor 단위 그린(기존 D2~D19 무회귀) · Codex phase 리뷰 승인.

## Phase 4 — 문서 (`phase-4-docs`)
범위(코드 없음·R1): `README.md`·`README.en.md`의 거짓 주장(:40 "update 한 번", :228 "복사본 안 갈라짐") 교정 + "업그레이드(0.x)"
절 신설(범위 확대/@latest → `commitgate sync` → Stage A면 `migrate`). `CHANGELOG.md` 항목. `docs/ssot-design/gaps-and-decisions.md`(G-10)·
`docs/ssot-design/14-product-strategy-and-roadmap.md`(STR-06) 부분 해결 표기.
Exit: 문서 정합(명령/플래그가 실제 sync 인터페이스와 일치) · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(unit·typecheck) 전부 그린 · R1~R10 충족 · 사용자 main 머지(별도 승인 — 통합 통제점).
