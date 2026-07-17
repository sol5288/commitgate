# REQ-2026-024 요구사항 — init 쓰기 경로 전수 symlink confinement (REQ-C)

## 1. 배경

출시본 v0.7.0의 `commitgate init`은 **대상 저장소 밖에 파일을 만들고 수정한다.** REQ-2026-020이 companion
skills에, REQ-2026-012가 `workflow/.gitignore`에 confinement 방어를 붙였지만 **나머지 쓰기 경로에는 붙지 않았다.**

🔴 **PM 확정: 이 REQ는 npm publish의 선행 조건이다.** 기존 자산 경로의 결함을 **알면서 새 버전을 발행하지 않는다.**

## 2. 실측 — 현행 v0.7.0 (`main@1a851c4`)

각 시나리오는 fresh 대상(`git init` + `package.json`) + 대상 **밖** 디렉터리를 만들고, `runInit`을 돌린 뒤
**외부 디렉터리 전후 트리를 SHA-256으로 비교**했다. 아래는 그 결과이며 추정이 아니다.

### 뚫린 경로 8건 / 실패 모드 4종

| # | 경로 | 모드 | 결과 |
|---|---|---|---|
| E1 | `AGENTS.md` | A. dangling leaf | 🔴 대상 밖 **생성** |
| E2 | `CLAUDE.md` | A. dangling leaf | 🔴 대상 밖 **생성** |
| E3 | `AGENTS.commitgate.md` | A. dangling leaf | 🔴 대상 밖 **생성** |
| E4 | `req.config.json` | A. dangling leaf | 🔴 대상 밖 **생성** |
| E5 | `req.config.json` | D. live leaf → 외부 실파일 | 🔴 외부 파일 **수정** |
| E6 | `package.json` | D. live leaf → 외부 실파일 | 🔴 외부 파일 **수정** |
| E7 | `.cursor/rules/commitgate.mdc` | B. ancestor dir symlink | 🔴 대상 밖 **생성** |
| E8 | `workflow/machine.schema.json` | C. live leaf + `--force` | 🔴 **사용자 파일 덮어씀** |

**실패 모드**
- **A — dangling leaf**: `existsSync`가 **false** → "부재" 오판 → 쓰기가 링크를 따라 대상 밖에 **생성**.
- **B — ancestor dir symlink**: `existsSync`·`statSync`가 링크를 **따라가** `isDirectory()`=true → 통과 → `mkdirSync`+쓰기가 밖에.
- **C — live leaf + `--force`**: `add()`가 `existsSync && !force`라 force면 copies에 넣음 → `copyFileSync`가 링크 따라 **외부를 덮어씀**.
- **D — live leaf + `writeFileSync`**: `existsSync`=true → 기존 파일로 읽고 병합 → `writeFileSync`가 링크 따라 **외부를 수정**.

🔴 **A만이 아니다.** `existsSync`가 true인 경우(C·D)도 뚫린다 — 그쪽은 **생성이 아니라 기존 외부 파일 파괴**라 더 무겁다.

### 통과한 대조군 (이 REQ가 약화하면 안 되는 것)

| # | 시나리오 | 결과 |
|---|---|---|
| K1 | `AGENTS.md` dangling + `--dry-run` | ✅ 외부 불변 (쓰기 전부 `if (!opts.dryRun)` 안) |
| K2 | `workflow/.gitignore` dangling leaf | ✅ THROW · 외부 불변 (REQ-012 방어) |
| K3 | `.claude/skills/commitgate-tdd/SKILL.md` dangling leaf | ✅ THROW · 외부 불변 (REQ-020 방어) |
| K4 | `.claude/` ancestor dir symlink | ✅ THROW · 외부 불변 |
| K5 | `workflow/` ancestor dir symlink | ✅ THROW · 외부 불변 |

⚠️ **K4·K5는 부수 효과지 설계된 방어가 아니다.** `.claude/`는 `planCompanionSkills`가, `workflow/`는
`assertConfinedDest(KIT_GITIGNORE.dest)`가 **같은 상위 경로를 우연히 공유**해서 걸린다. 그래서 그 상위를
공유하지 않는 `.cursor/`는 **그대로 뚫린다(E7)**. 방어의 근거가 "다른 기능이 마침 같은 조상을 검사한다"인 것은
계약이 아니다 — companion skills를 빼거나 `KIT_GITIGNORE`를 옮기면 조용히 되살아난다.

### 쓰기 지점 전수 (`bin/init.ts` apply 블록 1149-1167)

| W | dest | 판정 | 쓰기 | 방어 |
|---|---|---|---|---|
| W1 | `KIT_COPY_RELPATHS` 3종(`workflow/**`) | `add()` `existsSync && !force` (689) | `applyCopies` 762 | ❌ (E8) |
| W2 | `KIT_AGENT_ENTRYPOINTS` 3종(`.claude/**`·`.cursor/**`) | `add()` (689) | `applyCopies` 762 | ❌ (E7) |
| W3 | `req.config.json` | `existsSync(cfgPath)` (940) | `writeFileSync` 1151 | ❌ (E4·E5) |
| W4 | `package.json` | `existsSync(pkgPath)` (895) | `writeFileSync` 1156 | ❌ (E6) |
| W5 | `AGENTS.md` | `!existsSync` (989) | `copyFileSync` 1158 | ❌ (E1) |
| W6 | `CLAUDE.md` | `!existsSync` (1000) | `copyFileSync` 1160 | ❌ (E2) |
| W7 | `AGENTS.commitgate.md` | `!existsSync \|\| force` (1004) | `copyFileSync` 1161 | ❌ (E3) |
| W8 | `workflow/.gitignore` | `assertConfinedDest` + leaf `lstat` ENOENT-only (1013-1027) | `copyFileSync` 1165 | ✅ |
| W9 | companion skills 4종 | `planCompanionSkills` 동일 규칙 (443-466) | `applyCopies` 762 | ✅ |

**이게 전부다.** 루트 `.gitignore`(`plan.gitignoreRel`)와 lockfile(`plan.lockfileRel`)은 **init이 쓰지 않는다** —
산출물 목록·안내에만 등장한다(apply 블록에 쓰기 없음). 쓰기 집합은 W1~W9로 닫힌다.

### 수리 재료가 이미 리포 안에 있다

W8(1014-1027)과 W9(449-460)는 **같은 규칙을 두 벌 구현**해 뒀다 — 에러 메시지 문자열까지 동일하다:
`assertConfinedDest`(상위 전부 `lstat`) + leaf `lstatSync`(**ENOENT만** 부재) + `!isFile()` → throw.
그 규칙이 **6개 dest에만 적용되고 나머지에서 빠진 것**이 이번 결함이다. 규칙을 새로 발명할 필요가 없다.

## 3. 요구(정규화)

- **R1 모드 A 차단**: 어떤 쓰기 dest가 **dangling symlink**여도 대상 밖에 파일이 생기지 않는다. (Done #1)
- **R2 모드 B 차단**: 어떤 쓰기 dest의 **상위 컴포넌트가 symlink/junction**이면 거부한다 — 대상 안·밖·dangling **무관**.
  🔴 **`.cursor/`가 실증 경로다**(E7). `.claude/`·`workflow/`가 우연히 막히는 것에 기대지 않는다. (Done #2)
- **R3 모드 C·D 차단**: dest가 **살아있는 symlink**여도 그 링크를 따라 외부를 **수정·덮어쓰지 않는다**.
  `--force`도 예외가 아니다. (Done #3)
- **R4 fail-closed**: 부재는 **ENOENT만** 인정한다. EACCES·ELOOP를 부재로 삼키면 apply에서 늦게 실패해
  **부분 설치**가 된다(롤백 없음). (Done #4)
- **R5 preflight 유지**: 모든 거부는 **쓰기 0건**인 상태에서 일어난다. preflight→apply 계약을 지킨다.
  `--dry-run`도 같은 검사를 받는다(K1 유지). (Done #5)
- **R6 외부 tree 불변**: 위 8 시나리오 전부에서 **대상 밖 디렉터리의 전후 트리가 바이트 동일**하다.
  🔴 **대상 tree만 스냅샷하면 공허하다** — escape는 정의상 대상 밖에서 일어난다(REQ-020 실측 교훈). (Done #6)
- **R7 기존 방어 무약화**: K1~K5가 **그대로 그린**이다. (constraints)
- **R8 정상 경로 무회귀**: symlink가 없는 일반 설치·재설치(멱등)·`--force`·`--no-agent-entrypoints`·
  `--strict`·`--dry-run`·migrate·uninstall이 **동작 불변**. (constraints)
- **R9 테스트·typecheck**: 단위 테스트·typecheck 통과. 각 oracle은 **변이로 공허하지 않음을 증명**한다. (Done #7)

## 4. 비목표 — 이번 범위에서 구현하지 않음

- **`bin/migrate.ts`·`bin/uninstall.ts`의 쓰기 경로.** 이 REQ는 **`bin/init.ts`만** 본다.
  ⚠️ **"거기는 안전하다"고 주장하지 않는다** — 이번에 **측정하지 않았다**. 별도 REQ로 같은 실측을 돌린다(후속).
- **TOCTOU 제거.** preflight와 apply 사이에 경로가 바뀌는 경쟁 조건은 이 설계가 막지 않는다.
  Node에 `O_NOFOLLOW` 원자 API가 없다 — 막으려면 트랜잭션 백엔드가 필요하다(가드레일: 절대 주장 금지).
  이 REQ는 **협조적 사용자의 우발적 symlink**를 막는다. 그 이상을 문구로도 주장하지 않는다.
- **배송 게이트**(동일 SHA 원격 CI 성공 후 main 전진) — 별도 REQ.
- **REQ-D**(finalize 사람 확인 강제) · **REQ-B**(템플릿·persona).
- npm publish·tag·release. 🔴 **이 REQ 완료가 publish의 선행 조건일 뿐, 이 REQ가 publish를 포함하지 않는다.**

## 5. 대표 예시·실패 경계

**정상**: symlink 없는 대상 → 설치 성공, 산출물 동일(회귀 없음).
**모드 A**: `AGENTS.md` → `../outside/X.md`(없음) → **throw**, `../outside/X.md` **미생성**.
**모드 B**: `.cursor` → junction(`../outside/cursor-dir`) → **throw**, 그 디렉터리 **불변**.
**모드 C**: `workflow/machine.schema.json` → `../outside/user.md`(존재) + `--force` → **throw**, `user.md` **바이트 불변**.
**모드 D**: `req.config.json` → `../outside/real.json`(존재) → **throw**, `real.json` **바이트 불변**.
**dry-run**: 위 전부 `--dry-run` → **throw**(preflight라 동일), 외부·대상 **둘 다 불변**.

## 6. 용어

- **confinement**: 쓰기가 `targetRoot` 하위의 **실제 경로**에만 닿는 성질. symlink 추종은 그 자체로 위반이다.
- **leaf / ancestor**: dest 경로의 마지막 컴포넌트 / 그 앞의 모든 컴포넌트.
  ⚠️ `assertConfinedDest`의 루프는 `i < segs.length - 1`이라 **leaf를 검사하지 않는다** — leaf는 별도 `lstat`이 필요하다.
- **fail-closed**: 상태를 확정할 수 없으면 거부한다. "확인 실패"를 "부재"로 읽지 않는다.

## 7. 인수 기준

1. 실측 8 시나리오(E1~E8) 전부에서 **throw + 외부 tree 바이트 불변**. (R1·R2·R3·R6)
2. `.cursor/` ancestor symlink가 **자기 자신의 검사로** 막힌다 — companion·gitignore를 지워도 막힌다. (R2)
3. `--force`가 외부 파일을 덮지 않는다. (R3)
4. EACCES 등 비-ENOENT는 **부재로 삼키지 않고** throw. (R4)
5. 모든 거부가 **쓰기 0건**에서 일어난다. `--dry-run`도 동일 판정. (R5)
6. K1~K5 대조군이 그대로 그린. (R7)
7. 정상 설치·멱등 재설치·`--force`·`--no-agent-entrypoints`·`--strict`·migrate·uninstall 회귀 없음. (R8)
8. typecheck·전체 test 통과. 각 신규 oracle은 **변이 검증**을 동반한다. (R9)

세부는 [01-design.md](01-design.md) · [02-plan.md](02-plan.md).
