# REQ-2026-020 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고.
> 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님).

각 phase 공통 절차: 그 phase의 인수 기준만 구현 → 관련 unit test → `npm run typecheck` → `npm test` →
staged 범위를 해당 phase 파일로 제한 → `git diff --cached --check`/`--stat` 확인 → `req:next`가 지시하는 리뷰.
**P1만 수정한다. observation은 backlog에 적고 같은 phase로 끌어들이지 않는다.**

---

## Phase 1 — 스킬 본문·번들·payload (`phase-1-skill-content`)

범위: `skills/` 4종 SKILL.md + `ATTRIBUTION.md` 신규, `package.json` `files[]` += `"skills"`.
설치기(`bin/init.ts`)는 **건드리지 않는다** — 이 phase는 "본문이 옳고, 패키지에 담기고, tarball에 나온다"까지.

🔴 **이 phase가 skill-content phase다**(PM 지시). 019에서 본문이 계약을 어긴 4건(R12/D11)을 **처음부터 옳게 작성하고
테스트로 고정**한다. 잘못 쓴 뒤 고치지 않는다.

원문 대조 기준: `github.com/mattpocock/skills` @ `d574778f94cf620fcc8ce741584093bc650a61d3` (v1.1.0).
로컬 pin 스냅샷 존재. 4종은 upstream `productivity/grilling`·`engineering/{tdd,diagnosing-bugs,research}`를 적응한다.

**테스트 oracle** (`tests/unit/package-payload.test.ts`):
- Red: `npm pack --dry-run` 파일 목록에 `skills/commitgate-discovery/SKILL.md` 등 4종 + `skills/ATTRIBUTION.md`가 **없어서** 실패.
- Green: `files[]`에 `"skills"` 추가 → 목록에 나타남.
- 🔴 **라이선스 필수 문구 검증(설치 대상 기준)** — 4종 SKILL.md **각각**에 다음이 **모두** 존재:
  - `Copyright (c) 2026 Matt Pocock`
  - MIT permission notice **전문** — 최소한 `Permission is hereby granted, free of charge` ·
    `The above copyright notice and this permission notice shall be included in all` ·
    `copies or substantial portions of the Software.` · `THE SOFTWARE IS PROVIDED "AS IS"` ·
    `OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE` 를 포함(축약·의역 불가).
  - baseline SHA `d574778f94cf620fcc8ce741584093bc650a61d3`
  검증은 upstream LICENSE 원문과 **문자열 대조**로 한다(손으로 재작성한 변형본을 통과시키지 않는다).
  이 oracle이 R9와 MIT §2 준수의 회귀 고정점이다.
- frontmatter `name`이 부모 디렉터리명과 일치 · 소문자+하이픈 · ≤64자, `description` 비어있지 않음 · ≤1024자.
- 파일명 dot-prefix 없음(npm strip 회귀).
- `commitgate-discovery`만 `disable-model-invocation: true`.
- **postinstall 훅 부재**(R2 회귀 고정).

🔴 **D11 본문 가드 (R12) — 019가 전부 어긴 지점. 이 테스트가 없으면 리뷰는 못 잡는다.**
- **R12-a**: 4종 본문에 `npm run` 문자열 **0건**. (pnpm/yarn 사용자 파손 방지 — 대신 `02-plan.md`·감지된 packageManager 참조)
- **R12-b**: 본문이 `AGENT` 단계에 사람 승인을 요구하지 않는다 — "확인받"·"승인받"류 요구 문구 0건.
  대신 `02-plan.md`/`01-design.md` 참조가 존재하고, "범위 변경 시 보고"만 남는다.
- **R12-c**: 본문에 `git bisect run`·`git reset`·`git checkout` **명령형 유도 0건**.
  `commitgate-diagnosing-bugs`는 활성 worktree에서의 HEAD 이동 **금지** 문구를 포함해야 한다(부재가 아니라 명시적 금지).
- **R12-d**: `commitgate-discovery` 본문이 `/req`와 `AGENTS.md`를 **함께** 언급한다(harness 분기 — 단정 금지).
- 4종 모두 `req:next` 정본 문구와 `req:commit` 금지 경계를 담는다.

🔴 **discovery의 pre-`req:new` 유효성 (D8 예외 — 공통 전제를 쓰면 정상 진입이 막힌다)**
- `commitgate-discovery` 본문이 **`req:next`가 `AGENT`일 때만 유효하다는 전제를 담지 않는다** —
  AGENT형 3종에만 있는 문구가 discovery에는 **없어야** 한다(있으면 fresh 프로젝트에서 진입 불가).
- discovery 본문이 **`req:new` 전 단계**임과 REQ Brief가 산출물임을 명시한다.
- discovery 본문이 "이미 REQ가 있고 `req:next`가 `AGENT`면 이 스킬이 아니다"는 **역방향 안내**를 담는다.
- 대조군: AGENT형 3종은 `req:next`=AGENT 전제를 **담는다**(이 테스트가 공회전하지 않음을 보장).

Exit: typecheck0 · 단위 그린 · Codex phase 리뷰 승인.

---

## Phase 1b — 진단 스킬 안전 경계 보정 (`phase-1b-diagnosis-safety`)

범위: `commitgate-diagnosing-bugs` 본문의 D12 위반 수정 + R12-e 가드. **2파일.** 설치기는 건드리지 않는다.

**왜 별도 phase인가**: phase-1이 이미 승인·커밋됐고(`832c83b`), 그 안에 정상 경로의 안전 경계 충돌이 남아 있다.
phase-2(설치기)에 섞으면 리뷰 면적이 넓어지고 성격이 다른 변경이 뒤엉킨다.

**결함**(phase-1 본문 36행): *"현재 작업을 stage/commit해 안전하게 만든 뒤 별도 worktree나 사본에서 수행"*
→ 같은 스킬 `## 경계`의 커밋·스테이징 금지와 충돌하고, **미승인 REQ 변경을 커밋하도록 유도**해 리뷰 게이트를 우회시킨다.

**테스트 oracle**:
- **Red**: 현재 본문에 대해 R12-e 가드가 실패한다(36행이 잡힌다).
- **Green(R12-e)**: 4종 본문에 **진단·조사 목적의 commit/stage 유도 0건**.
  검사 축: `stage`·`commit` 동사가 **명령형/권유형**으로 쓰인 줄 중, 금지 문맥(`금지`·`하지 않는다`·`말라`)이 아닌 것.
  ⚠️ phase-1의 D11 가드는 `git bisect|reset|checkout`과 승인 게이트만 봤다 — **commit/stage 유도 축이 없어서 놓쳤다.** 그 구멍을 메운다.
- **대조군**: `commitgate-tdd`의 정상 stage 안내(phase 산출물을 `git add`)는 **잡히지 않아야** 한다 —
  그건 `req:next`=AGENT의 정상 경로다. 가드가 그것까지 잡으면 과잉이다.
- D12 3축이 본문에 모두 존재:
  - **(1) 절대 금지**: 활성 worktree HEAD 이동 · **진단용 미승인 commit/stage**(사람이 승인해도 불가).
  - **(2) 범위 안·게이트 없음**: 이미 커밋된 깨끗한 승인 baseline을 활성 worktree **밖** disposable clone으로 복제해
    bisect하고 결과만 회수 — **사람 승인 없이 진행**함이 본문에 명시된다.
  - **(3) 보고**: (2)가 불가능할 때만(깨끗한 baseline 부재 → 미승인 커밋 필요, 또는 설계·비목표 변경 필요) = 기존 보고 사유.
- 🔴 **R12-f 음성 oracle(design-r04 P1) — 가드 재사용만으로는 부족하다.**
  phase-1의 R12-b 허용 목록이 `/범위|별도|재승인|승인 없이|승인받지|보고/`라 **`별도` 한 단어로 통과**한다 →
  *"깨끗한 baseline이 있어도 승인받고 별도 사본에서 수행"* 이 살아남는다. **허용 문맥을 D12(3)으로 좁힌다**:
  - 허용: **baseline 부재**(미승인 커밋 필요) · **설계·계획·비목표 변경**(기존 보고 사유)
  - 제거: `별도`·`보고` 같은 약한 신호 — 단어 하나가 게이트를 정당화하지 못한다
  - Red 확인: "깨끗한 baseline이 있어도 승인받고 별도 사본에서" 문장을 넣으면 **반드시 실패**해야 한다(fixture로 검증).
- 🔴 **R12-g 양성 대조군**: 본문에 D12(2) **무게이트 경로가 실제로 존재**한다 — "이미 커밋된 깨끗한 승인 baseline이면
  **사람 승인 없이** disposable clone에서 bisect하고 결과만 회수"가 쓰여 있어야 한다.
  ⚠️ 이게 없으면 R12-f가 "승인 문구가 없다"는 이유로 **공허하게 통과**한다(무게이트 경로가 아예 없어도 그린).
- phase-1의 D11 가드 4종(R12-a~d)은 계속 그린(회귀 없음).

Exit: typecheck0 · 단위 그린 · Codex phase 리뷰 승인 · HIGH 확인 후 별도 커밋.

---

## Phase 2 — 설치·보안 (`phase-2-init-install`)

범위: `bin/init.ts`에 seed-once 설치(D3) + confinement/symlink preflight(D4).

**테스트 oracle** (`tests/unit/init.test.ts`, `tmpTarget()` 재사용):
- Red: fresh init 후 `.claude/skills/commitgate-tdd/SKILL.md`가 **없어서** 실패 → Green: 4종 정확 경로 생성.
- 멱등: 같은 init 재실행 → 내용 불변, `copied`에 재등장 안 함.
- **seed-once**: 사용자가 SKILL.md를 수정 → `--force`로 재-init → **내용 보존**(D3의 핵심 인수 기준).
- 🔴 **필수 — 상위 symlink 탈출 방지(D4-1)**: `.claude/skills/commitgate-tdd`를 **대상 밖 빈 디렉터리**를 가리키는
  symlink/junction으로 만들고 init → **throw + 쓰기 0회**. 검증은 **대상 tree와 외부 디렉터리 양쪽** snapshot 전후 동일로 한다
  (대상만 보면 밖에 쓴 파일을 못 잡는다).
- 🔴 **필수 — leaf dangling symlink 탈출 방지(D4-3)**: `.claude/skills/commitgate-tdd/SKILL.md`를 **대상 밖의 아직 없는 파일**을
  가리키는 dangling symlink로 만들고 init → **throw + 쓰기 0회**(양쪽 snapshot 무변화).
  ⚠️ 이 fixture는 `existsSync`가 **false**를 주므로, 구현이 `existsSync`로 부재 판정하면 **밖에 파일이 생기며 실패**한다 —
  그것이 이 테스트의 존재 이유다. `lstatSync` + ENOENT-only 구현에서만 통과한다.
- leaf가 **정상 파일**이면 seed-once skip(보존), leaf가 **디렉터리**면 preflight 거부.
- **symlink 거부**: `.claude/skills`를 symlink로 만들고 init → throw + **쓰기 0회**.
- `.claude/skills`가 **파일**인 경우 → 마찬가지로 preflight 거부.
- 4개 dest **각각**이 confinement 검사를 받는지: `commitgate-research`만 symlink인 fixture도 거부되는지 확인
  (루트만 검사하는 구현이면 이 케이스가 통과해 버린다 — 구현 회귀 탐지점).
- `--dry-run`: 파일 미생성(부작용 0).
- 기존 회귀: `.claude/skills/commitgate/SKILL.md`(기존 자산) 여전히 설치됨.

Exit: typecheck0 · 단위 그린 · Codex phase 리뷰 승인.

---

## Phase 2b — 보안 oracle 보정 (`phase-2b-security-oracle`)

범위: **`tests/unit/init.test.ts` 1파일.** 구현(`bin/init.ts`) **무변경** — 방향 전환이 아니라 **증명 보완**이다.
`planCompanionSkills()`는 이미 4개 최종 dest 각각을 검사하고 leaf에 `lstat`/ENOENT 정책을 적용한다.

**결함**: phase-2의 보안 fixture 중 둘이 **대상만** snapshot해 탈출 탐지기로서 **공허**하다 —
대상 안의 symlink는 외부로 써져도 변하지 않는다.
- `commitgate-research만 symlink여도 거부한다` — `snapshot(dir)`만.
- `--dry-run도 confinement/leaf preflight를 수행해 symlink면 실패한다` — `snapshot(dir)`만.

실측(root-only confinement 변이): `runInit`이 **throw 없이 완료되고 외부에 `SKILL.md`를 생성**한다.
현재는 `toThrow`가 회귀를 잡아내지만, **다른 이유로 throw하면서 외부에 쓰는 경우**는 통과시킨다.

또한 신규 `symlinkSync` 5곳이 기존 `symlinkUnsupported()` 관례를 쓰지 않아, 권한 없는 Windows 러너에서
**설치기 결함이 아니라 픽스처 준비 실패로** 빨간불이 난다.

**테스트 oracle**:
- `commitgate-research` 외부 symlink fixture에 **외부 snapshot 전후 비교** 추가.
- `--dry-run` 외부 symlink fixture에 **외부 snapshot 전후 비교** 추가 → "쓰기 0회"가 완전히 증명된다.
- 신규 `symlinkSync` **전부**에 `symlinkUnsupported()` 적용 — 권한 미지원이면 **그 사유로만** skip하고, 다른 오류는 throw.
- 🔴 **변이 검증**: dest별 confinement를 root-only로 되돌리면 research 테스트가 **외부 파일 생성으로 실패**해야 한다
  (`toThrow`뿐 아니라 외부 snapshot 단언에서도). 이게 공허하지 않음의 증명이다.

Exit: typecheck0 · 단위 그린 · Codex phase 리뷰 승인 · HIGH 확인 후 별도 커밋. **phase-3은 그 뒤에만 착수.**

---

## 완료

- 게이트 해당분(unit·typecheck) · 사용자 main 머지(별도 승인).
  ⚠️ **smoke·문서·공존 fixture는 REQ-A2**(2차 축소). 이번 REQ의 완료 상태는 "패키지에 실리고 안전하게 설치된다"까지.
- HIGH 티켓: 각 phase의 `req:commit --run` **직전** 통제점에서 사용자 확인(`state.user_commit_confirmed`).
  리뷰 전 선승인은 커밋 실행 승인이 아니다.

## 후속 backlog (이번 범위 밖)

### 🔴 REQ-C (별도 티켓 — 출시본 v0.7.0의 기존 dangling symlink 구멍)

**이 REQ가 만든 결함이 아니다. 이미 출시돼 있다.** REQ-019 설계 리뷰 r03에서 파생 발견, PM이 별도 REQ로 분리 결정.

- 결함: `add()`(`bin/init.ts:617` `existsSync(destAbs) && !force`)와 `applyCopies`(bare `mkdirSync`+`copyFileSync`)에
  lstat 가드가 없다. `assertEntrypointPathsUsable`도 `existsSync(sub) && …` 형태라 **dangling symlink면 검사가 건너뛰어진다**.
  `assertConfinedDest`는 호출 1곳(`workflow/.gitignore`)뿐이고 그마저 leaf 미검사.
- 영향 자산: `.claude/skills/commitgate/SKILL.md` · `.claude/commands/req.md` · `.cursor/rules/commitgate.mdc` ·
  `CLAUDE.md` · `AGENTS.commitgate.md` · `workflow/{machine.schema.json,req.config.schema.json,review-persona.md}` ·
  `workflow/.gitignore`(leaf).
- 위협 모델: 악의적/오염된 repo를 clone한 뒤 `commitgate init` 실행 → 대상 프로젝트 **밖**에 파일 생성.
- 실측 증거(Windows, Node v20):
  ```
  existsSync(dangling symlink)     = false
  lstatSync(...).isSymbolicLink()  = true
  copyFileSync 후 외부 파일 생성    = true "PAYLOAD"
  ```
- 수정 방향(REQ-C에서 설계): `add()`의 부재 판정을 `lstatSync` + ENOENT-only로 전환, `applyCopies` 전 각 dest에
  `assertConfinedDest` + leaf lstat, `assertEntrypointPathsUsable`을 `lstatSync` 기반으로.
- ⚠️ 하위호환 주의: 정상 symlink를 의도적으로 쓰던 사용자가 있을 수 있다(모노레포 공유 등) → REQ-C에서 판단.

### 🔴 REQ-D (별도 티켓 — finalize 경로의 사람 확인을 도구가 강제)

**이번 REQ의 phase-2에 섞지 않는다**(PM 지시).

- 현상: `req:commit --finalize-design`은 커밋을 2개 만들면서도 `userConfirmGate`를 호출하지 않고
  `user_commit_confirmed: null`을 쓴다. `--finalize`도 같은 축이다. 에이전트 규율에만 의존한다.
- 실증: 이 REQ에서 Claude가 `--finalize-design`을 **사전 승인 없이** 실행했다(PM 사후 인정). 기록은 진실했으나 절차 이탈.
  **메모리 수정만으로는 해결로 볼 수 없다** — 규율은 강제가 아니다.
- 방향: 모든 finalize 경로에 사람 확인을 요구하는 것이 제품 정책이라면 **CLI·상태 모델로 강제**해야 한다.
  관련: `user_commit_confirmed`를 쓰는 CLI가 없어 **에이전트가 손으로 적는다** → 손으로 적는 감사 필드는
  본질적으로 위조 가능하고, REQ-2026-019가 그 실패 모드를 실증했다(타임스탬프 날조 → 폐기).
  도구가 확인 시점에 직접 시각을 찍는 설계를 함께 검토한다.

### 🔴 REQ-A2 (2차 축소로 분리 — PM 결정, 설계 리뷰 11회 도달)

구 phase-3(opt-out·gitignore·uninstall)·구 phase-4(공존·문서·smoke)를 **별도 REQ로 이관**한다.
설계 문서 1개가 6개 phase를 덮어, 앞 phase를 승인받을 때마다 뒤 phase까지 전체 재검수되며 무관한 지적이 계속 나왔다
(r09·r10이 실제로 phase-3 oracle 지적). CommitGate의 알려진 결함(Stage B 중단 사유)이 재현된 것이다.

**이관 범위(설계는 보존 — 재사용):**
- companion gitignore WARN/`--strict` 축(D6) + **userDiffers 경고 원인 격리 fixture**(design-r09/r10에서 벼려짐).
- uninstall `toolEntries`에 companion 4종(D7). read-only 유지, `differs`는 "수정됨 또는 다른 버전이 깐 것".
- 공존 fixture(타사 skills 선/후설치) · Stage A migrate 미추가 · packed-tarball smoke.
- README(ko/en)·CLI help·CHANGELOG. 🔴 **그때 Cursor CLI 지원 표기를 검증한 버전·모드와 함께 재승인**해야 한다(D1).
- phase-2 리뷰 observation: gitignore된 companion이 stage 목록에서 빠지는 비계약 자산 정책 명시·검증.

### 기타

- **[design-r07 observation]** Cursor CLI의 `.claude/skills` 동작은 벤더 게시물에서 버전·경로별로 상충한다 →
  **phase-4 문서화 직전에 지원 매트릭스를 재검증**하고 **확인한 CLI 버전을 함께 기록**한다. (비차단 관찰 — phase-4에서 처리)
- REQ-B: `00/01/02` 템플릿 섹션 + persona 리뷰 관점 2종(명세 충족·구현 품질). P1-only 차단 정책 무변경.
- `.agents/skills/` 이중 설치(Codex를 Builder로 쓰는 사용자).
- 자산↔런타임 버전 skew 탐지(REQ-014가 수용한 위험과 동일 축).
- upstream 갱신 추적(현재 수동 pin).
