# REQ-2026-092 phase-1 리뷰 요청 (r03) — 술어 SSOT + 리뷰 전 게이트

## 배경

소비자 저장소(`0.15.0`)에서 **phase 승인이 존재하는데도 티켓을 종결할 수 없는 영구 교착**이 보고됐다.
한 티켓의 교착이 `req:new` intake 게이트를 통해 저장소 전체를 막았다.

원인은 두 명령이 "유효한 staged tree"를 다르게 정의하는 것이다. `captureGitBinding()`은 `git write-tree`
(인덱스 전체)를 **무검사** 승인 바인딩으로 삼는데, `req:commit`은 source 커밋 직전에 **(a) tree 일치**와
**(b) `<ticket>/state.json`·`responses/**` staged 금지**를 동시에 요구한다. 리뷰 시점 인덱스에
`state.json`이 있으면 (a)와 (b)는 동시에 참이 될 수 없다. D10은 판정식이
`e.index === '?' || e.worktree !== ' '`라 **staged·worktree-clean을 아예 보지 않아** 막지 못한다.

설계는 r02 승인 상태다(r02에서 이 phase의 P1을 반영해 문서를 정정하고 재승인받았다).

## 이번 라운드에서 고친 것 (r02 P1 2건)

**P1-a — `stagedNames()`의 판독이 phase 게이트와 갈렸다.**
리뷰어가 교착을 구성했다: 다른 파일인 ` workflow/REQ-x/state.json`(선행 공백)을 stage하면 phase 게이트는
`-z` 원문을 보고 통과·승인하는데, `req:commit`은 `trim()` 후 현재 티켓 것으로 오인해 금지 → unstage하면
승인 tree가 깨져 커밋 불가 = **이 REQ가 없애려던 교착의 재현**.

→ `stagedNames()`를 `STAGED_NAMES_Z_ARGS`(`diff --cached --name-only -z`) 기반·공백 보존으로 교정했다.
설계 문서(00 §5 완료기준 · 01 DEC-1b · 02 범위)도 **"동작 무변경" 철회**로 정정하고 **재승인받았다**.

**P1-b — 복구 명령이 실행 가능하지 않았다.**
`…/foo bar.json`을 그대로 이어 붙이면 셸이 두 경로로 쪼갠다.

→ 순수 헬퍼 `quotePathspec()` 신설(안전 문자만이면 그대로, 아니면 큰따옴표+이스케이프) + 호출부에
**`--` 경계** 추가. 크로스-셸 완전 인용이 불가능하다는 한계는 JSDoc·설계에 명시했다.

**r01 P1(직전 라운드)**: 술어의 `trim()` 제거 — 앞뒤 공백은 Git 경로의 일부다.

**설계 r02 observation 반영**: 판정이 갈리는 입력을 "공백·비ASCII"보다 넓게(제어문자 포함)
`stagedNames()` JSDoc에 정확히 적었다.

## 변경 요약 (6파일 — 코드 3 · 테스트 3)

**`scripts/req/lib/scratch.ts`** — `sourceCommitForbiddenStaged()` 신설. `req-commit`에 인라인이던 필터를
옮기고, 역슬래시 정규화 + **빈 조각만** 제거(🔴 `trim()` 없음). 모듈 헤더에 **의도된 비대칭**을 명시:
`reviewScratchPaths`는 같은 `state.json`을 **관용**(워킹트리 축), 이 술어는 **금지**(인덱스 축).

**`scripts/req/review-codex.ts`** — `forbiddenStagedMessage()` + `quotePathspec()` 순수 빌더,
`mainImpl`의 `if (!opts.run)` 분기 **앞**에 게이트 1개소(`opts.kind === 'phase'`만).

**`scripts/req/req-commit.ts`** — 인라인 필터를 공유 술어로 교체, 메시지를
`forbiddenSourceStagedMessage()`로 분리, `stagedNames()`를 `-z` 기반으로 교정(테스트 위해 export).

**테스트 3종** — 술어 케이스 표(16) · 실-git e2e(9) · 파리티/바이트 파리티(5).

전체 스위트 그린(49파일 2372건) · typecheck 0.

## 실측 확인

실제 진입점(`npx tsx scripts/req/review-codex.ts`)으로 이 저장소에서 확인했다.
staged `state.json` + `--kind phase` → 거부(exit 1, 경로·복구 명령 출력) · 같은 상태 `--kind design` → 통과.

## 리뷰 포인트

**P1. 두 호출부가 이제 정말 같은 바이트를 보는가.** `stagedNames()`와 게이트가 같은
`STAGED_NAMES_Z_ARGS`·같은 split·같은 정규화를 쓴다. 남은 갈림이 있는가?

**P2. 게이트 위치.** `if (!opts.run)` 앞이라 DRY-RUN·LIVE가 같은 판정을 내고, 예산·attempt·pre-call
원장 커밋·유료 호출보다 모두 앞이다. D10보다도 앞인데 `--cached`는 워킹트리와 무관하므로 전제가
불필요하다고 판단했다. 맞는가?

**P3. `stagedNames()` 변경의 파급.** 이 함수는 `evidence-finalize`의 chore-leak 가드도 쓴다.
그쪽도 같은 방향(정확)으로 좋아진다고 판단했는데, 내가 못 본 회귀가 있는가?

**P4. `quotePathspec`의 규칙.** 안전 문자 집합 `[A-Za-z0-9._/-]`가 적절한가(너무 좁아 흔한 경로를
불필요하게 인용하지는 않는가). 큰따옴표 선택과 한계 서술이 타당한가?

**P5. e2e 오라클.** 호출 0회 + 커밋 수 불변 + 원장 0행을 단언한다. 더 봐야 할 상태가 있는가?

**P6. kind 격리(DEC-3)의 사각지대.** design 리뷰에서 staged `state.json`이 통과되면 그 인덱스가 다음
phase 리뷰까지 이어질 수 있다(그때 phase 게이트가 잡지만 한 라운드 늦다). 감수할 만한가?
