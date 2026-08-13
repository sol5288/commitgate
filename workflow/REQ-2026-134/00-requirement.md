# REQ-2026-134 요구사항

## 무엇

정지 정책을 **단일 resolver**가 소유한다. `effectiveStopGate`가 스냅샷을 보는데 `phaseCommit.autoApprove`는
여전히 config에서 직접 읽히는 **반쪽 동결**을 없앤다.

```ts
effectiveExecutionPolicy(state, cfg) → { stopGate, phaseCommitAutoApprove }
```

모든 소비자는 이 하나만 쓴다. `req:next`가 `cfg.phaseCommit.autoApprove`를 **직접 읽지 못하게** 한다.

## 왜 (실측 결함)

REQ-2026-129가 `stopGate`를 티켓에 동결했지만 **파생 축은 동결하지 않았다.**

```ts
// req-next.ts main()
stopGate: stopGateNow,                          // ← 스냅샷 기준(REQ-129)
phaseCommitAutoApprove: cfg.phaseCommit.autoApprove,  // ← config 기준(동결 안 됨)
```

`resolveNext`의 자동 커밋 판정은 **`phaseCommitAutoApprove`를 본다**:

```ts
const autoCommit = input.phaseCommitAutoApprove === 'low-only' && riskKnown && !gateBlocksHere && input.hasStagedChanges
```

그래서 **snapshot=`merge` · config=`phase`** 인 티켓은:

| 판정 | 근거 | 결과 |
|---|---|---|
| `req:commit`의 `userConfirmGate` | 스냅샷(`merge`) | 커밋을 **막지 않음** |
| `req:next`의 자동 커밋 | config(`phase` → `never`) | **`AWAIT_HUMAN`** |

→ 한 티켓이 **두 정책으로 판정**된다. 게이트는 통과시키는데 안내는 멈추라고 한다.
사용자 목표("`merge` 티켓은 설정 변경과 무관하게 모든 LOW phase를 순차 자동 진행")가 **정상 경로에서 깨진다.**

REQ-2026-129의 설계는 "소비자 다섯이 같은 값을 쓴다"를 요구했고 리뷰도 그것을 P1으로 짚었는데,
**축이 둘(`stopGate`·`phaseCommit`)이라는 사실**이 그 계산에서 빠졌다.

## 제약

- 🔴 **legacy 호환 유지.** 스냅샷이 없는 티켓은 현행대로 config를 따른다(양쪽 축 모두).
- 🔴 **파생 규칙을 새로 만들지 않는다.** `AUTO_APPROVE_OF`(REQ-2026-063이 정한 번역표)가 그대로 SSOT다.
- 🔴 **HIGH 계약 불변.** `req`·`merge`의 HIGH 확인 지점과 종단 통합 동작은 그대로다.
- 🔴 config의 두 축 모순 검사(`resolveStopAxes`)는 **config 로드 단계**의 일이고 이 REQ가 바꾸지 않는다.

## 완료 기준

- `effectiveExecutionPolicy(state, cfg)`가 `{ stopGate, phaseCommitAutoApprove }`를 함께 낸다.
- `req:next` main이 `cfg.phaseCommit.autoApprove`를 **읽지 않는다**(정적으로 확인 가능한 형태).
- 교차 설정 재현 2종이 통과한다:
  - snapshot=`merge` · config=`phase` · LOW + staged + 승인 → **`RUN`**(자동 커밋)
  - snapshot=`phase` · config=`merge` · 같은 상태 → **`AWAIT_HUMAN`**
- 스냅샷 없는 legacy 티켓은 config 변경을 **계속 따른다**.
- HIGH + `req`/`merge` 종단 계약 무회귀.
- **순수 함수 테스트뿐 아니라 `req:next` main 배선 테스트**를 포함한다(실 git).
