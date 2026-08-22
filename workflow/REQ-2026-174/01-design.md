# REQ-2026-174 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

`scripts/req/req-next.ts` — `auto`·`merge` 공통 종단:

```ts
if (defersToIntegration(input.stopGate ?? 'phase')) {
  const g = input.deliveryGate
  …
  if (g) return { kind: 'DONE', … }          // 묶음이 살아 있음
  return terminalIntegrationAction(input, {
    prefix: …,
    requireHighConfirm: true,                 // ← auto 도 여기로 온다
  })
}
```

`terminalIntegrationAction` 은 `requireHighConfirm && risk === 'HIGH'` 면 `req:confirm` 을 요구하고,
그 뒤에야 `auto` 분기(`autoDelegationAction`)로 간다. 그 함수의 주석이 이미 두 단계임을 인정한다.

**그런데 그 확인을 집행하는 곳이 `auto` 에는 없다**(요구사항의 표 참조).

## 핵심 설계 결정

### DEC-1 — 🔴 **HIGH 승인의 자리를 하나로 정한다**(없애는 것이 아니다)

| stopGate | HIGH 승인이 담기는 곳 | 집행 지점 |
|---|---|---|
| `phase`·`req` | `user_commit_confirmed` | `req:commit` `userConfirmGate` |
| `merge` | `user_commit_confirmed` | `delivery approve`(묶음) · 종단 안내 |
| **`auto` + 티켓 scope** | **위임의 `high_risk_ack`** | `integrate` `delegationVerdict` |
| `auto` + delivery 묶음 | `user_commit_confirmed` | `delivery approve`(**실제로 읽는다**) |

→ `auto` + 티켓 scope 에서만 `requireHighConfirm` 을 끈다. 그 값에서는 **위임이 그 자리**다.

🔴 **승인이 사라지는 것이 아니라 옮겨지는 것**이다. `--high-risk` 가 없으면 `integrate` 가
   `high-risk-unacked` 로 막는다 — 그 게이트는 **한 줄도 건드리지 않는다**.

🔴 오히려 **기록이 강해진다**: `user_commit_confirmed` 는 티켓 `state.json` 의 필드이고,
   위임은 **커밋되는 append-only 원장**에 승인 문장·SHA 결속·만료와 함께 남는다.

### DEC-2 — 🔴 조건은 **`auto` + 묶음 없음**이다(`defersToIntegration` 이 아니다)

`defersToIntegration` 은 `merge` 도 참이다. 그것으로 끄면 `merge` 의 HIGH 확인까지 사라지는데,
그 값에는 위임이 없어 **담을 곳이 없다** — 승인이 진짜로 증발한다.

```
requireHighConfirm = input.stopGate === 'merge'   // 묶음 없음 분기에서
```

🔴 값을 **하드코딩하지 않는다**는 기존 교훈(REQ-2026-146: `merge` 하드코딩이 `auto` 티켓에
   다른 정책 이름을 말하게 했다)과 충돌하지 않는다 — 여기서는 *"위임이 HIGH 를 담을 수 있는가"* 가
   기준이고, 그것을 **함수로 표현**한다:

```ts
/** 이 정책에서 HIGH 승인을 **사전 위임이** 담는가. */
export function highRiskCarriedByDelegation(sg: StopGate): boolean { return sg === 'auto' }
```

값이 하나 늘 때 이 함수가 판단 지점이 되고, 호출부는 그대로다.

### DEC-3 — 안내가 **어디에 담기는지** 말한다

`autoDelegationAction` 의 문구에 HIGH 일 때 한 줄을 더한다:
*"이 티켓은 HIGH 위험이라 `--high-risk` 가 **이 티켓의 유일한 사람 확인**이다."*

🔴 지금 문구는 *"HIGH 라 `--high-risk` 가 필수다"* 까지만 말한다. 확인이 **하나로 모였다**는 사실을
   말하지 않으면, 사람은 앞 단계가 왜 사라졌는지 모른 채 게이트가 약해졌다고 오해한다.

### DEC-4 — 계약 문서를 함께 고친다

`AGENTS.template.md` §4-1 예외표 #2 는 *"HIGH commit 실행 직전(= `req:confirm` 지점)"* 이다.
`auto` 에서는 그 지점이 없으므로, **어디가 그 자리인지**를 적는다.

🔴 이 저장소의 반복 교훈: *"새 절 추가 ≠ 갱신 — 안전속성 바꾸면 전수 grep"*.
   HIGH 확인 지점을 말하는 곳을 전부 찾아 같은 사실로 맞춘다.

### DEC-5 — 🔴 `req:delegate` 가 `user_commit_confirmed` 를 쓰게 하지 **않는다**

한때 검토한 절충이지만 기각한다. 그 필드는 **`req:confirm` 만 쓴다** — 시각을 실제 시계에서 읽기
위해서다(REQ-2026-019 가 폐기된 이유가 시각 날조다). 도구를 하나 더 그 필드에 쓰게 하면
"누가 언제 확인했는가"의 단일 출처가 깨진다.

## Phase별 구현

### phase-1 — 판정·안내·계약 (`phase-1-absorb`)

- `lib/config.ts`: `highRiskCarriedByDelegation(sg)` 추가(순수·1줄).
- `req-next.ts`: 묶음 없음 분기의 `requireHighConfirm` 을 그 함수로 파생 · `autoDelegationAction` 문구(DEC-3).
- `AGENTS.template.md`(+ 해당 문서): HIGH 확인 지점을 `stopGate` 별로 정확히 적는다.
- 테스트:
  - `auto` + HIGH + 묶음 없음 → `req:confirm` 을 요구하지 **않고** 위임 발급을 안내한다
  - 🔴 `merge` + HIGH → **여전히** `req:confirm` 을 요구한다(무회귀)
  - 🔴 `auto` + HIGH + **묶음 있음** → 그 경로는 바뀌지 않는다
  - 🔴 안내가 `--high-risk` 를 담고, 그것이 유일한 확인임을 말한다
  - 🔴 **게이트 무회귀**: `--high-risk` 없는 위임은 `integrate` 가 여전히 `high-risk-unacked` 로 막는다

Exit: typecheck 0 · 위 테스트 green ·
  🔴 **변이 3종**: ① 조건을 `defersToIntegration` 으로 되돌리면 `merge` 무회귀 테스트 red
  ② `auto` 에서도 계속 확인을 요구하면 새 테스트 red
  ③ `integrate` 의 `high-risk-unacked` 를 지우면 게이트 무회귀 테스트 red ·
  **커밋 전 전체 스위트 1회**(단일 phase) · Codex phase 리뷰 승인.

## 변경 파일

| 파일 | 성격 |
|---|---|
| `scripts/req/lib/config.ts` | 판정 함수 1개 |
| `scripts/req/req-next.ts` | 조건 파생 + 문구 |
| `AGENTS.template.md` · 해당 docs | 계약 정합 |
| 테스트 | 추가만 |

## 하위호환·안전

- **바뀌는 것은 `auto` + 티켓 scope 하나**다. `phase`·`req`·`merge`·delivery 묶음은 그대로다.
- 🔴 **집행 게이트는 손대지 않는다** — `integrate` 의 `high-risk-unacked` 도, `req:commit` 의
  `userConfirmGate` 도 그대로다. 바뀌는 것은 **안내가 무엇을 요구하는가**뿐이다.
- 🔴 **감춰진 완화가 아니다**: 안내가 "이것이 유일한 확인"이라고 말하고, 계약 문서가 같은 것을 적는다.
