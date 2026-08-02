# REQ-2026-114 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

> **테스트 실행 계층(REQ-2026-100)**: 게이트는 테스트를 **실행하지 않는다**. 아래는 비용을 줄이기 위한 실행 시점 권고다.
> - **phase 진행 중**: 변경한 소스를 import하는 테스트만(빠른 피드백). 예: `grep -rl "<변경한 모듈>" tests/`
> - **통합(main 병합) 직전 1회**: **전체 스위트**. 범위 한정은 이것을 **대체하지 않는다** — 영향 분석은 놓친 회귀를 통과시킨다.

> ℹ️ **stage 범위 표기**: 아래 "범위"는 **코드·문서 변경분**이다. REQ 설계 문서(`00`/`01`/`02`·
> `codex-request.md`)는 이 저장소 관례상 **첫 phase 커밋에 동반**되므로 staged tree에 함께 나타난다.

## Phase 1 — 미병합 리뷰 증거 진단과 경계 명시 (`phase-1-stranded-evidence`)

**책임 계약**: 리뷰를 받았는데 그 증거가 trunk에 없는 티켓을 **리뷰 횟수와 함께** WARN하고,
증거가 브랜치-지역적이라는 사실을 보장 문서에 명시한다. **파일을 고치거나 병합하지 않는다.**

**입력**: `workflow/.review-calls.jsonl`의 `ticket_id`, D25가 이미 읽는 trunk 트리 경로 집합.
**산출물**: D30 + 보장 문서(한/영) 경계 서술.
**선행 phase**: 없음(단일 phase).

**범위 (6파일)**

| 파일 | 변경 |
|---|---|
| `scripts/req/req-doctor.ts` | `D_CHECK_IDS`에 `D30` · `DoctorInputs.strandedEvidence` · 순수 `strandedReviewedTickets` · 검사 · `main()` 배선(**D25의 `trunkPaths` 재사용**) |
| `docs/guarantees.md` | `보장하지 않는 것`에 브랜치-지역성 + 실측 |
| `docs/guarantees.en.md` | 동일(영문) |
| `docs/ssot-design/07-business-rules-and-state-machines.md` | §3 정본 표에 D30 행 |
| `tests/unit/doctor-stranded-evidence.test.ts` (신규) | AC-1~AC-4 |
| `CHANGELOG.md` | Unreleased |

**stage 범위**: 위 6개 + REQ 설계 문서. `state.json`·`responses/`는 **스테이징하지 않는다**.

**공개 seam과 실패해야 할 동작**

| # | seam | 실패해야 하는 구현 |
|---|---|---|
| AC-1 | `strandedReviewedTickets(...)` 반환 | trunk에 있는 티켓을 포함 · 리뷰 횟수 누락·오산 → 실패 |
| AC-2 | 같은 함수에 자기 티켓 포함 입력 | 자기 티켓을 결과에 넣음 → 실패 |
| AC-3 | `runChecks({... strandedEvidence: undefined })` | 판정 불가를 WARN으로 냄 → 실패 |
| AC-4 | 🔴 hermetic repo에서 `main()` 실행 후 D30 줄 | **배선 끊김**(검사만 있고 `main()`이 로그를 안 읽음) → 실패 |
| AC-5 | `guarantees.md`·`guarantees.en.md` 문구 | 한쪽만 고침 → 실패 |
| AC-6 | 폐기 문구 가드 | 정정문이 옛 문구를 축자 인용 → 실패 |
| — | 기존 `[REQ-2026-099]` 정본 표 ↔ 등록부 | D30을 표에 안 적음 → 실패 |
| — | 기존 죽은-항목 탐지 | D30이 어떤 입력 변형에서도 push 안 함 → 실패 |

> 🔴 **AC-4를 반드시 둔다.** D30은 `main()`이 **로그 파일을 읽어** 입력을 만든다 — 순수 함수만
> 테스트하면 그 배선이 끊겨도 통과한다. 이 저장소가 세 번 실증한 실패 유형이다
> (REQ-2026-083·097·099). `doctor-terminal-wiring.test.ts`의 `mkRepo` 패턴을 쓴다.

**검증 명령** (`req.config.json`의 `packageManager: npm`)

```
npx tsc --noEmit
npx vitest run tests/unit/doctor-stranded-evidence.test.ts tests/unit/req-doctor.test.ts tests/unit/docs-stale-claims.test.ts tests/unit/doctor-terminal-wiring.test.ts
```

역의존 근거: `req-doctor`를 import하는 테스트가 대상이다(`grep -rln "req-doctor" tests/`).
`docs-stale-claims.test.ts`는 정본 표 대조(AC 추가분)와 문서 가드(AC-6)를 모두 담당한다.

**비목표**: 증거 수확 · 유실분 소급 복구 · D25 변경 · 브랜치 전략 변경 ·
방치 판정용 기간 임계(근거 없는 임의 임계를 넣지 않는다).

**Exit**: typecheck 0 · 위 검증 그린 · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(typecheck·해당 시 lint) · **통합 직전 전체 스위트 1회** · 사용자 main 머지(별도 승인).
