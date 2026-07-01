# REQ-2026-003 설계 — init cross-spawn 버전 하한 진단

> SSOT 설계=[`docs/follow-ups-design.md`](../../docs/follow-ups-design.md) §1(보정판). 정책 확정: WARN default + `--strict`, `semver`는 commitgate `dependencies`.

## 현재 상태(변경 대상)
- `bin/init.ts`: `REQ_DEV_DEPS`(`ajv`·`cross-spawn:^7.0.6`·`tsx`)를 대상 devDeps에 **부재 시에만** 주입(멱등·비파괴). 기존 낮은 버전은 보존·미감지.
- `parseArgs`: `--dir`·`--force`·`--dry-run`만. `--strict` 없음.
- 코어 `safeSpawnSync`(`adapters.ts`): **무변경**.

## 핵심 설계 결정

- **D1 정책**: 기본 **WARN**(비파괴/멱등 계약 유지 — 사용자 dep 안 덮어씀), **`--strict`** 플래그로 fail-closed(throw, preflight 단계라 부분 설치 없음).
- **D2 의존성 위치(정정 반영)**: `bin/init.ts`가 `semver`를 import → **commitgate 자체 `dependencies`**(`npx commitgate` 런타임 필요). 대상 주입 `REQ_DEV_DEPS` 아님. `ajv`·`cross-spawn`·`tsx`와 동렬. **`@types/semver`는 `devDependencies`**(semver v7는 타입 미동봉 — strict tsc용). `package-lock.json`도 함께 갱신(npm ci 정합, R1 P2).
- **D3 하한 SSOT**: floor = `semver.minVersion(REQ_DEV_DEPS['cross-spawn'])`(= `^7.0.6` → `7.0.6`). 하드코딩 이중화 금지.
- **D4 검사 대상**: 대상 package.json의 `devDependencies.cross-spawn` **및** `dependencies.cross-spawn`(둘 중 존재하는 spec).
- **D5 판정 알고리즘(해소버전 우선 · 오탐 방지)** — "실제 설치될 버전"에 최대한 근접하도록 아래 순서:
  1. **설치버전**: `<target>/node_modules/cross-spawn/package.json`.version 있으면 → `semver.lt(installed, floor)`면 below-floor.
  2. **lockfile 해소버전**(node_modules 없을 때 — fresh checkout/CI, R1 P2 핵심): `package-lock.json`(v2/v3 `packages["node_modules/cross-spawn"].version`, JSON) 우선, `pnpm-lock.yaml`·`yarn.lock`은 best-effort 정규식. 해소버전 있으면 `semver.lt(locked, floor)` 판정. ⚠️ **`^7.0.0` spec이지만 lock이 `7.0.1`로 핀된 케이스**를 여기서 잡는다(range fallback 전에).
  3. **range fallback**(설치·lock 둘 다 없을 때만): `!semver.intersects(spec, '>=' + floor)`면 below-floor.
     - `^7.0.0`/`~7.0.1` → intersects **true** → 무경고(설치·lock 미해소 = npm이 최신 ≥floor 설치할 상황에서만 적용). **오탐 방지**.
     - `^6.0.0`·`6.x`·핀 `7.0.1` → `>=7.0.6`과 교집합 없음 → **경고**.
     - 파싱 불가 spec → 무경고(과잉경고 회피).
- **D6 동작**: below-floor면 WARN 메시지(감지 spec/해소버전·권장 `npm i -D cross-spawn@^7.0.6`·설치는 계속). `--strict`면 preflight throw(부분 설치 없음).
- **D7 preflight 위치**: 기존 preflight(git probe·package.json/req.config 검증) 단계에 편입 — 파일 복사(Apply) **이전**.
- **D8 `dependencies` shape 검증(R1 P3)**: 현재 preflight는 `scripts`·`devDependencies`만 plain-object 검증. D4가 `dependencies.cross-spawn`을 읽으므로 **`dependencies`도 plain-object 검증 추가**(배열/원시면 throw — 기존 shape 검증과 동형). 회귀 테스트 포함.

## Phase별 구현
- **Phase 1 (단일)** — `semver`(deps) + `@types/semver`(devDeps) + package-lock 갱신 + `bin/init.ts`: `parseArgs`에 `--strict`; preflight에 (a) `dependencies` shape 검증 (b) cross-spawn 버전 하한 감지(설치버전→lockfile→range); WARN/throw; `InitResult`에 진단 필드(예: `crossSpawnFloorWarned`). `init.test.ts` 회귀(아래 계획 참조).

## 변경 파일
- 수정: `package.json`(`dependencies.semver` + `devDependencies.@types/semver`), `package-lock.json`(npm install 후 갱신), `bin/init.ts`(parseArgs·preflight[버전하한+`dependencies` shape 검증]·InitResult), `tests/unit/init.test.ts`.
- **무변경**: `adapters.ts`·`config.ts`·`req-*` 코어.

## 하위호환·안전
- 기본 WARN이라 기존 설치 경험 안 깨뜨림(`--strict`는 opt-in). 비파괴(사용자 dep 미변경).
- floor SSOT라 향후 하한 상향 시 자동 반영.
- semver는 성숙·초경량 표준 dep(공급망 표면 1개 추가). 설치버전 미상 시 `intersects`로 오탐 최소화.
- 비목표: 하한 자동 상향, Stage B, 코어 변경.
