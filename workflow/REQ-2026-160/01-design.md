# REQ-2026-160 설계

## DEC-1 — `scope 미판정`을 **별도 결과**로 모델링한다

```ts
export type DelegationGateResult =
  | { kind: 'not-required' }
  | { kind: 'allowed'; delegationId: string; permissions: DelegationPermissions }
  | { kind: 'denied'; lines: string[] }
  | { kind: 'manual-confirmation-required'; lines: string[] }   // ← 신규
```

- 🔴 **`scope === null` 한 경우에만** 이 값을 낸다. 다른 거부 사유는 전부 `denied` 그대로다.
- 🔴 **그러나 `scope === null` 이라고 곧바로 내면 안 된다**(설계 r01 P1). 오늘 `runIntegrate` 는
  scope 가 null 이면 `ticketFacts` 를 `riskLevel: null · budgetHardCapReached: false ·
  reviewInconclusive: false` 로 만든다 — 즉 **HIGH·hardCap·미판정 리뷰가 평가되지 않는다.**
  그 상태로 대화형 `y` 를 받으면 **사람 확인으로 열리면 안 되는 거부를 통과**시킨다. 보안 우회다.
  → **DEC-1a** 를 먼저 만족시킨 뒤에만 이 값을 낸다.
- 🔴 **`denied` 를 재분류하지 않는다.** "사유 문자열을 보고 열어 줄지 정하는" 방식은 문자열이
  바뀌는 순간 조용히 열린다 — 판정은 **생산 지점**에서 타입으로 한다.
- 🔴 **`allowed` 와 섞이지 않는다.** 이 값은 권한을 주지 않는다 — 사람의 최종 확인으로 **넘길 뿐**이다.
  `planPushActions`·소비 기록·push 는 전부 `gate.kind === 'allowed'` 에만 걸려 있어야 한다
  (즉 이 경로에서는 **push 하지 않고 로컬 병합까지만**이다 — 위임이 없으므로 당연하다).

## DEC-1a — **fail-closed 사실을 먼저 수집·평가한다** (설계 r01 P1)

`scope === null` 이어도 **정책 대상은 이미 알고 있다**(REQ-2026-159 의 `policyTargetIds` — 커밋
귀속에서 나온다). 그 대상들의 `state.json` 에서 위험 사실을 **보수적으로** 합친다.

```
scopeNullFacts = 정책 대상 각각의 readTicketFacts 를 합친 것
  riskLevel            = 하나라도 HIGH 면 HIGH
  budgetHardCapReached = 하나라도 true 면 true
  reviewInconclusive   = 하나라도 true 면 true
```

**판정 순서(우선순위):**

```
1) fail-closed 사실이 하나라도 성립 → denied            ← 대화형에서도 열리지 않는다
     · riskLevel === 'HIGH'      (위임이 없으니 high_risk_ack 을 얻을 길이 없다)
     · budgetHardCapReached
     · reviewInconclusive
2) 그 외 · scope === null        → manual-confirmation-required
```

- 🔴 **HIGH 는 여기서 무조건 거부**다. `--high-risk` 위임이 그것을 풀어 주는데, 이 경로에는 **위임
  자체가 없다.** "대화형이니까 사람이 판단하면 된다"로 열면 HIGH 확인 절차를 통째로 우회한다.
- 🔴 **scope 가 확정된 경로(`scope !== null`)의 사실 수집은 바꾸지 않는다.** 거기서는 오늘처럼
  `collectAutoFacts` 가 만든 값을 쓴다 — 정책 대상은 브랜치 티켓보다 넓을 수 있어(귀속 합집합),
  그 값으로 바꾸면 **무관한 티켓의 HIGH 가 정상 통합을 막는** 새 거짓 거부가 생긴다.
  이 REQ 는 **scope 미판정 경로만** 다룬다.

## DEC-1b — 판정이 **두 자리**에 있다. 둘 다 같은 함수를 쓴다 (phase-1 r01 P1)

r01 P1: 정책이 `indeterminate` 면 `runIntegrate` 가 게이트를 `not-required` 로 두므로
**`delegationGate` 안의 HIGH·`hardCap`·미판정 리뷰 검사가 아예 돌지 않는다.** 대화형 `y` 하나로
열리면 안 되는 것이 열린다.

- 🔴 `failClosedBlockers(facts)` 를 **한 벌만** 두고 두 분기가 함께 쓴다. 두 벌이면 한쪽만 고쳐지고,
  그 순간 한쪽이 열린다.
- 🔴 **자리표시자를 실제 사실로 쓰지 않는다.** `readTicketFacts` 는 state 를 못 읽으면
  `riskLevel: 'HIGH'`·`reviewInconclusive: true` 를 돌려주는데 그것은 **"위험하다"가 아니라
  "모른다"**는 뜻이다. 그대로 쓰면 ① 사용자에게 "HIGH 라서 막혔다"고 **거짓 사유**를 말하고,
  ② REQ-2026-159 가 만든 **"판정 불가는 사람이 확인할 수 있다"** 경로를 **영구히 닫는다.**
  → 판정은 **읽은 state 만**(`stateUnreadable === false`) 모아서 한다.
- 🔴 그래서 이 두 조건이 **동시에** 성립하는 것은 **묶음뿐**이다: 멤버 하나는 읽히고(HIGH) 하나는
  손상(→ 정책 판정 불가). 티켓 하나짜리 범위에서는 판정 불가의 원인이 곧 "못 읽음"이라 읽은 사실이
  남지 않는다. **회귀 테스트도 묶음으로 써야 실제로 그 분기를 지난다** — 티켓 하나로 쓰면
  다른 분기(`delegationGate` 의 scope 미판정)에서 막혀 **오라클이 공허해진다**(실제로 밟았다).

## DEC-2 — `runIntegrate` 의 분기

```
denied                        → 즉시 exit 1 (대화형이어도)
manual-confirmation-required  → 사유 출력
                                 비대화형 → exit 1
                                 대화형   → 아래 최종 [y/N] 로 진행 (기본 No)
```

- 🔴 REQ-2026-159 의 `policy.kind === 'indeterminate'` 처리와 **같은 모양**으로 맞춘다 —
  두 자리가 다르게 생기면 다음 사람이 하나만 고친다.
- 🔴 최종 확인 뒤의 **CAS 선점·strict 재검증은 그대로**다. 이 분기는 "누가 승인하는가"만 바꾼다.
- 🔴 안내 문구를 **동작과 같은 문장으로** 고친다: 비대화형에서는 "대화형에서 실행하면 사람이
  최종 확인할 수 있습니다", 대화형에서는 프롬프트가 실제로 뜬다.

## DEC-3 — 회귀는 **`runIntegrate` 를 태운다**

| # | 입력 | 기대 |
|---|---|---|
| 1 | auto 스냅샷 · `feat/req-renamed` · config `merge` · **비대화형** | exit 1 · merge 0회 |
| 2 | 같은 입력 · **대화형 `y`** | **병합됨** |
| 3 | 같은 입력 · **대화형 Enter**(빈 문자열) | merge 0회 |
| 4 | 🔴 scope 미판정 + **hardCap 도달** · 대화형 `y` | **병합되지 않음** |
| 5 | 🔴 scope 미판정 + **HIGH 위험** · 대화형 `y` | **병합되지 않음** |
| 6 | 🔴 scope 미판정 + **리뷰 미판정(BLOCKED)** · 대화형 `y` | **병합되지 않음** |
| 7 | 🔴 scope **확정** + 진짜 위임 거부(trunk-moved) · 대화형 `y` | **병합되지 않음** |
| 8 | 대화형 경로에서 **push 하지 않는다** | `push` 호출 0회 |

- 🔴 **#4·#5·#6 이 이 REQ 의 핵심 오라클**이다(설계 r01 P1). scope 미판정 경로가 HIGH·hardCap·
  BLOCKED 를 **평가하지 않은 채** 사람 확인만으로 열리면 그것이 보안 우회다.
- 🔴 **변이 검사**: ① `manual-confirmation-required` 를 `denied` 로 되돌리면 #2 red ·
  ② 모든 `denied` 를 대화형에서 열어 주면 **#7 red** · ③ DEC-1a 의 fail-closed 선평가를 빼면
  **#4·#5·#6 red**.

## DEC-4 — 계약·문서

`AGENTS.template.md` 와 `docs/workflow.md`(한/영)에 **구분해서** 적는다.

> `auto` 에서 **통합 대상(티켓·묶음)을 브랜치 이름에서 확정할 수 없으면** 자동 통합하지 않는다.
> 이 경우에만 **대화형 최종 확인으로 사람이 진행**할 수 있다.
> 🔴 그 외의 거부 — 위임 부재·만료·철회·이미 소비 · trunk 이동 · source 불일치 · 범위 밖 변경 ·
> HIGH 미위임 · `hardCap` · 리뷰 `BLOCKED` — 는 **사람 확인으로도 열리지 않는다.**

- 🔴 REQ-2026-159 가 등재한 `retired-claims` 방식은 여기서 쓰지 않는다 — 옛 서술을 **되살리면 안 되는
  주장**으로 등재할 만한 것이 없다(계약이 이 축을 아예 말한 적이 없다). 새로 **추가**하는 것이다.

## Phase 분해

단일 phase — `phase-1-manual-confirm-gate`. 축이 하나(게이트 분기)이고 문서가 그 서술이다.

## 변경 파일

`bin/integrate.ts` · `tests/unit/integrate-delegation.test.ts` · `AGENTS.template.md` ·
`docs/workflow.md` · `docs/workflow.en.md` · `tests/unit/agent-autonomy-contract.test.ts` · `CHANGELOG.md`

## 안전

- 🔴 **거부 사유 목록을 한 줄도 늘리지 않는다.** 새 결과값은 `scope === null` **이고 fail-closed
  사실이 하나도 없을 때만** 난다.
- 🔴 `scope !== null` 경로의 사실 수집·판정을 **한 줄도 바꾸지 않는다**.
- 🔴 이 경로는 **push 하지 않는다**(위임이 없으므로 권한이 없다).
- 🔴 REQ-2026-159 의 정책 해소는 건드리지 않는다.
