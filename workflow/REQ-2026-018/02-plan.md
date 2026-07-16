# REQ-2026-018 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

## Phase 1 — severity 배선 (`phase-1-severity-wiring`)

**단일 phase.** 변경 4파일(코드 1·스키마 1·문서 1·테스트 1) = 상한 8 이내. 쪼개면 오히려 중간 상태가
"출력 스키마는 P1-only인데 정의는 없음"처럼 불완전해지므로 나누지 않는다.

범위:
1. `scripts/req/lib/adapters.ts` — `deriveStrictOutputSchema()`가 `findings[].severity.enum`을 `["P1"]`로 축소(D2).
   경로 부재 시 throw(D3). 함수 주석에 "왜 출력 스키마에서만 강제하는가"(D1) 기록.
2. `workflow/machine.schema.json` — `findings[].severity.description`에 P1 정의 3요소 추가(D4). **enum은 `P1|P2|P3` 유지**(R3).
3. `workflow/review-persona.md` — 상단 프레임에 보장 범위 경계·P1 정의·부채→observations(D6).
4. `tests/unit/req-adapters.test.ts` — 회귀 4건:
   - **R1**: 파생 출력 스키마의 `findings[].severity.enum` == `["P1"]`.
   - **R2**: 원본 `machine.schema.json`의 `findings[].severity.description`이 비어 있지 않고,
     P1 정의 **4요소를 각각 별도 단언**으로 고정한다 — (a) 카테고리 한정(요구 위반·데이터 손상·보안·금전 오류·
     fail-closed 우회), (b) 정상 사용 경로 재현, (c) 재현 경로·실패 시나리오 필수, (d) 배제 규칙(그 외는 정상 경로에서
     재현되더라도 P1이 아니며 `observations`로). 넷 중 하나라도 빠지면 실패해야 한다
     (description 존재 여부만 보는 단언은 R2를 고정하지 못하며, (a)·(d)가 빠지면 severity inflation 경로가 열린 채 통과한다).
   - **R3**: 원본 enum이 `P1|P2|P3`임을 단언하고, **`workflow/REQ-2026-0*/responses/*.json` 전체를
     원본 검증 스키마(AJV)로 검증해 전부 통과**함을 고정한다. 아카이브 집합에 P2와 P3가 **실제로 존재함**을
     함께 단언해(0건이면 이 테스트는 무의미) 하위호환 회귀를 실효화한다.
   - **D3**: severity 경로가 없는 스키마 입력 → throw.

Exit: eslint0·typecheck0 · 단위 그린 · **`classifyReview()` diff 0줄**(비목표 준수) · Codex phase 리뷰 승인.

## 검증(수동, phase 리뷰 전)

- `git diff -- scripts/req/review-codex.ts` 가 비어 있음 → D5 준수 확인.
- 파생 스키마 실물 확인: `deriveStrictOutputSchema(readFileSync('workflow/machine.schema.json','utf8'))` 출력에
  severity enum이 `["P1"]`, description이 비어 있지 않음.

## 완료

- 게이트 해당분(unit·typecheck·lint) · 사용자 main 머지(별도 승인).
- **HIGH 리스크**: `req:commit --run` 전에 `state.json`의 `user_commit_confirmed`를 사용자가 직접 확인·기록해야 한다.

## 후속(이번 REQ 아님)

- 라운드 상한(2/3/최대 5) + PM escalation · 승인 후 편집의 델타 재리뷰 · 요구 falsifiable 린트.
- severity inflation 정량 관측(P1 비율)으로 이번 완화의 실효 확인.
