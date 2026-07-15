# REQ-2026-014 계획 — phase 분해 (축소 범위)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **범위 조정(PM)**: 프로젝트 파일 자동 삭제(`uninstall --apply`·manifest/hash 삭제 증명·provenance)는 제외. `uninstall`은 읽기 전용,
> migration은 비파괴. 관련 phase·테스트를 제거하거나 **비파괴 planner 검증**으로 대체.

> **Granularity 정책**: phase 1개는 리뷰 가능한 크기(코드 변경 8파일 이하 권고). 초과 시 doctor D18 WARN.

공통 Exit(모든 phase): `typecheck 0` · `vitest run` 그린 · 해당 phase Codex 리뷰 승인.

## Phase 1 — 런타임 dispatch + runCli 진입 (`phase-1-dispatch`)
범위: `bin/commitgate.mjs` verb 테이블 확장(req:new/next/review-codex/doctor/commit → scripts/req/*.ts; uninstall→bin/uninstall.ts;
**`migrate` verb는 등록하지 않음**(bin/migrate.ts는 Phase 3 생성 — 깨진 명령 노출 방지, 리뷰 P2); **첫 인자가 `-` 옵션이거나 없으면 init에 argv 전체 전달**;
비-옵션 미지 토큰만 throw — 설계 D3). `scripts/req/*.ts` 5개에 `runCli(argv)` + `main(argv=process.argv.slice(2))` 진입 추가(기존 `if(isMain) main()` 가드 보존). 신규 `tests/unit/dispatch.test.ts`.
Exit: 공통 + `npm run req:*` dispatch 경유 동일 동작(인자 통과·`--` 보존) + **`--dry-run`/…/`-h`가 init으로 라우팅** + **`migrate`는 아직 미지 토큰으로 throw(깨진 import 아님)** 회귀.

## Phase 2 — 소유권 SSOT + 진단 manifest + Stage B init (`phase-2-init-runtime`)
범위: 신규 `scripts/req/lib/ownership.ts`(`bin/init.ts`의 `KIT_*`/`REQ_SCRIPTS` **이동**, 단방향 의존으로 순환/TDZ 회피; `init.ts`/`uninstall.ts` import 재지정, 무동작변경).
신규 `scripts/req/lib/manifest.ts`(**진단용** 타입·AJV 구조 검증·read/write; 삭제 필드 없음). `bin/init.ts`를 Stage B 모드로 —
**PnP preflight(D18, D14보다 먼저 fail-closed) + 로컬 직접 devDep·실행 동일성 검증(D14: `devDependencies.commitgate` 선언 + node_modules/commitgate 존재 + PACKAGE_ROOT realpath 일치, 아니면 fail-closed)** + MANAGED/SEED-ONCE 자산만 복사
(`scripts/req/**`·devDeps 주입 제거), `req:* = commitgate <verb>` 주입, `.commitgate/manifest.json`(진단) 기록. persona를 SEED-ONCE로.
기존 preflight/보안 재사용 **+ `.commitgate/` confinement(D8) + best-effort 트랜잭션(atomic 쓰기·실패 rollback, D11) + `--strict`/선행설치 정책(D16)**.
`bin/init.ts`는 **Stage A 서명(기존 `req:*=tsx scripts/req/*.ts` 또는 `scripts/req/**`) 감지 시 fail-closed + `commitgate migrate` 안내(D19)**. 진단 manifest는 **매 init 재기록(force 무관)·D11 snapshot 포함**.
`tests/unit/{ownership,manifest,init}.test.ts` 갱신(무복사·무주입·진단 manifest 생성·persona 보존·**PnP fresh 프로젝트 fail-closed(D18)**·**직접 devDep 미선언(일반 dep/전이) fail-closed·비로컬 realpath 불일치 fail-closed(D14)**·
**Stage A 프로젝트 init → migrate 안내 fail-closed(D19)**·**기존 manifest 있는 프로젝트 재-init → 재기록 + manifest write 실패주입시 기존 manifest 복원**·
`.commitgate` symlink fail-closed·**init import TDZ 무오류**·**선행 설치분 커밋 후 `init --strict` 통과 / 미커밋시 중단+원인안내 / 무관 변경 섞이면 중단(파일예외 없음)**·`--force` overwrite 실패주입 원본 복원).
Exit: 공통 + fresh 설치가 `scripts/req/**`·devDep 없이 manifest·`commitgate <verb>` 스크립트만 생성 + **PnP·직접devDep·realpath·Stage A 감지 거부** + symlink 거부 + strict/선행설치 정책 + manifest 재기록/rollback 검증.

## Phase 3 — 읽기 전용 uninstall + 비파괴 migrate + 설치모드 감지 (`phase-3-uninstall-migrate`)
범위: `bin/uninstall.ts`를 Stage B에 맞게 조정(**읽기 전용 계획만**: MANAGED byte-comparison 분류·SEED-ONCE/증거 보존·`npm uninstall -D commitgate` 안내·
package.json/manifest 수동 정리 후보 표시; `--apply` 없음). 신규 `bin/migrate.ts`(감지·dry-run 기본·`--apply`; **PnP preflight(D18) + 로컬 직접 devDep·실행 동일성 검증(D14, --apply 전 fail-closed)**;
`req:*` 전환은 **현재 값이 정확히 Stage A 주입값일 때만**(D5), **사용자 정의 값 절대 미덮어씀·보존·수동 안내**; **비파괴 — scripts/req/**·schema·persona·증거 자동 삭제 안 함**,
정리는 uninstall planner/git revert 안내; 진단 manifest만). **`bin/commitgate.mjs`에 `migrate` verb를 이 phase에서 등록**(파일 생성과 동시 — Phase 1 미등록). `scripts/req/req-doctor.ts` 설치 모드 D-check.
best-effort 트랜잭션(D11). `tests/unit/{uninstall,migrate}.test.ts`(uninstall 읽기 전용·삭제 없음·증거/persona 보존; migrate **PnP·로컬 직접devDep 미선치 --apply fail-closed**·정확한 Stage A 값만 전환·
**사용자 커스텀 `req:*` 값 보존**·**scripts/req/**·schema·persona·증거 미삭제(비파괴)**·dry-run 무부작용·전환 중 실패주입 rollback).
Exit: 공통 + uninstall이 아무것도 삭제하지 않고 계획만 출력 + migrate 비파괴·PnP/로컬 검증 fail-closed·사용자 스크립트 보존 + 설치 모드 감지(Done #4, #5).

## Phase 4 — 재현성·PM/워크스페이스/PnP doctor (`phase-4-repro-pm`)
범위: `req-doctor.ts` D-check — lockfile 커밋 권고, 설치 버전 vs manifest 버전 드리프트 WARN(진단만), **Yarn PnP WARN(preflight D18이 1차 fail-closed, doctor는 2차 진단; 자동 변경 금지)**.
workspace root 설치 동작 테스트/하위 패키지 제한 명시. `tests/unit/req-doctor.test.ts` 갱신.
Exit: 공통 + 버전 드리프트 WARN·**PnP 제한 안내(자동변경 없음)**·workspace 결정 테스트(Done #6, R7).

## Phase 5 — 문서·smoke (`phase-5-docs-smoke`)
범위: `README.md`/`README.en.md`(Stage B 설치 순서 `npm i -D commitgate` **선행**·`--strict`/선행설치(D16)·**읽기 전용 제거(`npm uninstall -D commitgate` + 계획)**·비파괴 migration·재현성),
CLI help(`init`/`uninstall`/`migrate`), `scripts/smoke.mjs`(Stage B tarball: `npm i -D` → `npx commitgate init` → **req:* 동작(dispatch)** → `npx commitgate uninstall`(읽기 전용 계획) rc=0 검증).
Exit: 공통 + `npm run smoke` 그린, 문서-구현 일치(Done #7, #8).

## 완료
- 게이트 해당분(unit·typecheck·smoke) · 사용자 main 머지(별도 승인).
