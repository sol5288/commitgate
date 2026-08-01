# REQ-2026-093 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

## Phase 1 — `abandoned` 이벤트 + `req:close --abandon` (`phase-1-abandon`)

범위(6파일):

- `scripts/req/lib/close-proof.ts` — `CloseProofEvent`에 `'abandoned'` 추가 · `abandon_reason`·`method`를
  `CLOSE_PROOF_KEYS`에 추가(허용 목록 추가일 뿐 **필수화 아님**)하고 **다른 이벤트에서는 부재
  (`undefined`) 또는 `null` 둘 다 정상·값이 있으면 거부**(DEC-3a — `!== null` 금지) · `closeProofRowKey`는
  discriminator 없음(티켓당 1행) · `verifiedTerminalEvent`의 **마지막** 후보 · `CloseBaseState` 확장(DEC-1~3).
- `scripts/req/lib/intake.ts` — `abandoned` reason 문구(DEC-8).
- `scripts/req/req-close.ts` — `--abandon --reason --confirm` 모드. `--migrate`와 상호배타.
  기본 dry-run. 시각은 **실시계 스탬프**. pathspec 커밋(DEC-4·7).
- `scripts/req/lib/reconstruct.ts` — `abandoned` 복원 불가 근거를 헤더에 명시(DEC-6, 주석만).
- `tests/unit/close-proof.test.ts` — 모델·우선순위·검증 표.
- `tests/unit/req-close.test.ts` — 실 git e2e.

회귀 가드:

1. **우선순위**(DEC-2): 같은 티켓에 `abandoned` + `dev-complete`(검증됨)가 있으면 **`dev-complete`가
   이긴다** · `abandoned` + `needs-recovery` 조건이면 `abandoned`(비차단)가 이긴다.
2. **kind 격리**(DEC-3): `abandon_reason`/`method`가 **다른 이벤트 행에 값으로 있으면 검증 실패** ·
   `abandoned` 행에 `series_id`/`phase_inventory`/`design_ref`가 non-null이면 실패 ·
   `abandon_reason`·`method`가 빈 문자열/공백이면 실패.
2a. 🔴 **기존 행 호환**(DEC-3a — 설계 r01 P1): `abandon_reason`·`method` **키가 아예 없는**
   `dev-complete`·`series-terminal`·`migrated-complete` 행이 **valid로 남는다**. 이 가드가 없으면
   업그레이드만으로 완료 티켓이 `corrupt`가 되어 intake가 전부 막힌다. 명시적으로 `null`인 경우도 valid.
   테스트는 두 형태(키 부재 / 명시적 null)를 **둘 다** 고정한다.
3. 🔴 **e2e — 세 가지 티켓 모양**(R1의 진짜 오라클). 각각 포기 후 **`req:new`가 통과**한다:
   - (a) 리뷰 이력 없음(`review_series` 빈 배열)
   - (b) 모든 series가 `approved`로 닫힘 + 일부 phase만 커밋(소비자 사례 재현)
   - (c) 설계 승인만 있고 phase 0개
4. 🔴 **증거 불변**(R4·DEC-5): 포기 전후로 `approvals.jsonl`·커밋된 아카이브의 **blob SHA가 동일** ·
   포기 커밋의 diff가 `responses/ticket-close.jsonl` **한 경로뿐**.
5. **멱등**(R6·DEC-7): 두 번 실행해도 행 1개 · 두 번째는 성공 종료 · 이미 `dev-complete`인 티켓에
   실행하면 no-op(행 추가 없음).
6. **fail-closed 인자**: `--reason` 없음 · `--confirm` 없음 · 공백만 · `--abandon`+`--migrate` 동시 →
   전부 거부하고 **아무것도 쓰지 않는다**.
7. **기본 dry-run**: `--run` 없이 실행하면 커밋이 생기지 않는다(`rev-list --count` 불변).
7a. **커밋된 phase 경고**(DEC-8): 커밋된 phase가 있는 티켓의 dry-run 출력에 개수와 "증거는 지워지지
   않는다"가 포함된다 · 커밋된 phase가 0개면 그 문구가 **없다**(대조군 — 항상 뜨는 문구는 안 읽힌다).
8. **무회귀**(R7): 기존 3종 이벤트의 자연키·검증·우선순위 테스트 전량 그린.

Exit: typecheck0 · **전체 스위트 그린** · Codex phase 리뷰 승인.

## Phase 2 — 문서 + CHANGELOG (`phase-2-docs`)

범위(3파일):

- `docs/troubleshooting.md` / `.en.md` — 증상("미종결 durable 티켓이 있어 새 REQ를 만들 수 없습니다")
  → 먼저 시도할 것(완료·`req:rebind`·`--migrate`) → **그래도 안 되면 포기**. 포기가 증거를 지우지
  **않는다**는 점과, 감사 행이 남는다는 점을 명시.
- `CHANGELOG.md` — Unreleased 항목 + **확인할 파일 표**(phase-1 실제 커밋 SHA·심볼).
  REQ-2026-082·092 교훈: 막 phase의 CHANGELOG가 앞 phase를 알리므로 SHA 포인터 표를 **처음부터** 넣는다.

Exit: typecheck0 · 전체 스위트 그린 · `docs:lint` 그린 · Codex phase 리뷰 승인.

## 완료

- 게이트 해당분(unit·typecheck·docs:lint) · 사용자 main 머지(별도 승인).

> 🔴 **HIGH 티켓 운영 메모**: `req:confirm`은 `state.json`을 인덱스에 넣어 승인 tree를 바꾸므로
> **phase 리뷰 前에** 실행한다. 뒤에 하면 D9가 stale이 되어 유료 재리뷰가 한 번 더 든다
> (REQ-2026-092에서 실측 — 별도 REQ로 다룰 결함).
