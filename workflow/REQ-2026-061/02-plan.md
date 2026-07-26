# REQ-2026-061 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

## Phase 1 — check verb (`phase-1-check-verb`)

범위(설계 DEC-1~DEC-8): `bin/check.ts` 신규 · `bin/dispatch.mjs` 등록 ·
`tests/unit/check.test.ts` 신규 · `tests/unit/dispatch.test.ts` 갱신. 코드 4파일.

순서:
1. 순수 판정 `runChecks(inputs) → CheckReport` — C1~C4(DEC-3). `unknown`은 WARN(DEC-3).
2. 렌더링 2종을 **같은 report에서** 파생(DEC-5). `--json`이면 사람용 줄을 섞지 않는다.
3. CLI 배선 — `--dir`(기본 cwd, DEC-7) · `--json` · `-h`. `loadConfig` 실패를 C1 FAIL로 흡수(DEC-6).
4. exit code: FAIL≥1 → 1, 아니면 0(DEC-4).
5. dispatch 등록 + `resolveDispatch` 테스트.
6. 티켓이 없는 임시 디렉터리에서 실제 실행해 수용기준 1을 확인한다.

Exit: typecheck 0 · `npm test` green · 수용기준 1~5 충족 · Codex phase 리뷰 승인.

## Phase 2 — 문서 (`phase-2-docs`)

범위: `docs/troubleshooting{,.en}.md` · `docs/quick-start{,.en}.md` · `CHANGELOG.md`. 코드 변경 0.

순서:
1. troubleshooting: "리뷰가 `codex 종료 코드 1`로 죽는다" 항목에서 **먼저 `commitgate check`를 돌리라**고
   안내한다 — 그 실패는 예산까지 차감하므로 사전 진단의 효용이 크다.
2. quick-start: 설치 흐름 뒤에 확인 수단으로 한 줄 추가.
3. CHANGELOG Unreleased에 항목 추가. **앞 phase 구현 포인터를 포함**한다(docs-only phase가
   diff-scoped 리뷰에서 "근거 없음"으로 오탐된 전례 — REQ-2026-037).
4. 🔴 비목표를 문서에도 적는다 — check는 **아무것도 고치지 않고 어떤 게이트에도 배선되지 않는다**.

Exit: `docs:lint` green · typecheck 0 · `npm test` green · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(unit·typecheck·docs:lint) · 사용자 main 통합(별도 승인).
- 🔴 **단독 릴리스 금지** — REQ-2026-060과 함께 원장 감사 REQ(E) 뒤에 버전을 붙인다.
