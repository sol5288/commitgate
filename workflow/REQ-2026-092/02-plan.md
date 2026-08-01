# REQ-2026-092 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

## Phase 1 — 술어 SSOT + 리뷰 전 게이트 (`phase-1-staged-guard`)

범위(6파일):

- `scripts/req/lib/scratch.ts` — `sourceCommitForbiddenStaged(stagedPaths, ticketDirRel)` 신설(DEC-1).
  역슬래시→슬래시 + **빈값만** 제거(🔴 `trim()` 금지 — 공백은 경로의 일부). `reviewScratchPaths`가 같은
  경로를 **관용**하고 이 함수가 **금지**하는 비대칭을 주석으로 명시 — 이 비대칭이 REQ-2026-092의 원인이다.
- `scripts/req/review-codex.ts` — DRY-RUN 분기(`if (!opts.run)`) **앞**에 게이트 배선(DEC-2).
  `opts.kind === 'phase'`에서만(DEC-3). 거부 메시지 빌더와 `quotePathspec()`을 **순수 함수로 분리**해
  문구·인용을 테스트가 고정(DEC-4).
- `scripts/req/req-commit.ts` — 인라인 필터를 공유 술어 호출로 교체(DEC-1) + `stagedNames()`를
  `STAGED_NAMES_Z_ARGS` 기반·공백 보존으로 교정(DEC-1b). 🔴 정상 ASCII 경로에서는 동일하고,
  공백·비ASCII 경로에서만 **오판이 고쳐진다**.
- `tests/unit/scratch.test.ts` — 술어 케이스 표(DEC-5-1).
- `tests/unit/req-review-codex.test.ts` — 실-git e2e + 인용(DEC-5-2).
- `tests/unit/req-commit.test.ts` — 입력 형태·바이트 파리티(DEC-5-3).

회귀 가드:

1. **술어 표**: `<t>/state.json` 금지 · `<t>/responses/` 하위 전부 금지 · `<t>/01-design.md` 허용 ·
   `scripts/x.ts` 허용 · **다른 티켓의 `state.json` 허용**(현재 티켓만 대상) · `<t>/state.json.bak` 허용
   (정확 일치) · `<t>/responses-old/` 허용(디렉터리 경계) · 역슬래시·후행 슬래시 정규화 ·
   🔴 **앞뒤 공백 경로를 오인하지 않음**(r01 P1) + 그래도 진짜 위반은 잡음(fail-open 아님).
2. 🔴 **실-git e2e(핵심)**: staged `state.json` + `--kind phase --run` → throw **AND**
   `FakeReviewerAdapter` 호출 `=== 0` **AND** 커밋 수 불변 **AND** 원장 행 0.
   throw만 보면 "호출 후 throw"도 통과하고, 호출 0회만 보면 예산·attempt 부작용을 못 본다(설계 r01 observation).
3. **DRY-RUN 동일 판정**(R3): 같은 구성에서 `--run` 없이도 throw.
4. **kind 격리**(DEC-3): 같은 구성에서 `--kind design`은 **통과**.
5. **정상 경로 무회귀**(R5): 코드만 staged → 통과 + 프롬프트 바이트 대조군 불변.
6. **기존 scratch 계약 무변경**: unstaged·dirty `state.json`은 여전히 통과(기존 4C e2e 그린 유지).
7. **커밋 측**: 거부 문구가 위반 경로를 전부 나열 · 두 입력 형태(`--name-only`/`-z`)가 같은 판정 ·
   🔴 **실 git 바이트 파리티**(같은 인덱스 → 같은 배열) · 🔴 **비ASCII 위반을 놓치지 않음**
   (예전 `--name-only`는 C-인용 때문에 fail-open이었다).
8. **복구 명령 안전성**(R4·r02 P1): 공백 경로가 인용되고 `--` 경계가 붙는다 · 안전 경로는 인용하지 않는다.

Exit: typecheck0 · **전체 스위트 그린** · Codex phase 리뷰 승인.

## Phase 2 — 문서 + CHANGELOG (`phase-2-docs`)

범위(3파일):

- `docs/troubleshooting.md` / `docs/troubleshooting.en.md` — 증상(리뷰가 거부됨)→원인(`git add -A`가
  워크플로 파일을 인덱스에 넣음)→복구(`git restore --staged`)와, **이 게이트가 없었다면 무슨 일이
  벌어졌는지**(교착) 한 줄.
- `CHANGELOG.md` — Unreleased 항목 + **확인할 파일 표**(phase-1 실제 커밋 SHA·경로).
  REQ-2026-082 교훈: 막 phase의 CHANGELOG가 앞 phase를 알리면 diff-scoped 리뷰가 근거 부족으로
  반려하므로, SHA 포인터 표를 **처음부터** 넣는다.

Exit: typecheck0 · 전체 스위트 그린 · `docs:lint` 그린 · Codex phase 리뷰 승인.

## 완료

- 게이트 해당분(unit·typecheck·docs:lint) · 사용자 main 머지(별도 승인).
- 배포는 별도 판단(후속 REQ 3건과 묶을지 포함).
