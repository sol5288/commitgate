# REQ-2026-128 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

`resolveNext` 종단(`scripts/req/req-next.ts`, `worktreeReviewClean && !hasStagedChanges` 블록):

```
if (stopGate === 'merge') {
  deliveryGate.kind === 'corrupt'      → BLOCKED
  deliveryGate.kind === 'await-human'  → AWAIT_HUMAN(묶음 통합)
  그 외(= 'continue' 또는 null)        → DONE          ← null 이 문제
}
if (phaseCommitAutoApprove === 'low-only') → AWAIT_HUMAN(통합 feature→main)
→ DONE   // never
```

- `deliveryGate === null` = **이 REQ 가 어떤 묶음에도 속하지 않음**(`readDeliveryGate` 가 `refs/heads/delivery/*`
  를 훑어 member 로 언급한 레코드를 못 찾음). 이 경우가 `'continue'` 와 **같은 가지로 흡수**돼 있다.
- 확인 scope 는 상수표 `REQUIRED_CONFIRM_SCOPE = { phase:'phase', req:'req', merge:'delivery' }`
  (`lib/evidence.ts`)에서 나오고, `req-next`·`req-commit`·`req-confirm`·`bin/delivery` 네 곳이 각각 인덱싱한다.
  `merge` 는 **묶음이 있을 때만** `'delivery'` 가 참인데 표는 그 조건을 담지 못한다.

## 핵심 설계 결정

### DEC-1 — `merge` + 묶음 없음의 종단은 `req` 종단과 **같다**

`deliveryGate === null` 이면 `DONE` 이 아니라 `AWAIT_HUMAN`(통합 feature→main)이다. 승인 문장·통제점은
일반 통합 경로와 **같은 상수**(`integrationPathGuidance()`)에서 파생한다 — 손으로 적으면 갈라진다(실제로 갈라졌던 이력).

🔴 **`'continue'` 는 반드시 `DONE` 을 유지한다.** 묶음이 열려 있거나 다른 member 가 남은 상태에서 멈추면
`merge` 가 REQ 단위 정지로 되돌아가 이 값의 존재 이유가 사라진다. 이번 변경은 **`null` 가지 하나**만 옮긴다.

**왜 `DONE` 이 틀렸는가**: `DONE` 은 "이 티켓 종료, 다음 REQ 를 열어도 좋다"는 뜻이다. 묶음이 없으면
이 REQ 다음에 올 것은 **통합**이지 다음 REQ 가 아니다. `req` 가 같은 자리에서 `AWAIT_HUMAN` 을 내는 이유와 동일하다.

### DEC-2 — 확인 scope 판정을 **상수표 → 함수**로 승격(SSOT 단일화)

```ts
// lib/evidence.ts
export function requiredConfirmScope(stopGate: StopGate, ctx: { inDeliverySet: boolean }): ConfirmScope
//   phase → 'phase'
//   req   → 'req'
//   merge → ctx.inDeliverySet ? 'delivery' : 'req'
```

- `export const REQUIRED_CONFIRM_SCOPE` 는 **제거**하고 함수만 남긴다. 두 표면이 공존하면 "정본 한 곳"
  계약이 깨지고, 조건을 못 담는 표가 계속 쓰인다.
- 소비자 넷이 전부 이 함수를 쓴다: `req-next`(안내), `req-commit`(`userConfirmGate`), `req-confirm`(입력 검증),
  `bin/delivery`(integrate 자격검사).

**왜 `'delivery'` 를 그대로 요구하면 안 되는가**: 존재하지 않는 묶음을 승인하라는 말이 된다. 기록은 남지만
`scopeMeaning('delivery')` 가 말하는 "이 묶음의 남은 REQ 전부"는 **거짓 진술**이다. scope 는 크기 순서가 아니라
**무엇을 승인했는가에 대한 진술**이라는 REQ-2026-071 DEC-4b 를 지키려면 묶음 없는 경우의 참값은 `'req'` 다.

### DEC-3 — HIGH 확인은 **종단에서** 요구한다(커밋 지점 무변경)

`merge` + 묶음 없음 + `risk_level === 'HIGH'` 이면 종단이 두 단계다.

1. 확인 미기록 → `AWAIT_HUMAN`, `command` = `req:confirm <id> --scope req --method "<승인 문장>" --run`
2. 유효 확인 기록됨(`userConfirmProblem` 통과 && `effectiveConfirmScope === 'req'`) → `AWAIT_HUMAN`(통합)

🔴 `userConfirmGate`(커밋 차단)는 **바꾸지 않는다.** `merge` 는 커밋에서 멈추지 않는다는 계약이 살아 있어야
"정지 지점은 하나"가 성립한다. 확인은 사라지지 않고 **종단 한 지점**으로 모인다.

🔴 도구는 확인을 **만들지 않는다.** 안내만 하고 기록은 사람이 남긴다(REQ-2026-019 폐기 사유).

### DEC-4 — `readDeliveryGate` 를 `lib/delivery.ts` 로 옮긴다

`req-confirm` 이 `inDeliverySet` 을 알아야 하는데 이 함수는 현재 `req-next.ts` 에 있다. CLI 모듈을 다른 CLI 가
import 하는 대신 **delivery 모델의 집**(`lib/delivery.ts` — `deliveryGateVerdict`·`deliveryRecordProblems`·
`DeliveryRecord` 가 이미 있다)으로 옮긴다. `mentionsMember` 도 함께 옮긴다(같은 판정의 부품).

- `req-next.ts` 는 **re-export** 를 남긴다 — 기존 테스트·소비자의 import 경로를 깨지 않는다.
- 함수는 `roGit` 주입식이라 lib 의 순수성 기준(주입된 IO만 사용)을 만족한다.

### DEC-5 — `inDeliverySet` 의 정의: **`null` 이 아니면 참**

`readDeliveryGate` 의 반환이 `null` 이면 거짓, 그 외(`continue`·`await-human`·`corrupt`)는 참이다.

🔴 `corrupt` 를 거짓으로 읽으면 **손상된 레코드가 `'req'` 확인을 요구하게 되어 좁은 확인으로 묶음이 통과**한다.
손상은 이미 종단에서 `BLOCKED` 이지만, `req:confirm` 은 종단과 무관하게 실행될 수 있으므로 여기서도 보수적으로 읽는다.

**타입으로 foot-gun 을 막는다(오버로드).** `userConfirmGate` 는 `merge` 를 **조기 반환**한 뒤에야 scope 를
계산한다. 거기서 `inDeliverySet` 을 억지로 넘기게 하면(`false` 하드코딩) 나중에 조기 반환이 사라졌을 때
`'delivery'` 대신 `'req'` 가 조용히 나온다. 그래서 시그니처를 둘로 나눈다.

```ts
export function requiredConfirmScope(stopGate: 'phase' | 'req'): ConfirmScope            // 묶음 맥락 불필요
export function requiredConfirmScope(stopGate: StopGate, ctx: { inDeliverySet: boolean }): ConfirmScope
```

`merge` 를 포함한 union 을 넘기는 호출부는 `ctx` 를 **반드시** 줘야 한다(타입 에러). 좁혀진 호출부는 안 줘도 된다.

### DEC-6 — `bin/delivery.ts` 의 HIGH 확인 요구는 함수로 대체하되 **동작 불변**

`integrate` 자격검사는 묶음 안에서만 실행되므로 `inDeliverySet: true` 다 → `requiredConfirmScope('merge', {inDeliverySet:true}) === 'delivery'`
로 현행과 같은 값이 나온다. 하드코딩된 `'delivery'` 문자열 비교를 함수 호출로 바꾸는 것이 변경의 전부다.

### DEC-7 — `req:confirm` 의 `inDeliverySet` 은 주입 seam이고, **강제는 여기가 아니다**

`req:confirm` 은 config·fs 만 만지던 명령이라 git 을 새로 읽어야 한다. `Deps` 에 주입 seam 을 추가한다.

```ts
export interface Deps { now(): string; log(m: string): void; inDeliverySet(root: string, ticketRoot: string, reqId: string): boolean }
// 기본 구현: createGitAdapter(root) 로 readDeliveryGate → null 이 아니면 true. 예외는 false.
```

🔴 **한계를 정직하게 적는다.** `readDeliveryGate` 는 "묶음 없음"과 "git refs 를 못 읽음"을 **구분하지 않는다**
(둘 다 `null`). 따라서 git 이 고장 난 환경에서는 묶음에 속한 REQ 가 `'req'` 확인을 받아들일 수 있다.
이것이 안전한 이유는 **강제 지점이 따로 있기 때문**이다 — `delivery integrate` 자격검사가 `scope === 'delivery'`
를 독립적으로 요구한다(`bin/delivery.ts`). `req:confirm` 의 검증은 **잘못된 기록을 조기에 막는 편의**이지
묶음 보증의 근거가 아니다. 과잉 약속하지 않는다.

이 seam 덕분에 기존 테스트(비-git 임시 디렉터리)가 그대로 동작한다 — 기본 구현은 예외를 삼켜 `false` 를 낸다.

### DEC-8 — 바뀌는 **테스트 계약**을 명시한다

`tests/unit/confirm-verb.test.ts` 의 대응표는 `merge → 'delivery'` 를 무조건 참으로 고정하고 있고,
불일치 목록에 `['merge', 'req']` 가 있다. 새 계약에서 이 행은 **묶음이 없으면 일치**다.

- 표 검증(`REQUIRED_CONFIRM_SCOPE` 를 직접 비교)은 **함수 진리표 검증으로 교체**한다.
- `main()` 실행 경로 케이스 목록에서 `['merge','req']` 를 빼고 `['merge','delivery']`(묶음 없음일 때 불일치)를 넣는다.
- 묶음이 **있을 때** `merge → 'delivery'` 가 유지된다는 검증을 `inDeliverySet: true` 주입으로 새로 넣는다.

🔴 동어반복 금지(과거 phase-4 r04 P1 교훈): expected 를 SUT 로 구성하지 않고 리터럴로 고정한다.

## Phase별 구현

- **phase-1**: DEC-2·DEC-4 — `requiredConfirmScope` 도입, `REQUIRED_CONFIRM_SCOPE` 제거,
  `readDeliveryGate`/`mentionsMember` 를 `lib/delivery.ts` 로 이동(+re-export), 소비자 넷 배선.
  DEC-6 포함. **관측 가능한 동작 변화는 `req:confirm` 하나**(merge+묶음없음에서 `--scope req` 를 받고
  `--scope delivery` 를 거부). 종단은 아직 그대로.
- **phase-2**: DEC-1·DEC-3 — 종단 `null` 가지를 `AWAIT_HUMAN` 으로, HIGH 2단계 안내.
  기존 계약 테스트(`묶음이 없으면 DONE`)를 새 계약으로 교체.
- **phase-3**: 문서 — `AGENTS.template.md`·`docs/workflow*.md`·`docs/configuration*.md`·`docs/guarantees*.md`
  중 `merge` 의 정지 지점을 서술한 곳 전수 갱신 + `CHANGELOG.md`. 폐기 주장 등재(`lib/retired-claims.ts`)
  필요 여부를 실제 문자열로 확인한다.

## 변경 파일

| phase | 파일 |
|---|---|
| 1 | `scripts/req/lib/evidence.ts` · `scripts/req/lib/delivery.ts` · `scripts/req/req-next.ts` · `scripts/req/req-commit.ts` · `scripts/req/req-confirm.ts` · `bin/delivery.ts` · `tests/unit/*` |
| 2 | `scripts/req/req-next.ts` · `tests/unit/req-next.test.ts` |
| 3 | `AGENTS.template.md` · `docs/*.md` · `CHANGELOG.md` · (필요 시) `scripts/req/lib/retired-claims.ts` |

## 하위호환·안전

- **기존 `merge` + 묶음 사용자**: 무변경(`await-human`·`continue`·`corrupt` 세 가지 모두).
- **기존 `phase`·`req` 사용자**: 무변경(`requiredConfirmScope` 가 표와 같은 값을 낸다).
- **기존 `merge` + 묶음 미사용자**: 종단이 `DONE` → `AWAIT_HUMAN` 으로 바뀐다. 이것이 이 REQ 의 목적이다.
  자동 루프가 `DONE` 에서 끝나던 것이 `AWAIT_HUMAN` 에서 멈추므로 **더 안전한 방향**의 변화다.
- HIGH 티켓이 확인 없이 통합 지점에 도달하던 경로가 닫힌다 — 되돌리는 변화가 아니라 **공백을 메우는** 변화다.
- 강제력의 한계: `req:next` 는 읽기 전용 안내다. 이 REQ 는 `req` 값과 **동등한** 정지를 주는 것이 목표이고,
  실행 강제(통합 명령이 확인을 검사)는 범위 밖이다 — 후속(종단 승인 결속)에서 다룬다. 과잉 약속하지 않는다.
