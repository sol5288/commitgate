# REQ-2026-025 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

## Phase 1 — 배칭 persona 계약 (`phase-1-batching-persona`)

범위: D1. `workflow/review-persona.md`에 배칭 전수반환 의무 + `review_kind`별 점검 관점 + R3 기존 코드
기준선 경계를 넣는다. **코드 변경 없음** — persona 주입은 이미 배선돼 있다.

변경 파일: `workflow/review-persona.md` · `tests/unit/req-review-codex.test.ts`

### Oracle

- **O1-1 전수반환 의무가 프롬프트에 도달한다** (R1): 실제 `workflow/review-persona.md`를
  `loadReviewPersona`로 읽어 `assembleReviewPrompt`에 넣고, 조립 결과에 전수반환 의무 문장이 포함됨을
  단언한다. **persona에서 그 절을 지우면 실패한다** — 계약 회귀 가드.
- **O1-2 kind별 관점 목록과 R3 경계가 존재한다** (R2·R3): 조립 결과에 `design` 관점 목록·`phase` 관점
  목록·R3 경계 문장이 각각 포함됨을 단언한다.
- **O1-3 기존 경계 무변경** (R5): 현행 P1 정의 3요소·`observations` 경계·"승인은 findings 0건일 때만"
  문장이 persona에 **그대로 남아 있음**을 단언한다. 배칭 추가가 기존 차단 계약을 침식하지 않았음을 고정한다.

### 정직성 — 이 phase에서 단위 테스트로 증명되지 않는 것

- **"리뷰어가 실제로 배칭한다"는 증명되지 않는다.** LLM 행동은 결정적으로 단위 테스트할 수 없고, R4가
  검증 불가능한 자기선언 필드를 금지한다. 이 phase가 보장하는 것은 **계약이 프롬프트에 도달한다**는 것뿐이다.
  실제 효과는 phase 2의 로그로 **사후 측정**한다. 이 한계를 오라클로 위장하지 않는다.
- **"design·phase 관점 목록이 서로 모순되지 않는다"(R2 후단)** 는 문자열 단언으로 증명할 수 없다.
  이것은 design 리뷰의 판단 사항이다.

Exit: eslint0·typecheck0 · 단위 그린 · Codex phase 리뷰 승인.

## Phase 2 — review-call 로그 (`phase-2-review-call-log`)

범위: D2~D6. `policy_version` 파생 + `appendReviewCallLog` + `main()` 배선 + `.gitignore`.

변경 파일: `scripts/req/review-codex.ts` · `.gitignore` · `tests/unit/req-review-codex.test.ts`

### Oracle

- **O2-1 `policy_version` 파생** (D2): 순수 함수. 임의 본문 → `sha256(본문).slice(0,12)`와 일치.
  본문이 1바이트 다르면 값이 다르다. persona가 `null`이면 `"none"`.
- **O2-2 최소 필드 1행** (R6): 임시 디렉터리에 append 후 파싱해 R6 9개 필드가 전부 존재함을 단언.
  `archive_round`는 **무효 응답(아카이브 없음) 케이스에서 `null`** 임을 별도로 단언한다.
- **O2-3 내용이 담기지 않는다** (R7) 🔴 **이 REQ의 핵심 오라클**: `findings[].detail`과
  `observations[].detail`에 고유 표식 문자열을 넣은 verdict로 append한 뒤, **기록된 행에 그 표식이
  없음**을 단언한다. 개수(`findings_count`=N)는 맞게 기록됐음을 함께 단언한다.
  → verdict를 통째로 덤프하거나 finding 본문을 흘리는 구현은 이 오라클에서 실패한다. 필드 존재만
  검사하면 그런 구현도 통과하므로, **부재를 명시적으로 단언한다.**
- **O2-4 실패 격리** (R8): append 대상이 쓰기 불가일 때 함수가 **throw하지 않음**을 단언한다.
- **O2-5 gitignore로 D10에 영향 없음** (R7·하위호환): `workflow/.review-calls.jsonl`을 실제로 만든 뒤
  `git status --porcelain` 출력에 그 경로가 **나타나지 않음**을 단언한다.
  → 설계의 "D10 무영향" 주장을 추정이 아니라 실측으로 고정한다. gitignore가 빠지면 워킹트리가 dirty로
  보여 D10 FAIL로 전체 워크플로가 멈추므로, 이 오라클이 없으면 회귀가 조용히 통과한다.

### 정직성 — 이 phase에서 증명되지 않는 것

- **`main()` 배선의 종단 동작은 단위 테스트로 증명하지 않는다.** 실제 codex 호출이 필요하기 때문이다.
  단위 테스트는 `appendReviewCallLog`(순수 I/O)와 `policy_version` 파생까지 덮고, 배선(`main()`에서 올바른
  인자로 호출하는지)은 **리뷰어가 diff로 확인**한다. 이 REQ 자신의 design·phase 리뷰가 실제 호출이므로,
  병합 후 `workflow/.review-calls.jsonl`에 이 REQ의 행이 실제로 쌓였는지를 최종 보고에 포함한다.

Exit: eslint0·typecheck0 · 단위 그린 · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(unit·typecheck·lint) · 사용자 main 머지(별도 승인).
- 이 REQ는 additive다. **후속 REQ(A·B)를 기다리지 않고 단독 병합한다.**
