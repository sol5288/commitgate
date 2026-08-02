# REQ-2026-115 리뷰 요청

## 배경

**작은 정정 두 건**이다. 둘 다 선행 REQ의 리뷰·조사에서 나왔고 서로 독립적이다.

### (1) D15가 자기 정당성을 과소평가한다

D15는 온디스크 응답이 `NEEDS_FIX`인데 `findings`가 비었거나 `next_action`이 공백이면 FAIL한다.
주석은 이렇게 적혀 있다 — *"(스키마/validateVerdict와 중복이라도 명시 점검)"*.

**중복이 아니다.** 실측:

| 방어선 | 그 조합을 막는가 | 언제 |
|---|---|---|
| JSON Schema | ❌ `findings`에 `minItems` 없음 · `next_action`은 `{"type":"string"}`뿐 | — |
| `validateVerdict` | ✅ | **리뷰 시점** |
| doctor의 `validateResponseStructure` | ❌ **스키마** 검증이라 위 한계를 그대로 | 커밋 직전 |
| **D15** | ✅ | **커밋 직전** |

즉 `codex-response.json`이 리뷰 이후 손상·편집되면 **D15만 잡는다.**

🔴 **왜 주석 하나에 REQ를 쓰는가**: "중복이라도"는 이 검사를 **정리 후보처럼** 읽히게 한다.
이 저장소는 실제로 "도달 불가로 보이는 코드"를 정리한 이력이 있다(REQ-2026-103).
잘못된 자기 서술 때문에 **유일한 방어선이 제거되는** 것이 이 정정이 막으려는 결과다.

### (2) 관측 로그 테스트가 exit **코드**를 대조하지 않는다

REQ-2026-111의 AC-3("로그 쓰기가 실패해도 출력과 exit 동작이 동일")이 `process.exit`의
**호출 여부**만 본다. 같은 REQ의 phase 리뷰가 지적한 사항이다.
`exit(1)`을 `exit(2)`로 바꿔도 지금은 통과한다.

## 변경 요약 (4파일)

| 파일 | 변경 |
|---|---|
| `scripts/req/req-doctor.ts` | **D15 주석만**. 판정식·메시지·level 무변경 |
| `tests/unit/req-doctor.test.ts` | 같은 응답이 **스키마 통과 & D15 FAIL**임을 고정 |
| `tests/unit/doctor-run-log.test.ts` | `runDoctor`가 exit **인자** 수집·비교 |
| `CHANGELOG.md` | Unreleased |

🔴 **주석만 고치지 않았다.** 주석은 검증되지 않으므로 **주장 자체를 오라클로 만들었다**:

```ts
expect(validateResponseStructure(bad, schemaPath).ok).toBe(true)  // 스키마는 통과
expect(d15Level(bad)).toBe('FAIL')                                 // D15는 잡는다
```

스키마에 `minItems`가 추가되는 날 **첫 줄이 실패하며 주석이 낡았다고 알려준다** —
서술과 코드가 함께 움직인다.

## 이번에 **하지 않는** 후속 의견 (요구 문서에 근거와 함께 기록)

| 출처 | 의견 | 왜 |
|---|---|---|
| REQ-111 phase r01 | `02-plan.md` stage 범위 서술 불일치 | **완결 REQ의 문서** — 감사 기록을 사후 편집하지 않는다 |
| REQ-113 phase r01 | 설계 예시가 `!== null`인데 구현은 `!== undefined` | 〃. 동작 서술은 맞고 리터럴만 다르다 |
| REQ-114 phase r02 | `readReviewCallCounts`가 `ticket_id` 없는 행도 성공으로 셈 | 리뷰어도 "현재 계약에선 무해"라고 적었다 |

## r02에서 고친 것 — r01 P1 2건 (둘 다 맞는 지적)

**P1-1**: AC-2의 입력이 `findings`와 `next_action`을 **동시에** 위반했다. D15는 둘 중 하나만
어긋나도 FAIL하므로, `findingsOk`를 제거해도 `next_action` 때문에 여전히 FAIL이었다 —
**선언한 변이가 실제로는 안 잡혔다.**

→ **위반을 분리한 두 입력**으로 각 하위 판정을 따로 건다:

```ts
const onlyFindings   = { status:'NEEDS_FIX', findings: [],        next_action: '지적을 고치세요' }
const onlyNextAction = { status:'NEEDS_FIX', findings: [valid1],  next_action: '   ' }
```

이제 `findingsOk` 제거는 첫 입력에서, `nextOk` 제거는 둘째 입력에서 각각 실패한다.

**P1-2**: AC-3이 두 실행의 exit 인자 **동일성만** 봐서, 공통 `exit(1)`을 `exit(2)`로 바꾸면
양쪽 다 2가 되어 통과했다.

→ **동일성 + 계약값**을 둘 다 단언한다:

```ts
expect(after.exitCodes).toEqual(before.exitCodes) // ① 관측이 판정을 바꾸지 않는다
expect(before.exitCodes).toEqual([1])             // ② 계약값
```

두 지적 모두 "변이 검사를 선언했는데 그 변이가 실제로는 안 잡히는" 형태였다.
**구현 중 세 변이를 실제로 돌려 각각 실패하는지 확인하겠다**(계획에 명시).

## 리뷰 포인트

1. **주석 하나를 위해 REQ를 여는 판단**이 맞는지. 근거는 "잘못된 자기 서술이 유일한 방어선을
   제거 대상으로 만든다"인데, 과잉 대응인지.
2. **주장을 오라클로 고정한 방식**(스키마 통과 ↔ D15 FAIL 대비). 이 두 단언이 실제로
   주석의 내용을 검증하는지, 아니면 다른 것을 검증하는지.
3. **스키마에 `minItems`를 넣지 않기로 한 것.** 소비자 `sync`가 필요하고 이미 두 겹이 막는다는
   판단인데, 근본 수정을 회피한 것은 아닌지.
4. exit 인자 대조가 **AC-3의 계약("출력과 exit 동작이 동일")** 을 정확히 표현하는지.
