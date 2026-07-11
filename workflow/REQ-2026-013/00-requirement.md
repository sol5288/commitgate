# REQ-2026-013 요구사항

리뷰 codex 호출이 사용자 전역 프로필에 위임돼 느리고·토큰이 많고·결과가 수렴하지 않고·무응답/일시 오류에 통째 실패한다. 리뷰어 호출을 도구가 **명시적으로 통제**한다.

## 배경 — 다운스트림 2차 요청서

palm-backend가 CommitGate를 이식해 설계-전용 REQ 1건(문서 5개)을 4라운드 리뷰하며 관측한 실측치(`D:\Vue\palm-backend\claudedocs\commitgate-perf-request-2026-07-11.md`):

| 라운드 | 결과 | 소요 |
|---|---|---|
| 3차(resume) | NEEDS_FIX 9건 | ~11.5분 |
| 4차-a/-b | codex exit=1(빈 stderr) | 실패 |
| 4차-c(resume) | NEEDS_FIX 10건 | ~13.1분 |
| 직접 codex exec | 무응답 | ~75분(사용자 중단) |

findings가 수렴하지 않고 라운드마다 더 깊고 다른 지점으로 이동(11→9→9→10), 프롬프트 26KB.

## 근본 원인 (현재 코드에서 검증됨)

- **P1** 리뷰 codex 인자(`adapters.ts:145-147`)에 `-c model`·`-c model_reasoning_effort` override **없음** → 전역 `ultra` 상속.
- **P2** `SafeSpawnOptions`(`:20-25`)·`safeSpawnSync`(`:34-47`)에 **timeout 없음** → 무한 블로킹(75분).
- **P3** 실패 시 `res.stderr`만 읽고 `res.stdout` 버림(`:42-45`) → codex `--json` 오류가 stdout에 있어 **빈 오류**.
- **P4** `isResume = !opts.freshThread && codex_thread_id 존재`(`review-codex.ts:1182`) → 재리뷰 **기본 resume** → 이전 대화 누적, 수렴 대신 심화.

## 목표

1. 리뷰 codex 호출의 **모델·추론강도를 도구가 명시 고정**한다. 기본값 `gpt-5.6-terra` / `high`, `req.config.json`으로 override(`null`=전역 상속 탈출구).
2. codex 호출에 **timeout**을 걸어 무응답을 fail-closed로 끝낸다(기본 600s). **`killSignal='SIGKILL'`로 hard-kill**(무시 불가) — SIGTERM은 POSIX에서 자식이 무시하면 timeout 후에도 반환하지 않는다(실측·Node 계약).
3. 실패 시 codex JSONL의 **구조화된 오류 이벤트(`turn.failed`/`error`)를 추출**해 오류에 넣는다(빈-오류 제거). raw 덤프는 비밀 유출 위험이라 하지 않는다.
4. 재리뷰를 **stateless(새 스레드 + 현재 스냅샷)로 고정**한다. 직전 same-target NEEDS_FIX findings를 **bounded로 프롬프트에 주입**해 closure를 잃지 않는다.

## 비목표 (이번 REQ에서 하지 않음 — 각 후속 REQ)

- **resume opt-in.** 재리뷰 연속성이 필요할 때만 이전 스레드를 재개하는 opt-in은, 전역 `codex_thread_id`가 리뷰 대상(kind/phase)에 바인딩돼야 안전한데(안 그러면 design→phase-1 재개로 옛 컨텍스트 누적 재발) 이는 state 스키마 변경을 요한다. 이번 REQ는 **stateless 전용**으로 고정하고, target-binding을 갖춘 resume opt-in은 별도 REQ.
- **완전한 process-tree hard-kill.** SIGKILL은 **직접 자식(codex)** 을 확실히 죽인다(실측). codex가 파이프를 쥔 손자를 detach하는 병적 경로에선 POSIX `spawnSync`가 EOF를 더 기다릴 수 있다 — 완전 차단은 async spawn + process-group kill(동기 아키텍처 대개조)이라 후속. codex exec는 그런 손자를 detach하지 않음(phase 확인).
- **외부 bounded retry.** usage-limit·model-not-found까지 재호출하고 timeout과 곱해 비용 배증, retryable(network/5xx) 분류 계약 부재, codex provider에 이미 HTTP retry 존재. D6(원인 표면화)로 표본을 모은 뒤 "retryable 분류 + backoff/jitter"를 별도 REQ.
- **P5 컨텍스트 스코핑·P6 phase durability·P7 worktree 선검사.** 각 독립 REQ.
- **`--ignore-user-config`.** 전역 plugin/feature 상속을 끊는 codex 공식 확장점(관찰). `null` 상속 계약과의 상호작용 검토가 필요 — 후속 후보로 기록.

## 수용 기준

- 조립된 codex 인자(exec·resume 양쪽)에 `-c model="<reviewModel>"` `-c model_reasoning_effort="<reviewReasoningEffort>"`가 포함된다. 주입 `CodexRunner`로 실제 args를 캡처해 단언.
- 미설정 시 `gpt-5.6-terra`/`high` 해소. **명시적 `null`은 기본값으로 복귀하지 않는다**(`!== undefined` 병합) → 해당 `-c` 생략(전역 상속). 회귀 테스트로 고정.
- `reviewReasoningEffort`는 **enum**(`minimal|low|medium|high|xhigh`)이라 오타는 **config-load에서 거부**. `reviewModel`은 **slug 패턴**이라 따옴표·개행을 거부(TOML `model="…"` 주입 안전).
- `reviewTimeoutMs`(기본 600s) 초과 시 명확한 timeout 오류(`err.code==='ETIMEDOUT'` 기준)로 throw. **maxBuffer 초과(ENOBUFS)를 timeout으로 오인하지 않는다.** **SIGTERM을 무시하는 자식도 timeout에 종료**된다(SIGKILL) — 회귀 테스트.
- codex exit≠0 오류에 **구조화된 `turn.failed`/`error` 이벤트 메시지**가 포함된다(빈 오류 금지). `command_execution`/`aggregated_output` 등 비밀 운반 이벤트는 **제외**. fallback tail도 **byte 기준(Buffer.byteLength) 이중 상한**.
- 재리뷰가 **항상 새 스레드**다(`codex_thread_id`가 있어도 resume 안 함). `--fresh-thread`의 blocked-마커 회복은 보존. 직전 same-target NEEDS_FIX **findings가 bounded로 프롬프트에 주입**된다.
- **Phase 순서**: timeout → stdout → model-pin → stateless. model-pin 리뷰가 timeout·stdout 안전망 뒤에 온다(bootstrap 함정 해소).
- 새 config 키가 **두 스키마 축**(`CONFIG_SCHEMA` + `workflow/req.config.schema.json`)에 있고 `req-config.test.ts` 가드 통과. `req.config.json.sample`·README(KR/EN)·CHANGELOG에 신규 키·`null` 탈출구 문서화.
- `npm run typecheck`·`npm test`(vitest)·`npm run smoke` 그린. (저장소에 ESLint 없음 — exit 기준은 이 셋.)

## 조사 결과 — 코드 대조·실측으로 확정

- **spawnSync 실측**(Node20): `SIGTERM 무시 자식 + timeout` → SIGKILL이라야 종료·`err.code=ETIMEDOUT`. `maxBuffer 초과` → `err.code=ENOBUFS, signal=SIGKILL`. ∴ timeout 판별은 **ETIMEDOUT 기준**(초안의 `|| res.signal`은 ENOBUFS 오판).
- **`readPreviousResult`(`review-codex.ts:532-541`)는 `v.status` 한 단어만 반환** → stateless가 findings를 잃는다. bounded findings 주입으로 보완(목표 4).
- **어댑터는 config 없는 모듈-레벨 싱글턴**(`review-codex.ts:43`) → config를 `ReviewRequest` DTO로 엮는다.
- **`DEFAULTS` 중립성 원칙**(`config.ts:71-74`)과 `reviewModel="gpt-5.6-terra"`는 긴장 → 의도적 예외로 기록(리뷰어도 모델·enum 유효 확인).
- **config 스키마 두 축** + `req.config.json.sample`·README 2종 존재 → 신규 키는 이 전부를 거친다. `ResolvedConfig` 필드 추가 시 `req-commit.test.ts`의 `cfgStub`도 갱신해야 typecheck 통과.
