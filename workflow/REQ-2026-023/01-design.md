# REQ-2026-023 설계 — Companion Skills: 문서·지원 매트릭스 확정

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.
> 실측은 `feat/req-2026-022-companion-coexist-smoke@b3d4221` 기준.

## 현재 상태(변경 대상)

| 사실 | 실측 근거 |
|---|---|
| README에 companion 설명이 **0건**이다 | `README.md` 구조: Quick Start · 무엇을 보장하나요? · **설치가 하는 일** · migrate · **지원 범위** · 제거하려면 |
| 한/영 구조가 대응한다 | `README.en.md`: Quick Start · What Does It Enforce? · **What Installation Adds** · Migrating · **Support scope** · Removing |
| CHANGELOG 최신은 `0.7.0` | Stage B 런타임 패키지 모델. **미공개 변경분 절이 없다** |
| CLI help는 `printHelp` | `bin/init.ts` — `--no-agent-entrypoints`가 이미 문서화돼 있다 |
| 동작은 이미 완성됐다 | REQ-020(설치·보안) · REQ-021(경고·uninstall) · REQ-022(공존·smoke) |
| Cursor CLI 검증 불가 | 이 환경에 `cursor-agent` 없음. `cursor` 3.7.21 = **에디터 런처**(`--diff`/`--merge`/`--goto`) |

## 핵심 설계 결정

### D1 — 지원 매트릭스는 **검증한 것만** 주장한다

🔴 **우리는 어느 harness에서도 skill discovery를 실측하지 않았다. 근거는 전부 벤더 1차 문서다.**

실측 범위(2026-07-17) — **정확히 이만큼이다**:
- `~/.claude/skills` **없음**, 이 레포에 `.claude/` **없음** → **harness discovery를 실측할 조건 자체가 아니었다.**
- 이 세션의 `sc:*` 스킬은 `~/.claude/commands/sc/*.md`(레거시 command 파일)에서 오는 **다른 메커니즘**이다.
- Claude Code 문서 자체가 *"세션 시작 시 없던 skills 디렉터리를 만들면 재시작이 필요하다"* 고 한다 — 지금 만들어도 이 세션은 못 본다.

⚠️ **`skills/commitgate-*/SKILL.md` 4개는 레포에 실재한다** — CommitGate **패키지 source asset**이다(REQ-020 phase-1).
**source asset의 존재는 harness discovery의 실측 증거가 아니다.** 패키지에 파일이 있다는 것과 harness가 그것을
발견한다는 것은 **다른 명제**다. (이전 초안이 "SKILL.md가 어디에도 없다"고 쓴 것은 `~/.claude`만 검색한 결과를
전역으로 일반화한 **오류**였다 — 근거의 적용 범위를 확인하지 않은 같은 실수의 세 번째 사례.)

**따라서 `✅ 검증됨`은 어디에도 쓸 수 없다.**

| harness | 표기 | 근거(벤더 1차 문서) |
|---|---|---|
| **Claude Code** | `.claude/skills/<name>/SKILL.md` native 발견 | code.claude.com/docs/en/skills |
| **Cursor (editor)** | `.claude/skills` 호환 읽기 | cursor.com/docs/skills |
| **Cursor (CLI)** | ⚠️ **버전/실행 모드별 동작 차이 가능 — 보장하지 않음** | 아래 D2 |
| **Codex** | **제품 범위 밖** — companion entrypoint를 **설치하지 않는다** | 현 워크플로에서 Codex는 read-only 샌드박스의 **Reviewer**이고 4종은 **Builder 보조**다. ⚠️ Codex의 skill discovery 경로 **전반에 대한 주장이 아니다** |

**기록(R1)** — 문서에 함께 싣는다:
- **근거 종류**: 벤더 1차 문서(구현 실측 아님)
- **확인 시점**: 2026-07-17
- **확인 환경**: win32 x64 / Node v20.19.5
- **CommitGate 팀이 실측한 것**: 없음 — 그래서 어느 harness도 "검증됨"으로 쓰지 않는다

⚠️ 이 표기가 약해 보이지만 **사실이다**. 이 REQ의 취지는 "검증한 만큼만 주장한다"이고,
"우리가 실측했다"와 "벤더가 그렇게 문서화했다"는 **다른 주장**이다. 후자를 전자로 부풀리지 않는다.
실측 재검증은 후속으로 남긴다([02-plan.md](02-plan.md) 후속).

### D2 — 🔴 Cursor CLI를 **✅/❌ 어느 쪽으로도 단정하지 않는다**

- Cursor는 editor·CLI 양쪽의 Agent Skills 지원을 **공식 발표**했다([2.4 changelog](https://cursor.com/changelog/2-4)).
- 그러나 `.claude/skills` **호환 경로**의 CLI 발견·slash 호출은 **버전·실행 모드에 따라 차이가 보고**돼 있다
  ([스태프 CLI parity 언급](https://forum.cursor.com/t/excessive-token-usage-cursor-auto-loads-too-many-skills-from-claude-skills-at-conversation-start/160677/10)).
- **우리는 검증하지 못했다** — 이 환경에 `cursor-agent`가 없다(`cursor` 3.7.21은 에디터 런처).

→ **표기: `⚠️ 버전/모드별 동작 차이 가능 — 보장하지 않음`.**

⚠️ **`❌`도 틀렸다.** 벤더가 지원을 발표했고 수정이 진행 중이므로 "동작하지 않는다"는 보편적 제품 사실이 아니다.
**`✅`도 틀렸다.** 우리가 검증하지 않았다. **모른다고 쓰는 것이 유일하게 정확하다.**

이 REQ 이전의 설계 초안이 `❌(벤더 버그)`로 단정했던 것은 **포럼 스태프 발언 한 줄을 일반화한 오류**였다.
그 전에는 벤더 문서가 IDE/CLI를 구분하지 않는 걸 놓쳐 `✅`로 단정했다. **같은 실수의 양방향**이다 —
근거의 **적용 범위**를 확인하지 않았다.

### D3 — 이중 설치를 도입하지 않는다 (R3)

`.cursor/skills`·`.agents/skills` 모두 설치하지 않는다. 이유:
- 워크어라운드 경로도 CLI에서 **동작이 불확실**하다(스태프 언급).
- 같은 내용이 두 곳에 깔리면 **drift 위험** + 설계 표면 확장.
- 벤더가 고치면 **우리 변경 없이** 동작한다 — 같은 `.claude/skills`를 읽게 되므로.

### D4 — 표현 일치를 **테스트로 고정** (R4)

🔴 **현 `printHelp`의 `--force` 설명이 사실과 다르다** — 실측:

```
--force        기존 kit 파일 덮어쓰기(기본: 스킵)
```

companion skills는 **seed-once**라 `--force`로도 **덮지 않는다**(REQ-020 D3). `workflow/.gitignore`(D12)·`AGENTS.md`·
`CLAUDE.md`도 마찬가지다. 즉 사용자가 `.claude/skills/commitgate-tdd/SKILL.md`를 고친 뒤 `commitgate init --force`를
실행하면 **파일은 보존되는데 `--help`는 덮는다고 안내한다** — 정상 경로에서 help가 거짓말한다(R4/R5 위반).

→ **help에 seed-once 예외를 명시**하고, **README와 help의 그 의미를 함께 고정하는 테스트**를 넣는다.
이것이 이 REQ가 `bin/init.ts`를 만지는 유일한 이유다(문자열만 — R8).

README 한/영·CLI help·CHANGELOG는 **사람이 한쪽만 고치기 쉽다**. 기계적으로 막는다:

🔴 **정본 설명은 README 한/영이다.** help·CHANGELOG는 정본이 아니다 — **표면을 늘리면 drift 부채가 는다**:

- **CLI help**: `--force`의 **정확한 예외만**. 예: *"덮어쓰기 가능한 kit 항목만 갱신합니다.
  AGENTS.md, CLAUDE.md, workflow/.gitignore 및 companion skills는 기존 파일을 보존합니다."*
- **CHANGELOG**: `Unreleased` 아래 **사실 요약 + README 링크만**.
  🔴 **계약 표면으로 만들지 않는다** — `--force` 보존·Cursor 호환성·승인 경계를 여기까지 반복하면 **세 번째 정본**이 생긴다.

**자동 테스트**: README 한/영(4종·`--no-agent-entrypoints`·**`--force` 보존**·`--strict`·`AGENTS.md`·
**승인 증거 경계**·**SHA**·**외부 installer 미의존**) · help(**정확한 `--force` 예외**·`--no-agent-entrypoints`) ·
**SHA 일치**(README 한/영 ↔ `ATTRIBUTION.md` 동일값) · **payload 전체 `auto-invoked` 0건** ·
CHANGELOG(`Unreleased` companion 항목 **존재만**).

🔴 **필수 변이**: help 예외 제거 · **한글 README만 "보존"→"덮어씀"**(표면 간 모순) · 영문 SHA 변조 — 각각 반드시 실패.

⚠️ **하지 않는 것**(과검증 방지):
- 🔴 **`staged diff`를 unit test oracle로 쓰지 않는다** — 커밋 뒤·CI는 index가 비어 **환경 의존적이거나 공허**해진다.
  `printHelp` 문자열 한정 여부는 **구현 전 staged-diff/리뷰 체크리스트**로만 본다.
- 🔴 **`.cursor/skills` 문자열 0건 검사를 하지 않는다** — "설치하지 않는다"는 **설명 자체를 막는다**.
  대신 **설치 코드의 companion destination이 `.claude/skills/commitgate-*` 4개뿐**임을 기존 설치 테스트로 고정한다(정확한 축).
- **CHANGELOG 단독 변이 검증 없음** — 계약 표면이 아니다.

기존 payload 테스트(`tests/unit/package-payload.test.ts`)가 이미 README를 스캔하므로 같은 축에 넣는다.

⚠️ **불변값·표면 정합 회귀 방지용이다. 모든 의미를 증명하지 않는다** — 문맥·링크·번역 정합성은 **최종 phase 리뷰**가 본다.

### D5 — 정직한 설명 항목 (R5/R6/R7)

README 한/영의 **"설치가 하는 일" / "What Installation Adds"** 절에 companion 소개를 넣고,
**"지원 범위" / "Support scope"** 절에 D1 매트릭스를 넣는다. 구조가 이미 대응하므로 자리를 새로 만들지 않는다.

담을 내용:
1. **4종과 용도** — discovery(요구 정리, 사용자 호출형) · tdd · diagnosing-bugs · research.
2. 🔴 **자동 발견 · 모델 판단 호출** — 발견은 harness가 native로 하지만, **호출 여부는 모델이 판단**한다(확률적).
   "auto-invoked"가 아니다. **"harness가 결정한다"고 쓰면 안 된다** — 주체가 틀린다.
   harness는 **발견**하고, **모델**이 그 skill을 쓸지 **판단**한다.

   🔴 **직접 호출 표현은 harness별로 제한한다.** `/commitgate-*` 예시는 **그 호출 형식이 문서화된 환경**
   (Claude Code)에만 붙인다. 다른 harness에는 *"해당 harness가 제공하는 호출 방식이 있으면 그것을 쓰고,
   없으면 `AGENTS.md`의 진입 흐름을 따른다"* 로 안내한다.
   **모든 harness에서 slash command가 된다고 암시하지 않는다.**
   `commitgate-discovery`가 **사용자 호출형**(`disable-model-invocation: true`)이라는 사실은 유지하되,
   그것이 곧 "어디서나 `/commitgate-discovery`가 뜬다"는 뜻은 **아니다**.
3. **`--no-agent-entrypoints`** — `.claude/` 계층 전체를 건너뛴다(companion 포함).
4. 🔴 **seed-once** — 고친 skill은 `--force`로도 안 덮는다. 스킬은 고치라고 만든 자산이다.
   **README 한/영과 CLI help 양쪽**에 이 예외를 쓴다 — 현 help의 `--force` 설명("기존 kit 파일 덮어쓰기")은
   companion에 대해 **거짓**이다(D4).
5. **gitignore WARN/`--strict`** — 팀원 clone에 전달 못 되면 경고. strict면 설치 전 중단.
6. 🔴 **`AGENTS.md`가 계약 정본** — 스킬은 **방법론**이지 계약이 아니다. 스킬 없이도 워크플로는 동일하게 동작한다.
7. 🔴 **권한 경계(R6)** — companion skills도, 외부 Matt skills 실행 결과도 **CommitGate·Codex 승인 증거가 아니다**.
   리뷰 실행·승인 판정·상태 전이·커밋은 **CommitGate만** 담당한다. 다음 행동은 `req:next`가 정본이다.
8. **출처(R7)** — 정확히 이 취지로 쓴다:
   - *"Matt Pocock의 MIT 공개 skills를 기준 SHA `d574778f94cf620fcc8ce741584093bc650a61d3`에서 적응해
     **패키지 payload로 포함**한다."*
   - *"**외부 skill installer를 실행하거나 런타임 의존하지 않는다.**"*

   ⚠️ **`npx skills`를 Matt Pocock의 공식 installer처럼 암시하지 않는다.** 그 npm 패키지는 `vercel-labs/skills`이고
   Matt의 것이 아니다. 특정 installer 이름을 예시로 들면 그 오해를 만든다 — **"외부 skill installer"** 로 일반화해 쓴다.
9. **권장 흐름** — `commitgate-discovery`로 요구를 정리 → Claude Code면 `/req`, 그 외에는 `AGENTS.md`의 진입 흐름 →
   `req:new` → `req:next` 반복.

### D6 — 강제력의 정직한 수준

- 스킬은 **협조적 텍스트**다. "스킬이 커밋을 막는다"고 쓰지 않는다 — 막는 건 CommitGate의 게이트다.
- 지원 매트릭스는 **관찰**이지 보장이 아니다. 벤더가 바꾸면 우리 문서가 낡는다 — 검증 시점을 함께 적는다.
- **절대 표현을 쓰지 않는다.**

## Phase별 구현

**1개 phase.** 문서·help 문자열만 바꾸므로 쪼갤 축이 없다. 파일 5개(README×2·CHANGELOG·`bin/init.ts` help·테스트).

1. `phase-1-docs-support-matrix` — D1~D6

세부는 [02-plan.md](02-plan.md).

## 변경 파일

| phase | 파일 |
|---|---|
| 1 | `README.md` · `README.en.md` · `CHANGELOG.md` · `bin/init.ts`(`printHelp` 문자열만) · `tests/unit/package-payload.test.ts` |

⚠️ `bin/init.ts`는 **help 문자열만** 바꾼다. 설치·경고·uninstall 로직 무변경(R8).

## 하위호환·안전

- **제품 동작 무변경** — 문서·help 문자열만. 기존 1015 테스트·smoke가 회귀 방어선이다.
- **이중 설치 없음** — 코드 무변경이므로 설치 경로도 그대로다.
- **publish 없음** — 🔴 A2-3 완료 후에도 바로 publish하지 않는다(PM 지시).
  **PR을 만들지 않는다**(1인 개발 흐름). REQ-020~022는 이 REQ를 기다리지 않고 먼저 `main`에 `--ff-only` 병합하고,
  REQ-023은 완료 후 최신 main에 순차 병합한다. **merge·push·publish는 각각 별도 통제점**이다 — [02-plan.md](02-plan.md) §배송 정책.
- **검증 시점 명시** — 매트릭스는 2026-07-17 기준 관찰이다. 벤더 변경 시 낡을 수 있음을 문서가 스스로 밝힌다.
