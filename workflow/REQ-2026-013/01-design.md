# REQ-2026-013 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

### 리뷰어 어댑터는 config 없이 조립된다

`review-codex.ts:43`:
```ts
const reviewer: ReviewerAdapter = createCodexReviewerAdapter()   // 모듈-레벨 싱글턴, config 인자 없음
```
`createCodexReviewerAdapter(run)`(`adapters.ts:137-154`)의 `review()`가 codex 인자를 조립한다(`:145-147`):
```ts
const args = resumeThreadId
  ? ['exec','resume',resumeThreadId,'-c','sandbox_mode="read-only"','--json','--output-schema',…,'--output-last-message',…,'-']
  : ['exec','--json','--sandbox','read-only','--output-schema',…,'--output-last-message',…,'-']
```
모델·추론강도·timeout에 대한 언급이 없다. `-c 'sandbox_mode="read-only"'`가 **이미 있는 `-c` config override 패턴**이다 — 모델·추론강도도 같은 메커니즘으로 얹으면 된다.

### spawn에 timeout이 없다

`SafeSpawnOptions`(`adapters.ts:20-25`) = `{cwd?, input?, stdio?, maxBuffer?}`. `safeSpawnSync`(`:34-47`)가 `spawn.sync`에 넘기는 옵션에 `timeout`/`killSignal`이 없다. `defaultCodexRunner`(`:107-110`)도 `{cwd, input, maxBuffer}`만 준다.

### 실패 시 stdout을 버린다

`adapters.ts:42-45`:
```ts
if (res.status !== 0) {
  const err = res.stderr ? res.stderr.toString('utf8') : ''
  throw new Error(`명령 실패(exit=${res.status ?? 'null'}): ${file}\n${err}`.trim())
}
```
`res.stdout`을 읽지 않는다. codex `--json`은 오류를 stdout JSONL로 내므로 `err`가 빈 문자열이 된다.

### resume가 기본이다

`review-codex.ts:1182`: `isResume = !opts.freshThread && typeof state.codex_thread_id === 'string' && …length > 0`. `--fresh-thread`가 없으면 항상 resume. `--fresh-thread`(`:1034` 파싱)는 blocked 마커 초기화(`:1090` `clearBlockedReview`)도 겸한다.

### config 스키마가 두 축이고, 병합이 키마다 다르다

`config.ts`의 `RawConfig`(`:25-35`)·`ResolvedConfig`(`:38-53`)·`DEFAULTS`(`:79-90`)·`CONFIG_SCHEMA`(`:95-117`)·`merged`(`:177-187`) 다섯 지점 + 설치본 `workflow/req.config.schema.json`(init이 복사, `req-config.test.ts`가 동기화 가드). 새 키는 이 둘을 다 거친다.

`merged`의 병합은 **키마다 다르다**(중요):
```ts
ticketRoot:  raw.ticketRoot ?? DEFAULTS.ticketRoot,                                    // ?? — null이면 기본값
handoffPath: raw.handoffPath !== undefined ? raw.handoffPath : DEFAULTS.handoffPath,   // !== undefined — null 보존
```
`??`는 `null`을 기본값으로 되돌린다. `!== undefined`는 명시적 `null`을 보존한다. **nullable 키(전역 상속 탈출구)는 반드시 후자**를 써야 한다 — 아니면 `null` 탈출구가 조용히 무효가 된다.

## 핵심 설계 결정

**D1. config 키 4종을 신설한다.**

| 키 | 타입 | 기본값 | 병합 | 의미 |
|---|---|---|---|---|
| `reviewModel` | `string(slug 패턴) \| null` | `"gpt-5.6-terra"` | `!== undefined` | `-c model=`. null=생략(전역 상속) |
| `reviewReasoningEffort` | `enum \| null` | `"high"` | `!== undefined` | `-c model_reasoning_effort=`. null=생략 |
| `reviewTimeoutMs` | `integer ≥ 1000` | `600000` | `??` | codex 호출 timeout(10분, 초기 보수값) |
| `reviewResume` | `boolean` | `false` | `??` | 재리뷰 기본 resume 여부(기본 stateless) |

각 키는 `config.ts` 다섯 지점 + 설치본 스키마 `workflow/req.config.schema.json` **양쪽**. `req-config.test.ts`가 동기화를 가드한다. Phase마다 자기 키만 추가한다(dead-config phase 방지) — Phase 1이 앞 둘, Phase 2가 timeout, Phase 4가 resume. **retry 관련 키는 없다(D7).**

- `reviewModel` slug 패턴: `^[A-Za-z0-9][A-Za-z0-9._-]*$`(`config.ts`의 `BASENAME_RE`와 동형). `gpt-5.6-terra`는 매칭, 따옴표·개행·백틱은 거부 → `model="…"` TOML 조립의 주입 안전(D2-1).
- `reviewReasoningEffort` enum: `['minimal','low','medium','high','xhigh']`(Codex 공식 설정 계약, D4). null 허용은 `type:['string','null']` + enum.
- **nullable 두 키는 `!== undefined` 병합**(현재상태 §마지막). `null`이면 override를 끄는 탈출구다. `?? DEFAULTS`면 `null`이 기본값으로 복귀해 탈출구가 깨진다 — 회귀 테스트로 고정(D9).

**D2. config는 `ReviewRequest` DTO로 어댑터에 엮는다.** 어댑터 조립부(`review-codex.ts:43`)는 config를 모르므로 건드리지 않는다. 경계 DTO를 확장한다:
```ts
interface ReviewRequest { …; model: string|null; reasoningEffort: string|null; timeoutMs: number }
```
`callReviewer` 흐름은 이미 `loadConfig`한 `cfg`를 갖는다 → `ReviewRequest`에 `cfg.reviewModel` 등을 싣는다. `review()`는 `model`/`reasoningEffort`가 **non-null일 때만** `-c` 쌍을 args에 추가하고, `timeoutMs`를 runner에 넘긴다. `FakeReviewerAdapter`가 요청을 기록하므로 전파를 단위로 검증(D9).

**D2-1. `-c` 값은 TOML 문자열 리터럴이고, 주입 안전은 스키마 제약으로 보장한다.** 기존 `sandbox_mode="read-only"`와 동형으로 args 배열에 `'-c'`, `'model="gpt-5.6-terra"'`, `'-c'`, `'model_reasoning_effort="high"'`를 넣는다. cross-spawn은 shell 없이 리터럴 전달이라 shell 주입은 없지만, **TOML 파싱 관점의 주입**(값에 `"`·개행이 들면 config override 구문이 깨짐)은 별개다. 이를 값 자체를 신뢰하지 않고 **입력단에서 차단**한다 — `reviewModel`은 slug 패턴, `reviewReasoningEffort`는 enum이라 `"`·개행이 애초에 통과 못 한다. 따라서 조립부의 escaping은 불필요하나, 이 안전이 **스키마 제약에 의존함**을 주석으로 고정한다(패턴/enum이 느슨해지면 조립부가 취약해짐). exec·resume 양쪽 폼에 동일 추가 — codex `-c`는 두 서브커맨드 모두 받는다.

**D3. `reviewModel="gpt-5.6-terra"` 코어 기본값은 DEFAULTS 중립성 원칙의 의도적 예외다.** `config.ts:71-74`는 "모든 프로젝트에 유효한 중립 기본값만"을 요구한다. 특정 모델명은 그와 긴장한다. 그럼에도 코어 기본으로 두는 근거:
- 리뷰어 모델은 **게이트 무결성의 핵심**이다. 미고정 = 사용자 전역 프로필(=`ultra`) 상속 = 결함(P1). 다운스트림마다 config에 명시하게 만들면 **기본 상태에서 P1이 안 풀린다**.
- `gpt-5.6-terra`는 현재 유효한 공식 모델이며 지능·비용 균형 모델로 안내된다(OpenAI 문서). codex CLI 미지원 프로젝트는 `req.config.json`으로 override하거나 `null`로 끈다. 미지원 시 리뷰는 fail-closed(승인 안 됨)로 멈추고 P3(stdout 표면화)가 "model not found"를 드러낸다.
`reviewReasoningEffort="high"`는 상대적으로 중립적이다(추론강도는 모델 독립 등급). 두 기본값을 코어에 두되 이 긴장을 문서에 남긴다.

**D4. `reviewReasoningEffort`는 Codex 공식 enum이다(초안의 문자열에서 변경).** Codex 설정 레퍼런스가 `model_reasoning_effort`를 `minimal | low | medium | high | xhigh`로 명시한다. 미래 확장 가능성보다 **현재 CLI 계약을 config-load에서 검증**하는 것이 낫다 — 오타가 비싼 외부 호출까지 갔다 실패하는 것을 막는다. AJV: `{ type:['string','null'], enum:['minimal','low','medium','high','xhigh', null] }`. 기본 `high`, `null`=전역 상속. (`reviewModel`은 값 공간이 열려 있어 enum 불가 → slug 패턴으로 최소 방어.)

**D5. timeout 메커니즘.** `SafeSpawnOptions`에 `timeoutMs?: number` + `killSignal?: NodeJS.Signals`(기본 `'SIGTERM'`). `safeSpawnSync`가 `spawn.sync`에 `timeout`/`killSignal`을 전달한다. `child_process.spawnSync`는 timeout 초과 시 자식을 kill하고 `res.error`(code `'ETIMEDOUT'`) 또는 `res.signal`을 세팅한다 — **둘 다 검사**해 timeout을 판별하고 exit≠0과 **구분되는** 명확한 오류로 throw:
```
codex 응답 <timeoutMs>ms 초과 — timeout(fail-closed)
```
`CodexRunner` 시그니처를 `(args, input, cwd, opts?: {timeoutMs?: number}) => string`로 확장, `defaultCodexRunner`가 `opts.timeoutMs`를 `safeSpawnSync`로 전달. git 경로(`execFileSync`)는 손대지 않는다.

> 기본 600s 근거: 정상 리뷰가 `ultra`에서 11~13분(660~780s) 실측됐다. 300s면 정상 리뷰까지 잘린다. 600s는 임시로 리뷰를 `high`로 낮춘 세션·P1 고정 이후를 겨냥한 보수값이며, P1 실측 후 하향한다. cross-spawn이 `spawn.sync`의 timeout/killSignal을 그대로 전달하는지는 Phase 2에서 실-spawn 테스트로 확인한다.

**D6. 실패 오류에 stdout 꼬리를 포함한다(P3, 줄+바이트 이중 상한).** `adapters.ts:42-45`에서 `res.stdout`의 **마지막 20줄과 8KiB 중 더 짧은 쪽**을 stderr와 함께 오류에 넣는다. JSONL 한 줄이 매우 클 수 있어 줄 수만으론 부족 → 바이트 상한을 겹친다. 형식:
```
명령 실패(exit=<status>): codex
[stderr]
<stderr>
[stdout tail]
<stdout 마지막 20줄·≤8KiB>
```
codex `--json` 오류가 stdout에 있으므로 이것이 "빈 오류"를 없앤다.

**D7. bounded retry는 이번 범위에서 뺀다(초안에서 변경).** 초안의 "pre-result 실패에 즉시 1회 retry"는 범위가 넓다:
- usage-limit·model-not-found·잘못된 config도 재호출한다(무익).
- 600s timeout과 곱하면 같은 실패에 최대 ~20분 + 토큰 배증.
- codex provider에 이미 HTTP retry·기본 재시도가 있다.
- retryable(network/5xx)을 안정적으로 분류하는 계약이 아직 없다.
- D1(config 4키)과 `reviewMaxRetries`가 충돌해 문서 내부도 5키로 어긋났다.

이번 REQ는 **D6로 원인을 표면화**만 하고, 실제 오류 표본을 모은 뒤 "retryable 분류 + backoff/jitter"를 **별도 REQ**로 설계한다. `reviewMaxRetries` 키는 없다.

**D8. resume를 기본 stateless로 뒤집는다(P4).** `review-codex.ts:1182`을 바꾼다:
```ts
if (opts.resumeThread && opts.freshThread)
  throw new Error('--resume-thread 와 --fresh-thread 동시 사용 불가')          // 모순 → fail-closed
const resumeEnabled = opts.resumeThread || cfg.reviewResume                    // 기본 false
const isResume = resumeEnabled && !opts.freshThread && typeof state.codex_thread_id === 'string' && …length > 0
```
- 기본(플래그 없음, config false) → **새 스레드**. `codex_thread_id`가 있어도 resume하지 않는다.
- `--resume-thread`(신규 Opts 플래그) 또는 `reviewResume:true` → resume(옛 동작 opt-in).
- `--fresh-thread`는 **그대로 유지** — blocked 마커 초기화(`:1090`) + 새 스레드. `--resume-thread`와 **동시 지정은 인자 오류로 throw**(우선순위 처리보다 명확). config `reviewResume:true` + `--fresh-thread`는 모순이 아니다(플래그가 config를 명시적으로 무효화 — `!opts.freshThread`가 이미 처리).
- `codex_thread_id`는 계속 저장한다(`:674·698·935`) — resume opt-in 시 필요.

연속성 신호는 프롬프트 Review Context의 `previous_codex_result`(`review-codex.ts:110`)로 이미 전달되므로 stateless가 "무엇을 고쳤는지"를 잃지 않는다.

**D9. 테스트 이음새.** 세 층으로 검증한다.
- **실제 args 캡처**(수용기준): 실 어댑터 + 주입 `CodexRunner`(args 기록). `-c model="gpt-5.6-terra"`·`-c model_reasoning_effort="high"`가 exec·resume 양쪽에 있고, null이면 없음, timeoutMs가 전달됨을 단언.
- **config 병합**: `reviewModel:null`/`reviewReasoningEffort:null`이 **기본값으로 복귀하지 않음**(`!== undefined` 병합) · enum 밖 effort는 `loadConfig` throw · reviewModel 패턴 위반(`a"b`, 개행) throw · 두 스키마 축 동기화·기본값 해소.
- **safeSpawnSync 직접**(timeout·stdout 표면화): `process.execPath`로 짧은 자식(`node -e "…"`) 실제 spawn — exit=1+큰 stdout → 오류에 stdout 꼬리(20줄·8KiB 이중 상한), 무한 루프 자식 + 짧은 timeout → timeout 오류. 크로스플랫폼(execPath).
- **resume**: 기본 fresh(thread_id 있어도) · `--resume-thread`/`reviewResume:true` → resume · `--fresh-thread`가 resume opt-in을 이김 · `--resume-thread`+`--fresh-thread` → throw.

## Phase별 구현

### Phase 1 — 모델·추론강도 고정 (`phase-1-model-effort-pin`)
P1. config 키 `reviewModel`(slug 패턴)·`reviewReasoningEffort`(enum)(D1·D4, 두 스키마 축, `!== undefined` 병합) + `ReviewRequest` 확장·`callReviewer` 채움(D2) + `review()`의 `-c` 주입(D2-1) + args-캡처/DTO/null-보존/enum-거부/패턴-거부 테스트(D9). 최대 원인, 먼저 착수.

### Phase 2 — codex timeout (`phase-2-timeout`)
P2. config `reviewTimeoutMs`(기본 600000)(D1) + `SafeSpawnOptions.timeoutMs`/`killSignal` + `safeSpawnSync` timeout 판별·명확 오류(D5) + `CodexRunner` 시그니처 확장 + 배선 + safeSpawnSync 실-spawn 테스트(D9).

### Phase 3 — 진단성: stdout 표면화 (`phase-3-stdout-surface`)
P3. `adapters.ts` `safeSpawnSync` 실패 오류에 stdout 꼬리(20줄+8KiB 이중 상한, D6) + 실-spawn 테스트. **retry 없음(D7).**

### Phase 4 — resume 기본 stateless (`phase-4-stateless-resume`)
P4. config `reviewResume`(D1) + Opts `--resume-thread` + `isResume` 뒤집기·모순 fail-closed(D8) + `--fresh-thread` 회복 의미 보존 + 테스트.

## 변경 파일

| Phase | 파일 | 성격 |
|---|---|---|
| 1 | `scripts/req/lib/config.ts` · `workflow/req.config.schema.json` | 키 2종(패턴·enum·null 병합) |
| 1 | `scripts/req/lib/adapters.ts` | `ReviewRequest`·`review()` `-c` 주입 |
| 1 | `scripts/req/review-codex.ts` | `callReviewer` config 채움 |
| 1 | `tests/unit/` — adapters·review-codex·req-config | args 캡처·전파·병합 |
| 2 | `config.ts` · `req.config.schema.json` | `reviewTimeoutMs` |
| 2 | `adapters.ts` | `SafeSpawnOptions`·`safeSpawnSync`·`CodexRunner` |
| 2 | `tests/unit/adapters.test.ts` | 실-spawn timeout |
| 3 | `adapters.ts` | stdout 표면화(이중 상한) |
| 3 | `tests/unit/adapters.test.ts` | 표면화 |
| 4 | `config.ts` · `req.config.schema.json` | `reviewResume` |
| 4 | `review-codex.ts` | `--resume-thread`·`isResume`·모순 throw |
| 4 | `tests/unit/req-review-codex.test.ts` | 기본 fresh·opt-in·모순 |

각 phase ≤8파일(granularity). Phase 1이 경계면 1a(config 키) / 1b(어댑터 주입·배선)로 런타임 분할.

## 하위호환·안전

- **게이트 품질 방향.** `high`는 `ultra`보다 낮은 추론강도다. 전역이 `ultra`였던 프로젝트는 리뷰 깊이가 소폭 줄 수 있다. 대가로 속도·토큰이 크게 준다. `high`는 여전히 강한 등급이고 config로 올릴 수 있다. **완화가 아니라 통제**다 — 미고정 상태가 오히려 예측 불가였다.
- **모델 변경.** 리뷰가 `gpt-5.6-terra`로 고정된다(전역과 다를 수 있음). 의도된 일관성. 미지원 CLI → 리뷰 fail-closed(안전) → override로 해소, P3가 사유 표면화.
- **resume 기본 변경.** 재리뷰가 컨텍스트를 누적하지 않는다. 연속성은 `previous_codex_result`로 프롬프트에 남는다. `--resume-thread`/config로 옛 동작 복원. 기존 티켓 무영향(`codex_thread_id` 계속 저장).
- **retry 부재.** 이번 REQ는 진단(D6)만. 비-일시 실패는 fail-closed로 즉시 멈추고 원인이 표면화된다. retryable 분류는 후속 REQ.
- **null 탈출구.** `reviewModel:null`/`reviewReasoningEffort:null`은 override를 꺼 옛(전역 상속) 동작으로 되돌린다. `!== undefined` 병합이라야 성립 — 회귀로 고정.
- **기존 config 무영향.** 새 키는 additive. 키 없는 기존 `req.config.json`은 `merged`가 DEFAULTS로 채운다. `additionalProperties:false`이나 새 키가 스키마에 추가되므로 위반 아님.
- **이 티켓 자신의 리뷰.** design·phase-1 리뷰는 P1 적용 전이라 옛(ultra 상속) 경로를 탄다 — 이 두 번만 전역을 임시로 `high`로 낮춰 비용을 줄이고, phase-1 커밋 후부터 고정 인자 적용. 감수한다.
- **미검증.** codex `-c model_reasoning_effort=`가 exec·resume 양쪽에서 실제로 존중되는지, spawnSync timeout이 `res.error`(ETIMEDOUT)로 오는지 `res.signal`로 오는지는 phase에서 live/실-spawn으로 확인한다(설계는 `sandbox_mode` override 실측에 기반해 동형 가정).
