# REQ-2026-013 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **범위(R14 후)**: P1(모델·추론강도 고정) + P4(재리뷰 stateless)만. P2(timeout)·P3(오류 진단)은 후속 REQ.
> **Granularity**: phase ≤8파일(문서 Phase 3 분리). 초과 시 vertical slice(config-only 분할 금지 — dead-config).
> **Exit 공통**: `typecheck0`(tsc) · `vitest` 그린 · `smoke` 그린 · Codex phase 리뷰 승인. (저장소에 **ESLint 없음** — `eslint0` 안 씀.)
> **부트스트라핑**: 로컬 `tsx`라 staged 구현이 자기 phase 리뷰에 즉시 적용된다. 이번 REQ엔 timeout 안전망이 없으므로 model-pin 리뷰가 행이면 **사람 감시(--run 통제점·Ctrl-C)** 가 회복 경로.

## Phase 1 — 모델·추론강도 고정 (`phase-1-model-effort-pin`)
범위: P1 (설계 D1·D2·D2-1·D3·D4·D9).
- `config.ts`: `reviewModel`(`string|null`, slug 패턴)·`reviewReasoningEffort`(`{type:['string','null'], enum:['none','minimal','low','medium','high','xhigh', null]}` — **`none` 포함(실측 R15)·null 포함**)를 `RawConfig`·`ResolvedConfig`·`DEFAULTS`(gpt-5.6-terra/high)·`CONFIG_SCHEMA`·`merged` 다섯 지점. **두 키 `!== undefined` 병합**(null 보존). `req.config.schema.json` 동기화. `req-commit.test.ts` `cfgStub` 갱신.
- `adapters.ts`: `ReviewRequest`에 `model`·`reasoningEffort`. `review()`가 non-null일 때 `-c model="…"`·`-c model_reasoning_effort="…"`를 **exec·resume 양쪽** args에 삽입(주입 안전=패턴/enum 제약, 주석 고정).
- `review-codex.ts`: `callReviewer` `ReviewRequest`에 `cfg.reviewModel`·`cfg.reviewReasoningEffort`.
- 테스트: (a) 주입 `CodexRunner` 실제 args에 `-c` 포함(exec·resume)·null이면 없음, (b) `FakeReviewerAdapter` 전파, (c) `req-config.test.ts` 두 축 동기화·기본값 해소·**null 복귀 안 함**·enum 밖 throw·패턴 위반 throw.
- **override 존중(수동/smoke, model·effort 각각)**: `-c model="__bogus__"`→"Model not found"; 유효 모델 + `-c model_reasoning_effort="__bogus__"`→`[reasoning.effort] invalid_enum_value` 거부(effort 존중=P1 핵심). **exec(--fresh-thread)·resume(prior thread_id) 각각**. 둘 다 R5·R15 캡처로 실측.
회귀 고정: null override → `-c` 생략(전역 상속) · exec·resume 둘 다 · 오타/따옴표 config-load 거부.
문서(sample·README)는 **Phase 3**.

## Phase 2 — 재리뷰 stateless (`phase-2-stateless`)
범위: P4 (설계 D5·D6·D9).
- `review-codex.ts`: `isResume=false`(항상 새 스레드). `codex_thread_id`는 계속 저장하되 resume에 안 씀. `--fresh-thread`의 `clearBlockedReview`·새 스레드 의미 보존. **resume opt-in·`--resume-thread` 없음**.
- **무조건 `previous_codex_result` 라인 제거**(대상 무관 status → 오염). 연속성은 same-target 게이팅 스냅샷뿐.
- **findings 스냅샷**(D6): `recordLastReviewMarker`(`:434`)에서 **기존 marker(compare_hash·count·errors·at·kind·phase·outcome) 보존한 채** `findings:[{severity,file,detail}]`(최대 10건·각 ≤300B·총 ≤4KiB) + 정수 `elided_count`를 **additive로 같은 write에** 추가. 주입은 `last_review`가 needs-fix + 타깃 일치일 때만 `previous_findings_to_close`에(승인·불일치·부재 → 미주입). **read 시점 검증**: selector + 모든 finding 필드 + `elided_count≥0` 재검증, 하나라도 불일치·비정상·초과면 전체 미주입(fail-closed).
- 테스트: 기본(thread_id 있어도) → resume 안 함 · `--fresh-thread` marker-clear 배선 도달 · needs-fix(same target) → 주입 · approved → 미주입 · **다른 kind/phase → status·findings 미전달** · 초과 스냅샷(10건+elided_count>0) → 10건 주입+`(+N more elided)` · 오염 스냅샷 → 전체 미주입 · **`req:next` G2 불변**(compare_hash 재호출 차단·invalid 반복 차단·approved).
회귀 고정: 기본 fresh 전환 · 오염 미전달 · G2 불변.

## Phase 3 — 문서 (`phase-3-docs`)
범위: 사용자 문서(설계 D8).
- `req.config.json.sample`: 신규 키 2종 + `null` 탈출구 주석.
- `README.md`·`README.en.md`: config 표에 2종 + 기본값(gpt-5.6-terra/high) + `null` override + 재리뷰 **stateless** 동작.
- `CHANGELOG`: 리뷰어 모델·추론강도 고정 + stateless 요약. (P2 timeout·P3 진단은 후속 REQ임을 명시.)
회귀 고정: sample·README에 2종 키·null 탈출구 문서화.

## 완료
- 게이트 해당분(typecheck·vitest·smoke) 그린 · 문서 · 사용자 main 머지(별도 승인).
- 후속(비목표): **P2 timeout(Windows 프로세스-트리 kill)** · **P3 오류 진단(비밀-안전 추출)** — R1~R14 설계 이력이 출발점 · resume opt-in · retry · P5·P6·P7 — 각 독립 REQ.
