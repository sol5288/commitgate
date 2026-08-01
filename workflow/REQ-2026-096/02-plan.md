# REQ-2026-096 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

## Phase 1 — phase id·아카이브 문자 집합 통일 (`phase-1-charset-parity`)

범위(코드 5파일 · 문서 4파일):

- `lib/scratch.ts` — `ARCHIVE_BASE_BODY`/`ARCHIVE_BASE_RE` 도입, `ARCHIVE_NAME_RE` 를 같은 리터럴에서 파생(DEC-1).
- `req-next.ts` — `PHASE_ID_RE` 를 `ARCHIVE_BASE_RE` 에서 파생(DEC-2), `phaseModelProblems` 문구에 아카이브 사유·복구 안내 추가(DEC-5). `CLI_SAFE_ARG_RE`·`REQ_ID_RE` 무변경(DEC-3).
- `review-codex.ts` — `resolvePhaseTarget` 에 문자 집합 가드(DEC-4): 유료 호출 전 `ok:false`.
- `tests/unit/scratch.test.ts` — 왕복 property·포함관계·음성·호출전차단(DEC-6).
- `tests/unit/req-next.test.ts` — 결함을 고정하던 `phase-3b.entrypoint_uninstall` 케이스 정정(DEC-6).
- 문서 — `docs/ssot-design/00-document-control.md`·`03-domain-and-data-model.md`·`08-architecture-and-module-spec.md`, `CHANGELOG.md`.

Exit: eslint0·typecheck0 · **전체 단위 스위트 그린** · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(unit·typecheck·lint) · 사용자 main 머지(별도 승인).
