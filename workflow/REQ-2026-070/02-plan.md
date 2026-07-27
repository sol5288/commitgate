# REQ-2026-070 계획 — phase 분해

설계 승인 후 phase별 진행.

## Phase 1 — 대상 판정 수정 (`phase-1-resolve-target`)

범위(DEC-1~DEC-5): `scripts/req/review-codex.ts`의 `resolvePhaseTarget` ·
`tests/unit/req-review-codex.test.ts`. 코드 2파일.

순서:
1. 레거시 판정을 `review_series_model_version` **부재**로 바꾼다(DEC-1).
   🔴 `rawLen === 0`만으로 판정하면 `req:new`가 만든 **모든 신규 티켓**이 레거시로 오인된다.
2. 신규 모델 + 빈 `phases[]` + `--kind phase` → 거부(DEC-2). 메시지에 고칠 방법(DEC-4).
3. 레거시라도 `--phase`가 주어졌으면 거부(DEC-3) — 조용히 버리지 않는다.
4. 기존 검증(`--phase`가 `phases[]`에 없으면 거부 · malformed 배열은 레거시 강등 금지)은 **그대로** 둔다.
   🔴 그 규칙은 "malformed 비-빈 phases[]가 레거시로 강등되어 --phase 없이 승인되는 우회"를 막는다 —
   이번 변경이 그것을 되살리면 안 된다.
5. 테스트:
   - 🔴 신규 모델 + 빈 배열 + `--kind phase` → `ok:false`, 메시지에 `phases[]`
   - 🔴 레거시(버전 필드 부재) + `--phase` 없음 → `ok:true, phaseId:null` (**무회귀**)
   - 🔴 레거시 + `--phase` 있음 → `ok:false` (조용히 버리지 않는다)
   - 정상(`phases[]` 채움 + 일치하는 `--phase`) → `ok:true, phaseId`
   - 불일치 `--phase` → `ok:false` (기존 동작)
   - malformed 비-빈 배열 → 레거시로 강등되지 않는다(기존 회귀 가드)

Exit: typecheck 0 · `npm test` green · 수용기준 1~6 · Codex 승인.

## Phase 2 — 문서 (`phase-2-docs`)

범위: docs 한/영 · CHANGELOG.

순서:
1. `phases[]`를 **사람이 채운다**는 것과, 채우기 전에는 phase 리뷰가 거부된다는 것을 적는다.
2. 실측 근거(호출 1회 낭비)를 CHANGELOG에 남긴다.

Exit: `docs:lint` green · Codex 승인.

## 완료
- 게이트 해당분 · 사용자 main 통합(B1 사전 승인 — 반영 시 우회 사실·CI 사후 검증 보고).
