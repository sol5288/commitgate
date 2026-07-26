# REQ-2026-064 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

## Phase 1 — 원장 하위호환 계약 (`phase-1-optional-keys`)

범위(설계 DEC-1·DEC-2): `scripts/req/lib/review-ledger.ts` + 테스트. 코드 2파일.
**아직 아무것도 기록하지 않는다** — 계약만 연다(행동 변화 최소).

순서:
1. `OPTIONAL_LEDGER_KEYS` 신설. 허용 = `LEDGER_KEYS ∪ OPTIONAL`, 필수 = `LEDGER_KEYS`만.
2. optional 키가 **있으면** 타입 검증(없으면 통과).
3. `serializeLedgerRow`가 `[...LEDGER_KEYS, ...OPTIONAL]` 순서로 쓰고 **값이 null이어도 키를 남긴다**.
4. 🔴 **회귀 테스트의 오라클 형태가 중요하다**: "옛 행"을 SUT(`serializeLedgerRow`)로 만들면
   tautology가 된다(REQ-2026-031의 교훈). **신규 키가 없는 행을 손으로 쓴 리터럴**로 고정하고,
   그것이 `ledgerRowProblems`를 **통과**하는지 단언한다.
5. optional 키가 있는데 타입이 틀리면 거부하는지, 알 수 없는 키는 여전히 거부하는지 확인.
6. `ledgerRowKey`(자연키)가 **변하지 않았는지** 단언 — 신규 키가 멱등 판정에 끼면 중복 행이 생긴다.

Exit: typecheck 0 · `npm test` green · 수용기준 1~3 충족 · Codex phase 리뷰 승인.

## Phase 2 — 모델·effort·provider 기록 (`phase-2-record`)

범위(설계 DEC-3~DEC-7): `scripts/req/review-codex.ts` · `scripts/req/req-reconstruct.ts` + 테스트. 코드 3파일.

순서:
1. 🔴 **값을 호출부에서 한 번 읽어** `attempt-opened`·`attempt-closed`·`.review-calls.jsonl`에
   **같은 값**으로 흘린다(DEC-5). 두 곳에서 각자 config를 읽으면 그 사이에 값이 바뀌었을 때 갈라진다.
2. 두 이벤트 **모두** 기록(DEC-6). opened만이면 "무엇이 승인했는가"가, closed만이면 판정 못 낸
   attempt의 모델이 사라진다.
3. `review_provider`는 현재 `'codex'` 상수(DEC-4) — 자리를 지금 만들어 둔다.
4. `req:reconstruct`가 만드는 행은 값을 모르므로 `null`로 직렬화한다(키는 존재 — DEC-7).
5. 테스트: 두 이벤트에 값이 들어가는지 · `.review-calls.jsonl`과 **같은 원천**인지(수용기준 5) ·
   재구성 행이 `null`로 기록되는지.

Exit: typecheck 0 · `npm test` green · 수용기준 4~5 충족 · Codex phase 리뷰 승인.

## Phase 3 — 문서 (`phase-3-docs`)

범위: `docs/workflow{,.en}.md`·`docs/guarantees{,.en}.md` 중 원장을 설명하는 곳 · `CHANGELOG.md`. 코드 변경 0.

순서:
1. 원장에 기록되는 값과 **그 값의 의미**(핀한 값이지 실제 실행 모델이 아님)를 적는다.
2. 하위호환 계약 3항을 적는다 — 다음에 키를 추가할 사람이 같은 함정을 밟지 않도록.
3. CHANGELOG: **앞 phase 구현을 커밋·파일·심볼 단위로** 가리킨다(docs-only phase 오탐 전례).
4. 🔴 **REQ-2026-060~063과 함께 릴리스한다**는 사실을 CHANGELOG에 적는다 —
   이 REQ가 그 릴리스의 **선행 조건**이다(모델 교체가 쉬워졌는데 감사 기록이 없는 창을 막는다).

Exit: `docs:lint` green · typecheck 0 · `npm test` green · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(unit·typecheck·docs:lint) · 사용자 main 통합(별도 승인).
- ✅ 이 REQ가 착륙하면 REQ-2026-060~063의 **릴리스 선행 조건이 해소**된다.
