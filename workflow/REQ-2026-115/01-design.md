# REQ-2026-115 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

| 사실 | 위치 | 확인 |
|---|---|---|
| D15 주석이 스스로를 "중복"이라 부른다 | `req-doctor.ts` D15 블록 주석 | 읽음 |
| 스키마 `findings`에 `minItems` 없음 | `workflow/machine.schema.json` | 실측 |
| 스키마 `next_action`은 `{"type":"string"}`뿐(`minLength` 없음) | 〃 | 실측 |
| `validateVerdict`가 그 조합을 거부한다 | `review-codex.ts:572~578` | 읽음 |
| doctor가 온디스크 응답에 쓰는 것은 **스키마** 검증이다 | `main()`의 `validateResponseStructure` | 읽음 |
| AC-3 테스트가 `exit` **호출 여부**만 비교 | `tests/unit/doctor-run-log.test.ts`의 `runDoctor` | 읽음 |

## 핵심 설계 결정

### DEC-1 · D15 주석을 **사실**로 고친다 (검사는 그대로)

바꾸는 것은 **정당성 서술**뿐이다. 판정식·메시지·level은 한 글자도 건드리지 않는다.

새 주석이 담을 것:

- 스키마는 이 경우를 **막지 않는다**(`minItems`·`minLength` 부재 — 확인 가능한 사실).
- `validateVerdict`는 막지만 **리뷰 시점**이다. doctor가 보는 것은 **그 뒤의 온디스크 파일**이다.
- 따라서 D15는 **커밋 직전 이 조합을 막는 유일한 검사**다.

🔴 **왜 주석 하나에 REQ를 쓰는가**: "중복이라도"는 이 검사를 **정리 후보처럼** 읽히게 한다.
이 저장소는 실제로 "도달 불가로 보이는 코드"를 정리한 이력이 있다(REQ-2026-103).
잘못된 자기 서술 때문에 **유일한 방어선이 제거되는** 것이 이 정정으로 막으려는 결과다.

### DEC-2 · 주장을 **테스트로 고정한다** (주석만 고치지 않는다)

주석은 검증되지 않는다. 그래서 주장 자체를 오라클로 만든다.

🔴 **두 위반을 반드시 분리한다**(설계 리뷰 r01 P1). D15는 `findings`와 `next_action` **둘 중 하나만**
어긋나도 FAIL한다. 그래서 두 조건을 **동시에** 위반하는 입력 하나로 테스트하면,
`findingsOk` 판정을 제거해도 `next_action` 때문에 여전히 FAIL이라 **변이가 잡히지 않는다.**

```ts
// findings만 위반 — next_action은 정상
const onlyFindings  = { status: 'NEEDS_FIX', findings: [],        next_action: '지적을 고치세요', … }
// next_action만 위반 — findings는 정상
const onlyNextAction = { status: 'NEEDS_FIX', findings: [valid1], next_action: '   ',            … }

for (const bad of [onlyFindings, onlyNextAction]) {
  expect(validateResponseStructure(bad, schemaPath).ok).toBe(true) // 스키마는 통과
  expect(d15Level(bad)).toBe('FAIL')                                // D15는 잡는다
}
```

이제 각 하위 판정을 제거하면 **대응하는 입력 하나가 통과해 테스트가 실패한다.**

그리고 이 두 줄이 **주석의 주장을 실행 가능한 사실로 바꾼다.** 스키마에 `minItems`나 `minLength`가
추가되는 날 첫 단언이 실패하며 "이제 주석이 낡았다"고 알려준다 — 서술과 코드가 함께 움직인다.

### DEC-3 · AC-3 오라클에 **exit 인자**를 추가한다

`runDoctor` 헬퍼가 `process.exit` 호출 **여부**만 기록한다. 인자를 함께 수집해 비교한다.

```ts
const exits: (number | undefined)[] = []
vi.spyOn(process, 'exit').mockImplementation(((code?: number): never => { exits.push(code); … }))
```

🔴 **동일성 비교만으로는 부족하다**(설계 리뷰 r01 P1). 두 실행의 exit 인자를 서로 비교하기만 하면,
`main()`의 공통 `process.exit(1)`을 `exit(2)`로 바꿔도 **양쪽 다 2가 되어 통과**한다.

그래서 **동일성 + 계약값**을 둘 다 단언한다:

```ts
expect(after.exitCodes).toEqual(before.exitCodes) // ① 로그 실패가 exit 동작을 바꾸지 않는다
expect(before.exitCodes).toEqual([1])             // ② 계약값: FAIL 1건 이상 → exit 1
```

①은 이 REQ가 지키려는 성질(관측이 판정을 바꾸지 않는다)이고, ②는 그 성질이 **어떤 값 위에서**
성립하는지 고정한다. `exit(1)→exit(2)` 변이는 ②에서 실패한다.

### DEC-4 · 단일 phase

두 변경은 서로 독립적이지만 각각 1~2파일이고, 나눌 이유보다 함께 리뷰하는 편이 싸다.

## Phase별 구현

**Phase 1 (`phase-1-d15-rationale`)** — D15 주석 정정 + 주장 고정 테스트 + AC-3 오라클 강화.

## 변경 파일

| 파일 | 변경 |
|---|---|
| `scripts/req/req-doctor.ts` | D15 주석만 |
| `tests/unit/req-doctor.test.ts` | 스키마 통과 ↔ D15 FAIL 대비 테스트 |
| `tests/unit/doctor-run-log.test.ts` | `runDoctor`가 exit 인자 수집·비교 |
| `CHANGELOG.md` | Unreleased |

## 테스트 oracle (AC ↔ 검증)

| AC | 검증 | 잡는 결함 |
|---|---|---|
| AC-1 | 주석 문구(사람 리뷰) | — |
| AC-2 | **위반을 분리한 두 입력**이 각각 스키마 통과 & D15 FAIL | 주석의 주장이 거짓이 됨 · **각 하위 판정**이 약해짐 |
| AC-3 | ① 로그 실패 전/후 exit 코드 동일 **②** 그 값이 계약값 `1` | 관측이 판정을 바꿈 · exit 코드 회귀 |

**변이 검사로 확인할 것** (설계 리뷰 r01이 지적한 대로 **각각 실제로 실패해야 한다**):

| 변이 | 기대 |
|---|---|
| D15의 `findingsOk` 판정 제거 | `onlyFindings` 입력이 통과 → AC-2 실패 |
| D15의 `nextOk` 판정 제거 | `onlyNextAction` 입력이 통과 → AC-2 실패 |
| `main()`의 `process.exit(1)` → `exit(2)` | AC-3의 **②**에서 실패(①만으로는 안 잡힌다) |

## 하위호환·안전

- **동작 무변경.** 코드 변경은 주석 한 블록뿐이다. 판정·메시지·level·exit 전부 그대로.
- **테스트만 강화된다** — 기존 통과 상태는 유지되고, 새 오라클은 현재 구현을 통과시킨다.
- 스키마를 건드리지 않으므로 소비자 `sync`가 필요 없다.
