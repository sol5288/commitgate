# REQ-2026-025 설계 — 리뷰 배칭과 review-call 측정

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

- `workflow/review-persona.md` — 리뷰어 역할 계약. `req:review-codex`가 프롬프트 **첫 블록**으로 주입
  (`assembleReviewPrompt`, `scripts/req/review-codex.ts:104`). 부재·빈 내용·symlink는 `loadReviewPersona`가
  fail-closed로 거부한다. **탐색을 넓히라는 지시는 있으나 P1 전수 반환 지시는 없다.**
- `scripts/req/review-codex.ts:1395` — `resolveReviewOutcome()`이 `outcome`·`exitCode`·`finalState`를
  확정하고 `writeState`한다. **완료된 review call의 결과가 한자리에 모이는 유일한 지점.**
- 응답 구조: `Verdict.findings?: Finding[]` · `Verdict.observations?: Observation[]`
  (`review-codex.ts:283`). `ReviewOutcome = 'approved'|'needs-fix'|'blocked'|'invalid'` (`:376`).
- 아카이브 round는 `decision`이 있을 때만 정해진다(`:1369`~`:1378`). **무효 응답은 아카이브를 남기지 않는다.**
- `.gitignore`에 이미 workflow 스크래치 관례가 있다 — `workflow/**/codex-response.json`,
  `workflow/**/.review-preview.txt`, `workflow/**/.codex-*.tmp`.
- analytics/telemetry 인프라는 **없다**. `workflow/` 아래 jsonl은 `responses/approvals.jsonl` 하나뿐이다.

## 핵심 설계 결정

### D1. 배칭은 persona 본문 계약으로만 넣는다 (R1·R2·R3·R4·R5)

`workflow/review-persona.md`에 두 절을 추가·개정한다. **코드 변경 없음** — 주입은 이미 배선돼 있다.

1. **응답 전 점검 관점**을 `review_kind`별로 나눈다. `REVIEW_KIND`는 이미 프롬프트에 있으므로
   (`:120`) 리뷰어가 자기 목록을 고를 수 있다.
   - `design`(initial): 요구·비목표·인수기준 / 00·01·02 문서 간 모순 / 요구된 정상 경로의 계약 위반 /
     테스트 oracle이 실제 실패를 잡는지 / 보안·fail-closed 경계 / 설계가 약속한 문서·CLI help·기존 동작과의 호환성
   - `phase`: staged diff가 인수기준을 충족하는지 / 변경된 oracle이 실제 실패를 잡는지 / 변경된 사용자
     대면 문서·CLI help가 실제 동작과 일치하는지 / 보안·fail-closed 경계가 diff에서 약화되지 않는지
2. **전수 반환 의무**: 이번 호출에서 식별한 모든 P1을 `findings[]`에 함께 반환한다. 아는 P1을 다음
   라운드로 미루지 않는다. 확신 못 하면 부풀리지 말고 `observations`로 내린다.

**R3 경계가 이 설계의 핵심이다.** 현행 페르소나에는 "리뷰 대상이 아닌 것을 근거로 지적하지 마라 /
설계 리뷰에서 '구현이 없다'는 지적은 성립하지 않는다"가 있다. `design`에 "기존 동작과의 호환성" 관점을
넣으면 이 조항과 충돌한다. 그래서 **읽기 허용 범위를 약속에 묶는다**:

> 기존 코드·CLI help는 **설계가 현재 동작과의 호환 또는 문서·help 변경을 약속한 경우에만** 그 약속을
> 검증하는 기준선으로 읽는다. 설계와 무관한 기존 코드 결함은 `findings`가 아니라 `observations`다.

이 경계는 REQ-023 r03 같은 유효한 지적(설계가 README·help 변경을 약속했고 실제 `printHelp`와 어긋남)은
살리고, 설계와 무관한 기존 코드로의 범위 확산은 막는다.

`machine.schema.json`은 **건드리지 않는다**(R4·R5). `findings[]`는 이미 배열이고 다수 항목을 담을 수 있다.
배칭은 스키마 문제가 아니라 지시 문제였다.

### D2. `policy_version` = persona 본문 sha256 앞 12자 (R6)

로그의 목적은 "배칭 정책 전/후를 세그먼트해 라운드당 P1 수를 비교"하는 것이다. 그러려면 각 행이 **어떤
persona로 생성됐는지** 알아야 한다.

- `policy_version = sha256(persona 본문).slice(0, 12)`
- persona가 비활성(`reviewPersonaPath: null` → `loadReviewPersona`가 `null`)이면 `"none"`.

**수동 상수 bump를 쓰지 않는 이유**: persona를 고치고 상수 올리기를 잊으면 세그먼트가 조용히 거짓이 된다.
이 프로젝트는 사람이 손으로 기록하는 값이 실제와 어긋나 REQ 하나를 폐기한 이력이 있다(REQ-019). **자동
파생이 유일하게 신뢰 가능한 경로다.** 부가 이득: 사용자가 `reviewPersonaPath`로 커스텀 persona를 쓰면
그것도 자동으로 구분된다.

사람이 읽을 이름이 필요해지면 값→이름 매핑을 나중에 만든다. 지금은 **동일성 판정만** 필요하다.

### D3. 로그는 gitignore된 repo 로컬 append 파일 (R7)

- 경로: `workflow/.review-calls.jsonl` (repo 루트 기준 고정)
- 형식: JSON Lines. 1행 = 완료된 review call 1건. append-only.
- `.gitignore`에 `workflow/.review-calls.jsonl` 추가 — 기존 workflow 스크래치 관례와 같은 자리.

**커밋하지 않는 이유**: 병합된 020~024 커밋 49개 중 제품 코드는 11개, finalize 장부가 25개다. ledger가
이미 제품을 압도한다. 측정을 얻자고 review call마다 커밋을 늘리면 배경에 적힌 문제를 A0가 키운다.

**티켓별이 아니라 전역인 이유**: 측정 단위가 REQ를 넘는다("최소 5개 이상의 새 series"). 티켓 디렉터리에
흩으면 집계가 티켓 순회를 요구한다. 한 파일이면 append도 집계도 단순하다.

**내용을 담지 않는다**: 프롬프트 본문·diff·`findings` 본문·`observations` 본문은 기록하지 않는다. R6 필드만.
근거: 리뷰 프롬프트는 `git diff --cached` 전문을 담을 수 있고(AGENTS 계약 §6), 그 본문을 로컬 파일에
복제하면 마스킹 없는 사본이 하나 더 생긴다. **개수만 세면 목적이 달성된다.**

### D4. 기록 지점 = `resolveReviewOutcome` 직후 (R6·R8)

`main()`에서 `resolveReviewOutcome`이 `outcome`을 확정하고 `writeState`한 뒤에 append한다(`:1395`~`:1403`).
그 시점에 R6 필드가 전부 확정돼 있다.

- `archive_round`: `decision`이 `null`(무효 응답)이면 아카이브가 없으므로 **`null`**. 있으면 그 round 번호.
- `findings_count`/`observations_count`: `result.verdict.findings?.length ?? 0` / 동일 패턴.
- `timestamp`: 이미 계산된 `approvedAt`(ISO)을 재사용한다. **새 시계를 읽지 않는다** — 같은 call의 다른
  기록과 시각이 어긋나지 않게.

**이 로그는 "attempt 원장"이 아니다.** codex 호출 후 리뷰어 무수정 검증(`:1347`~`:1352`)에서 throw되면
행이 남지 않는다. 그건 A0의 목적(라운드당 P1 수 관측)에 필요 없다. **호출 직전 attempt 기록은 REQ-A의
계약이고, A0는 그것을 정의하지 않는다**(R9).

### D5. 실패 격리 (R8)

append는 `try/catch`로 감싸고 실패를 삼킨다. 측정 실패가 리뷰 판정·exit code·state를 바꾸면 안 된다.
`archiveDesc` 기록이 이미 같은 패턴을 쓴다(`:1381`).

이건 fail-closed 원칙의 예외가 아니다 — **게이트가 아닌 것에는 fail-closed를 적용하지 않는다.** 로그는
승인 근거가 아니다.

### D6. 확장 지점 (R9)

A0는 `series`·`attempt`·`lineage`·`full_review` 개념을 **정의하지도 기록하지도 않는다.**

- REQ-A가 `series_id`·`attempt_number`·`escalation`·`lineage`를 이 행에 **추가**한다.
- REQ-B가 `review_mode`·`full_review_requested`·`full_review_approved`를 **추가**한다.

행 형식은 **열린 객체**다. 나중에 필드가 늘어도 기존 행은 유효하다. A0는 필드 집합을 고정하지 않고
"최소 필드"만 보장한다. 리더는 없는 필드를 `undefined`로 다뤄야 한다.

## Phase별 구현

| phase | 범위 | 변경 파일 |
|---|---|---|
| `phase-1-batching-persona` | D1 — persona 배칭 계약·kind별 관점·R3 경계 | `workflow/review-persona.md`, 단위 테스트 |
| `phase-2-review-call-log` | D2~D6 — `policy_version`·로그 append·gitignore | `scripts/req/review-codex.ts`, `.gitignore`, 단위 테스트 |

## 변경 파일

- `workflow/review-persona.md` — 배칭 계약·kind별 관점·R3 경계 (phase 1)
- `scripts/req/review-codex.ts` — `policy_version` 파생·`appendReviewCallLog`·`main()` 배선 (phase 2)
- `.gitignore` — `workflow/.review-calls.jsonl` (phase 2)
- 단위 테스트 (양 phase)

## 하위호환·안전

- `machine.schema.json` **무변경** → 기존 v1.1 archive 검증·legacy evidence 그대로.
- 승인 바인딩(`findings` 0건일 때만 승인)·`observations` 경계·`classifyReview` **무변경**.
- persona 본문만 바뀌므로 `loadReviewPersona`의 fail-closed 경로(부재·빈 내용·symlink) **무변경**.
- 로그는 gitignore → 기존 티켓·`git status`·`req:doctor`의 D10(워킹트리 clean) 판정에 영향 없음.
  → **이 무영향은 phase-2에서 실제로 확인한다**(계획 참조). gitignore 누락 시 워킹트리가 dirty로 보여
  D10 FAIL로 전체 워크플로가 멈추므로 추정으로 넘기지 않는다.
- 로그 실패는 삼켜지므로 리뷰 경로는 로그 유무와 무관하게 동일하다.
- 이 REQ는 **additive**다. 완료 시 후속 REQ를 기다리지 않고 단독 병합한다.
