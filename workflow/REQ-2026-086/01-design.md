# REQ-2026-086 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

| 자리 | 현재 |
|---|---|
| `req-doctor.ts` `GRANULARITY_MAX_FILES` | `8`(config `granularityMaxFiles`가 덮음) |
| `req-doctor.ts` `phaseGranularityWarnings()` | 초과 시 문자열 1개. **"다음부터 분할 권고"** — 이미 큰 phase는 막지 않는다 |
| D18 | `WARN` 고정. 주석이 *"절대 FAIL 아님"*을 못박음 |
| `review-codex.ts` phase 경로 | 검수 면적을 **보지 않는다**. `git diff --cached`를 프롬프트에 담을 뿐 |
| `state.json` `phases[]` | `{ id, approved }` — phase별 메타를 담을 자리가 이미 있다 |

즉 **판정은 있는데 아무 데도 걸려 있지 않고, 걸려 있는 곳(D18)은 이미 늦었다.**

## 핵심 설계 결정

### DEC-1 — 판정 시점을 **phase 리뷰 실행 직전**으로 옮긴다

`req:review-codex --kind phase`의 preflight. 구체적으로 **예산 게이트·attempt 기록·pre-call 원장 커밋보다 앞**이다.

- 아끼려는 것이 리뷰 라운드이므로, 판정은 그 호출 **전**이어야 한다(R1).
- 이 시점의 시정은 **staging 재구성**이다: `git restore --staged <파일들>` → 코드는 그대로. 커밋 직전(D18)과
  달리 "이미 짠 코드를 되돌려 나누는" 비용이 없다.
- 🔴 **원장·attempt보다 앞이어야 한다.** 뒤면 attempt가 열리고 부기 커밋이 남은 뒤 막히므로,
  "아무것도 소모하지 않고 되돌린다"가 성립하지 않는다.

### DEC-2 — 초과하면 **리뷰를 실행하지 않는다**(fail-closed)

throw로 중단한다. 메시지는 **두 탈출구를 모두** 제시한다.

```
phase 검수 면적 초과: 14파일 > 8(granularityMaxFiles)
리뷰 라운드는 면적에 비례해 늘어납니다(실측: >8파일 평균 2.4R vs ≤8파일 1.4R).

둘 중 하나를 선택하세요.
  A. 지금 나눈다(권장, 코드 변경 없음)
     git restore --staged <이번 phase에서 뺄 파일들>
     빼낸 파일은 다음 phase로 — state.json의 phases[]에 항목을 추가하세요.
  B. 이 phase는 원래 크다고 선언한다(기계적 일괄 변경 등)
     state.json의 phases[]에서 이 phase 항목에  "max_files": 14  를 추가하세요.
```

### DEC-3 — 예산 선언은 `phases[]`의 optional `max_files`

```json
{ "id": "phase-2-rename-sweep", "approved": false, "max_files": 24 }
```

- 🔴 **`02-plan.md`를 파싱하지 않는다**(R4). 손수 명세한 markdown 오라클은 이 프로젝트에서 두 번 실패했다
  (REQ-2026-041 설계 7R 미수렴 폐기 · REQ-2026-044 DEC-7 정적 스캐너 폐기 → 존재검증만).
  `phases[]`는 **이미 기계가 읽는 구조**이고 티켓 저자가 채우는 자리다.
- 선언은 `state.json`에 남고 그 파일은 state checkpoint로 **커밋**된다 → 탈출구가 기록된다(R3).
- 값이 있으면 그 phase에 한해 임계로 쓴다. 없으면 `cfg.granularityMaxFiles`.

### DEC-4 — 코드 파일 = staged 중 **티켓 디렉터리 밖**

```
git diff --cached --name-only  →  <ticketRel>/ 로 시작하는 경로 제외
```

- 리뷰 시점에는 D10이 이미 "워킹트리 클린(staged + 스크래치)"을 보장한다. 따라서 **staged가 곧 이 phase의
  변경집합**이고, 그 위에서 티켓 문서·증거만 빼면 된다.
- doctor의 `codeChanges`(status entry 기반 분류)를 **복제하지 않는다** — 입력 전제가 다르고
  (doctor는 unstaged/untracked도 본다) 두 벌이 되면 갈라진다.

### DEC-5 — D18은 WARN 그대로

진단 표면(doctor)과 차단 표면(verb preflight)을 분리한다 — D24(setup 게이트)가 쓰는 것과 같은 구조다.
`req:commit`이 doctor를 하드 게이트로 spawn하므로 D18을 FAIL로 올리면 **이미 승인받은 phase의 커밋까지
막혀** 사용자가 빠져나갈 수 없게 된다(승인은 소비되지 않고 코드는 커밋 못 하는 교착).
문구만 새 절차에 맞춘다.

### DEC-6 — 되돌리는 설정은 한 줄

`req.config.json`의 `granularityGate`:

| 값 | 동작 |
|---|---|
| `"block"`(기본) | DEC-2대로 리뷰 전 차단 |
| `"warn"` | 경고만 출력하고 리뷰를 진행(REQ-2026-086 이전 동작) |

기본을 `block`으로 두는 이유: `warn`이 기본이면 아무도 켜지 않아 이 REQ가 무의미해진다.
업그레이드로 동작이 좁아지는 것은 **의도**이고 CHANGELOG에 명시한다(R5·요구사항의 알려진 영향).

### DEC-7 — design 리뷰는 무영향

`opts.kind === 'phase'`일 때만 판정한다(R7). design 리뷰의 권위 아티팩트는 설계 문서이고,
그 크기는 이 정책의 대상이 아니다.

## Phase별 구현

### phase-1-granularity-preflight (DEC-1~4·6·7)

- `scripts/req/lib/config.ts` — `granularityGate` 기본값(`'block'`)·타입·스키마.
- `workflow/req.config.schema.json` — 같은 축(vendored 자산 드리프트 가드가 강제).
- `scripts/req/review-codex.ts` — `PhaseEntry.max_files?` · 순수 판정 `phaseAreaProblem()` ·
  phase 리뷰 preflight 배선(예산 게이트·attempt 기록 **앞**).
- `tests/unit/req-review-codex.test.ts` — 순수 판정 + **실제 진입점** 배선 확인.

회귀 가드: ①임계 이하 통과 ②초과 시 throw ③`max_files` 선언이 그 phase에 한해 임계를 올린다
④`granularityGate: 'warn'`이면 통과(경고만) ⑤design 리뷰는 무영향 ⑥티켓 문서는 세지 않는다
⑦🔴 **차단 시 attempt·원장·부기 커밋이 하나도 생기지 않는다**(DEC-1의 순서 요구).

### phase-2-docs-changelog

- `scripts/req/req-doctor.ts` — D18 문구를 새 절차에 맞춘다(레벨은 WARN 유지 — DEC-5).
- `docs/workflow.md` · `docs/workflow.en.md` — 두 탈출구와 `granularityGate`.
- `CHANGELOG.md` — Unreleased + **확인할 파일 표**(phase-1의 실제 커밋 SHA·경로) + ⚠️ 동작이 좁아진다는 고지.

## 변경 파일

| 파일 | phase |
|---|---|
| `scripts/req/lib/config.ts` · `workflow/req.config.schema.json` | 1 |
| `scripts/req/review-codex.ts` | 1 |
| `tests/unit/req-review-codex.test.ts` | 1 |
| `scripts/req/req-doctor.ts` | 2 |
| `docs/workflow.md` · `docs/workflow.en.md` · `CHANGELOG.md` | 2 |

## 하위호환·안전

- 🔴 **동작이 좁아진다**(의도). 8파일 초과 phase를 진행 중이던 소비자는 다음 리뷰에서 멈춘다.
  탈출구 둘 다 즉시 적용 가능하고(staging 축소 / `max_files` 한 줄), 되돌리는 설정도 한 줄이다.
- **소비되는 것이 없다**: 차단은 attempt·원장·커밋보다 앞이라 되돌릴 상태가 남지 않는다.
- **승인 이후는 막지 않는다**: D18을 WARN으로 남겨(DEC-5) 이미 승인된 phase의 커밋이 교착되지 않는다.
- **vendored 자산**: `req.config.schema.json`이 바뀌므로 소비자는 D20 WARN → `commitgate sync`.
- `granularityMaxFiles` 기본값(8)·D18의 판정식은 **바뀌지 않는다.**
