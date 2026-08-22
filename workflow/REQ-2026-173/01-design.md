# REQ-2026-173 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

`lib/delegation.ts` `delegationVerdict`:

```ts
if (row.trunk_branch !== input.trunkBranch) return deny('trunk-branch-mismatch', …)
if (row.trunk_sha !== input.trunkSha)       return deny('trunk-moved', …)   // ← 이 줄
```

`trunk_sha` 는 **순수 비교**다. 판정 함수가 git 을 모르므로 "어떻게 움직였는가"를 볼 수 없다.

`integrate` 가 trunk 에 남기는 것(순서대로):
1. `git merge --no-ff <feature>` → **머지 커밋 M**
2. `executed` 행 append + 부기 커밋 **B** (`delegate — <id> 수행 기록`)

즉 인가된 통합 1회마다 trunk 의 first-parent 사슬에 `M → B` 가 얹힌다.
그리고 `executed.merge_sha === M` 이 **원장에 남는다** — 이것이 인가의 물증이다.

## 핵심 설계 결정

### DEC-1 — 🔴 판정 함수는 **순수하게** 둔다. 사실은 주입한다.

`delegationVerdict` 에 git 을 넣지 않는다. 대신 **이미 계산된 사실**을 받는다:

```ts
interface DelegationCheckInput {
  …
  /** 🔴 `undefined` = 계산하지 않았다 → 종전대로 `trunk-moved` 거부(무회귀). */
  trunkAdvance?: TrunkAdvanceVerdict
}
type TrunkAdvanceVerdict =
  | { authorized: true; mergeShas: string[]; addedCommits: number }
  | { authorized: false; reason: string }
```

🔴 **`undefined` 를 "허용"으로 읽지 않는다.** 계산하지 않은 것은 모르는 것이고, 모르면 종전 거부다.
   이 기본값 하나가 무회귀와 fail-closed 를 동시에 지킨다.

### DEC-2 — 🔴 인가의 근거는 **원장**이다(설정도 이름도 아니다)

`authorizeTrunkAdvance()` 가 `<row.trunk_sha>..<현재 trunk>` 를 보고 판정한다.

**통과 조건 — 전부 참이어야 한다:**

| # | 조건 | 왜 |
|---|---|---|
| 1 | 범위의 **머지 커밋**이 전부 이 원장의 `executed.merge_sha` 에 있다 | 인가 없이 들어온 병합 차단 |
| 2 | 범위에 `unproven`·`invalid-evidence` 가 **0** 이다 | 손으로 민 커밋·깨진 증거 차단 |
| 3 | 범위에 `attested` 가 **0** 이다 | 🔴 아래 참조 |
| 4 | 범위 수집·분류가 **성공**했다 | 판정 불가는 거부(차단 지점) |

🔴 **왜 `attested` 도 막는가**(조건 3): `attested` 는 사람이 리뷰 없이 예외 승인한 커밋이다.
   그 승인은 *그 커밋에 대한* 것이지 *이 위임을 계속 유효하게 두는 것*에 대한 승인이 아니다.
   보수적으로 막고, 사람이 다시 발급하게 한다. **과잉 허용보다 과잉 차단이 안전한 자리다.**

🔴 조건 1이 핵심이다. 2·3만 보면 "증거는 멀쩡한데 **다른 원장/다른 경로**로 들어온 병합"이 통과한다.
   `merge_sha` 대조가 *"이 원장이 인가했다"* 를 못 박는다.

### DEC-3 — 🔴 분류는 **기존 분류기**를 쓴다(이원화 금지)

`collectDeepInput` + `verifyRangeDeep` — `integrate` 가 이미 쓰는 그 조합이다.
새 분류기를 만들면 "verify-range 는 통과인데 trunk 인가는 거부" 같은 어긋남이 생긴다.
`머지 커밋 목록`은 `deepInput.commits` 의 `parentCount >= 2` 로 얻는다(같은 입력에서).

### DEC-4 — 통과해도 **조용하지 않다**(완료 기준 4)

- `integrate` 출력에 한 줄: *"trunk 가 움직였지만 인가된 병합 N건뿐이었다(<sha>…)"*.
- `consumed` 행의 `detail` 에 같은 사실을 적는다 — 원장만 봐도 되짚을 수 있어야 한다.

🔴 **감춰진 완화는 완화가 아니라 구멍이다.** 나중에 이력을 읽는 사람이 "이 위임은 발급 시점 trunk 에서
   그대로 소비됐다"고 오해하면 안 된다.

### DEC-5 — 적용 지점은 **`integrate` 한 곳**

`req:delegate` 의 preflight(REQ-2026-172)는 발급 **직후**를 보므로 trunk 가 움직였을 리 없다.
`trunk-moved` 는 이미 `not-yet-knowable` 로 분류돼 있어 preflight 는 이 축을 보지 않는다 — 손댈 필요가 없다.

🔴 그러나 **`req:next` 안내는 손대야 한다**: 지금은 `auto` 종단에서 위임이 무효면 "다시 발급하라"고
   안내한다. trunk 이동이 인가된 경우엔 **그 안내가 거짓**이 된다(발급할 필요가 없다).
   → phase-3 에서 그 자리도 함께 본다.

### DEC-6 — 비용

`authorizeTrunkAdvance` 는 `trunk_sha != 현재` 일 때**만** 돈다. 그때만 `collectDeepInput` 1회가 늘고,
그 범위는 보통 병합 몇 건이라 작다. 🔴 그래도 **측정해서 기록한다**.

## Phase별 구현

### phase-1 — 판정(순수) + 사실 계산 (`phase-1-authorize`)
- `lib/delegation.ts`: `TrunkAdvanceVerdict` 타입 + `trunkAdvance` 입력 + verdict 분기.
  🔴 `undefined` → 종전 거부(무회귀).
- `lib/trunk-advance.ts`(신규): `authorizeTrunkAdvance(ports, ledgerRows, fromSha, toSha, ticketRoot)`.
- 오라클: 진리표(순수) + **변이**(조건 1 제거 → 미인가 병합이 통과 → red).

### phase-2 — `integrate` 배선 + 정직한 기록 (`phase-2-wire-integrate`)
- `bin/integrate.ts`: `trunk_sha` 불일치일 때만 계산해 `delegationVerdict` 에 넘긴다.
- 출력 한 줄 + `consumed.detail` 에 사실 기록(DEC-4).
- 오라클: 실 git e2e — **순차 통합 2건**이 재발급 없이 통과 · 손으로 민 커밋이 끼면 거부 ·
  🔴 **변이**(배선 제거 → e2e red).

### phase-3 — `req:next` 안내 정합 (`phase-3-next-guidance`)
- trunk 이동이 인가된 경우 "다시 발급하라"고 말하지 않는다.
- 🔴 **커밋 전 전체 스위트 1회**(마지막 phase — 이후엔 phase 를 더할 수 없다).

## 변경 파일

| 파일 | phase |
|---|---|
| `scripts/req/lib/delegation.ts` · `scripts/req/lib/trunk-advance.ts`(신규) | 1 |
| `bin/integrate.ts` | 2 |
| `scripts/req/req-next.ts` | 3 |
| 각 phase 의 테스트 | 1·2·3 |

## 하위호환·안전

- **게이트가 약해지는 축은 하나뿐이고, 그 축의 대체 조건이 더 강하다**: 예전엔 "SHA 가 같다"만 봤고
  이제는 "그 사이가 전부 이 원장이 인가한, 증거가 온전한 병합이다"를 본다.
- **다른 축은 그대로**: scope·HIGH·evidence·만료·소비·source 는 손대지 않는다.
- 🔴 **판정 불가는 거부**다. `collectDeepInput` 실패·머지 목록 확정 실패는 전부 `authorized: false`.
- **무회귀**: `trunkAdvance` 를 넘기지 않는 호출부(테스트 포함)는 종전 동작 그대로다.
