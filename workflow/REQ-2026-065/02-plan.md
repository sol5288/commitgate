# REQ-2026-065 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

## Phase 1 — preflight 배선 (`phase-1-preflight`)

범위(설계 DEC-1~DEC-7): `scripts/req/review-codex.ts` · `tests/unit/req-review-codex.test.ts`. 코드 2파일.

순서:
1. `main(argv, { reviewer, probes })`로 `probes` 주입 seam 추가(기본 `createReviewerProbes()`).
   기존 `reviewer` 주입과 **같은 형태** — 새 관례를 만들지 않는다.
2. 🔴 preflight를 **short-circuit 판정 뒤 · 예산 gate 앞**에 넣는다(DEC-1).
   그 뒤에 두면 **고아 attempt가 남고 예산이 이미 소모된다** — 이 REQ가 막으려는 상태 그 자체다.
3. `--run`일 때만 확인(DEC-4). 순서는 version → auth(DEC-2).
4. 🔴 `logged-out`만 차단하고 `unknown`은 **경고 후 진행**(DEC-3). bypass 플래그를 만들지 않는다(DEC-5).
5. 메시지에 조치와 **"예산이 차감되지 않았다"**를 담는다(DEC-7).
6. 테스트(수용기준 1~6):
   - 미로그인 → throw + **원장 파일이 생기지 않음** + state의 attempt가 늘지 않음
   - `unknown` → 차단되지 않고 리뷰가 정상 완료됨(경고만)
   - 미설치 → 같은 지점에서 차단
   - `--dry-run` → probe 없이 통과
   - argv 파서에 bypass 플래그가 없음(알 수 없는 옵션으로 거부)

Exit: typecheck 0 · `npm test` green · 수용기준 1~6 충족 · Codex phase 리뷰 승인.

## Phase 2 — 문서 (`phase-2-docs`)

범위: `docs/troubleshooting{,.en}.md` · `CHANGELOG.md`. 코드 변경 0.

순서:
1. troubleshooting: 미로그인 리뷰가 이제 **예산을 태우지 않고 먼저 멈춘다**는 것과 그 조치.
2. 🔴 `unknown`(판정 불가)은 **차단하지 않는다**는 것과 그 이유(진단이지 게이트가 아니다)를 적는다 —
   그러지 않으면 경고를 보고 "고장 났나" 하고 되돌리려는 시도가 생긴다.
3. CHANGELOG: **앞 phase 구현을 커밋·파일·심볼 단위로** 가리킨다(docs-only phase 오탐 전례).

Exit: `docs:lint` green · typecheck 0 · `npm test` green · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(unit·typecheck·docs:lint) · 사용자 main 통합(별도 승인).
