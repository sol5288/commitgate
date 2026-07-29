# REQ-2026-089 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

| 자리 | 현재 |
|---|---|
| `review-codex.ts` phase preflight | `judgePhaseArea(...)` → `PhaseAreaVerdict{over,count,limit,source}` 계산 후 **버리거나 warn 출력만** |
| `ReviewCallLogRow` | REQ-2026-045 관측성 필드(prompt_bytes·duration·previous_findings_count·sha) 있음. **면적 없음** |
| `buildReviewCallLogRow(args)` | 순수 — 호출부가 값을 계산해 주입하는 구조 |
| `appendReviewCallLog` | 실패를 삼킨다(측정 로그가 게이트를 막지 않는다) |

판정은 이미 하고 있고 **버려질 뿐**이다. 값을 로그까지 흘리면 된다.

## 핵심 설계 결정

### DEC-1 — `PhaseAreaVerdict`를 preflight에서 **보존**해 로그까지 흘린다

판정을 다시 하지 않는다. preflight가 만든 verdict를 지역 변수로 들고 있다가 로그 빌드에 넘긴다.
재계산하면 두 값이 갈라질 수 있고(그 사이 인덱스가 바뀌면), 로그가 "그때 무엇으로 판정했는가"를
못 나타낸다.

### DEC-2 — 남기는 것은 **세 값**(개수·불리언·임계)

```
code_file_count : number | null   // 코드 변경 파일 수
granularity_over: boolean | null  // 그 호출이 임계를 넘었는가
granularity_limit: number | null  // 적용된 임계(선언 max_files 또는 config)
```

- 🔴 `granularity_limit`가 **필요한 이유**(R2): 임계는 `phases[].max_files` 선언으로 phase마다 다를 수
  있고 config로도 바뀐다. `count`만 남기면 나중에 "그때 넘었는가"를 **재현할 수 없다.**
- 🔴 **경로·이름은 남기지 않는다**(R4). REQ-2026-045가 세운 "개수/해시만, 내용배제" 계약 그대로다.
  파일 목록을 남기면 이 로그가 측정 로그가 아니라 코드 이력이 된다.
- `source`(declared/config)는 남기지 않는다 — `granularity_limit`와 `phases[].max_files`로 사후 판별
  가능하고, 필드를 늘릴수록 계약이 무거워진다.

### DEC-3 — design 리뷰는 세 값 모두 `null`

판정 자체를 하지 않는 경로다(REQ-2026-086 DEC-7). `0`이 아니라 `null`이어야 "면적 0"과
"측정 대상 아님"이 구별된다(R3).

### DEC-4 — `granularityGate` 값과 무관하게 기록한다

`warn`이든 `block`이든 **판정은 항상 일어난다.** 기록도 항상 한다 — 그래야 "경고만 하는 설정에서
몇 번 넘겼는가"라는, 이 REQ가 답하려는 바로 그 질문에 답할 수 있다.

(`block`에서 초과하면 리뷰 호출 자체가 없으므로 그 회차는 로그에 행이 없다. 그건 정상이다 —
호출이 없었으니 호출 로그도 없다.)

### DEC-5 — 옵셔널 필드로 추가한다

`ReviewCallLogRow`의 신규 3필드는 `| null`이고, 빌더 인자도 옵셔널이다.
옛 행에는 키가 없고, 읽는 쪽은 REQ-2026-045 이후로 이미 "없는 필드는 없는 것"으로 다룬다(R6).

## Phase별 구현

### phase-1-log-area (DEC-1~5)

- `scripts/req/review-codex.ts`
  - `ReviewCallLogRow`에 3필드 추가(DEC-2).
  - `buildReviewCallLogRow` 인자에 옵셔널 `phaseArea?: PhaseAreaVerdict | null` → 세 값으로 펼침.
  - phase preflight의 verdict를 지역 변수로 보존해 로그 빌드에 전달(DEC-1).
- `tests/unit/req-review-codex.test.ts` — 회귀 가드

회귀 가드: ①phase 리뷰 행에 `code_file_count`·`granularity_over`·`granularity_limit`가 실림
②초과/비초과가 `granularity_over`에 정확히 반영 ③`max_files` 선언 시 `granularity_limit`가 그 값
④design 리뷰 행은 세 값 모두 `null`(DEC-3) ⑤인자 미지정(legacy)이면 세 값 `null`(DEC-5)
⑥🔴 **경로·파일명이 행에 없다**(R4 — 내용배제 계약).

### phase-2-changelog

- `CHANGELOG.md` — Unreleased + **확인할 파일 표**(phase-1 커밋 SHA·경로).

## 변경 파일

| 파일 | phase |
|---|---|
| `scripts/req/review-codex.ts` | 1 |
| `tests/unit/req-review-codex.test.ts` | 1 |
| `CHANGELOG.md` | 2 |

## 하위호환·안전

- **판정 로직·임계·게이트 동작 무변경.** 기록만 추가한다.
- 신규 필드는 옵셔널 + `| null` → 옛 행·legacy 호출 모두 그대로.
- 로그 쓰기 실패는 여전히 삼킨다(R5) — 측정 로그가 게이트를 막지 않는다.
- `.review-calls.jsonl`은 계속 gitignore(측정 전용). 스키마 무변경 → `commitgate sync` 불요.
