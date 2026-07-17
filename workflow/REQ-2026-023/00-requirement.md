# REQ-2026-023 요구사항 — Companion Skills: 문서·지원 매트릭스 확정 (REQ-A2-3)

## 1. 배경

REQ-020(번들·설치·보안) → REQ-021(gitignore 경고·uninstall) → REQ-022(공존·migrate 무추가·smoke)로
companion skills의 **동작과 수명주기 계약**이 완성됐다. 남은 것은 **사용자에게 정직하게 설명하는 일**이다.

지금 사용자는 `commitgate init`을 돌리면 `.claude/skills/commitgate-*` 4종이 깔리는데 **README에 아무 설명이 없다**.
무엇이 깔렸는지, 왜 깔렸는지, 어디서 왔는지, 언제 동작하는지 알 수 없다.

**PM 결정: 이 REQ가 A2 시리즈의 마지막이다.** 🔴 **PR을 만들지 않는다** — 1인 개발 흐름이다.
**REQ-020~022(`b3d4221` 계보)는 이 REQ를 기다리지 않고** 사용자 승인 후 `main`에 먼저 병합한다
(문서 작업 때문에 이미 완료된 코드 안전성 변경을 묶어 두지 않는다). REQ-023은 완료 후 **최신 main에 순차 병합**한다.
**바로 publish하지 않는다** — 자세한 정책은 [02-plan.md](02-plan.md) §배송 정책.

## 2. 목표(What)

README(한/영)·CLI help·CHANGELOG가 **실제 구현과 일치**하고, 지원 범위를 **검증한 만큼만** 주장한다.

## 3. 요구(정규화)

- **R1 근거 기록**: 지원 매트릭스는 **근거의 종류**(벤더 1차 문서 / 실측)·**확인 시점**·**확인 환경**을 기록한다.
  🔴 **실측하지 않은 것을 '검증됨'으로 표기하지 않는다.** 우리가 실측한 harness는 **없다**(§5) — 근거는 벤더 문서다. (Done #1)
- **R2 미검증은 "보장하지 않음"**: 🔴 **Cursor CLI를 ✅/❌ 어느 쪽으로도 단정하지 않는다.**
  Cursor는 editor·CLI 양쪽의 Agent Skills 지원을 공식 발표했으나, `.claude/skills` 호환 경로의 CLI 발견·slash 호출은
  **버전·실행 모드에 따라 차이가 보고**돼 있다. → **"버전/모드별 동작 차이 가능, 보장하지 않음"**으로 표기한다. (Done #2)
- **R3 이중 설치 미도입**: `.cursor/skills` 이중 설치를 **하지 않는다**. 워크어라운드 경로도 CLI에서 동작이 불확실하고,
  drift 위험과 설계 표면을 늘린다. (constraints)
- **R4 표현 일치**: **정본 설명은 README 한/영**이다. CLI help는 **`--force`의 정확한 예외만**,
  CHANGELOG는 **`Unreleased` 사실 요약 + 링크만** 담는다.
  🔴 **CHANGELOG를 계약 표면으로 만들지 않는다** — 반복하면 세 번째 정본이 생겨 drift 부채가 는다.
  README 한/영과 help의 `--force` 의미는 **한쪽만 고치면 실패**하도록 고정한다. (Done #3)
- **R5 정직한 설명**: 다음을 정확히 설명한다. (Done #4)
  - 선별된 **4종** companion skills와 각각의 용도
  - **`--no-agent-entrypoints`**로 설치를 건너뛸 수 있음
  - 🔴 **seed-once** — 사용자가 고친 skill은 `--force`로도 덮지 않음. **CLI help에도 이 예외를 명시**한다 —
    현 `--force` 설명("기존 kit 파일 덮어쓰기")은 companion에 대해 **거짓**이라 정상 경로에서 help가 사용자를 오도한다
  - **gitignore WARN/`--strict`** — 팀원 clone에 전달되지 못하면 경고, strict면 설치 전 중단
  - **`AGENTS.md`가 계약 정본** — 스킬은 방법론이지 계약이 아님
  - 🔴 **"자동 발견 · 모델 판단 호출"** — **"auto-invoked"라고 쓰지 않는다**. 발견은 native지만 호출은 모델 판단(확률적)이다
- **R6 권한 경계 명시**: 🔴 **외부 Matt skills 실행 결과는 CommitGate·Codex 승인 증거가 아니다.**
  companion skills 자체도 승인 권한이 없다 — 리뷰 실행·승인 판정·상태 전이·커밋은 CommitGate만 담당한다. (Done #5)
- **R7 출처**: *"Matt Pocock의 MIT 공개 skills를 기준 SHA `d574778f94cf620fcc8ce741584093bc650a61d3`에서 적응해
  **패키지 payload로 포함**한다"* 와 *"**외부 skill installer를 실행하거나 런타임 의존하지 않는다**"* 를 밝힌다.
  ⚠️ 특정 installer 이름(`npx skills` 등)을 예시로 들지 않는다 — 그 패키지는 `vercel-labs/skills`이고 **Matt의 공식 installer가 아니다**. (Done #6)
- **R8 제품 코드 무변경**: 이 REQ는 **문서와 help 문자열만** 바꾼다. 설치·경고·uninstall 동작을 바꾸지 않는다. (constraints)

## 4. 비목표 — 이번 범위에서 구현하지 않음

- **publish·tag·release.** 🔴 A2-3 완료 후에도 **바로 publish하지 않는다**(PM 지시).
  REQ-023까지 main 병합 + **main 기준 fresh tgz smoke** 성공 후 **별도 사용자 승인**으로만 검토한다.
  **main 병합·원격 push·publish는 각각 별도 통제점**이며 묶어서 실행하지 않는다.
- `.cursor/skills`·`.agents/skills` 이중 설치.
- Cursor CLI 동작을 **바꾸는** 어떤 우회. 벤더가 고치면 우리 변경 없이 동작한다(같은 경로를 읽으므로).
- 제품 코드 변경(설치·경고·uninstall 로직).
- **REQ-C**(출시본 dangling symlink) · **REQ-D**(finalize 강제) · **REQ-B**(문서 템플릿·persona).

## 5. 검증 실측 (2026-07-17)

🔴 **CommitGate 팀은 어느 harness에서도 skill discovery를 실측하지 않았다. 근거는 전부 벤더 1차 문서다.**

실측 범위(정확히):
- `~/.claude/skills` **없음**, 이 레포에 `.claude/` **없음** → **harness discovery를 실측할 조건이 아니었다**.
- 이 세션의 `sc:*` 스킬은 `~/.claude/commands/sc/*.md`(레거시 command)에서 오는 **다른 메커니즘**이다.
- Cursor Agent CLI(`cursor-agent`) **미설치** — `cursor` 3.7.21은 에디터 런처(`--diff`/`--merge`/`--goto`)다.

⚠️ **`skills/commitgate-*/SKILL.md` 4개는 레포에 실재한다** — CommitGate **패키지 source asset**이다(REQ-020 phase-1).
그러나 **source asset의 존재는 harness discovery의 실측 증거가 아니다.** 패키지에 파일이 있다는 것과
Claude Code·Cursor가 그것을 발견한다는 것은 **다른 명제**다.

| harness | 근거(벤더 1차 문서) |
|---|---|
| **Claude Code** | `.claude/skills/<name>/SKILL.md` native 발견 — code.claude.com/docs/en/skills |
| **Cursor editor** | `.claude/skills` 호환 읽기 — cursor.com/docs/skills |
| **Cursor CLI** | ⚠️ **보장하지 않음** — 지원 발표됨(2.4 changelog)이나 `.claude/skills` 호환 경로의 CLI 발견·slash 호출은 **버전·실행 모드별 차이 보고**. 우리는 검증하지 못했다(`cursor-agent` 미설치) |
| **Codex** | **제품 범위 밖** — CommitGate는 Codex용 companion entrypoint를 **설치하지 않는다**. 현 워크플로에서 Codex는 **Reviewer**이고 4종은 **Builder 보조**다. ⚠️ Codex의 skill discovery 경로 전반에 대한 주장이 **아니다** |

**확인 환경**: win32 x64 / Node v20.19.5 / 2026-07-17.

⚠️ **"우리가 실측했다"와 "벤더가 그렇게 문서화했다"는 다른 주장이다.** 후자를 전자로 부풀리지 않는다.
따라서 `✅ 검증됨`은 어디에도 쓰지 않는다.

## 6. 대표 예시·실패 경계

**정상**: Claude Code 사용자가 init → 4종 설치 → `/commitgate-discovery` 또는 모델이 상황에 맞게 호출.
**경계**: Cursor CLI 사용자 → 설치는 되지만 **발견은 보장되지 않는다**. 핵심 워크플로는 영향 없다 — 스킬은 품질 보조 레이어다.
**오해 방지**: 스킬이 "항상 뜬다"고 기대하면 안 된다. 호출은 모델 판단이다.

## 7. 용어

- **auto-discovered, model-invoked**: harness가 스킬을 자동 발견하나 호출은 모델이 판단한다. **"auto-invoked"가 아니다.**
- **보장하지 않음**: 동작할 수 있으나 우리가 검증하지 않았고 버전·모드에 따라 다르다.

## 8. 인수 기준

1. 지원 매트릭스에 **근거 종류(벤더 1차 문서)·확인 시점·확인 환경**이 기록되고, `✅ 검증됨` 표기가 **0건**이며,
   Cursor CLI는 "보장하지 않음"으로 표기된다. (R1/R2)
2. Cursor CLI가 ✅/❌로 단정되지 **않는다**. (R2)
3. `.cursor/skills` 이중 설치가 **없다**(코드·문서 양쪽). (R3)
4. README 한/영·CLI help·CHANGELOG 표현이 일치한다 — **테스트로 고정**. (R4)
5. 4종·`--no-agent-entrypoints`·seed-once/`--force`·gitignore WARN/`--strict`·`AGENTS.md` 정본·
   "자동 발견·모델 판단 호출"이 설명된다. **"auto-invoked" 문자열 0건** — 테스트로 고정. (R5)
9. 🔴 **CLI help에 `--force`의 정확한 예외가 명시**되고(AGENTS.md·CLAUDE.md·workflow/.gitignore·companion 보존),
   README 한/영의 같은 의미와 **함께 고정**된다 — 한쪽만 고치면 실패. **CHANGELOG는 존재 검사만**(계약 표면 아님). (R4/R5)
6. 외부 skill 결과가 승인 증거가 **아니라는** 경계가 명시된다. (R6)
7. upstream MIT·기준 commit·**외부 installer 미실행**이 밝혀진다. (R7)
8. 제품 코드 무변경. typecheck·전체 test·smoke 통과. (R8)

세부는 [01-design.md](01-design.md) · [02-plan.md](02-plan.md).
