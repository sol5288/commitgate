# REQ-2026-003 계획 — phase 분해

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고.

## Phase 1 — cross-spawn 버전 하한 진단 (단일) (`phase-1-cross-spawn-floor-diagnostic`)
범위:
- `package.json`: `dependencies.semver` + `devDependencies.@types/semver`(semver v7 타입 미동봉). `package-lock.json`은 `npm install` 후 갱신분 포함.
- `bin/init.ts`: `parseArgs`에 `--strict`; preflight에 (a) `dependencies` plain-object shape 검증(R1 P3), (b) 기존 `cross-spawn`(dev+deps) 버전 하한 감지 — **설치버전(`node_modules/cross-spawn`) → lockfile 해소버전(package-lock v2/v3 JSON, pnpm/yarn best-effort) → range(`!semver.intersects(spec,'>='+floor)`)** 순; below-floor면 WARN(기본)/throw(`--strict`). floor=`semver.minVersion(REQ_DEV_DEPS['cross-spawn'])`. `InitResult`에 진단 필드.
- `tests/unit/init.test.ts` 회귀:
  - below-floor: `^6.0.0`·핀 `7.0.1` → WARN, `--strict` throw + **부분복사 없음**.
  - **lockfile 케이스(R1 P2)**: `^7.0.0` spec + package-lock가 `7.0.1` 핀 → 감지(WARN/strict). node_modules 있으면 그 버전 우선.
  - 무경고: `^7.0.0`(**오탐 방지 필수**, lock/설치 없음)·`~7.0.1`·`>=7.0.6`·설치 `7.0.9`.
  - dev·deps 양쪽 감지 / floor SSOT / `dependencies` 배열 → throw(shape).

Exit: typecheck 0(`@types/semver` 포함) · 기존 init 테스트 무손상 · 신규 회귀 green · Codex phase 리뷰 승인.

## 완료
- 게이트(typecheck·unit) · 사용자 main 머지·push(별도 승인, PR→CI green 경유).
