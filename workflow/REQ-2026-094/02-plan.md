# REQ-2026-094 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

## Phase 1 — 매니페스트 어휘 + 복원 판정(순수) (`phase-1-witness-model`)

범위(4파일):

- `scripts/req/lib/evidence.ts` — `MANIFEST_KEYS`에 `reconstructed`·`evidence_basis` 추가(선택).
  복원 행(`reconstructed:true`)에 한해 `consumed_at`·`user_commit_confirmed` **부재 허용** +
  `evidence_basis` 비어있지 않음 강제. 원본 행 규칙 무변경(DEC-4).
  🔴 **`validateManifest`의 필수 키 강제 방식을 먼저 읽고** 부재==미복원본으로 읽히게 한다(DEC-4a).
- `scripts/req/lib/reconstruct.ts` — 승인 행 복원 판정(순수). 입력은 HEAD 사실만(CLI가 포트로 채움),
  산출은 후보 행 + 거부 사유. W1~W4 전부 성립할 때만 후보(DEC-3).
- `tests/unit/evidence-module.test.ts` — 어휘·호환 표.
- `tests/unit/reconstruct.test.ts` — 판정 표.

회귀 가드:

1. 🔴 **기존 행 호환**(DEC-4a): `reconstructed`·`evidence_basis` **키가 없는** 기존 phase·design·rebind
   행이 전부 valid로 남는다. 명시적 `false`/`null`도 valid. **이 가드가 없으면 업그레이드만으로 모든
   티켓이 corrupt가 된다**(직전 REQ에서 같은 자리에 지뢰가 있었다).
2. **복원 행 규칙**: `reconstructed:true`인데 `evidence_basis`가 비면 거부 · `consumed_at`·
   `user_commit_confirmed` 부재는 **허용**.
3. **원본 행 무변경**: `reconstructed` 부재/`false`이면 `consumed_at`·`user_commit_confirmed`가
   **여전히 필수** · `evidence_basis`가 있으면 거부(원본과 복원의 구별).
4. **판정 표(W1~W4)**: W1 부재 → 거부(사유 명시) · W2 sha 불일치 → 거부 · W3 후보 0개/2개 이상 →
   거부 · W4가 있는데 W1과 `approved_tree`가 다르면 → 거부 · 전부 일치 → 후보 1건.
5. **지어내지 않음**: 후보 행에 `consumed_at`·`user_commit_confirmed`가 **없다**(있으면 실패).
6. **kind 격리**: design 행은 이 복원의 대상이 아니다(phase 전용).

Exit: typecheck0 · **전체 스위트 그린** · Codex phase 리뷰 승인.

## Phase 2 — doctor D27 + `req:reconstruct --approvals` (`phase-2-diagnose-restore`)

범위(4파일):

- `scripts/req/req-doctor.ts` — **D27 WARN**(DEC-1·2). 신호는 증인 불일치 두 종.
  메시지에 어긋난 phase와 **다음 행동**(`req:reconstruct --approvals` 또는 `req:close --abandon`).
- `scripts/req/req-reconstruct.ts` — `--approvals` 모드 배선. HEAD 포트로 W1~W4 수집 → 순수 판정 →
  dry-run 출력 → `--run`이면 매니페스트 append + pathspec 커밋. 거부 시 증인별 사유 + 탈출구 안내(DEC-7).
- `tests/unit/req-doctor.test.ts` — D27 실 git.
- `tests/unit/reconstruct.test.ts` — 명령 e2e.

회귀 가드:

1. 🔴 **오탐 0 대조군**(R1): 정상 진행 중 티켓(승인 직후 state가 dirty·미커밋)에서 **D27이 조용하다**.
   완료 티켓·리뷰 이력 없는 티켓에서도 조용하다.
2. **D27이 실제로 본다**: `consumed_approvals`에 항목이 있는데 매니페스트 행이 없는 티켓 → WARN.
   `approval_evidence`가 커밋돼 있는데 행이 없는 티켓 → WARN.
3. 🔴 **D27은 FAIL이 아니다**: 그 티켓에서 `req:doctor`가 여전히 PASS로 끝난다(게이트를 새로 막지 않음).
4. 🔴 **복원 e2e**: 증인 완비 티켓 → `--approvals --run` → 매니페스트에 행 추가 →
   그 phase가 `evidencedPhaseIdsFromManifest`에 들어간다 → **D27이 조용해진다**.
5. **복원은 승인을 부여하지 않는다**(DEC-6·R6): 복원 후에도 `commit_allowed`·`approved_diff_hash`가
   변하지 않는다(state 무변경) · 복원 커밋 diff가 `responses/approvals.jsonl` **한 경로뿐**.
6. **거부 안내**(DEC-7): 증인이 없는 티켓에서 거부 메시지가 **없는 증인을 지목**하고
   `req:close --abandon`을 안내한다.
7. **기본 dry-run**: `--run` 없으면 커밋·파일 무변경.
8. **무회귀**: 기존 close-proof 복원 경로(`--approvals` 없음)가 그대로 동작한다.

Exit: typecheck0 · 전체 스위트 그린 · Codex phase 리뷰 승인.

## Phase 3 — 문서 + CHANGELOG (`phase-3-docs`)

범위(3파일):

- `docs/troubleshooting.md` / `.en.md` — "승인은 있었는데 행이 없다" 증상 → D27이 알려 줌 → 복원 시도 →
  안 되면 포기. **복원이 승인을 만들어 내지 않는다**는 점 명시.
- `CHANGELOG.md` — Unreleased에 합류 + **확인할 파일 표**(phase-1·2 실제 SHA).

Exit: typecheck0 · 전체 스위트 그린 · `docs:lint` 그린 · Codex phase 리뷰 승인.

## 완료

- 게이트 해당분(unit·typecheck·docs:lint) · 사용자 main 머지(별도 승인) · 그 뒤 **0.16.0 배포**
  (092·093·094 묶음 — 사용자 지시).

> 🔴 **HIGH 운영 메모**: 마지막 phase 전에 `req:confirm --scope req`를 **리뷰 前에** 실행한다.
> 뒤에 하면 `state.json`이 인덱스에 들어가 D9가 stale이 되고 유료 재리뷰가 한 번 더 든다
> (REQ-2026-092 실측 · 093에서 회피 성공).
