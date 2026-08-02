# REQ-2026-114 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

| 사실 | 위치 | 확인 |
|---|---|---|
| D25가 trunk 트리 경로를 **`ls-tree` 1회**로 이미 읽는다 | `req-doctor.ts:1290~1305` | 읽음 |
| D25의 판정 입력은 **워킹트리의 close proof** | `unmergedClosedTickets`의 `closedTicketIds` | 읽음 |
| trunk ref 없음·비활성은 조용히 통과 | 같은 블록의 `cfg.trunkBranch !== null` 가드 | 읽음 |
| 리뷰 호출 로그 경로 상수 | `review-codex.ts` `REVIEW_CALL_LOG_REL` | 읽음 |
| 로그 행에 `ticket_id`가 있다 | `ReviewCallLogRow` | 읽음 |
| 보장 문서에 "증거는 `responses/`에 남는다"는 있으나 **어디까지 남는지**는 없다 | `docs/guarantees.md:18` | 읽음 |
| `보장하지 않는 것` 절이 이미 존재한다 | 같은 문서 `:27~34` | 읽음 |
| D-체크 등록부 23개(D29까지) | `req-doctor.ts` `D_CHECK_IDS` | 실측 |

**유실 실측**(소비자 3곳·2,089호출): 65건(3.1%) 유실, 유실분의 66.2%가 needs-fix.
유실 상위 티켓 `REQ-2026-025`·`009`·`062`는 **close proof가 어느 브랜치에도 없다** — 버려진 티켓이다.

## 핵심 설계 결정

### DEC-1 · 신호는 **리뷰 호출 로그**다 (close proof가 아니다)

D25를 확장하려 했으나 **원리적으로 불가능**하다. D25 계열은 close proof를 찾는데,
버려진 티켓에는 **찾을 close proof가 없다**(위 실측).

리뷰 호출 로그(`workflow/.review-calls.jsonl`)를 쓴다:

- **gitignored·워킹디렉터리 상주** — 브랜치와 함께 사라지지 않는다. 그래서 유실을 볼 수 있다.
- **리뷰를 받았다**는 사실이 남아 있다. 유료 호출을 쓴 티켓만 대상이 되므로 노이즈가 낮다.
- 이 조사에서 유실 65건을 측정한 방법이 정확히 이것이다.

### DEC-2 · 새 검사 **D30** — WARN 전용

| 항목 | 값 |
|---|---|
| id | `D30`(등록부 추가 → 타입이 등재를 강제) |
| level | **WARN 전용** |
| 판정 | 리뷰 이력이 있는데 trunk 트리에 `<ticketRoot>/<id>/responses/` 경로가 하나도 없는 티켓 |
| 자기 티켓 | **제외**(D25 선례 — 작업 중 티켓이 매번 걸리면 안내가 죽는다) |
| 판정 불가 | trunk ref 없음·로그 없음·파싱 실패 → **OK(조용히 통과)** |

🔴 **FAIL이 아닌 이유**: 진행 중 티켓이 **정상적으로** 포함된다. FAIL이면 평범한 작업이 막힌다.
🔴 **조용히 통과하는 이유**: D25가 같은 규칙을 쓰는 근거 그대로 — 오탐이 잦으면 사람이
doctor 출력 전체를 무시하고, 그러면 진짜 FAIL까지 죽는다.
실측으로 `origin/main`이 없는 소비자(MBTI)가 실재한다.

### DEC-3 · **리뷰 횟수를 함께 표시한다** (노이즈를 신호로 바꾼다)

진행 중 티켓과 방치된 티켓을 임의 기간(age threshold)으로 가르지 않는다 — 근거 없는 임계를
넣지 않는다는 이 저장소의 원칙에 어긋난다.

대신 **횟수**를 보인다. 실측 노이즈 크기:

| 프로젝트 | 리뷰받은 티켓 | trunk에 증거 없음 |
|---|---:|---:|
| yammy | 141 | 7 (알려진 유실 2 + 최근 5) |
| lean | 126 | 5 (알려진 유실 1 + 최근 4) |

`REQ-2026-025(리뷰 8회)`와 `REQ-2026-140(리뷰 1회)`는 읽는 즉시 구별된다.
**판단은 사람이 한다** — 도구는 "유실됐다"고 단정하지 않는다(요구 제약 3).

### DEC-4 · `runChecks`는 순수하게 유지한다

파일·git 읽기는 `main()`이 하고 결과만 `DoctorInputs`로 넘긴다(D19·D20·D25와 같은 형태).

```ts
strandedEvidence?: { id: string; reviews: number }[]
```

`undefined` = 판정 불가 → OK. **D25가 이미 읽는 `trunkPaths`를 재사용**한다 —
`ls-tree`를 두 번 돌리지 않는다(D25 주석이 "티켓마다 git log를 돌리면 80회"라고 경계한 그 지점).

순수 판정은 별도 export 함수로 둔다:

```ts
export function strandedReviewedTickets(
  reviewCounts: ReadonlyMap<string, number>,
  trunkPaths: ReadonlySet<string>,
  ticketRoot: string,
  selfTicketId: string,
): { id: string; reviews: number }[]
```

### DEC-5 · 보장 문서는 **`보장하지 않는 것`** 절에 넣는다

`docs/guarantees.md`(한)와 `docs/guarantees.en.md`(영) 양쪽.
그 절이 이미 "커밋 이후를 보장하지 않습니다" 같은 경계를 모아 두고 있다.

내용: 증거는 **브랜치-지역적**이다. 병합되지 않은 티켓의 증거는 메인라인에 없다.
실측(3.1% 유실·실패 편향)을 함께 적어 추상적 경고로 읽히지 않게 한다.

🔴 **정정문에 폐기 문구를 축자 인용하지 않는다.** `docs/**`는 폐기 문구 가드의 검사 대상이다.

### DEC-6 · 단일 phase

6파일이고, 검사만 넣고 문서를 안 고치면 "왜 WARN이 뜨는지" 설명이 없고,
문서만 고치면 그 사실이 발생 시점에 드러나지 않는다.

## Phase별 구현

**Phase 1 (`phase-1-stranded-evidence`)** — D30 + 보장 문서(한/영) + 정본 표 + 테스트.

## 변경 파일

| 파일 | 변경 |
|---|---|
| `scripts/req/req-doctor.ts` | `D30` 등록 · `DoctorInputs.strandedEvidence` · 순수 `strandedReviewedTickets` · 검사 · `main()`이 로그 읽어 주입(D25의 `trunkPaths` 재사용) |
| `docs/guarantees.md` | `보장하지 않는 것`에 브랜치-지역성 |
| `docs/guarantees.en.md` | 동일(영문) |
| `docs/ssot-design/07-business-rules-and-state-machines.md` | §3 정본 표에 D30 행 |
| `tests/unit/doctor-stranded-evidence.test.ts` (신규) | AC-1~AC-4 |
| `CHANGELOG.md` | Unreleased |

## 테스트 oracle (AC ↔ 검증)

| AC | 검증 | 잡는 결함 |
|---|---|---|
| AC-1 | 순수 함수: 리뷰 이력 있고 trunk에 없는 티켓만, 횟수 포함 | 판정 오류·횟수 누락 |
| AC-2 | 같은 함수에 자기 티켓을 넣어도 결과에 없음 | 자기 티켓 제외 누락 |
| AC-3 | `strandedEvidence === undefined` → D30이 OK | 판정 불가를 WARN으로 오인 |
| AC-4 | 🔴 **hermetic repo에서 `main()` 실행** — 로그를 만들어 두고 D30 WARN 확인 | **배선 끊김** |
| AC-5 | 보장 문서 한/영 문구 확인 | 정정 누락·한쪽만 갱신 |
| AC-6 | 폐기 문구 가드 재실행 | 정정문이 옛 문구를 인용 |
| — | 기존 `[REQ-2026-099]` 정본 표 테스트 | D30을 표에 안 적음 → 실패 |
| — | 기존 죽은-항목 탐지 테스트 | D30이 어떤 변형에서도 push 안 함 → 실패 |

🔴 **AC-4는 실제 진입점을 돌린다.** 이 저장소는 "빌더 직접호출 가드는 배선끊김을 못 잡는다"를
세 번 실증했다(REQ-2026-083·097·099). D30은 `main()`이 **로그 파일을 읽어** 입력을 만드는
구조라 배선 위험이 실재한다 — 순수 함수만 테스트하면 그 끊김을 못 본다.

## 하위호환·안전

- **동작 무변경**: 새 WARN 하나만 추가된다. 기존 검사·판정·exit code 불변.
- **차단하지 않는다**: WARN 전용이라 기존 소비자의 커밋이 막히지 않는다.
- **판정 불가에 관대하다**: trunk ref가 없는 저장소(실측 존재)·로그가 없는 신규 설치는 조용히 통과.
- **성능**: `ls-tree`를 **재사용**하므로 git 호출이 늘지 않는다. 로그 파일 1회 읽기만 추가된다.
- **개인정보**: 로그에서 읽는 것은 `ticket_id`뿐이다.
- **문서 정정은 사실 추가**다 — 기존 보장을 축소하는 것이 아니라, 원래 없던 경계를 명시한다.
