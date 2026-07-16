# REQ-2026-017 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor D18 WARN.
>
> **plan-lint는 이 REQ 범위 아님**(별도 후속 REQ) — 따라서 phase meta·region 앵커를 두지 않는다.

## Phase 1 — review series 상태 모델 (`phase-1-series-state`)
범위: state `review_series[target]`(`series_no`/`count`/`last_needs_fix_snapshot`) · 승인 시 series 전환(count=0·series_no++·snapshot=null) · domain-valid NEEDS_FIX면 snapshot 갱신 · **container 단위 legacy fail-closed**(이력 전무=fresh / `last_review` 있으면 전 target 차단) · `last_review` 보존. (§2·§6)
Exit: eslint0·typecheck0 · **count-not-reset(문서 수정→같은 series 승계)** · series 전환 · snapshot 보존 · **design 이력만 있어도 첫 phase fail-closed / 이력 전무만 fresh** 단위 그린 · Codex phase 리뷰 승인.

## Phase 2 — ticket lock + pending_review_attempt 예약 (`phase-2-atomic-reserve`)
범위: `scripts/req/lib/ticket-lock.ts`(신규 — `…/<ticket-id>-<lock_epoch>.lock`(epoch) 경로 결정론·원자 exclusive create·**자기 epoch만 unlock**·common-dir 실패 fail-closed·fencing CAS 헬퍼) · review-codex `--run`을 lock 획득→pending 검사→**base_binding 캡처+예약(pending{run_id,lock_epoch,state_revision}+count+1, temp→fsync→rename)**→외부 호출→base_binding 재검→**fencing CAS 확정(run_id·lock_epoch·state_revision 일치 시만)**→자기 epoch unlock 흐름으로 · 부분 실패·동시·중단 fail-closed · **허용 변경=운영 필드+명시 scratch(`.review-preview.txt`·`codex-response.json`·`responses/`)**. (§3)
Exit: eslint0·typecheck0 · **예약 count 정확히 1회** · **병렬 `--run`=둘째 lock 실패 fail-closed** · **부분 실패 각 지점 fail-closed / lock 전 실패는 lock 없음** · **lock이 worktree clean/staged/prompt에 안 나타남·복수 worktree 동일 경로** · **fencing: A예약→recovery(epoch++·count 보존)→B예약→지연 A 확정/해제/B-unlock 모두 fail-closed·B 불변 / run_id·epoch·revision 불일치 확정 불가 / recovery가 count 감소·series 초기화 안 함** · **dry-run이 preview 외 무변경** · **기존 scratch 허용·미등록 scratch·source/design/staged 변경 각 D10 사후·D9/D10/D13 유지** · **crash: pending 남으면 lock 무관 fail-closed / lock만 남아도 fail-closed** · **운영필드만 변경은 후보 binding 불변·00/01/02 변경은 base_binding 불일치 fail-closed** 단위 그린 · Codex phase 리뷰 승인.

## Phase 3 — count 경계 + terminal escalation + doctor 진단 (`phase-3-cap-escalation`)
범위: config `reviewLoop.reReviewLimit`(기본 3) · **경계 정본**(count<limit면 예약·도달시키는 호출 발생·즉시 escalation / count==limit이면 preflight 차단·외부 미호출·count 미증가) · terminal escalation 기록(open_findings=snapshot 정본)·재확인·exit 구분 · `req:doctor`가 **§3.1과 동일 경로**의 dangling lock/pending **진단만**·human recovery 표기(자동 정리 안 함). (§3.3·§4·§5)
Exit: eslint0·typecheck0 · **count=2→예약3→외부 호출→즉시 escalation / 이미 3→외부 미호출·재확인·미증가** · **escalation open_findings snapshot 보존(invalid/blocked 덮어도)·무 needs-fix=[]+사유** · **req:doctor dangling 진단·자동정리 안 함** 단위 그린 · Codex phase 리뷰 승인.

## Phase 4 — 문서·계약 정합 (`phase-4-docs`)
범위: `README.md`/`README.en.md`(상한·lock·pending·escalation·human recovery + plan-lint 후속 제외 명시) · `AGENTS.template.md` · `CHANGELOG.md`.
Exit: 문서 정합 · smoke 그린 · Codex phase 리뷰 승인.

## 완료 (Done)
- 00-requirement Done #1~#9 충족 · 게이트 해당분(unit·typecheck·lint·smoke) 그린 · 회귀 테스트 그린 · **plan-lint 부재 확인** · 사용자 main 머지(별도 승인).
