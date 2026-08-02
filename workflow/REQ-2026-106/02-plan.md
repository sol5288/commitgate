# REQ-2026-106 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

> **테스트 실행 계층(REQ-2026-100)**: 게이트는 테스트를 **실행하지 않는다**. 아래는 비용을 줄이기 위한 실행 시점 권고다.
> - **phase 진행 중**: 변경한 소스를 import하는 테스트만(빠른 피드백). 예: `grep -rl "<변경한 모듈>" tests/`
> - **통합(main 병합) 직전 1회**: **전체 스위트**. 범위 한정은 이것을 **대체하지 않는다** — 영향 분석은 놓친 회귀를 통과시킨다.

## Phase 1 — 프롬프트 바이트 골든 (`phase-1-prompt-byte-goldens`)

**선행 조건: 없음**(코드 이동 0 — 순수 테스트 추가).

범위(1파일):
- `tests/unit/review-prompt-golden.test.ts`(신규) — `assembleReviewPrompt` 전문을 **테스트 내부 literal**과 바이트 비교(DEC-1)
  - 케이스: `kind=phase`(기본) · `kind=design` · `previousFindingsToClose` 있음
  - CRLF→LF 정규화만 적용. 그 외 공백은 계약이므로 정규화 금지
  - 🔴 expected를 SUT의 상수로 조립하지 않는다(동어반복 금지)

🔴 **변이검사(DEC-2)**: `review-codex.ts`의 조립 문자열 한 곳을 바꿔 골든이 **실패**하는 것을 확인하고 **편집으로** 되돌린다(`git checkout --` 금지).

Exit: 골든 그린 · 변이검사 확인 · Codex phase 리뷰 승인.

## Phase 2 — 타입 하강 (`phase-2-review-types-descent`)

**선행 조건: phase-1 커밋됨**(골든이 이후 변경을 지킨다).

범위(5파일):
- `scripts/req/lib/review-types.ts`(신규) — `ReviewKind`·`ApprovalEvidence`·`WorkflowState` + **의존 폐포**(DEC-4)
- `scripts/req/review-codex.ts` — 정의 제거 + `export type { … } from './lib/review-types'` re-export(DEC-3). 🔴 9개 CLI 호출부는 건드리지 않는다
- `scripts/req/lib/{evidence,review-exception,review-ledger}.ts` — import 출처를 `../review-codex` → `./review-types`로

🔴 **완료 검증(요구 2)**: `grep -rn "from '../review-codex'" scripts/req/lib/`가 **0건**. 결과를 커밋 메시지에 남긴다.

Exit: `tsc --noEmit` 0 · 위 검증 · `req-review-codex`·`evidence-module`·`review-ledger`·`close-proof` 테스트 그린 · Codex phase 리뷰 승인.

## Phase 3 — CHANGELOG (`phase-3-changelog`)

**선행 조건: phase-1·2 커밋됨**(SHA 포인터가 필요).

범위(1파일):
- `CHANGELOG.md` Unreleased. **"확인할 파일" 표를 처음부터** 넣는다(REQ-2026-082 교훈).
- 🔴 **하지 않기로 한 것과 그 근거를 함께 적는다** — 프롬프트/series 이동·`mainImpl` 분해를 왜 미뤘는지. 적지 않으면 다음 사람이 "하다 만 것"으로 읽는다.

Exit: `npm run docs:lint` 통과 · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(typecheck·해당 시 lint) · **통합 직전 전체 스위트 1회** · 사용자 main 머지(별도 승인).
