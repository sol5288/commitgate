# REQ-2026-172 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

```
scripts/req/req-delegate.ts  runIssue()
  ├ issueProblem(o)              — 인자 형식 검사뿐
  ├ rev-parse trunk / source     — SHA 두 개
  └ 원장에 issued 행 append + 부기 커밋      ← 검증 0
```

거부 판정에 필요한 것은 전부 이미 있지만 **`bin/` 안에** 있다:

| 필요한 것 | 지금 위치 | 성격 |
|---|---|---|
| 범위 커밋·매니페스트 수집 | `bin/verify-range.ts` `collectDeepInput` | GitAdapter + readBlobs 포트 |
| 심층 검증(범주 판정) | `lib/verify-range.ts` `verifyRangeDeep` | ✅ 이미 lib |
| 범위 귀속 | `lib/range-attribution.ts` `attributeRange` | ✅ 이미 lib |
| 티켓 사실(risk·hardCap·미판정) | `bin/integrate.ts` `readTicketFacts` | readBlobs 포트 |
| **판정** | `lib/delegation.ts` `delegationVerdict` | ✅ 순수 |

## 핵심 설계 결정

### DEC-1 — 🔴 preflight 는 **게이트와 같은 함수**다(새 술어를 만들지 않는다)

후보 `DelegationIssued` 행을 **실제로 만들어**, 그것이 원장에 있다고 가정하고 `delegationVerdict` 를
**그대로** 돌린다. 통과하면 발급하고, 거부하면 그 사유를 그대로 보여 준다.

```
candidate = 지금 발급하려는 행
verdict   = delegationVerdict({ ledgerText: 기존 + candidate, now, trunkSha(현재), … })
```

🔴 **왜 이 형태인가**: "발급 시점 검사"를 따로 쓰면 그것이 두 번째 술어가 되고, 둘이 갈라지는 순간
*"발급은 됐는데 통합이 막힌다"* 또는 더 나쁘게 *"발급을 막았는데 사실은 통합됐을 것"* 이 된다.
REQ-2026-094 가 같은 결론에 도달했다 — **술어뿐 아니라 입력 획득까지 맞춰야 한다.**

### DEC-2 — 🔴 **지금 판정할 수 없는 사유로는 막지 않는다**

거부 사유는 셋으로 갈린다. 등록부(`DELEGATION_DENY_REASONS`)에서 파생해 분류를 **빠짐없이** 만든다.

| 부류 | 사유 | preflight |
|---|---|---|
| **지금 참** — 발급해도 그대로 막힌다 | `scope-out-of-range` · `high-risk-unacked` · `budget-hardcap` · `review-inconclusive` · `evidence-mismatch` · `ambiguous-active` · `ledger-corrupt` · `trunk-branch-mismatch` · `source-mismatch` · `composition-changed` | 🔴 **발급 거부** — 단, 앞의 둘은 **ack 로 열릴 수 있다**(DEC-7 이 시험한다) |
| **발급 시점에 성립 불가** | `absent`(방금 만들었다) · `expired` · `consumed` · `revoked` · `trunk-moved`(지금 읽은 값이다) | 무시 |
| **요청에 달림** | `permission-denied` | 무시(요청 권한은 통합 시점에 정해진다) |

🔴 `Record<DelegationDenyReason, …>` 로 분류표를 만든다 — 사유가 늘면 **컴파일이 강제**해 사각지대가
   생기지 않는다. `DENY_GUIDANCE` 가 이미 같은 기법을 쓴다.

🔴 두 번째 부류를 "막지 않는다"로 두는 것이 **핵심 안전 장치**다. `trunk-moved` 로 막으면 정상 발급이
   전부 거부된다(발급 순간의 trunk 는 늘 "현재"다).

### DEC-3 — 공유 코드를 **lib 으로 내린다**(관계 역전 금지)

`req-delegate.ts`(scripts) 가 `bin/integrate.ts` 를 import 하면 CLI 가 CLI 를 끌어온다.
`req-doctor.ts → bin/quickstart` 선례가 있지만, **integrate 는 통합 실행 표면 전체**라 그것을 위임
발급이 끌어오는 것은 결이 다르다.

→ 순수 **재배치**(동작 변경 0):

| 함수 | 이동 |
|---|---|
| `collectDeepInput` | `bin/verify-range.ts` → `lib/verify-range.ts` |
| `readTicketFacts` | `bin/integrate.ts` → `lib/integration-facts.ts`(신규) |

기존 `bin/*` 는 lib 에서 **re-export** 해 호출부·테스트 import 경로를 깨지 않는다.

### DEC-4 — 거부 안내는 **지금 실행하면 성공하는 명령**이어야 한다

이 저장소가 반복해서 데인 것: *"안내한 탈출구가 실행 불가"*. 그래서:

- `--allow-attested` 가 필요하면 **그 플래그를 포함한 전체 명령**을 낸다(사람이 문장만 채운다).
- 🔴 **`--sentence` 는 자리표시자로 둔다.** 도구가 승인 문장을 지어내면 그것이 곧 승인 위조다.
  `req:next` 가 쓰는 `PLACEHOLDER_APPROVAL_ANGLED` 와 **같은 자리표시자**를 쓴다.
- 브랜치·REQ id 를 셸로 안전하게 렌더링할 수 없으면(`shellSafeArg`) **명령을 만들지 않고** 값만 보여 준다
  — `req:next` 의 `delegateCommand` 가 이미 그 규칙을 갖고 있다. **같은 함수를 공유**한다.
- **플래그로 열 수 없는** 사유는 명령을 내지 않고 무엇을 해야 하는지만 적는다
  (범위를 좁혀라 / 먼저 통합하라). 열 수 없는 것에 명령을 붙이면 그게 막다른 길이다.

🔴 **`scope-out-of-range` 는 한 부류가 아니다**(design-r01 P1). 귀속 불가 커밋이 **전부 `attested`** 면
   `--allow-attested` 로 **열린다**(`attestedOnlyAndAcked`). 다른 티켓이 범위에 섞였거나 `unproven`·
   `invalid-evidence` 가 있으면 **열리지 않는다**. 같은 사유 이름으로 두 결말이 나오므로,
   **사유 이름만 보고 분류하면 안 된다** — 열리는지 여부는 아래 DEC-7 이 **실제로 시험해서** 정한다.

### DEC-7 — 🔴 필요한 플래그를 **한 번에 전부** 찾는다(사유는 하나씩 나온다)

`delegationVerdict` 는 **첫 거부 하나**만 돌려준다. 그래서 `--allow-attested` 를 붙여 다시 내면
이번엔 `high-risk-unacked` 가 나온다 — **왕복이 한 번 더 는다.** 이 REQ 가 없애려는 그 패턴을
고치는 쪽에서 재현하는 셈이다(design-r01 P1).

→ **필요한 ack 집합을 verdict 로 탐색한다.** 새 술어를 만들지 않고 같은 함수를 반복 호출한다:

```
acks = {}                                   // { attested_ack, high_risk_ack }
loop:
  v = delegationVerdict(후보 행 with acks)
  if v.ok                      → acks 가 답. 통과.
  if v.reason 이 직전과 같다    → 그 플래그로 열리지 않는다 → 차단(명령 없음)
  if v.reason 에 대응 ack 있음  → 그 ack 를 켜고 계속
  else                         → 차단(명령 없음)
```

| 사유 | 대응 ack |
|---|---|
| `scope-out-of-range` | `attested_ack`(= `--allow-attested`) — **열릴 수도, 안 열릴 수도 있다** |
| `high-risk-unacked` | `high_risk_ack`(= `--high-risk`) |
| 그 외 | 없음 → 차단 |

🔴 **종료 보장**: ack 는 유한(2개)하고, 매 회차마다 **켜지거나** 사유가 반복된다. 사유 반복은 곧
   "그 ack 로 안 열린다" 이므로 즉시 멈춘다. 최대 3회차.

🔴 **이 탐색이 게이트를 열지 않는다.** 탐색은 *"사람이 무엇을 명시해야 하는지"* 를 알아낼 뿐이고,
   그 플래그를 **켜는 것은 사람**이다(완료 기준 3). 도구는 명령 문자열에 적어 줄 뿐 원장에 쓰지 않는다.

### DEC-5 — `--preflight-only` 는 만들지 않는다

기본이 dry-run 이므로(`--run` 없으면 계획만) **dry-run 이 곧 preflight** 다.
새 플래그를 만들면 "검사하는 실행"과 "검사 안 하는 실행"이 갈라진다.
🔴 `--run` 에서도 **같은 검사**를 하고, 거부면 원장을 건드리지 않는다.

### DEC-6 — 비용

preflight 는 `collectDeepInput`(git log + 배치 blob) 1회 + 티켓 state 읽기다. `integrate` 가 이미
하는 일과 같고, 발급은 REQ 당 1~2회뿐이라 실측 부담이 없다. 🔴 그래도 **측정해서 기록한다** —
"가벼울 것"이라는 추측으로 넘기지 않는다.

## Phase별 구현

### phase-1 — 공유 코드 lib 재배치 (`phase-1-relocate`)
`collectDeepInput` → `lib/verify-range.ts` · `readTicketFacts` → `lib/integration-facts.ts`(신규).
`bin/verify-range.ts`·`bin/integrate.ts` 는 re-export. **동작 변경 0** — 기존 테스트 무수정 통과가 오라클.

### phase-2 — preflight 판정 + `req:delegate` 배선 (`phase-2-preflight`)
`lib/delegation-preflight.ts`(신규): 사유 분류표(DEC-2) + 후보 행 구성 + **ack 탐색 루프**(DEC-7).
`req-delegate.ts` 가 발급 전에 호출하고 거부면 원장 무변경 fail-closed.
오라클: 사유별 진리표(순수) + **실 git e2e** +
🔴 **조합 e2e**: HIGH 티켓 + 범위에 attested-only → 안내 명령이 `--allow-attested` 와 `--high-risk` 를
**둘 다** 담는다(하나씩 알려 주면 왕복이 는다 — design-r01 P1) +
🔴 **변이**(분류표에서 `scope-out-of-range` 를 "무시"로 바꾸면 red · 탐색 루프를 1회차로 고정하면 조합 e2e 가 red).

### phase-3 — `req:next` 안내 정합 (`phase-3-next-hint`)

🔴 **`delegateCommand()` 만 고쳐서는 안 된다**(design-r02 P1). 지금 `NextInput` 은 티켓 state·branch 만
받고 `merge-base..source` 범위의 귀속을 **모른다** — 그래서 범위에 attested-only 커밋이 있고 티켓이 LOW 여도
`--allow-attested` 필요 여부를 알 수 없다. 그 상태로는 안내가 다시 불완전해지고 완료 기준 4가 깨진다.

→ **사실 획득 계약을 함께 만든다**:

```ts
// NextInput 에 추가 — 🔴 **지연 공급자**(thunk)다.
requiredDelegationAcks?: () => AckProbe   // { acks: {attestedAck, highRisk} } | { unknown: string }
```

- 🔴 **지연**인 이유: `req:next` 는 매 회차 호출되는 값싼 명령인데 `collectDeepInput` 은 git log + blob
  배치다. 이 값은 **`auto` 종단(`autoDelegationAction`) 한 곳에서만** 필요하므로, 그 분기에 도달했을 때만
  호출한다. 다른 경로의 비용은 0 이다.
- 🔴 **같은 탐색을 쓴다**: 공급자는 phase-2 의 `delegation-preflight` 를 그대로 호출한다.
  `req:next` 가 자기 판정을 따로 갖지 않는다 — 그러면 안내와 발급이 또 갈라진다.
- 🔴 **모르면 모른다고 말한다**: 범위를 읽지 못하면(`unknown`) 플래그를 **추측해 넣지 않고**,
  안내에 *"이 범위의 요구 플래그를 판정하지 못했다 — `req:delegate` 가 발급 시점에 알려 준다"* 를 붙인다.
  불완전한 명령을 완전한 것처럼 내는 것이 이 REQ 가 없애려는 결함이다.

`req:next` 와 `req:delegate` 의 거부 안내는 **같은 명령 생성기**를 쓴다(두 곳이 갈라지지 않게).

## 변경 파일

| 파일 | phase |
|---|---|
| `scripts/req/lib/verify-range.ts` · `bin/verify-range.ts` | 1 |
| `scripts/req/lib/integration-facts.ts`(신규) · `bin/integrate.ts` | 1 |
| `scripts/req/lib/delegation-preflight.ts`(신규) · `scripts/req/req-delegate.ts` | 2 |
| `scripts/req/req-next.ts` | 3 |
| 각 phase 의 테스트 | 1·2·3 |

## 하위호환·안전

- 🔴 **게이트가 약해지지 않는다.** preflight 는 **거부를 앞당길 뿐** 통합 시점 검사를 대체하지 않는다.
  `integrate` 는 지금과 똑같이 `delegationVerdict` 를 다시 돌린다(발급 이후 상황이 바뀔 수 있으므로).
- **새로 막히는 것이 생긴다**: 지금은 발급되던 위임 중 "어차피 통합에서 거부될 것"이 발급 단계에서 막힌다.
  🔴 이것은 의도된 변경이고, 막힐 때 **무엇을 하면 되는지**를 함께 낸다(DEC-4).
- **원장 오염 없음**: 거부는 append 전에 일어난다 — 실패한 발급이 원장에 남지 않는다.
