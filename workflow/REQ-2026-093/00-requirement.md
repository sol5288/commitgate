# REQ-2026-093 요구사항

부분 완료 티켓의 명시적 포기 경로 — 저장소 전체 교착 탈출구

## 배경

소비자 버그 리포트(2026-08-01, `0.15.0`)의 **결함 5**다. REQ-2026-092가 결함 1(예방)을 닫았지만,
예방은 **이미 막힌 사람을 구제하지 못한다.** 그리고 예방이 완벽해도 다른 경로로 티켓이 미완결 상태에
머물 수 있다 — 그때마다 저장소 전체가 멈춘다면 도구가 사용자를 인질로 잡는 셈이다.

```
🔴 미종결 durable 티켓이 있어 새 REQ를 만들 수 없습니다(HEAD 커밋 증거 기준):
  - REQ-2026-004: developing — 미종결 durable 티켓
```

`req:new`의 intake 게이트는 `deriveBaseState`가 `developing`을 내는 한 **모든 후속 작업**을 막는다.
그 상태에서 빠져나오는 길은 현재 **완료뿐**이다. 완료할 수 없는 티켓(설계가 틀렸다, 요구가 사라졌다,
증거가 복구 불가다)에는 **출구가 없다.**

## 1. 실측 — 출구가 "없다"는 것의 정확한 의미

### 1.1 종결 이벤트 3종 중 사람이 쓸 수 있는 것이 없다

`lib/close-proof.ts`의 `CloseProofEvent`는 `series-terminal` · `dev-complete` · `migrated-complete`다.

| 이벤트 | 누가 발행하나 | 포기에 쓸 수 있나 |
|---|---|---|
| `dev-complete` | `req:commit` evidence-finalize가 **모든 phase 완료 시** 자동 | ❌ 완료해야 나온다 |
| `migrated-complete` | `req:close --migrate` | ❌ `missingPlanned` 검사가 **부분 완료 티켓을 명시적으로 거부**(`close-migrate.ts`) |
| `series-terminal` | `req:new --successor-of`(replace 경로) | ❌ 아래 1.2 참조 |

### 1.2 🔴 `human-resolution` 기계장치 전체가 **배선되지 않았다**

`series-terminal`은 사람 결정(`replace`·`terminate`)을 담도록 **설계돼 있고 구현도 돼 있다**:
`closeSeriesHumanResolution()`(순수) · `isValidHumanResolution()` · `isSeriesKeyTerminal()` ·
`commitSeriesTerminalCloseProofs()` · `req:reconstruct`의 series-terminal 복원까지.

그런데 **`human_resolution`을 기록하는 CLI가 하나도 없다**(전수 확인: `scripts/`·`bin/` 어디에도
`closeSeriesHumanResolution` 호출부 없음). 즉 그 값을 넣는 유일한 방법은 **`state.json` 손편집**이다.

- 이것은 REQ-2026-019가 폐기된 것과 **같은 표면**이다 — 사람이 시각·결정을 적어 넣으면 **지어낼 수 있다**.
- `req:new --successor-of`(replace)조차 부모에 그 값이 **이미 있다고 전제**하므로, 정상 경로로는
  도달할 수 없다.

즉 "사람이 티켓을 종결한다"는 능력은 **데이터 모델에는 있고 명령에는 없다.** 죽은 기능이다.

### 1.3 그리고 series 기반 종결은 이 문제를 덮을 수 없다

설령 배선하더라도 부족하다. `closeSeriesHumanResolution`은 **열린 series**(`closed_reason === null`)를
요구하는데, 교착 티켓의 전형적 모습은 그 반대다.

- 소비자 사례: 모든 리뷰가 **승인으로 닫힌**(`approved`) 상태에서 커밋만 불가 → 열린 series 없음 → throw.
- 리뷰를 한 번도 안 한 티켓: `review_series`가 아예 비어 있음 → throw.

`series-terminal` 행은 `series_id`로 키잉되므로 **series가 없으면 만들 수 없다.** 포기는
series 단위 사건이 아니라 **티켓 단위 사건**이다.

## 2. 요구사항

- **R1 (탈출구·필수)** 사람이 **어떤 상태의 durable 티켓이든** 명시적으로 포기해 종결할 수 있어야 한다.
  리뷰 이력이 없어도, 모든 series가 닫혀 있어도, 일부 phase만 커밋돼 있어도 동작해야 한다.
- **R2 (intake 해제)** 포기된 티켓은 `req:new`를 더 이상 막지 않아야 한다. 판정은 **HEAD 커밋 증거**로만
  이뤄져야 한다(워킹 state 금지 — 기존 계약).
- **R3 (날조 불가)** 결정 시각은 **도구가 실제 시계에서** 찍는다. 사람이 적어 넣는 표면을 만들지 않는다.
  사유와 승인 문장은 **필수**이며 비어 있을 수 없다.
- **R4 (증거 불변)** 포기는 **"더 진행하지 않는다"는 선언**이지 증거 무효화가 아니다. 이미 커밋된 phase
  증거·설계 승인·원장은 하나도 바뀌지 않는다. 히스토리에 그대로 남는다.
- **R5 (오용 저지)** 포기가 리뷰 회피 우회로가 되면 안 된다. 명시적 확인 문장을 요구하고, 결정은
  **커밋된 감사 행**으로 남아 사후에 누구나 볼 수 있어야 한다. 기본은 dry-run이다.
- **R6 (멱등)** 이미 종결된 티켓에 실행하면 **성공 no-op**이어야 한다(중복 행 없음).
- **R7 (무회귀)** 기존 3종 이벤트의 판정·우선순위·자연키는 바뀌지 않는다.

## 3. 범위 밖(별도 REQ)

- **`human-resolution` 배선**(1.2). 이것도 진짜 갭이지만 **replace lineage**(successor REQ)라는 다른
  기능에 걸려 있어 설계 면이 다르다. 본 REQ는 **티켓 단위 포기**만 다룬다. 다만 R1을 만족하는 순간
  "손편집 없이 종결할 수 있다"는 실질은 확보된다.
- 승인 행 복원 명령(결함 3) · `req:doctor` 가시성(결함 4) · 승인 시점 tree 보존(결함 2).
- 🔴 **신규 발견**: `req:confirm`이 `state.json`을 인덱스에 add·커밋해 `git write-tree`를 바꾸므로
  **자기 승인을 D9 stale로 만든다**(HIGH 티켓 마지막 phase에서 유료 재리뷰 1회 강제). REQ-2026-092
  진행 중 실측했다. 별도 REQ.

## 4. 완료 기준

- 리뷰 이력이 없는 티켓 · 모든 series가 닫힌 티켓 · 일부 phase만 커밋된 티켓 **셋 다** 포기로 종결되고,
  그 직후 `req:new`가 통과한다(실 git e2e).
- 포기 후에도 커밋된 phase 증거·매니페스트가 **바이트 그대로** 남는다.
- 기존 종결 이벤트 3종의 동작 무회귀(전체 스위트 그린).
