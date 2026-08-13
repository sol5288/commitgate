# REQ-2026-140 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

| 자리 | 현재 |
|---|---|
| `lib/config.ts:75` | `StopGate = 'phase' \| 'req' \| 'merge'` · `AUTO_APPROVE_OF`·`STOP_GATE_OF`·`isStopGate` |
| `lib/evidence.ts:104` | `requiredConfirmScope` — **오버로드로 전체 union 호출자에게 ctx를 강제**한다 |
| `req-commit.ts` | `userConfirmGate(state, stopGate, isFinal)` |
| `bin/setup.ts` | `STOP_GATE_HIGH_NOTICE` — 값별 절(`phase:`·`req:`·`merge:`) |
| `bin/integrate.ts:284` | 사람 확인이 **대화형에서만** 걸린다 |
| `req-doctor.ts` | D28(HIGH 확인)·D32(정책 드리프트) |
| `docs/configuration*.md` | "**`stopGate: "auto"`는 없습니다**" 절 — 이 REQ로 거짓이 된다 |

**타입이 일부만 우리 편이다.** `StopGate`에 값을 더하면 `Record<StopGate, …>`와 오버로드는 컴파일
에러로 소비자를 드러낸다. 🔴 **그러나 `stopGate === 'merge'` 같은 비소진 분기는 드러내지 못한다** —
그런 자리에서 `auto`는 조용히 `req`처럼 동작한다. 실측(설계 리뷰 r01 지적 → grep 확인) **8곳**:

| 파일 | 자리 |
|---|---|
| `req-commit.ts:132` | `userConfirmGate` — merge면 커밋에서 안 멈춤 |
| `req-confirm.ts:161` | 확인 scope 판정 |
| `req-next.ts:868` · `:1011` · `:1155` | 종단 행동 · 업그레이드 안내 대상 · `deliveryGate` 조회 |
| `bin/delivery.ts:460` · `:465` · `:467` | delivery 멤버 판정 3곳 |
| `lib/config.ts:88` | `isStopGate` |

→ **DEC-2a**가 이것을 구조로 막는다.

## 핵심 설계 결정

### DEC-1 — 권한은 **설정이 아니라 레코드**에서 나온다

`stopGate: "auto"`는 *"위임이 있으면 그것을 따르겠다"*는 **모드 선언**일 뿐이다. 값을 바꾸는 것만으로는
아무 권한도 생기지 않는다. 이것이 사용자 제약("임의의 설정 변경으로 병합 권한이 생기면 안 된다")의
구조적 답이다.

| | 설정(`stopGate`) | 레코드(위임) |
|---|---|---|
| 무엇을 정하나 | 어느 **모드**로 도는가 | 무엇을 **해도 되는가** |
| 어떻게 바뀌나 | 파일 편집 | 사람 승인 문장 → 도구가 append |
| 없으면 | `req`처럼 동작 | **`AWAIT_HUMAN`** |

### DEC-2 — `auto`는 **`integrate`에서만** `merge`와 다르다

`auto`의 커밋 단계 의미는 `merge`와 **완전히 동일**하다(`AUTO_APPROVE_OF.auto = 'low-only'`,
`requiredConfirmScope`도 같은 분기). 다른 것은 **통합 지점 하나**다.

왜 이렇게 좁히나: 값 하나가 여러 축을 동시에 바꾸면 무회귀를 증명할 수 없다. `auto`가 `merge`의
**초집합**(= merge + 위임 소비)이면 "merge 경로 테스트가 auto에서도 그대로 참"이 자명해진다.

### DEC-2a — 등가는 **테스트가 아니라 구조**로 보장한다

위 8곳을 `stopGate === 'merge' || stopGate === 'auto'`로 고치면 **9번째 자리에서 또 틀린다**.
대신 술어 하나를 만들고 비교를 없앤다.

```ts
/** 확인을 통합 지점까지 미루는 값인가. 🔴 `=== 'merge'` 직접 비교를 이것으로 대체한다. */
export function defersToIntegration(sg: StopGate): boolean { return sg === 'merge' || sg === 'auto' }
```

- 8곳 전부 이 술어로 바꾼다.
- 🔴 **소스 검사 가드**: `scripts/`·`bin/` 어디에도 `stopGate` 문맥의 `=== 'merge'` 리터럴 비교가
  남지 않는다(정본 술어 파일만 예외). 이 저장소는 "배선 끊김은 순수 테스트가 못 잡는다"를 세 번
  실증했고(REQ-083·097·099), 같은 계열의 방어다.
- 등가 테스트는 **그 위에** 둔다: 같은 입력에 `merge`와 `auto`가 같은 판정을 낸다(통합 지점 제외).

### DEC-3 — 위임 원장은 **커밋되는 append-only JSONL** — `workflow/delegations.jsonl`

- `workflow/.integrate-runs.jsonl`(gitignored)와 **다르다**: 저건 관측 로그, 이건 **권한 근거**다.
  워킹트리에만 있으면 감사되지 않고, 위조·삭제가 흔적을 남기지 않는다.
- append-only. 상태는 행을 **접어서**(fold) 계산한다: `issued` → (`consumed` | `revoked`).
- 🔴 **소비 행은 feature 브랜치에 커밋한 뒤 병합한다.** 그러면 소비 사실이 **병합 자체에 실려** trunk로
  간다 — 별도 trunk 쓰기가 없어 CAS와 충돌하지 않는다.

```ts
type DelegationRow = Issued | Consumed | Revoked

interface Issued {
  kind: 'issued'
  id: string                    // crypto.randomUUID() — 도구가 만든다
  at: string                    // 🔴 도구가 실제 시계에서 읽는다
  scope: { kind: 'ticket'; req_id: string } | { kind: 'delivery'; slug: string }
  trunk_branch: string
  trunk_sha: string             // 발급 시점 trunk tip
  source_branch: string         // 허용된 feature/delivery 브랜치 (정확히 하나)
  base_sha: string              // 발급 시점 source tip
  expires_at: string            // at + TTL(도구 계산)
  permissions: { local_merge: boolean; origin_push: boolean; bypass_protection: boolean }
  high_risk_ack: boolean        // HIGH 위험 티켓의 **별도** 위임
  approval_sentence: string     // 사람이 말한 문장 그대로
}
interface Consumed { kind: 'consumed'; id: string; at: string; verified_sha: string; performed: Performed; outcome: 'merged' | 'aborted'; detail: string }
interface Revoked  { kind: 'revoked';  id: string; at: string; reason: string }
```

### DEC-4 — fail-closed 조건은 **한 함수의 진리표**다(흩뿌리지 않는다)

```ts
export function delegationVerdict(input: DelegationCheckInput): DelegationVerdict
// → { ok: true; row: Issued } | { ok: false; reason: DelegationDenyReason }
```

| 거부 사유 | 판정 근거 |
|---|---|
| `absent` | 대상 scope에 유효 `issued` 없음 |
| `revoked` / `consumed` / `expired` | fold 결과 · 만료는 **도구가 읽은 현재 시각** |
| `trunk-branch-mismatch` | `trunk_branch` ≠ 실제 통합 대상 브랜치 이름 |
| `trunk-moved` | `trunk_sha` ≠ 현재 trunk tip |
| `source-mismatch` | `source_branch` ≠ 병합 소스 |
| `scope-out-of-range` | 병합 범위에 **위임 scope 밖** 커밋이 있다(아래 DEC-4a) |
| `composition-changed` | delivery 구성이 발급 시점과 다름(멤버 집합·순서) |
| `evidence-mismatch` | strict 검증 결과가 결속 SHA와 불일치 |
| `high-risk-unacked` | 티켓 risk=HIGH 인데 `high_risk_ack=false` |
| `budget-hardcap` | `hardCap` 도달 |
| `review-inconclusive` | BLOCKED·미판정 리뷰 잔존 |
| `permission-denied` | 요청한 작업이 `permissions`에 없음 |

🔴 **`trunk-branch-mismatch`가 `trunk-moved`와 별개인 이유**(설계 리뷰 r02 P1): SHA만 비교하면
`main`과 `release`가 같은 커밋을 가리키는 순간 **이름 검사가 사라진다.** 그 상태에서 config의
`trunkBranch`를 바꾸면 `main` 대상으로 받은 위임으로 `release`에 병합된다. 두 검사는 **다른 것을
막으므로 둘 다** 필요하다 — 이름은 "어디에", SHA는 "어느 시점에"를 고정한다.

🔴 **`ok`는 이 표의 모든 항이 통과했을 때만이다.** 새 위험 축이 생기면 여기에 사유를 **더해야**
컴파일이 통과하도록 `DelegationDenyReason`을 union으로 두고, 안내 문구를 `Record<DelegationDenyReason, string>`
으로 강제한다(사유를 추가하고 안내를 빠뜨릴 수 없다).

🔴 **`trunk-moved`는 관대하게 풀지 않는다.** "trunk가 앞섰지만 충돌은 없다"를 허용하면 사람이 승인한
기준선이 아닌 것에 병합하게 된다. 위임은 **그 SHA에 대한** 위임이다.

### DEC-4a — 🔴 scope는 **병합 범위를 실제로 제한해야** 한다 (r02 P1)

위임은 "티켓 A를 통합해도 된다"인데, 검증은 **브랜치 전체**를 본다. 한 feature 브랜치에 티켓 A와 B의
승인된 커밋이 함께 있으면(이 저장소의 현재 체인이 정확히 그 모양이다 — 134~140이 한 줄로 쌓여 있다),
A로 받은 위임이 **B까지 통합**한다. 식별자를 적게 해 놓고 그것을 강제하지 않으면 그 칸은 장식이다.

**병합 범위의 티켓 귀속을 계산하고 scope와 대조한다.**

| 커밋 종류 | 귀속 판정 |
|---|---|
| 승인 소비 | 승인 증거 경로 `workflow/REQ-XXXX/`의 티켓 |
| 도구 부기 | 커밋 메시지의 `chore(REQ-XXXX):` |
| merge | 부모로 흡수 — 자체 귀속 없음 |
| attested | attestation 레코드의 대상 |
| 그 밖 | **판정 불가** |

- `scope.kind === 'ticket'`: 범위의 귀속 집합이 `{req_id}`의 **부분집합**이어야 한다.
- `scope.kind === 'delivery'`: 귀속 집합이 그 delivery의 **멤버 집합** 안이어야 한다
  (`composition-changed`와 별개 — 저건 "구성이 바뀌었나", 이건 "범위가 넘쳤나").
- 🔴 **판정 불가가 하나라도 있으면 `scope-out-of-range`로 거부한다.** 자율 통합의 권한 판정에서
  "모르겠음"을 통과로 읽으면 그것이 곧 구멍이다. (진단·조회 지점의 "모르면 판단 안 함"과 다르다 —
  여기는 **차단 지점**이고 이 저장소의 규칙은 차단 지점 fail-closed다.)

이 검사는 `verifyRangeDeep`이 이미 만드는 분류를 **재사용**한다. 새 분류기를 만들지 않는다.

### DEC-5 — CAS: 선점 후 실행. **소비 커밋 하나만이 검증 SHA와 병합 SHA 사이에 허용된다**

설계 리뷰 r01 P1이 잡은 모순: 소비 행을 feature에 커밋하면 tip이 `V`에서 `C`로 움직여
"검증한 SHA만 병합한다"가 깨지고, 그렇다고 `C`를 대상으로 하면 `C` 자신의 SHA를 `C` 안에 미리
적을 수 없다. **두 SHA를 하나로 만들려던 것이 오류였다.** 둘은 원래 다르고, 그 **차이를 계약으로
못 박는 것**이 답이다.

| 이름 | 무엇 |
|---|---|
| `V` | strict 검증을 **통과한** feature SHA. 실질 변경의 마지막 커밋 |
| `C` | `V` 위에 얹힌 **소비 커밋 하나**. `workflow/delegations.jsonl`만 바꾼다 |

**불변식(정확히 이것만 허용)**:
1. `rev-list V..C` 가 **정확히 `[C]`** — 그 사이 다른 커밋이 없다
2. `C`의 변경 경로가 **`workflow/delegations.jsonl` 하나뿐**
3. `C`가 담은 `consumed` 행의 `id`가 이 위임이고 `verified_sha === V`
4. trunk tip이 여전히 `T`
5. 그 뒤 **`C`를 병합**한다

`verified_sha`는 `V`를 적는다 — 실질 변경이 검증된 SHA는 `V`이고, `C`는 그 사실을 기록하는
**부기 커밋**이다. 이 저장소는 이미 같은 모양을 쓴다: REQ-2026-130의 delivery 승인 staleness 판정이
`rev-list <base>..<branch> -- ':(exclude)<ticketRoot>/delivery/*'`로 **자기 부기 커밋을 제외**한다.

🔴 **`C`는 strict 검증에서 `bookkeeping`으로 분류되어야 한다.** 그렇지 않으면 `unproven`이 되어
자기 소비 커밋 때문에 병합이 막힌다 — phase-4에서 실제 `verify-range` 분류로 확인한다(주장하지 않는다).

병합이 실패해도 위임은 **소진된다**. 재시도하려면 사람이 다시 발급한다. 반대로 하면(실행 후 기록)
병합과 기록 사이 중단에서 **권한이 두 번 쓰일 수 있다** — 소진은 되돌릴 수 있고(사람이 다시 말하면
된다) 이중 사용은 되돌릴 수 없다.

### DEC-5a — `local_merge`는 **발급 자체로 주어진다**. 옵션은 push·bypass뿐

설계 리뷰 r01 P1: `--allow-push`/`--allow-bypass`만 두면 `local_merge`를 참으로 만들 방법이 없어,
문서대로 발급한 사람이 정상 로컬 병합에서 `permission-denied`를 만난다.

위임의 **존재 이유가 로컬 병합**이므로 발급하면 `local_merge: true`다. 세 권한을 나란히 두고 셋 다
opt-in으로 만들면 "아무것도 못 하는 위임"이라는 무의미한 상태가 기본값이 된다.

| 권한 | 어떻게 켜지나 |
|---|---|
| `local_merge` | **발급하면 참** |
| `origin_push` | `--allow-push` |
| `bypass_protection` | `--allow-bypass` |

### DEC-6 — push·bypass는 **기본 거부**이고 `integrate`의 계약을 바꾼다

현재 `integrate`는 **push를 하지 않는다**고 help·문서·주석이 명시한다. 이 REQ가 그것을 바꾼다.

- `origin_push`가 참일 때만 push한다. 위임에 없으면 **로컬 병합까지만** 하고 그대로 끝낸다(오류 아님).
- `bypass_protection`이 참일 때만 보호 우회를 시도한다. **사용했다면** 원장 `performed`와
  최종 보고 양쪽에 남긴다 — "썼다는 사실"이 보고에서 빠지면 우회가 조용해진다.
- 🔴 두 권한은 **독립**이다. push 허용이 bypass 허용을 함의하지 않는다.
- help·`docs/*`의 "push하지 않습니다" 서술을 **같은 phase에서** 고친다(REQ-2026-136 교훈: 동작 확대와
  문서 갱신은 같은 phase).

### DEC-7 — 두 `auto`의 관계 (필수 7)

| 축 | `auto`가 없애는 것 | 남는 것 |
|---|---|---|
| `reviewBudget.onSoftLimit` | 소프트 초과 회차의 **사람 예외 승인** | `hardCap` 정지 |
| `stopGate` | 통합 지점의 **사람 확인 대기** | 위임 검증·리뷰 승인·HIGH·BLOCKED·`hardCap` |

🔴 **둘 다 `hardCap`을 풀지 않는다.** `stopGate: "auto"`에서도 `hardCap` 도달은 `delegationVerdict`의
`budget-hardcap`으로 **거부**된다 — 비용 상한이 자율 모드에서 무한화되지 않는다.

### DEC-8 — 발급은 `req:delegate`, 판단은 사람 · 실행은 도구

`req:confirm`과 같은 구조다(`docs/agent-prompt.md`가 이미 정한 경계): 사람이 승인 문장을 말하고,
에이전트가 그 문장을 **그대로** 넘겨 도구를 실행하며, **시각·SHA·만료는 도구가 읽는다.**

```
npx commitgate req:delegate --scope ticket:2026-140 --source <branch> \
  --sentence "<사람이 말한 문장 그대로>" [--allow-push] [--allow-bypass] [--high-risk] --run
npx commitgate req:delegate --revoke <id> --reason "..." --run
npx commitgate req:delegate --status
```

🔴 **에이전트가 문장을 지어낼 수 없게** 하는 것은 도구가 아니라 계약이다(오늘 `req:confirm`과 같은 한계).
도구가 보장하는 것은 **시각·SHA·만료·소비의 정직성**이다. 이 한계를 문서에 명시한다 — 보장하지 않는
것을 보장한다고 적지 않는다.

### DEC-9 — 🔴 `auto`는 **동작이 완성되는 phase에서만** 사용자에게 노출된다

설계 리뷰 r01 P1: phase-1이 `auto`를 setup·스키마에 노출하면서 문서 정정을 마지막으로 미루면,
그 중간 커밋의 사용자는 `auto`를 **고를 수 있는데** 문서는 "그런 값은 없습니다"라고 말한다.
문서를 앞당겨도 마찬가지다 — 그때는 **아직 없는 통합 동작**을 설명하게 된다.

두 거짓 중 하나를 고르는 문제가 아니라 **순서가 틀린 것**이다. 노출을 마지막으로 옮긴다.

| | phase 1~4 | phase 5 |
|---|---|---|
| `StopGate` 타입·술어·내부 소비자 | ✅ 있음 | — |
| 위임 모델·verb·`integrate` 배선 | ✅ 있음 | — |
| **config 스키마 enum · setup 선택지** | ❌ **없음** | ✅ 추가 |
| **문서(configuration의 "없습니다" 절 포함)** | ❌ 손대지 않음 | ✅ 정정 |

즉 phase 1~4에서 `auto`는 **내부 타입으로만** 존재하고 어떤 사용자도 그 값을 설정할 수 없다.
스키마가 거부하므로 손편집으로도 들어오지 못한다 — 그래서 그 구간의 문서는 **여전히 참**이다.
phase-5가 **노출과 문서를 같은 커밋에** 넣는다(REQ-2026-136 교훈: 동작 확대와 문서 갱신은 같은 phase).

## Phase별 구현

| phase | 범위 | 왜 여기서 끊나 |
|---|---|---|
| 1 | `StopGate`에 `auto` **타입만** 추가 · `defersToIntegration` 술어 도입과 8곳 치환 · 소스 가드 · `AUTO_APPROVE_OF`·`requiredConfirmScope`·`userConfirmGate`·D28/D32 · `auto ≡ merge` 등가 테스트. **스키마·setup은 건드리지 않는다** | 등가를 구조로 먼저 세운다. 노출이 없으니 어떤 중간 커밋도 거짓을 말하지 않는다 |
| 2 | 위임 레코드 모델 — 타입·파싱·fold·`delegationVerdict` 진리표(**순수**) · 거부 사유 union·안내 매핑 | 순수 코어를 먼저 고정한다. 배선 없이 진리표 전수를 테스트할 수 있다 |
| 3 | `req:delegate` verb(발급·철회·status) · 원장 append·커밋 · 실제 시계·SHA 읽기 | 발급 경로가 있어야 통합 경로를 실제로 테스트한다 |
| 4 | `integrate` 배선 — 위임 요구·**DEC-5 불변식 5항**·CAS 선점 · push/bypass 분리 실행 · 원장 `performed`·최종 보고 · `C`가 strict에서 `bookkeeping`으로 분류됨을 **실측 확인** | 실제 trunk를 바꾸는 지점. 앞 셋이 다 있어야 한다 |
| 5 | **노출**(스키마 enum·setup 선택지) + `req:next` 종단 + README/configuration/workflow(ko·en) + "없습니다" 절 정정·폐기 문구 등재 + CHANGELOG | DEC-9 — 노출과 문서가 **같은 커밋** |

🔴 phase-1·4·5는 **파일 수가 많다**(D18 WARN 가능). 리뷰 면적이 커지면 런타임 분할한다(1a/1b, 4a/4b, 5a/5b).

## 변경 파일 (예상)

`lib/config.ts` · `lib/evidence.ts` · `lib/delegation.ts`(신규) · `req-delegate.ts`(신규) ·
`req-commit.ts` · `req-next.ts` · `req-doctor.ts` · `bin/setup.ts` · `bin/integrate.ts` ·
`schema/*.json` · `README*.md` · `docs/configuration*.md` · `docs/workflow*.md` · `CHANGELOG.md` ·
`lib/retired-claims.ts` · 테스트 다수.

## 하위호환·안전

- **`auto`를 고르지 않은 모든 사용자에게 동작 변경 없음.** 무회귀는 phase-1에서 `auto ≡ merge`로,
  phase-4에서 "위임 없으면 현행과 동일한 `AWAIT_HUMAN`"으로 각각 고정한다.
- 🔴 **이 REQ 자신은 `auto`로 통합하지 않는다.** 도그푸딩의 유혹이 있지만, 자기 권한을 만드는 변경을
  그 권한으로 통합하면 그 경로가 처음 쓰이는 순간이 곧 검증되지 않은 순간이다. 이 체인은 사람 승인으로
  통합한다.
- 🔴 **보장하지 않는 것을 적지 않는다**: 도구는 승인 문장이 실제 사람에게서 왔는지 검증하지 못한다.
  `req:confirm`과 같은 한계이며 문서에 그대로 쓴다.
