# REQ-2026-013 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity**: phase 1개 ≤8파일 권고(초과 시 D18 WARN). 분할은 **vertical slice**로(config-only 분할 금지 — dead-config).
> **순서 근거(design R1)**: 로컬 `tsx`라 staged 구현이 자기 phase 리뷰에 즉시 적용된다. 안전망(timeout·stdout)을 model-pin **앞**에 둔다. 첫 slice의 자기-리뷰 부트스트랩은 사람 감시(--run 통제점, 행이면 Ctrl-C)가 회복 경로.
> **Exit 공통**: `typecheck0`(tsc) · `vitest` 그린 · `smoke` 그린 · Codex phase 리뷰 승인. (저장소에 **ESLint 없음** — `eslint0`는 쓰지 않는다.)

## Phase 1 — codex timeout (`phase-1-timeout`)
범위: P2 (설계 D1·D5·D11).
- config `reviewTimeoutMs`(integer ≥1000, 기본 **600000**, `??` 병합) — `config.ts` 다섯 지점 + `req.config.schema.json` + `req.config.json.sample` + README(KR/EN). `req-commit.test.ts` `cfgStub` 갱신.
- `adapters.ts`: `SafeSpawnOptions.timeoutMs?`. **`killSignal` 내부 고정 `'SIGKILL'`**(config 아님). `safeSpawnSync`가 `spawn.sync`에 timeout 전달 + 판별: `res.error?.code==='ETIMEDOUT'` → timeout 오류 · `res.error?.code==='ENOBUFS'` → 버퍼초과 오류(별도) · 그 외 exit≠0 → 기존. **`safeSpawnSync`는 범용 유지 — stdout 파싱 안 함**; 실패 시 원시 필드(`{status,signal,stdout,stderr}`)를 담은 오류 throw, 범용 메시지 = exit + byte-bounded stderr(stdout 미포함). `CodexRunner` `(args,input,cwd,opts?)` 확장, `defaultCodexRunner`·`review()` 배선.
- 테스트(실-spawn, `process.execPath`): SIGTERM-무시 자식+짧은 timeout → **ETIMEDOUT으로 반환**(POSIX CI에서 SIGKILL 종료 증명) · ENOBUFS 자식 → timeout 아님(구분 문구) · 자발적 signal 종료 → timeout 아님.
회귀 고정: `|| res.signal` 오판 방지 · 세 실패 유형 구분 문구 · git 경로 무영향.

## Phase 2 — 진단성: codex stdout 구조화 표면화 (`phase-2-stdout-surface`)
범위: P3 (설계 D6·D11). **retry 없음(D7).**
- `adapters.ts` **`defaultCodexRunner`(codex 경계)**: `safeSpawnSync`가 담아 throw한 `err.stdout`을 catch하여 JSONL 라인 파싱 → **allowlist**(`type ∈ {turn.failed,error,stream_error}`의 문자열 필드 `error.message`/`message`만) 직렬화. **미지·중첩·파싱실패·비-문자열 폐기.** **총량 상한: 최대 N 이벤트 + 총 UTF-8 byte ≤ 8KiB**(초과 시 단일 `[…N events elided]`). 허용 이벤트 0개 → raw stdout 미포함(exit + `[stdout 생략]`). stderr byte-bounded(≤8KiB). **범용 `safeSpawnSync`에는 JSONL 파싱 없음**(비-codex 명령 유출 방지).
- 테스트: `turn.failed{error.message}` → 표면화 · 미지 `{type:'x',message:'token=…'}` → 폐기 · **비-codex 명령(npm 흉내)이 `{type:'error'}` 출력 → codex 경로 안 탐(범용 stderr만)** · 수천 이벤트 → 총 byte·개수 상한+생략표식 · 다바이트 거대 message → byte 안전 절단.
회귀 고정: 빈-오류 제거 · allowlist 밖 유출 없음 · 비-codex 경로 미적용 · 총량 상한.
> 정확한 이벤트/필드명은 codex `--json` JSONL 계약 의존 — 구현 시 실측, 미스매치면 allowlist가 비어 안전 저하(생략).

## Phase 3 — 모델·추론강도 고정 (`phase-3-model-effort-pin`)
범위: P1 (설계 D1·D2·D2-1·D3·D4·D11). **안전망(P1·P2) 뒤 — 부트스트랩 함정 해소(D9).**
> **분할 예고(R3-obs)**: 이 phase는 config/schema/sample/README×2/adapters/review-codex/cfgStub + 테스트 3종으로 **8파일 초과(D18 WARN 예상)**. 구현 시 vertical slice로 분할 — 3a(`reviewModel` end-to-end: config·schema·sample·README·주입·테스트), 3b(`reviewReasoningEffort` end-to-end). 두 키의 `review()` 주입은 공유되므로 3a가 주입 골격을 세우고 3b가 두 번째 키를 얹는다(각 slice가 자기 키를 실제로 배선 — dead-config 아님).
- config `reviewModel`(`string|null`, slug 패턴)·`reviewReasoningEffort`(`{type:['string','null'], enum:[...5, null]}` — **null을 enum에 포함**, R2) — 다섯 지점 + 두 스키마 축 + sample + README. **두 키 `!== undefined` 병합**(null 보존). `req-commit.test.ts` `cfgStub` 갱신.
- `adapters.ts`: `ReviewRequest`에 `model`·`reasoningEffort`. `review()`가 non-null일 때 `-c model="…"`·`-c model_reasoning_effort="…"`를 exec·resume 양쪽 삽입(주입 안전=패턴/enum 제약, 주석 고정).
- `review-codex.ts`: `callReviewer` `ReviewRequest`에 `cfg.reviewModel`·`cfg.reviewReasoningEffort`.
- 테스트: (a) 주입 `CodexRunner` 실제 args에 `-c` 포함(exec·resume)·null이면 없음, (b) `FakeReviewerAdapter` 전파, (c) `req-config.test.ts` 두 축 동기화·기본값 해소, (d) **null이 기본값 복귀 안 함**, (e) enum 밖 → throw, (f) 패턴 위반(`a"b`·개행) → throw.
- **exec 검증**: 이 phase의 자기 리뷰가 `gpt-5.6-terra`로 성공 = exec effective 확인(별도 probe 불필요, D9).
회귀 고정: null override → `-c` 생략(전역 상속) · exec·resume 둘 다 · 오타/따옴표는 config-load 거부.

## Phase 4 — 재리뷰 stateless (`phase-4-stateless`)
범위: P4 (설계 D8·D11).
- `review-codex.ts`: `isResume=false`(항상 새 스레드). `codex_thread_id`는 계속 저장하되 resume에 안 씀. `--fresh-thread`의 `clearBlockedReview`·새 스레드 의미 보존. **resume opt-in·`--resume-thread` 없음**(비목표).
- **연속성 보완(승인 경계·원자성)**: 리뷰 검증 완료 시 `state.last_review`에 `{outcome, review_kind, phase_id}`와 함께 **검증된 findings의 bounded 스냅샷**(`[{severity, file, detail(절단)}...]` 실제 스키마 필드, 상위 N건·전체 byte 상한)을 **같은 write로** 기록. 재리뷰는 `last_review`가 `needs-fix` + 타깃 일치일 때만 **그 스냅샷**을 `previous_findings_to_close`에 주입(가변 `codex-response.json` 안 읽음 — desync 방지). 승인·불일치·부재 → 미주입(리셋). `readPreviousResult`(status) 대체.
- 테스트: 기본(thread_id 있어도) → resume 안 함 · `--fresh-thread` marker-clear가 실제 reviewer 호출까지 도달(순수+배선) · **last_review=needs-fix(same target) → 주입** · **last_review=approved → 미주입(승인 경계)** · 타깃 불일치 → 미주입 · 누적 없음.
- 문서: `CHANGELOG`에 stateless 전환·신규 키 요약. README에 재리뷰 동작 note.
회귀 고정: 기본 fresh 전환 · marker-clear 불변 · findings closure 전달.

## 완료
- 게이트 해당분(typecheck·vitest·smoke) 그린 · 문서(sample·README·CHANGELOG) · 사용자 main 머지(별도 승인).
- 후속(비목표): **resume opt-in(target-binding)** · **완전 process-tree hard-kill(async)** · **retry(retryable 분류+backoff)** · `--ignore-user-config` · P5·P6·P7 — 각 독립 REQ.
