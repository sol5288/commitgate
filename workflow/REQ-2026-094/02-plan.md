# REQ-2026-094 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

## Phase 1 — 매니페스트 어휘 + 복원 판정(순수) (`phase-1-witness-model`) — 🔴 **커밋됐으나 phase-2가 되돌림**

> 설계 r03 P1로 복원이 폐기되면서(DEC-3) 이 phase의 산출물은 **쓰이는 곳이 없어졌다.**
> 아래 원래 범위·가드는 이력으로 남기고, 실제 최종 상태는 Phase 2가 정한다.

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

## Phase 2 — 진단(D27) + phase-1 복원 어휘 원복 (`phase-2-diagnose-restore`)

🔴 **범위가 설계 r03 P1로 바뀌었다**(DEC-3): 복원은 정직하게 불가능함이 확정돼 폐기됐다.
이 phase는 **진단을 넣고, phase-1이 넣은 복원 어휘를 되돌린다.**

범위(6파일):

- `scripts/req/lib/evidence.ts` — `approvalWitnessMismatch()` 진단 술어 **추가**(`consumedWithoutRow`만
  산출 — `pendingWithoutRow`는 쓰이는 곳이 없으므로 만들지 않는다). phase-1이 넣은
  `reconstructed`·`evidence_basis` 어휘와 복원 행 검증 분기는 **제거**(DEC-3a).
- `scripts/req/lib/reconstruct.ts` — `planApprovalRestore` 및 관련 타입 **제거**(원복).
- `scripts/req/req-doctor.ts` — **D27 WARN**. 경고 신호는 `consumedWithoutRow` 하나뿐.
  안내는 **정직한 두 경로**를 준다: phase 재수행 또는 `req:close --abandon`.
  🔴 복원 명령을 안내하지 **않는다**(존재하지 않는다).
- `tests/unit/req-doctor.test.ts` — D27 가드.
- `tests/unit/evidence-module.test.ts`·`reconstruct.test.ts` — phase-1 테스트 원복.

회귀 가드:

1. 🔴 **오탐 0 대조군**(R1): 정상 진행 중 티켓에서 **D27이 조용하다**. 완료 티켓·리뷰 이력 없는
   티켓도 조용하다. 🔴 **미소비 `approval_evidence`만 커밋된 상태에서도 조용하다** — `req:confirm`
   체크포인트가 만드는 정상 상태다(DEC-1a, REQ-2026-092 `a3b4c99`로 반증된 초안 가정).
2. **D27이 실제로 본다**: `consumed_approvals`에 항목이 있는데 매니페스트 행이 없는 티켓 → WARN.
3. 🔴 **D27은 FAIL이 아니다**: 어떤 입력에서도 FAIL이 없다(게이트를 새로 막지 않음).
4. **안내가 정직하다**: 메시지가 phase 재수행과 `req:close --abandon`을 말하고,
   🔴 **복원 명령을 언급하지 않는다**(없는 명령을 안내하면 사용자를 막다른 길로 보낸다).
5. 🔴 **원복 완결성**: `MANIFEST_KEYS`에 `reconstructed`·`evidence_basis`가 **없다** ·
   `planApprovalRestore`가 export되지 **않는다** · `--approvals` 플래그가 **없다**.
   (남겨 두면 죽은 기능이 되고 다음 사람이 "복원할 수 있나 보다"라고 오해한다.)
6. **매니페스트 검증 무변경**: 기존 행 검증 결과가 phase-1 이전과 동일하다.

Exit: typecheck0 · 전체 스위트 그린 · Codex phase 리뷰 승인.

## Phase 3 — 문서 + CHANGELOG (`phase-3-docs`)

범위(3파일):

- `docs/troubleshooting.md` / `.en.md` — "승인은 있었는데 행이 없다" 증상 → D27이 알려 줌 →
  🔴 **증거는 복구할 수 없다**는 사실과 그 이유(승인 핀은 소비와 함께 지워진다) → 정직한 두 경로
  (phase 재수행 / `req:close --abandon`).
- `CHANGELOG.md` — Unreleased에 합류 + **확인할 파일 표**(phase-2 실제 SHA — phase-1은 phase-2가
  되돌리므로 사용자에게 보이는 순변화가 없다).

Exit: typecheck0 · 전체 스위트 그린 · `docs:lint` 그린 · Codex phase 리뷰 승인.

## 완료

- 게이트 해당분(unit·typecheck·docs:lint) · 사용자 main 머지(별도 승인) · 그 뒤 **0.16.0 배포**
  (092·093·094 묶음 — 사용자 지시).

> 🔴 **HIGH 운영 메모**: 마지막 phase 전에 `req:confirm --scope req`를 **리뷰 前에** 실행한다.
> 뒤에 하면 `state.json`이 인덱스에 들어가 D9가 stale이 되고 유료 재리뷰가 한 번 더 든다
> (REQ-2026-092 실측 · 093에서 회피 성공).
