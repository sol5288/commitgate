# REQ-2026-133 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

`bin/setup.ts`:

- `SETUP_KEYS = ['reviewModel', 'reviewReasoningEffort', 'stopGate']` — **전부 최상위 키**다.
- `subSchemaFor(key)`가 `CONFIG_SCHEMA.properties[key]`를 그대로 꺼내 검증·선택지·"비움 허용"을 판정한다.
- `buildQuestions(raw)`가 `raw[key]`로 현재값을 읽고, `patch`는 `Record<SetupKey, value>`로 모여
  `mergeConfigText(existingText, patch, marker, deleteKeys)`가 **최상위 키로** 기록한다.
- `VALUE_NOTES.stopGate`는 `merge: '여러 REQ를 묶어 묶음이 끝날 때까지 미룸'` — REQ-2026-128 이전 서술이다.

`reviewBudget`은 `{type:'object', required:['autoBudget','hardCap'], additionalProperties:false}`이므로
`{"reviewBudget":{"onSoftLimit":"auto"}}`만 쓰면 **스키마 위반**이다.

## 핵심 설계 결정

### DEC-1 — `stopGate` 값 설명을 **정지 지점**으로 바꾼다

```ts
stopGate: {
  phase: '매 phase 커밋 전에 확인',
  req:   'REQ 하나가 끝날 때 — 통합 직전 한 번',
  merge: 'delivery 묶음이 끝날 때 한 번(묶음이 없으면 req 와 같다)',
}
```

🔴 `merge`의 괄호가 이 REQ의 핵심이다. REQ-2026-128 이후 묶음이 없으면 `req`와 **같은 지점**에서 멈추는데,
설정을 고르는 화면이 "묶음이 끝날 때까지 미룸"이라고만 말하면 사용자는 **정지가 없어진다고 오해**한다.

### DEC-1b — 같은 화면의 **고지 상수**도 함께 고치고, 그 고지를 `stopGate`에만 붙인다

설계 r02 P1: `VALUE_NOTES`만 고치면 부족하다. 같은 질문 화면이 `hintFor`를 통해
`STOP_GATE_HIGH_NOTICE`도 출력하는데, 그 상수는 아직

> `merge: 커밋에서는 멈추지 않음`

이라고 말한다. 새 값 설명(묶음 없으면 `req`와 같음)과 **한 화면에서 충돌**한다.

```
'정지 지점은 이 값이 정합니다 — phase: 매 phase 커밋 전 · req: REQ를 끝내는 커밋 전 ·
 merge: 커밋에서는 멈추지 않고 묶음이 끝날 때(묶음이 없으면 REQ 통합 직전) · 통합(main 병합) 승인은
 어느 값에서도 필요합니다'
```

🔴 **붙이는 조건을 바꾼다.** 현재는 `!allowsNullValue(q.key)` — "null을 못 받는 키"라는 **간접 조건**이다.
새 `reviewBudget.onSoftLimit`도 null을 못 받으므로, 그대로 두면 **예산 질문 화면에 정지 지점 고지가
붙는다**(완전히 다른 축의 안내가 뜬다). 조건을 `q.key === 'stopGate'`로 **직접** 바꾼다.

⚠️ 이것은 "화면과 검증이 같은 근거(스키마)를 써야 한다"(REQ-2026-067 DEC-6)의 예외가 아니다 —
그 계약은 **"비움을 받을 수 있는가"** 판정에 대한 것이고, 여기는 **"이 고지가 어느 질문의 것인가"**라는
전혀 다른 질문이다. 후자에 스키마 근거는 애초에 없었고, `allowsNullValue`를 대용한 것이 우연히
맞았을 뿐이다(키가 하나였으므로). 키가 늘면 그 대용이 깨진다 — 지금이 그 시점이다.

### DEC-2 — setup 키를 **경로**로 일반화한다(최소 확장)

`SETUP_KEYS`에 `'reviewBudget.onSoftLimit'`을 추가하고, 키를 **점 경로**로 읽는다.

```ts
/** `'a'` 또는 `'a.b'`. 현재 깊이는 2까지만 쓴다 — 필요해지기 전에 일반화하지 않는다. */
export function keyPath(key: SetupKey): string[]           // 'a.b' → ['a','b']
export function subSchemaFor(key: SetupKey): SchemaNode    // 경로를 따라 내려간다
export function readCurrent(raw, key): unknown             // 경로를 따라 읽는다
```

🔴 **질문 목록은 계속 명시**한다(`SETUP_KEYS`). 스키마 전체에서 파생하면 범위 밖 키까지 묻게 된다 —
기존 계약 그대로다.

### DEC-3 — **답변 patch**와 **기록 patch**를 분리한다(두 표현의 경계)

설계 r01 P1-a: 초안은 한 `patch`에 점 경로 키와 최상위 객체를 섞어 넣으라고 했다 — 타입도 동작도
성립하지 않는다. 두 표현을 **이름으로 갈라** 놓는다.

| 이름 | 키 | 값 | 쓰이는 곳 |
|---|---|---|---|
| `answers: Partial<Record<SetupKey, string \| null>>` | 질문 키(점 경로 포함) | 고른 값 | 질문 루프(`askAll`) · "무엇이 바뀌었나" 표시 |
| `writePatch: Record<string, unknown>` | **최상위 키만** | 기록할 값(객체일 수 있음) | `mergeConfigText` |

변환은 **한 함수**가 소유한다:

```ts
/** 답변(점 경로 포함) → 파일에 쓸 최상위 patch. 중첩 키는 부모 객체를 합성한다. */
export function toWritePatch(answers: Partial<Record<SetupKey, string | null>>, raw: Record<string, unknown>): Record<string, unknown>
```

- 최상위 키 답변은 그대로 옮긴다.
- 점 경로 답변은 부모 객체를 합성한다:
  `{ ...(DEFAULTS[parent]), ...(raw[parent] ?? {}), [leaf]: <고른 값> }`
  - 기존 파일의 `autoBudget`·`hardCap`이 **보존**된다(사용자가 조정한 값을 setup이 덮지 않는다).
  - 없으면 DEFAULTS로 채워져 스키마 required(`autoBudget`·`hardCap`)를 만족한다.
  - 🔴 순서: `DEFAULTS` → `raw` → 고른 값. `raw`가 DEFAULTS를 이기고, 고른 값이 둘 다 이긴다.
- 같은 부모의 점 경로 답변이 여럿이면 **한 부모 객체에 모아** 넣는다(현재는 하나뿐이지만 규칙을 정해 둔다).

🔴 `mergeConfigText`는 **바꾸지 않는다** — 최상위 키를 쓰는 그대로이고, 값이 완성된 객체일 뿐이다.
🔴 `deleteKeys`(legacy `phaseCommit` 제거) 판정은 **답변**을 본다(`answers.stopGate !== undefined`) —
`writePatch`를 보면 부모 합성 때문에 판정이 흐려진다.

### DEC-4 — "비움" 항목은 이 키에 **뜨지 않는다**

`allowsNullValue`가 스키마를 근거로 판정하므로(`onSoftLimit`은 `null`을 허용하지 않는 enum),
선택 목록에 "비움"이 자동으로 빠진다. **하드코딩하지 않는다** — 화면과 검증이 같은 근거를 쓴다는
기존 계약(REQ-2026-067 DEC-6)을 그대로 따른다.

### DEC-5 — 질문 문구와 값 설명은 **비용 통제임을 말한다**

```
prompt: '리뷰가 예산을 넘겼을 때(비용 통제 — 안전 게이트가 아닙니다)'
VALUE_NOTES['reviewBudget.onSoftLimit'] = {
  ask:  '6~8회차마다 사람 승인(기본)',
  auto: '사람 승인 없이 hardCap 까지 진행 · 원장에 정책 근거 기록',
}
```

🔴 이 자리에서 "안전 게이트가 아니다"를 말하지 않으면, 사용자는 `auto`를 고르며 **리뷰 승인을 끄는
것**으로 오해할 수 있다. `hardCap`·리뷰 승인·증거·통합 통제점은 전부 그대로다.

### DEC-6 — `derivedStopGate` 하드코딩은 그대로 둔다

`buildQuestions`의 `key === 'stopGate'` 분기는 legacy `phaseCommit` 역파생이라는 **그 키만의 사정**이다.
경로 일반화와 무관하므로 건드리지 않는다 — 이 REQ는 필요한 만큼만 바꾼다.

## Phase별 구현

- **phase-1**: DEC-1~DEC-6 — `setup.ts` 경로 지원 + 새 질문 + 값 설명 + 테스트.
- **phase-2**: 문서(`docs/configuration*.md`의 setup 절 해당 시) + `CHANGELOG.md`.

## 변경 파일

| phase | 파일 |
|---|---|
| 1 | `bin/setup.ts` · `tests/unit/setup.test.ts` |
| 2 | `docs/configuration.md`/`.en`(해당 시) · `CHANGELOG.md` |

## 하위호환·안전

- 기존 setup 흐름(3개 질문)은 그대로이고 **질문이 하나 늘어난다**.
- 🔴 **모두 Enter일 때의 마커 계약은 현행 그대로다**(설계 r01 P1-b — 초안이 잘못 적었다):
  값을 하나도 바꾸지 않아도 **setup 완료 마커가 없으면 마커를 기록한다.** 마커의 의미는 "값을 바꿨다"가
  아니라 **"설정을 확인했다"**이고, 값을 유지한 것도 확인의 결과이기 때문이다(REQ-2026-062 DEC-9).
  마커가 **이미 있고** 값 변경도 없을 때만 아무것도 쓰지 않는다. 이 REQ는 그 규칙을 바꾸지 않는다.
- 기존 `reviewBudget` 값은 보존된다(DEC-3).
- `setup`은 **사람 전용 대화형 명령**이라는 성질을 바꾸지 않는다 — 비대화형에서는 지금처럼 즉시 종료한다.
- 이 REQ는 **게이트 동작을 바꾸지 않는다.** 화면 문구와 설정 기록 경로만 다룬다.
