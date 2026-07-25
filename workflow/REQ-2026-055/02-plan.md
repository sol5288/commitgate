# REQ-2026-055 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> 스키마(leaf)와 명령이 긴밀히 결합돼(planner가 스키마·게이트를 함께 씀) **단일 phase**로 완결한다 — 순수
> 함수만 있고 배선이 없는 비-기능 phase를 피한다(REQ-2026-054 교훈). 코드 변경 ~4파일(granularity 이내).
> 검증 명령: `pnpm run typecheck` · `npx vitest run <해당 테스트>` · `node scripts/smoke.mjs`.

## Phase 1 — review-exception 명령·스키마·rationale (`phase-1-review-exception-command`)

범위: `scripts/req/lib/review-exception.ts`(순수·신규) + `scripts/req/req-review-exception.ts`(CLI·신규) +
`bin/dispatch.mjs` + 단위/실git 테스트.

- `lib/review-exception.ts`(순수):
  · `ExceptionGrantRow` + `EXCEPTION_KEYS`(고정 키·화이트리스트) + serialize/parse/validate/appendIdempotent
    (review-ledger·close-proof와 같은 규율: 멱등 duplicate·conflict fail-closed·자연키 `(ticket,series,for_attempt)`).
  · `parseRationale(text)` — 4섹션(직전 findings·이번 변경·미해결·재시도 근거) 추출·비-빔 검증(순수).
  · `planReviewException(state, kind, phaseId, budget)` — 열린 series 확인·terminal 거부·`checkReviewBudget`으로
    needs-exception 판정. 적격 → `{ ok:true, series_id, for_attempt }`, 부적격 → `{ ok:false, reason, hint }`.
- `req-review-exception.ts`(CLI): `<REQ> --kind design|phase [--phase <id>] --method "<문장>" --rationale-file
  <path> [--run] [--root]`. planReviewException + rationale 파싱 → dry-run 출력 / `--run`: **durable 먼저**(r01 P1)
  — clean 가드 → `review-exceptions.jsonl` append + pathspec 커밋 → **성공 후에만** state.json
  `review_exception_confirmed` 기록(confirmed_at 실시계·durable 행과 동일 시각). durable 실패면 state 미기록.
- `dispatch.mjs`: VERB_MODULES += `req:review-exception`.

테스트 오라클:
- ① ExceptionGrantRow round-trip·검증(빈 method/rationale 거부·알수없는키 거부). ② **material 멱등**(r02 P1):
  같은 자연키·method+rationale 같으면 duplicate(confirmed_at 달라도)·method/rationale 다르면 conflict.
  `findExistingGrant`가 기존 행 반환(confirmed_at 재사용용).
- ③ parseRationale: 4섹션 다 있으면 OK·하나라도 비면 어느 섹션 비었는지 문제.
- ④ planReviewException: needs-exception 구간(attempts=5·유효5) → ok+for_attempt=6. ⑤ allow(유효<autoBudget) → 거부.
  ⑥ hard-blocked(유효≥hardCap) → 거부. ⑦ 열린 series 없음 → 거부. ⑧ terminal series → 거부.
  ⑨ **REQ-2026-054 상호작용**: attempts=6·refunded=1 → 유효5 → needs-exception·for_attempt=6(유효 기준).
- ⑩ (실git) needs-exception 구간에서 `--run` → review_exception_confirmed 기록(for_series_id·for_attempt 정확)
  + review-exceptions.jsonl 커밋 → 이어 `req:review-codex`가 그 예외를 정상 소비(near-e2e).
- ⑪ (실git) dry-run → state·커밋 무변경. ⑫ (실git) rationale 섹션 누락 → 거부(write 0).
- ⑬ (실git) allow 구간 → 거부(write 0). ⑭ (실git) 멱등: 같은 구간·rationale 2회 → 커밋 1개(2번째 material
  duplicate·**기존 confirmed_at 재사용**해 state 재기록·conflict 아님). ⑭b (r02 P1) durable 커밋됐으나 state
  미기록 상태 재실행 → 기존 행 confirmed_at으로 state 복구(conflict 없음).
- ⑮ (실git) review-exceptions.jsonl dirty → clean 가드 fail-closed **+ state.json에 review_exception_confirmed
  미기록**(r01 P1: durable 실패 시 소비 가능한 예외가 남지 않는다 — 독립 검증). 커밋 실패 시나리오도 동일.
- ⑯ smoke/init: `req:review-exception`이 Stage-B 표면·설치본 script에 자동 포함.

Exit: typecheck0 · 단위·실git 그린 · smoke 그린 · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(unit·typecheck·smoke) · 사용자 main 머지(C·E와 함께 마지막 별도 승인).
