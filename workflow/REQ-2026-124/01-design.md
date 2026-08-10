# REQ-2026-124 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

| 사실 | 위치 | 확인 |
|---|---|---|
| 관측 로그 3종이 로컬에 축적 — 요약 수단 없음(손집계뿐) | `.doctor-runs/.review-calls/.verify-runs` | 실측(이 세션) |
| 읽기 전용 verb 선례: 순수 판정 + 수집 분리·`--json` 동일 파생 | `bin/check.ts`(DEC-2·DEC-5) | 읽음 |
| verify-range 코어는 재사용 가능한 순수 모듈 | `lib/verify-range.ts` | 읽음 |
| 런로그 subjects로 (검사, 대상) 추적 가능 | REQ-2026-117 | 읽음 |
| `archive_round`는 시리즈 리셋 없음 — "대상당 총 호출"이 정확한 이름 | 가설 폴더 M-7 정정 | 이월-확인 |
| verb 등록·help 정합 가드 | `dispatch.mjs`·`init.test.ts` | 읽음 |

## 핵심 설계 결정

### DEC-1 · 집계는 순수 lib(`scripts/req/lib/report.ts`), bin은 수집·렌더만

```
buildReport(input: {
  doctorRuns: string | null      // 파일 본문(부재 null)
  reviewCalls: string | null
  verifyRuns: string | null
  verifyRange: VerifyRangeReport | null   // trunk 계산 가능할 때만(bin이 lib/verify-range로 산출)
}) → Report   // { doctor?, review?, evidence?, ci?, problems: {file, skipped}[] }
```

- 각 섹션은 원천 null이면 **부재로 표기**(undefined 섹션 → 렌더가 "데이터 없음"). 추정 금지(R2).
- 손상 행: 파일별 skipped 카운트로 집계(전체 실패 없음 — R4·기존 관측 소비 관례).

### DEC-2 · 섹션별 산식 (정직한 명명 — R3)

- **doctor**: 행 수·distinct ticket·검사별 {fired, fail}·warnOnly 비율. **해소 관측** =
  subjects 있는 (check, subject) 쌍 중 "마지막 발화 이후의 실행이 존재하고 그 실행에서 같은 쌍이
  비발화"인 것(전 기간 누적이 아니라 최신 상태 기준 — 낙관 추정 금지: subjects 없는 검사는 해소
  축에서 제외하고 그 사실을 표기).
- **review**: (ticket, kind, phase) 그룹의 행 수 분포 — 이름은 **"대상당 총 호출"**(시리즈 아님).
  outcome 비율·`delta_mode` 비율(design 한정)·`full_review_reason` 분포·`prompt_bytes`·
  `review_duration_ms`의 p50/p95(정확 분위 — 정렬 후 인덱스).
- **evidence**: bin이 config trunkBranch로 merge-base..HEAD를 verify-range 코어에 넣어 counts·
  미입증 수(목록은 8건 상한 + "외 N건")를 요약. trunk 없음·git 실패 → 섹션 부재 표기.
  doctor 최신 행의 D25/D30 subjects를 그대로 나열(재실행 없음 — 관측 시점 명시).
- **ci**: verify-runs `ci` 필드 분포 4종.

### DEC-3 · verb 배선

`bin/report.ts` + `dispatch.mjs`에 `report` + `bin/init.ts` HELP_TEXT 1줄. `check.ts`의 구조
(HelpRequested·parseArgs fail-closed·renderHuman/renderJson 동일 파생)를 그대로 따른다.
게이트·로그 append 없음 — **완전 조회**(R1·제약).

### DEC-4 · 하지 않는 것

- 시계열 차트·기간 필터·원격 집계(후속 — 우선 전량 요약).
- "적용 가능 티켓 수"(미기록 — 출력에 그 사실 명시), 소비자 3곳 교차 집계(단일 repo 대상).
- 로그 스키마 변경.

## Phase별 구현

**Phase 1 (`phase-1-report-lib`)** — `lib/report.ts` 순수 집계(3로그 파서·산식·problems) +
`tests/unit/report-lib.test.ts`(fixture 로그 → 섹션 값·부재·손상).

**Phase 2 (`phase-2-report-verb`)** — `bin/report.ts`(수집: 로그 읽기 + verify-range 산출·렌더 2종)
+ dispatch/help + `docs/workflow.md`/`.en` 한 절 + CHANGELOG + 완료 기준 2·3·5 테스트.

## 변경 파일

| 파일 | 변경 | phase |
|---|---|---|
| `scripts/req/lib/report.ts` | 신규 — 순수 집계 | 1 |
| `tests/unit/report-lib.test.ts` | 신규 | 1 |
| `bin/report.ts` | 신규 — verb | 2 |
| `bin/dispatch.mjs` · `bin/init.ts` | verb·help 각 1행 | 2 |
| `tests/unit/report-verb.test.ts` | 신규 — 부재 repo·json 파생·인자 | 2 |
| `docs/workflow.md`/`.en` | report 절 | 2 |
| `CHANGELOG.md` | Unreleased | 2 |

## 테스트 oracle (완료 기준 ↔ 검증)

| 완료 기준 | 오라클 | 잡는 결함 |
|---|---|---|
| 1 | fixture 3로그 → 각 섹션 기대값(발화·해소·분위수·분포 손계산 대조) | 산식 회귀 |
| 2 | 빈 dir 수집 → 전 섹션 부재 + exit 0 | 부재를 0으로 단언 |
| 3 | 같은 Report에서 renderHuman/renderJson 파생(값 대조) | 이중 산식 |
| 4 | 손상 행 fixture → skipped 카운트 + 나머지 집계 유효 | 전체 실패·침묵 무시 |
| 5 | 기존 help↔dispatch 가드 | 표면 누락 |
| DEC-2 | subjects 없는 검사가 해소 축에서 제외 표기 | 낙관 추정 |

## 하위호환·안전

- 순수 추가(신규 verb·lib). 기존 게이트·로그·스키마 무변경. 쓰기 0.
- 출력은 로그가 이미 담은 저위험 데이터(id·개수·해시·SHA)만 재구성 — 새 노출면 없음.
