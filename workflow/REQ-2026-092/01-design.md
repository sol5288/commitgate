# REQ-2026-092 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

### 실측 — 세 지점의 판정이 갈라져 있다

| # | 위치 | 판정식 | staged·worktree-clean `state.json`을 |
|---|---|---|---|
| ① | `review-codex.ts:303` `captureGitBinding()` | `git write-tree` (인덱스 전체) | **승인 tree에 포함** |
| ② | `review-codex.ts:2155` `findUnstagedOrUntracked()` (D10) | `e.index === '?' \|\| e.worktree !== ' '` | **보지 않음**(통과) |
| ③ | `req-commit.ts:896` | `p === '<t>/state.json' \|\| p.startsWith('<t>/responses/')` | **거부** |

①이 만든 승인을 ③이 거부하는데, 그 사이에 ②가 아무것도 걸러 주지 않는다. 결과는
`00-requirement.md` §1의 (a)∧(b) 동시 충족 불가 — **복구 불가능한 교착**이다.

### 🔴 이 사각지대는 이미 알려져 있었다 (전파 실패)

`workflow/REQ-2026-012/01-design.md:16`이 **같은 사실을 정확히 적어 두었다**:

> 그 함수는 이름 그대로 **unstaged 또는 untracked**만 flag한다 — `return x === '?' || y !== ' '`.
> **staged이고 워킹트리가 clean한 `M `는 통과시킨다.** `req:new`는 그것도 막아야 하므로
> **이 함수를 재사용할 수 없다.**

REQ-012는 그래서 `req:new`용으로 `isToolOutputScratch`(= `state.json`·`responses/**` **제외**)를 따로 만들었다.
즉 "`state.json`이 staged로 새어 들어가면 안 되는 자리가 따로 있다"는 판단은 이미 내려져 있었고,
**리뷰 경로에만 적용되지 않았다.** 본 REQ는 새 통찰이 아니라 **누락된 전파를 마저 하는 것**이다.

### 왜 지금까지 안 터졌나

정상 사용에서 `state.json`은 도구가 쓰고 도구가 커밋한다(state checkpoint). 사용자가 그것을 손으로
stage할 이유가 없다. `git add -A`처럼 **경로를 넓게 잡을 때만** 인덱스에 들어간다. 소비자 리포트의
재현 절차 1번(`git add -A -- scripts workflow/REQ-XXXX`)이 정확히 그 경우다.

## 핵심 설계 결정

### DEC-1 — 술어의 정본은 `lib/scratch.ts` 한 곳

`req-commit.ts:896`의 인라인 필터를 **순수 함수로 추출**하고 두 호출부가 그것만 쓴다.

```ts
export function sourceCommitForbiddenStaged(
  stagedPaths: readonly string[],
  ticketDirRel: string,
): string[]
```

**왜 `lib/scratch.ts`인가** — 세 가지가 동시에 성립하는 유일한 자리다.

1. **새 import 간선이 0이다.** `review-codex.ts`(`isAllowedResponsesScratch`)와 `req-commit.ts:27`
   (`isArchiveFileName`) **둘 다 이미** 이 모듈을 import한다. `lib/evidence.ts`도 후보였으나
   (`designEvidenceStagePaths`가 staging 계약을 이미 갖고 있다) 새 간선이 생긴다.
2. **모순되는 두 사실이 한 파일에 모인다.** `reviewScratchPaths()`가 `state.json`을 **관용**하고,
   신규 술어가 같은 경로를 **금지**한다. 이 비대칭이 바로 이번 버그의 원인이므로 **다음 독자의 눈에
   반드시 보여야 한다.** 두 함수를 떼어 놓으면 같은 사고가 반복된다.
3. leaf 유지 — `porcelain`에만 의존한다는 기존 제약을 깨지 않는다(순수 문자열 판정).

**입력 정규화**: 역슬래시→슬래시 + **빈 문자열만** 제거를 함수 안에서 한다.
🔴 **`trim()`은 쓰지 않는다**(phase-1 r01 P1). 앞뒤 공백은 Git 경로의 일부이므로 다듬으면
` <t>/state.json`(다른 파일)을 금지 경로로 오인해 정상 리뷰·커밋을 거부한다. 같은 이유로
`phaseCodeFiles`도 trim하지 않는다.

### DEC-1b — 술어뿐 아니라 **입력 획득 방식**도 맞춘다 (phase-1 r02 P1)

같은 순수 함수를 쓰더라도 **넣는 바이트가 다르면 판정이 갈린다.** 처음 설계는 `req:commit`의
`stagedNames()`(`--name-only` 개행 split + `trim()`)를 그대로 두고 술어만 공유했는데, 그것이
**이 REQ가 없애려는 교착을 그대로 재현**한다:

1. 다른 파일인 ` workflow/REQ-x/state.json`(선행 공백)을 코드와 함께 stage한다.
2. 리뷰 게이트는 `-z` 원문을 보므로 현재 티켓 경로가 **아니라고** 판정 → 통과·승인(그 tree가 바인딩된다).
3. `req:commit`은 `trim()` 후 현재 티켓의 `state.json`으로 **오인** → 금지.
4. unstage하면 승인 tree와 달라져 (a)가 깨진다 → **커밋 불가 = 교착**.

또한 `-z`가 없으면 `core.quotePath=true` 기본값에서 비ASCII 경로가 C-인용된 표시 문자열로 들어와
접두사 비교가 빗나가고 **위반을 통째로 놓친다(fail-open)**.

→ `stagedNames()`를 `STAGED_NAMES_Z_ARGS`(`diff --cached --name-only -z`) 기반으로 바꾸고
공백을 보존한다. **이것은 `req:commit`의 동작 변경이다**(§하위호환 참조). 처음 설계의
"동작 무변경" 문구는 r02에서 정정됐다 — 무변경을 지키는 것이 곧 R2 위반이었다.

### DEC-2 — 게이트 위치: `if (!opts.run)` 분기 **앞**

`mainImpl`에서 DRY-RUN 분기(`review-codex.ts:2544`)보다 **위**에 둔다. 이 한 자리가 R1·R3을 동시에 만족한다.

- **R3(경로 일관성)**: DRY-RUN은 2557에서 `return`하므로, 분기 **뒤**에 두면 LIVE에서만 돈다.
  분기 앞 **단일 호출부**여야 두 경로가 같은 판정을 낸다. 호출을 두 군데로 복제하는 대안은
  DEC-1이 없애려는 바로 그 분기 위험을 재도입하므로 **기각**한다.
- **R1(호출 전 차단)**: 예산 게이트·attempt 기록·pre-call 원장 커밋·유료 호출은 **전부** 2560 이후다.
  분기 앞은 그 모두보다 앞이므로 "아무것도 소모하지 않고 되돌린다"가 성립한다
  (REQ-2026-086 DEC-1이 granularity 게이트에 요구한 것과 같은 순서 규칙).

**부수 효과 — D10(2572)보다 앞선다.** 두 위반이 동시에 있으면 신규 게이트가 먼저 보고된다. 의도한 것이다:
staged 위반은 **유료 호출을 낭비시키는** 쪽이고, D10 위반은 그렇지 않다. 더 비싼 실패를 먼저 알린다.

### DEC-3 — kind 격리: phase 리뷰만 대상

design 리뷰는 걸지 않는다. **근거(실측)**: `applyVerdict`(`review-codex.ts:1858-1864`)는 `kind==='design'`
에서 `design_approved`/`design_approved_hash`만 쓰고 **early return** 한다 — `approved_diff_hash`를
**설정하지 않는다.** 따라서 design 승인에는 `req:commit`의 (a) 조건 자체가 없고 (a)∧(b) 충돌이
**구조적으로 불가능**하다. 없는 위험에 게이트를 걸면 design-finalize 절차(설계문서만 staged인 정상 상태)를
막을 위험만 생긴다. granularity 게이트(REQ-2026-086 DEC-7)가 design을 제외한 것과 같은 태도다.

### DEC-4 — 거부 메시지: 위반 경로 + 복구 명령 + 되돌린 뒤의 안전 보장

```
phase 리뷰를 시작할 수 없습니다 — 승인해도 커밋할 수 없는 staged 구성입니다.
리뷰를 실행하지 않았습니다 — 소모된 것이 없습니다.

워크플로 파일이 staged에 있습니다(req:commit이 source 커밋에서 금지하는 경로):
  workflow/REQ-2026-092/state.json

해소:
  git restore --staged -- workflow/REQ-2026-092/state.json

unstage 후 파일이 수정된 채로 남아도 괜찮습니다 — …/state.json과 리뷰 원장은
D10이 스크래치로 관용하며, 도구가 승인 시점에 부기 커밋으로 남깁니다.
```

- `git restore --staged`는 이 저장소의 기존 관용구다(`review-codex.ts`의 면적 안내·`docs/workflow.md`·
  `lib/config.ts`) — 새 표현을 만들지 않는다.
- **마지막 두 줄이 R4의 핵심이다.** 이것이 없으면 사용자는 unstage 후 D10에 막힐 것을 걱정해
  되레 다시 `git add` 할 수 있다(= 원래 사고의 재현). 그 걱정이 근거 없음을 명시한다.

**pathspec 안전 표기**(phase-1 r02 P1). 경로를 그대로 이어 붙이면 `…/foo bar.json`이 셸에서 **두
경로로 쪼개져** 실제 파일을 unstage하지 못한다 — 안내가 "정확한 복구 명령"이 아니게 된다.

- 순수 헬퍼 `quotePathspec(p)`: `[A-Za-z0-9._/-]`만으로 된 경로는 **그대로**(불필요한 인용은
  복사·붙여넣기 경험을 해친다), 그 외는 큰따옴표로 감싸고 내부 `"`·`\`를 이스케이프한다.
- 호출부는 항상 **`--` 경계**를 붙인다. `-`로 시작하는 경로가 옵션으로 파싱되는 것은 인용으로 못 막는다.
- ⚠️ **한계를 명시한다**: 완벽한 크로스-셸 인용은 한 문자열로 불가능하다(POSIX sh·PowerShell·cmd의
  이스케이프 규칙이 다르다). 큰따옴표는 셋 모두에서 **공백**을 한 토큰으로 묶는 유일한 공통 표기이고,
  워크플로 티켓 경로에서 현실적으로 나오는 특수문자는 공백이므로 그 경우를 정확히 처리하는 데 집중한다.

### DEC-5 — 회귀 가드는 **행위**로 건다(정적 스캐너 금지)

R2(분기 방지)를 소스 문자열 스캔으로 검증하지 않는다 — REQ-2026-044 DEC-7에서 정적 스캐너가 설계
5라운드 미수렴을 낳고 폐기된 전례를 따른다. 대신 세 겹으로 건다.

1. **공유 케이스 표**(단위): 경계 케이스 한 벌을 표로 두고 술어의 산출을 고정한다.
2. **리뷰 측 실-git e2e**: staged `state.json` + phase 리뷰 → throw. 🔴 **`FakeReviewerAdapter`의
   호출 횟수 `=== 0`** 을 단언한다. 이것이 R1(유료 호출 전 차단)의 진짜 오라클이다 — throw만 확인하면
   호출 후에 던져도 통과한다.
3. **커밋 측 무회귀**: `req:commit`의 기존 거부 동작이 그대로임을 고정(추출이 리팩터링임을 증명).

### DEC-6 — 무회귀 경계(R5)

신규 게이트는 **거부하거나 아무것도 하지 않는다.** 통과 시 `state`·프롬프트·바인딩·출력에 한 글자도
쓰지 않는다. 정상 경로 바이트 무변경은 기존 프롬프트 대조군 테스트가 이미 고정하고 있다.

## Phase별 구현

`02-plan.md` 참조. phase-1 = 술어 + 배선 + 가드(코드), phase-2 = 문서·CHANGELOG.

## 변경 파일

| phase | 파일 | 내용 |
|---|---|---|
| 1 | `scripts/req/lib/scratch.ts` | `sourceCommitForbiddenStaged()` 신설(공백 보존) + 비대칭 근거 주석(DEC-1) |
| 1 | `scripts/req/review-codex.ts` | DRY-RUN 분기 앞 게이트 배선 + 메시지 빌더 + `quotePathspec()`(DEC-2·3·4) |
| 1 | `scripts/req/req-commit.ts` | 인라인 필터를 공유 술어로 교체 + `stagedNames()`를 `-z` 기반으로 교정(DEC-1·1b) |
| 1 | `tests/unit/scratch.test.ts` | 술어 케이스 표 + 공백 경로 오인 방지(DEC-5-1) |
| 1 | `tests/unit/req-review-codex.test.ts` | 실-git e2e + **호출 0회·커밋 수 불변·원장 0행** + 인용(DEC-5-2) |
| 1 | `tests/unit/req-commit.test.ts` | 입력 형태 파리티 + 실-git `stagedNames` 바이트 파리티(DEC-5-3) |
| 2 | `docs/troubleshooting.md`·`.en.md` | 증상→원인→복구 항목 |
| 2 | `CHANGELOG.md` | Unreleased + 확인할 파일 표(phase-1 실제 SHA) |

## 하위호환·안전

- **차단이 새로 생긴다** — 지금까지 통과하던 입력(staged `state.json` + phase 리뷰) 하나가 거부된다.
  그러나 그 입력의 **유일한 귀결이 복구 불가 교착**이므로 "깨진 것을 계속 깨지게 두는" 하위호환은
  가치가 없다. 진행 중이던 티켓은 `git restore --staged` 한 번으로 즉시 진행 가능하다.
- **fail-closed 방향**: 게이트 오작동 시 최악은 정당한 리뷰가 막히는 것(비용 = 안내 읽고 unstage)이고,
  반대 방향(교착 승인 통과)이 아니다.
- **기존 scratch 계약 무변경**: unstaged·dirty `state.json`은 여전히 D10 통과다
  (`tests/unit/req-review-codex.test.ts`·`req-doctor.test.ts`의 4C e2e가 고정). 신규 술어는
  **staged**만 본다 — 두 계약은 직교한다.
- 🔴 **`req:commit`의 staged 경로 판독이 바뀐다**(DEC-1b). `--name-only` 개행 split + `trim()` →
  `-z` split + 공백 보존. 판정이 달라지는 입력은 **공백이 든 경로**와 **비ASCII 경로** 둘뿐이고,
  두 경우 모두 이전이 **틀렸다**(전자는 무고한 파일을 금지 경로로 오인, 후자는 C-인용 때문에 진짜
  위반을 놓침). 즉 변경 방향은 오판 → 정확이며, 정상 ASCII 경로에서는 완전히 동일하다.
  같은 판독을 쓰는 `evidence-finalize`의 chore-leak 가드도 함께 정확해진다(같은 방향).
- **소비자 배포 시** 이 게이트만으로 이미 발생한 교착은 풀리지 않는다. 그 복구는 후속 REQ(결함 3)다.
