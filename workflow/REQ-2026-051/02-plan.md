# REQ-2026-051 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

## Phase 1 — 원장 코어 (`phase-1-ledger-core`)

| 항목 | 내용 |
|---|---|
| 책임 계약 | 원장 행의 스키마·직렬화·파싱·검증·멱등 append를 **순수 함수**로 확정(D2·D3·D4·D5) |
| 입력 | `lib/evidence`의 직렬화·검증 관례(고정 키 순서 · 허용키 화이트리스트) |
| 산출물 | `scripts/req/lib/review-ledger.ts` · `tests/unit/review-ledger.test.ts` |
| 선행 phase | 없음 |
| 독립 검증 | `npx vitest run tests/unit/review-ledger.test.ts` · `npm run typecheck` |

**범위**: 부작용 0. fs·git을 import하지 않는다. 어떤 호출부도 아직 쓰지 않으므로 단독 커밋해도 런타임 동작이 변하지 않는다.

**Red 먼저**

| # | oracle |
|---|---|
| ① | `serializeLedgerRow`가 고정 키 순서로 직렬화하고 끝에 개행 하나를 붙인다 |
| ② | round-trip: serialize → parse가 동일 객체를 낸다 |
| ③ | 같은 자연키 `(ticket,series,attempt,event)` + 동일 내용 재기록 → 행 수 불변(멱등) |
| ④ | 같은 자연키 + **다른 내용** → append 안 함 + 충돌을 problems로 보고(fail-closed) |
| ⑤ | 파싱 불가 행 → 손상으로 보고(조용히 건너뛰지 않음) |
| ⑥ | 모르는 top-level 키 → 거부 |
| ⑦ | 모르는 `lifecycle` 값 → **거부하지 않음**(forward-compatible, D3) |
| ⑧ | `attempt-opened`는 `outcome`·`archive_*`가 null이어야 하고, 값이 있으면 거부 |
| ⑨ | `attempt-opened`만 있고 `attempt-closed`가 없는 attempt를 `unclosedAttempts()`가 찾아낸다 |
| ⑩ | 프롬프트/응답 **본문**이 행에 들어갈 자리가 없다(허용키에 없음 → ⑥으로 거부) |
| ⑪ | `at`이 ISO instant가 아니면 거부(`isValidIsoInstant` 재사용) |

**Exit**: typecheck 0 · 단위 그린 · Codex phase 리뷰 승인.

**독립성 근거**: 순수 모듈이고 호출부가 없다. phase-2/3 없이도 "스키마가 확정됐다"는 인수 기준이 자체 검증된다.

## Phase 2 — review-codex 배선 · design 승인 내구화 (`phase-2-review-codex-wiring`)

| 항목 | 내용 |
|---|---|
| 책임 계약 | attempt 확정 직후 `attempt-opened`, 판정 완료 시 `attempt-closed`가 남고, design 승인 커밋에 원장이 실린다(D2·D6·D7) |
| 입력 | phase-1 모듈 |
| 산출물 | `review-codex.ts` 배선 · `evidence.ts` `designEvidenceStagePaths` 확장 · 테스트 |
| 선행 phase | phase-1 |
| 독립 검증 | `npx vitest run tests/unit/req-review-codex.test.ts tests/unit/evidence-module.test.ts` · `npm run typecheck` |

**Red 먼저**

| # | oracle |
|---|---|
| ⑫ | attempt 확정 직후(호출 **전**) `attempt-opened`가 기록된다 |
| ⑬ | 호출이 throw하면 `attempt-closed`가 **없다** — 원장에서 미완 attempt로 식별된다(요구사항 #1 재현) |
| ⑭ | 정상 완료 시 `attempt-closed`에 outcome·archive_path·archive_sha256이 채워진다 |
| ⑮ | 원장 append가 throw해도 **판정·exit code가 바뀌지 않는다**(D6) |
| ⑯ | `designEvidenceStagePaths`가 원장 경로를 포함한다 — 단 원장 파일이 없으면 포함하지 않는다 |
| ⑰ | 예산 초과로 사람 예외를 소비한 attempt는 `exception_consumed: true`로 남는다 |

**Exit**: typecheck 0 · 단위 그린 · Codex phase 리뷰 승인.

## Phase 3 — evidence-finalize 내구화 · ignore 가드 (`phase-3-evidence-finalize-and-ignore-guard`)

| 항목 | 내용 |
|---|---|
| 책임 계약 | phase 승인의 evidence-finalize 커밋에 원장이 실리고, 원장이 git에 무시되지 않음이 회귀로 잠긴다(D7·D8) |
| 입력 | phase-1 모듈 (phase-2와 **독립** — 서로 다른 커밋 경로다) |
| 산출물 | `req-commit.ts` pathspec 확장 · gitignore 회귀 가드 · 재실행 멱등 테스트 · 보장 문서 |
| 선행 phase | phase-1 |
| 독립 검증 | `npx vitest run tests/unit/req-commit.test.ts` · `npm run typecheck` |

**Red 먼저**

| # | oracle |
|---|---|
| ⑱ | evidence-finalize의 pathspec에 원장이 포함된다(부재면 미포함) |
| ⑲ | 실제 `git check-ignore`로 원장 경로가 **무시되지 않음**을 확인(D8 — REQ-025/047 동종 재발 방지) |
| ⑳ | evidence-finalize 재실행(복구 모드) 시 원장 행이 중복되지 않는다 |
| ㉑ | 원장 append 실패가 evidence-finalize의 성공/실패 판정을 바꾸지 않는다 |

**Exit**: typecheck 0 · 단위 그린 · Codex phase 리뷰 승인.

**숨은 결합 점검**: phase-2와 phase-3은 각각 design 승인 경로와 phase 승인 경로를 담당하며 서로를 요구하지 않는다. 둘 다 phase-1만 선행한다. phase-1은 순수 모듈이라 어느 쪽도 요구하지 않는다.

## 검증 fixture 정책

`44_yammy_sales`는 **읽기 전용 분석 대상**이다. 어떤 파일도 생성·수정·stage·commit·설치하지 않는다. git 동작 검증이 필요하면 `git init`한 임시 저장소를 쓰고 실행 후 삭제한다.

## 완료
- 게이트 해당분(unit·typecheck·lint) · 사용자 main 머지(별도 승인).
