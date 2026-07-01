# REQ-2026-001 리뷰 요청 — 독립 패키지 추출(설계)

## 배경
palm-kiosk-app REQ-2026-017 portability kit을 `npx`로 설치 가능한 독립 패키지(`ai-req-workflow`)로 추출. 본 리뷰는 **설계(design)** 리뷰 — 추출 방식(Model A vendored 스캐폴딩)과 코어 무손상 여부를 본다.

## 변경 요약
- kit 무수정 복사: `scripts/req/**`(6), `workflow/*.schema.json`(2), `tests/unit/req-*.test.ts`(6).
- 신규: 독립 툴체인 + `bin/init.ts` 스캐폴딩 CLI + generic `AGENTS.template.md` + `init.test.ts`.
- 프로젝트 차이 흡수 = `req.config.json`만(init 시드 `{packageManager, handoffPath:null}`), DEFAULTS 불변.

## R1 반영(재리뷰 대상)
design R1 NEEDS_FIX 3건을 Stage A에서 반영:
- **P1(런처 tsx)**: `bin/req-workflow-init.mjs`를 `import { register } from 'tsx/esm/api'` + `register()`로 변경 → tsx를 패키지-상대 해소. foreign cwd(D:\tmp)에서 실행 검증(ERR_MODULE_NOT_FOUND 해소).
- **P2(handoffPath)**: `bin/init.ts`가 기존 config에도 누락된 `handoffPath:null`/`packageManager`를 병합(기존 키 보존). `configAction: created|merged|unchanged`.
- **P2(git probe)**: `.git` 존재 검사 → `assertGitWorkTree`(`rev-parse --is-inside-work-tree` + `--show-toplevel` top-level 일치, `realpathSync.native` 정규화). fake `.git` 마커 거부 테스트 추가.
- 테스트 371 green(init 13), `tsc` 0.

## R2 반영(재리뷰 대상)
design R2 NEEDS_FIX 1건(P2 부분 설치 위험) 반영:
- `runInit`을 **Preflight(git probe·package.json/req.config.json 파싱·비-객체 shape 검증·계획 산출) → Apply(복사·쓰기)** 2단계로 재구성. malformed 입력은 복사 전에 throw.
- `parseJsonObject` 헬퍼(파싱 실패·배열/원시 거부). no-partial-write 회귀 테스트 2종(malformed config / 비객체 package.json → 복사 0) 추가.

## phase-2 R1 반영(재리뷰 대상)
phase-2-init-cli R1 NEEDS_FIX 1건(P2) 반영:
- preflight가 package.json 루트 객체만 검증하고 `scripts`/`devDependencies`가 객체인지 미검증 → 배열이면 patch 유실(성공 보고인데 req:* 미주입)되던 문제. preflight에 두 필드 plain-object shape 검증 추가(배열/원시 → Apply 전 throw). 회귀 테스트 추가(scripts:[]·devDependencies:[] → 복사 0). init 15 green, tsc 0.

## phase-2 R2 반영(재리뷰 대상)
phase-2-init-cli R2 NEEDS_FIX 1건(P2) 반영:
- preflight가 병합될 `req.config.json`을 워크플로 스키마/경로로 미검증하던 문제. kit의 `loadConfig({root})`를 preflight에서 호출해 CONFIG_SCHEMA(additionalProperties·enum·type) + confinement까지 복사 전 검증(schema-invalid → Apply 전 throw). 회귀 테스트 추가(unknown key·bad enum·빈 branchPrefix·escaping ticketRoot → 복사 0). init 16 green, tsc 0.

## 승인 verdict 형식(중요)
본 리뷰는 **design kind**다. 승인 시 다음 조합으로 응답하라(verdict 일관성 게이트):
- `status = STEP_COMPLETE`, `commit_approved = yes`, **`merge_ready = no`**.
- `merge_ready = yes`는 **최종 `status = COMPLETE`에서만** 유효하다 — design 승인은 merge 신호가 아니므로 `merge_ready = yes`로 두면 워크플로가 모순으로 fail-closed 거부한다(R3에서 발생).

## 리뷰 포인트
1. **코어 승인 바인딩 무손상**: staged tree 검증(D9)·clean(D10)·branchPrefix(D11)·codex fail-closed가 복사만 되어 약화되지 않았는가.
2. **R1 반영 적정성**: P1/P2 3건이 근본 해결인가, 우회인가. 특히 git top-level 강제(하위 디렉터리 거부)가 과한 제약은 아닌가.
3. **init fail-closed 충분성**: 비-git·fake-git·package.json 부재 거부 + 멱등/비파괴/병합이 충분한가. 부분 복사 후 실패 시 상태 등 누락 위험은.
4. **레이아웃 보존 근거**: `packageRoot()`(3단계 상위)·`MACHINE_SCHEMA_PATH` 가정이 새 repo에서도 유효한가.
5. **범위**: Model B/JS 빌드/publish/DEFAULTS 소스 null화를 Stage B로 미룬 게 타당한가.
