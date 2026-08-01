# REQ-2026-093 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

- `lib/close-proof.ts` — `CloseProofEvent` 3종 · `verifiedTerminalEvent`(종결 판정 SSOT) ·
  `deriveBaseState`(상태 파생 SSOT) · `validateCloseProofRow`(모르는 키 거부) · `closeProofRowKey`(자연키).
- `lib/intake.ts` — `classifyIntake`가 `deriveBaseState` 결과를 사람 문구로 옮긴다.
- `req-close.ts` — 현재 `--migrate` **단일 모드**(`--migrate` 없으면 throw).
- `lib/close-migrate.ts` — `missingPlanned`가 **부분 완료 티켓을 명시적으로 거부**한다.

### 🔴 선례가 있다 — REQ-2026-053(`migrated-complete`)

이벤트를 하나 늘리는 작업의 **정확한 전례**다. 그 REQ는 phase-1에서 모델(이벤트·base-state·파서·
`deriveBaseState`)을, phase-2에서 명령과 intake reason을 넣었다(`intake.ts`의 주석이 그 순서를 증언한다).
본 REQ는 그 경로를 그대로 따른다 — 새 축을 만들지 않는다.

## 핵심 설계 결정

### DEC-1 — 새 이벤트 `abandoned`(티켓 단위). `series-terminal` 재사용은 **불가**

포기는 **티켓 단위 사건**이므로 series 단위 종결로 표현할 수 없다. 근거는 구조적이다.

1. `closeSeriesHumanResolution`은 **열린 series**를 요구한다(`closed_reason === null`, 없으면 throw).
   교착 티켓의 전형은 그 반대다 — 모든 series가 `approved`로 닫혔거나, 리뷰 이력이 아예 없다.
2. `series-terminal` 행은 `series_id`로 자연키를 만든다(`closeProofRowKey`). series가 없으면
   **행 자체를 만들 수 없다.**

→ `CloseProofEvent`에 `'abandoned'`를 더한다. `series_id`·`resolution`·`phase_inventory`·`design_ref`는
전부 `null`이고, 자연키는 **discriminator 없음**(티켓당 1행 — 포기는 일회성이다.
`migrated-complete`와 같은 취급).

### DEC-2 — 우선순위는 **최하위**(비차단 구간의 맨 아래)

```
legacy > series-terminal > dev-complete > migrated-complete > abandoned > needs-recovery > developing
```

`verifiedTerminalEvent`의 마지막 후보로 넣는다. **완료 증거가 항상 이긴다** — 실수로 포기 행이 남아도
실제로 완료된 티켓은 `dev-complete`로 보고된다. 반대로 두면 포기 한 줄이 완료 사실을 가린다.

`migrated-complete`와 같이 **존재 자체가 종결**이다(self-verify 대상 아님) — 사람 결정의 기록이지
증거로부터 재검증되는 사실이 아니기 때문이다. `dev-complete`만 self-verifying이라는 기존 경계를 지킨다.

### DEC-3 — 행의 필수 필드와 **날조 표면 제거**

| 필드 | 값 | 근거 |
|---|---|---|
| `event` | `'abandoned'` | |
| `at` | 🔴 **도구가 실시계에서 스탬프** | R3. 사람이 적는 자리를 만들지 않는다(REQ-2026-019 폐기 교훈) |
| `abandon_reason` | 필수·비어있지 않은 문자열 | 왜 포기했는지가 감사의 핵심 |
| `method` | 필수·비어있지 않은 문자열(승인 문장) | R5. 누가 어떻게 승인했는지 |
| `series_id`·`resolution`·`phase_inventory`·`design_ref` | 전부 `null` | 티켓 단위 사건 |
| `reconstructed` | `false` | 독립 증거로 복원 불가(DEC-6) |

`validateCloseProofRow`는 **모르는 top-level 키를 거부**하므로 `abandon_reason`·`method`를
`CLOSE_PROOF_KEYS`에 더한다(= 허용 목록에 추가일 뿐 **필수화가 아니다**).

#### 🔴 DEC-3a — 기존 행 호환: **키 부재 == `null`** (설계 r01 P1)

`abandoned` 이외의 이벤트에서 두 필드를 검사할 때 **`!== null`로 쓰면 안 된다.**
이미 커밋된 `ticket-close.jsonl` 행에는 두 키가 **아예 없어서** `undefined`이고, `undefined !== null`이
참이므로 **기존 `dev-complete`·`series-terminal`·`migrated-complete` 행이 전부 invalid**가 된다.
그러면 `classifyIntake`가 그 티켓을 `corrupt`로 판정해 **완료된 티켓조차 intake를 통과하지 못한다**
— 업그레이드만으로 저장소가 멈추는 R7 회귀이며, 이 REQ가 없애려는 문제와 정확히 같은 종류다.

규칙을 명시한다.

| 이벤트 | `abandon_reason` · `method` |
|---|---|
| `abandoned` | **둘 다 필수** — 비어 있지 않은 문자열(공백만도 거부) |
| 그 외 3종 | **부재(`undefined`) 또는 `null`** — 둘 다 정상. 값이 있으면 거부 |

즉 판정은 `x == null`(느슨한 비교) 또는 `x === undefined || x === null`이어야 한다.
phase-1 가드에 **키가 없는 기존 행 3종이 valid로 남는다**는 회귀 테스트를 넣는다(02-plan 가드 2a).

### DEC-4 — 명령: `req:close <REQ> --abandon --reason "<사유>" --confirm "<승인 문장>" [--run]`

- `req:close`에 모드를 하나 더한다(현재 `--migrate` 단일). `--abandon`과 `--migrate`는 **상호배타**.
- 🔴 **기본 dry-run**(기존 `req:close` 계약 유지). `--run` 후에만 write.
- `--reason`·`--confirm` **둘 다 필수**이고 공백만이면 거부(fail-closed).
- 커밋은 **pathspec 커밋**(`responses/ticket-close.jsonl`만) — 기존 `--migrate` 경로와 동일 관용구라
  사용자가 stage해 둔 것을 건드리지 않는다.
- 출력은 포기가 **무엇을 하지 않는지** 명시한다(DEC-5).

### DEC-5 — 포기는 증거를 건드리지 않는다(R4)

커밋된 phase 증거·`approvals.jsonl`·설계 승인·원장은 **한 바이트도 바뀌지 않는다.** 포기 행은
"이 티켓은 더 진행되지 않는다"는 **선언 한 줄**을 append할 뿐이다. 이미 만든 커밋은 히스토리에 남는다.

이 경계가 흐려지면 포기가 "증거 삭제 도구"가 되어 감사 무결성을 깬다.

### DEC-6 — `req:reconstruct` 대상 아님

`lib/reconstruct.ts`는 "HEAD-committed immutable evidence가 행의 모든 필드를 명확·모호없이 결정할 때만"
복원한다. 포기는 **사람의 결정**이라 그런 독립 증거가 존재하지 않는다 — `series-terminal(terminate)`가
복원 불가인 것과 같은 이유다. 모듈 헤더에 이 사실을 명시한다(추측 복원 금지).

### DEC-7 — 멱등(R6)

실행 시점에 `verifiedTerminalEvent`가 이미 무언가를 내면 **성공 no-op**으로 끝낸다
(`close-migrate`의 DEC-M7과 동형). 같은 포기 행이 이미 있으면 자연키가 같으므로 append가 중복을 만들지
않는다(`appendCloseProofRow`의 기존 멱등).

### DEC-8 — 오용 저지는 **가시성**으로 한다(R5)

기술적으로 포기를 막을 방법은 없다 — 사람이 판단할 일이다. 대신 **숨길 수 없게** 만든다.

- 결정은 **커밋된 감사 행**으로 남는다(`ticket-close.jsonl`, 사유·승인 문장·시각 포함).
- `req:new` intake가 그 티켓을 `abandoned`로 **표시**한다(통과시키되 상태를 말한다).
- 기본 dry-run이라 실수로 실행되지 않는다.
- 🔴 **커밋된 phase가 있으면 출력이 그 사실을 크게 알린다**(설계 r01 observation). dry-run·실행
  양쪽에서 "이 티켓에는 이미 커밋된 phase가 N개 있습니다 — 포기해도 그 커밋과 증거는 **지워지지
  않고 히스토리에 남습니다**"를 낸다. 포기가 되돌리기가 아님을 결정 **직전**에 보여 주는 것이
  사후 감사보다 싸다. 개수는 이미 읽는 HEAD 매니페스트에서 나오므로 새 조회가 없다.

🔴 **하지 않는 것**: "포기 금지 조건"(예: phase가 N개 이상 커밋됐으면 금지)을 만들지 않는다. 그런 조건은
정당한 포기를 막아 **다시 출구 없는 상태**를 만든다 — 이 REQ가 없애려는 바로 그 문제다.

## Phase별 구현

`02-plan.md` 참조. phase-1 = 모델 + 명령 + 테스트, phase-2 = 문서·CHANGELOG.

## 변경 파일

| phase | 파일 | 내용 |
|---|---|---|
| 1 | `scripts/req/lib/close-proof.ts` | `abandoned` 이벤트·필드·검증·자연키·`verifiedTerminalEvent`·`deriveBaseState`(DEC-1~3) |
| 1 | `scripts/req/lib/intake.ts` | `abandoned` reason 문구(DEC-8) |
| 1 | `scripts/req/req-close.ts` | `--abandon` 모드(DEC-4·7) |
| 1 | `scripts/req/lib/reconstruct.ts` | 복원 불가 명시(DEC-6, 주석) |
| 1 | `tests/unit/close-proof.test.ts` | 모델·우선순위·검증 |
| 1 | `tests/unit/req-close.test.ts` | 실 git e2e — 3가지 티켓 모양 → 포기 → `req:new` 통과 |
| 2 | `docs/troubleshooting.md`·`.en.md` | 사용자 문서(증상→출구) |
| 2 | `CHANGELOG.md` | Unreleased + 확인할 파일 표 |

## 하위호환·안전

- **순수 추가**다. 기존 3종 이벤트의 판정·우선순위·자연키·행 모양은 **바뀌지 않는다**(R7).
  새 필드 2개는 다른 이벤트에서 **부재(`undefined`) 또는 `null` 둘 다 정상**이므로(DEC-3a)
  기존 커밋된 행이 — 그 키를 아예 갖고 있지 않은 채로 — 그대로 유효하다.
- **옛 버전이 새 행을 만나면**: `validateCloseProofRow`가 모르는 `event`를 거부하므로 `corrupt`로
  판정해 **fail-closed**(통과시키지 않는다). 다운그레이드는 원래 지원 대상이 아니다 — 다만 그 방향이
  안전 쪽임을 확인해 둔다.
- **게이트가 새로 막는 것은 없다.** 이 REQ는 오직 **차단을 푸는** 경로만 더한다.
- 스키마 변경 없음 → `commitgate sync` 불요.
