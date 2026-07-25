# REQ-2026-057 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

## Phase 1 — checkpoint 헬퍼 + design 경로 (`phase-1-checkpoint-design-path`)

범위(설계 DEC-1·DEC-3·DEC-4·DEC-5): 새 leaf `scripts/req/lib/state-checkpoint.ts`의 `commitStateCheckpoint`
(멱등 · 디스크↔인메모리 바이트 대조 · `state.id` 대조 · `<ticketRel>/state.json` 단일 pathspec 커밋)와
`review-codex.ts` design 승인 경로 배선. 변경 파일 3개.

Test-First 순서:
1. `tests/unit/state-checkpoint.test.ts`(Red): 변경 없으면 무커밋(멱등) · 디스크 내용이 인메모리와 다르면
   throw · `state.id`가 티켓 디렉터리와 불일치하면 throw · **staged 코드가 있어도 그 커밋에 섞이지 않음**
   (pathspec 격리) · 커밋 후 `git status`에서 해당 경로가 사라짐
2. 헬퍼 구현(Green)
3. design 경로 배선 — durable design evidence 커밋 **직후**
4. 전체 스위트

Exit: typecheck 0 · `npm test` green · Codex phase 리뷰 승인.

## Phase 2 — phase 경로 + 완주 회귀 (`phase-2-checkpoint-phase-path`)

범위(설계 DEC-2·DEC-5): `req-commit.ts`의 `finalizeEvidenceAndConsume`에서 `writeState(consumeState(...))`
**직후** 배선. 순서는 바꾸지 않는다(복구 마커 규약 보존). 변경 파일 2개.

Test-First 순서:
1. 회귀 테스트(Red) — **완료 기준 1·2를 직접 검증**:
   ① 티켓 완주 직후 `git status`가 clean(`state.json` 포함 잔여 변경 0)
   ② 그 상태에서 `req:new`의 clean-tree 검사가 통과
   ③ 복구 경로 무회귀: `--finalize` 재실행이 여전히 동작하고 checkpoint는 멱등
2. 배선 구현(Green)
3. 전체 스위트

Exit: typecheck 0 · `npm test` green · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(unit·typecheck) · 사용자 main 통합(별도 승인 — `I1` 또는 `B1`).
- 후속: 안내·진단 계층 7건(F-3·F-5·F-6·F-4·F-7~F-9)은 **별도 REQ**.
