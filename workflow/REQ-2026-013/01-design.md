# REQ-2026-013 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.
> **design R1 반영**: timeout hard-kill·ETIMEDOUT 판별·D6 비밀안전·stateless 연속성·phase 순서·문서화. resume opt-in과 완전 tree-kill은 후속 REQ로 분리.

## 현재 상태(변경 대상)

### 리뷰어 어댑터는 config 없이 조립된다
`review-codex.ts:43`: `const reviewer = createCodexReviewerAdapter()` — 모듈-레벨 싱글턴, config 인자 없음. `review()`(`adapters.ts:137-154`)가 인자를 조립한다(`:145-147`):
```ts
resumeThreadId
  ? ['exec','resume',resumeThreadId,'-c','sandbox_mode="read-only"','--json',…]
  : ['exec','--json','--sandbox','read-only',…]
```
`-c 'sandbox_mode="read-only"'`가 **이미 있는 `-c` override 패턴**이다.

### spawn에 timeout이 없고, timeout 판별은 함정이 있다
`SafeSpawnOptions`(`:20-25`)에 `timeout`/`killSignal` 없음. `safeSpawnSync`(`:34-47`)·`defaultCodexRunner`(`:107-110`) 모두 미전달. **실측(Node20)**:

| 시나리오 | 결과 |
|---|---|
| SIGTERM 무시 자식 + `timeout`, killSignal=SIGTERM | (POSIX) 무시하면 미종료 위험 · (Win) 종료·`err.code=ETIMEDOUT` |
| 〃, killSignal=**SIGKILL** | 종료·`err.code=ETIMEDOUT` |
| stdout 폭주(maxBuffer 초과) | `err.code=**ENOBUFS**`, `signal=SIGKILL` |

∴ **hard-kill은 SIGKILL**(무시 불가), **timeout 판별은 `err.code==='ETIMEDOUT'`**(ENOBUFS는 signal이 켜져도 timeout이 아님).

### 실패 시 stdout을 버린다
`:42-45` — `res.stderr`만. codex `--json` 오류는 stdout JSONL이라 `err`가 빈 문자열.

### resume가 기본이고, 연속성은 status 한 단어뿐
`:1182` `isResume = !opts.freshThread && codex_thread_id 존재`. 프롬프트의 `previous_codex_result`(`:110`)는 `readPreviousResult`(`:532-541`)가 주는 **`v.status` 한 단어**다 — findings·next_action은 전달 안 됨. 즉 resume를 끄면 finding 연속성이 사라진다.

### config 스키마 두 축 + 병합이 키마다 다름
`config.ts`의 `RawConfig`·`ResolvedConfig`·`DEFAULTS`·`CONFIG_SCHEMA`·`merged` 다섯 지점 + 설치본 `workflow/req.config.schema.json`(init 복사·`req-config.test.ts` 가드) + `req.config.json.sample` + README(KR/EN). `merged`는 `ticketRoot ?? DEFAULTS`(null→기본) vs `handoffPath !== undefined ?`(null 보존)로 **키마다 다르다** — nullable 키는 후자라야 `null` 탈출구가 성립.

## 핵심 설계 결정

**D1. config 키 3종.** `reviewModel`·`reviewReasoningEffort`·`reviewTimeoutMs`. (resume 관련 키는 없음 — D8: stateless 전용.)

| 키 | 타입 | 기본 | 병합 | 의미 |
|---|---|---|---|---|
| `reviewModel` | `string(slug)\|null` | `"gpt-5.6-terra"` | `!== undefined` | `-c model=`. null=생략 |
| `reviewReasoningEffort` | `enum\|null` | `"high"` | `!== undefined` | `-c model_reasoning_effort=`. null=생략 |
| `reviewTimeoutMs` | `integer ≥ 1000` | `600000` | `??` | codex timeout(10분, 보수값) |

- 각 키는 `config.ts` 다섯 지점 + `req.config.schema.json` **양쪽**(`req-config.test.ts` 가드). `ResolvedConfig` 필드 추가 → `req-commit.test.ts`의 `cfgStub`도 갱신(안 하면 typecheck 실패).
- `reviewModel` slug 패턴 `^[A-Za-z0-9][A-Za-z0-9._-]*$`(`BASENAME_RE` 동형). `gpt-5.6-terra` 매칭, `"`·개행·백틱 거부.
- `reviewReasoningEffort` enum(Codex 공식). **null이 enum 목록 안에 있어야 탈출구가 성립**(design R2): JSON Schema `enum`은 타입 무관 전체에 적용되므로 null이 목록에 없으면 `{reviewReasoningEffort:null}`이 config-load에서 거부돼 "null=생략" 계약을 실행할 수 없다. → `{ type:['string','null'], enum:['minimal','low','medium','high','xhigh', null] }`. (`reviewModel`은 `pattern`이라 non-string인 null에 vacuously 통과 — 별도 조치 불요.)
- nullable 두 키는 **`!== undefined` 병합**(null 보존). `?? DEFAULTS`면 탈출구가 깨짐 — 회귀로 고정.

**D2. config는 `ReviewRequest` DTO로 어댑터에 엮는다.** 조립부(`:43`)는 불변. `ReviewRequest`에 `model:string|null`·`reasoningEffort:string|null`·`timeoutMs:number` 추가. `callReviewer` 흐름의 `cfg`에서 채운다. `review()`는 non-null일 때만 `-c` 쌍을 넣고 `timeoutMs`를 runner에 넘긴다. `FakeReviewerAdapter`가 요청을 기록해 전파 검증.

**D2-1. `-c` 값은 TOML 리터럴, 주입 안전은 스키마 제약에 의존.** args에 `'-c'`,`'model="gpt-5.6-terra"'`,`'-c'`,`'model_reasoning_effort="high"'`. cross-spawn은 shell 없이 리터럴 전달(shell 주입 없음). **TOML 파싱 주입**(값에 `"`·개행)은 `reviewModel` 패턴·`reviewReasoningEffort` enum이 입력단에서 차단하므로 조립부 escaping 불필요. 이 의존을 주석으로 고정(패턴/enum이 느슨해지면 취약). exec·resume 양쪽 동일 — codex `-c`는 둘 다 받음(리뷰어 확인: repeatable `-c` 유효).

**D3. `reviewModel="gpt-5.6-terra"` 코어 기본은 DEFAULTS 중립성의 의도적 예외.** 리뷰어 모델은 게이트 무결성 핵심 — 미고정=`ultra` 상속=P1. 다운스트림마다 config에 맡기면 기본 상태에서 P1이 안 풀린다. `gpt-5.6-terra`는 유효한 공식 모델(지능·비용 균형, 리뷰어 확인). 미지원 CLI는 override 또는 `null`; 미지원 시 fail-closed + P3가 사유 표면화. `reviewReasoningEffort="high"`는 모델 독립 등급이라 상대적 중립. 긴장을 문서에 남긴다.

**D4. `reviewReasoningEffort`는 Codex 공식 enum**(`minimal|low|medium|high|xhigh`, **+ null**). 현재 CLI 계약을 config-load에서 검증 → 오타가 비싼 외부 호출까지 가지 않는다. AJV: `{ type:['string','null'], enum:['minimal','low','medium','high','xhigh', null] }` — **null을 enum에 포함**하지 않으면 탈출구가 깨진다(design R2, D1 참조). 회귀: `{effort:null}` 통과 · `{effort:'higth'}` 거부. `reviewModel`은 값 공간이 열려 enum 불가 → slug 패턴으로 최소 방어(null은 pattern에 vacuously 통과).

> **공식 확인(R4 지적 반박)**: Codex 공식 config-reference(`learn.chatgpt.com/docs/config-file/config-reference`)가 `model_reasoning_effort`를 **`minimal | low | medium | high | xhigh`**로 명시한다(`xhigh`는 model-dependent). R4 리뷰가 제시한 `none|max`는 그 문서와 **불일치**하므로 채택하지 않는다(리뷰어 착오). 입력단 enum은 **오타 방어**용이고, `xhigh`가 특정 모델(예: terra)에서 미지원이면 codex가 거부하고 P3(D6)가 사유를 표면화한다 — 모델별 지원은 codex가 최종 판정. (WebFetch로 원문 확인.)

**D5. timeout: SIGKILL hard-kill + ETIMEDOUT 판별(실측 기반).**
- `SafeSpawnOptions`에 `timeoutMs?`. **`killSignal`은 내부 고정 `'SIGKILL'`**(config 아님) — SIGTERM은 POSIX에서 무시 가능해 "무한 대기 금지" 위반. SIGKILL은 무시 불가(실측: Win 종료, POSIX 계약).
- timeout 판별은 **`res.error?.code === 'ETIMEDOUT'`만**. `|| res.signal`은 금지(ENOBUFS도 signal=SIGKILL — 실측). ENOBUFS는 **별도 오류**("codex 출력이 상한(64MiB) 초과").
- exit≠0·timeout·ENOBUFS를 **구분되는 문구**로 throw. `CodexRunner` 시그니처 `(args,input,cwd,opts?:{timeoutMs?})` 확장, `defaultCodexRunner`가 전달.
- **`safeSpawnSync`는 범용이다**(git·npm·pnpm도 호출, design R3) — 여기서 **stdout을 파싱하지 않는다**. 실패 시 원시 필드 + **분류 태그**(`{kind:'timeout'|'buffer-overflow'|'exit', status, signal, stdout, stderr}`)를 **담은 오류**를 throw하고, 범용 메시지는 **exit + byte-bounded stderr만**(stdout 미포함 — 임의 명령의 stdout은 데이터/비밀일 수 있고 allowlist가 없다). codex 특화 stdout 추출은 **codex 경계**에서만 한다(D6).
- **분류 보존 계약(R5, D5↔D6 경계)**: `defaultCodexRunner`가 catch 후 재-throw할 때 **`kind`를 유실하지 않는다** — `kind==='timeout'`/`'buffer-overflow'`면 그 분류 문구를 **그대로 보존**(JSONL 추출을 붙이지 않는다; stdout은 timeout/overflow와 무관). `kind==='exit'`일 때만 D6 allowlist 추출을 덧붙인다. 그래서 호출자는 timeout·buffer-overflow·exit을 계속 구분한다. `defaultCodexRunner` 경유 회귀로 세 분류의 문구 보존을 고정(D11).
- 회귀: SIGTERM-무시 자식(`process.on('SIGTERM',()=>{})` + 무한) + 짧은 timeout → **ETIMEDOUT으로 반환**(POSIX CI에서 SIGKILL 종료 증명) · ENOBUFS 자식 → timeout 아님 · 자발적 signal 종료 → timeout 아님.
- **잔여(정직)**: SIGKILL은 **직접 자식 codex**를 보장한다. codex가 파이프를 쥔 손자를 detach하면 POSIX에서 EOF 대기가 남을 수 있다 — 완전 tree-kill(async+group-kill)은 동기 아키텍처 대개조라 **후속 REQ**. codex exec는 그런 손자를 detach하지 않음(phase 확인). git 경로(`execFileSync`)는 무영향.

**D6. codex 실패는 codex 경계에서 allowlist로만 표면화(비밀 안전, design R1·R2·R3 P2).** 추출을 **범용 `safeSpawnSync`가 아니라 `defaultCodexRunner`**(codex임을 아는 경계)에서 한다 — `safeSpawnSync`가 담아 throw한 `err.stdout`에 대해서만. npm/pnpm 등 비-codex 명령이 우연히 `{"type":"error","message":"token=…"}`를 내도 이 경로를 **안 탄다**(R3 — 범용 함수에 넣으면 유출).
- **allowlist(실측 고정, R5)**: `codex exec --json -c model="__bogus__"` 실패를 실제로 캡처해 오류 이벤트 3형을 확정했다:
  - `{"type":"error", "message":<string>}` → `message`
  - `{"type":"turn.failed", "error":{"message":<string>}}` → `error.message`
  - `{"type":"item.completed", "item":{"type":"error", "message":<string>}}` → `item.message` (**`item.type==='error'`일 때만** — `command_execution`·`agent_message`·`reasoning` 등 다른 item type은 제외)
  이 **정확한 (event type, string 필드) 쌍**만 추출한다. 그 외 event type·비-error item·중첩 객체·비-문자열·파싱 실패는 **전부 폐기**(blacklist는 미지 유출 — R2). `stream_error`는 실측에 없어 뺀다. 추출 결과에도 stderr와 **같은 비밀 마스킹(redaction)** 을 적용(오류 메시지가 auth 오류 등 비밀을 담을 수 있음 — 방어심층).
- **총량 상한(R3)**: 필드별이 아니라 **추출 결과 전체**에 — 최대 **N개 이벤트**(예 20) + **총 UTF-8 byte ≤ 8KiB**(Buffer.byteLength, 다바이트 안전 절단), 초과 시 **단일 생략 표식**(`[…N events elided]`). 수천 개 소형 이벤트가 수십 MiB로 부푸는 것 차단.
- **허용 이벤트 0개면 raw stdout 미포함** — exit + `[구조화 오류 없음 — stdout 생략]`만.
- **stderr는 redaction + byte-bounded(≤4KiB)** — byte 상한은 기밀성 보장이 아니므로(R4), stderr는 자유형식이라 구조 파싱은 불가하나 **best-effort 비밀 마스킹**을 적용한다: `(?i)(token|api[-_]?key|secret|password|authorization|bearer)\s*[=:]\s*\S+` → `$1=[redacted]`, `sk-[A-Za-z0-9_-]{8,}` → `[redacted]` 등 알려진 패턴 마스킹 후 ≤4KiB 절단, `[stderr, redacted]` 표식. **redaction은 best-effort(모든 비밀 형식을 잡는 보장 아님)** — 이 한계를 문서화. codex 정상 경로는 stderr가 대개 비어 진단 손실 적음.
- **계약을 fixture로 고정(R5)**: 위 실측 캡처를 회귀 fixture로 저장하고 allowlist를 그것으로 검증한다 — "구현 후 phase에서 실측" 의존을 없앤다. codex가 event type/필드를 바꾸면 fixture 테스트가 실패해 드러난다. (설계가 지원하는 CLI 계약 = 이 캡처 형태.)
- 회귀(fixture 기반): `error{message}`·`turn.failed{error.message}`·`item.completed{item.type:'error',message}` 3형 → 표면화 · `item.completed{item.type:'command_execution', aggregated_output:'token=…'}` → **폐기(비-error item)** · 미지 `{type:'x',message:'token=…'}` → 폐기 · **비-codex 명령의 `{type:'error'}` → codex 경로 안 탐**(범용은 stderr만) · 수천 이벤트 → 총 byte·개수 상한+생략표식 · 추출 메시지의 `token=…` → redaction.

**D7. bounded retry는 이번 범위에서 뺀다.** 비-일시 실패(usage-limit·model-not-found)엔 무익, 600s와 곱해 비용 배증, provider HTTP retry 존재, retryable 분류 계약 부재. D6로 표본 수집 후 별도 REQ.

**D8. 재리뷰 stateless 고정 + bounded findings 주입(design R1 P2).**
- `:1182`을 `const isResume = false`로 — **항상 새 스레드**. `codex_thread_id`는 계속 저장(후속 opt-in용)하되 resume에 쓰지 않는다.
- `--fresh-thread`는 **유지** — blocked 마커 회복(`:1090` `clearBlockedReview`)이 여전히 필요. (thread 강제-fresh 의미는 이제 기본과 같아 사실상 marker-clear 전용.)
- **resume opt-in·`--resume-thread`는 없다**(비목표). 그래서 design R1의 target-binding(#5)·모순 검사(#6)는 이번 범위 밖 — opt-in을 안 만드니 발생하지 않는다.
- **연속성 보완 + 승인 경계 + desync 제거(design R2·R3·R4)**: resume가 주던 finding 기억을 대체한다. "직전 same-target NEEDS_FIX 아카이브 검색"은 승인된 결함을 재주입할 수 있고(R2), "`state.last_review` selector + 가변 `codex-response.json` body"는 **둘이 desync**할 수 있다(R3).
  - 리뷰 검증 완료 시 `state.last_review`에 `{outcome, review_kind, phase_id}`와 함께 **검증된 findings의 bounded 스냅샷**을 **같은 `writeState` 호출로** 기록한다(selector·body 동시 기록 → desync 불가). 스냅샷 스키마·경계(R4 확정): `findings: [{severity, file, detail}]` — **실제 findings 스키마 필드**(title/summary 아님, R3-obs). 상한: **최대 10건**, 각 `detail` **≤ 300 byte**(Buffer.byteLength, UTF-8 안전 절단), 스냅샷 **총 ≤ 4 KiB**, 초과 시 단일 `[…N more findings elided]`. (큰 값이면 재주입이 토큰·수렴 문제를 재현하므로 경계를 코드 상수로 못박고 회귀로 판정.)
  - 재리뷰 프롬프트는 `state.last_review.outcome==='needs-fix'` + 타깃(kind/phase) 일치일 때만 그 **스냅샷**을 `previous_findings_to_close` 블록에 주입. 가변 `codex-response.json`을 읽지 않으므로 desync 불가.
  - **read 시점 검증 + fail-closed(R5)**: 영속된 `state.last_review`는 옛 버전·수동편집·부분복구로 오염됐을 수 있다. 주입 **전에** selector(`outcome`·`review_kind`·`phase_id`)와 **모든 finding 필드**를 재검증한다 — `severity` ∈ {P1,P2,P3}, `file`은 string|null, `detail`은 string, 건수 ≤10, 각 detail ≤300B, 총 ≤4KiB. **하나라도 불일치·비정상 타입·상한 초과면 전체 미주입**(예외로 중단하지 않고 조용히 skip — fail-closed). 정상 실패(오염 아님)에서만 주입되도록 회귀로 고정.
  - **원자성 범위 정밀화(R4)**: 여기서 말하는 "원자적"은 **selector·body가 한 `writeState` 호출에 함께 쓰인다**는 뜻(둘의 desync 제거)이다. `writeState`가 `writeFileSync`로 `state.json`을 직접 덮어써 **쓰기 중 crash 시 부분 JSON으로 truncate**될 수 있는 것은 이 REQ가 만든 문제가 아니라 **모든 state 쓰기에 공통인 기존 durability 이슈**다 — temp-write+flush+rename 교체는 별도 REQ(후속). 이번 REQ는 selector/body desync만 제거한다.
  - `outcome==='approved'`(승인 후 리셋)·타깃 불일치·직전 없음 → 주입 안 함. 승인이 경계다.
  - 즉 "**검증된 직전 결과의 원자적 스냅샷만 + 승인 후 리셋**". 누적 아닌 1라운드 타깃 스냅샷 → drift 없음. `readPreviousResult`(status 한 단어) 대체.

**D9. Phase 순서 = timeout → stdout → model-pin → stateless(bootstrap, design R1 P2).** 이 저장소 명령은 로컬 `tsx`라 staged phase 구현이 **자기 phase 리뷰에 즉시 적용**된다. model-pin(P1)이 먼저면 그 리뷰가 timeout·stdout 안전망 없이 새 고정 모델로 돈다 — 미지원/행이면 진단·중단 수단이 없다. 따라서 **안전망을 먼저** 깐다:
1. timeout(P2) → 2. stdout(P3) → 3. **model-pin(P1)** → 4. stateless(P4).
- model-pin phase의 **자기 리뷰가 고정 모델로 성공 = exec effective 검증**(별도 probe 불필요). 실패하면 이미 깔린 timeout이 bound하고 stdout이 사유를 표면화.
- 첫 slice(timeout) 리뷰가 도구 자기 코드를 타는 부트스트랩은 **사람 감시(--run 통제점, 행이면 Ctrl-C)** 가 회복 경로 — 문서화.

**D10. 사용자 문서를 변경 범위에 포함.** 신규 키·`null` 탈출구·timeout 조정을 `req.config.json.sample` + README(KR `README.md`/EN `README.en.md`) config 표 + `CHANGELOG`에 반영. 각 phase가 자기 키의 문서를 함께 갱신.

**D11. 테스트 이음새.** 실 어댑터 + 주입 `CodexRunner`(args 캡처) · `FakeReviewerAdapter.requests`(DTO 전파) · `loadConfig`(null 보존·enum 거부·패턴 거부·두 축 동기화) · `safeSpawnSync` 실-spawn(`process.execPath`: SIGTERM-무시→ETIMEDOUT·ENOBUFS→비-timeout·큰 stdout→구조화 추출/byte 절단) · stateless(항상 fresh·`--fresh-thread` marker-clear 배선·findings 주입).

## Phase별 구현 (재정렬)

### Phase 1 — codex timeout (`phase-1-timeout`)
config `reviewTimeoutMs`(D1) + `SafeSpawnOptions.timeoutMs` + 내부 `killSignal='SIGKILL'` + `safeSpawnSync` ETIMEDOUT/ENOBUFS 판별·구분 오류(D5) + `CodexRunner` 확장 + 실-spawn 테스트. 문서: sample/README에 `reviewTimeoutMs`.

### Phase 2 — 진단성: 구조화 stdout 표면화 (`phase-2-stdout-surface`)
`safeSpawnSync` 실패 오류에 구조화 오류 이벤트 추출 + 비밀 이벤트 제외 + byte 이중 상한 fallback(D6) + 테스트. **retry 없음(D7).**

### Phase 3 — 모델·추론강도 고정 (`phase-3-model-effort-pin`)
config `reviewModel`(패턴)·`reviewReasoningEffort`(enum)(D1·D4, null 보존) + `ReviewRequest`·`callReviewer`·`review()` `-c` 주입(D2·D2-1) + 테스트(args 캡처·null 보존·enum/패턴 거부·DTO). 자기 리뷰 성공 = exec 검증(D9). 문서: sample/README에 두 키 + `null` 탈출구.

### Phase 4 — 재리뷰 stateless (`phase-4-stateless`)
`isResume=false`(D8) + `--fresh-thread` marker-clear 보존 + bounded findings 주입(D8) + 테스트(항상 fresh·marker-clear 배선·findings 주입·drift 없음). 문서: stateless 동작 변경 note.

## 변경 파일

| Phase | 파일 |
|---|---|
| 1 | `config.ts`·`req.config.schema.json`·`req.config.json.sample`·`README*.md`(reviewTimeoutMs) · `adapters.ts`(SafeSpawnOptions·safeSpawnSync·CodexRunner) · `tests/unit/adapters.test.ts` · `req-commit.test.ts`(cfgStub) |
| 2 | `adapters.ts`(구조화 표면화) · `tests/unit/adapters.test.ts` |
| 3 | `config.ts`·`req.config.schema.json`·`req.config.json.sample`·`README*.md`(reviewModel·effort) · `adapters.ts`(ReviewRequest·주입) · `review-codex.ts`(callReviewer) · `tests/unit/`(adapters·review-codex·req-config) |
| 4 | `review-codex.ts`(isResume·findings 주입) · `tests/unit/req-review-codex.test.ts` · `CHANGELOG` |

각 phase ≤8파일. 초과 시 vertical slice로 분할(config-only 분할 금지 — dead-config).

## 하위호환·안전

- **품질 방향.** `high`는 `ultra`보다 낮지만 강한 등급, config로 상향 가능. 미고정이 오히려 예측 불가였다 — 완화가 아니라 통제.
- **모델 변경.** `gpt-5.6-terra` 고정. 미지원 CLI → fail-closed(안전) → override/`null`, P3 표면화.
- **stateless 전용.** 재리뷰가 누적하지 않는다. finding 연속성은 bounded 주입으로 대체. `codex_thread_id`는 계속 저장(후속 opt-in용). resume opt-in은 후속 REQ.
- **timeout 잔여.** SIGKILL이 직접 codex를 보장. 병적 detached-손자-파이프는 후속(정직 명시).
- **retry 부재.** 진단만. 비-일시 실패는 fail-closed 즉시 중단 + 사유 표면화.
- **null 탈출구.** `!== undefined` 병합이라야 성립 — 회귀 고정.
- **기존 config 무영향.** 새 키 additive. 키 없는 config는 DEFAULTS로 채움.
- **자기 리뷰 부트스트랩.** timeout 먼저 → model-pin 리뷰가 안전망 뒤. 첫 slice는 사람 감시가 회복 경로.
- **미검증.** codex `-c model_reasoning_effort=` 존중·JSONL 오류 이벤트명·cross-spawn의 timeout 전달은 phase에서 live/실-spawn 확인.
