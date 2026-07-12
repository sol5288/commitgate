# REQ-2026-013 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity**: phase 1개 ≤8파일 권고(초과 시 D18 WARN). 분할은 **vertical slice**로(config-only 분할 금지 — dead-config).
> **순서 근거(design R1)**: 로컬 `tsx`라 staged 구현이 자기 phase 리뷰에 즉시 적용된다. 안전망(timeout·stdout)을 model-pin **앞**에 둔다. 첫 slice의 자기-리뷰 부트스트랩은 사람 감시(--run 통제점, 행이면 Ctrl-C)가 회복 경로.
> **Exit 공통**: `typecheck0`(tsc) · `vitest` 그린 · `smoke` 그린 · Codex phase 리뷰 승인. (저장소에 **ESLint 없음** — `eslint0`는 쓰지 않는다.)

## Phase 1 — codex timeout (`phase-1-timeout`)
범위: P2 (설계 D1·D5·D11).
- config `reviewTimeoutMs`(integer ≥1000, 기본 **600000**, `??` 병합) — `config.ts` 다섯 지점 + `req.config.schema.json`(두 스키마 축). `req-commit.test.ts` `cfgStub` 갱신. (sample·README 문서는 **Phase 5**.)
- `adapters.ts`: `SafeSpawnOptions.timeoutMs?`. **`killSignal` 내부 고정 `'SIGKILL'`**(config 아님). `safeSpawnSync`가 `spawn.sync`에 timeout 전달 + 판별: `res.error?.code==='ETIMEDOUT'` → timeout 오류 · `res.error?.code==='ENOBUFS'` → 버퍼초과 오류(별도) · 그 외 exit≠0 → 기존. **`safeSpawnSync`는 범용 유지 — stdout JSONL 파싱 안 함**; 실패 시 **분류 태그 + 원시 필드**(`{kind:'timeout'|'buffer-overflow'|'exit', status,signal,stdout,stderr}`)를 담은 오류 throw, **범용 메시지 = exit + `redactSecrets(stderr)`(byte-bounded)** — redaction은 범용 비밀-마스킹(순수 유틸)이라 여기서 적용해 npm/pnpm 진단 유지+마스킹(감사 개선; R8의 "exit만"은 진단 손실). stdout은 error 객체 fields로만(임의 명령 stdout 미포함). `CodexRunner` `(args,input,cwd,opts?)` 확장, `defaultCodexRunner`·`review()` 배선. (`kind`·원시 필드는 Phase 2가 분류 보존·redaction에 사용.)
- **end-to-end 배선(R11 — 필수)**: `ReviewRequest.timeoutMs` 추가 + `review-codex.ts`의 `callReviewer`가 `cfg.reviewTimeoutMs`를 `ReviewRequest`에 채움 + `review()`가 runner에 전달. 이게 없으면 `{reviewTimeoutMs:1000}` 설정이 runner까지 안 가고 기본값만 쓴다. 회귀: **default·override 각각에서 runner가 받는 timeoutMs 캡처**(config값이 실제 호출까지 도달).
- 테스트(실-spawn, `process.execPath`): SIGTERM-무시 자식+짧은 timeout → **ETIMEDOUT으로 반환**(POSIX CI에서 SIGKILL 종료 증명) · ENOBUFS 자식 → timeout 아님(구분 문구) · 자발적 signal 종료 → timeout 아님.
회귀 고정: `|| res.signal` 오판 방지 · 세 실패 유형 구분 문구 · git 경로 무영향.

## Phase 2 — 진단성: codex stdout 구조화 표면화 (`phase-2-stdout-surface`)
범위: P3 (설계 D6·D11). **retry 없음(D7).**
- `adapters.ts` **`defaultCodexRunner`(codex 경계)**: `safeSpawnSync`가 담아 throw한 오류를 catch. **분류 보존(R5·R8)**: stderr는 이미 `safeSpawnSync`가 범용 redaction함(감사). `defaultCodexRunner`는 kind·문구 보존하고 `'exit'`일 때만 추가로 `err.stdout` JSONL 파싱·추출(추출 메시지도 redaction); timeout/overflow는 추출 없이 redacted-stderr 메시지 사용. **allowlist(실측 고정)**: `{type:'error'}→message`·`{type:'turn.failed'}→error.message`·`{type:'item.completed', item.type==='error'}→item.message` 3형의 문자열만. **미지 event·비-error item·중첩·파싱실패·비-문자열 폐기.** **총량 상한: 최대 N 이벤트 + 총 UTF-8 byte ≤ 8KiB**(초과 시 단일 `[…N events elided]`). 허용 이벤트 0개: **stdout 비어있음 → `[구조화 오류 없음]`; stdout 있는데 0건 → 원문 생략 + `[codex 진단: 인식 못한 형태 — 계약 변경/버전 불일치 가능]` 표면화**(R7 — 정적 fixture가 못 잡는 live drift 탐지). **추출 메시지·stderr 모두 best-effort redaction + byte 상한(≤4KiB)** — **JS 정규식**(`(?i)` 금지·`gi` 플래그, R6), **Bearer는 공백 뒤 토큰까지 소비**. **범용 `safeSpawnSync`에는 JSONL 파싱 없음**(비-codex 명령 유출 방지).
- 테스트(캡처 fixture 기반): 3형 오류(`error`·`turn.failed`·`item.completed:error`) → 표면화 · `item.completed{command_execution, aggregated_output:'token=…'}` → 폐기 · **`err.kind==='timeout'`(stderr에 `Bearer x.y.z`) → JSONL 안 붙되 timeout 문구 보존 + stderr redaction(토큰 마스킹)** · 비-codex 명령의 `{type:'error'}` → codex 경로 안 탐 · 수천 이벤트 → 총 상한+생략 · 추출/stderr redaction: `token=…`·**`Authorization: Bearer x.y.z`(뒤 토큰까지 마스킹)**·`sk-…` → 각 마스킹 후 byte 절단.
회귀 고정: 빈-오류 제거 · **timeout/overflow/exit 분류 보존** · allowlist 밖 유출 없음 · 비-codex 미적용 · 총량 상한 · **stdout 있으나 허용 이벤트 0건 → 불일치 진단(빈 stdout과 구분, 원문 미노출)**.
> event type/필드는 **실측 캡처를 fixture로 고정**(파서 회귀). fixture는 파서만 검증하지 **live 계약 drift는 못 잡는다**(R7) — drift는 **런타임 불일치 진단**(stdout 있으나 허용 이벤트 0건 → "인식 못한 형태·버전 불일치 가능" 표면화, 원문 생략)이 드러냄. 지원 codex 버전 기록.

## Phase 3 — 모델·추론강도 고정 (`phase-3-model-effort-pin`)
범위: P1 (설계 D1·D2·D2-1·D3·D4·D11). **안전망(P1·P2) 뒤 — 부트스트랩 함정 해소(D9).**
> **granularity 해소(R6-obs)**: 문서(sample·README×2·CHANGELOG)를 **최종 Phase 5로 분리**해 이 phase를 코드+config로 좁힌다 — `config.ts`·`req.config.schema.json`·`adapters.ts`·`review-codex.ts`·`req-commit.test.ts`(cfgStub)·`adapters.test.ts`·`req-config.test.ts` = **7파일(≤8)**. 두 키(reviewModel·reasoningEffort)는 `review()` 주입·`ReviewRequest`를 공유하므로 함께 배선하는 편이 자연스럽다(억지 3a/3b 분할은 공유 config/schema 때문에 파일 수를 못 줄임). 초과 시에만 런타임 분할.
- config `reviewModel`(`string|null`, slug 패턴)·`reviewReasoningEffort`(`{type:['string','null'], enum:[...5, null]}` — **null을 enum에 포함**, R2) — 다섯 지점 + 두 스키마 축. **두 키 `!== undefined` 병합**(null 보존). `req-commit.test.ts` `cfgStub` 갱신. (sample·README 문서는 **Phase 5**.)
- `adapters.ts`: `ReviewRequest`에 `model`·`reasoningEffort`. `review()`가 non-null일 때 `-c model="…"`·`-c model_reasoning_effort="…"`를 exec·resume 양쪽 삽입(주입 안전=패턴/enum 제약, 주석 고정).
- `review-codex.ts`: `callReviewer` `ReviewRequest`에 `cfg.reviewModel`·`cfg.reviewReasoningEffort`.
- 테스트: (a) 주입 `CodexRunner` 실제 args에 `-c` 포함(exec·resume)·null이면 없음, (b) `FakeReviewerAdapter` 전파, (c) `req-config.test.ts` 두 축 동기화·기본값 해소, (d) **null이 기본값 복귀 안 함**, (e) enum 밖 → throw, (f) 패턴 위반(`a"b`·개행) → throw.
- **override 존중 검증(D9, R9 정정)**: 자기-리뷰 성공은 "override 적용"과 "무시하고 ultra 상속"을 구분 못 하고, Phase 1·2가 남긴 `codex_thread_id` 때문에 일반 실행은 resume 경로다. 그래서 **bogus-model live 검증**을 수동/smoke 1회로 수행 — `-c model="__bogus__"` on **exec(--fresh-thread)와 resume 각각** → codex가 "Model … not found"(존중 증명). exec는 R5 캡처가 이미 증명, resume는 여기서 확인. arg-캡처 단위 테스트(도구가 인자 넘김) + 이 live 검증(codex가 존중)을 함께 수용기준에.
회귀 고정: null override → `-c` 생략(전역 상속) · exec·resume 둘 다 · 오타/따옴표는 config-load 거부.

## Phase 4 — 재리뷰 stateless (`phase-4-stateless`)
범위: P4 (설계 D8·D11).
- `review-codex.ts`: `isResume=false`(항상 새 스레드). `codex_thread_id`는 계속 저장하되 resume에 안 씀. `--fresh-thread`의 `clearBlockedReview`·새 스레드 의미 보존. **resume opt-in·`--resume-thread` 없음**(비목표).
- **연속성 보완(승인 경계·desync 제거)**: 리뷰 검증 완료 시 `state.last_review`에 `{outcome, review_kind, phase_id}`와 함께 **검증된 findings 스냅샷**(`findings:[{severity, file, detail}]` 실제 스키마 필드, **최대 10건·각 detail ≤300B·총 ≤4KiB** + **별도 정수 `elided_count`**(R8); 초과분 버리고 `elided_count`에 개수)을 **같은 `writeState`로** 기록. **기존 marker 필드(`compare_hash`·`count`·`errors`·`at`·kind·phase·outcome)는 보존하고 findings·elided_count만 additive로 추가**(R10 — 교체하면 `req:next` G2가 `compare_hash` 소실로 동일 대상을 재호출). 렌더 시 `elided_count>0`이면 `(+N more elided)` 덧붙임.
- **무조건 `previous_codex_result` 라인 제거(R12)**: `readPreviousResult(ticketDir)`(대상 무관 `codex-response.json` status)를 `previous_codex_result`에 넣던 `:110` 라인을 제거하고, 연속성은 **same-target 게이팅된 `previous_findings_to_close`뿐**이게. 안 그러면 phase 불일치여도 `previous_codex_result: NEEDS_FIX`가 새 프롬프트에 남아 대상 간 오염. 재리뷰는 `last_review`가 `needs-fix` + 타깃 일치일 때만 **그 스냅샷**을 `previous_findings_to_close`에 주입(가변 `codex-response.json` 안 읽음). 승인·불일치·부재 → 미주입. `readPreviousResult`(status) 대체. (state.json crash-durability(temp+rename)는 기존 이슈 — 별도 REQ; 이번엔 selector/body desync만 제거.)
- **read 시점 검증(R5)**: 주입 전 selector + 모든 finding 필드(severity∈{P1,P2,P3}·file string|null·detail string·건수/byte 상한) + **`elided_count` 정수≥0** 재검증, **하나라도 불일치·비정상·초과면 전체 미주입**(예외 아닌 조용한 skip — fail-closed).
- 테스트: 기본(thread_id 있어도) → resume 안 함 · `--fresh-thread` marker-clear가 실제 reviewer 호출까지 도달(순수+배선) · **last_review=needs-fix(same target) → 주입** · **last_review=approved → 미주입(승인 경계)** · 타깃 불일치 → 미주입 · **오염된 스냅샷(비-문자열 detail·표식이 findings 안) → 전체 미주입(read 검증)** · **초과 스냅샷(10건+elided_count>0) → 10건 주입 + `(+N more elided)` 렌더** · **`req:next` G2 호환: NEEDS_FIX 재호출 차단(compare_hash)·invalid 반복 차단(count/errors)·approved 동작 불변** · **직전 결과가 다른 kind/phase → 프롬프트에 status·findings 어느 것도 미전달(교차-대상 오염 차단)** · 누적 없음.
회귀 고정: 기본 fresh 전환 · marker-clear 불변 · findings closure 전달.

## Phase 5 — 문서 (`phase-5-docs`)
범위: 사용자 대면 문서(설계 D10). 코드 phase(1~4)에서 분리해 검토 단위를 좁힘(R6-obs).
- `req.config.json.sample`: 신규 키 3종(`reviewModel`·`reviewReasoningEffort`·`reviewTimeoutMs`)과 **`null` 탈출구**(전역 상속) 주석.
- `README.md`·`README.en.md`: config 표에 3종 + 기본값(gpt-5.6-terra/high/600s) + `null` override + 재리뷰 **stateless** 동작 + timeout 조정 안내.
- `CHANGELOG`: 리뷰어 호출 고정·timeout·stdout 진단·stateless 전환 요약.
- 테스트: `package-payload`/`init` 계열이 sample·README 배포 축을 이미 가드하는지 확인(신규 키 존재는 문서라 단위 테스트 대상 아님 — smoke/설치 축으로 충분).
회귀 고정: sample·README에 3종 키·null 탈출구 문서화.

## 완료
- 게이트 해당분(typecheck·vitest·smoke) 그린 · 문서(sample·README·CHANGELOG) · 사용자 main 머지(별도 승인).
- 후속(비목표): **resume opt-in(target-binding)** · **완전 process-tree hard-kill(async)** · **retry(retryable 분류+backoff)** · `--ignore-user-config` · P5·P6·P7 — 각 독립 REQ.
