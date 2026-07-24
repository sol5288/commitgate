# REQ-2026-053 계획 — phase 분해

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> Granularity: phase당 코드 변경 파일 수를 리뷰 가능한 크기로. 큰 phase는 런타임 분할.

## Phase 1 — `migrated-complete` 스키마 (`phase-1-migrated-complete-schema`)

범위: `scripts/req/lib/close-proof.ts` (순수 leaf) + `tests/unit/close-proof.test.ts`.

- `CloseProofEvent`·`EVENTS`에 `'migrated-complete'` 추가.
- `CloseBaseState`에 `'migrated-complete'` 추가.
- `closeProofRowProblems`: `migrated-complete` 분기 — `series_id===null`·`resolution===null`·
  `phase_inventory`(비지 않은 정렬·중복 없는 문자열 배열)·`design_ref`(비지 않은 문자열)·
  `reconstructed===true` 강제(아니면 문제). `evidence_basis` 비-빔은 기존 reconstructed 규칙이 이미 강제.
- `closeProofRowKey`: discriminator에서 `migrated-complete`는 빈 문자열(티켓당 1행).
- `deriveBaseState`: `if (hasEvent('migrated-complete')) return 'migrated-complete'` — dev-complete 판정
  **아래**, needs-recovery **위**.
- `baseStateBlocksIntake`: 변경 없음(developing·needs-recovery만 차단 → migrated-complete 비차단).

테스트 오라클:
- ① 유효 migrated-complete 행 파싱/직렬화 왕복.
- ② series_id/resolution 비-null → 문제. ③ reconstructed:false → 문제(마이그레이션은 스탬프).
- ④ phase_inventory 비정렬/중복/빈 배열 → 문제. ⑤ design_ref 빈 문자열 → 문제.
- ⑥ deriveBaseState: migrated-complete 행 → 'migrated-complete'(비차단). dev-complete와 공존 시 dev-complete 우선.
- ⑦ deriveBaseState: migrated-complete + (needs-recovery 입력) → migrated-complete 우선(비차단).
- ⑧ appendCloseProofRow: 같은 티켓 재-migrate 동일내용 → duplicate. 다른 내용 → conflict.

Exit: eslint0·typecheck0 · 단위 그린 · Codex phase 리뷰 승인.

## Phase 2 — `req:close` 명령 + intake 배선 (`phase-2-req-close-command`)

범위: `scripts/req/lib/close-migrate.ts`(신규 순수) + `scripts/req/req-close.ts`(신규 CLI) +
`bin/dispatch.mjs` + `scripts/req/lib/intake.ts`(reason) + 테스트.

- `planMigrationClose(facts)` 순수: DEC-M3 자격 판정. 적격 → `{ ok:true, row }`, 부적격 →
  `{ ok:false, reason, hint }`, 이미 종결 → `{ ok:'noop', existingState }`(DEC-M7). facts = { ticketId,
  durabilityRequired, manifestText, evidenceIntegrityProblems, committedDesignRef, evidencedPhaseIdsAll,
  evidencedPhaseIdsBound, closeParsed, integrated, ... } (intake 사실 + integrated 플래그).
- `req-close.ts`: 인자 `<REQ> --migrate [--run] [--root]`(**mainline override 없음**). HEAD blob 수집(intake
  포트 재사용) + integrated 계산(`resolveMainline()`=`origin/HEAD`→`origin/main`/`master`→로컬 `main`/`master`,
  없으면 fail-closed; `git merge-base --is-ancestor <manifest 마지막 커밋> <mainline>`) → planMigrationClose →
  dry-run 출력 / no-op 표시 / `--run`: close-proof 경로 clean 가드 → appendCloseProofRowToDisk → pathspec
  add/commit. state.json 미변경.
- `dispatch.mjs`: `VERB_MODULES['req:close'] = '../scripts/req/req-close.ts'`.
- `intake.ts classifyIntake`: reason 매핑에 `migrated-complete` → '개발 완료(마이그레이션 종결)'.
- init/migrate/uninstall/smoke: dispatch 파생이라 코드 무변경 — 단 STAGE_B 파생 집합을 **하드코딩**한
  테스트가 있으면 갱신. per-verb smoke가 `req:close`를 자동 검증(P4c 설계 검증).

테스트 오라클:
- ⑨ planMigrationClose: 적격 facts(integrated:true) → migrated-complete 행(phase_inventory=매니페스트 phase
  정렬, design_ref=committed design_hash, reconstructed:true, evidence_basis 비-빔).
- ⑩ 부적격: 증거 무결성 문제 있음 → 거부. ⑪ design_hash 없음 → 거부. ⑫ phase 증거 0 → 거부.
- ⑬ **integrated:false**(미병합 = 진행 중 가능성) → 거부(P1-1: 완료·병합 후 안내). ⑭ design-bound가 evidenced
  inventory 전체 덮음 → 거부(정상 finalize 안내).
- ⑬b 이미 dev-complete/series-terminal/migrated-complete → **성공 no-op**(`ok:'noop'`, 거부 아님 — DEC-M7).
- ⑮ (실git) 픽스처: durable + design·phase 증거 커밋(**mainline 조상**) + close-proof 없음(developing) 티켓 →
  `req:close --migrate --run` → ticket-close.jsonl에 migrated-complete 커밋 → 그 뒤 `scanIntake`가 그 티켓
  verdict 'pass'.
- ⑯ (실git) dry-run: 파일·커밋 무변경. ⑰ (실git) 재실행 no-op: 2회 `--run` → 커밋 1개(2번째 no-op, 기존
  `at` 보존·conflict 아님).
- ⑱ (실git) close-proof 경로 dirty → clean 가드 fail-closed(write 0).
- ⑱b (실git) 미병합 티켓(현재 브랜치에서만 커밋, mainline 조상 아님) → `--run` 거부(write 0).
- ⑱c (실git·r02 P1) mainline override 부재 확인: `req-close`가 `--mainline`류 인자를 받지 않고, mainline이
  신뢰된 ref로만 해소됨(임의 feature/HEAD ref로 integrated 통과 불가). mainline 미해소 시 fail-closed.
- ⑲ smoke/init: `req:close`가 Stage-B 표면·설치본 package.json script에 자동 포함.

Exit: eslint0·typecheck0 · 단위·실git 그린 · smoke 그린 · Codex phase 리뷰 승인.

## 완료

- 게이트 해당분(unit·typecheck·lint·smoke) 그린.
- 049/050/051/052를 `req:close --migrate --run`으로 종결 → `req:new` 재개 확인(운영 적용, phase 밖).
- 사용자 main 머지(C·D·E와 함께 마지막에 별도 승인).
