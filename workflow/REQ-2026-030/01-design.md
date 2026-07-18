# REQ-2026-030 설계 — ISO 달력 검증 통일

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

- **`req-commit.ts:37`** — `const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/`. 정규식만.
- **`req-commit.ts:166-167`** — `validateManifest` 계열. `approved_at`·`consumed_at`을 `ISO_RE.test()`로 검증.
- **`req-commit.ts:231`** — `userConfirmProblem`. `confirmed_at`을 `ISO_RE.test()`로 검증.
- **`review-codex.ts:901`** — `export function isValidIsoInstant(s): boolean`. 형식(`REVIEW_ISO_RE`, `ISO_RE`와
  동일 패턴) **+ 달력 유효성**(재파싱 성분 일치). `2026-99-99...` 거부, `...08Z`·`...08.480Z` 통과.
- **import 방향**: `req-commit.ts:26`이 이미 `./review-codex`를 import한다. review-codex→req-commit 참조는
  **주석 한 줄뿐**(코드 의존 없음) → 순환 없음. `isValidIsoInstant`를 import에 추가하면 된다.

## 핵심 설계 결정

### D1. 3곳을 `isValidIsoInstant`로 교체 (R1·R2)

`ISO_RE.test(x)` → `isValidIsoInstant(x)` 3곳. 각 검증은 이미 `typeof x !== 'string'`을 함께 보지만,
`isValidIsoInstant`가 **비문자열도 false**로 처리하므로(`typeof s !== 'string'` 내장) 중복이지만 안전하다.
기존 코드 패턴을 최소로 바꾸기 위해 `typeof` 검사는 남기고 `ISO_RE.test` 자리만 교체한다.

```ts
// before: if (typeof e.approved_at !== 'string' || !ISO_RE.test(e.approved_at)) ...
// after:  if (typeof e.approved_at !== 'string' || !isValidIsoInstant(e.approved_at)) ...
```

**약화 없음이 성립하는 이유**(R2): `isValidIsoInstant`는 `ISO_RE`의 **부분집합**이다 — `ISO_RE`를 통과한
값 중 **달력이 유효한 것만** 통과시킨다. 그러므로:
- 기존에 통과하던 **정상 값**(도구가 쓴 `new Date().toISOString()`)은 형식·달력 둘 다 유효 → 계속 통과.
- 기존에 통과하던 **달력 불가능 값**(`2026-99-99...`)만 이제 거부 → 이게 이 REQ의 목적.
- 기존에 거부하던 값은 여전히 거부.

즉 **더 엄격해질 뿐 정상 흐름은 불변**이다. 지금까지 도구가 생성한 evidence·손기록은 전부 통과한다.

### D2. `ISO_RE` orphan 제거 (R3)

3곳이 전부 `isValidIsoInstant`로 바뀌면 `req-commit.ts:37`의 `ISO_RE`는 **다른 사용처가 없다**(위 grep
확인). orphan이므로 제거한다. `escapeRegExp`·`SHA256_RE`·`GIT_OID_RE` 등 다른 상수는 계속 쓰이므로 남긴다.

⚠️ 제거 전 재확인: `ISO_RE`가 이 파일 내 다른 곳·다른 파일에서 참조되지 않음을 grep으로 확정하고 제거한다.
(테스트가 `req-commit`에서 `ISO_RE`를 import하면 그 import도 정리한다.)

## Phase별 구현

단일 phase — 위생 작업이라 쪼갤 이유가 없다(3곳 교체 + orphan 제거 + 회귀 오라클).

| phase | 범위 | 변경 파일 |
|---|---|---|
| `phase-1-iso-calendar` | D1·D2 — 3곳 교체·orphan 제거·회귀 오라클 | `req-commit.ts`·테스트 |

## 변경 파일

- `scripts/req/req-commit.ts` — `isValidIsoInstant` import 추가 · 3곳 `ISO_RE.test`→`isValidIsoInstant` ·
  `ISO_RE` 상수 제거
- `tests/unit/req-commit.test.ts` — 회귀 오라클(3 필드 × 정상 통과·달력 거부·형식 거부)

## 하위호환·안전

- **더 엄격해질 뿐**(R2). `isValidIsoInstant`는 `ISO_RE`의 부분집합이라 정상 흐름은 불변. 기존 evidence·
  `req:doctor`·finalize가 깨지지 않는다 — 전체 테스트로 확인한다.
- **`isValidIsoInstant` 동작 무변경**. A-2a에서 이미 검증된 함수를 재사용만 한다 — 이 REQ는 review-codex를
  안 건드린다.
- **순환 import 없음**. req-commit → review-codex 단방향(기존). review-codex→req-commit은 주석뿐.
- 이 REQ는 **위생 작업**이다. 새 기능·상태 필드·CLI 옵션 없음. 검증 강화만.
