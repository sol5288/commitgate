# REQ-2026-085 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

부기 표식(DEC-6)은 적용 자리가 11곳이라 **고빈도(phase-2) / 저빈도(phase-3)** 로 나눈다.
경계는 임의 분할이 아니라 "매 리뷰·매 phase 발생" vs "예외적 사건"이라는 실제 성격 차이다.

## Phase 1 — 죽은 `state.phase` 제거 (`phase-1-dead-state-phase`)

범위(6파일):
- `scripts/req/req-new.ts` — 스캐폴드에서 `phase: 'INTAKE'` 방출 중단 (DEC-5.1)
- `scripts/req/review-codex.ts` — `loadState` 필수 검사에서 `phase` 제외 (DEC-5.2) · Review Context를 `current_phase` 기반으로 (DEC-5.3)
- `scripts/req/req-doctor.ts` — `String(s.phase)` 및 D11의 `phase !== 'DONE' &&` 삭제 (DEC-5.4·5b)
- `tests/unit/req-doctor.test.ts` · `tests/unit/req-new.test.ts` · `tests/unit/req-review-codex.test.ts`

회귀 가드: ①신규 스캐폴드에 `phase` 키 없음 ②`phase` 없는 state 로드 성공 ③`phase` 있는 옛 state도 로드 성공
④Review Context에 `INTAKE`가 없고 진행 중 phase가 들어감 ⑤🔴 `phase:"DONE"` 위조 + `main` 브랜치 → **D11 FAIL**
(기존 테스트의 정답이 뒤집힌다 — DEC-5b).

Exit: typecheck0 · 전체 스위트 그린 · Codex phase 리뷰 승인.

## Phase 2 — 부기 표식 헬퍼 + 고빈도 경로 (`phase-2-bookkeeping-marker-core`)

범위(6파일):
- `scripts/req/lib/bookkeeping.ts` **신설** — `BOOKKEEPING_TRAILER`·`BOOKKEEPING_LOG_FILTER`·`bookkeepingMessage()`
- `scripts/req/review-codex.ts` — attempt-opened(pre-call) · attempt-closed(보상) · series-terminal close proof
- `scripts/req/lib/state-checkpoint.ts` — state checkpoint
- `scripts/req/lib/evidence.ts` — design-finalize
- `scripts/req/req-commit.ts` — evidence-finalize
- `tests/unit/bookkeeping.test.ts` **신설**

회귀 가드: ①헬퍼 출력 형태(subject + 빈 줄 + trailer) ②state checkpoint 실 커밋 메시지에 trailer 실림
③🔴 **커밋 경로(pathspec)·커밋 개수 불변** — 표식이 커밋 범위를 넓히지 않았음을 실 git으로 확인.

Exit: typecheck0 · 전체 스위트 그린 · Codex phase 리뷰 승인.

## Phase 3 — 부기 표식 저빈도 경로 (`phase-3-bookkeeping-marker-lifecycle`)

범위(7파일):
- `scripts/req/req-new.ts` · `req-close.ts` · `req-rebind.ts`(2곳) · `req-reconstruct.ts` · `req-review-exception.ts`
- `bin/delivery.ts`(2곳)
- `tests/unit/bookkeeping.test.ts`

회귀 가드: 🔴 **소스 전수 스캔** — 도구가 만드는 `commit -m` 자리 전부가 `bookkeepingMessage()`를 통과하는지
정적으로 확인한다(한 곳이라도 빠지면 읽기 명령이 그 커밋을 코드 커밋으로 잘못 보여준다).
사용자 메시지를 담는 자리(`req:commit -m`)는 **의도적 제외**임을 같은 테스트가 명시한다.

Exit: typecheck0 · 전체 스위트 그린 · Codex phase 리뷰 승인.

## Phase 4 — 미병합 누적 경고 D25 (`phase-4-unmerged-warning`)

범위(4파일):
- `scripts/req/lib/config.ts` — `trunkBranch` 기본값(`"main"`)·스키마(`string|null`)
- `scripts/req/req-doctor.ts` — D25 순수 판정 + `main()`의 입력 계산(`ls-tree` 1회)
- `tests/unit/req-doctor.test.ts` · `tests/unit/config.test.ts`

회귀 가드: ①미병합 2건 → WARN + 목록에 두 REQ id ②대상 티켓은 세지 않음(DEC-3) ③전부 병합 → OK
④trunk ref 없음 → OK '점검 불요'(DEC-2) ⑤`trunkBranch: null` → 비활성 ⑥🔴 어떤 입력에서도 **FAIL이 아님**(DEC-4).

Exit: typecheck0 · 전체 스위트 그린 · Codex phase 리뷰 승인.

## Phase 5 — 문서·CHANGELOG (`phase-5-docs-changelog`)

범위(3파일):
- `docs/workflow.md` · `docs/workflow.en.md` — 부기 표식과 읽기 명령, "이 변경 이후 커밋에만 완전" 단서
- `CHANGELOG.md` — Unreleased + **확인할 파일 표**(phase-1~4의 실제 커밋 SHA·경로). diff-scoped 리뷰는 앞 phase의 diff를 볼 수 없다(REQ-2026-082·083·084 교훈).

Exit: typecheck0 · 전체 스위트 그린 · `docs:lint` 그린 · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(unit·typecheck·docs:lint) · 사용자 main 머지(별도 승인).
