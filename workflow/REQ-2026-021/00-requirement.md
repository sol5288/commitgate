# REQ-2026-021 요구사항 — Companion Skills: gitignore 경고·uninstall 계획 (REQ-A2-1)

## 1. 배경

REQ-2026-020이 companion skills 4종을 패키지에 싣고 `commitgate init`이 **기본으로 설치**하게 만들었다(`a4fbcb9`).
그런데 그 자산의 **수명주기 계약이 비어 있다**:

- `.claude/`가 gitignore된 repo에서 init이 "설치했다"고 보고하지만 **팀원 clone에는 없다**. 경고가 없다.
- `commitgate uninstall` 계획에 companion 4종이 **없다** → 사용자가 무엇을 정리해야 하는지 알 수 없다.

**PM 결정(2026-07-17): 이것은 출시 후 보완할 문서가 아니라 제품 수명주기 계약이다.** 기본 init이 이미 설치하므로
이 계약 없이 병합하지 않는다. REQ-020은 main 병합 보류 상태다.

## 2. 목표(What)

companion skills가 **기존 설치 자산과 같은 수명주기 계약**을 받는다 — 팀에 전달되지 못하면 경고하고, 제거 계획에 등장한다.
기존 경고·uninstall 동작은 **약화하지 않는다**.

## 3. 요구(정규화)

- **R1 gitignore 경고**: `.claude/`가 gitignore돼 companion skills가 팀원 clone에 전달되지 못하면 **WARN**한다.
  설치는 진행하되 추적 방법을 안내한다. (Done #1)
- **R2 `--strict` fail-closed**: `--strict`면 **설치 전에** throw한다. 기존 strict 의미(WARN → preflight throw)와 동일하며
  **쓰기 0회**여야 한다. (Done #2)
- **R3 userDiffers 누락 금지**: **사용자가 수정한** companion skill도 경고 판단에서 빠지지 않는다.
  판정은 `(created || ownedSkip || userDiffers) && ignored && !tracked` — `workflow/.gitignore`의
  `workflowGitignorePolicyAtRisk`와 같은 식이다. (Done #3)
- **R4 uninstall 계획 포함**: `commitgate uninstall` 계획에 companion 4종이 등장한다. **읽기 전용 유지** —
  대상 tree를 변경하지 않는다. (Done #4)
- **R5 기존 동작 무변경**: 기존 계약 포인터(`.claude/skills/commitgate/SKILL.md`·`.claude/commands/req.md`·
  `.cursor/rules/commitgate.mdc`)와 `workflow/.gitignore`의 WARN·`--strict`·uninstall 동작을 **약화하지 않는다**.
  companion 경고는 **companion 자산에 대해서만** 추가된다. (constraints)
- **R6 정직성**: uninstall의 `differs`는 "사용자 수정"이 아니라 **"수정됨 또는 다른 버전이 깐 것"**이다.
  origin 판별 불가 파일은 byte-identical이어도 자동 제거 대상에서 빠질 수 있다.
  **"byte-identical이면 정리 후보"라고 단정하지 않는다.** (constraints)
- **R7 테스트·typecheck**: 단위 테스트·typecheck 통과. 경고 원인 격리 fixture로 R3를 증명한다. (Done #5)

## 4. 비목표 — 이번 범위에서 구현하지 않음

**PM 결정: 후속을 하나로 묶지 않는다.** 같은 리뷰 과밀이 재발한다(REQ-020은 설계 1개가 6 phase를 덮어 리뷰 13회).

- **REQ-A2-2**: 타사 skill 공존 fixture · Stage-A migrate 비추가 검증 · packed-tarball fresh-install smoke.
- **REQ-A2-3**: README(ko/en)·CLI help·CHANGELOG · **Cursor CLI 버전·모드 재검증 후 지원 표기 확정**.
- `uninstall --apply`·자동 정리·manifest·provenance. uninstall은 **읽기 전용** 유지.
- 신규 opt-out 플래그(`--no-companion-skills`) — REQ-020에서 이미 미도입 결정(기존 entrypoint 경고와 충돌해 R6 약화).
- 출시본 v0.7.0의 dangling symlink 구멍(REQ-C) — 별도 REQ.

## 5. 유지되는 이전 결정 (실측)

- 🔴 **`userDiffers`는 `skips`로 가서 `planArtifactPaths`(= `copies + ownedSkips`)에 없다.**
  artifacts만 보면 ignore 검사에서 빠진다 → 이 REQ의 핵심 함정이다(REQ-020 design-r09).
- **companion은 `CONTRACT_POINTER_RELPATHS`에 없다**(`KIT_COMPANION_SKILLS` 별도 목록, REQ-020 D6).
  의미가 다르므로 그대로 유지하고, 같은 WARN/strict **동작**만 별도로 준다.
- `bin/`에 **rollback 코드가 0줄**이다 — 보장은 "쓰기 전에 실패". `--strict`는 preflight에서 throw해야 한다.
- `bin/uninstall.ts`는 **이미 읽기 전용**(`node:fs` 조회 API만, `--apply` 없음). `child_process` 미import 구조 테스트가 있다.
- `findIgnoredArtifacts`가 이미 ignored∧untracked를 잡는다. `gitIsIgnored`/`gitIsTracked`가 그 재료다.

## 6. 대표 예시·실패 경계

**정상 경로**: `.claude/`를 gitignore하지 않은 repo → init → 경고 없음. 기존과 동일.

**경고 경로**: `.claude/`가 gitignore된 repo → init → "companion skills가 ignore되어 팀원 clone에는 없다" + 추적 방법 안내.
`--strict` → 설치 전 throw, 쓰기 0회.

**🔴 함정 경로(R3)**: 나머지가 전부 추적된 상태에서 사용자가 `commitgate-tdd/SKILL.md`만 수정 →
untracked ∧ ignored ∧ differs. artifacts만 보는 구현은 **경고 없이 통과**한다 → R1/R2 우회.

## 7. 용어

- **userDiffers**: 대상에 존재하고 패키지 원본과 **바이트가 다른** companion skill. 사용자가 고친 것으로 취급해 보존한다(seed-once).
- **at-risk**: 설치 커밋에 담기지 못해 **팀원 clone에 전달되지 않는** 상태 = `ignored ∧ !tracked`.

## 8. 인수 기준

1. `.claude/`가 gitignore된 fixture에서 init이 **WARN**하고 설치는 진행한다. (R1)
2. 같은 fixture에서 `--strict`가 **설치 전 throw + 쓰기 0회**. (R2)
3. 🔴 **경고 원인 격리 fixture**: 나머지 companion·entrypoint를 전부 추적한 뒤 tdd만 untracked·ignored·differs로 남기면
   → **WARN이 나고 그 원인이 tdd임을 단언**한다. 음성 대조군(tdd까지 추적) → **WARN 없음**.
   userDiffers를 판정에서 뺀 변이는 **반드시 실패**한다. (R3)
4. `uninstall` 계획 출력에 companion 4종이 등장하고, **대상 tree 전후 snapshot이 동일**하다. (R4)
5. 기존 계약 포인터·`workflow/.gitignore`의 WARN·`--strict`·uninstall 회귀가 전부 그린. (R5)
6. typecheck·전체 test 통과. (R7)

세부는 [01-design.md](01-design.md) · [02-plan.md](02-plan.md).
