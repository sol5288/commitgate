# REQ-2026-130 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

`DeliveryRecord`(`scripts/req/lib/delivery.ts`)에 승인 대상 SHA가 없다. 승인은 상태 전이 하나다:

```ts
// cmdApprove(bin/delivery.ts)
commitTransition(ctx, slug, record, 'approved', 'approved', confirmSentence('approve', slug), io)
// deliveryGateVerdict(lib/delivery.ts)
if (r.state === 'approved') return { kind: 'continue', detail: '이미 통합 승인이 기록됐습니다 — …' }
```

`OPTIONAL_RECORD_KEYS`는 **빈 배열이고 additive 확장을 위해 자리를 열어 둔 것**이다(REQ-2026-064 교훈:
허용 키 == 필수 키로 두면 키 추가가 이미 커밋된 모든 파일을 무효화한다). 이 REQ가 그 자리를 쓴다.

`commitTransition`은 delivery 브랜치로 checkout해 레코드를 커밋하고 원래 자리로 되돌린다 —
승인 시점 HEAD SHA를 읽을 수 있는 지점이 그 함수 호출 **직전**이다.

## 핵심 설계 결정

### DEC-1 — 승인은 **승인 직전 HEAD**에 결속되고, staleness는 **레코드 밖 커밋**으로 판정한다

레코드에 선택 키를 추가한다:

```jsonc
"approval": { "base_sha": "<40자·승인 직전 delivery 브랜치 tip>", "at": "<ISO·실제 시계>" }
```

🔴 **`base_sha`는 `HEAD`가 아니라 `rev-parse delivery/<slug>`다**(설계 r02 P1). `cmdApprove`는 다른
브랜치에 선 채로 실행할 수 있고(이 도구는 **위치 비의존**이 계약이다 — `commitTransition`이 필요할 때
옮겼다가 되돌린다), 그때 `HEAD`는 그 사람이 서 있던 feature 브랜치 X다. X를 기준점으로 삼으면
`rev-list X..delivery/<slug>`가 **묶음의 기존 member 커밋 전부**를 내놓아, 승인 뒤 아무 변경이 없어도
즉시 stale이 된다. 기준점은 **승인이 대상으로 삼은 브랜치 자신의 tip**이다.

🔴 **HEAD를 그대로 비교하면 승인이 즉시 자기 자신을 무효화한다**(설계 r01 P1). `cmdApprove`는
`commitTransition`으로 delivery 브랜치에 **레코드 커밋을 하나 더 만든다**. 승인 시점 HEAD를 A라 하면
승인 직후 HEAD는 B이고, A≠B이므로 방금 받은 승인이 곧바로 stale이 된다. 재승인도 새 커밋을 만들어
같은 일이 반복된다 — 정상 경로가 **완료 불가**가 된다.

그래서 판정 질문을 바꾼다: "HEAD가 움직였는가"가 아니라 **"승인 이후 delivery 레코드 밖을 건드린 커밋이
있는가"**다.

```
git rev-list <approval.base_sha>..<delivery branch> -- ':(exclude)<ticketRoot>/delivery/*'
```

비어 있으면 승인은 유효하고, 하나라도 있으면 **승인한 내용과 다른 것이 병합 대상**이다.

🔴 이 판정 방식은 **이 저장소에 이미 있다** — `integrateEligibilityProblems`의 `postEvidenceCodeCommits`가
같은 `rev-list … ':(exclude)…'` 형태로 "승인 뒤 덧붙은 미검수 코드"를 찾는다. 새 개념을 만들지 않고
같은 오라클을 묶음 층에 적용한다.

- `OPTIONAL_RECORD_KEYS`에 `'approval'`을 넣는다 — 없어도 통과(옛 레코드 무회귀), 있으면 형식을 검증한다.
- 🔴 `at`은 **주입된 실제 시계**(`io.now()`)에서 읽는다. 다른 전이 이벤트와 같은 원천이다.

**왜 결속하는가**: 이 저장소는 phase 층에서 이미 같은 결속을 한다 — D9(`staged tree == approved tree`),
`unknownApprovedTrees`(승인 이후 history rewrite 탐지). 묶음 층만 플래그였다.
"승인했다"와 "무엇을 승인했다"는 다른 진술이고, 후자만이 감사에서 쓸모가 있다.

### DEC-2 — 판정은 `deliveryGateVerdict` 하나가 계속 소유한다(입력만 늘린다)

```ts
export function deliveryGateVerdict(r: DeliveryRecord, ctx?: { postApprovalCommits?: string[] | null }): DeliveryGateVerdict
```

- `state === 'approved'` 이고 `r.approval?.base_sha` 가 있고 `ctx.postApprovalCommits` 가 **비어 있지
  않으면** → `await-human`(재승인 필요, 사유에 커밋 앞 8자 몇 개).
- 그 외 `approved` → 현행 `continue`.
- 🔴 **git 실행은 호출부가 한다.** `lib/delivery.ts`는 fs·git을 import하지 않는 순수 모듈이라는 계약을
  유지한다 — 호출부가 `rev-list` 결과를 넘긴다.
- 🔴 **`ctx` 는 선택이다.** 주지 않으면 staleness를 판정하지 않고 현행과 같이 동작한다 — 순수 모델을
  테스트하는 기존 호출부를 깨뜨리지 않는다.
- 🔴 **`null`(판정 불가)은 "달라졌다"가 아니다.** git이 잠깐 실패한 것만으로 승인이 무효가 되면 안 된다.
  모르면 현행 유지다.

### DEC-3 — 옛 레코드(승인 SHA 없음)는 **무조건 통과**

`r.approval`이 없으면 staleness를 판정할 근거가 없다. 소급 요구하면 이미 승인받은 묶음이 영구히 막힌다.
🔴 이 저장소는 소급 요구로 티켓을 가둔 적이 있다(REQ-2026-072). 반복하지 않는다.

### DEC-4 — 소비자를 **이름으로 정확히** 식별한다

`integrate` 라는 이름이 이 저장소에 **둘** 있고 층이 다르다(설계 r01 P1-b — 초안이 둘을 뭉뚱그렸다).

| 이름 | 무엇을 병합하나 | 승인 staleness를 보는가 |
|---|---|---|
| `commitgate delivery integrate` | member feature → **delivery 브랜치** | **아니오** — 승인 **이전** 단계다. 여기서 보면 순서가 뒤집힌다 |
| `commitgate integrate` | 현재 브랜치 → **trunk** | **예** — 소스가 `delivery/*` 면 그 묶음의 승인이 병합 인가다 |

staleness를 넘기는 소비자:

| 소비자 | 계산 |
|---|---|
| `delivery status` | `ctx.git rev-list <base>..<branch> -- ':(exclude)…'` |
| `seal`/`approve` 직후 게이트 출력 | 같은 계산 |
| `req:next`(`readDeliveryGate`) | 주입된 `roGit`으로 같은 계산(새 의존 없음) |
| `commitgate integrate`(소스가 `delivery/*`) | 같은 계산 — **여기서는 안내가 아니라 차단**이다 |

🔴 `commitgate integrate`에서만 차단인 이유: 다른 셋은 "다음에 무엇을 하라"는 **안내**이고, 여기는
**실제로 trunk를 바꾸는 지점**이다. 안내를 무시하고 병합하는 경로가 남으면 이 REQ는 아무것도 막지 못한다.

## Phase별 구현

- **phase-1**: 레코드 선택 키 `approval` + 형식 검증 · `cmdApprove`가 승인 직전 HEAD를 `base_sha`로 기록 ·
  `deliveryGateVerdict(r, ctx?)` staleness 분기 · 안내 소비자 셋 배선(`status`·전이 직후·`req:next`) · 테스트.
- **phase-2**: `commitgate integrate`에서 소스가 `delivery/*`일 때 **차단** 배선 + 테스트.
- **phase-3**: 문서(`docs/workflow*.md` delivery 절) + `CHANGELOG.md`.

## 변경 파일

| phase | 파일 |
|---|---|
| 1 | `scripts/req/lib/delivery.ts` · `bin/delivery.ts` · `scripts/req/req-next.ts` · `tests/unit/delivery.test.ts` · `tests/unit/delivery-verbs.test.ts` |
| 2 | `bin/integrate.ts`(또는 `lib/merge-gate.ts`) · `tests/unit/*` |
| 3 | `docs/workflow.md` · `docs/workflow.en.md` · `CHANGELOG.md` |

## 하위호환·안전

- 승인 SHA 없는 레코드: 무변경.
- 승인 후 브랜치가 움직이지 않은 정상 경로: 무변경(`continue`).
- 새로 막히는 경로: **승인 후 커밋이 더 들어온 묶음** — 그것이 이 REQ의 목적이다.
  탈출구는 기존 `delivery approve`(재승인) 하나뿐이고 새 개념을 만들지 않는다.
- 보증 범위: `approval.base_sha`는 delivery 브랜치의 파일에 기록되므로 **일관되게 위조**할 수 있다
  (이 저장소의 다른 모든 커밋된 증거와 같은 수준). 막는 것은 **실수와 절차 이탈**이지 적대적 위조가
  아니다 — 절대적 보증을 주장하지 않는다.
