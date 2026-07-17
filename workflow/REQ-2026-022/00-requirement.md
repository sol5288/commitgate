# REQ-2026-022 요구사항 — Companion Skills: 공존·migration 무추가·packed-tarball smoke (REQ-A2-2)

## 1. 배경

REQ-020이 companion skills 4종을 기본 설치하게 했고, REQ-021이 gitignore 경고·uninstall 계획을 붙였다.
남은 수명주기 계약은 **다른 도구와의 공존**과 **실제 tarball 설치본에서의 증명**이다:

- 사용자가 이미 Matt Pocock의 skills(`tdd`·`grill-me` 등)를 깔아 뒀을 수 있다 → **타사 파일을 건드리면 안 된다**.
- Stage A 프로젝트의 `migrate`가 companion을 **조용히 추가하면 안 된다**(명시적 init에서만 설치).
- 현재 smoke는 companion을 전혀 보지 않는다 → **packed tarball 설치본에서 4종이 실제로 깔리는지 미증명**.

**PM 결정: REQ-A2-1/2/3 셋 다 승인·검증된 뒤 하나의 PR로 통합 병합.** 이 REQ 단독 병합은 없다.

## 2. 목표(What)

companion skills가 **타사 skill과 공존**하고, **migrate가 추가하지 않으며**, **실제 tgz 설치본에서 동작**함을 증명한다.

## 3. 요구(정규화)

- **R1 타사 skill 보존**: 타사 `.claude/skills/tdd/SKILL.md`가 **설치 순서 양쪽**(타사 선설치 / CommitGate 선설치)에서
  **byte-identical로 유지**된다. (Done #1)
- **R2 이름 충돌 없음**: `commitgate-tdd`는 타사 `tdd`와 **별도로 생성**된다. `commitgate-` 접두사가 격리한다. (Done #2)
- **R3 migrate 무추가**: `commitgate migrate`의 **dry-run과 `--apply` 모두** companion 4종을 **생성하지 않는다**.
  설치는 명시적 `init`에서만 일어난다. (Done #3)
- **R4 packed smoke**: 실제 `npm pack` tarball을 설치한 뒤 `init`이 companion 4종을 **정확한 경로에 생성**한다. (Done #4)
- **R5 Stage B 증명 유지**: 기존 smoke의 무복사(`scripts/req/**` 부재)·무주입(`tsx`/`ajv`/`cross-spawn`)·
  `req:*`가 package bin 지시·dispatch 도달 증명을 **약화하지 않는다**. (constraints)
- **R6 Stage A migrate smoke**: packed 설치본의 Stage A migrate smoke에서도 **companion 부재**를 확인한다. (Done #5)
- 🔴 **R7 smoke fingerprint 보정**: 현재 `snapshot()`이 **파일 크기만** 비교해 **같은 크기의 내용 변경을 놓친다**
  (`out.set(rel, readFileSync(abs).length)` 실측). **SHA-256 등 내용 기반 fingerprint**로 바꿔
  uninstall "읽기 전용" 검증을 실질적으로 만든다. (Done #6)
- **R8 테스트·typecheck**: 단위 테스트·typecheck·smoke 통과. npm 캐시는 기존대로 **일회용으로 격리**한다. (Done #7)

## 4. 비목표 — 이번 범위에서 구현하지 않음

**PM 결정: 다시 넓어지지 않도록 2개 phase로 제한한다.**

- **REQ-A2-3**: README(ko/en)·CLI help·CHANGELOG · **Cursor CLI 버전·모드 재검증 후 지원 표기 확정**.
  🔴 **여전히 범위 밖이다.**
- 제품 코드 변경. 이 REQ는 **테스트·smoke만** 바꾼다 — `bin/**` 무변경.
- `uninstall --apply`·자동 정리·manifest·provenance.
- 출시본 v0.7.0의 dangling symlink 구멍(REQ-C) · finalize 강제(REQ-D) · 문서 템플릿(REQ-B).

## 5. 유지되는 이전 결정 (실측)

- smoke의 `snapshot()`은 `readFileSync(abs).length` — **크기만** 본다(R7의 근거). `.git`·`node_modules` 제외.
- `assertSameTree`는 `after.get(k) !== before.get(k)`로 비교 → fingerprint를 바꾸면 그대로 동작한다.
- smoke는 일회용 npm 캐시(`npm_config_cache`)로 개발자 실제 캐시를 격리한다 — **이 규약을 유지한다**.
- `smokeMigrate(tgzAbs)`는 **별도 Stage A 시드 대상**을 쓴다. fresh 대상에 겹쳐 쓰면 D19가 발동해 다른 것을 검증하게 된다.
- companion은 `.claude/skills/commitgate-<name>/SKILL.md`이고 타사는 `.claude/skills/<name>/` — **디렉터리가 다르다**.

## 6. 대표 예시·실패 경계

**공존 A(타사 선설치)**: `.claude/skills/tdd/SKILL.md`(타사)를 먼저 두고 init → 타사 파일 바이트 불변, `commitgate-tdd` 별도 생성.
**공존 B(CommitGate 선설치)**: init 후 타사 skill 추가 → 재-init → 양쪽 보존.
**migrate**: Stage A 프로젝트 → `migrate` dry-run·`--apply` → `.claude/skills/commitgate-*` **부재**.
**packed smoke**: tgz 설치 → `init` → 4종 생성 · `scripts/req/**` 부재 · devDep 무주입.

## 7. 용어

- **공존**: 타사 skill과 CommitGate companion이 같은 `.claude/skills/` 아래에서 서로를 건드리지 않는 상태.
- **fingerprint**: 트리 비교용 파일 지문. 지금은 크기, R7 이후 SHA-256.

## 8. 인수 기준

1. 공존 A/B 양쪽에서 타사 `tdd/SKILL.md`가 **byte-identical**로 유지되고 `commitgate-tdd`가 별도 생성된다. (R1/R2)
2. `migrate` dry-run·`--apply` 모두 companion 4종을 생성하지 않는다. (R3)
3. packed tarball 설치 후 `init`이 4종을 정확한 경로에 생성한다. (R4)
4. 기존 smoke의 Stage B 증명(무복사·무주입·bin 지시·dispatch)이 전부 유지된다. (R5)
5. Stage A migrate smoke에서 companion 부재를 확인한다. (R6)
6. 🔴 smoke `snapshot()`이 **내용 기반 fingerprint**다. **같은 크기의 내용 변경을 잡는다** — 변이로 증명한다. (R7)
7. typecheck·전체 test·smoke 통과. npm 캐시 격리 유지. (R8)

세부는 [01-design.md](01-design.md) · [02-plan.md](02-plan.md).
