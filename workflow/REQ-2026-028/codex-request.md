# REQ-2026-028 리뷰 요청

## 배경

CommitGate 개선 **A-2a** — 예산 게이트·escalation·사람 예외. A-1(REQ-2026-027)이 main `42f599f`에 병합됨.

A-1은 review series를 **정확히 세는 토대**를 놓았지만(`recordAttempt`가 hash 변경에도 누적, `approved`만
자동 종료) **아무것도 막지 않는다.** 이 REQ가 그 계수 위에 **예산 게이트**를 얹어 무한 재리뷰를 물리적으로
끝낸다 — REQ-020 14라운드·REQ-013 17라운드 폭주를 상한으로 차단하되, 정상 수렴(이력 15/21이 ≤5회)은
막지 않는다.

**출처와 분할**: REQ-2026-026(통합 REQ-A)이 예산+escalation+lineage+로그를 한 REQ에 담아 6라운드 미수렴
종료(merge 금지 감사보존). 그 배분표가 A를 A-1(계수)·A-2a(게이트)·A-2b(lineage·로그)로 나눴다. 사용자
결정으로 A-2를 A-2a/A-2b로 재분할. **이 REQ(A-2a)는 D4·D5 = 배분표 ①⑤⑥까지만.** ③⑩⑪⑫⑬⑭는 A-2b.
근거: A-1(356줄)이 4라운드 수렴 — 표면을 그 체급으로.

**026이 이 영역에서 이미 잡힌 결함을 처음부터 반영**:
- ⑤ 게이트를 `escalated`로 판정하면 5회차 INVALID/BLOCKED 뒤 6회차 자동 통과 → §D1 **기준은 attempts뿐**
- ⑥ config `hardCap=9` 허용하면 R4 붕괴 → §D3 **loadConfig fail-closed 범위 검증(hardCap≤8)**
- ① 예외 소비가 series를 닫아 상한 우회 → §D2 **예외 소비는 closed_reason 안 건드림**

## design-r01 지적 반영 (P1 4건 — 전부 유효)

1. 🔴 **`consumeReviewException`이 손기록 형식을 검증 안 함.** `{confirmed:false, method:''}`도 소비돼 예외를
   우회(배분표 ⑪·REQ-019 부류). → §D2: `confirmed===true` + 비어있지 않은 method + 유효 ISO confirmed_at
   fail-closed 검증. O1-4b가 각 위반을 throw로 고정.
2. 🔴 **G3 누적 findings가 거짓말.** `last_review.findings`는 직전만 담아 INVALID/BLOCKED면 0건. → §D4:
   G3 diagnostics를 **시도 수·직전 outcome·선택지**로 축소. 진짜 누적 findings는 새 저장 모델이 필요해
   **A-2b로 이관**(R12 축소). 이건 범위 확장 회피.
3. 🔴 **배포용 config 스키마 누락.** 런타임 `CONFIG_SCHEMA`만 바꾸면 드리프트 가드 테스트
   (`req-config.test.ts`, `CONFIG_SCHEMA`==`workflow/req.config.schema.json`)가 실패하고 설치본이
   `reviewBudget`을 거부. → §D3: **두 스키마 + `req.config.json.sample`(observation)** 모두 변경 파일에 포함.
4. 🔴 **O1-6이 하한을 안 봄.** `{0,0}` 허용 구현도 통과. → O1-6에 `hardCap<1`·`autoBudget<1` 회귀 추가.

## design-r02 지적 반영 (P1 1건 + observation)

1. 🔴 **문서 간 불일치**: 01-design·요청서엔 배포 스키마를 넣었으나 **02-plan phase-1 변경 파일 목록에서
   누락**. → 목록에 `workflow/req.config.schema.json`·`req.config.json.sample` 추가(D3·O1-6b와 정합).
2. observation(ISO 검증): `Date.parse` 재직렬화 비교는 `...08Z`(밀리초 없는 유효 ISO)를 거부. → **기존
   `ISO_RE`(`req-commit.ts:37`, 밀리초 선택적) 재사용**으로 통일 — `user_commit_confirmed`과 같은 검증.
   O1-4b에 밀리초 없는 ISO 통과 사례 추가.

## design-r03 지적 반영 (P1 1건)

1. 🔴 **`ISO_RE`가 달력상 불가능한 값도 통과**: `2026-99-99T99:99:99Z`가 정규식엔 맞아 소비됨. → §D2:
   **형식(`ISO_RE`) + 달력 유효성(재파싱 성분 일치)** 둘 다 보는 새 헬퍼 `isValidIsoInstant`. 밀리초 없는
   유효값은 계속 통과, 달력 불가능값은 거부. O1-4b에 두 사례 고정.
   ※ 범위 경계: `req-commit.ts`의 기존 `ISO_RE`(user_commit_confirmed)는 **건드리지 않는다** — 같은 결함이
   있지만 A-2a(예산 게이트) 범위 밖, 후속 observation. 이 REQ는 새 `review_exception_confirmed`만 엄격 검증.

## 변경 요약

설계 문서 3종만(구현 diff 없음 — design 리뷰). 2 phase. **강제 게이트가 먼저.**

- **phase-1 (D1·D2·D3)**: `checkReviewBudget(openAttempts, budget)`(순수) → allow / needs-exception /
  hard-blocked. `consumeReviewException`(순수, for_series_id·for_attempt 바인딩, 1회 소비, **series 안 닫음**).
  `withAttemptRecorded`에 게이트 삽입(recordAttempt **전**). config `reviewBudget` + 범위 검증(hardCap 1~8).
- **phase-2 (D4·D5)**: `gateRunCandidate` G3(escalated→AWAIT_HUMAN), 우선순위 **G1→G3→G2**,
  `NextInput.reviewBudget`.

`recordAttempt`·`closeSeriesApproved`·A-1 계수·G1·G2·`classifyReview`·승인 바인딩·`machine.schema.json`
**무변경**. `closed_reason` 타입도 `'approved'|null` 그대로(A-2b가 `'human-resolution'` 추가).

## 리뷰 포인트

리뷰 포인트는 심사 범위의 하한이다. 아래에 없는 결함도 지적하라.

1. **🔴 게이트 기준이 정말 `attempts`뿐인가**(§D1·R2, 배분표 ⑤). `checkReviewBudget`이 `openAttempts`만
   받는다 — `escalated`나 직전 outcome을 입력으로 쓰지 않는가? 5회차 INVALID/BLOCKED 뒤 6회차가 예외를
   요구하는가(O1-8)? 순수 함수 시그니처가 구조적으로 attempts를 강제하는가?

2. **🔴 예외 소비가 series를 닫지 않는가**(§D2·R10, 배분표 ①). `consumeReviewException`이 `closed_reason`을
   건드리지 않는가? 6회차 예외 소비 후 NEEDS_FIX면 같은 series가 열린 채 남아 7회차에 또 예외를 요구하는가
   (O1-9)? 닫으면 새 series(0회)로 7·8 예외와 9회 상한이 우회되는데, 그 경로가 실제로 막혔는가?

3. **🔴 config 범위 검증이 R4를 지키는가**(§D3·R7, 배분표 ⑥). `hardCap>8`이 loadConfig에서 throw되는가?
   `autoBudget>hardCap`도? AJV 스키마와 코드 검증의 역할 분담(타입 vs 교차검증)이 맞는가? config로 R4를
   뚫을 다른 경로가 남아 있는가?

4. **🔴 게이트가 `recordAttempt` 전인가**(§D1·R5). attempt를 기록하기 **전**에 막는가? 막을 때 state가
   안 바뀌는가(A-1 계약)? 예외 소비 성공 시에만 쓰는가? `hard-blocked`은 예외를 아예 안 보는가(O1-10)?

5. **🔴 G3 우선순위 G1→G3→G2**(§D4·R13, 배분표 근거). 5회차 NEEDS_FIX 직후 동시 성립(escalated + 같은
   바인딩 needs-fix)에서 G3가 G2를 이겨 `AWAIT_HUMAN`이 나오는가(O2-2)? G1이 G3보다 앞서는가(dirty면
   정리 먼저)? 정상 series에서 G2가 무변경인가(O2-4)?

6. **`escalated`가 파생값인가**(§D4·R11). state에 저장하지 않고 `gateRunCandidate`가 그 자리에서 계산하는가?
   저장하면 갱신 누락으로 R2 구멍이 재현되는데, 그 위험이 실제로 제거됐는가?

7. **A-2a 단독 병합·범위**(§하위호환·안전·R14). lineage(A-2b) 없이 게이트만으로 "무한 재리뷰 상한"이
   완결되는가? escalate 안내에 **"위험 수용"이 없는** 것이 맞는가(배분표 ④ — 우회 게이트는 별도 REQ)?
   미설정 기본값(5/8)으로 기존 티켓이 그대로 동작하는가?

8. **oracle이 회귀를 잡는가**(02-plan). O1-2(6~8 예외)·O1-3(9 hard-block)·O1-5(예외가 series 안 닫음)·
   O1-6(hardCap>8 throw)·O1-7/O1-8(near-e2e 예외 없이 호출 0회·INVALID 직후도)·O1-10(예외로도 9 차단)·
   O2-2(G3>G2 동시 성립). 각 "→ 실패해야 하는 구현"이 실제로 실패하는가?

9. **near-e2e 하네스**(A-1 재사용). fake reviewer + attempts 시드 + process.exit mock으로 게이트 강제를
   main 경로에서 검증한다. 우회 없이 진짜 게이트를 태우는가?
