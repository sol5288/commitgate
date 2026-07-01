# REQ-2026-003 리뷰 요청 — init cross-spawn 버전 하한 진단 (설계)

## 배경
init이 대상에 `cross-spawn@^7.0.6`을 주입하되 기존 낮은 버전은 비파괴 보존 → P1 보안 경계가 미검증(<7.0.5 ReDoS) 버전에 얹힐 수 있음. Codex 보안 리뷰 non-blocking 후속 #1. 정책은 이미 확정(WARN default + `--strict`, semver=commitgate deps).

## 변경 요약 (단일 phase)
- `semver`를 commitgate `dependencies`에 추가.
- `bin/init.ts`: `--strict` 플래그 + preflight 버전 하한 감지(설치버전 우선→range `!intersects(spec,'>=floor)`), WARN/throw. floor=`minVersion(REQ_DEV_DEPS['cross-spawn'])`.
- `init.test.ts` 회귀(오탐 방지 `^7.0.0` 포함).

## R1 반영(재리뷰 대상)
design R1 NEEDS_FIX 3건 반영:
- **P2(lockfile)**: 판정 우선순위에 **lockfile 해소버전** 추가(설치버전→lockfile→range). `^7.0.0` spec + lock 7.0.1 핀 케이스를 range fallback 전에 감지. package-lock v2/v3 JSON 우선, pnpm/yarn best-effort.
- **P2(메타)**: `package-lock.json` 갱신 + `@types/semver` devDep(semver v7 타입 미동봉) 명시.
- **P3(shape)**: preflight에 `dependencies` plain-object 검증 추가 + 회귀 테스트.

## 리뷰 포인트 (design)
1. **판정 알고리즘**이 맞는가: 설치버전 `semver.lt` 우선, 없으면 `!semver.intersects(spec,'>='+floor)`. `^7.0.0`/`~7.0.1` 오탐 없음 + `^6.0.0`/핀 7.0.1 감지. 파싱 불가 spec은 무경고 처리(과잉경고 회피)가 타당한가.
2. **semver 위치**: commitgate `dependencies`(런타임)가 맞는가(REQ_DEV_DEPS 아님).
3. **정책**: WARN default + `--strict` fail-closed + 비파괴(사용자 dep 미변경)가 적절한가. floor SSOT.
4. **범위**: 코어 무변경, #1만 단독 처리, 하한 자동 상향은 비목표 — 맞는가.
