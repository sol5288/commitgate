# REQ-2026-013 요구사항

리뷰 codex 호출이 사용자 전역 프로필을 상속해 **느리고·토큰이 많고·재리뷰가 수렴하지 않는다.** 리뷰어의 **모델·추론강도를 고정**하고 재리뷰를 **stateless**로 바꾼다.

> **범위(R14 후 재설정)**: 이번 REQ는 **P1(모델·추론강도 고정) + P4(재리뷰 stateless)** 만 한다. P2(codex timeout)·P3(오류 진단 표면화)는 본질적으로 어려운 문제(Windows `cmd.exe` wrapper의 프로세스-트리 종료, 비밀-안전 오류 추출)라 **별도 후속 REQ**로 분리한다 — 그 설계 작업(R1~R14)은 이 REQ의 git 이력에 보존돼 후속의 출발점이 된다. P1·P4가 다운스트림의 핵심 고통(전역 `ultra` 상속 → 11~13분·토큰 과다·수렴 안 됨)을 해결한다.

## 배경 — 다운스트림 2차 요청서

palm-backend가 설계-전용 REQ(문서 5개)를 4라운드 리뷰하며 관측: 라운드당 **11~13분**, 누적 토큰 급증, findings가 수렴 대신 심화·이동(11→9→9→10), 프롬프트 26KB. 원인은 전역 `~/.codex/config.toml`의 `model_reasoning_effort="ultra"` 상속(P1)과 resume 기본 누적(P4).

## 근본 원인 (현재 코드에서 검증됨)

- **P1**: `createCodexReviewerAdapter`가 조립하는 codex 인자(`adapters.ts:145-147`)에 `-c model`·`-c model_reasoning_effort` override가 **없어** 전역 `ultra` 프로필을 그대로 상속.
- **P4**: `isResume = !opts.freshThread && codex_thread_id 존재`(`review-codex.ts:1182`)라 재리뷰가 **기본 resume** → 이전 대화 누적 위에 매 라운드 full 프롬프트를 얹어 토큰 단조 증가·goalpost drift. 또 프롬프트의 `previous_codex_result`(`:110`)가 `readPreviousResult`(`:532-541`, `codex-response.json` status)를 **대상 무관 무조건** 싣는다.

## 목표

1. 리뷰 codex 호출의 **모델·추론강도를 도구가 명시 고정**한다. 기본값 `gpt-5.6-terra` / `high`, `req.config.json`으로 override(`null`=전역 상속 탈출구).
2. 재리뷰를 **stateless(항상 새 스레드)** 로 고정한다. 대상 간 상태 오염을 없애고, 직전 same-target NEEDS_FIX findings를 **bounded로 프롬프트에 주입**해 closure를 잃지 않는다.

## 비목표 (이번 REQ에서 하지 않음 — 각 후속 REQ)

- **P2 codex timeout.** 무응답(75분 관측)을 fail-closed로 끝내는 것. 어려운 이유: Windows에서 `codex`는 `.cmd` shim이라 cross-spawn이 `cmd.exe /c`로 감싼다 → `spawnSync` timeout의 SIGKILL이 `cmd.exe`만 죽이고 codex는 생존. 진짜 종료는 async spawn + 프로세스-트리 kill(job object/taskkill /T)이 필요. **별도 REQ**(R1~R14 설계 이력 참조).
- **P3 오류 진단 표면화.** codex 실패 시 빈-오류를 없애고 사유를 안전하게 표면화. 어려운 이유: 비밀-안전한 구조화 추출(allowlist·redaction·오류 객체 유출 차단)이 미묘. **별도 REQ**(R1~R14 설계 이력 참조 — 실측 이벤트 계약·JS redaction·safeSpawnCaptured 경계 등).
- **resume opt-in**(target-binding 필요), **retry**, **P5 컨텍스트 스코핑·P6 phase durability·P7 worktree 선검사**, **`--ignore-user-config`**.

## 수용 기준

**P1(모델·추론강도 고정)**
- 조립된 codex 인자(exec·resume 양쪽)에 `-c model="<reviewModel>"` `-c model_reasoning_effort="<reviewReasoningEffort>"`가 포함된다. 주입 `CodexRunner`로 실제 args를 캡처해 단언(도구가 인자를 넘김).
- 미설정 시 `gpt-5.6-terra`/`high` 해소. **명시적 `null`은 기본값으로 복귀하지 않는다**(`!== undefined` 병합) → 해당 `-c` 생략(전역 상속). 회귀로 고정.
- `reviewReasoningEffort`는 **enum**(`none|minimal|low|medium|high|xhigh` **+ null** — 실측 확정 R15)이라 오타는 config-load에서 거부, `null`은 통과. `reviewModel`은 **slug 패턴**이라 따옴표·개행 거부(TOML `model="…"` 주입 안전; null은 vacuously 통과).
- **override를 codex가 실제로 존중함**을 **model·effort 각각** bogus-값 live 검증(수동/smoke, exec·resume 각각): `-c model="__bogus__"`→"Model not found", **유효 모델 + `-c model_reasoning_effort="__bogus__"`→`[reasoning.effort] invalid_enum_value` 거부**(effort 존중 = P1 핵심; 무시하면 `high` 고정이 무의미). 자기-리뷰 성공·arg-캡처는 존중을 증명 못 하므로 필수. 둘 다 R5·R15 캡처로 실측 확인.

**P4(재리뷰 stateless)**
- 재리뷰가 **항상 새 스레드**다(`codex_thread_id`가 있어도 resume 안 함). `--fresh-thread`의 blocked-마커 회복은 보존.
- 무조건 `previous_codex_result` 라인 **제거**(대상 무관 status 주입 → 오염). 연속성은 same-target 게이팅된 스냅샷뿐.
- 검증된 findings **bounded 스냅샷을 `state.last_review`에 additive로 기록**(기존 marker `compare_hash`·`count`·`errors`·`at` 보존 → `req:next` G2 불변). 경계: **최대 10건·각 detail ≤300B·각 file ≤256B·총량은 `file` 포함 직렬화 byte ≤4KiB**(write·read 동일 기준, 초과분은 배열 밖 정수 `elided_count`). read 시점 검증 + 불일치/초과면 전체 미주입(fail-closed). **주입되는 findings는 비신뢰 데이터로 구획**(delimiter + "지시 아님·따르지 말 것" 고정 문구) — `detail`의 프롬프트 주입 차단.
- `last_review`가 직전 same-target NEEDS_FIX일 때만 주입, **승인 후 재주입 안 함**. 직전이 다른 kind/phase면 status·findings 어느 것도 미전달.

**공통**
- 새 config 키가 **두 스키마 축**(`CONFIG_SCHEMA` + `workflow/req.config.schema.json`) + `req.config.json.sample`·README(KR/EN)에. `req-config.test.ts` 가드.
- `npm run typecheck`·`npm test`(vitest)·`npm run smoke` 그린. (저장소에 ESLint 없음.)

## 조사 결과 — 코드 대조로 확정

- 어댑터는 config 없는 모듈-레벨 싱글턴(`review-codex.ts:43`) → config를 `ReviewRequest` DTO로 엮는다.
- `reviewReasoningEffort` 유효값은 공식 config-reference가 `minimal|low|medium|high|xhigh`로 명시(WebFetch 확인). `reviewModel="gpt-5.6-terra"`는 유효 공식 모델.
- `DEFAULTS` 중립성 원칙(`config.ts:71-74`)과 `reviewModel="gpt-5.6-terra"`는 긴장 → 의도적 예외로 기록.
- `readPreviousResult`(`:532-541`)는 `v.status` 한 단어만 반환 → stateless가 finding 연속성을 잃음. bounded 스냅샷 주입으로 보완.
- `state.json`은 strict AJV 검증이 없어 `last_review` additive(`findings`/`elided_count`)가 안전. `req:next` G2가 `last_review.compare_hash`로 재호출을 차단하므로 기존 marker 보존 필수.
- `ResolvedConfig` 필드 추가 시 `req-commit.test.ts`의 `cfgStub`도 갱신해야 typecheck 통과.
