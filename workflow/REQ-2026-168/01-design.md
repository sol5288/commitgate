# REQ-2026-168 설계

## 문제 요약

`integrate` 가 **귀속 불가 커밋**(리포트의 경우 `attested`)으로 막혔는데 **delivery 레코드**를 원인으로
지목했다. 없는 묶음의 레코드를 만들 수 없으므로 안내가 실행 불가능하고, 비대화형에는 통과 경로가 없다.

🔴 **거부 자체는 옳다.** 고치는 것은 **판정의 해상도**(왜 막혔는가)와 **사람이 미리 결정할 수단**이다.

## DEC-1 — 귀속 불가를 **자료로** 구분한다

`AttributionDetail.unattributableCommits` 는 지금 `{ sha, subject, why }` 뿐이다. `why` 는 산문이라
기계가 읽을 수 없어, 호출부가 *"전부 attested 인가"* 를 물을 수 없다.

**`category` 를 더한다** — 값은 `verify-range` 의 분류를 그대로 옮긴 것이다(재해석하지 않는다).

```ts
unattributableCommits: { sha: string; subject: string; why: string; category: string | null }[]
```

- `attested` · `unproven` · `invalid-evidence` — 분류가 그대로 온다.
- `approved`(소비 행 없음) · `bookkeeping`(설명되지 않은 경로) — 그 분류가 온다. **`attested` 가 아니다.**
- 분류 결과에 없는 커밋 — `null`.

🔴 `why` 를 파싱해 사유를 추정하지 않는다. 산문은 다듬을 수 있고, 다듬는 순간 판정이 바뀐다.

## DEC-2 — 정책 판정 불가를 **사유별로** 낸다

`policyTargetIds` 는 `string[] | null` 을 낸다 — `null` 하나에 두 사유가 겹쳐 있고, 그래서 메시지가
하나뿐이다. 결과 타입을 나눈다.

```ts
export type PolicyTargets =
  | { ok: true; ids: string[] }
  | { ok: false; reason: 'unattributable'; commits: UnattributableCommit[] }
  | { ok: false; reason: 'delivery-unreadable'; slug: string }
```

`AutoFacts.policyMembersUnknown: boolean` → `policyUnknown: PolicyUnknown | null` 로 바꾼다. `boolean` 은
"무엇을 모르는가"를 담을 수 없다 — 이 결함의 형태 그 자체다.

`resolveIntegrationPolicy` 는 사유별 메시지를 낸다.

| 사유 | 말하는 것 |
|---|---|
| `unattributable` | 막은 커밋의 **SHA·범주·제목**을 나열. `attested` 가 있으면 *"예외 승인 커밋은 자율 통합 대상이 아니다(의도된 설계)"* 와 사람이 할 수 있는 것 |
| `delivery-unreadable` | **어느 슬러그**의 레코드를 못 읽었는지. 현행 안내(레코드 커밋)는 이때만 |

🔴 **`delivery` 라는 단어는 `delivery-unreadable` 에서만 나온다.** 가드가 이것을 고정한다.

## DEC-3 — `req:delegate --allow-attested`

비대화형 통과 경로를 **사람이 미리 결정하고 원장에 남는 형태**로만 만든다. 기존
`--allow-push`·`--allow-bypass`·`--high-risk` 와 **같은 패턴**이다(기본 불허 · 별도 명시 · 1회 소비 · 만료).

```
npx commitgate req:delegate --scope ticket:<REQ> --source <branch> \
    --sentence "<승인 문장>" --allow-attested --run
```

원장 행에 `attested_ack: boolean` 을 더한다(`high_risk_ack` 와 같은 자리·같은 성격).

### 두 자리 모두에서 봐야 한다

같은 사실을 보는 차단 지점이 둘이고, **한쪽만 고치면 다른 쪽이 막는다**.

| 자리 | 현행 |
|---|---|
| `resolveIntegrationPolicy` (정책) | `policyUnknown` 이면 진행 불가 |
| `scopeRangeProblem` (`delegation.ts:487`) | `attribution.unattributable > 0` 이면 거부 |

둘 다 `attested_ack` 를 본다. `RangeAttribution` 에 `unattributableAttested?: number` 를 더해
`scopeRangeProblem` 이 "전부 attested 인가"를 물을 수 있게 한다.

### 🔴 무엇을 열고 무엇을 열지 않는가

**연다**: 귀속 불가 커밋이 **전부** `attested` 일 때.

**열지 않는다**(하나라도 섞이면 거부, `attested_ack` 와 무관):

- `unproven` · `invalid-evidence` — strict 증거 검증의 대상이다. 이 REQ 는 그것을 완화하지 않는다.
- `approved`(소비 행 없음) · `bookkeeping`(설명되지 않은 경로) — 증거가 깨진 상태다.
- 분류 결과에 없는 커밋(`null`) — **모르는 것**이다. 모름을 사람 확인으로 덮지 않는다.

### 왜 이것이 우회 플래그와 다른가

리포터의 제안 (c)(`--no-delivery` 같은 판정 시점 플래그)와 결정적으로 다른 점:

- **결정 시점이 다르다.** 실행 중에 판정을 덮는 것이 아니라, **통합 전에** 사람이 위임에 적는다.
- **되돌릴 수 있다.** `--revoke` 가 있다. 만료도 있다.
- **감사에 남는다.** 발급·소비·수행이 `workflow/delegations.jsonl` 에 append-only 로 남는다.
- **두 사람 몫의 결정이 겹친다.** `attest` 자체가 이미 사유를 요구하는 사람 결정이고
  (`workflow/attestations.jsonl`), 여기서 **한 번 더** 명시해야 통합에 탄다.

### 🔴 이 축이 넓히는 것 (감수하는 것)

`attested` 커밋의 **내용은 도구가 검증하지 않는다**. 그래서 `--allow-attested` 는 티켓 scope 위임이
"그 티켓에 귀속되지 않는 변경"을 함께 나를 수 있게 한다. 그것이 이 축의 실체이고, 감추지 않는다.

완화책: 통합 실행 보고에 **실제로 실린 attested 커밋의 SHA·제목**을 출력한다 — 사람이 무엇을 태웠는지
사후에도 볼 수 있어야 한다.

### 대안과 기각

| 안 | 기각 사유 |
|---|---|
| `attested` 를 귀속 가능으로 바꾼다 | 예외 승인 커밋이 **아무 위임에나** 딸려 온다. 이 판정은 옳다 |
| 판정 시점 플래그(`--allow-attested` 를 `integrate` 에) | 실행 중 판정 덮기 — 철회·만료·1회 소비가 없다 |
| 대화형 확인만 유지 | 리포트의 문제 그대로 — 에이전트·CI 가 멈춘다. 그리고 매번 `y` 를 누르면 fail-closed 가 형식이 된다 |
| 정책 판정에서 `attested` 를 무시 | `scopeRangeProblem` 이 여전히 막는다(한쪽만 고치는 형태) |

## DEC-4 — 계약 문서: 부기 트레일러는 도구만 붙인다

같은 리포트에서, 사람이 손으로 `CommitGate-Bookkeeping: true` 를 붙인 커밋이 `package.json` 을 바꿔
"손상 증거"로 막혔다. **게이트도 진단도 옳았다.** 다만 *"이 트레일러는 도구가 붙인다"* 는 서술이 계약
문서에 없어 같은 혼동이 재발한다. `AGENTS.template.md` 에 한 줄 넣는다.

🔴 `sync` 는 커밋하지 않으므로 고칠 코드가 없다 — 문서만이다.

## 가드

| # | 무엇 | 왜 공허하지 않은가 |
|---|---|---|
| G1 | 귀속 불가로 막힌 메시지에 `delivery` 가 **없다** · 막은 커밋의 SHA 와 범주가 **있다** | 리포트의 정확한 상태를 재현한 입력으로 본다 |
| G2 | `delivery-unreadable` 일 때만 delivery 안내가 나온다 | 반대 방향 — 통째로 지우면 red |
| G3 | `deliveryMembersOf` 가 **호출되지 않는다**(묶음 없음 · 귀속 불가만 있을 때) | 호출되면 throw 하는 스텁으로 확인 |
| G4 | `attested_ack` 없이는 `attested` 가 여전히 막는다 | 과잉 완화 검출 |
| G5 | `attested_ack` 가 있어도 `unproven`·`invalid-evidence`·`approved`(소비 행 없음)·`null` 이 **섞이면** 막는다 | 열지 않기로 한 것을 열지 않는지 — 범주별 전수 |
| G6 | 두 차단 지점(`resolveIntegrationPolicy`·`scopeRangeProblem`)이 **같은 입력에 같은 답** | 한쪽만 고치면 red |
| G7 | 통합 보고에 실린 attested 커밋의 SHA 가 나온다 | 무엇을 태웠는지 사후 확인 |
| G8 | `req:delegate --help` 와 `verb-help` 등록부에 새 플래그가 있다 | REQ-2026-166 의 수용 오라클이 자동으로 검사한다 |

G5 는 **범주마다 한 건씩** 돌린다 — 하나를 대표로 삼으면 나머지가 열려도 green 이다.

## Phase

| phase | 내용 |
|---|---|
| 1 | DEC-1·DEC-2 — 사유 구분 + 사유별 메시지 + G1·G2·G3 |
| 2 | DEC-3 — `--allow-attested`(원장·발급·두 차단 지점·보고) + G4~G8 |
| 3 | DEC-4 문서 + CHANGELOG · 버전 |

## 비목표

- `attested` 의 귀속 규칙 변경.
- strict 증거 검증 완화.
- `req:next` 의 delivery 판정 변경.
- 대화형 최종 확인 제거.
