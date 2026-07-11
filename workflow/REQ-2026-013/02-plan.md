# REQ-2026-013 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity**: phase 1개 ≤8파일 권고(초과 시 D18 WARN). 분할은 **vertical slice**로(config-only 분할 금지 — dead-config).
> **순서 근거(design R1)**: 로컬 `tsx`라 staged 구현이 자기 phase 리뷰에 즉시 적용된다. 안전망(timeout·stdout)을 model-pin **앞**에 둔다. 첫 slice의 자기-리뷰 부트스트랩은 사람 감시(--run 통제점, 행이면 Ctrl-C)가 회복 경로.
> **Exit 공통**: `typecheck0`(tsc) · `vitest` 그린 · `smoke` 그린 · Codex phase 리뷰 승인. (저장소에 **ESLint 없음** — `eslint0`는 쓰지 않는다.)

## Phase 1 — codex timeout (`phase-1-timeout`)
범위: P2 (설계 D1·D5·D11).
- config `reviewTimeoutMs`(integer ≥1000, 기본 **600000**, `??` 병합) — `config.ts` 다섯 지점 + `req.config.schema.json` + `req.config.json.sample` + README(KR/EN). `req-commit.test.ts` `cfgStub` 갱신.
- `adapters.ts`: `SafeSpawnOptions.timeoutMs?`. **`killSignal` 내부 고정 `'SIGKILL'`**(config 아님). `safeSpawnSync`가 `spawn.sync`에 timeout 전달 + 판별: `res.error?.code==='ETIMEDOUT'` → timeout 오류 · `res.error?.code==='ENOBUFS'` → 버퍼초과 오류(별도) · 그 외 exit≠0 → 기존. `CodexRunner` `(args,input,cwd,opts?)` 확장, `defaultCodexRunner`·`review()` 배선.
- 테스트(실-spawn, `process.execPath`): SIGTERM-무시 자식+짧은 timeout → **ETIMEDOUT으로 반환**(POSIX CI에서 SIGKILL 종료 증명) · ENOBUFS 자식 → timeout 아님(구분 문구) · 자발적 signal 종료 → timeout 아님.
회귀 고정: `|| res.signal` 오판 방지 · 세 실패 유형 구분 문구 · git 경로 무영향.

## Phase 2 — 진단성: 구조화 stdout 표면화 (`phase-2-stdout-surface`)
범위: P3 (설계 D6·D11). **retry 없음(D7).**
- `adapters.ts` `safeSpawnSync`: 실패 시 stdout JSONL 파싱 → 구조화 오류 이벤트(`type ∈ {turn.failed,error,stream_error}`) message 추출·표면화. `command_execution`/`aggregated_output`/`agent_message`/`reasoning` 등 비밀 운반 이벤트 **제외**. 구조화 없으면 비-비밀 라인의 **byte 기준(Buffer.byteLength ≤ 8KiB) 꼬리** + `[unstructured]` 표식. stderr 계속 포함.
- 테스트(실-spawn): `turn.failed` 이벤트 자식 → 그 message 표면화 · `command_execution`만 있는 자식 → 제외되고 안전 fallback · 다바이트 거대 라인 → byte 상한 준수(문자열 slice 아님).
회귀 고정: 빈-오류 제거 · aggregated_output이 오류 메시지에 안 샘 · byte 상한.
> 정확한 이벤트/필드명은 codex `--json` JSONL 계약에 의존 — 구현 시 실측 확인, 미스매치면 fallback으로 안전 저하.

## Phase 3 — 모델·추론강도 고정 (`phase-3-model-effort-pin`)
범위: P1 (설계 D1·D2·D2-1·D3·D4·D11). **안전망(P1·P2) 뒤 — 부트스트랩 함정 해소(D9).**
- config `reviewModel`(`string|null`, slug 패턴)·`reviewReasoningEffort`(enum, `|null`) — 다섯 지점 + 두 스키마 축 + sample + README. **두 키 `!== undefined` 병합**(null 보존). `req-commit.test.ts` `cfgStub` 갱신.
- `adapters.ts`: `ReviewRequest`에 `model`·`reasoningEffort`. `review()`가 non-null일 때 `-c model="…"`·`-c model_reasoning_effort="…"`를 exec·resume 양쪽 삽입(주입 안전=패턴/enum 제약, 주석 고정).
- `review-codex.ts`: `callReviewer` `ReviewRequest`에 `cfg.reviewModel`·`cfg.reviewReasoningEffort`.
- 테스트: (a) 주입 `CodexRunner` 실제 args에 `-c` 포함(exec·resume)·null이면 없음, (b) `FakeReviewerAdapter` 전파, (c) `req-config.test.ts` 두 축 동기화·기본값 해소, (d) **null이 기본값 복귀 안 함**, (e) enum 밖 → throw, (f) 패턴 위반(`a"b`·개행) → throw.
- **exec 검증**: 이 phase의 자기 리뷰가 `gpt-5.6-terra`로 성공 = exec effective 확인(별도 probe 불필요, D9).
회귀 고정: null override → `-c` 생략(전역 상속) · exec·resume 둘 다 · 오타/따옴표는 config-load 거부.

## Phase 4 — 재리뷰 stateless (`phase-4-stateless`)
범위: P4 (설계 D8·D11).
- `review-codex.ts`: `isResume=false`(항상 새 스레드). `codex_thread_id`는 계속 저장하되 resume에 안 씀. `--fresh-thread`의 `clearBlockedReview`·새 스레드 의미 보존. **resume opt-in·`--resume-thread` 없음**(비목표).
- **연속성 보완**: 직전 same-target NEEDS_FIX 아카이브 findings를 bounded(상위 N건 title/summary, ≤byte)로 프롬프트 `previous_findings_to_close` 블록에 주입. `readPreviousResult`(status 한 단어) 대체/보강.
- 테스트: 기본(플래그·config 없음, thread_id 있어도) → resume 안 함 · `--fresh-thread` marker-clear가 실제 reviewer 호출까지 도달(순수+배선) · findings 주입(직전 NEEDS_FIX 아카이브 존재 시) · 누적 없음(단일 타깃 스냅샷).
- 문서: `CHANGELOG`에 stateless 전환·신규 키 요약. README에 재리뷰 동작 note.
회귀 고정: 기본 fresh 전환 · marker-clear 불변 · findings closure 전달.

## 완료
- 게이트 해당분(typecheck·vitest·smoke) 그린 · 문서(sample·README·CHANGELOG) · 사용자 main 머지(별도 승인).
- 후속(비목표): **resume opt-in(target-binding)** · **완전 process-tree hard-kill(async)** · **retry(retryable 분류+backoff)** · `--ignore-user-config` · P5·P6·P7 — 각 독립 REQ.
