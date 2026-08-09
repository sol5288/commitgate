# REQ-2026-118 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

| 사실 | 위치 | 확인 |
|---|---|---|
| 델타 게이트 = `hasDesignBaseline` — baseline 있으면 무조건 델타 모드 | `review-codex.ts:2566` 부근 | 읽음 |
| baseline은 승인 시점 문서별 blob OID(`design_baseline`) | `captureDesignDocBlobs`·`processResponse` | 읽음 |
| `computeDesignDelta`가 키별 OID 비교로 changed/unchanged 산출(순수) | `review-codex.ts` | 읽음 |
| 이탈은 리뷰어 재량(`full_review_requested`)뿐 — 실측 누적 0건 | `.review-calls.jsonl` 3곳 | 실측 |
| 리뷰 호출 로그 행은 선택 키 확장 선례 보유(`delta_mode` 등 — REQ-2026-113) | `review-codex.ts:689` 부근 | 읽음 |
| 02-plan 관례: phase 헤딩에 백틱 id — `## Phase n — 제목 (\`phase-…\`)` | `req-new.ts` 스캐폴드·실제 티켓들 | 읽음 |

## 핵심 설계 결정

### DEC-1 · 결정적 조건은 순수 함수 하나로, 새 lib 파일에 둔다

`scripts/req/lib/full-review.ts` 신설(리뷰 커널 3,000행에 더 얹지 않는다 — 관심사 분리):

```
export type FullReviewReason = 'no-baseline' | 'invalid-baseline' | 'all-docs-changed' | 'phase-structure-changed'

autoFullReviewReason(input: {
  baselineState: 'valid' | 'absent' | 'invalid'   // hasDesignBaseline 판정의 3분해
  delta: { changed: DesignDocKey[]; unchanged: DesignDocKey[] } | null  // valid일 때만 non-null
  baselinePlanBody: string | null                  // baseline plan blob 본문(읽기 실패 = null)
  currentPlanBody: string
}) → FullReviewReason | null                       // null = 델타 유지
```

판정 순서(첫 일치): `absent → no-baseline` · `invalid → invalid-baseline` ·
`changed가 전체 키 → all-docs-changed` · `planPhaseIds(baseline) ≠ planPhaseIds(current) →
phase-structure-changed` · 그 외 null.

- `planPhaseIds(body)`: `## `로 시작하는 헤딩 줄에서 백틱 `phase-…` 토큰을 추출한 **집합**(순서 무관).
  baseline plan을 읽지 못하면(`baselinePlanBody: null`) 구조 비교는 **건너뛴다**(모르는 것으로
  full을 강제하지 않는다 — 이 조건은 보수적 편의가 아니라 결정적 판정이어야 한다).
- `no-baseline`·`invalid-baseline`은 **동작을 바꾸지 않는다** — 지금도 full로 돈다. 이 REQ가 더하는
  것은 그 사실의 **기록**뿐이다. 동작이 바뀌는 것은 `all-docs-changed`·`phase-structure-changed`
  두 조건이고, 방향은 항상 델타→full(더 넓은 리뷰)이다.

### DEC-2 · 배선 — delta 계산 직후 한 지점, full 강제는 `designDelta = undefined`

`review-codex.ts`의 design 분기(delta 계산 직후)에서:

1. `baselineState` 3분해: `design_baseline` 키 부재 → absent · 있는데 `hasValidDesignBaseline`
   false → invalid · 그 외 valid.
2. baseline plan 본문: `git cat-file blob <baseline.plan OID>` (실패 → null — 진행은 계속).
3. `autoFullReviewReason(...)` 판정. `all-docs-changed`/`phase-structure-changed`면
   **`designDelta`를 설정하지 않는다** — 이 한 변수로 프롬프트 태그·본문 생략·delta persona가
   전부 결정되므로(기존 단일 배선), full 강제도 같은 지점 하나로 끝난다.
4. reason이 non-null이면 stdout 한 줄: `ℹ️ 전체 설계 리뷰로 전환: <reason>` (R4).

### DEC-3 · 로그 — `full_review_reason` 선택 키(REQ-2026-113 선례 그대로)

리뷰 호출 로그 행에 `full_review_reason?: FullReviewReason` 추가. design 리뷰이고 reason이
non-null일 때만 키가 실린다(델타 모드·phase 리뷰는 키 부재). 기존 행 하위호환 — 선택 키 선례
(`delta_mode`·`full_review_requested`)와 같은 규칙.

### DEC-4 · 하지 않는 것

- `full_review_requested` 재량 경로·응답 스키마·persona 무변경(R3). 재량 경로 제거는
  reason 데이터가 쌓인 뒤 별도 결정.
- baseline 초기화 없음 — 자동 full은 **이번 호출**의 프롬프트 모드만 바꾼다. 승인되면
  기존 경로대로 새 baseline이 잡힌다(리뷰어 escalation의 "baseline 비우기"와 다르다 —
  그쪽은 다음 리뷰를 full로 만드는 상태 변경이고, 이쪽은 상태 무변경).
- 스키마·인터페이스 경로 축(00-requirement 제약 참조).

## Phase별 구현

**Phase 1 (`phase-1-reason-core`)** — `scripts/req/lib/full-review.ts` 신설:
`planPhaseIds`·`autoFullReviewReason` + 단위 테스트(4조건·null 유지·plan 읽기 실패 시 건너뜀).

**Phase 2 (`phase-2-wiring-log`)** — review-codex 배선(3분해·cat-file·designDelta 억제·stdout)·
로그 선택 키·통합 테스트·CHANGELOG.

## 변경 파일

| 파일 | 변경 | phase |
|---|---|---|
| `scripts/req/lib/full-review.ts` | 신규 — 순수 판정 | 1 |
| `tests/unit/full-review.test.ts` | 신규 | 1 |
| `scripts/req/review-codex.ts` | design 분기 배선 + 로그 키 | 2 |
| `tests/unit/…`(기존 리뷰 로그 테스트 파일) | reason 키 검증 추가 | 2 |
| `CHANGELOG.md` | Unreleased | 2 |

## 테스트 oracle (완료 기준 ↔ 검증)

| 완료 기준 | 오라클 | 잡는 결함 |
|---|---|---|
| 1 | delta.changed = 전체 키 → `all-docs-changed` + designDelta 미설정(프롬프트에 델타 태그·생략 표식 부재) | 전면 개정을 델타로 부분 심사 |
| 2 | plan phase id 집합 상이(추가·삭제·개명 각 1) → `phase-structure-changed` | 구조 변경의 부분 심사 |
| 3 | 일부 변경 + 집합 동일 → null + 델타 모드 유지(태그 존재) | 과잉 full 전환(비용 회귀) |
| 4 | baselineState absent → `no-baseline` 기록·동작 무변경 | 기록 누락 |
| 5 | reason 없는 기존 행 파싱 유효 | 하위호환 파손 |
| 6 | stdout에 사유 줄 | 조용한 모드 전환 |
| 7 | full_review_requested=yes 응답 처리 경로 기존 테스트 그린 유지 | 재량 경로 회귀 |
| DEC-1 | baselinePlanBody null → 구조 비교 건너뜀(null 반환 가능) | 모르는 것으로 강제 전환 |

## 하위호환·안전

- 판정·게이트·스키마 무변경. 바뀌는 것은 (a) 두 결정적 조건에서 프롬프트가 델타 대신 full로
  조립된다 (b) 로그에 선택 키 하나가 늘어난다.
- 자동 full 전환은 리뷰 토큰 비용을 늘릴 수 있으나 조건이 드물고(전면 개정·구조 변경),
  그 상황에서 델타 리뷰는 승인된 영역 뒤에 숨은 변경을 놓칠 위험이 비용보다 크다.
- 단일 활성 worktree·협조적 작업자 경계 유지 — 절대 보장 표현 없음.
