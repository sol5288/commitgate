# REQ-2026-134 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

두 축이 **서로 다른 원천**에서 온다.

| 축 | 소유 함수 | 원천 | 동결됨? |
|---|---|---|---|
| `stopGate` | `effectiveStopGate(state, cfg)` | 스냅샷 → config 폴백 | ✅ (REQ-2026-129) |
| `phaseCommit.autoApprove` | 없음 — 호출부가 `cfg.phaseCommit.autoApprove`를 직접 읽음 | config | ❌ |

`req-next.ts` main:

```ts
stopGate: stopGateNow,                                 // 스냅샷
phaseCommitAutoApprove: cfg.phaseCommit.autoApprove,   // config ← 여기가 갈라진 지점
```

`resolveNext`는 두 값을 **각각** 본다: 자동 커밋은 `phaseCommitAutoApprove`, 정지 지점은 `stopGate`.
그래서 둘이 갈라지면 판정이 모순된다.

`config.ts`에는 이미 파생 표가 있다:

```ts
export const AUTO_APPROVE_OF: Record<StopGate, PhaseCommitPolicy> = { phase: 'never', req: 'low-only', merge: 'low-only' }
```

## 핵심 설계 결정

### DEC-1 — 정책은 **객체 하나**로 해소한다

```ts
// lib/config.ts
export interface ExecutionPolicy {
  stopGate: StopGate
  phaseCommitAutoApprove: PhaseCommitPolicy
}

export function effectiveExecutionPolicy(
  state: { policy_snapshot?: unknown } | null | undefined,
  cfg: { stopGate: StopGate; phaseCommit: PhaseCommit },
): ExecutionPolicy
```

- **스냅샷이 있으면**: `stopGate = snapshot.stop_gate`, `phaseCommitAutoApprove = AUTO_APPROVE_OF[그 값]`.
- **없거나 손상이면**(legacy): `stopGate = cfg.stopGate`, `phaseCommitAutoApprove = cfg.phaseCommit.autoApprove`.

🔴 **legacy에서 `cfg.phaseCommit.autoApprove`를 그대로 쓰는 이유**: config의 두 축은 `loadConfig`가 이미
정합을 보장한다(`resolveStopAxes` — 모순이면 로드가 실패한다). 그러니 legacy 경로에서 파생으로 덮어쓰면
**같은 값을 다시 계산할 뿐**이고, 만약 다르다면 그건 로드가 이미 막았어야 할 상태다. 현행 값을 그대로
쓰는 쪽이 무회귀이며 "이 REQ는 legacy 동작을 바꾸지 않는다"를 코드로 보인다.

🔴 **스냅샷 경로에서 파생을 쓰는 이유**: 스냅샷은 `stop_gate` **하나만** 담는다(REQ-2026-129 DEC-1 —
"정지 축 하나만"). 그러니 파생 축은 **계산되어야** 하고, 계산 규칙은 `AUTO_APPROVE_OF` 하나다.
스냅샷에 두 값을 넣는 대안은 **두 축이 저장 시점에 갈라질 수 있는 자리**를 새로 만드는 것이라 택하지 않는다.

### DEC-2 — `effectiveStopGate`는 **남기고**, 이 함수의 부분으로 정의한다

`effectiveStopGate`는 이미 네 소비자(`req:commit`·`req:confirm`·`req:doctor`·`bin/delivery`)가 쓴다.
그들에게 필요한 것은 `stopGate` 하나뿐이므로 시그니처를 바꾸지 않는다.

```ts
export function effectiveStopGate(state, cfg): StopGate   // 유지 — 내부적으로 같은 해소 규칙
```

🔴 **두 함수가 갈라지지 않게** `effectiveExecutionPolicy`가 `effectiveStopGate`를 호출해 구성한다
(반대 방향이 아니다 — 정책 객체가 상위, 단일 값이 하위).

### DEC-3 — `req:next`가 **config 축을 읽는 경로를 없앤다**

```ts
const policy = effectiveExecutionPolicy(state, cfg)
…
stopGate: policy.stopGate,
phaseCommitAutoApprove: policy.phaseCommitAutoApprove,
deliveryGate: policy.stopGate === 'merge' ? … : null,
completesReq: policy.stopGate === 'req' && … ,
```

🔴 **회귀 가드는 "읽지 않는다"를 검사한다.** 값 비교만으로는 부족하다 — 두 축이 우연히 같은 설정에서는
직접 읽어도 테스트가 통과한다. `req-next.ts` 소스에 `cfg.phaseCommit` 참조가 **0건**임을 고정한다
(이 저장소가 배선 끊김을 잡을 때 쓴 소스 검사와 같은 수단).

### DEC-4 — 교차 설정 재현을 **순수 + 실 git 양쪽**에서 고정한다

| # | 스냅샷 | config | 상태 | 기대 |
|---|---|---|---|---|
| 1 | `merge` | `phase` | LOW · staged · `commit_allowed` | **`RUN`**(자동 커밋) |
| 2 | `phase` | `merge` | 같음 | **`AWAIT_HUMAN`** |
| 3 | 없음(legacy) | `phase` | 같음 | `AWAIT_HUMAN`(config 추종) |
| 4 | 없음(legacy) | `merge` | 같음 | `RUN`(config 추종) |

🔴 3·4가 함께 있어야 "legacy가 **config 변경을 따른다**"가 증명된다 — 한쪽만 두면 상수를 고정한 것과 구별되지 않는다.

🔴 **`req:next` main 배선 테스트**(실 git)를 포함한다. `resolveNext` 순수 테스트만으로는 이 REQ가 고치는
결함(**main이 입력을 잘못 만드는 것**)을 잡을 수 없다 — 순수 함수는 이미 옳게 동작하고 있었다.

### DEC-5 — HIGH·종단 계약은 **건드리지 않는다**

`gateBlocksHere`(HIGH 정지 지점)와 `terminalIntegrationAction`은 `stopGate`만 본다. 이 REQ는 그 값의
**출처**만 바꾸므로 계약이 그대로다. 무회귀를 기존 테스트가 지킨다.

## Phase별 구현

- **phase-1**: `effectiveExecutionPolicy` 신설 + `req:next` 배선 + 순수/소스 회귀.
- **phase-2**: `req:next` main 배선 테스트(실 git) — 교차 설정 4종.
- **phase-3**: 문서(`docs/configuration*.md` 정책 스냅샷 절) + `CHANGELOG.md`.

## 변경 파일

| phase | 파일 |
|---|---|
| 1 | `scripts/req/lib/config.ts` · `scripts/req/req-next.ts` · `tests/unit/policy-snapshot.test.ts` |
| 2 | `tests/unit/policy-snapshot.test.ts`(실 git 그룹 추가) |
| 3 | `docs/configuration.md`/`.en` · `CHANGELOG.md` |

## 하위호환·안전

- 스냅샷 없는 티켓: **완전 무변경**(두 축 모두 config).
- 스냅샷 있는 티켓: `phaseCommitAutoApprove`가 이제 스냅샷에서 파생된다 — 이것이 이 REQ의 목적이다.
  기존 티켓 중 스냅샷과 config가 **같은** 경우(대다수)는 값이 동일해 관측 변화가 없다.
- config 두 축 모순 검사·`req:repolicy`·D32는 그대로.
