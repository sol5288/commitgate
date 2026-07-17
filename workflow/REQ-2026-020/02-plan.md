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

## Phase 3 — opt-out·uninstall (`phase-3-optout-uninstall`)

범위: `--no-agent-entrypoints`/`--no-companion-skills`(D5), gitignore WARN/strict(D6), uninstall `toolEntries`(D7).

**테스트 oracle**:
- `--no-agent-entrypoints` → skills 4종 **미생성**(+ 기존 entrypoint도 미생성 = 기존 동작).
- `--no-companion-skills` → skills만 미생성, `.claude/skills/commitgate/SKILL.md`·`.cursor/rules/commitgate.mdc`는 **생성됨**.
- 두 플래그가 `printHelp` 출력에 등장(help↔구현 일치).
- `.claude/`를 gitignore한 fixture → 기본 init이 **WARN 출력**(설치는 됨), `--strict` → **설치 전 throw + 쓰기 0회**.
- `--no-companion-skills` + gitignore → **경고 없음**.
- uninstall: skills 4종이 계획 출력에 등장 · **대상 tree 전후 snapshot 동일**(읽기 전용) · `child_process` 미import 구조 테스트 유지.

Exit: typecheck0 · 단위 그린 · Codex phase 리뷰 승인.

---

## Phase 4 — 공존·문서·smoke (`phase-4-coexist-docs-smoke`)

범위: 공존 fixture 테스트, README(ko/en)·CLI help·CHANGELOG, packed-tarball smoke.

**테스트 oracle**:
- **공존 A(타사 선설치)**: `.claude/skills/tdd/SKILL.md`(타사)를 먼저 깔고 init → 타사 파일 **바이트 불변**, `commitgate-tdd`는 별도 생성.
- **공존 B(CommitGate 선설치)**: init 후 타사 skill 추가 → 재-init → 양쪽 보존.
- 두 fixture 모두: `AGENTS.md` 계약 정본 유지(`<!-- commitgate:contract -->` 마커) · `req:next --json` 의미 불변 · `req:doctor` 정상.
- **Stage A migration이 companion skills를 조용히 추가하지 않음** — `migrate --apply` 후 `.claude/skills/commitgate-*` **부재**.
- **packed-tarball smoke**(`scripts/smoke.mjs`): fresh git/npm fixture에 `npm i -D <tgz>` → `commitgate init` →
  4종 존재 · `scripts/req/**` 부재 · `tsx`/`ajv`/`cross-spawn` 직접 주입 부재 · `req:*`가 package bin 지시(Stage B 조건 유지).
  npm 캐시는 일회용으로 격리한다.
- README(ko/en)에 "선별된 Companion Skills" 절: 정확한 4종 목록 · **외부 installer 미실행** · 설치/비설치 옵션 ·
  Matt skills와 공존 시 책임 경계 · 권장 흐름(`commitgate-discovery → /req → req:new → req:next 반복`) ·
  **외부 skill 결과는 보조 자료이며 Codex 승인 증거가 아님** · **"자동 발견 · 모델 판단 호출"**(auto-invoked 금지).

Exit: typecheck0 · 단위 그린 · smoke 그린 · Codex phase 리뷰 승인.

---

## 완료

- 게이트 해당분(unit·typecheck) · smoke · 사용자 main 머지(별도 승인).
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

### 기타

- REQ-B: `00/01/02` 템플릿 섹션 + persona 리뷰 관점 2종(명세 충족·구현 품질). P1-only 차단 정책 무변경.
- `.agents/skills/` 이중 설치(Codex를 Builder로 쓰는 사용자).
- 자산↔런타임 버전 skew 탐지(REQ-014가 수용한 위험과 동일 축).
- upstream 갱신 추적(현재 수동 pin).
