# REQ-2026-129 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

`stopGate`는 **명령 실행 시점의 config**에서 매번 읽힌다. 소비자:

| 소비자 | 읽는 곳 |
|---|---|
| `req:next` | `input.stopGate = cfg.stopGate` · `deliveryGate` 조회 조건 |
| `req:commit` | `userConfirmGate(state, cfg.stopGate, …)` (3곳) |
| `req:doctor` | D28 HIGH 확인 판정 |
| `req:confirm` | `requiredConfirmScope(cfg.stopGate, …)` |
| `bin/delivery` | `ctx.stopGate` (integrate 자격검사) |

`state.json`에는 정지 정책의 흔적이 없다. `loadConfig`는 `resolveStopAxes`로 `stopGate`·`phaseCommit`을
해소하므로(REQ-2026-063), **해소 결과**가 스냅샷 대상이다(원시 config가 아니다).

## 핵심 설계 결정

### DEC-1 — 스냅샷은 `req:new`가 심고, 담는 것은 **정지 축 하나**다

```jsonc
"policy_snapshot": { "stop_gate": "merge" }
```

- 값은 `loadConfig`의 **해소값**이다 — legacy `phaseCommit`만 있는 config도 `req`로 역파생된 값이 들어간다.
- 🔴 **객체로 둔다**(평평한 `stop_gate` 필드가 아니라). 나중에 다른 정책 축을 담을 자리를 이름 하나로
  확보해 두는 편이, 축마다 최상위 필드를 늘리는 것보다 state 스키마를 덜 어지럽힌다.
- 🔴 리뷰 예산·granularity 등은 **담지 않는다.** 이 REQ가 해결하려는 것은 "정지 지점이 티켓 중간에
  바뀐다"이고, 다른 축까지 얼리면 그 축의 정당한 조정까지 막는다. 범위를 넘기지 않는다.

### DEC-2 — 해소는 함수 하나(`effectiveStopGate`)

```ts
// lib/config.ts
export function effectiveStopGate(state: { policy_snapshot?: { stop_gate?: unknown } } | null, cfg: { stopGate: StopGate }): StopGate
```

- 스냅샷 값이 **유효한 enum**이면 그것, 아니면 `cfg.stopGate`.
- 🔴 **손상값은 조용히 쓰지 않는다.** `stop_gate: "all"` 같은 값은 무시하고 config로 떨어진다 —
  잘못된 값으로 게이트를 판정하느니 현행 동작이 낫다. 손상 사실은 doctor가 별도로 말한다(DEC-4).
- 소비자 다섯이 전부 이 함수를 쓴다. 각자 `state.policy_snapshot?.stop_gate ?? cfg.stopGate`를 적으면
  손상 처리·legacy 처리가 곧 갈라진다(REQ-2026-128에서 같은 이유로 표를 함수로 올렸다).

### DEC-3 — legacy(스냅샷 부재)는 **config를 본다**

필드가 없으면 현행과 100% 동일하게 동작한다. 🔴 자동으로 심지 않는다 — 이미 진행 중인 티켓에
"이 정책으로 진행했다"고 적는 것은 **사실이 아닌 기록**이고, 그것이 REQ-2026-019가 폐기된 종류의 오염이다.

### DEC-4 — 드리프트는 **WARN**이고, 채택 경로가 함께 착륙한다

`req:doctor`에 새 체크를 추가한다: 스냅샷이 있고 `cfg.stopGate`와 다르면 WARN + 채택 명령 안내.
손상 스냅샷도 같은 체크가 말한다(어떤 값이 실제로 쓰이는지 알려 준다).

🔴 **FAIL이 아니다.** 정책을 바꾼 것은 정당한 행위이고, 여기서 막으면 진행 중 티켓이 전부 교착한다.
게이트가 스냅샷을 쓰므로 **판정은 이미 일관**하다 — 사용자에게 필요한 것은 차단이 아니라 **가시성**이다.

채택 명령:

```sh
npx commitgate req:repolicy <REQ> [--run]
```

- 현재 config 해소값을 스냅샷에 쓰고, `policy_snapshot.adopted`에 append-only 기록을 남긴다
  (`from`·`to`·`at`(실제 시계)·`reason`). 🔴 시각은 **주입된 실제 시계**에서 읽는다.
- 🔴 **게이트 우회가 아니다.** 바꾸는 것은 "어디서 멈추는가"뿐이고, 이미 받은 확인은 그대로 남는다.
  좁은 정책으로 바꾸면 남은 지점에서 더 자주 멈추고, 넓은 정책으로 바꾸면 종단에서 그 범위의
  확인을 새로 요구받는다(scope 정확일치 규칙이 그대로 적용된다).
- DRY-RUN 기본 — `--run` 없이는 무엇이 바뀌는지 출력만 한다.

### DEC-5 — 확인 scope 규칙과의 상호작용

`req:confirm`은 `requiredConfirmScope(effectiveStopGate(state, cfg), { inDeliverySet })`를 쓴다.
즉 **기록 시점의 스냅샷**이 요구 scope를 정하고, 게이트도 같은 값을 쓰므로 안내↔도구가 갈라지지 않는다
(REQ-2026-128에서 닫은 갭을 스냅샷 축에서도 닫는다).

## Phase별 구현

- **phase-1**: `WorkflowState`에 `policy_snapshot` 타입 추가 · `effectiveStopGate` 신설 ·
  `req:new`가 스냅샷 기록 · **소비자 다섯을 한 phase에서 전부** 배선(`req:doctor`의 기존 D28 판정 포함 —
  일부만 전환하면 같은 티켓을 두 정책으로 판정하는 상태가 릴리스에 남는다).
  동작 변화는 "스냅샷이 있으면 그것을 쓴다"뿐.
- **phase-2**: `req:repolicy` verb(파싱·DRY-RUN·기록·checkpoint 커밋) + dispatch/Stage B 배선.
- **phase-3**: `req:doctor` 드리프트 체크(WARN) + 문서(`docs/configuration*.md`·`docs/workflow*.md`·
  `CHANGELOG.md`).

## 변경 파일

| phase | 파일 |
|---|---|
| 1 | `scripts/req/lib/config.ts` · `scripts/req/review-codex.ts`(state 타입) · `scripts/req/req-new.ts` · `req-next.ts` · `req-commit.ts` · `req-confirm.ts` · `req-doctor.ts`(기존 D28 전환) · `bin/delivery.ts` · `tests/unit/*` |
| 2 | `scripts/req/req-repolicy.ts`(신규) · `bin/dispatch.mjs` · `bin/init.ts` · `tests/unit/*` |
| 3 | `scripts/req/req-doctor.ts` · `docs/*.md` · `CHANGELOG.md` · `tests/unit/*` |

## 하위호환·안전

- 스냅샷 없는 기존 티켓: **무변경**(config 경로 그대로).
- 새 티켓: config를 바꿔도 판정이 고정된다 — 이것이 목적이다.
- 스키마: `policy_snapshot`은 **선택 필드**다. `loadState`는 `JSON.parse` + 타입 캐스트일 뿐
  **AJV 검증을 하지 않으며**(`machine.schema.json`은 리뷰 **응답** 스키마다), 따라서 필드 추가로
  기존 티켓이 로드 실패할 경로가 없다 — 실측 확인함.
- 강제력의 한계: 스냅샷은 **협력적 worker 전제** 위에 있다. `state.json`을 손으로 고치면 바뀐다 —
  이 저장소의 다른 모든 state 필드와 같은 수준의 보증이며, 그 이상을 주장하지 않는다.
