# REQ-2026-030 요구사항 — ISO 달력 검증 통일

## 1. 배경

REQ-2026-028(A-2a)이 `isValidIsoInstant`를 도입했다 — ISO 형식(`ISO_RE`) **+ 달력 유효성**(재파싱 성분
일치)을 함께 본다. `2026-99-99T99:99:99Z` 같은 **달력상 불가능한 값**을 거부한다(A-2a design-r03 P1).

그런데 **기존 `req-commit.ts`의 ISO 검증(3곳)은 정규식만 쓴다** — 같은 달력 결함이 있다:
- `:166` `approved_at`(approvals.jsonl 매니페스트 검증)
- `:167` `consumed_at`(동)
- `:231` `confirmed_at`(user_commit_confirmed 검증)

`2026-99-99T99:99:99Z`가 이 3곳을 전부 통과한다. A-2a는 새로 도입한 `review_exception_confirmed`만 엄격
검증하고, 기존 것은 **범위 밖으로 남겼다**(후속 observation). 이 REQ가 그 후속이다.

## 2. 목표(What)

`req-commit.ts`의 ISO 검증 3곳을 **`isValidIsoInstant`로 통일**해, 손기록·evidence의 ISO 필드가
`review_exception_confirmed`와 **같은 수준의 달력 무결성**을 갖게 한다.

**기존 검증 동작을 약화하지 않는다** — 더 엄격해질 뿐이다. 지금까지 도구가 쓴 값은 전부
`new Date().toISOString()`이라 통과한다.

## 3. 요구(정규화)

- **R1 3곳 통일**: `req-commit.ts`의 `approved_at`·`consumed_at`·`confirmed_at` 검증을 `ISO_RE.test()`에서
  **`isValidIsoInstant()`**로 바꾼다. `isValidIsoInstant`는 review-codex에서 export되고 req-commit이 이미
  review-codex를 import한다(순환 없음 — 단방향). (Done #1)
- **R2 🔴 더 엄격해질 뿐, 약화 없음**: `isValidIsoInstant`는 `ISO_RE`의 상위집합이 **아니라 부분집합**이다
  (형식 통과 + 달력 통과만 유효). 기존에 통과하던 **정상 값**(밀리초 있는/없는 유효 ISO)은 계속 통과하고,
  기존에 통과하던 **달력 불가능 값**만 이제 거부된다. 기존 evidence 검증·`req:doctor`·finalize 흐름이
  깨지지 않는다. (constraints)
- **R3 중복 `ISO_RE` 제거**: `req-commit.ts:37`의 `ISO_RE`가 다른 용도로 안 쓰이면 제거한다(3곳이 전부
  `isValidIsoInstant`로 바뀌면 orphan). 다른 용도가 있으면 남긴다. (Done #1)
- **R4 회귀 오라클**: 3 필드 각각에 대해 (a) 정상 ISO(밀리초 유·무)는 통과, (b) 달력 불가능
  (`2026-99-99...`·13월·2월 30일)은 거부, (c) 형식 위반은 거부를 단언한다. **기존 통과 케이스가 계속
  통과함**을 함께 고정한다(약화 없음 증명). (Done #2)
- **R5 테스트·typecheck**: 단위 테스트·typecheck 통과. (Done #2)

## 4. 비목표

- 🔴 **로그 측정**(배분표 ⑫⑬⑭)·**accept-risk 우회 게이트**(④)·**REQ-B**(design delta review). 별도 REQ.
- `isValidIsoInstant`의 **동작 변경**. 이미 A-2a에서 검증됐다 — 그대로 재사용만 한다.
- 다른 파일의 ISO 검증(있다면). 이 REQ는 `req-commit.ts` 3곳만 겨냥한다.
- 기존 REQ-001~029의 문서·state·승인 evidence 소급 수정.

## 5. 인수 기준

1. `req-commit.ts`의 3곳이 `isValidIsoInstant`를 쓴다. `ISO_RE`가 orphan이면 제거된다.
2. `approved_at`·`consumed_at`·`confirmed_at`에 `2026-99-99T99:99:99Z`를 넣으면 검증이 **거부**한다.
3. 정상 ISO(`...08Z`·`...08.480Z`)는 3곳 모두 계속 **통과**한다(약화 없음).
4. 기존 evidence 검증·`req:doctor`·finalize 흐름이 깨지지 않는다(전체 테스트 그린).
5. 단위 테스트·typecheck 통과.
