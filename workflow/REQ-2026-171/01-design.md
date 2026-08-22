# REQ-2026-171 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

`stopGate` 값은 넷이고, 타입이 그것을 강제한다:

```ts
export type StopGate = 'phase' | 'req' | 'merge' | 'auto'          // config.ts:80
export const AUTO_APPROVE_OF: Record<StopGate, PhaseCommitPolicy>  // config.ts:183 — 네 키 전부
```

자율 진행 규칙은 그중 **둘만** 열거하고 `phase` 만 제외한다 → `auto` 가 미정의 상태로 남는다.

## 핵심 설계 결정

### DEC-1 — 규칙을 "**허가 목록**"이 아니라 "**제외 하나**"로 적는다

지금 문장은 두 가지를 동시에 말한다: *"`req`·`merge`일 때 자율"* + *"`phase`에서는 적용 안 함"*.
값이 넷인데 셋만 언급되니 넷째가 사각지대가 된다.

→ **`phase` 를 제외하는 형태**로 통일한다: *"`phase` 를 제외한 모든 값(`req`·`merge`·`auto`)에서 자율"*.
   값을 열거하되 **제외가 규칙이고 열거는 그 결과**임을 문장이 드러내게 한다.

🔴 열거를 아예 없애고 "phase 가 아니면"만 적지 않는다. 에이전트가 읽는 계약이라 **구체적인 값이
   보여야** 자기 설정과 대조할 수 있다. 열거는 남기되 **가드가 그것을 코드에 묶는다**(DEC-2).

### DEC-2 — 🔴 열거를 **enum 에서 파생**하고, 파생임을 **합성 fixture 로 증명**한다

고정 문자열만 검사하면 `stopGate` 값이 다섯째로 늘 때 **검사 대상이 안 늘어** 같은 결함이 재발한다.
`agent-autonomy-contract.test.ts` 는 이미 그 답을 쓰고 있다 — `CONFIG_SCHEMA` 의 `stopGate.enum` 에서
값을 뽑는 `stopGateValues()`. **같은 원천**을 쓴다(새 등록부를 만들지 않는다).

```
AUTONOMOUS = stopGateValues() 에서 'phase' 를 뺀 집합     // 규칙의 의미 그대로
```

가드는 자율 규칙 **문장에서 backtick 토큰을 뽑아** 그 집합이 `AUTONOMOUS` 와 정확히 같은지 본다.

#### 🔴 파생을 어떻게 **증명**하는가 (design-r01 P1)

애초 계획은 *"등록부에 값을 더하면 red"* 였다. **그것으로는 증명되지 않는다** — 같은 파일에 이미
`'🔴 전제 고정 — stopGate 는 네 값이다'`(`toEqual(['auto','merge','phase','req'])`) 가 있어서,
enum 을 늘리면 **그 기존 단정이 먼저 red** 가 된다. 새 가드를 실수로 고정 문자열 비교로 구현해도
변이가 red 이므로, 변이 통과가 파생의 증거가 되지 못한다.

→ 판정을 **순수 함수로 분리**하고 **기존 단정과 완전히 독립된 합성 입력**으로 검증한다:

```ts
// tests/helpers/autonomy-enumeration.ts (신규 — 공유 테스트 헬퍼)
export function autonomyEnumerationProblem(
  contractText: string,
  allStopGates: readonly string[],
): string | null
```

| 테스트 | 입력 | 기대 |
|---|---|---|
| 실물 | 실제 `AGENTS.template.md` + 실제 `stopGateValues()` | `null` |
| **파생 증명** | **합성 계약 문장** + `[...실제값, 'newgate']` | **problem** — `newgate` 가 열거에 없다 |

합성 케이스는 실제 템플릿도 실제 enum 도 건드리지 않으므로 `'네 값이다'` 단정이 **대신 실패해 줄 수
없다.** 고정 문자열 구현이면 이 케이스가 통과해 버리므로 red 로 잡힌다.

🔴 **`md.includes('auto')` 로 검사하지 않는다** — `auto` 는 문서 도처에 나오므로 그 검사는 항상 통과한다.
   그 **문장 안의 열거**만 본다. 이 파일이 같은 함정을 이미 기록해 두었다(*"가드의 적용 범위가 검사
   대상보다 넓으면 무관한 등장이 오라클을 대신 만족시킨다"*) — 문장 경계를 좁게 잡는다.

🔴 판정 함수를 **테스트 파일 안에** 두지 않는다. 그러면 그것을 단정하는 테스트가 자기 자신을 검사하는
   꼴이 된다(REQ-2026-158 교훈). `tests/helpers/` 에 두어 두 테스트가 **같은 함수**를 서로 다른 입력으로 태운다.

### DEC-3 — 같은 주장의 **복제본을 전부** 고친다

이 저장소가 반복해서 데인 것: *"새 절 추가 ≠ 갱신 — 안전속성 바꾸면 전수 grep"*.
한 곳만 고치면 나머지가 옛말로 남고, 에이전트는 그중 아무거나 읽는다.

| 파일 | 무엇 |
|---|---|
| `AGENTS.template.md` | 자율 진행 규칙(계약 정본) |
| `docs/workflow.md` · `docs/workflow.en.md` | 같은 규칙 |
| `docs/workflow.md` · `docs/workflow.en.md` | 예산 축 안내(`auto` 사용자도 대상이다) |
| `scripts/req/req-next.ts` | 주석이 코드와 어긋남(코드는 이미 `auto` 포함) |

🔴 **가드는 계약 정본(`AGENTS.template.md`)에만 건다.** 문서 3곳까지 같은 파서로 묶으면 표현이 조금만
   달라도 red 가 되어(영어 문서는 문장 구조가 다르다) 가드가 잔소리가 된다. 대신 문서 쪽은
   **`req`·`merge` 만 열거한 자율 문장이 남아 있지 않은지**를 전수로 본다(부재 검사).

### DEC-4 — **동작 코드**는 바꾸지 않는다

`softLimitUpgradeHint`(`req-next.ts:1017`)는 이미 `defersToIntegration` 으로 `auto` 를 포함한다.
바꾸는 것은 **그 위의 주석**뿐이다. 동작 변경 0.

🔴 이 REQ 는 **계약 문서 결함**이다. 동작 코드에 손대기 시작하면 "문서를 고쳤다"와 "동작을 바꿨다"가
   한 diff 에 섞여 리뷰가 둘을 분리할 수 없다.

가드용 순수 판별기(`tests/helpers/`)는 **테스트 자산**이라 이 원칙과 충돌하지 않는다 —
`scripts/`·`bin/` 의 동작 표면은 주석 한 줄 외에 바뀌지 않는다.

## Phase별 구현

### phase-1 — 계약·문서 정합 + 파생 가드 (`phase-1-auto-parity`)

- `AGENTS.template.md` — 자율 규칙을 DEC-1 형태로.
- `docs/workflow.md` · `docs/workflow.en.md` — 자율 규칙 2곳 + 예산 축 안내 2곳.
- `scripts/req/req-next.ts` — 주석만.
- `tests/unit/agent-autonomy-contract.test.ts` — **추가만**:
  - 자율 문장의 열거 = `Object.keys(AUTO_APPROVE_OF) \ {phase}`(DEC-2)
  - `phase` 가 제외로 적혀 있다
  - 🔴 문서 전수: 자율 규칙 문장이 있는 파일에 `req`·`merge` **만** 열거한 형태가 남아 있지 않다

Exit: typecheck 0 · `agent-autonomy-contract`·`quickstart`·`req-next`·`docs-truth` 계열 green ·
  **변이 검사**(문장에서 `auto` 를 지우면 red · `AUTO_APPROVE_OF` 에 값을 더하면 red) · Codex phase 리뷰 승인.

## 변경 파일

| 파일 | 성격 |
|---|---|
| `AGENTS.template.md` | 계약 문장 |
| `docs/workflow.md` · `docs/workflow.en.md` | 같은 주장의 복제본 |
| `scripts/req/req-next.ts` | 주석만(동작 변경 0) |
| `tests/unit/agent-autonomy-contract.test.ts` | 가드 **추가만**(기존 단정 무수정) |
| `tests/helpers/autonomy-enumeration.ts` | **신규** — 순수 판별기(실물·합성 두 테스트가 공유) |

## 하위호환·안전

- **게이트가 약해지지 않는다.** 이 문장은 *"통제점이 **아닌** 판단"* 에만 적용된다. 통제점표(I1/I2/B1·
  R1/R2/R3)·HIGH 확인·destructive·`AWAIT_HUMAN` 은 예외표에 그대로 있고 이 REQ 가 건드리지 않는다.
- **`auto` 사용자에게만 달라진다.** `phase`·`req`·`merge` 를 고른 사용자의 문장은 의미가 같다.
- **설치본 전파**: 소비자는 `npx commitgate quickstart --apply` 로 관리 블록을 동기화한다.
  이 REQ 는 그 경로를 바꾸지 않는다(기존 블록 마커 그대로).
