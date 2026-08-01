# REQ-2026-099 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

## Phase 1 — D-체크 정본 표 정합 + 재발 가드 (`phase-1-dcheck-table-alignment`)

범위(코드 1파일 · 문서 4파일 · 테스트 1파일):

- `scripts/req/req-doctor.ts` — `D_CHECK_IDS` 권위 등록부 + `CheckId` 타입, `Check.id`를 `CheckId`로 좁힘(DEC-3a). 런타임 동작 변경 0.
- `docs/ssot-design/07-business-rules-and-state-machines.md` — §3 표에 D20~D27 8행 추가, 서두의 "13개뿐이다" 완결 주장 정정. 결번 문장은 유지(DEC-1).
- `docs/ssot-design/00-document-control.md`·`05-user-flows-and-ui-spec.md`·`12-traceability-matrix.md` — 복제된 D-체크 목록을 §3 참조로 축소(DEC-2).
- `tests/unit/docs-stale-claims.test.ts` — 등록부↔문서(DEC-3b)·등록부↔런타임(DEC-3c) 가드. 실패 메시지가 어느 id가 어느 쪽에만 있는지 지목.

런타임 동작 변경 0 — 새 상수와 타입 좁힘뿐이다.

Exit(실행 명령):
- `npx tsc --noEmit` → exit 0
- `npm test`(= `vitest run`) → 전체 그린
- `npm run docs:lint` → exit 0 (문서 링크 검증)
- 변이 검사 4종(r01·r02 P1 시나리오를 그대로 재현):
  ① §3 표에서 한 행을 지우면 테스트 실패(DEC-3b)
  ② `D_CHECK_IDS`에 없는 `id: 'D28'`을 push하면 **tsc 실패**(DEC-3a)
  ③ `const id = 'D28'` 변수 표기로 push해도 **tsc 실패** ← r01+r02 조합 케이스
  ④ 문서에 유령 행을 넣으면 테스트 실패(DEC-3b)
- Codex phase 리뷰 승인

## 완료
- 게이트 해당분(unit·typecheck·lint) · 사용자 main 머지(별도 승인).
