# REQ-2026-071 설계 — 멈춤 지점은 `stopGate`만이 정한다

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

**정지가 두 축에서 나온다.**

| 축 | 위치 | 동작 |
|---|---|---|
| `stopGate` | `req-next.ts:572` | `low-only` + `risk_level==='LOW'` + staged → 자동 커밋(RUN), 아니면 AWAIT_HUMAN |
| **HIGH 백스톱** | `req-commit.ts`의 `userConfirmGate` (3 호출처) | `risk_level==='HIGH'`면 유효 `user_commit_confirmed` 없이는 **커밋 자체를 차단** |

`user_commit_confirmed`는 `consumeState`가 **매 커밋마다 초기화**한다 — 그래서 HIGH는 phase마다
새 확인이 필요하다. 이것이 `stopGate`와 무관하게 도는 두 번째 정지다.

## 핵심 설계 결정

### DEC-0 — 🔴 r01 P1이 드러낸 모순과 그 해소

초안은 "HIGH 확인의 `scope`를 넓힌다"였는데, 게이트가 **커밋을 차단**하는 자리에 그대로 있었다.
그러면 `stopGate:'req'`인 HIGH 티켓은 **첫 phase에서 막혀 REQ 종료에 도달할 수 없다.**
반대로 첫 phase 전에 넓은 확인을 받으면 그건 "REQ 종료 시 확인"이 아니라 **phase 시작 전 확인**이다.

해소: **차단 지점 자체를 옮긴다.** `stopGate`가 `req`/`merge`면 HIGH라도 **phase 커밋을 막지 않고**,
확인은 **종결 지점에서** 받는다.

### DEC-1 — 정지 지점 표 (R1·R2)

| `stopGate` | phase 커밋 | 확인을 받는 곳 | 강제 수단 |
|---|---|---|---|
| `phase` | HIGH면 **차단**(현행) | 매 phase | `userConfirmGate` — 도구가 커밋을 막는다 |
| `req` | 막지 않음 | REQ 종료 | `req:next` 종단 `AWAIT_HUMAN` + 통합 통제점(I1/I2/B1) |
| `merge` | 막지 않음 | 묶음 종료 | `delivery integrate`·`approve` — 도구가 막는다 |

### DEC-2 — 🔴 `req`의 강제 지점은 **REQ를 완성시키는 커밋**이다 (r02 P1-a 해소)

r02 P1-a: "REQ 종료 뒤 통합은 사람이 손으로 하는 push라 도구가 개입할 수 없다" → 그러면 수용기준 4
(확인 없이 HIGH가 통합되지 않는다)를 못 지킨다.

해소: **REQ 종료 지점은 손 push가 아니라 `dev-complete`를 발행하는 그 커밋이다.** 그 커밋은
`req:commit`이 실행하므로 **도구가 막을 수 있다.**

- `stopGate:'req'` + HIGH: 중간 phase 커밋은 **막지 않는다**. 이 커밋이 **REQ를 완성시키면**(마지막
  phase → `dev-complete` 발행) 그때 확인을 요구한다.
- 그래서 확인 없이는 **`dev-complete`가 발행되지 않고**, 종결도 `delivery integrate` 자격도 성립하지 않는다.

🔴 **남는 한계**: 미완성 REQ를 손으로 push하는 것은 여전히 도구 밖이다. 다만 그건 이 REQ가 만든 구멍이
아니라 저장소 전반의 보증 범위(협력적 worker·단일 활성 워크트리)이며, **완료되지 않은 REQ는 어느
`stopGate`에서도 통합 대상이 아니다.**

### DEC-3 — 🔴 확인을 **기록하는 명령을 만든다** (r02 P1-b 해소)

r02 P1-b: 넓은 scope 확인을 **생성할 경로가 없다** — 요구만 하고 만들 방법이 없으면 정상 경로가 막힌다.

지금은 그 경로가 **아예 없다**: `user_commit_confirmed`는 `state.json`을 **손으로 편집**해 넣는다.
🔴 그것이 REQ-2026-019가 폐기된 방식(시각 날조)과 같은 표면이다.

**`req:confirm`을 만든다.**

```
npx commitgate req:confirm <REQ> --scope phase|req|delivery --method "<승인 문장>" --run
```

- 🔴 시각은 **실제 시계**에서 읽는다 — 손기록을 대체하는 것이 이 명령의 존재 이유다.
- 🔴 `scope`는 현재 `stopGate`가 요구하는 것과 **정확히 일치**해야 한다(DEC-4b).
- 🔴 넓은 scope는 **아직 없는 변경까지 미리 승인**한다 — 명령이 그 사실을 출력에 명시한다.
- state 변경이므로 setup 게이트를 지나고, checkpoint 커밋을 남긴다.

### DEC-4 — `userConfirmGate`는 **삭제하지 않고 두 입력을 받는다**

```
userConfirmGate(state, stopGate, completesReq) → { blocked, reason? }
```

| `stopGate` | 요구 scope | 차단 조건 |
|---|---|---|
| `phase` | `phase` | HIGH + `scope:'phase'` 유효 확인 없음 → 차단(**현행과 완전히 동일**) |
| `req` | `req` | HIGH + `completesReq` + `scope:'req'` 확인 없음 → 차단 |
| `merge` | `delivery` | 커밋에서는 차단 안 함 — `delivery integrate` 자격에서 요구 |

🔴 함수를 지우지 않는 이유: `phase`를 고른 사용자에게 이 차단이 **정본**이다.

### DEC-4b — 🔴 scope는 **순서가 아니라 진술**이다 — 정확히 일치해야 한다 (r03 P1)

초안은 "요구보다 넓은 scope면 통과"였다. 그러면 `stopGate:'phase'`인 HIGH 티켓에서 사용자가
`--scope req`를 **한 번** 기록하는 순간, 그 확인이 phase 게이트를 통과시키면서 **소비되지도 않아**
이후 모든 phase가 새 확인 없이 진행된다 — `phase`가 보장하려던 "매 phase 신선한 확인"이 **정상 경로로
사라진다.**

🔴 그래서 scope는 **크기 순서가 아니다.** 각 값은 "무엇을 승인했는가"에 대한 **진술**이고,
`stopGate:'phase'`의 계약은 "각 phase마다 새로 승인한다"이므로 **REQ 단위 승인은 그 계약이 금지하는
바로 그것**이다. 게이트는 요구 scope와 **정확히 일치**하는 확인만 유효로 본다.

부수 효과로 소비 규칙이 단순해진다: 각 게이트는 자기 scope의 확인만 보고, 그 범위가 닫힐 때 소비한다.

### DEC-5 — `scope`는 **무엇을 승인했는지**를 남긴다 (R3·수용기준 6)

`UserCommitConfirmed.scope?: 'phase' | 'req' | 'delivery'`. 🔴 **부재는 가장 좁은 `phase`로 읽는다** —
넓게 읽으면 과거 확인이 의도보다 많은 것을 덮는다(하위호환).

🔴 **넓은 확인은 "아직 없는 변경까지 미리 승인한다"는 뜻이다.** 확인 문구가 그 사실을 명시한다.

### DEC-6 — 소비는 **범위가 닫힐 때**

`scope:'phase'`는 커밋마다(현행). `'delivery'`는 `delivery approve`에서. 
🔴 중간에 소비하면 남은 변경이 확인 없이 진행된다.

### DEC-7 — 🔴 `risk_level` fail-closed는 그대로 (수용기준 5)

부재·`'Low'` 오타·손상·`MEDIUM`은 자동 진행하지 않는다. "HIGH가 아님"이 "자동 안전"을 뜻하지 않는다는
현행 규칙(`req-next.ts`의 `=== 'LOW'` 정확 일치)을 건드리지 않는다.

## Phase별 구현

`02-plan.md` 참조.

## 변경 파일

| 파일 | 변경 |
|---|---|
| `scripts/req/lib/evidence.ts` | `UserCommitConfirmed.scope?` |
| `scripts/req/req-commit.ts` | `userConfirmGate(state, stopGate)` · `consumeState`의 조건부 소비 |
| `scripts/req/req-next.ts` | HIGH일 때의 안내를 `stopGate`에 맞춘다 |
| 테스트 · docs 한/영 · CHANGELOG | |

## 하위호환·안전

- `stopGate: "phase"`(기존 명시 설정)는 **동작이 완전히 동일**하다.
- `scope` 부재는 `phase`로 읽어 과거 기록의 의미가 넓어지지 않는다.
- `risk_level` fail-closed 무변경.
- 통합(I1/I2/B1) 승인 무변경.
