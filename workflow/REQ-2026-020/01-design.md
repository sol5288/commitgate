# REQ-2026-020 설계 — Companion Skills 내부 번들·설치

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.
> 아래 실측은 전부 `main@b502c71`(v0.7.0) 기준이다.

## 현재 상태(변경 대상)

| 사실 | 실측 근거 |
|---|---|
| init은 이미 skill을 설치한다 | `bin/init.ts` `KIT_AGENT_ENTRYPOINTS` — `templates/claude-skill.md` → `.claude/skills/commitgate/SKILL.md` |
| 얇은 포인터 원칙이 코드 주석에 있다 | `bin/init.ts` — "본문 SSOT는 `AGENTS.md`다. 여기 깔리는 파일은 **얇은 포인터**이며 계약 본문을 복제하지 않는다 — 복제하면 drift 부채가 된다." |
| skip은 **존재 검사**다 | `add()` 클로저 `if (existsSync(destAbs) && !force)` — 사용자 수정 탐지 없음. `--force`가 덮는다 |
| sha256은 **ownership 축**이다(skip 축 아님) | `add()` 내부 — 이미 skip된 파일이 `ownedSkips`(→ `git add` 목록)에 낄지만 결정 |
| seed-once 선례가 있다 | `workflow/.gitignore` — `opts.force`를 보지 않고 부재 시에만 생성, 자체 `sha256File` ownership |
| confinement 호출부는 1곳뿐 | `grep -rn assertConfinedDest bin/ scripts/ tests/` → 정의 + `KIT_GITIGNORE.dest` 호출 **1곳**. `applyCopies`는 bare `mkdirSync`+`copyFileSync` |
| `assertEntrypointPathsUsable`은 symlink 방어가 아니다 | `existsSync`/`statSync`는 symlink를 따라간다. dest 목록 하드코딩 |
| `files[]`에 `skills` 없음 | `package.json` 12개 화이트리스트. 누락 시 tarball에서 `walkFiles` ENOENT |
| `.npmignore` 없음 | 루트 `.gitignore`가 화이트리스트 내부에도 적용. npm이 dot-basename을 strip |
| uninstall은 읽기 전용 | `bin/uninstall.ts` — `node:fs` 조회 API만, `--apply` 없음. `toolEntries`가 자산 목록 |
| rollback 코드 0줄 | 보장은 "쓰기 **전에** 실패"(Preflight→Apply) |

## 핵심 설계 결정

### D1 — 설치 경로는 `.claude/skills/` 단독

`.claude/skills/commitgate-<name>/SKILL.md` 4종. `.agents/skills/`에는 설치하지 않는다.

근거: CommitGate에서 **Codex는 read-only 샌드박스의 Reviewer**이고 4종은 전부 **Builder용**이라 Codex에 불필요하다.
주 Builder는 Claude Code이고 거기서 native로 동작한다. 기존 `KIT_AGENT_ENTRYPOINTS` 선례와 일치하고,
`.claude/` 아래이므로 `--no-agent-entrypoints`(D5)에 자연히 걸린다.

**정직한 지원 매트릭스** (설치 경로 결정의 근거. 문서화는 REQ-A2 — 아래 주의):

| harness | 발견 | 호출 |
|---|---|---|
| **Claude Code** | ✅ native (`.claude/skills/`) | 모델 판단 또는 `/commitgate-*` |
| **Cursor IDE** | ✅ `.claude/skills` 호환 읽기 | 모델 판단 또는 `/` 선택 |
| **Cursor CLI** | ❌ **벤더 버그 — 이번 릴리스의 문서화된 제한** | — |
| **Codex** | ❌ (`.agents/skills`만 스캔) | — (설계상 불필요: Reviewer) |

🔴 **Cursor CLI는 `.claude/skills`를 로드하지 못한다.** Cursor 스태프가 확인한 **알려진 벤더 버그**다:
> "This is a known issue. The CLI still doesn't correctly load skills from `.claude/skills`, even though everything works fine in the IDE."
> — Cursor 팀, [forum.cursor.com/t/cursor-cli-does-not-load-claude-skills/154783](https://forum.cursor.com/t/cursor-cli-does-not-load-claude-skills/154783)
> (독립 제보: [/t/cursor-cli-not-loading-skills-from-claude-folder/154907](https://forum.cursor.com/t/cursor-cli-not-loading-skills-from-claude-folder/154907))

벤더 문서(`cursor.com/docs/skills`)는 IDE와 CLI를 **구분하지 않아** 최초 조사가 이 차이를 놓쳤다(design-r06 P1).

**대응 — 문서화된 제한으로 명시하고 우회하지 않는다:**
- `.cursor/skills/` 이중 설치를 **하지 않는다**. 스태프가 그 경로도 "CLI에선 별도 버그로 동작 안 할 수 있다"고 했다 —
  효과가 불확실한 경로를 위해 이중 설치(drift 위험 + 설계 표면 확장)를 감수할 근거가 없다.
- Cursor CLI 사용자에게 companion skills는 **설치되지만 발견되지 않는다.** 핵심 워크플로는 영향 없다(R10) —
  스킬은 품질 보조 레이어이고 계약 정본은 `AGENTS.md`다(D10).
- 벤더가 고치면 **우리 변경 없이 자동으로 동작한다**(같은 경로를 읽게 되므로). 그래서 지금 우회 경로를 만들지 않는다.
- ⚠️ **이 표의 문서화(README·help)는 REQ-A2다**(2차 축소). 🔴 그때 **Cursor CLI 표기를 검증한 버전·모드와 함께 재승인**해야 한다 —
  같은 스레드에 "다음 CLI 릴리스에서 수정 예정"이 있어 **`❌`는 보편적 제품 사실이 아니라 버전·모드 의존 상태**다(PM 지시).
  검증 불가면 `⚠️ 버전/모드별 동작 차이 가능, 보장하지 않음`으로 표기한다. 이번 REQ는 이 표를 **문서에 싣지 않는다**.

🔴 **"auto-invoked"라고 쓰지 않는다.** 세 harness 모두 발견은 native지만 **호출은 모델 판단(확률적)**이다.
Claude Code는 listing 예산 초과 시 description을 drop하고, 벤더 문서 스스로 결정론적 강제는 hooks로 하라고 안내한다.
결정론적 주입 계층은 Codex=`AGENTS.md`(무조건 concat), Cursor=`alwaysApply:true` 뿐이며 — **이것이 `AGENTS.md`가
계약 정본으로 남아야 하는 이유다**(R8).

### D2 — 패키지 payload

- `package.json` `files[]`에 **`"skills"` 추가**. 누락 시 tarball에서 `walkFiles` ENOENT(과거 P1 유형).
- 스킬 파일명에 **dot-prefix 금지**(npm이 dot-basename을 strip — `templates/workflow.gitignore`가 non-dot인 이유).
- 런타임 해소는 기존 `PACKAGE_ROOT` 방식을 그대로 쓴다. 신규 해소 로직 없음.

### D3 — seed-once (force-immune)

`add()` 경로를 **쓰지 않고** `workflow/.gitignore`(D12) 방식을 따른다: 부재 시에만 생성, `opts.force` 무시,
자체 `sha256File` ownership 계산 후 `ownedSkips` push.

근거: 스킬은 **사용자가 고치라고 만든 자산**이다. `add()` 경로면 `--force`가 손수정을 조용히 날린다 — 이 REQ에서
가장 현실적인 데이터 손실 경로다. persona가 SEED-ONCE인 것과 같은 논리다.

비용(정직하게): `sha256File` + `ownedSkips` + `PlanFacts`/`InstallPlan` 필드.
⚠️ `uninstall.ts` `toolEntries` 반영은 **REQ-A2**다(2차 축소) — 이번 REQ는 `bin/uninstall.ts`를 **건드리지 않는다**.

⚠️ **3-way 판별을 약속하지 않는다.** "사용자 수정"과 "다른 버전이 깐 것"을 구분할 수단이 없다(§00-5). 부재면 생성, 존재하면 보존 — 그뿐이다.

### D4 — 보안 동등성은 **신규 코드**다 (상속되지 않는다)

`.claude/`는 `workflow/`처럼 공유 부모를 통한 우연한 보호가 **없다**. `applyCopies`는 무방비(bare `mkdirSync`+`copyFileSync`)이고
Apply 중엔 rollback이 없으므로(§00-5) **preflight에서 막아야** 한다.

**D4-1 (핵심) — 4개 최종 destination *각각*에 `assertConfinedDest`를 호출한다.**

```
assertConfinedDest(targetRoot, '.claude/skills/commitgate-discovery/SKILL.md')
assertConfinedDest(targetRoot, '.claude/skills/commitgate-tdd/SKILL.md')
assertConfinedDest(targetRoot, '.claude/skills/commitgate-diagnosing-bugs/SKILL.md')
assertConfinedDest(targetRoot, '.claude/skills/commitgate-research/SKILL.md')
```

🔴 **skills 루트(`.claude/skills`)만 넘기면 구멍이 남는다.** `assertConfinedDest`는 `for (i = 0; i < segs.length - 1; i++)`로
**마지막 컴포넌트를 검사하지 않는다**. 루트를 넘기면 `.claude`만 검사되고 `commitgate-<name>`은 미검사 →
그것이 외부를 가리키는 symlink/junction이고 안에 `SKILL.md`가 없으면, seed-once의 부재 판정이 통과하고
`mkdirSync`/`copyFileSync`가 **대상 프로젝트 밖에 쓴다**(R6 위반).

각 최종 dest를 넘기면 `.claude` → `.claude/skills` → `.claude/skills/commitgate-<name>`의 **모든 기존 상위 컴포넌트**가
`lstatSync`로 검사된다. **함수 자체는 이미 `lstatSync` 기반이라 수정하지 않는다** — 호출부만 정확히 하면 된다.
ENOENT early-return은 안전하다(실제 부재 → targetRoot 안에 새로 만든다).

**D4-2** — `assertEntrypointPathsUsable`은 `statSync`라 **symlink 방어가 아니다**(mkdir 가용성 검사일 뿐).
게다가 `existsSync(sub) && …` 형태라 **dangling symlink면 검사 자체가 건너뛰어진다**. skills를 그 목록에 넣더라도
**방어로 세지 않는다.** 방어는 D4-1(상위) + D4-3(leaf)이다.

**D4-3 (핵심) — leaf `SKILL.md`는 `lstatSync`로 검사한다. `existsSync`를 쓰지 않는다.**

`assertConfinedDest`는 마지막 컴포넌트를 검사하지 않으므로 leaf는 별도 검사가 필요하다. seed-once의 부재 판정을
**`lstatSync` 기반**으로 정의한다:

| leaf 상태 | 판정 |
|---|---|
| `lstatSync` → ENOENT | **부재** — 생성 허용(유일한 생성 경로) |
| `isSymbolicLink()` | **preflight 거부** — dangling이든 아니든 |
| `isDirectory()` | **preflight 거부** |
| 그 외 특수 파일(소켓·FIFO·디바이스) | **preflight 거부** |
| 정상 파일 | **seed-once skip**(보존, `--force`도 무시) |

🔴 **`existsSync`를 부재 판정에 쓰면 안 된다.** dangling symlink(대상 밖의 아직 없는 파일을 가리킴)에서
`existsSync`는 **false**를 반환하고, seed-once가 이를 부재로 오판해 `copyFileSync`가 링크를 따라
**대상 프로젝트 밖에 SKILL.md를 만든다**(R6 위반). 이 머신에서 실측 확인:

```
existsSync(dangling symlink)     = false      ← 옛 D4-3의 잘못된 전제
lstatSync(...).isSymbolicLink()  = true       ← 올바른 판정
copyFileSync 후 외부 파일 생성    = true "PAYLOAD"
```

**D4-4 필수 oracle(phase 2)** — 두 fixture 모두 **throw + 쓰기 0회**, 검증은 **대상 tree와 외부 디렉터리 양쪽** snapshot 무변화:

> 🔴 **phase-2b 보정**: "양쪽 snapshot"은 **모든 보안 fixture에 예외 없이** 적용된다. phase-2가 일부 fixture
> (`commitgate-research` 상위 symlink · `--dry-run` symlink)에서 **대상만** snapshot해, 그 단언이 탈출 탐지기로서
> **공허**했다. 대상 안 symlink는 탈출이 일어나도 변하지 않기 때문이다.
> 실측: root-only confinement 변이에서 `runInit`이 **throw 없이 완료되고 외부에 `SKILL.md`를 생성**한다
> (현재는 `toThrow`가 회귀를 잡지만, 다른 이유로 throw하면서 외부에 쓰는 경우는 통과시킨다).
> 또한 신규 symlink fixture는 기존 `symlinkUnsupported()` 관례를 따라 **권한 없는 러너에서 그 사유로만 skip**한다.
- `.claude/skills/commitgate-tdd`가 **외부 빈 디렉터리**를 가리키는 symlink/junction (D4-1 커버)
- `.claude/skills/commitgate-tdd/SKILL.md`가 **외부의 아직 없는 파일**을 가리키는 **dangling symlink** (D4-3 커버)
- `.claude/skills`가 symlink·파일인 경우도 동일

> ⚠️ **기존 자산은 이 REQ의 범위가 아니다.** `add()`/`applyCopies`/`assertEntrypointPathsUsable`도 같은 `existsSync`
> 구멍을 갖지만(출시본 v0.7.0), 그것은 **이 REQ가 만든 결함이 아니라 기존 결함**이다. D4는 **신규 companion skills 경로에만**
> 적용한다. 기존 구멍은 [02-plan.md](02-plan.md) backlog에 증거와 함께 기록하고 **별도 REQ**로 처리한다(PM 결정).
> R6의 "같은 수준"은 **기존 구멍까지 답습하라는 뜻이 아니다** — 신규 경로는 올바른 수준으로 만든다.

### D5 — opt-out은 기존 `--no-agent-entrypoints` 하나뿐 (범위 축소)

| 플래그 | 동작 |
|---|---|
| `--no-agent-entrypoints` | `.claude/` 계층 전체를 skip하므로 companion skills도 skip된다. 기존 opt-out 의미 그대로, **신규 플래그 표면 0** |

🔴 **`--no-companion-skills`를 도입하지 않는다**(PM 결정 — 설계 리뷰 절대 상한에서의 범위 축소).

이유: 그 플래그는 companion만 건너뛰고 **기존 `.claude/skills/commitgate/SKILL.md` entrypoint는 계속 설치**한다.
그런데 그 기존 entrypoint는 이미 계약 포인터 gitignore 경고 대상이다 → `.claude/`가 gitignore된 repo에서
`--no-companion-skills`를 써도 **기존 경고가 난다**. "이 플래그면 경고 없음"을 만족시키려면 **기존 entrypoint의
R6 gitignore WARN·`--strict` fail-closed를 약화**해야 하고, 그건 R6 위반이다 — 정상 경로에서 명세와 oracle이
동시에 성립하지 않는다(design-r05 P1).

원 지시도 *"필요하면 `--no-companion-skills`를 추가하되"* 로 조건부였다. `--no-agent-entrypoints`가 이미 opt-out을
커버하므로(companion은 `.claude/` 아래에 산다) **필요하지 않다**. 필요해지면 후속 REQ에서 기존 경고 축과 함께 재설계한다.

`InitOptions`·`parseArgs`·`printHelp` 신규 변경 **없음**. R5는 `--no-agent-entrypoints`의 문서화로 충족한다.

### D6·D7 — gitignore 축·uninstall → **REQ-A2로 이관** (2차 범위 축소)

🔴 **이번 REQ는 이 두 축을 구현하지 않는다.** 설계 리뷰 11회 도달 후 PM이 범위를 축소했다(§00-1).

이번 REQ의 관련 결정은 **하나뿐**이다 — **companion을 `CONTRACT_POINTER_RELPATHS`에 섞지 않는다**
(`KIT_COMPANION_SKILLS` 별도 목록). 그 결과 **기존 gitignore·uninstall 동작이 그대로 유지된다**:
companion은 어느 경고 목록에도 없으므로 기존 계약 포인터 WARN·`--strict`는 **무변경**이고(R10 회귀로 확인),
`bin/uninstall.ts`도 **건드리지 않는다**.

이관된 설계(REQ-A2에서 재사용 — 이미 r09·r10에서 벼려졌다):
- companion gitignore WARN/`--strict` 축과 **userDiffers 경고 원인 격리 fixture**.
  핵심: `userDiffers`는 `skips`로 가서 `planArtifactPaths`(= `copies + ownedSkips`)에 **없다** →
  artifacts만 보면 ignore 검사에서 빠져 R6가 우회된다. `workflowGitignorePolicyAtRisk`와 같은 식
  (`(created || ownedSkip || userDiffers) && ignored && !tracked`)으로 판정해야 한다.
- uninstall `toolEntries`에 companion 4종. read-only 유지. `differs`는 "수정됨 **또는** 다른 버전이 깐 것"이며,
  origin 판별 불가 파일은 byte-identical이어도 자동 제거 대상에서 빠질 수 있다 — "byte-identical이면 정리 후보"라고 단정하지 않는다.

세부는 [02-plan.md](02-plan.md) §REQ-A2.

### D8 — 스킬 본문 구조

공통 골격(4종 동일):

**전제 절은 두 종류다 — discovery는 명시적 예외다.**

| 스킬 | 전제 | 근거 |
|---|---|---|
| `commitgate-tdd`·`commitgate-diagnosing-bugs`·`commitgate-research` | `req:next`가 `AGENT`일 때만 유효. 아니면 즉시 `req:next`로 복귀 | REQ 안의 구현 보조다 |
| **`commitgate-discovery`** | 🔴 **`req:new` 전 단계다. REQ가 아직 없으므로 `req:next`는 성립하지 않는다.** 이미 REQ가 있고 `req:next`가 `AGENT`면 이 스킬이 **아니다** — 그 작업을 하라 | fresh 프로젝트의 front door(D9). 공통 전제를 그대로 쓰면 **정상 진입이 막힌다** |

discovery에 공통 전제를 적용하면: fresh 프로젝트 → REQ 없음 → `req:next`가 `AGENT`를 줄 수 없음 → 본문이 "`req:next`로 복귀"를
지시 → **REQ Brief를 영원히 만들 수 없다**(R7·D9 산출물 계약 위반). 그래서 예외를 **설계에 명시**한다.

공통 골격(AGENT형 3종 예시):

```markdown
---
name: commitgate-tdd
description: <≤1024자, 언제 쓰는지>
---

## 전제
`req:next`가 AGENT일 때만 유효. 아니면 즉시 `req:next`로 복귀.

## 방법
<적응된 원칙 — 방법론만>

## 경계
commit·push·`req:commit`·state/responses stage 금지. 다음 행동은 `req:next`가 정본.

## 출처·라이선스
Adapted from https://github.com/mattpocock/skills @ `d574778f94cf620fcc8ce741584093bc650a61d3` (v1.1.0).

MIT License

Copyright (c) 2026 Matt Pocock

Permission is hereby granted, free of charge, to any person obtaining a copy
… (MIT permission notice **전문** — upstream LICENSE 21줄 축약 없이 그대로) …
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- frontmatter는 **open standard 준수**(name: 소문자+하이픈, 부모 디렉터리명 일치, ≤64자 / description ≤1024자).
  Claude Code는 관대하지만(전 필드 optional) 거기 기대면 API·claude.ai 이식성이 깨진다.
- **`commitgate-discovery`만 `disable-model-invocation: true`** — 사용자 호출형 front door. upstream `grill-me`도 같은 패턴.
  나머지 3종은 모델 호출 허용하되 **전제 블록**으로 오발동을 줄인다.
- 🔴 **각 설치 SKILL.md는 저작권 표기 + MIT permission notice 전문을 모두 담는다**(`## 출처·라이선스` 절, 본문 — HTML 주석 아님).
  근거: upstream LICENSE 12-13행이 *"The above copyright notice **and this permission notice** shall be included in
  **all copies or substantial portions** of the Software"*를 요구한다. 저작권 한 줄만으로는 **미충족**이다.
  4종 모두 upstream의 substantial adapted content를 담으므로 4종 모두에 들어간다.
  **별도 LICENSE/NOTICE 파일을 대상에 깔지 않는다** — 참조는 "included in"이 아니고, 파일 하나가 따로 복사돼 나가면 고지가 떨어진다.
  고지는 파일 자체에 동행해야 R9와 MIT를 동시에 충족한다.
- 패키지 측 `skills/ATTRIBUTION.md`는 **provenance 상세용**(upstream repo·SHA·적응 범위)이며 **대상에 설치되지 않는다**
  → 이것이 라이선스 준수 수단이 **아님**을 명시한다. 준수 수단은 위의 설치 SKILL.md 내 전문이다.
- **루트 `LICENSE`는 건드리지 않는다**(sol5288 단독 저작권).

### D9 — 각 스킬의 권한 경계 (R7)

| 스킬 | 유효 시점 | 산출물 | 금지 |
|---|---|---|---|
| `commitgate-discovery` | `req:new` **전** | REQ Brief(무엇/왜/제약/완료기준·비목표·예시·예외·용어·미결) **텍스트만** | 파일·브랜치·커밋·state 변경 |
| `commitgate-tdd` | `req:next`=AGENT | Red→Green→Refactor→테스트→stage | commit·push·state/responses stage |
| `commitgate-diagnosing-bugs` | 버그·회귀·성능 시 | 재현→최소화→가설→계측→수정→회귀 테스트 | 위와 동일. 끝나면 `req:next` 복귀 |
| `commitgate-research` | 외부 기술 선택 조사 시 | 결론·출처·한계 요약 | **조사 결과는 승인 근거가 아니다.** 설계에 영향 시 `00`/`01`에 반영 |

### D11 — 스킬 **본문**이 계약을 어기지 않게 한다 (R12) — 테스트로 고정

019 phase-1의 실패: upstream 원문을 CommitGate 권한 모델에 **적응하지 않고 옮겨** 본문이 정상 사용자 경로를 깼다.
Codex phase 리뷰는 잡지 못했다 — 리뷰 축은 staged diff의 명세 정합성이지 **본문 의미의 계약 위반**이 아니다. → **기계적 테스트**가 방어선이다.

| 항목 | 019의 결함 | D11 규칙 | 테스트(기계적) |
|---|---|---|---|
| **a. pm 중립** | `npm run typecheck`/`npm test` 하드코딩 → pnpm/yarn 사용자 파손 | 본문은 `02-plan.md`의 phase별 검증 명령과 감지된 packageManager를 따르라고만 한다 | 본문에 `npm run` 문자열 **0건** |
| **b. 숨은 승인 금지** | "seam을 확인받기 전엔 테스트 금지" → `AGENT`에 계약 없는 사람 게이트 | 승인된 `01`/`02` 범위 안 판단은 에이전트가 한다. **범위 변경 시에만** 보고(이미 계약의 보고 사유) | 본문에 승인 요구 문구 없음 + `02-plan.md`/`01-design.md` 참조 존재 |
| **c. worktree 보호** | `git bisect run` 유도 → HEAD 이동으로 REQ 상태·승인 바인딩 파괴 | 활성 REQ worktree에서 HEAD 이동 조사 **금지**. 분리 조사의 게이트 조건은 **D12가 정본**이다(무게이트 경로 존재 — 여기서 승인을 요구하지 않는다) | 본문에 `git bisect run`·`git reset`·`git checkout` **명령형 유도 0건** |
| **d. harness 분기** | 진입 흐름을 `/req`로 단정(Claude Code 전용) | Claude Code면 `/req`, 그 외엔 `AGENTS.md`의 진입 흐름 | discovery 본문이 `/req`와 `AGENTS.md`를 **함께** 언급 |

공통 규칙: **upstream이 시키는 것과 CommitGate가 허용하는 것이 다르면 CommitGate가 이긴다.** 그 차이는 각 SKILL.md의
`## 출처·라이선스` 절에 적응 내용으로 기록한다(이미 D8).

### D12 — 진단 스킬의 안전 경계 (phase-1b 보정)

**phase-1에서 실제로 발생한 위반.** `commitgate-diagnosing-bugs`가 bisect 분리를 안내하면서
*"현재 작업을 stage/commit해 안전하게 만든 뒤"* 라고 썼다. 이는 같은 스킬 `## 경계`의
*"`git commit`·`req:commit` 직접 호출 금지 · `state.json`·`responses/` 스테이징 금지"* 와 **정면 충돌**하고,
더 나쁘게는 **아직 승인되지 않은 REQ 변경을 커밋하도록 유도**해 리뷰 게이트를 우회시킨다. 활성 REQ worktree에서 특히 위험하다.

원인: R12-b 위양성을 없애려 문장을 재작성하다 **다른 축의 위반을 새로 넣었다.** D11 가드는 `git bisect|reset|checkout`과
승인 게이트만 봤고 **commit/stage 유도 축이 없었다** → 잡지 못했다.

**D12 규칙** — 멈춤 사유는 **"bisect가 필요해서"가 아니라 "경계를 어기지 않고는 못 해서"** 다.

"bisect가 필요하다"를 게이트 조건으로 삼으면 **R12-b를 D12가 다시 어긴다** — 승인된 01/02 범위 안에서 회귀를
진단하던 AGENT가 범위 변경 없이도 사람 응답을 기다려 멈춘다(design-r03 P1). 그래서 축을 갈라 정의한다.

**(1) 절대 금지 — 게이트가 아니라 그냥 금지. 사람에게 물어도 허용되지 않는다.**

- 활성 REQ worktree에서 `git bisect`·`checkout`·`reset` 등 **HEAD 이동**.
- **진단을 위해 미승인 REQ 변경을 stage·commit**. 진단은 커밋 사유가 아니다 — 승인 없는 커밋은 리뷰 게이트 우회다.
  ⚠️ phase-1 본문이 정확히 이걸 어겼다(*"현재 작업을 stage/commit해 안전하게 만든 뒤"*).

**(2) 승인된 범위 안 — 사람 게이트 없음. 에이전트가 진행한다.**

- **이미 커밋되어 있고 깨끗한 승인된 baseline**을 활성 worktree **밖의** disposable clone/copy로 복제해 bisect한다.
- 활성 worktree의 HEAD·인덱스·작업물을 **건드리지 않는다**. 승인 바인딩(D9)은 그대로다.
- **결과(원인 커밋·증상 경계)만** 원래 REQ로 가져온다. clone은 버린다.
- 이건 Phase 1 사다리의 "일회용 하네스"와 같은 급의 **진단 기법**이지 범위 변경이 아니다 → 보고 불요.

**(3) 보고 — 기존 계약의 보고 사유. 새 게이트가 아니다.**

(2)가 성립하지 않을 때만 멈춘다. 즉 **경계를 어겨야만 진단이 가능할 때**:

- 복제할 **깨끗한 승인된 baseline이 없다**(필요한 상태가 아직 커밋되지 않았다) → 미승인 작업을 커밋해야 함 = (1) 위반.
- 진단 결과가 **설계·계획·비목표를 바꿔야** 한다 → 이미 계약의 보고 사유("설계 범위 변경 또는 비목표 추가 필요").

**D12 테스트**:

- **R12-e (절대 금지 축)**: 4종 본문에 **"진단·조사를 위해 commit/stage하라"는 유도 0건**.

- 🔴 **R12-f (음성 oracle — 무게이트 경로만 존재)**: phase-1의 R12-b 가드 **재사용만으로는 부족하다.**
  현행 허용 목록이 `/범위|별도|재승인|승인 없이|승인받지|보고/`라 **`별도`라는 단어 하나로 통과**한다 →
  *"깨끗한 baseline이 있어도 승인받고 **별도** 사본에서 수행"* 같은 게이트가 살아남는다(design-r04 P1).

  **허용 문맥을 D12(3)으로 좁힌다.** `commitgate-diagnosing-bugs` 본문에서 승인·확인 요구 문구는
  **다음 문맥에서만** 허용한다:
  - **baseline 부재** — 복제할 깨끗한 승인 baseline이 없어 미승인 커밋이 필요한 경우
  - **설계·계획·비목표 변경** — 이미 계약의 보고 사유

  `별도`·`보고`처럼 **약한 신호는 허용 근거에서 뺀다**(단어 하나로 게이트를 정당화할 수 없다).

- **R12-g (양성 대조군)**: 본문이 D12(2) **무게이트 경로를 명시**한다 — "이미 커밋된 깨끗한 승인 baseline이 있으면
  **사람 승인 없이** disposable clone에서 bisect하고 결과만 회수한다"가 실제로 쓰여 있어야 한다.
  이게 없으면 R12-f는 "승인 문구가 없다"는 이유로 공허하게 통과한다(무게이트 경로 자체가 없어도 그린).

⚠️ 이 테스트들은 **본문이 경계를 어기는지**를 문자열 수준에서만 본다. 의미까지 보장하지 못한다 —
`AGENTS.md`가 계약 정본이고 스킬은 협조적 텍스트라는 D10의 한계는 그대로다. **과대 주장하지 않는다.**

### D10 — 강제력의 정직한 수준

`docs/ssot-design/04-user-roles-and-permissions.md`: "CommitGate에는 로그인 세션·토큰·RBAC 같은 애플리케이션
인증/인가가 존재하지 않는다" / "현재 권한 모델은 협조적 에이전트의 행동 분리 + 아티팩트 무결성".

→ **"스킬은 commit할 수 없다"는 강제가 아니라 SKILL.md 안의 문장이다.** 기존 포인터와 같은 급이다.
설계·README는 이 수준을 그대로 표기한다. **절대 표현("우회 불가")을 쓰지 않는다.**

## Phase별 구현

이번 REQ의 phase는 **1 → 1b → 2 → 2b** 넷이다(2차 축소 후).
phase-1 번들·본문 → phase-1b 진단 안전 경계 보정 → phase-2 설치·보안 → phase-2b 보안 oracle 보정.
구 phase-3(opt-out·gitignore·uninstall)·구 phase-4(공존·문서·smoke)는 **REQ-A2로 이관**했다 — 이번 REQ에서 구현하지 않는다.
세부는 [02-plan.md](02-plan.md).

## 변경 파일

| phase | 파일 |
|---|---|
| 1 | `skills/commitgate-{discovery,tdd,diagnosing-bugs,research}/SKILL.md`(신규) · `skills/ATTRIBUTION.md`(신규) · `package.json` · `tests/unit/package-payload.test.ts`(payload 축 + D11 본문 가드) |
| 1b | `skills/commitgate-diagnosing-bugs/SKILL.md` · `tests/unit/package-payload.test.ts` (D12 보정 — 2파일) |
| 2 | `bin/init.ts` · `tests/unit/init.test.ts` |
| 2b | `tests/unit/init.test.ts` (보안 oracle 보정 — 1파일, 구현 무변경) |

## 하위호환·안전

- **companion skills 미설치 사용자에게 회귀 0** — 신규 자산은 추가만 하고 기존 설치 축을 바꾸지 않는다(R10).
- **기존 `.claude/skills/commitgate/SKILL.md`와 공존** — `commitgate-` 접두사로 이름 충돌 없음. 타사 `tdd`·`grill-me`와도 충돌 없음.
- **`--force` 의미 변경 없음** — 기존 자산엔 그대로 적용, 신규 skills만 seed-once로 제외(D3). help에 명시.
- **트랜잭션성 미약속** — Preflight에서 막고 Apply엔 rollback이 없다(§00-5). 신규 원자성 프레임워크 없음.
- **`AGENTS.template.md` 무변경** — 긴 스킬 본문을 넣지 않는다(R8). 짧은 pointer 추가 여부는 **REQ-A2**에서 검토.
- **리뷰 로직 무변경** — `classifyReview`·P1-only 차단 정책·`req:next` kind 의미 전부 그대로(R7).
