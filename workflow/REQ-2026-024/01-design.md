# REQ-2026-024 설계 — init 쓰기 경로 전수 symlink confinement

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.
> 실측 기준: `main@1a851c4` (= 출시본 v0.7.0 계보).

## 현재 상태(변경 대상)

| 사실 | 실측 근거 |
|---|---|
| 쓰기 dest 9종 중 **7종에 confinement 방어가 없다** | 00-requirement §2 W1~W7 |
| 뚫린 경로 **8건**, 실패 모드 **4종**(dangling·ancestor·force·writeFileSync) | 실측 E1~E8 |
| 🔴 `existsSync`=true인 경우도 뚫린다 — 외부 **기존 파일을 수정·덮어쓴다** | E5·E6·E8 |
| `.claude/`·`workflow/`는 **우연히** 막힌다(다른 기능이 같은 조상을 검사) | K4·K5 — 그래서 `.cursor/`는 뚫림(E7) |
| **같은 규칙이 이미 두 벌 구현돼 있다** — 에러 메시지 문자열까지 동일 | `planCompanionSkills` 449-460 · gitignore 인라인 1014-1027 |
| `assertConfinedDest` 루프는 `i < segs.length - 1` — **leaf를 검사하지 않는다** | 402 |
| `assertEntrypointPathsUsable`은 `existsSync`+`statSync` — **둘 다 링크를 따라간다** | 745·752. docstring도 "ENOTDIR 방지"라고 말한다 — **symlink 방어가 아니다** |
| 쓰기는 전부 `if (!opts.dryRun)` 안에 있다 | 1149. 그래서 dry-run은 이미 무쓰기(K1) |
| 루트 `.gitignore`·lockfile은 **init이 쓰지 않는다** | apply 블록 1149-1167에 없음 — 산출물 목록·안내용 |
| 테스트 인프라가 이미 있다 | `snapshot()`(lstat/readlink) 74 · `outsideDir()` 2228 · `expectRejectedWithNoWrites()` 2239 · `trySymlink()` 2258 |

## 핵심 설계 결정

### D1 — 규칙을 발명하지 않는다. **두 벌로 존재하는 것을 헬퍼로 추출**한다

W8·W9가 이미 정답을 구현해 뒀다. 이번 결함은 **그 규칙이 6개 dest에만 붙고 나머지 7종에서 빠진 것**이다.
새 규칙을 설계하면 **세 번째 사본**이 생긴다 — 그게 이 결함의 재생산 방식이다.

```ts
/**
 * 쓰기 dest의 confinement + leaf 상태를 **한 번에** 판정한다.
 * @returns 일반 파일이면 그 `Stats`, **실제 부재(ENOENT)면 `null`**. 그 밖은 전부 throw(fail-closed).
 */
function statWritableDest(targetRoot: string, destRel: string): Stats | null {
  assertConfinedDest(targetRoot, destRel)          // 상위 컴포넌트 전부 lstat (leaf는 아래에서)
  const abs = join(targetRoot, destRel)
  let st: Stats
  try {
    st = lstatSync(abs)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
      throw new Error(`${destRel} 상태 확인 실패(${(e as Error).message}) — fail-closed.`)
    return null                                     // ENOENT만 부재로 인정(R4)
  }
  if (!st.isFile())
    throw new Error(`${destRel} 가 일반 파일이 아닙니다(symlink·디렉터리·특수파일) — 그 경로를 옮기고 재시도하십시오.`)
  return st
}
```

**이 본문은 `planCompanionSkills` 449-460과 문자 그대로 같다.** 메시지도 동일하게 유지한다 — 그래야 W8·W9를
이 헬퍼로 갈아끼우는 것이 **동작 무변경 리팩터**이고, K2·K3이 그 사실을 증명한다.

⚠️ 루트 직속 dest(`AGENTS.md`·`package.json` 등)에서 `assertConfinedDest`는 **무동작**이다(`segs.length-1 = 0`).
정상이다 — 그 dest들의 상위는 `targetRoot` 자신이고, 이미 890행에서 검사한다. leaf `lstat`이 방어를 맡는다.

### D2 — 🔴 **검사와 부재 판정을 같은 호출로 묶는다** (이 설계의 요지)

"쓰기 전에 검사를 호출한다"는 규율은 **이미 실패했다.** W8·W9에는 붙었고 W1~W7에는 안 붙었다.
체크리스트로 7곳을 고치면 **8번째 쓰기가 생길 때 또 빠진다.**

헬퍼가 **부재 판정을 반환값으로 준다.** 그러면 호출부는 `existsSync`를 쓸 이유가 없다:

```ts
const agentsSt = statWritableDest(targetRoot, 'AGENTS.md')
const agentsCreated = agentsSt === null            // ← 검사를 건너뛰면 판정도 못 한다
```

**검사를 빼먹으려면 판정을 포기해야 한다** → 드리프트가 구조적으로 불가능해진다. 규율이 아니라 타입이 강제한다.

### D3 — `applyCopies`에 **전량 검증 후 쓰기** 백스톱. 검증 가능하게 export한다

`plan.copies`는 `add()`만 채우지 않는다 — `planCompanionSkills`의 결과가 **직접 편입**된다(REQ-020 D3).
즉 **`add()`를 우회하는 경로가 이미 존재한다.** write-time 불변식이 실질적 가치를 갖는 이유다.

```ts
export function applyCopies(targetRoot: string, plan: InstallPlan): void {
  for (const { destRel } of plan.copies) statWritableDest(targetRoot, destRel)   // ① 전량 검증
  for (const { srcAbs, destRel } of plan.copies) {                               // ② 그 뒤에만 쓰기
    const destAbs = join(targetRoot, destRel)
    mkdirSync(dirname(destAbs), { recursive: true })
    copyFileSync(srcAbs, destAbs)
  }
}
```

🔴 **두 루프여야 한다.** 한 루프에서 검사·쓰기를 섞으면 중간 throw 시 앞의 파일이 이미 복사돼 **부분 설치**가 된다
(롤백 0줄) — preflight→apply 계약 위반이다.

🔴 **export 없이는 이 백스톱을 검증할 수 없다.** preflight가 완전하면 백스톱은 **절대 발화하지 않는다** →
`runInit` 경유 테스트에서 백스톱을 제거하는 변이가 **그대로 통과**한다 = oracle이 공허하다.
`applyCopies`를 export하고 **손으로 만든 plan**(검사를 안 거친 dest 포함)을 넘겨야 진짜 oracle이 된다.
`planInstall`·`planCompanionSkills`·`planArtifactPaths`가 **같은 이유로 이미 export돼 있다** — 기존 관례다.

**정직성**: 이 백스톱은 **불변식 강제**지 주 방어선이 아니다. 주 방어선은 preflight(D2)다.
TOCTOU도 막지 못한다 — ①과 ② 사이에도 창이 있다.

🔴 **백스톱의 대가 — 정상 경로에서 preflight 결함을 가린다** (design-r01 P1).
preflight에 구멍이 나도 백스톱이 쓰기 직전에 거부하므로 `runInit` 경유 테스트는 **계속 초록**이다.
그러나 그때 거부는 preflight가 아니라 apply이고, **`--dry-run`은 백스톱에 도달하지 못해 조용히 통과한다**(R5 위반).
즉 백스톱은 **자기 위층의 결함을 감춘다.**

**그래서 preflight 도달을 `--dry-run`으로 분리 관측한다.** `applyCopies`는 `if (!opts.dryRun)` **안**에 있으므로
dry-run에는 preflight throw만 보인다. 실측으로 이 계측이 양방향으로 작동함을 확인했다:

| 실측(현행 코드 = `add()` 변이와 같은 상태) | dry-run throw |
|---|---|
| `.cursor/` ancestor junction | **없음** → 변이를 잡는다(공허하지 않다) |
| `workflow/machine.schema.json` live leaf + `--force` | **없음** → 변이를 잡는다 |
| `.claude/skills/commitgate-tdd/SKILL.md` dangling (이미 방어됨) | **있음** → 계측이 눈멀지 않았다 |

`planInstall` 직접 호출로도 관측할 수 있지만 **`--dry-run`이 낫다**: 공개 API이고, `PlanFacts`를 손으로 조립하지
않아도 되며, **R5(dry-run이 같은 판정을 받는다)를 같은 단언으로 함께 증명**한다.

### D4 — `assertEntrypointPathsUsable`은 **UX 메시지용**. 방어를 맡기지 않고 docstring을 정정한다

이 함수는 992행에서 `planInstall`(1055)보다 먼저 돌고 `existsSync`+`statSync`를 쓴다 — **링크를 따라간다**(E7이 실증).

**lstat 기반으로 바꾸지 않는다.** 바꾸면 `add()`의 검사와 규칙이 **두 벌**이 된다 — D1이 없애려는 바로 그 구조다.
이 함수의 실질 가치는 **더 나은 에러 메시지**다(`--no-agent-entrypoints`를 안내한다). 그 역할만 남긴다.

대신 **docstring이 거짓말을 하지 않게 정정한다**: "이 함수는 ENOTDIR UX 메시지용이며 **confinement 방어가 아니다.
방어는 `statWritableDest`가 한다"**. 지금 docstring("dest 경로들이 실제로 만들어질 수 있는지 확인한다")은
symlink dest에 대해 **틀렸다** — 그건 "만들어질 수 있다"가 아니라 "**대상 밖에** 만들어진다"다.

순서 의존이 남는다: symlink에 대해 이 함수가 먼저 **다른 메시지**로 throw할 수 있다(예: `.cursor`가 파일 symlink면
"디렉터리가 아니라 파일입니다"). **보안상 무해하다** — 둘 다 쓰기 전 throw다. 메시지도 틀리지 않았다.

### D5 — `package.json`·`req.config.json` 검사는 **읽기보다 앞**에 둔다

두 파일은 판정 직후 **내용을 읽는다**(`parseJsonObject` 895·940, `loadConfig` 944).
검사를 읽기 뒤에 두면 **대상 밖 파일을 읽고 나서** 막는 셈이 된다. 앞에 둔다.

**동작 변경(정직하게 적는다)**: symlink된 `package.json`으로 init하던 사용자는 **이제 실패한다.**
CHANGELOG에 breaking으로 적지 **않는다** — 현재 동작(대상 밖 파일을 조용히 수정, E6)은 **누구도 의도한 적 없다.
버그 수정이다.** 다만 "symlink된 package.json은 이제 거부된다"는 사실은 적는다.
부재 케이스의 기존 메시지(`package.json이 없습니다`)는 **그대로 유지**한다 — `statWritableDest`가 `null`을 주므로.

### D6 — 정직성 (주장하지 않는 것)

- 🔴 **TOCTOU를 막지 않는다.** preflight와 apply 사이에 경로가 바뀌는 경쟁은 남는다. Node에 `O_NOFOLLOW`
  원자 API가 없다 — 막으려면 트랜잭션 백엔드가 필요하다. 이 REQ는 **협조적 사용자의 우발적 symlink**를 막는다.
  **문구로도 그 이상을 주장하지 않는다.**
- **`bin/migrate.ts`·`bin/uninstall.ts`는 측정하지 않았다.** "거기는 안전하다"고 **말하지 않는다**. 후속 REQ.
- `.claude/`·`workflow/`가 지금 막히는 것은 **우연**이다. 이 REQ 뒤에는 **각 경로가 자기 검사로** 막힌다 —
  그 차이를 테스트로 고정한다(companion·gitignore를 지워도 `.cursor/`가 막혀야 한다).
- 백스톱(D3)은 정상 경로에서 **절대 발화하지 않는다**. 커버리지 숫자를 근거로 쓰지 않는다.

## Phase별 구현

**2개 phase로 제한한다.** REQ-020은 설계 1개가 6 phase를 덮어 **설계 리뷰가 13회**로 늘었다(앞 phase 승인마다
전체 재검수 — CommitGate 알려진 결함). phase를 작게 유지한 REQ-021·022는 2회·1회였다. **검수 면적 축소가 유일하게 통한 대책이다.**

1. `phase-1-confine-helper-add` — D1·D2·D3·(W8·W9 리팩터)·(W1·W2 `add()`). 모드 **A·B·C**.
2. `phase-2-confine-individual-writes` — D4·D5·(W3~W7). 모드 **A·D**.

세부는 [02-plan.md](02-plan.md).

## 변경 파일

| phase | 파일 |
|---|---|
| 1 | `bin/init.ts` · `tests/unit/init.test.ts` |
| 2 | `bin/init.ts` · `tests/unit/init.test.ts` |

각 phase 2파일 — granularity 정책(8파일 이하) 충족. **`bin/migrate.ts`·`bin/uninstall.ts`·`scripts/**` 무변경.**

## 하위호환·안전

- **정상 경로 무변경.** symlink가 없으면 `statWritableDest`는 `existsSync`와 **같은 답**을 준다
  (일반 파일 → Stats(존재) / ENOENT → null(부재)). 산출물·안내·stage 목록 전부 동일.
- **기존 방어 무약화**(R7): W8·W9 리팩터는 **같은 메시지·같은 순서**다. K2·K3·K4·K5가 그대로 그린이어야 한다 —
  하나라도 빨개지면 리팩터가 동작을 바꾼 것이다.
- **`--dry-run` 의미 유지**: 검사는 전부 preflight라 dry-run도 **같은 판정**을 받는다(K1). 쓰기는 여전히 0건.
- **`--no-agent-entrypoints` 의미 유지**: 진입점·companion을 건너뛰면 그 dest 검사도 안 돈다(D5/D7 유지).
- **`--force` 의미 축소 없음**: force는 원래 "덮어쓰기 가능한 kit 항목만 갱신"이다. symlink dest는
  **덮어쓰기 대상이 아니라 대상 밖 파일**이다 — 거부는 force의 의미와 충돌하지 않는다.
- **API 표면**: `applyCopies` export **추가**(D3). 제거·시그니처 변경 없음.
- **에러 메시지 신규**: symlink/특수파일 dest에 대한 throw. 기존 메시지는 전부 유지.
