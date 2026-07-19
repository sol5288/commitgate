# REQ-2026-038 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님).

> ⚠️ **phase 재분해(design r04)**: 원래 4-phase(sync / D20 / 문서 분리)였으나, phase 리뷰가 얇은 slice를 "REQ 전체 미완"으로
> 판정하는 diff-scoped over-reach가 발생했다(sync-only diff를 R7·R1 미충족으로 차단). skew 해결은 감지(D20)+복구(sync)+문서가
> 하나의 일관 단위이므로 **phase-2로 병합**한다. 병합 phase는 >8파일이라 D18 granularity WARN(advisory)이 예상되나 FAIL 아님.

## Phase 1 — confinement 헬퍼 export (`phase-1-export-helpers`) *(완료·승인·커밋)*
범위: `bin/init.ts`의 `assertConfinedDest`·`statWritableDest`·`sha256File`에 `export`만 추가(D2/R6). **런타임 동작 무변경**.
Exit: typecheck0 · init 단위 그린 · Codex phase 리뷰 승인. ✅ 완료(source `3a4126c`).

## Phase 2 — skew 해결 전체 (`phase-2-sync-verb`)
범위(D1~D6 · R1~R9): 감지+복구+문서를 하나의 일관 단위로 구현한다.
- **sync verb**(R2~R5): 신규 `bin/sync.ts`(동기 `runCli`·기본 dry-run·`--apply`·`--dir`·`--persona`·`targetRoot===PACKAGE_ROOT` 하드 가드),
  스키마 축 재동기화(statWritableDest·sha skip), persona 부재복원만·custom/null/편집 불가침. `bin/dispatch.mjs` 등록·`bin/commitgate.mjs` help.
- **doctor D20**(R7·R8): `scripts/req/req-doctor.ts`에 content-hash WARN 검사 + `DoctorInputs` optional 필드 + `main()` sha/version 계산.
  결정표(dogfood/custom/미설치/동일→OK, 상이→WARN, **절대 FAIL 아님**). schemaPathIsDefault는 절대경로 비교. req.config.schema.json은 cosmetic(WARN 제외).
- **문서**(R1): `README.md`·`README.en.md`의 거짓 주장(:40·:228) 교정 + "업그레이드(0.x)" 절 신설. `CHANGELOG.md` 항목.
  `docs/ssot-design/gaps-and-decisions.md`(G-10)·`14-product-strategy-and-roadmap.md`(STR-06) 부분 해결 표기.
- **회귀망**(R9): `tests/unit/sync.test.ts`(신규)·`dispatch.test.ts`(sync 라우팅)·`req-doctor.test.ts`(D20 결정표)·
  `init.test.ts`(KIT_COPY/KIT_SCHEMA ⊆ files[] 세축)·`req-review-codex.test.ts`(MACHINE_SCHEMA_VERSION ∈ 스키마 enum).
Exit: typecheck0 · 전체 vitest 그린(기존 D2~D19·리뷰 경로 무회귀) · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(unit·typecheck) 전부 그린 · R1~R10 충족 · 사용자 main 머지(별도 승인 — 통합 통제점).
