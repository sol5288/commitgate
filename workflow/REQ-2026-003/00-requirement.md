# REQ-2026-003 요구사항 — init: 기존 cross-spawn 버전 하한 진단 (#1)

## 배경
P1 보안 경계(`safeSpawnSync`)는 `cross-spawn`에 위임돼 있고, init은 대상 repo에 `cross-spawn@^7.0.6`을 주입한다. 그러나 **비파괴/멱등 정책상 기존 devDeps/deps에 낮은 버전이 있으면 그대로 보존**한다 → 검증 안 된(하한 미만, 예: `<7.0.5` ReDoS CVE-2024-21538) 버전 위에서 경계가 조용히 돌 수 있다. Codex 보안 리뷰 non-blocking 후속 [#1](https://github.com/sol5288/commitgate/issues/1). SSOT 설계=[`docs/follow-ups-design.md`](../../docs/follow-ups-design.md) §1.

## 목표
init이 대상의 기존 `cross-spawn`(dev 또는 일반 deps) 버전이 **하한(REQ_DEV_DEPS의 `^7.0.6`에서 파생) 아래일 수 있으면 감지**하고 명확히 알린다. 기본 **WARN**(비파괴), 선택 **`--strict`** fail-closed.

## 범위
- **In**: init 버전 하한 감지(설치버전 우선→range 판정) + WARN/`--strict` + `semver`를 commitgate `dependencies`에 추가 + 회귀 테스트(`^7.0.0` 오탐 방지 필수).
- **Out**: 하한 자동 상향(비파괴 유지 — 사용자 dep를 덮어쓰지 않음). Stage B. 코어 `safeSpawnSync` 변경.

## 수용 기준
- 기존 `cross-spawn`이 `6.x`·`~7.0.1`... 아니, **범위상 하한 미만으로 잠길 수 있는 것**(`^6.0.0`·핀 `7.0.1`·`6.x`)·또는 설치버전 `<7.0.6` → **WARN**, `--strict`면 throw + **부분 설치 없음**(preflight).
- `^7.0.0`·`~7.0.1`·`>=7.0.6`·설치버전 `7.0.9` → **경고 없음**(오탐 방지 — 특히 `^7.0.0` 테스트 필수).
- 하한은 `REQ_DEV_DEPS['cross-spawn']`에서 파생(하드코딩 이중화 금지).
- 코어·기존 동작 무손상(기존 init 테스트 green 유지).
