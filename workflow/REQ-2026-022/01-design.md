# REQ-2026-022 설계 — 공존·migration 무추가·packed-tarball smoke

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.
> 실측은 `feat/req-2026-021-companion-gitignore-uninstall@fede19e` 기준.

## 현재 상태(변경 대상)

| 사실 | 실측 근거 |
|---|---|
| 🔴 smoke `snapshot()`은 **크기만** 본다 | `scripts/smoke.mjs` — `out.set(rel, readFileSync(abs).length)`. 같은 크기 내용 변경을 놓친다 |
| `assertSameTree`는 값 비교다 | `after.get(k) !== before.get(k)` — fingerprint를 바꿔도 그대로 동작한다 |
| smoke는 uninstall 읽기 전용을 이 snapshot으로 검증한다 | `beforeUninstall` → `uninstall` → `assertSameTree(...)` — **그래서 R7이 실질적 문제다** |
| npm 캐시가 격리돼 있다 | `npm_config_cache: npmCache`(일회용) — 개발자 실제 캐시 미오염. 규약 유지 |
| migrate smoke는 **별도** Stage A 대상을 쓴다 | `smokeMigrate(tgzAbs)` — fresh 대상에 겹치면 D19가 발동해 다른 것을 검증하게 된다 |
| companion 경로는 타사와 겹치지 않는다 | `.claude/skills/commitgate-<name>/` vs 타사 `.claude/skills/<name>/` — **디렉터리가 다르다** |
| `bin/**`는 이미 완성됐다 | REQ-020(설치·보안) + REQ-021(경고·uninstall). 이 REQ는 **증명만** 한다 |

## 핵심 설계 결정

### D1 — 이 REQ는 **제품 코드를 바꾸지 않는다**

`bin/**` 무변경. 공존·무추가는 **이미 성립하는 성질**이고(경로 격리 + `KIT_COMPANION_SKILLS` 미참조 migrate),
이 REQ는 그것을 **테스트·smoke로 고정**한다. 성질이 성립하지 않으면 그때 P1이고, 그건 설계가 아니라 발견이다.

### D2 — 공존은 **경로 격리**로 이미 보장된다. 그것을 고정한다

companion은 `.claude/skills/commitgate-<name>/SKILL.md`, 타사는 `.claude/skills/<name>/SKILL.md`.
**디렉터리가 달라** `planCompanionSkills`가 타사 경로를 아예 보지 않는다. `commitgate-` 접두사가 격리의 근거다(R2).

증명은 **설치 순서 양쪽**으로 한다 — 한쪽만 보면 순서 의존 버그를 놓친다:
- **A(타사 선설치)**: 타사 파일 먼저 → init → 타사 **byte-identical** + `commitgate-tdd` 별도 생성.
- **B(CommitGate 선설치)**: init → 타사 추가 → 재-init → 양쪽 보존(멱등).

⚠️ **byte-identical로 단언한다**(존재 여부가 아니라). 존재만 보면 내용이 덮여도 통과한다.

### D3 — migrate 무추가는 **부재 단언**으로 고정한다

`bin/migrate.ts`는 `KIT_COMPANION_SKILLS`를 참조하지 않는다 → dry-run·`--apply` 모두 companion을 만들지 않는다.
**그 부재를 테스트로 못박는다** — 나중에 누가 migrate에 설치를 끼워 넣으면 여기서 죽는다.

설치는 **명시적 `init`에서만**이라는 R2(REQ-020) 계약의 연장이다.

### D4 — smoke fingerprint를 **내용 기반**으로 (R7)

```js
// 현재: out.set(rel, readFileSync(abs).length)        ← 크기만
// 변경: out.set(rel, sha256(readFileSync(abs)))       ← 내용
```

🔴 **왜 실질적 문제인가**: smoke가 uninstall의 "읽기 전용"을 이 snapshot으로 검증한다.
planner가 파일을 **같은 크기로** 고쳐도 현재 구현은 통과한다 — 그 축의 유일한 end-to-end 방어선이 공허하다.

`assertSameTree`는 값 비교라 **수정 불필요**하다. `node:crypto`의 `createHash`를 쓴다(smoke는 이미 Node 표준 모듈만 쓴다).

**변이로 증명한다**: 같은 크기로 내용을 바꾼 파일을 넣으면 크기 기반은 통과하고 내용 기반은 잡는다.

### D5 — Stage B 증명을 약화하지 않는다 (R5)

기존 smoke의 무복사·무주입·`req:* = commitgate <verb>`·dispatch 도달 검증은 **그대로 둔다**.
companion 검증은 **추가만** 된다. npm 캐시 일회용 격리 규약도 유지한다.

### D6 — 정직성

- 공존은 **경로가 다르기 때문에** 성립한다. "충돌을 해결한다"가 아니라 "충돌하지 않는다"다. 과대주장하지 않는다.
- smoke는 **npm·git이 실제로 도는** 환경을 요구한다. CI 환경 제약은 이 REQ가 해결하지 않는다.
- fingerprint를 SHA-256으로 바꿔도 **읽기 전용을 강제하지는 않는다** — 위반을 **탐지**할 뿐이다.

## Phase별 구현

**2개 phase로 제한한다**(PM 지시 — 다시 넓어지지 않게):

1. `phase-1-coexist-migrate` — D2·D3 (`tests/unit/init.test.ts` · `tests/unit/migrate.test.ts`)
2. `phase-2-smoke-companion` — D4·D5 (`scripts/smoke.mjs`)

세부는 [02-plan.md](02-plan.md).

## 변경 파일

| phase | 파일 |
|---|---|
| 1 | `tests/unit/init.test.ts` · `tests/unit/migrate.test.ts` |
| 2 | `scripts/smoke.mjs` |

**`bin/**` 무변경**(D1).

## 하위호환·안전

- **제품 동작 무변경** — 테스트·smoke만 바꾼다.
- **기존 smoke 증명 유지**(R5) — companion 검증은 추가만. Stage B 인수 기준 절 그대로.
- **fingerprint 변경은 비교 축만** 바꾼다 — `assertSameTree` 로직·호출부 무변경.
- **npm 캐시 격리 유지** — 개발자 실제 캐시를 건드리지 않는다.
- **migrate smoke의 별도 대상 유지** — fresh 대상에 겹치면 D19가 발동해 다른 것을 검증하게 된다.
