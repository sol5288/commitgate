# REQ-2026-145 설계

## 현재 상태 (전부 실측)

| 자리 | 현재 |
|---|---|
| `review-codex.ts:1266` `closeSeriesHumanResolution` | **순수 함수. 존재하지만 어떤 verb 도 부르지 않는다**(호출부=테스트뿐) |
| `review-codex.ts:1322` `resolveSuccessorLineage` | 부모 series 에 `closed_reason='human-resolution'` + `decision='replace'` 요구. 없으면 throw |
| `review-codex.ts:1221` series_id 형식 | `` `${kind}:${phaseId ?? '-'}#${seq}` `` — design series 는 **`design:-#1`** (`design#1` 아님) |
| `req-new.ts:275` `durableParentSeriesTerminal` | `--successor-of` 실행 시 부모의 `series-terminal` close-proof·원장을 **이미 커밋한다** |
| `req-review-exception.ts` `--close-stale` | 같은 축(series 수명주기). `--reason` 필수 · state checkpoint 커밋 · 멱등 |

## DEC-1 — 새 verb 를 만들지 않는다. `req:review-exception` 에 `--resolve` 를 얹는다

`--close-stale` 과 **같은 축**(series 수명주기의 사람 개입)이다. 새 verb 를 만들면 표면이 하나 늘고
사람이 어느 것을 쓸지 또 골라야 한다.

```
req:review-exception <REQ> --resolve replace --series <series_id> --reason "…" --confirm "…" [--run]
```

- `--resolve` 는 **`replace` 만** 받는다. 다른 값은 거부(지금 소비처가 없는 값을 받으면 나중에 그 값이
  무엇을 뜻하는지 아무도 모른다).
- 🔴 `--reason`·`--confirm` 은 **`trim()` 후 비어 있으면 거부**한다(설계 r02 P1). `note` 는 선택 필드이고
  `isValidHumanResolution` 도 검사하지 않으므로, **verb 가 막지 않으면 빈 근거를 가진 replace 결정이
  그대로 커밋된다**. "필수"는 인자 존재가 아니라 **내용 존재**여야 한다.
- `--run` 없으면 dry-run(무부작용) — 이 저장소 전 verb 공통.

## DEC-2 — 대상은 `--series` 로 **명시받는다**

`closeSeriesHumanResolution(state, kind, phaseId, resolution)` 은 `(kind, phaseId)` 로 **열린** series 를
찾는다. 한 티켓에 design series 와 phase series 가 동시에 열려 있을 수 있으므로 도구가 짐작하면
엉뚱한 것을 종결한다.

- `--series` 값으로 `state.review_series` 에서 **그 `series_id` 를 그대로** 찾아 `(kind, phase_id)` 를 얻는다.
  🔴 **문자열을 파싱하지 않는다** — `phase#alpha` 처럼 `#` 이 든 phase id 에서 깨진다
  (REQ-2026-028 design-r01 이 같은 자리에서 이미 P1 을 받았다).
- 없는 `series_id` → 거부. 이미 닫힌 series → 거부(무엇을 종결할지 없다).
- 🔴 안내 메시지는 **그 티켓의 실제 열린 series_id 목록**을 보여 준다. 형식을 설명하지 않고 값을 준다.

## DEC-3 — 결정은 **커밋된 상태**로 남긴다

`closeSeriesHumanResolution` 은 scratch state 만 바꾼다. 그대로 두면 두 문제가 동시에 생긴다.

1. **다음 단계가 막힌다** — `req:new` 는 clean worktree 를 요구하고 더러운 `state.json` 은 허용
   스크래치가 아니다. 두 단계 안내인데 1단계가 2단계를 막는다.
2. **결정이 사라질 수 있다** — 커밋되지 않은 결정은 기록이 아니다.

그래서 **`commitStateCheckpoint`(REQ-2026-057 정본 경로)를 쓴다** — 새 커밋 경로를 만들지 않는다.
🔴 다만 **`--close-stale` 이 이미 그렇게 한다고 가정하지 않는다**(설계 r04 관찰): 현재 그 경로는
state 를 쓴 뒤 checkpoint 를 부르지 않는다. 즉 복제할 기존 동작이 없고, 이 verb 에 **명시적으로**
추가해야 한다. 실행 후 `state.json` 기인 더러움이 0 이어야 한다.

🔴 **원장 어휘를 늘리지 않는다.** 원장 이벤트는 `attempt-opened`/`attempt-closed` 뿐이고 이 결정은
attempt 가 아니다. 억지로 넣으면 원장의 의미가 흐려진다. 결정의 내구 기록은 두 겹으로 충분하다:

| 시점 | 어디에 |
|---|---|
| `--resolve` 실행 즉시 | **커밋된 `state.json`**(checkpoint) — 사용자가 여기서 멈춰도 남는다 |
| `req:new --successor-of` 실행 시 | `series-terminal` close-proof + 원장 — **기존 `durableParentSeriesTerminal` 이 이미 한다**(무변경) |

## DEC-3a — `--reason`·`--confirm` 의 **저장 위치**(설계 r01 P1)

`HumanResolution` 에 **이미 자리가 있다**. 타입을 바꾸지 않는다.

| 입력 | 저장 | 근거 |
|---|---|---|
| `--confirm` | `method` | 필드 주석이 이미 "받은 승인 문장 그대로"다 |
| `--reason` | `note` | 선택 필드이나 이 verb 에서는 **필수 입력**이므로 항상 채워진다 |
| — | `decided_at` | 🔴 **실제 시계를 읽는다.** 지어내지 않는다(REQ-2026-019 가 타임스탬프 날조로 폐기됐다) |
| — | `decision` | `'replace'` 고정 |

🔴 두 값이 **서로 다른 필드**에 들어가므로 유실도 혼동도 없다. 테스트가 두 값을 서로 다르게 주고
각각 제 자리에서 나오는지 확인한다.

## DEC-3b — 🔴 clean tree 는 **이 verb 혼자 만들 수 없다**(설계 r01 P1)

실제 hardCap 상태에는 리뷰에 올린 **설계 문서가 staged 로 남아 있다**. `commitStateCheckpoint` 는
`state.json` 만 pathspec 으로 커밋하므로, 이 verb 가 성공해도 트리는 더럽고 다음 `req:new` 는 거부한다.

**이 verb 가 남의 staged 파일을 커밋하게 만들지 않는다.** 무엇이 staged 인지 모르는 채 커밋하면
코드·비밀이 딸려 들어간다 — 이 저장소가 `git add -A` 를 금지하는 이유와 같다.

대신 **정확히 무엇이 막는지 알려 준다**:

```text
✅ 대체 결정 기록·커밋 완료 — REQ-2026-144 design:-#1

⚠️ 아직 워킹트리에 남은 변경이 있어 req:new 가 거부합니다:
     workflow/REQ-2026-144/01-design.md
     workflow/REQ-2026-144/02-plan.md
   먼저 정리하십시오(예: 파킹 커밋):
     git commit -m "chore(REQ-2026-144): 설계 파킹 — 대체 REQ 로 이어감"
   그 다음:
     npx commitgate req:new hardcap-report-successor --successor-of REQ-2026-144 --run
```

- 🔴 **남은 경로를 실제 값으로 열거한다.** "정리하십시오"만 말하면 무엇을 정리할지 모른다.
- 트리가 이미 깨끗하면 이 경고를 내지 않고 `req:new` 명령만 안내한다.
- 🔴 완료 기준을 이에 맞춰 정정한다: 이 verb 는 **자기가 만든 더러움(`state.json`)을 0 으로** 만들고,
  남의 것은 **정확히 지목**한다. "다른 조작 없이 성공"은 트리가 깨끗한 경우에만 성립한다.

## DEC-4 — 멱등

- 이미 `human-resolution` 으로 닫힌 series 에 다시 실행 → **거부**(no-op 이 아니라 명시적 거부).
  같은 결정을 두 번 기록할 이유가 없고, 조용한 no-op 은 "됐다"와 "이미 돼 있다"를 구별하지 못하게 한다.
- state 는 썼는데 checkpoint 커밋 전에 죽은 경우 → 재실행하면 series 는 이미 닫혀 있으므로 위 규칙에
  걸린다. 🔴 그래서 **커밋 여부를 append 분기에 묶지 않는다** — 상태와 무관하게 "커밋할 것이 있으면
  커밋한다"로 둔다(REQ-2026-141 `--close-stale` 에서 얻은 교훈과 같다).

## DEC-5 — 안내는 **붙여넣으면 실행되는 형태**로

REQ-2026-144 설계 리뷰가 6라운드에 걸쳐 잡아낸 것을 여기서 지킨다.

- **CommitGate 명령**은 `npx commitgate <verb> … --run` **전체 형태**. 접두가 없으면 셸이 못 찾고,
  `--run` 이 없으면 dry-run 이라 **아무 일도 일어나지 않는다**.
- 🔴 이 규칙은 **CommitGate 명령에만** 건다. DEC-3b 의 정리 안내(`git commit …`)는 CommitGate 명령이
  아니므로 형식 검사에서 제외한다 — 한 규칙으로 묶으면 그 안내 자체를 낼 수 없다(설계 r02 P1).
- 🔴 **꺾쇠 자리표시자 금지.** PowerShell 에서 `<` 는 리디렉션 토큰이라 명령이 파싱 오류로 죽는다.
  사람이 채울 자리는 **따옴표 안**(`"…"`)에만 둔다.
- REQ id·series id 는 **실제 값**을 박는다(REQ-2026-072 "적용 가능한 안내").

## Phase 분해

| phase | 범위 |
|---|---|
| `phase-1-resolve-replace` | `--resolve` 파싱·검증·`closeSeriesHumanResolution` 배선·checkpoint 커밋·안내 · 테스트 · 문서 |

한 phase 다 — 파일 2개(verb + 테스트) + 문서. 쪼개면 중간 커밋이 "반쯤 배선된" 상태로 남는다.

## 변경 파일

`scripts/req/req-review-exception.ts` · `tests/unit/req-review-exception.test.ts` ·
`docs/workflow.md`·`docs/workflow.en.md` · `CHANGELOG.md`

## 안전

- 예산 로직(`checkReviewBudget`·`budgetCounts`)은 **건드리지 않는다**. 이 REQ 는 예산을 열지 않는다.
- `closeSeriesHumanResolution`·`resolveSuccessorLineage`·`durableParentSeriesTerminal` 은 **무변경**.
  이 결함은 "로직이 없다"가 아니라 "배선이 없다"이다.
- 🔴 배선 끊김은 순수 테스트가 못 잡는다(이 저장소 4회 실증) — **실제 진입점을 두 번 연속 구동**해
  `--resolve` → `req:new --successor-of` 가 이어지는 것을 확인한다.
