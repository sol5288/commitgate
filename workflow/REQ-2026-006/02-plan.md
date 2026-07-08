# REQ-2026-006 계획 — phase 분해

design-first. 단일 phase(추적). spike로 접근·행동 검증 완료(00/01 참조) → 구현.

## Phase 1 — resume read-only (`phase-1-resume-sandbox`)
범위:
- [adapters.ts](../../scripts/req/lib/adapters.ts) `createCodexReviewerAdapter.review`의 **resume args에만** `-c sandbox_mode="read-only"` 추가. exec 경로의 `--sandbox read-only`는 불변.
- resume 주석(0차 실측 노트) 갱신: `--sandbox` 플래그는 resume 미수용이나 `-c sandbox_mode` config override로 read-only 강제(spike 검증).
- [req-adapters.test.ts](../../tests/unit/req-adapters.test.ts): "resume: --sandbox 없음" 고정을 **"resume: `-c sandbox_mode=read-only` 포함"으로 교체**.
Exit: typecheck0 · 단위 그린 · Codex phase 리뷰 승인.

## 행동 검증 결과(구현 전제 — 통과)
- resume + `-c sandbox_mode="read-only"` → 리뷰어가 실제 write 시도 → `Access is denied`(sandbox 차단), sentinel 미생성 = **enforced**.
- 대조군: resume(무 `-c`) → write 성공(파일 생성) = resume는 sandbox를 drop(갭 실재). → R9는 실제 갭을 닫는다.

## 완료
- 게이트 해당분(unit·typecheck) · 사용자 main 머지(별도 승인).
