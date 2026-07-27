# REQ-2026-072 설계 — "이미 종결"을 판정하는 술어는 하나뿐이다

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

**같은 개념("이 티켓은 이미 종결됐는가")을 두 곳이 서로 다른 술어로 판정한다.**

| 판정자 | 위치 | 술어 |
|---|---|---|
| intake 게이트 | `lib/close-proof.ts:300-313` (`deriveBaseState`) | **검증된** terminal — dev-complete 행이 *현재* `design_ref`와 짝이고 그 `phase_inventory`가 전부 design-bound 증거일 때만 |
| 마이그레이션 | `lib/close-migrate.ts:85-88` (`planMigrationClose`) | **행의 존재** — `event`가 terminal 3종 중 하나인 행이 하나라도 있으면 |

설계를 재승인하면 앞선 phase의 결속이 끊기고(DEC-B5), 이미 발행된 `dev-complete` 행은 **옛 `design_ref`를
담은 채 낡는다**. 그러면 왼쪽은 `developing`(차단), 오른쪽은 "이미 종결"(no-op)이 되어 **두 판정이 서로를
막는다.** 복구 명령 3개가 모두 거부하는 상태가 이렇게 만들어진다.

```
manifest: design D1 · phase-0/1/2(phase_design_ref=D1) · design D2 · phase-3(phase_design_ref=D2)
close    : dev-complete(design_ref=D1, inventory=[0,1,2])            ← 낡음
deriveBaseState    → D2 짝 dev-complete 없음        → developing     ← req:new 차단
planMigrationClose → dev-complete 행 존재            → noop           ← 탈출 봉쇄
```

**같은 뿌리의 두 번째 결함**: `req:rebind`(REQ-2026-069)는 ① rebind 행 커밋 → ② `loadState` →
③ dev-complete 발행 커밋의 **두 커밋짜리 절차**인데, ②·③이 실패하면 재실행이 `planRebind`의
"이미 재결속돼 있습니다"(`req-rebind.ts:92-93`)에 걸려 **③에 영영 도달하지 못한다**.

## 핵심 설계 결정

### DEC-1 — 🔴 술어를 **한 함수로 승격**하고 두 호출부가 공유한다 (R1)

`lib/close-proof.ts`에 검증된 terminal 판정을 노출한다. `deriveBaseState`가 그것을 쓰고,
`planMigrationClose`도 **같은 함수**를 쓴다.

```ts
/** 검증된 terminal 전이(없으면 null). deriveBaseState·planMigrationClose의 유일한 술어. */
export function verifiedTerminalEvent(
  input: Pick<CloseStateInput, 'closeProofRows' | 'evidencedPhaseIds' | 'committedDesignRef'>,
): CloseProofEvent | null
```

- 우선순위는 `deriveBaseState`의 현행 순서를 **그대로 보존**한다: `series-terminal` → `dev-complete`
  (self-verify) → `migrated-complete`. 순서를 바꾸면 기존 판정이 조용히 달라진다.
- `deriveBaseState`는 이 함수의 결과가 있으면 그 값을 상태로 내고, 없으면 기존대로
  `needs-recovery`/`developing`으로 떨어진다. **동작 불변**(리팩터링).
- `planMigrationClose`는 `closeRows`·`evidencedPhaseIdsBound`·`committedDesignRef`로 같은 입력을 만들어
  호출한다. 이미 갖고 있는 fact뿐이라 **새 IO가 없다**.

🔴 왜 "둘 다 고친다"가 아니라 "함수를 하나로"인가: 술어를 두 곳에 적는 한 언제든 다시 갈라진다.
이 버그 자체가 그 증거다.

### DEC-2 — 🔴 마이그레이션은 **재결속으로 닫을 수 있는 티켓을 삼키지 않는다** (R2)

DEC-1만 적용하면 낡은 dev-complete 티켓이 no-op을 지나 **마이그레이션 자격 판정으로 진행**한다.
그런데 그대로 stamp하면 **REQ-2026-069가 요구한 사람의 판단("이 설계 변경이 그 phase의 검수를
무효화하는가")을 `--migrate` 한 번으로 우회**하게 된다. DEC-M3.6("마이그레이션으로 강한 경로를
우회하지 않는다")의 취지가 rebind 도입으로 넓어진 것이다.

`MigrationFacts`에 fact 하나를 더한다(호출부가 매니페스트에서 계산 — 순수 모듈은 매니페스트를 모른다).

```ts
/** 결속이 끊겼지만 phase_design_ref가 있어 req:rebind 대상이 되는 phase id. */
rebindablePhaseIds: readonly string[]
```

기존 "정상 dev-complete 가능하면 거부" 검사 **직후**에 분기를 넣는다.

| 미결속 phase 집합 | 판정 | 근거 |
|---|---|---|
| 없음(전부 결속) | 기존대로 refuse("정상 dev-complete 가능 → `req:commit --finalize`") | 현행 유지 |
| 전부 rebindable | **refuse + `req:rebind` 명령줄 안내** | 강한 경로가 살아 있다 |
| 하나라도 rebind 불가(`phase_design_ref` 부재) | 기존 흐름 계속(integrated 검사 → stamp) | 재결속으로는 못 닫는다 = 진짜 레거시 |

이 표가 A2·A3를 동시에 만족한다. 지금 **완전 교착**인 세 번째 행이 열리고, 두 번째 행은 거짓 no-op이
아니라 정확한 안내가 된다.

🔴 **이 분기는 낡은 dev-complete 티켓만의 이야기가 아니다 — 오늘 성공하는 경로 하나를 좁힌다.**
`dev-complete`가 **한 번도 발행되지 않은** 티켓(리포트의 인접 사례 REQ-2026-087, 그리고 이 저장소의
REQ-2026-066·067)은 지금 `--migrate`로 종결된다. 그 티켓들의 미결속 phase가 전부 rebindable이면
**이제 refuse + `req:rebind` 안내**로 바뀐다. 의도된 변경이다:

- `req:rebind`가 없던 시절 `--migrate`는 **유일한** 탈출구였고, 그래서 REQ-066·067이 그것을 썼다.
- 이제는 강한 경로(사람 확인 + 자기증명 `dev-complete`)가 있다. 약한 경로(`reconstructed:true` 사후
  스탬프)를 습관적으로 쓰면 감사 기록에서 "사후 확인"과 "자기증명 종결"이 구별되지 않는다 —
  `docs/workflow.md`가 이미 그렇게 경고하고 있다.
- 좁히는 것이지 막는 것이 아니다: `phase_design_ref`가 없는 진짜 레거시는 그대로 마이그레이션된다.

### DEC-3 — 🔴 `req:rebind`의 "이미 재결속됨"은 **실패가 아니라 no-op**이다 (R3)

`planRebind`의 반환을 2-kind(ok/refuse)에서 3-kind로 재편한다.

```ts
export type RebindPlan =
  | { kind: 'rebind'; from: string; to: string }
  | { kind: 'noop'; reason: string }    // 이미 현재 설계에 결속 · 이미 재결속됨
  | { kind: 'refuse'; reason: string; hint: string }   // design 승인 없음 · phase 행 없음 · phase_design_ref 없음
```

`main()`은 `noop`이면 **rebind 행 쓰기·커밋만 건너뛰고 완료 재판정(현행 159~194행)까지 진행**한다.
`refuse`는 지금처럼 throw. 이렇게 하면 중단된 재결속의 재실행이 ③에 도달해 티켓이 닫힌다(A4).

🔴 no-op이 완료 재판정에 도달하는 것이 **이 결정의 전부**다. 두 커밋 절차를 한 커밋으로 합치는 대안은
택하지 않는다 — rebind 기록과 dev-complete는 서로 다른 파일·다른 의미이고, 합치면 "재결속은 됐지만
아직 완료는 아닌" 정상 중간 상태를 표현할 수 없다.

### DEC-4 — 완료 재판정의 inventory 원천: 워킹 state 우선, **HEAD state fallback**

`computeDevCompleteProof`는 `state.phases`를 inventory 원천으로 받는다(DEC-B4의 명시적 예외 —
*입력으로만*). `req:rebind`는 지금 워킹 `state.json`만 읽어, 티켓 스크래치가 사라진 저장소에서는
`loadState`가 throw한다(`review-codex.ts:1544-1547`) — 그것이 F7의 실패 창 하나다.

- **워킹 `state.json`이 있으면 그것을 쓴다** — `req:commit`과 같은 원천이어야 두 경로의 완료 판정이
  갈라지지 않는다(REQ-2026-069 DEC-8의 이유와 동일).
- **없으면 HEAD `state.json`으로 대체**한다. REQ-2026-057의 state checkpoint 덕에 HEAD에는 소비된
  최신 state가 커밋돼 있다. 둘 다 없으면 그때 실패한다(무엇이 없어서 판정 불가인지 밝히는 메시지).
- 🔴 **fallback이 조용한 오답을 내지 않게 한다.** HEAD state가 스캐폴드 그대로면 `phases`가 **빈 배열**이고
  (`lib/intake.ts:120`의 주석이 말하는 그 상태), `computeDevCompleteProof`는 빈 inventory에 대해 null을
  낸다 — 그러면 사용자는 "아직 완료가 아닙니다"라는 **틀린 안내**를 받는다. fallback으로 읽은 state의
  `phases`가 비어 있으면 그 사실을 **명시적으로 보고**한다(완료 재판정을 하지 않았고 왜 못 했는지).
  워킹 state가 있을 때는 현행 문구를 유지한다 — 그때의 빈 `phases`는 실제로 미분해 상태다.

### DEC-5 — intake 차단 메시지는 **적용 가능한 명령**을 낸다 (R4)

`classifyIntake`는 이미 `closeParsed.rows`·`committedDesignRef`·design-bound `evidencedPhaseIds`를 갖고
있다. 여기에 결속 무관 전량(`evidencedPhaseIdsAll`)을 fact로 더하면 **"낡은 dev-complete로 갇힌 상태"를
정확히 식별**할 수 있다(`scanTicketIntake`가 이미 `manifestPhaseIds`로 계산해 둔 값이다 — 새 IO 없음).

- `IntakeTicketResult`에 `hints: string[]`를 더하고 **`classifyIntake`(순수)가 채운다**. 렌더는
  `renderIntakeSummary`가 한다 — 판정과 문구 생성의 현행 분리를 유지한다.
- 그 외 `developing`/`needs-recovery`는 현행 문구를 유지한다 — 이 REQ는 **틀린 안내를 고치는 것**이지
  안내를 전면 개편하는 것이 아니다.

🔴 **안내는 DEC-2의 표와 같은 분류를 써야 한다 (r01 P1).** "미결속"만 보고 `req:rebind`를 제시하면,
`phase_design_ref`가 없는 레거시 phase에도 rebind를 권하게 된다 — `planRebind`가 거부하는 명령이라
**막다른 길을 하나 더 만드는 것**이고 R4를 그 자리에서 위반한다. 그래서:

- **미결속 phase의 분류(`rebindable` / `legacy-unrebindable`)는 DEC-2가 쓰는 것과 같은 helper 하나에서
  나온다.** `req-close.ts`와 `scanTicketIntake`가 그 helper를 각각 호출한다(둘 다 HEAD 매니페스트만 읽는다).
- **안내 문구 자체도 한 곳에서 만든다.** `lib/close-proof.ts`(순수·leaf)에 복구 안내 생성기를 두고,
  `close-migrate`의 refuse 문구와 intake의 `hints`가 **같은 함수**를 쓴다. 그래야 "마이그레이션은 거부하며
  rebind를 권했는데 intake는 다른 말을 한다" 같은 표류가 구조적으로 불가능해진다.

| 미결속 phase 구성 | intake 안내 | `--migrate` 판정(DEC-2) |
|---|---|---|
| 없음 | 현행 문구 | refuse(`req:commit --finalize`) |
| 전부 rebindable | phase별 `req:rebind` 명령줄(최대 3개, 초과분 `…외 N개`) | refuse + 같은 명령줄 |
| 하나라도 레거시 | `req:close --migrate --run` | stamp 가능(integrated 검사 후) |

`IntakeFacts`에는 `evidencedPhaseIdsAll`과 `rebindablePhaseIds`가 들어간다(둘 다 `scanTicketIntake`가
이미 읽는 HEAD 매니페스트에서 계산 — 새 IO 없음).

### DEC-6 — 하지 않는 것

- **자연키에 `phase_inventory` 해시 추가**(리포트 제안 B): 자연키엔 이미 `design_ref`가 있다
  (`close-proof.ts:103-109`). 재발행을 막은 것은 키가 아니라 design-bound 완전성이다. 키를 건드리면
  기존 close proof의 멱등 판정이 통째로 달라진다 — 근거 없는 파급.
- **설계 재승인 시 자동 재결속**: DEC-B5를 파기한다. 사람 확인은 `req:rebind`가 이미 담당한다.
- **`req:reconstruct`가 dev-complete를 합성**: 그 파일의 헤더 계약(절대 합성 금지)을 뒤집지 않는다.

## Phase별 구현

| phase | 내용 | 수용 |
|---|---|---|
| `phase-1-terminal-parity` | DEC-1·DEC-2·DEC-5의 판정기(`close-proof.ts`·`close-migrate.ts`·`evidence.ts`) **+ `req-close.ts` 배선** + 단위·e2e + **양방향 실측** | A1·A2·A3 |
| `phase-2-rebind-reentry` | DEC-3·DEC-4(`req-rebind.ts`) + 중단·재개 e2e | A4 |
| `phase-3-intake-guidance` | DEC-5 소비(`lib/intake.ts`·`req-new.ts`) + 테스트 | A5 |
| `phase-4-docs` | `docs/workflow.md`·`.en.md`, CHANGELOG(Unreleased) | — |

🔴 **판정을 바꾸는 코드와 그 판정에 사실을 공급하는 배선을 다른 phase로 나누지 않는다 (r02 P1).**
나누면 그 사이 커밋에서 `planMigrationClose`가 빈 `rebindablePhaseIds`로 돌아, 재결속으로 닫아야 할
티켓을 **stamp해 버린다** — 매 phase 커밋이 그 자체로 올바라야 한다는 계약이 깨진다.

**양방향 실측(phase-1 exit 조건)**: 이 저장소의 HEAD 티켓 전체에 대해 옛 술어(존재)와 새 술어(검증)의
판정을 나란히 계산해 **갈리는 티켓 수와 그 방향**을 기록한다. REQ-2026-066의 교훈 — 게이트 조건은
넣기 전에 실제 데이터로 양방향을 측정한다. 예상과 다르면 설계로 되돌아온다.

## 변경 파일

| 파일 | 변경 |
|---|---|
| `scripts/req/lib/close-proof.ts` | `verifiedTerminalEvent` 신설, `deriveBaseState`가 위임, **복구 안내 생성기**(DEC-5) |
| `scripts/req/lib/close-migrate.ts` | noop 술어 교체, `rebindablePhaseIds` fact + 재결속 안내 refuse |
| `scripts/req/req-close.ts` | 새 fact 계산·전달 |
| `scripts/req/lib/evidence.ts` | 미결속 phase를 rebindable / legacy-unrebindable로 나누는 helper(close·intake 공용) |
| `scripts/req/req-rebind.ts` | `RebindPlan` 3-kind, noop→완료 재판정, HEAD state fallback |
| `scripts/req/lib/intake.ts` · `req-new.ts` | `hints` + 낡은 dev-complete 식별·안내 |
| `tests/` | 위 각 phase의 단위·e2e |
| `docs/workflow.md`·`workflow.en.md`·`CHANGELOG.md` | 문서 |

## 하위호환·안전

- **동작 불변 리팩터링**: DEC-1은 `deriveBaseState`의 판정을 바꾸지 않는다(우선순위·조건 동일). 기존
  intake·close 테스트가 그대로 통과해야 하며, 통과하지 못하면 그것이 회귀 신호다.
- **행동이 바뀌는 유일한 지점은 `--migrate`의 자격 판정**이다. 넓어지는 방향(A3: 지금 교착 → stamp
  가능)과 좁아지는 방향(A2: 지금 거짓 no-op → refuse, 그리고 DEC-2의 🔴 단락 — dev-complete 미발행
  티켓도 rebindable이면 refuse) 둘 다 있으므로 phase-1에서 양방향을 실측한다.
- 🔴 **기존 `--migrate` 테스트가 깨지면 그것은 신호다.** REQ-2026-053의 e2e가 만드는 픽스처의 phase 행에
  `phase_design_ref`가 있고 미결속이면, 새 규칙에서는 refuse가 정답이다. **테스트를 새 출력에 맞춰
  재베이스라인하지 않는다** — 픽스처가 표현하려던 것이 "진짜 레거시"인지 "재결속 가능한 티켓"인지를
  먼저 판단하고, 전자면 픽스처를 레거시(=`phase_design_ref` 부재)로 정정하고 후자면 기대값을 바꾼다.
- **fail-closed 유지**: 새 분기는 어느 쪽도 손상 가드(corrupt·durability)보다 앞에 오지 않는다.
  판정 순서는 corrupt → durability → terminal(no-op) → 자격 검사 순을 그대로 지킨다.
- `RebindPlan` 타입 변경은 **내부 API**다(호출부는 `bin/dispatch.mjs`와 테스트뿐). 외부 계약 아님.
- 이 REQ는 배포와 묶인다 — 소비자(0.9.9)의 탈출구는 `req:rebind`를 포함한 릴리스이므로,
  CHANGELOG Unreleased에 **미배포 REQ-2026-069 항목이 함께 실려 있는지** phase-5에서 확인한다.
