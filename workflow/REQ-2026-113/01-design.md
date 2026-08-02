# REQ-2026-113 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

| 사실 | 위치 | 확인 |
|---|---|---|
| `ReviewCallLogRow`는 19필드, **선택 필드 3개 선례**(`code_file_count?`·`granularity_over?`·`granularity_limit?`) | `review-codex.ts` `ReviewCallLogRow` | 읽음 |
| 빌더가 **`verdict` 객체를 통째로 받는다** — `findings_count`·`observations_count`를 거기서 파생 | `buildReviewCallLogRow` | 읽음 |
| 델타 활성 판정은 main에 이미 있다 | `review-codex.ts:2540` `hasDesignBaseline(state) && baseline` → `designDelta` | 읽음 |
| 델타면 persona에 계약이 얹혀 `policy_version`이 달라진다 | `applyDeltaPersona` | 읽음·실측 |
| 로그 append 실패는 이미 삼켜진다 | `appendReviewCallLog`의 `catch {}` (R8) | 읽음 |
| 기존 테스트가 **필드 집합을 전수 단언**한다 | `req-review-codex.test.ts` `Object.keys(row).sort()` | 읽음 |
| `full_review_requested`는 스키마상 `"yes"`/`"no"` 문자열, design 전용, `yes`면 `commit_approved` 필수 `no` | `machine.schema.json` · `review-codex.ts:596~599` | 읽음 |
| gaps G-06b가 델타 재리뷰를 **미구현**으로 서술 | `gaps-and-decisions.md:48~51` | 읽음 |
| gaps G-11이 관측 로그 2종을 반영하지 않음 | 같은 문서 `:85~88` | 읽음 |

## 핵심 설계 결정

### DEC-1 · `full_review_requested`는 **빌더가 이미 받는 객체에서 파생**한다

빌더는 `verdict`를 통째로 받고 `findings_count`를 거기서 뽑는다. 같은 자리에서 뽑는다.

```ts
full_review_requested: args.verdict.full_review_requested === 'yes',
```

🔴 **새 배선이 없다.** 호출부에 인자를 추가하지 않으므로 "빌더는 고쳤는데 main이 안 넘긴다"는
배선 끊김이 **원리적으로 불가능**하다. 이 저장소가 세 번 실증한 실패 유형을 구조로 제거한다.

**정규화**: 스키마 값은 `"yes"`/`"no"`이고 **선택 필드**라 부재가 흔하다.
로그에는 **boolean**으로 담는다 — 집계 대상이고, `undefined`/`"no"`/부재가 모두 "요청 안 함"이라
셋을 구별할 이유가 없다. `=== 'yes'`가 아닌 모든 값은 `false`다(fail-safe 방향: 요청을 과대계상하지 않는다).

### DEC-2 · `delta_mode`는 **필수 인자**로 받는다 (컴파일이 배선을 강제)

델타 여부는 verdict에 없다. 인자를 하나 추가해야 한다 — 그러면 배선 위험이 생긴다.
그래서 **선택 인자로 만들지 않는다.**

```ts
export function buildReviewCallLogRow(args: {
  …
  deltaMode: boolean   // 🔴 optional 아님 — 빠뜨리면 컴파일이 깨진다
}): ReviewCallLogRow
```

| 축 | 형태 | 이유 |
|---|---|---|
| **빌더 인자** | `deltaMode: boolean` **필수** | 호출부가 안 넘기면 **타입 오류**. 조용한 `undefined`가 불가능하다 |
| **행 필드** | `delta_mode?: boolean` **선택** | 이 필드 없는 **기존 행**이 이미 로그에 쌓여 있다. 소비자가 부재를 견뎌야 한다 |

main은 이미 계산해 둔 값을 그대로 넘긴다: `deltaMode: designDelta !== null`.

🔴 **`policy_version` 역산을 남기지 않는다.** 이번 조사에서 델타 호출 수를 얻으려고
`applyDeltaPersona(base, true)`의 해시를 계산해 대조해야 했다. 그 우회를 다음 사람에게 물려주지 않는다.

### DEC-3 · 기존 필드·의미를 건드리지 않는다

두 필드 **추가만** 한다. 기존 19필드의 이름·타입·의미는 그대로다.
기존 필드 집합 단언 테스트가 새 집합으로 갱신되며, 그것이 곧 회귀 가드다.

### DEC-4 · gaps 문서는 **삭제가 아니라 해소 표기**로 정정한다

`G-06`이 이미 그 형식을 쓴다 — `### G-06. … — **해소됨(REQ-2026-103)**`.

- **G-06b**: 제목에 해소 표기를 달고, 델타 리뷰가 REQ-2026-031~036으로 **구현됐다**는 사실과
  이번 실측(델타 241회·escalation 0회)을 덧붙인다. **기존 서술을 지우지 않는다** — 그 시점의
  관찰이 왜 gap이었는지가 이력이다.
- **G-11**: "지표 없음"이 더 이상 전부 참이 아니다. 관측 로그 **2종**이 생겼다
  (`.review-calls.jsonl` REQ-2026-025/043/045/113, `.doctor-runs.jsonl` REQ-2026-111).
  **여전히 없는 것**(집계 CLI·온보딩 시간·복구율)은 남긴다.

🔴 **정정문에 폐기 문구를 축자 인용하지 않는다**(REQ-2026-104·112의 반복 교훈).
이 문서는 `docs/**`라 폐기 문구 가드의 검사 대상이다.

### DEC-5 · 단일 phase

4파일이고 부분 상태로 나눌 이유가 없다. 로그 필드만 넣고 문서를 안 고치면 "왜 넣었는지"가 사라지고,
문서만 고치면 셀 수가 없다.

## Phase별 구현

**Phase 1 (`phase-1-delta-observability`)** — 로그 2필드 + gaps 2항목 정정.

## 변경 파일

| 파일 | 변경 |
|---|---|
| `scripts/req/review-codex.ts` | `ReviewCallLogRow`에 선택 필드 2개 · 빌더 인자 `deltaMode`(필수) · 파생 로직 · 호출부 1줄 |
| `tests/unit/req-review-codex.test.ts` | 필드 집합 단언 갱신 + 정규화·파생 테스트 |
| `docs/ssot-design/gaps-and-decisions.md` | G-06b 해소 표기 · G-11 갱신 |
| `CHANGELOG.md` | Unreleased |

## 테스트 oracle (AC ↔ 검증)

| AC | 검증 | 잡는 결함 |
|---|---|---|
| AC-1 | `verdict.full_review_requested`가 `'yes'`/`'no'`/부재일 때 행의 값이 `true`/`false`/`false` | 정규화 오류 |
| AC-2 | `deltaMode: true/false`가 행에 그대로 담김 | 파생 누락 |
| AC-3 | **필드 집합 전수 단언**(기존 패턴)이 새 21필드로 갱신 | 필드 누락·오타·의도치 않은 필드 추가 |
| AC-4·5 | gaps 문서 문구 확인 | 정정 누락 |
| AC-6 | 폐기 문구 가드 재실행 | 정정문이 옛 문구를 인용 |

### 🔴 이 REQ가 배선 오라클을 **따로 두지 않는 이유**

이 저장소는 "빌더 직접호출 가드는 배선끊김을 못 잡는다"를 세 번 실증했다(REQ-2026-083·097·099).
그래서 보통은 실제 진입점을 돌린다. **여기서는 그럴 필요가 없게 설계했다:**

| 필드 | 배선 위험 | 어떻게 제거했나 |
|---|---|---|
| `full_review_requested` | **없음** | 빌더가 **이미 받는** `verdict`에서 파생(DEC-1) — 넘길 인자가 없다 |
| `delta_mode` | 인자 1개 | **필수 인자**로 두어 호출부 누락이 **컴파일 오류**가 된다(DEC-2) |

실제 진입점 e2e는 **유료 codex 호출**이 필요해 테스트로 둘 수 없다. 대신 위 두 구조로
"조용한 미배선"을 원천 차단한다. 남는 위험은 호출부가 `deltaMode`에 **잘못된 값**(예: 상수 `false`)을
넘기는 경우인데, 그것은 타입으로 못 잡는다 — **이 한계를 명시한다.**

## 하위호환·안전

- **기존 행 무영향**: 두 필드 모두 행 스키마에서 선택이다. 이미 쌓인 2,089행은 그대로 유효하다.
- **판정 무영향**: 로그는 측정 전용이고 실패는 삼켜진다(R8). 리뷰 판정·exit code 불변.
- **내용 경계 유지**: 담기는 것은 boolean 2개뿐이다. 프롬프트·diff·finding 본문은 여전히 담기지 않는다.
- **소비자 영향 없음**: gitignored 로컬 파일이고 스키마 변경이 아니라 로그 형식 확장이다.
  `commitgate sync` 불필요.
- **문서 정정은 이력을 지우지 않는다**: 해소 표기 방식이라 "왜 gap이었는지"가 남는다.
