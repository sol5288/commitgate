# REQ-2026-084 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

### A. `risk_level` — 요청되지만 소비되지 않는다

| 자리 | 현재 |
|---|---|
| `workflow/machine.schema.json` | `required`에 `risk_level` 포함 · `properties.risk_level` = enum LOW/HIGH · 루트 `additionalProperties: false` |
| `lib/adapters.ts` `deriveStrictOutputSchema` | codex `--output-schema`용 strict copy 파생. **`schema.required = Object.keys(schema.properties)`** — properties에 있는 키는 전부 required가 된다(codex strict mode가 요구) |
| `review-codex.ts` `validateVerdict` | `if (!RISK_VALUES.includes(v.risk_level ?? '')) errors.push(...)` — **부재 시 에러** |
| 게이트 판정 | **없음.** 소비처는 `state.risk_level`뿐(`req-commit.ts` HIGH 확인 지점, `req-next.ts` low-only 자동 커밋) |

🔴 **핵심 제약 — SSOT `required`만 고쳐서는 목적을 달성할 수 없다.**
strict copy가 `properties` 키 전체로 `required`를 재구성하므로, SSOT의 `required`에서 빼도
리뷰어에게 가는 출력 스키마에서는 여전히 필수다. 리뷰어는 계속 방출한다.

🔴 **핵심 제약 — `properties`에서 지우면 기존 증거가 전부 깨진다.**
루트가 `additionalProperties: false`이므로, property 정의를 지우면 `risk_level`을 담은 응답은
**구조 부적합**이 된다. 그리고 아카이브는 재검증된다:

- `req-doctor.ts` D17 — 아카이브 파일에 AJV(`archive.structureOk`) + `validateVerdict(v)` 재실행
- `req-doctor.ts` D9 — `codex-response.json`에 동일 재검증

즉 지우면 **기존 티켓 전부에서 D17이 FAIL**한다(이 repo 83개 + 소비 repo 전량).
같은 이유로 `machine_schema_version` 상향도 금지다 — `validateVerdict`가 정확 일치를 요구한다.

### B. `invalid` 회차가 예산을 소모한다

```
recordAttempt      → attempts +1                     (attempt-opened, 호출 전)
openSeriesAttempts → attempts - refunded_attempts     (유효 회차)
checkReviewBudget(openAttempts, budget)
  openAttempts < autoBudget(5) → allow
  openAttempts < hardCap(8)    → needs-exception      (사람이 사유서를 쓴다)
  그 외                         → hard-blocked
```

`refunded_attempts`(REQ-2026-054 DEC-C3)는 **pre-dispatch 실패**(호출이 나가지 못함)만 환불한다.
반면 `outcome === 'invalid'`(호출은 성공했고 응답이 검증을 통과 못 함)는 환불되지 않는다 —
`review-codex.ts`의 정상 경로에서 `approved`만 series를 닫고 나머지는 아무 계수 보정 없이 흘러간다.

## 핵심 설계 결정

### DEC-1 — SSOT는 `risk_level`을 **보존**한다(deprecated 표식)

`properties.risk_level`을 **남기고** `required`에서만 뺀다. 그리고 `"deprecated": true`를 붙인다.

- 기존 아카이브: property가 정의돼 있으므로 `additionalProperties:false`를 만족 → 계속 통과 (R3)
- 신규 응답: `required`가 아니므로 부재해도 통과 (R2)
- `machine_schema_version`은 `1.1` 유지 (R4)

### DEC-2 — strict copy가 `deprecated` 속성을 **탈락**시킨다

`deriveStrictOutputSchema`는 이미 "SSOT는 불변, 호출 직전 copy만 손본다"는 구조다
(`narrowFindingsSeverityToP1`이 선례). 여기에 한 단계를 **`required` 재구성보다 먼저** 넣는다:

```
1) properties에서 deprecated === true 인 키를 제거   ← 신규
2) required = Object.keys(properties)                ← 기존(축소된 집합 위에서 동작)
3) findings.severity를 P1로 좁힘                     ← 기존
```

결과: 리뷰어에게 가는 스키마에 `risk_level`이 **존재하지 않는다**. 루트가
`additionalProperties: false`이므로 리뷰어는 방출할 수도 없다 (R1).

> **왜 SSOT를 두 벌로 나누지 않는가**: 검증 SSOT와 출력 스키마를 별도 파일로 가르면 두 파일이
> 드리프트한다(REQ-2026-038이 다룬 asset skew와 같은 병). 파생은 **한 함수**에 남긴다.

### DEC-3 — `validateVerdict`는 **있을 때만** 검사한다

```
있으면 LOW|HIGH 여야 한다 · 없으면 통과
```

"없으면 통과"로 완전히 무검사하지 않는 이유: 옛 리뷰어/옛 아카이브가 담은 값이 오염된 채
통과하면 D17의 증거 무결성이 약해진다. **부재는 허용, 오값은 불허**가 fail-closed 방향이다.

### DEC-4 — 계수를 두 축으로 가른다

기존 1개(`refunded_attempts`)에 1개(`void_attempts`)를 더해 **환불의 의미를 분리**한다.

| 계수 | 의미 | autoBudget 차감 | hardCap 차감 |
|---|---|---|---|
| `refunded_attempts` (기존) | **호출이 나가지 않음**(pre-dispatch 실패) — 비용 0 | ✅ | ✅ |
| `void_attempts` (신규) | **호출은 나갔고 판정이 없음**(`outcome==='invalid'`) — 비용 발생 | ✅ | ❌ |

파생 계수:

```
dispatched = attempts - refunded_attempts              (= 기존 openSeriesAttempts, 의미 불변)
productive = attempts - refunded_attempts - void_attempts
```

### DEC-5 — 예산 판정은 두 계수를 **각각** 본다

```
if (dispatched >= hardCap)   → hard-blocked     ← 실제 호출 절대 상한 (R6)
else if (productive < autoBudget) → allow       ← 생산적 회차만 soft cap 소모 (R5)
else                          → needs-exception
```

`hard-blocked`를 **먼저** 판정한다 — 절대 상한이 어떤 경로로도 뚫리지 않아야 한다.
invalid가 반복돼도 `dispatched`는 계속 증가하므로 8회에서 반드시 멈춘다.

`void_attempts` 부재(옛 state) → `productive === dispatched` → **현행과 완전히 동일** (R8).
`refunded_attempts`의 취급은 두 축 모두에서 그대로다 (R7).

### DEC-6 — `attempts`는 단조 증가를 유지한다

REQ-2026-054가 세운 불변식을 승계한다: `attempts`를 감소시키면 재시도가 같은
`(series_id, attempt)`를 만들어 원장 자연키가 충돌한다. **보정은 언제나 별도 계수로만** 한다.

### DEC-7 — 예외 부여 판정도 같은 함수를 쓴다

`req-review-exception.ts`는 소비 게이트와 **같은 함수**로 회차를 판정한다(현행 주석이 명시).
`checkReviewBudget` 시그니처가 바뀌면 이쪽도 함께 바꾼다 — 두 곳이 갈리면 예외를 받아놓고
소비에서 거부되는 교착이 생긴다.

## Phase별 구현

### phase-1-risk-level-deprecation (DEC-1·2·3)

- `workflow/machine.schema.json`: `required`에서 `risk_level` 제거 · `properties.risk_level`에
  `"deprecated": true` + description(레거시 아카이브 호환 · 방출 금지) 추가.
- `scripts/req/lib/adapters.ts`: `deriveStrictOutputSchema`에 deprecated 탈락 단계 추가(required 재구성 **전**).
- `scripts/req/review-codex.ts`: `validateVerdict`의 risk_level 검사를 조건부로.
- 테스트: ①레거시 아카이브(risk_level 포함) 통과 ②신규 응답(부재) 통과 ③오값(`MEDIUM`) 거부
  ④strict copy에 risk_level 키 없음 ⑤strict copy의 required에도 없음 ⑥`MACHINE_SCHEMA_VERSION` 불변.

### phase-2-invalid-budget (DEC-4·5·6·7)

- `scripts/req/review-codex.ts`:
  - `SeriesRecord`에 `void_attempts?: number`.
  - `voidAttempt(state, kind, phaseId)` 신규(순수) — `refundAttempt`와 대칭.
  - `openSeriesProductiveAttempts(state, kind, phaseId)` 신규. `openSeriesAttempts`는 **의미·이름 불변**.
  - `checkReviewBudget`를 `{ productive, dispatched }` 입력으로. 판정 순서는 DEC-5.
  - 정상 경로 `persistedState` 분기에 `outcome === 'invalid' → voidAttempt` 추가(`writeState` 전, 단일 지점).
- `scripts/req/req-review-exception.ts`: 새 시그니처로 갱신(DEC-7).
- 테스트: ①invalid 1회 후 autoBudget 판정이 1회 덜 소모 ②invalid만 반복해도 dispatched로 hardCap 차단
  ③`void_attempts` 부재 state가 현행과 동일 판정 ④pre-dispatch 환불 의미 불변 ⑤예외 부여/소비 판정 일치.

### phase-3-changelog (문서)

- `CHANGELOG.md` Unreleased에 두 변경 기록 + **확인할 파일 표**(앞 phase의 실제 커밋 SHA·경로).
  diff-scoped 리뷰가 앞 phase를 볼 수 없으므로 포인터를 처음부터 넣는다(REQ-2026-082·083 교훈).

## 변경 파일

| 파일 | phase | 성격 |
|---|---|---|
| `workflow/machine.schema.json` | 1 | 계약(vendored 자산 — 소비자 `commitgate sync` 필요) |
| `scripts/req/lib/adapters.ts` | 1 | 파생 로직 |
| `scripts/req/review-codex.ts` | 1·2 | 검증·계수·예산 |
| `scripts/req/req-review-exception.ts` | 2 | 예산 판정 동기화 |
| `tests/unit/req-review-codex.test.ts` | 1·2 | 회귀 가드 |
| `tests/unit/req-review-exception.test.ts` | 2 | 회귀 가드 |
| `CHANGELOG.md` | 3 | 문서 |

## 하위호환·안전

- **기존 아카이브**: 하나도 깨지지 않는다. property 보존 + `required` 완화 + `validateVerdict` 조건부.
  D17/D9 재검증 경로가 이 REQ의 1급 회귀 대상이다.
- **스키마 버전**: `1.1` 유지. 상향은 모든 아카이브를 무효화하므로 금지.
- **vendored 자산**: `machine.schema.json`이 바뀌므로 소비 repo는 D20 WARN을 보고
  `commitgate sync`로 재동기화한다(REQ-2026-038이 만든 정상 경로 — FAIL 아님).
- **예산**: 신규 계수 부재 시 판정이 현행과 **비트 단위로 동일**하다. 상한을 넓히지 않는다 —
  `hardCap`은 실제 호출 수 기준으로 **그대로** 남는다.
- **범위 밖**: 티켓 `state.risk_level`·`stopGate`·HIGH 확인 경로는 이 REQ에서 읽지도 쓰지도 않는다.
