# REQ-2026-013 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: 1→1a/1b)로 검수 면적을 줄인다.

## Phase 1 — 모델·추론강도 고정 (`phase-1-model-effort-pin`)
범위: P1 (설계 D1·D2·D2-1·D3·D4·D9).
- `config.ts`: `reviewModel`(`string|null`, slug 패턴 `^[A-Za-z0-9][A-Za-z0-9._-]*$`)·`reviewReasoningEffort`(enum `minimal|low|medium|high|xhigh`, `|null`)를 `RawConfig`·`ResolvedConfig`·`DEFAULTS`(gpt-5.6-terra/high)·`CONFIG_SCHEMA`·`merged` 다섯 지점에 추가. **두 키 모두 `!== undefined` 병합**(null 보존 — `??` 금지).
- `workflow/req.config.schema.json`: 같은 두 키(패턴·enum) 추가(동기화 — `req-config.test.ts` 가드).
- `adapters.ts`: `ReviewRequest`에 `model`·`reasoningEffort` 추가. `review()`가 non-null일 때 `-c model="…"`·`-c model_reasoning_effort="…"`를 **exec·resume 양쪽** args에 삽입(주입 안전은 패턴/enum 제약에 의존 — 주석 고정).
- `review-codex.ts`: `callReviewer`로 넘기는 `ReviewRequest`에 `cfg.reviewModel`·`cfg.reviewReasoningEffort` 채움.
- 테스트: (a) 주입 `CodexRunner`로 실제 args에 `-c model=`/`-c effort=` 포함(exec·resume)·null이면 없음, (b) `FakeReviewerAdapter.requests` 전파, (c) `req-config.test.ts`에 새 키 두 스키마 동기화·기본값 해소, (d) **`reviewModel:null`/`reviewReasoningEffort:null`이 기본값으로 복귀 안 함**, (e) enum 밖 effort → `loadConfig` throw, (f) reviewModel 패턴 위반(`a"b`·개행) → throw.
회귀 고정: null override는 `-c` 생략(전역 상속 복원) · exec와 resume 둘 다 주입 · 오타 effort는 config-load에서 거부.
Exit: eslint0·typecheck0 · 단위 그린 · Codex phase 리뷰 승인.

> Phase 1이 6~8파일 경계다. req:doctor D18 WARN이면 1a(config 키) / 1b(어댑터 주입·배선)로 분할.

## Phase 2 — codex timeout (`phase-2-timeout`)
범위: P2 (설계 D1·D5·D9).
- config `reviewTimeoutMs`(integer ≥1000, 기본 **600000**) 두 스키마 축, `??` 병합.
- `adapters.ts`: `SafeSpawnOptions`에 `timeoutMs?`·`killSignal?`(기본 SIGTERM). `safeSpawnSync`가 `spawn.sync`에 전달 + timeout 판별(`res.error.code==='ETIMEDOUT'` **또는** `res.signal`) → exit≠0과 구분되는 명확 오류 throw. `CodexRunner` 시그니처 `(args,input,cwd,opts?)` 확장, `defaultCodexRunner`가 timeout 전달. `review()`가 `req.timeoutMs` 전달.
- 테스트: `process.execPath`로 무한-루프 자식 + 짧은 timeout → timeout 오류 단언(실-spawn, 크로스플랫폼).
회귀 고정: timeout 오류가 generic exit≠0 메시지와 다른 문구 · git 경로 무영향 · cross-spawn이 timeout/killSignal 전달함 확인.
Exit: eslint0·typecheck0 · 단위 그린 · Codex phase 리뷰 승인.

## Phase 3 — 진단성: stdout 표면화 (`phase-3-stdout-surface`)
범위: P3 (설계 D6·D9). **retry 없음(D7 — 후속 REQ).**
- `adapters.ts` `safeSpawnSync`: 실패 오류에 `res.stdout`의 **마지막 20줄과 8KiB 중 더 짧은 쪽**을 stderr와 함께 포함.
- 테스트: exit=1+큰 stdout(긴 JSONL 한 줄 포함) 자식 → 오류에 stdout 꼬리, 줄 수·바이트 이중 상한 준수(둘 다 초과하는 입력으로 검증).
회귀 고정: 빈-오류 제거 · 거대 단일 라인이 바이트 상한으로 잘림.
Exit: eslint0·typecheck0 · 단위 그린 · Codex phase 리뷰 승인.

## Phase 4 — resume 기본 stateless (`phase-4-stateless-resume`)
범위: P4 (설계 D1·D8·D9).
- config `reviewResume`(boolean, 기본 false) 두 스키마 축, `??` 병합.
- `review-codex.ts`: `Opts`에 `--resume-thread`. `--resume-thread`+`--fresh-thread` 동시 → throw(fail-closed). `isResume = (opts.resumeThread || cfg.reviewResume) && !opts.freshThread && codex_thread_id 존재`. `--fresh-thread`의 `clearBlockedReview`·새 스레드 강제 의미 보존.
- 테스트: 기본(플래그·config 없음) → resume 안 함(thread_id 있어도) · `--resume-thread` → resume · `reviewResume:true` → resume · `--fresh-thread`가 resume opt-in을 이김 · `--resume-thread`+`--fresh-thread` → throw · `previous_codex_result`는 프롬프트에 여전히 실림.
회귀 고정: 기본 fresh 전환 · fresh-thread 회복 경로 불변 · 모순 인자 fail-closed.
Exit: eslint0·typecheck0 · 단위 그린 · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(unit·typecheck·lint) · smoke 그린 · 사용자 main 머지(별도 승인).
- 후속(비목표): **retry(retryable 분류 + backoff/jitter)** · P5 컨텍스트 스코핑 · P6 phase durability · P7 worktree 선검사 — 각 독립 REQ.
