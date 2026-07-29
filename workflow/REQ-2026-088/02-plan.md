# REQ-2026-088 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고.

## Phase 1 — 진행 중 사전 안내 (`phase-1-early-notice`)

범위(4파일):
- `scripts/req/req-next.ts` — `NextInput.committedManifestText?` · 순수 `staleBindingNotice()` · `resolveNext`를 wrapper로(본문은 `resolveNextCore`로 이름만 이동, 로직 무변경) · `main()`의 HEAD blob 읽기 (DEC-1·2·3)
- `scripts/req/req-doctor.ts` — `DoctorInputs.staleBindingLines?` · **D26**(WARN 상한) · `main()` 계산 (DEC-4)
- `tests/unit/req-next.test.ts` · `tests/unit/req-doctor.test.ts`

회귀 가드: ①미결속 → diagnostics에 rebind 명령+확인 문장 ②🔴 `kind`·`detail`·`command` 불변(대조군 비교)
③결속 온전 → 0줄 ④매니페스트 부재·파손 → 무동작 ⑤레거시 → `--migrate` 안내 ⑥🔴 D26은 어떤 입력에서도 FAIL 아님
⑦문구가 `recoveryGuidance` 산출과 동일(재구현 금지).

Exit: typecheck0 · 전체 스위트 그린 · Codex phase 리뷰 승인.

## Phase 2 — 문서·CHANGELOG (`phase-2-docs-changelog`)

범위(3파일):
- `docs/workflow.md` · `docs/workflow.en.md` — "설계를 다시 승인했다면 — `req:rebind`" 절에 사전 안내 서술
- `CHANGELOG.md` — Unreleased + **확인할 파일 표**(phase-1 실제 커밋 SHA·경로)

Exit: typecheck0 · 전체 스위트 그린 · `docs:lint` 그린 · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(unit·typecheck·docs:lint) · 사용자 main 머지(별도 승인).
