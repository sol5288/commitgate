# REQ-2026-175 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

`req-commit.ts` (source 커밋 **전**):

```ts
const reentry = terminalReentryProblem(String(state.id ?? ''), baseState, dirtyGitignores, narrowing)
if (reentry) throw new Error(reentry)     // baseState = scanTicketIntake(...).baseState
```

`req-next.ts` — 살아 있는 phase 승인이 있으면 `req:commit` 을 지시한다(네 갈래):

| 조건 | kind | 명령 |
|---|---|---|
| LOW + 자동 커밋 | `RUN` | `req:commit --run -m …` |
| staged 없음(부분 커밋 의심) | `AWAIT_HUMAN` | `req:commit --finalize --run` |
| HIGH + 확인 필요 | `AWAIT_HUMAN` | `req:confirm …` |
| 그 외 | `AWAIT_HUMAN` | `req:commit --run` |

**넷 다 종결 여부를 보지 않는다.** `req:next` 의 입력에 HEAD 종결 증거가 없기 때문이다.

## 핵심 설계 결정

### DEC-1 — 🔴 **같은 생성기**를 쓴다(문구를 새로 쓰지 않는다)

`terminalReentryProblem` 은 이미 순수 함수이고 `req:commit` 의 거부 문구 정본이다.
`req:next` 가 **그 함수를 그대로 호출**해 안내를 만든다.

🔴 문구를 새로 쓰면 다시 갈라진다 — 그리고 이번엔 *"안내는 A 를 하라는데 거부는 B 를 하라고 한다"* 가 된다.
   REQ-2026-072 가 같은 결론에 도달했다: **두 곳이 각자 문구를 만들면 한쪽이 권한 명령을 다른 쪽이 거부한다.**

### DEC-2 — 🔴 공급자는 **완성된 판정**을 준다(`baseState` 만으로는 부족하다)

design-r01 P1: `terminalReentryProblem` 은 `baseState` 외에 **`dirtyGitignores`·`narrowing`** 도 받고,
그 값이 **안내의 실행 가능성을 바꾼다**:

| 상태 | `req:commit` 이 내는 안내 |
|---|---|
| 미커밋 `.gitignore` 없음 | `stash → req:new → pop` 명령열 |
| 미커밋 `.gitignore` 있음(안전) | `.gitignore` 를 **먼저 커밋**하는 줄이 앞에 붙는다 |
| **범위를 좁힐 수 있음**(`narrowing`) | 🔴 **명령열을 내지 않는다** — 사람이 직접 정해야 한다 |

`baseState` 만 넘기면 세 번째 경우에 `req:next` 가 *"stash 하고 진행하라"* 고 **거짓 안내**를 한다 —
stash 가 ignore 규칙을 되돌려 숨어 있던 파일이 드러나고 `req:new` 가 clean-tree 로 거부한다.
그것이 정확히 이 REQ 가 없애려는 결함이다.

→ 공급자는 **완성된 문구**를 준다:

```ts
/** 종결 재진입 안내. `null` = 종결이 아니거나 판정 불가. */
terminalReentry?: () => string | null
```

🔴 **판정과 입력 획득을 통째로 공유한다.** 그 계산(`scanTicketIntake` → dirtyGitignores → narrowing →
   `terminalReentryProblem`)을 **lib 으로 내려** `req:commit` 과 `req:next` 가 **같은 함수**를 부른다.
   REQ-2026-094 의 결론 그대로다: *"술어뿐 아니라 **입력 획득까지** 맞춰야 한다."*

#### 지연 호출은 그대로다
`scanTicketIntake` + `git status` + `.gitignore` 읽기라 값싼 명령에 항상 지울 비용이 아니다.
**`req:commit` 계열 명령을 낼 자리에서만** 호출한다(REQ-2026-172·173 과 같은 패턴).

### DEC-3 — 🔴 **판정 불가는 종전 동작**이다(여기는 차단 지점이 아니다)

`terminalBaseState` 가 `undefined`(주입 안 됨) 또는 `null`(읽기 실패)이면 **지금 그대로** 안내한다.

🔴 통합·커밋 게이트에서는 *"모르면 막는다"* 가 옳지만, 여기는 **안내**다. 모른다고 막으면
   정상 흐름이 죽고, 진짜 게이트(`req:commit` 의 `terminalReentryProblem`)는 그대로 있다.
   이 축이 하는 일은 **차단이 아니라 거짓 안내를 없애는 것**이다.

### DEC-4 — 종결이면 `BLOCKED` 다

| kind | 이유 |
|---|---|
| `RUN`/`AGENT` | ❌ 계약상 "묻지 말고 실행" — 실행하면 막힌다 |
| `AWAIT_HUMAN` | ❌ 승인 문장을 받아도 그 명령은 실패한다 |
| **`BLOCKED`** | ✅ *"사람이 판단해야 한다"* — 정확히 이 상황이고 exit 2 로 루프를 끊는다 |

`terminalReentryProblem` 이 이미 **다음 단계 명령열**(stash → `req:new` → pop)을 담고 있으므로,
그것을 `detail` 로 그대로 낸다.

### DEC-5 — 네 갈래를 **한 곳에서** 가로막는다

갈래마다 검사를 넣으면 다섯 번째 갈래가 생길 때 빠진다. 살아 있는 승인 블록 **진입 지점**에서
한 번만 검사한다.

🔴 `req:confirm` 갈래도 막는다 — 그 확인을 받아도 그 다음이 `req:commit` 이라 어차피 막힌다.
   확인만 받고 막히면 **사람의 승인이 낭비**된다.

## Phase별 구현

### phase-1 — 안내 정합 (`phase-1-parity`)

- `lib/terminal-reentry.ts`(**신규**): `terminalReentryProblem`(이관) + `computeTerminalReentry(ports)`
  — `scanTicketIntake` → dirtyGitignores → narrowing → 문구까지 **한 함수**.
  `req-commit.ts` 는 그 함수를 호출하고 기존 export 는 re-export 로 유지.
- `req-next.ts`: `NextInput.terminalReentry?` 추가 · 살아 있는 승인 블록 진입에서 검사 ·
  `main()` 에서 지연 공급자 배선.
- 테스트:
  - 종결 3상태(`dev-complete`·`migrated-complete`·`abandoned`)에서 `BLOCKED` + `req:commit` 미지시
  - 🔴 `series-terminal` 은 **막지 않는다**(그 상태는 `req:commit` 도 막지 않는다 — 대체 REQ 흐름)
  - 🔴 판정 불가(`undefined`·`null`)면 **종전 동작**(무회귀)
  - 🔴 안내 문구가 `req:commit` 거부 문구와 **문자열 동일**(같은 생성기·같은 입력 증명)
  - 🔴 **`narrowing` 변형**: 범위를 좁힐 수 있는 미커밋 `.gitignore` 가 있으면 `req:next` 도
    **명령열을 내지 않는다**(실행 불가 안내 금지 — design-r01 P1)
  - 🔴 **안전한 미커밋 `.gitignore` 변형**: 그 경우의 문구도 `req:commit` 과 동일
  - 🔴 **호출부**: `main()` 이 공급자를 배선한다 · 종결이 아닌 경로에서는 **호출되지 않는다**(지연)

Exit: typecheck 0 · 위 green ·
  🔴 **변이 4종**: ① 검사 제거 → red ② `series-terminal` 도 막게 → red
  ③ 문구를 손으로 쓴 것으로 교체 → 같은-생성기 테스트 red ④ 배선 제거 → 호출부 테스트 red ·
  **커밋 전 전체 스위트 1회**(단일 phase) · Codex phase 리뷰 승인.

## 변경 파일

| 파일 | 성격 |
|---|---|
| `scripts/req/lib/terminal-reentry.ts` | **신규** — 판정 + 입력 획득을 한 곳에 |
| `scripts/req/req-commit.ts` | 그 함수 호출로 교체(동작 동일) · re-export |
| `scripts/req/req-next.ts` | 입력 1개 · 검사 1곳 · 배선 1줄 |
| `tests/unit/next-terminal-parity.test.ts` | **신규** |

## 하위호환·안전

- **게이트는 그대로다.** `req:commit` 의 `terminalReentryProblem` 은 한 줄도 바뀌지 않는다.
  이 REQ 는 **안내가 거짓말을 하지 않게** 할 뿐이다.
- **종결이 아닌 티켓은 불변** — 검사가 `null` 을 반환하면 기존 코드 경로가 그대로 흐른다.
- 🔴 **새로 막히는 것이 없다**: 지금도 그 명령은 실패한다. 달라지는 것은 **실패를 미리 말해 준다**는 것이다.
