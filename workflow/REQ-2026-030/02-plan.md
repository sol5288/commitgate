# REQ-2026-030 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

> **오라클 원칙(REQ-2026-025 교훈)**: 오라클은 "필드가 있다"가 아니라 **"지우면/뒤집으면 실패한다"** 로 쓴다.

## Phase 1 — ISO 달력 검증 통일 (`phase-1-iso-calendar`)

범위: D1·D2. `req-commit.ts`의 ISO 검증 3곳(`approved_at`·`consumed_at`·`confirmed_at`)을
`isValidIsoInstant`로 교체 · orphan `ISO_RE` 제거.

변경 파일: `scripts/req/req-commit.ts` · `tests/unit/req-commit.test.ts`

### Oracle

- **O1-1 🔴 달력 불가능 값 거부 — 3 필드 전부**(R1·R4): `userConfirmProblem`에 `confirmed_at:'2026-99-99T99:99:99Z'`
  면 non-null(거부). `validateManifest`(또는 그 검증 함수)에 `approved_at`·`consumed_at`이 `2026-99-99...`면
  problems에 걸린다. → `ISO_RE.test`로 남겨두면 통과해 이 오라클이 실패(= 결함 재현). 13월·2월 30일도 거부.
- **O1-2 🔴 정상 ISO는 계속 통과 — 약화 없음**(R2): `...08Z`(밀리초 없음)·`...08.480Z`(밀리초 있음)가
  3 필드 모두에서 통과한다. → `isValidIsoInstant`가 밀리초 없는 값을 거부하면(잘못된 구현) 여기서 실패.
  기존 도구가 쓰는 `new Date().toISOString()` 형식이 계속 유효함을 고정.
- **O1-3 형식 위반 거부**(R4): `'not-a-date'`·시각 없는 `'2026-07-18'`·빈 문자열이 3 필드에서 거부된다.
  (기존 `ISO_RE`도 이건 거부했으므로 회귀 아님 — 통일 후에도 유지됨을 고정.)
- **O1-4 orphan 제거 확인**(R3): `ISO_RE`가 `req-commit.ts`에서 제거됐고, 테스트가 그것을 import하지 않는다.
  → grep으로 잔존 참조 0 확인. (정직성: 이건 "부재" 확인이라 리뷰어가 diff로 함께 본다.)

### 정직성 — 이 phase가 증명하지 않는 것

- **`isValidIsoInstant` 자체의 정확성**은 A-2a에서 이미 오라클로 고정됐다(REQ-2026-028 phase-1 O1-2·isValidIsoInstant
  describe). 이 REQ는 그 함수를 **재사용**하므로 재검증하지 않고, req-commit **적용부**만 본다.
- **전체 evidence 흐름 무회귀**는 전체 단위 테스트(finalize·doctor 관련)로 확인한다 — 이 phase 오라클은
  검증 함수의 입출력만 고정한다.

Exit: typecheck0 · 단위 그린 · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(unit·typecheck) · 사용자 main 반영(별도 승인).
- 이 repo에 lint 스크립트는 없다(게이트 = typecheck + vitest).
