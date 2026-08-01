# REQ-2026-100 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

## Phase 1 — 테스트 실행 계층 계약 (`phase-1-tiering-contract`)

범위(코드 1파일 · 테스트 2파일 · 문서 4파일):

- `scripts/req/req-new.ts` — 스캐폴드 `Exit:` 문구를 계층으로(DEC-4). `eslint0` 제거(이 저장소·소비자에 eslint 스크립트 없음).
- `AGENTS.template.md` — 실행 시점 절 신설(DEC-5). "게이트는 테스트를 실행하지 않는다"를 명시.
- `docs/development.md`·`.en.md` — 거짓 문장("게이트 판정도 이것을 봅니다") 정정 + 계층·실측 기록(DEC-6).
- `tests/unit/docs-stale-claims.test.ts` — 거짓 문장 **한/영 양쪽** `STALE_CLAIMS` 등재(DEC-6).
- `tests/unit/req-new.test.ts` — 스캐폴드 계층 문구 고정(DEC-7). 현재 스캐폴드 텍스트 검사가 0건이다.
- `CHANGELOG.md` — Unreleased 항목. 🔴 기존 소비자에게 닿는 **유일한 경로**이므로 문구가 실질 전달물이다.

런타임 동작 변경 0 — 게이트는 여전히 테스트를 실행하지 않는다.

Exit(실행 명령):
- `npx tsc --noEmit` → exit 0
- **변경 범위 단위 그린**: `npx vitest run tests/unit/req-new.test.ts tests/unit/docs-stale-claims.test.ts`
- `npm run docs:lint` → exit 0
- 변이 검사 2종: ① 스캐폴드에서 계층 문구를 지우면 `req-new.test.ts` 실패 ② 정정한 거짓 문장을 문서에 되돌리면 `docs-stale-claims.test.ts` 실패
- 전체 스위트는 **통합 직전 1회**(이 REQ가 세우는 규칙을 이 REQ부터 적용한다)
- Codex phase 리뷰 승인

## 완료
- 게이트 해당분(unit·typecheck·lint) · 사용자 main 머지(별도 승인).
