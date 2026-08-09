# REQ-2026-117 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

| 사실 | 위치 | 확인 |
|---|---|---|
| D30은 미도달 목록을 분류 없이 나열한다 | `req-doctor.ts` D30 블록(`strandedEvidence`) | 읽음 |
| D30 술어 = 리뷰받은 티켓 중 trunk 트리에 `responses/` 경로가 없는 것 | `strandedReviewedTickets` | 읽음 |
| trunk 경로 집합은 `ls-tree` 1회로 수집(로컬 trunk만) | `main()` D25/D30 수집부 | 읽음 |
| 리뷰 로그 reader는 티켓별 **횟수만** 반환 | `readReviewCallCounts` | 읽음 |
| 실행 로그 행은 `nonok: [{id, level}]`뿐 — 대상 식별자 없음 | `DoctorRunRow`·`buildDoctorRunRow` | 읽음 |
| 실행 로그 필드는 append-only로 확장 가능하다고 스스로 명시 | `DoctorRunRow` 주석("필드 추가로 확장 가능") | 읽음 |
| 실측: yammy 미도달 2건(REQ-009·025)은 **둘 다 로컬 브랜치 생존** | 2026-08-09 재검증 | 실측 |
| 실측: 과거 "로컬 trunk 뒤처짐" 관측은 당일 동기화로 현재 재현 안 됨(메커니즘은 실재) | 〃 | 실측 |
| 실측: lean의 D30 11회는 병합 직전 창의 일시 발화(자연 소멸) | M-13(2026-08-03) | 이월-재확인 |

## 핵심 설계 결정

### DEC-1 · 분류는 순수 함수, 우선순위 remote-trunk → branch-alive → stranded

```
classifyStranded(input: {
  stranded: {id, reviews}[]              // 기존 strandedReviewedTickets 산출
  remoteTrunkTickets: Set<string> | null // 원격 추적 ref 트리에 responses/가 있는 티켓. null=판정 불가
  localBranches: string[]                // git branch --list 결과(이름만)
  lastReviewAt: Map<string, string>      // 티켓별 마지막 리뷰 시각(ISO). 부재 허용
  nowIso: string
}) → { id, reviews, category: 'remote-trunk'|'branch-alive'|'stranded', ageDays: number|null }[]
```

- **remote-trunk가 최우선**: 원격 메인라인 트리에 증거가 실재한다는 것은 결정적 사실이다 —
  로컬 trunk만 뒤처진 상태이며 pull로 해소된다. branch-alive는 이름 기반 휴리스틱이라
  사실 판정보다 뒤에 둔다.
- **branch-alive 일치 조건(설계 리뷰 r01 P1)**: 브랜치명 소문자에 **전체 티켓 id 소문자**
  (예: `req-2026-009`)가 **비영숫자 경계**로 나타날 때만 일치한다 — 앞 문자가 영숫자가 아니고
  뒤 문자가 숫자가 아니어야 한다. 숫자부만 일치(`fix/2026-009-logging`)하거나 id가 더 긴 id의
  접두인 경우(`req-2026-0091`)는 **불일치**다. 관련 없는 브랜치가 실제 stranded 조치 대상을
  branch-alive로 가리는 false-positive를 막는다(테스트로 고정).
- `ageDays`는 마지막 리뷰 이후 경과일(내림). **임계값 판정은 하지 않는다** — D30의 기존 원칙
  ("근거 없는 임의 임계를 넣지 않는다")을 유지하고 연령은 표시만 한다. 실측이 이 결정을 뒷받침한다:
  yammy의 실신호 2건과 lean의 잡음 11건은 둘 다 branch-alive라 **존재 축으로는 갈리지 않고,
  연령으로만 갈린다**(수 주 vs 수 시간). 판단은 사람이 한다.

### DEC-2 · 원격 추적 ref는 upstream 설정에서 얻는다 — fetch 금지

- ref 이름: `git rev-parse --abbrev-ref <trunk>@{upstream}` (예: `origin/main`).
  upstream 미설정·ref 부재 → `remoteTrunkTickets = null`(그 축 판정 불가 — 문구로 표기하고
  나머지 분류는 계속). 리모트 이름을 `origin`으로 하드코딩하지 않는다.
- 수집: `ls-tree -r --name-only <upstream> -- <ticketRoot>` 1회에서 `responses/` 보유 티켓 집합
  (로컬 trunk와 같은 파생 — `strandedReviewedTickets`의 `inTrunk` 파생과 동일 정규식).
- 신선도: `git log -1 --format=%cI <upstream>` 1회 — 메시지에 "원격 추적 ref 기준(fetch 안 함),
  마지막 커밋 <시각>"으로 표기한다. 낡은 ref로 단언하지 않기 위한 최소 고지다.
- 추가 git 호출: rev-parse 1 + ls-tree 1 + log 1 + branch --list 1 = **4회, 네트워크 0회**.
  전부 D30 축이 계산될 때만(trunk 존재·로그 존재) 실행한다.

### DEC-3 · 리뷰 로그 reader 확장 — counts 계약은 그대로 두고 stats를 추가

`readReviewCallStats(absPath): Map<string, {count, lastAt: string|null}> | null`을 신설하고
`readReviewCallCounts`는 그 파생으로 유지한다(기존 호출부·테스트 무변경). 파싱 규칙은 동일 —
손상 행 스킵, 전부 손상이면 null(모르는 것을 단언하지 않는다). `at`이 없는 행은 count만 기여.

### DEC-4 · 메시지 재구성 — 조치 대상 우선, level 불변

- **세 범주 모두 티켓별로 `REQ-x(리뷰 n회·마지막 리뷰 N일 전)` 형식을 쓴다**(설계 리뷰 r01 P1 —
  R1의 "각 티켓 연령 표기"는 범주와 무관하다). **`lastAt`이 없는 티켓은 연령을 생략하지 않고
  `마지막 리뷰 시각 미기록`으로 표기한다**(r02 P1 — 부재도 티켓별 상태 정보다. `ageDays: null`이
  이 표기로 렌더링된다). 범주가 바꾸는 것은 묶음의 머리말뿐이다:
  - `stranded`(실조치 대상): 목록 선두 배치.
  - `branch-alive`: "미병합 브랜치에 있습니다(진행 중이면 정상 — 병합하면 해소)" + 티켓별 상세.
  - `remote-trunk`: "로컬 <trunk>가 원격 추적 ref보다 뒤처져 있습니다 — pull로 해소" + 신선도
    + 티켓별 상세.
- 원격 축 판정 불가 시: "(원격 추적 ref 없음 — 원격 존재 여부는 판정하지 않음)" 1구절.
- **level은 WARN 그대로.** 분류·수집 실패는 축 축소로만 나타나고 FAIL로 격상되지 않는다.
  전부 branch-alive여도 WARN이다 — yammy의 실손실 2건이 정확히 branch-alive였다(침묵 강등 금지).

### DEC-5 · 실행 로그 `subjects` — 저위험 식별자만, 선택 필드

- `Check`에 `subjects?: string[]` 추가. 이번 REQ에서 채우는 검사는 **D25·D29·D30** 세 개다
  (발화 상위이면서 대상이 자연스러운 저위험 식별자인 것들 — D25/D30은 티켓 id, D29는 계약 파일명).
- `buildDoctorRunRow`가 `nonok[]`에 `subjects`를 **있을 때만** 직렬화한다(부재 = 키 없음).
  기존 행은 그대로 유효하다(append-only JSONL 선례 — 원장 OPTIONAL_KEYS와 같은 태도).
- 허용 규칙을 테스트로 고정: `subjects` 원소는 `REQ-` 접두 티켓 id 또는 `CONTRACT_FILE_RELS`
  원소만. 워킹트리 경로·메시지 본문이 새어 들어오는 회귀를 막는다(REQ-2026-111의
  "경로·본문 미기록" 결정 계승 — D10 등 경로 주체 검사는 **의도적으로 제외**).

### DEC-6 · 하지 않는 것

- `commitgate report` 집계 명령 — 별도 REQ(관측 데이터가 더 쌓인 뒤).
- D30/D25의 level·발화 조건 변경, 중복 발화 억제(상태 전환 검출) — 로그에 subjects가 쌓이면
  후속에서 데이터로 판단한다.
- 소비자 문서의 D30 서술 변경 — 기존 문장("리뷰를 받았는데 증거가 trunk에 없는 티켓을 리뷰
  횟수와 함께")은 분류 추가 후에도 참이다. CHANGELOG로 알린다.

## Phase별 구현

**Phase 1 (`phase-1-d30-classify`)** — `classifyStranded` 순수 함수 + `readReviewCallStats` +
수집부(upstream ref·branch 목록·신선도) + D30 메시지 재구성 + 테스트.

**Phase 2 (`phase-2-runlog-subjects`)** — `Check.subjects` + D25·D29·D30 채움 +
`buildDoctorRunRow` 직렬화 + 허용 규칙 테스트 + CHANGELOG.

## 변경 파일

| 파일 | 변경 | phase |
|---|---|---|
| `scripts/req/req-doctor.ts` | 분류기·stats reader·수집부·D30 메시지 / subjects | 1·2 |
| `tests/unit/d30-classify.test.ts` | 신규 — 분류·판정불가·fetch 무호출 | 1 |
| `tests/unit/req-doctor.test.ts` | D30 메시지 기대 갱신(해당 시) | 1 |
| `tests/unit/doctor-run-log.test.ts` | subjects 직렬화·하위호환·허용 규칙 | 2 |
| `CHANGELOG.md` | Unreleased | 2 |

## 테스트 oracle (완료 기준 ↔ 검증)

| 완료 기준 | 오라클 | 잡는 결함 |
|---|---|---|
| 1 | 세 범주 각 1케이스 + 우선순위(remote-trunk가 branch-alive를 이김) + **branch-alive 경계**(숫자부만 일치·접두 id는 불일치) | 분류·순서·false-positive 회귀 |
| 2 | `remoteTrunkTickets: null` → 메시지에 판정 불가 구절 + 나머지 분류 유지 | 모르는 것을 단언 |
| 3 | fake GitAdapter 호출 기록에 `fetch` 부재 단언 | 네트워크 유입 |
| 4 | `ageDays` 계산 + **세 범주 모두** 메시지에 티켓별 연령 표기(lastAt 부재 시 `마지막 리뷰 시각 미기록` 표기 — 생략 금지) | 연령 회귀·범주별 누락·부재 정보 소실 |
| 5 | subjects 있는 행 직렬화 ↔ 없는 기존 행 파싱 공존 | 하위호환 파손 |
| 6 | subjects 원소 전수 허용 규칙 검사(티켓 id·계약 파일명만) | 경로·본문 유출 |

## 하위호환·안전

- 게이트 판정·exit·level 전부 무변경. D30 메시지 문자열만 바뀐다(메시지에 의존하는 소비자 계약 없음).
- `readReviewCallCounts` 시그니처·계약 유지(파생으로 재구현).
- `.doctor-runs.jsonl`은 선택 키 추가만 — 기존 소비 스크립트는 영향 없음.
- 116 브랜치와의 병합 순서: 이 REQ는 main에서 분기했고 REQ-2026-116과 겹치는 파일이 없다
  (CHANGELOG Unreleased 제외 — 병합 시 양쪽 항목을 나란히 두면 된다).
