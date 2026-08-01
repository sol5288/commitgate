# REQ-2026-098 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

```ts
// review-codex.ts:1337
/** 초과 안내(순수). **두 탈출구를 모두** 제시한다 — 하나만 주면 그것이 사실상 유일한 길이 된다. */
export function phaseAreaMessage(v: PhaseAreaVerdict, phaseId: string): string { … }

// review-codex.ts:2693
const msg = phaseAreaMessage(verdict, phaseId ?? '(phase)')
if (cfg.granularityGate === 'block') throw new Error(msg)
console.warn(`[req:review-codex] ⚠️ ${msg}`)   // warn — 같은 문구인데 여기선 진행한다
```

`phaseAreaMessage`는 `gate`를 **받지 않는다**. 그래서 한 문구가 두 모드에 쓰이고, warn 모드에서
세 가지가 거짓이 된다(`00-requirement.md`). 기본값이 `warn`이므로 **기본 설정 사용자가 전부** 겪는다.

doctor 쪽 대응물 `phaseGranularityWarnings(codeFiles, maxFiles, gate)`는 이미 `gate`를 받아
분기한다([req-doctor.ts:204-213](../../scripts/req/req-doctor.ts)). 이 REQ는 **그 형태를 리뷰 경로에
맞추는 것**이지 새 정책을 만드는 것이 아니다.

## 핵심 설계 결정

### DEC-1 — `phaseAreaMessage(v, phaseId, gate)` : 세 번째 인자로 모드를 받는다

doctor의 `phaseGranularityWarnings`와 **같은 시그니처 형태**(마지막 인자 `gate`, 기본값
`DEFAULTS.granularityGate`)를 쓴다. 두 표면이 같은 모양이어야 다음 사람이 한쪽만 고치는 일이 줄어든다.

호출부는 이미 `cfg.granularityGate`를 손에 들고 있으므로(`:2694`) 배선은 인자 하나다.

### DEC-2 — block 문구는 **바이트 그대로 유지**

그 모드에서는 현재 문구가 정확하다(호출 전에 `throw`한다). 건드리면 무관한 회귀를 만든다.
테스트가 block 문구의 핵심 문장을 고정한다(R3).

### DEC-3 — warn 문구가 말해야 하는 것

거짓 세 가지를 제거하고, 그 자리에 **사실**을 넣는다:

| 빼는 것(거짓) | 넣는 것(사실) |
|---|---|
| "리뷰를 실행하지 않았습니다 — 소모된 것이 없습니다." | **이 검사는 리뷰를 멈추지 않습니다**(=현재 동작) |
| "(정책을 끄려면 … `"warn"`)" — 이미 warn | 실제로 멈추려면 `"granularityGate": "block"` |
| "둘 중 하나를 선택하세요"(차단 앞 분기처럼 읽힘) | **다음 리뷰 전에** 면적을 줄이는 두 가지 방법(같은 두 레버) |

두 레버(A. staging 분할 / B. `max_files` 선언)는 **그대로 둔다** — 원래 주석이 말하듯 하나만 주면
그것이 사실상 유일한 길이 된다. 바뀌는 것은 시점(지금 선택 → 다음 리뷰 전)과 강제력의 서술이다.

라운드 수 실측 문장(`>8파일 평균 2.4R vs ≤8파일 1.4R`)은 두 모드 공통으로 유지한다 — 사실이고,
warn 모드에서 면적을 줄일 **유일한 동기**다.

🔴 **"호출 1회가 나갑니다"라고 쓰지 않는다**(실측 확인). 이 `console.warn`([review-codex.ts:2695](../../scripts/req/review-codex.ts))
**뒤에** `gateAndRecordAttempt`가 오고, 그것이 예산 소진·예외 필요로 `throw`할 수 있다
([review-codex.ts:1711-1723](../../scripts/req/review-codex.ts)). 즉 이 경고가 나온 뒤에도 호출이
안 나갈 수 있다. "나갑니다"라고 쓰면 **거짓을 거짓으로 바꾸는 셈**이다. 이 검사가 주장할 수 있는
것은 자기 자신에 대한 사실뿐이다 — **"이 검사는 멈추지 않는다."** 이후 게이트의 판단은 그 게이트가
자기 문구로 말한다.

### DEC-4 — 회귀는 고정 문자열 + 교차 검사

`tests/unit/req-review-codex.test.ts`에 추가:

1. **warn 문구에 없어야 할 것** — `'소모된 것이 없습니다'`, `'실행하지 않았습니다'`,
   `'"granularityGate": "warn"'`을 포함하지 않는다. 🔴 **`'호출 1회'`도 포함하지 않는다**
   (이후 예산 게이트가 막을 수 있다 — 위 실측).
2. **warn 문구에 있어야 할 것** — 이 검사가 멈추지 않는다는 사실, `'"granularityGate": "block"'`.
3. **block 문구는 유지** — `'소모된 것이 없습니다'`를 포함하고, `'"granularityGate": "block"'`을
   권하지 않는다(이미 block이다 — R2의 대칭).
4. **교차 검사** — 두 모드 문구가 서로 다르며, 각자 상대 모드를 설정하라고 권한다
   (block↔warn 방향이 뒤바뀌면 잡힌다).
5. **공통 유지** — 두 문구 모두 두 레버(`max_files` 선언·staging 분할)와 파일 수·임계를 담는다.

🔴 기대 문자열은 **테스트 내부 리터럴**로 적는다. SUT 상수를 참조하면 tautology가 된다(REQ-B 교훈).

### DEC-5 — 배선 확인은 실제 진입점으로

순수 함수 테스트는 `:2694`가 `gate`를 넘기지 않아도(= 기본값으로 떨어져도) 통과할 수 있다.
`granularityGate:"warn"` 설정 + 임계 초과 상태에서 `mainImpl`을 dry-run으로 돌려 **경고 출력에
거짓 문장이 없음**을 확인한다. 기존 테스트의 reviewer 주입 seam(`opts2.reviewer`)을 쓴다.

## Phase별 구현

**단일 phase** — 순수 함수 하나와 그 호출부 한 줄, 그리고 테스트다.

## 변경 파일

| 파일 | 변경 |
|---|---|
| [scripts/req/review-codex.ts](../../scripts/req/review-codex.ts) | `phaseAreaMessage`에 `gate` 인자·warn 분기(DEC-1·2·3), 호출부에서 `cfg.granularityGate` 전달 |
| [tests/unit/req-review-codex.test.ts](../../tests/unit/req-review-codex.test.ts) | DEC-4의 5항목 + DEC-5 배선 확인 |
| [CHANGELOG.md](../../CHANGELOG.md) | Unreleased 항목 |

## 하위호환·안전

- **동작 변경 0.** 차단 여부·임계·기본 모드 어느 것도 바뀌지 않는다. **출력 문자열만** 바뀐다.
- **block 사용자 무영향** — 문구가 바이트 그대로다(DEC-2).
- `gate` 인자에 기본값을 두므로 2-arg 호출(있다면)이 깨지지 않는다. 다만 호출부는 하나뿐이며
  명시 전달로 바꾼다 — 기본값에 의존하면 DEC-5가 잡으려는 배선 누락이 조용히 통과한다.
- ⚠️ 이 REQ는 **문구만** 고친다. "9파일인데 왜 안 막았나"는 정책 문제이고 REQ-2026-087이
  의도적으로 `warn`을 기본으로 정했다 — 되돌리지 않는다.
