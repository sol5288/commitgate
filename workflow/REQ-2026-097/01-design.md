# REQ-2026-097 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

### 브랜치 축 3개가 종결 여부를 모른다

[req-doctor.ts](../../scripts/req/req-doctor.ts) `runChecks`(:311~)는 순수 함수이고
`DoctorInputs`만 본다. 그 입력에 "이 티켓이 종결됐는가"가 **없다**.

| 검사 | FAIL 조건 | 종결 후에도 발화하는 이유 |
|---|---|---|
| D2 | `state.branch` ≠ 현재 브랜치 | 병합 후 main에 있으면 항상 불일치 |
| D3 | `refs/heads/<state.branch>` 부재 | 브랜치를 지우면 항상 부재 |
| D11 | 현재=main 또는 prefix 미시작 | 병합 후 main에 있으면 항상 위반 |

세 검사 모두 **진행 중** 티켓을 지키는 규칙이다. 종결된 티켓에는 지킬 작업이 없다.

### 종결 술어는 이미 있고, 저장소가 그것을 공유하고 있다

REQ-2026-072가 종결 술어를 SSOT로 만들었다 — [lib/close-proof.ts](../../scripts/req/lib/close-proof.ts)
`verifiedTerminalEvent`. `deriveBaseState`·`req:close`·`req:commit`·`close-migrate`가 모두 이것을 쓴다.
그 REQ의 사고 자체가 "상태 파생은 *검증된* dev-complete를, 마이그레이션은 *행의 존재*를 봐서
탈출구가 사라진" 것이었다. **여기서 새 술어를 만들면 같은 사고를 반복한다.**

입력 획득까지 맞춘 진입점도 있다 — [lib/intake.ts](../../scripts/req/lib/intake.ts)
`scanTicketIntake(root, ticketRel, ticketId)`는 HEAD blob만 읽어 `baseState`를 돌려준다.

실측(이 저장소 main, `scanTicketIntake` 직접 호출):

| 티켓 | baseState | verdict |
|---|---|---|
| REQ-2026-072 (종결·병합·브랜치 삭제) | `dev-complete` | pass |
| REQ-2026-082 / 092 / 096 (종결) | `dev-complete` | pass |
| REQ-2026-097 (진행 중, 이 티켓) | `developing` | block |

진행 중인 티켓은 `developing`이므로 **이 REQ 자신은 완화 대상이 아니다** — 자기 게이트를 스스로 풀지 않는다.

### D25 수집부는 다른(더 느슨한) 술어를 쓴다

`req-doctor.ts:964`는 `existsSync(<ticket>/responses/ticket-close.jsonl)` 파일 **존재**만 본다.
빈 파일·손상 행·낡은 `design_ref`도 종결로 센다. D25는 WARN 전용이라 지금까지 문제되지 않았지만,
같은 파일 안에 종결 술어가 둘 있는 상태다. 이 REQ는 **새로 넣는 판정에 느슨한 쪽을 쓰지 않는다**(DEC-1).

## 핵심 설계 결정

### DEC-1 — 종결 판정은 `scanTicketIntake().baseState` 재사용

`main()`이 현재 티켓에 대해 `scanTicketIntake`를 호출하고, 그 `baseState`가 terminal 집합에 속하면
그 값을 **그대로** `ticketTerminalEvent`로 넘긴다(속하지 않으면 `null`).

```
TERMINAL = { 'series-terminal', 'dev-complete', 'migrated-complete', 'abandoned' }
ticketTerminalEvent = TERMINAL.has(baseState) ? baseState : null
```

- `'corrupt'`·`'needs-recovery'`·`'developing'`·`'legacy'` 는 **terminal 아님** → 현행 동작 유지(R5 fail-closed).
  특히 `'legacy'`(durability marker 부재)는 종결을 증명할 근거 자체가 없으므로 완화하지 않는다.
- 🔴 술어만 공유하는 것으로 부족하다 — **입력 획득까지** 같은 함수를 쓴다(REQ-2026-094 교훈:
  같은 술어를 쓰고도 입력이 달라 판독이 갈렸다). `scanTicketIntake`는 HEAD blob만 읽으므로
  워킹트리 dirty 여부가 판정을 흔들지 않는다.
- 대안 기각: `existsSync(close proof)`(= D25 수집부 방식)는 빈 파일·손상도 통과시킨다. 브랜치 게이트를
  푸는 입력으로는 부적절하다.

### DEC-2 — 신규 입력은 `ticketTerminalEvent?: CloseProofEvent | null`

**boolean이 아니다.** DEC-3이 면제 사유에 이벤트 이름을 요구하는데 `runChecks`는 `DoctorInputs`만 보는
순수 함수다. boolean 하나로는 `abandoned`인지 `dev-complete`인지 알 수 없어 그 메시지를 만들 수 없다
(설계 r01 P1). 값 하나가 "종결인가"와 "무엇으로 종결됐는가"를 **동시에** 나른다:

| 값 | 의미 | D2/D3/D11 |
|---|---|---|
| `undefined` | 미계산(legacy·2-arg 호출) | 현행 동작(FAIL 조건 그대로) |
| `null` | 계산했으나 종결 아님(`developing`·`needs-recovery`·`corrupt`·`legacy`) | 현행 동작 |
| `CloseProofEvent` | 종결 + 그 이벤트 | 면제(DEC-3) |

두 필드로 쪼개지 않는 이유: `terminal=true`인데 `event=null`처럼 **모순된 조합이 타입으로 표현 가능한**
입력은 언젠가 실제로 들어온다. 하나로 두면 그 상태가 존재할 수 없다.

`CloseProofEvent`의 값 집합(`series-terminal`·`dev-complete`·`migrated-complete`·`abandoned`)은
`CloseBaseState`의 terminal 부분집합과 **문자열이 정확히 일치**하므로 DEC-1의 매핑은 집합 판정 하나다.

optional인 것은 기존 관례를 따른다 — `reqScripts`·`quickstartMissing`·`setupGate` 전부 `undefined` =
미계산이다. optional이어야 `tests/unit/req-doctor.test.ts`의 `const base: DoctorInputs = {…}` 리터럴이
깨지지 않는다.

### DEC-3 — terminal이면 D2·D3·D11은 `OK`(레벨 신설 없음)

리포트는 "OK 또는 INFO"를 제안했다. **INFO는 만들지 않는다** — `Check` 레벨은 `OK`/`WARN`/`FAIL`
3종이고 요약·exit code가 그 위에 서 있다. 레벨을 늘리면 출력 파서·요약 집계·문서를 전부 손대야 하는데
얻는 것이 없다. 저장소에는 이미 "조건상 점검할 것이 없다"를 `OK` + `점검 불요` 문구로 표현하는 관례가
있다(D6·D9·D16·D20·D21·D22). 같은 관례를 쓴다.

메시지: `종결 티켓(<이벤트>) — 브랜치 동일성 점검 불요` 형태로, **왜 통과했는지**를 남긴다.
그냥 `OK`만 내면 검사가 실행돼서 통과한 것인지 면제된 것인지 구분할 수 없다.
`<이벤트>`는 DEC-2의 입력 값을 그대로 쓴다 — 이 문구를 만들 수 있게 하는 것이 DEC-2가 boolean이 아닌 이유다.

### DEC-4 — 워킹트리 축은 무변경(R3)

D10(clean-tree)·D13(설계 우선)·D18(granularity) 등은 종결 여부와 독립인 사실이다. 종결 티켓에서
D10이 더러운 것은 **정말로 워킹트리가 더러운 것**이며, 그 신호를 죽이면 안 된다.

### DEC-5 — 완화가 커밋 경로를 열지 않음을 테스트로 고정(R4)

D2/D3/D11이 통과해도 커밋은 불가능해야 한다. 실제 커밋 게이트는 `commit_allowed`이며
dev-complete 발행 시점에 소비돼 `false`가 된다 → D6/D9/D16이 "점검 불요"로 통과하고
`req:commit` 자신이 승인 부재로 거부한다. **이 논증을 주장으로 두지 않고 테스트로 고정한다** —
terminal 입력으로 `runChecks`를 돌려 D2/D3/D11이 OK가 되어도 `commit_allowed=true`인 구성에서는
여전히 승인 축이 FAIL임을 확인한다.

### DEC-6 — 회귀 테스트

`tests/unit/req-doctor.test.ts`에 추가:

1. `ticketTerminalEvent='dev-complete'` + 브랜치 불일치·부재·main → D2/D3/D11이 OK이고
   메시지에 `종결 티켓`과 **그 이벤트 이름**이 들어간다.
1b. 이벤트별 문구 — `abandoned`를 넣으면 메시지에 `abandoned`가 나온다(`dev-complete`가 아니라).
   boolean으로는 만들 수 없던 문구를 실제로 만드는지 고정한다(설계 r01 P1의 회귀 가드).
2. `null`(진행 중) → 세 검사가 여전히 FAIL(무회귀).
3. `undefined`(미계산) → 여전히 FAIL(R5 fail-closed·하위호환).
4. terminal이어도 워킹트리 축(D10)은 그대로 FAIL(DEC-4).
5. terminal + `commit_allowed=true` 구성에서 승인 축이 여전히 FAIL(DEC-5·R4).
6. `main()` 배선 e2e — 실제 종결 티켓 + 브랜치 삭제 상태에서 `runDoctor`가 PASS(exit 0)로 끝난다.
   (순수 판정만 고정하면 배선이 끊겨도 통과한다 — REQ-2026-083 교훈: 빌더 직접호출 가드는 배선끊김을
   못 잡는다. 실제 진입점을 돌린다.)

## Phase별 구현

**단일 phase** — 하나의 입력을 추가해 세 검사의 조건을 바꾸는 응집된 변경이고 코드 2파일이다.

## 변경 파일

| 파일 | 변경 |
|---|---|
| [scripts/req/req-doctor.ts](../../scripts/req/req-doctor.ts) | `DoctorInputs.ticketTerminalEvent?: CloseProofEvent \| null` 추가(DEC-2) · D2/D3/D11 조건·문구에 반영(DEC-3) · `main()`이 `scanTicketIntake`로 계산해 주입(DEC-1) |
| [tests/unit/req-doctor.test.ts](../../tests/unit/req-doctor.test.ts) | DEC-6의 7항목 |
| [docs/ssot-design/07-business-rules-and-state-machines.md](../../docs/ssot-design/07-business-rules-and-state-machines.md) | §3 D-체크 표의 D2·D3·D11 FAIL 조건에 "종결 티켓 제외" 반영 |
| [CHANGELOG.md](../../CHANGELOG.md) | Unreleased 항목 |

## 하위호환·안전

- **완화하는 변경이다.** 안전 속성을 바꾸므로 근거를 명시한다: 세 검사는 *진행 중* 티켓의 작업 위치를
  강제하는 규칙이고, 종결 티켓에는 강제할 작업이 없다. 종결 판정이 **검증된**(단순 파일 존재가 아닌)
  술어이므로 위조 한 줄로 게이트가 풀리지 않는다.
- **커밋 경로는 열리지 않는다** — DEC-5의 테스트가 고정한다.
- **미계산은 현행 동작**(DEC-2) — 2-arg 호출·기존 테스트 리터럴 전부 무변경.
- **진행 중 티켓 무영향** — 이 REQ 자신이 `developing`이라 도그푸딩으로 즉시 확인된다.
- ⚠️ **관찰(범위 밖)**: §3 D-체크 표는 "구현된 검사는 13개(D2~D19)"라고 적고 있으나 실제로는 D20~D27이
  더 있다. 이 REQ는 D2·D3·D11 행만 정정하고 목록 전수 갱신은 하지 않는다 — 별도 문서 정합 REQ 사안이다.
