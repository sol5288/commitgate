# REQ-2026-159 설계

## DEC-1 — `integrate` 도 **정본 resolver** 로 판정한다

`bin/integrate.ts` 가 `cfg.stopGate` 를 직접 쓰는 자리를 없앤다. 판정은 `effectiveStopGate` 와
**같은 규칙**에서 나와야 한다 — 규칙을 두 벌 만들면 그 둘이 갈라지는 것이 다음 결함이다.

```
readTicketFacts(...)  →  policy_snapshot.stop_gate 도 함께 읽는다
resolveIntegrationStopGate(facts, cfg)  →  { kind: 'resolved', stopGate } | { kind: 'indeterminate', lines }
delegationGate(..., resolvedStopGate)   →  deps.stopGate 대신 이 값을 본다
```

- 🔴 **`state.json` 은 이미 결속된 feature SHA 에서 읽는다**(`prepared.featureHeadSha`).
  워킹트리에서 읽으면 검증한 SHA 와 다른 것을 보게 된다 — `readTicketFacts` 가 이미 그렇게 한다.

## DEC-2 — 해소는 **멤버별 `effectiveStopGate`** 하나로 한다 (설계 r01 P1)

r01 P1: "그 외 → `cfg.stopGate`"로 합치면 **유효한 `merge` 스냅샷이 버려진다** —
`merge` 로 만든 티켓만 담은 묶음이 나중에 `auto` config 를 만나면 **없던 위임 요구**가 생긴다.
목표 1과 DEC 의 역방향 보장에 정면으로 어긋난다.

그래서 합치기 규칙을 따로 만들지 않는다. **멤버마다 정본 resolver 를 적용하고, 그 결과만 합친다.**

```
멤버별 유효 정책 = effectiveStopGate(멤버 state, cfg)     ← SSOT 재사용. 새 규칙 아님
                    (스냅샷 유효 → 그 값 · 부재/손상 → cfg)

멤버 중 하나라도 state 를 **읽지 못함**  → indeterminate → 거부   (fail-closed)
멤버별 유효 정책 중 하나라도 "auto"      → 위임 필요
그 외                                     → 위임 불필요
```

**ticket scope 는 멤버가 하나인 경우**다 — 규칙이 하나뿐이므로 두 scope 가 갈라질 자리가 없다.

이 규칙이 요구된 네 방향을 모두 만족한다:

| 스냅샷 | config | 결과 | 왜 |
|---|---|---|---|
| `auto` | `merge` | **위임 필요** | 스냅샷이 이긴다 — 나중 config 로 약화되지 않는다 |
| `merge` | `auto` | 위임 불필요 | 스냅샷이 이긴다 — 없던 요구가 생기지 않는다 |
| 묶음: `merge`+`merge` | `auto` | 위임 불필요 | 🔴 **r01 P1 이 잡은 경우** |
| 묶음: `auto`+`merge` | `merge` | **위임 필요** | 하나라도 auto 면 그 티켓의 통제가 사라지므로 |
| 없음(legacy) | `merge`/`auto` | config 를 따름 | legacy 무회귀 |
| 묶음: legacy + `merge` | `auto` | **위임 필요** | legacy 멤버는 **실제로** config 지배 — 지어내지 않는다 |

- 🔴 **"하나라도 auto"인 이유**: 묶음은 한 번에 병합된다. auto 로 시작한 티켓 하나가 위임 없이
  들어가면 그 티켓의 통제는 사라진다. 다수결·평균은 이 성질을 지키지 못한다.
- 🔴 `phase`·`req`·`merge` 는 **통합 통제점에서 구별되지 않는다**(오늘 `delegationGate` 가 셋 모두
  `not-required`). 그래서 해소 결과를 `StopGate` 로 돌려주지 않고 **`delegationRequired: boolean`**
  으로 돌려준다 — 없는 구별을 타입으로 지어내지 않는다.
- 🔴 멤버 **목록** 자체를 읽지 못하는 경우는 **이미 scope 검사가 거부**한다
  (`readDeliveryFacts` → `members: null`). 여기서 다시 판정하지 않는다.

**"읽지 못함"은 legacy 가 아니다.** legacy 는 "state 를 읽었고 스냅샷이 없다"이다. 읽지 못한 것은
**어느 정책이 지배하는지 모른다**는 뜻이고, 통합은 되돌리기 비싼 단계다.

- ⚠️ 이것은 `merge`·`req` 경로의 **좁은 동작 변경**이다(오늘은 그대로 병합된다). 의도적이다:
  `readTicketFacts` 는 이미 같은 입력을 못 읽으면 `riskLevel: 'HIGH'` 로 되돌린다 — 같은 사실을
  위험도에는 fail-closed 로 쓰면서 정책 판정에는 "모르니까 통과"로 쓰는 것이 모순이다.
- 🔴 거부 메시지는 **무엇을 못 읽었는지·어떻게 진행하는지**를 적는다(경로 · 결속 SHA ·
  사람 확인으로 통합하려면 대화형에서 실행).

## DEC-3 — 해소 결과 타입

```ts
export type IntegrationPolicy =
  | { kind: 'indeterminate'; lines: string[] }
  | { kind: 'resolved'; delegationRequired: boolean; basis: string }
```

- `basis` 는 **왜 그렇게 판정했는지**를 사람 말로 담는다(예: `티켓 스냅샷 auto` ·
  `config auto(legacy 티켓)` · `묶음 멤버 REQ-2026-xxx 스냅샷 auto`). 보고에 그대로 쓴다.
- 🔴 판정 이유를 로그로만 남기고 타입에서 빼면, 다음 사람이 이유를 **다시 계산**한다.

## DEC-4 — `delegationGate` 의 시그니처를 바꾼다

```ts
export function delegationGate(
  deps: Pick<RunDeps, 'readDelegationLedger' | 'now' | 'branchPrefix' | 'ticketRoot' | 'git' | 'readBlobs'>,
  prepared: PreparedIntegration,
  ticketFacts: AutoFacts,
  delegationRequired: boolean,   // ← 추가. deps.stopGate 는 더 이상 읽지 않는다
): DelegationGateResult
```

- 🔴 **`deps` 에서 `stopGate` 를 빼는 것**이 핵심이다. 남겨 두면 다음 사람이 다시 그걸 읽는다.
  타입으로 못 읽게 만든다(`Pick` 에서 제외 → 참조하면 tsc 가 잡는다).
- `RunDeps.stopGate` 자체는 남긴다 — 해소 함수가 legacy 폴백에 쓴다.

## DEC-5 — 회귀는 **`runIntegrate` 를 태운다**

순수 함수만 검사하면 배선이 끊겨도 green 이다 — 이 저장소가 네 번 밟았다.
**비대화형 + `--run`** 시나리오로 다섯 가지를 본다.

| # | 스냅샷 | config | 위임 | 기대 |
|---|---|---|---|---|
| 1 | `auto` | `merge` | 없음 | **exit 1 · merge 호출 0회** |
| 2 | `merge` | `auto` | 없음 | 기존 merge 동작 보존(병합됨) |
| 3 | `auto` | `merge` | 유효 | 통합됨 · 위임 소비 |
| 4 | delivery(`auto` + `merge` 혼합) | `merge` | 없음 | **거부** |
| 5 | 없음(legacy) | `merge` | 없음 | 현재 config 동작 보존 |
| 6 | **delivery(`merge` + `merge`)** | **`auto`** | 없음 | **병합됨** — 🔴 r01 P1 의 회귀 |
| 7 | state 읽기 실패 | `merge` | 없음 | **exit 1 · merge 호출 0회**(fail-closed) |

- 🔴 **"merge 호출 0회"까지 본다.** exit code 만 보면 병합한 뒤 실패한 경우와 구분되지 않는다.
- 🔴 **변이 검사**: 해소 함수를 `cfg.stopGate === 'auto'` 반환으로 되돌리면 **#1·#3·#4·#6** 이 red.
  🔴 #6 이 red 가 되는지 반드시 확인한다 — 그것이 r01 P1 을 실제로 막는 오라클이다.

## DEC-6 — `AGENTS.template.md` 계약에 `auto` 를 넣는다 (세 곳 전부)

관측된 두 곳만 고치지 않는다 — **전수로 훑는다**.

| 위치 | 고칠 것 |
|---|---|
| 57행 | "`phase`/`req`/`merge` 와 무관하게 항상" → `auto` 를 포함한 정확한 서술 |
| 75~77행 | 정지 지점 열거에 `auto` 추가 |
| 81~83행 | "어느 값에서도 필요하다" → 조건부로 정정 |
| 관리 블록 `commitgate:autonomy` 예외표 #1 | `auto` + 유효 위임의 예외를 명시 |

정본 문장(한 번 정하고 재사용):

> `phase`·`req`·`merge` — 통합(main 병합) 승인은 **항상** 필요하다.
> `auto` — **유효한 사전 위임이 없으면 `merge` 와 똑같이 멈춘다.** 유효한 위임이 있으면 사람이
> 다시 승인하지 않고 통합한다(그것이 위임의 목적이다).
> 🔴 **`auto` 에서도 멈추는 것**: HIGH 위험 미위임 · `hardCap` 도달 · 리뷰 `BLOCKED` ·
> 위임 범위 밖 변경 · 위임의 만료·철회·이미 소비됨.

- 🔴 **`stopGate` 와 `reviewBudget.onSoftLimit` 을 한 문장에 섞지 않는다**(REQ-2026-158 DEC-3).
- 🔴 초보자 기준: 내부 용어를 처음 쓸 때 괄호로 쉬운 뜻을 붙인다.

## DEC-7 — 회귀 가드: 계약 테스트

`tests/unit/agent-autonomy-contract.test.ts` 에 추가한다.

1. 계약 본문에 `auto` 가 **정지 지점 열거**와 **통합 승인 설명** 양쪽에 나온다.
2. **금지 문자열**: "어느 값에서도 필요하다" 같은 옛 단정이 없다(축자).
3. `auto` 에서도 멈추는 조건 다섯이 계약에 적혀 있다.
4. 🔴 **정지 지점 열거가 `StopGate` enum 전체를 덮는다** — 목록을 손으로 적지 않고
   **`CONFIG_SCHEMA` 에서 파생**한다. 축이 늘면 자동으로 red(REQ-2026-158 의 교훈).

## DEC-8 — 기존 프로젝트 이행

- 🔴 **`AGENTS.md` 를 자동으로 덮어쓰지 않는다**(사용자 소유 · 프로젝트 고유 규칙이 섞여 있다).
- 관리 블록(`commitgate:autonomy`)은 **`quickstart --apply` 가 이미 갱신 경로**다 — 새로 만들지 않는다.
- 관리 블록 **밖**(57·75~83)은 사용자 소유라 도구가 못 고친다 → **`retired-claims.ts` 에 항목 추가**.
  `commitgate check` C5 가 "이 계약은 auto 통합 규칙 이전 버전"이라고 **구체적으로** 말한다.
  - 🔴 `retired-claims.ts` 는 이미 **매칭의 정본**이다(REQ-2026-112). 새 판정기를 만들지 않는다.
  - 🔴 문구는 **축자 문자열**로 넣는다 — 정규식으로 "옛 서술 같은 것"을 잡으려 들면 그 패턴이
    다음 결함이 된다.

## Phase 분해

| phase | 내용 |
|---|---|
| `phase-1-integration-policy-binding` | DEC-1~5 (코드 + `runIntegrate` 회귀) |
| `phase-2-contract-and-migration` | DEC-6~8 (계약 문서 · 계약 테스트 · retired-claims) |
| `phase-3-policy-target-binding` | DEC-9 (정책 대상 결속 — 외부 리뷰 P1) |

축이 셋(도구 게이트 / 문서 계약 / 정책 대상 결속)이고 각각 독립 검증이 가능하므로 나눈다.
🔴 phase-3 은 phase-1·2 이후에 외부 리뷰가 낸 P1 이다 — **통합 전에 반드시 수행한다.**

## 변경 파일

**phase-1**: `bin/integrate.ts` · `tests/integration/integrate-*.test.ts`(신규 또는 확장)
**phase-2**: `AGENTS.template.md` · `scripts/req/lib/retired-claims.ts` ·
`tests/unit/agent-autonomy-contract.test.ts` · `docs/configuration*.md` · `docs/workflow*.md` ·
`docs/ssot-design/04-*.md` · `scripts/req/lib/config.ts` · `CHANGELOG.md`
**phase-3**: `bin/integrate.ts` · `tests/unit/integrate-delegation.test.ts` ·
`tests/support/integrate-fakes.ts` · `AGENTS.template.md` · `docs/workflow.md` · `CHANGELOG.md`

## 안전

- 🔴 `hardCap` · HIGH · BLOCKED · 범위 밖 변경 · 위임 만료/철회/소비 정지는 **건드리지 않는다**.
- 🔴 legacy 티켓(스냅샷 없음)의 동작을 바꾸지 않는다.
- 🔴 **의도적 동작 변경은 둘**이고 CHANGELOG 에서 **구분해 적는다**:
  ① DEC-2 — 티켓 state·묶음 레코드를 **읽지 못하면** 판정 불가(비대화형 거부 · 대화형 확인).
  ② DEC-9 — **정책 대상을 확정할 수 없으면**(대상 없음 또는 모름) 판정 불가. 예전의
     "대상이 비면 config 를 따른다" 폴백이 사라진다.

## DEC-9 — 정책 대상과 위임 대상을 **분리**한다 (phase-3)

| | 무엇으로 정하나 | 왜 |
|---|---|---|
| **위임 권한** | 브랜치에서 확정한 scope **만**(`scopeOfBranch`) | 원장을 뒤져 "이 브랜치를 가리키는 위임"을 고르게 하면 그 선택이 곧 권한 확대다(REQ-2026-140) |
| **정책** | 브랜치 scope **∪ 범위의 커밋 귀속**(`attributeRange`) | 브랜치 이름은 사람이 언제든 바꿀 수 있고, 그것이 `auto` 스냅샷을 약화시키는 통로가 되면 안 된다 |

```
policyTargetIds(attribution, scope, deliveryMembersOf) : string[] | null
  귀속되지 않은 커밋이 하나라도 있음  → null (모름)
  묶음 멤버를 읽지 못함                → null (모름)
  그 외                                → 귀속 티켓 ∪ 묶음 멤버 ∪ 브랜치 scope 대상
```

- 🔴 **대상이 비면 config 로 폴백하지 않는다.** `resolveIntegrationPolicy` 의 그 분기를 **제거**하고
  판정 불가로 바꾼다. 비대화형은 거부, 대화형은 최종 확인(DEC-2 와 같은 처리).
- 🔴 브랜치 scope 를 **합친다**(더 좁게 읽지 않는다) — 귀속이 놓친 티켓을 잃지 않기 위해서다.
- 🔴 **`[]` 와 `null` 은 다르다.** `[]` = 대상 없음, `null` = 모름. 둘 다 판정 불가로 가지만
  메시지가 다르고, 무엇보다 **`[]` 가 판정 불가로 이어지는지에 오라클이 필요하다** —
  첫 변이 검사에서 폴백을 되돌렸는데 green 이었다(순수 함수가 `[]` 를 돌려주는 것만 봤다).
