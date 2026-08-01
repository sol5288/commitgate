# REQ-2026-097 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

## Phase 1 — 종결 티켓에서 브랜치 축 면제 (`phase-1-terminal-branch-axis`)

범위(코드 2파일 · 문서 2파일):

- `req-doctor.ts` — `DoctorInputs.ticketTerminalEvent?: CloseProofEvent | null` 추가(DEC-2), D2·D3·D11이 그것을 보고 `OK`+이벤트 포함 사유 문구(DEC-3), `main()`이 `scanTicketIntake().baseState`로 계산해 주입(DEC-1). 워킹트리 축 무변경(DEC-4).
- `tests/unit/req-doctor.test.ts` — DEC-6의 7항목(면제·**이벤트별 문구**·무회귀·fail-closed·D10 유지·커밋경로 불개방·`main()` 배선 e2e).
- 문서 — `docs/ssot-design/07-business-rules-and-state-machines.md` §3 표의 D2·D3·D11 행, `CHANGELOG.md`.

Exit: typecheck0 · **전체 단위 스위트 그린** · 도그푸딩 확인(종결 티켓 `req:doctor` exit 0, 진행 중 티켓은 무변경) · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(unit·typecheck·lint) · 사용자 main 머지(별도 승인).
