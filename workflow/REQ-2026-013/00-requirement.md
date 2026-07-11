# REQ-2026-013 요구사항

리뷰 codex 호출이 사용자 전역 프로필에 위임돼 느리고·토큰이 많고·결과가 수렴하지 않고·일시 오류에 통째 실패한다. 리뷰어 호출을 도구가 **명시적으로 통제**한다.

## 배경 — 다운스트림 2차 요청서

palm-backend가 CommitGate를 이식해 설계-전용 REQ 1건(문서 5개)을 4라운드 리뷰하며 관측한 실측치(`D:\Vue\palm-backend\claudedocs\commitgate-perf-request-2026-07-11.md`, 2026-07-11):

| 라운드 | 결과 | 소요 |
|---|---|---|
| 3차(resume) | NEEDS_FIX 9건 | ~11.5분 |
| 4차-a/-b | codex exit=1(빈 stderr) | 실패 |
| 4차-c(resume) | NEEDS_FIX 10건 | ~13.1분 |
| 직접 codex exec | 무응답 | ~75분(사용자 중단) |

findings가 수렴하지 않고 라운드마다 더 깊고 다른 지점으로 이동(11→9→9→10)했고, 프롬프트는 26KB였다.

## 근본 원인 (현재 코드에서 검증됨, 2026-07-11)

**P1 — 리뷰 codex 호출에 모델·추론강도가 고정돼 있지 않다(최대 원인).** `createCodexReviewerAdapter`(`adapters.ts:137-154`)가 조립하는 인자(`:145-147`)에 `-c model`·`-c model_reasoning_effort` override가 **전혀 없다**. 그래서 리뷰는 사용자 전역 `~/.codex/config.toml`의 `model_reasoning_effort="ultra"` + `multi_agent` + 전체 plugin을 그대로 상속한다. 리뷰 1회가 "최대 추론으로 저장소를 agentic 탐색하는 세션"이 된다.

**P2 — codex 호출에 timeout이 없다.** `SafeSpawnOptions`(`adapters.ts:20-25`)에 `timeout` 필드가 없고 `safeSpawnSync`(`:34-47`)가 `spawn.sync`에 timeout을 넘기지 않는다. 무응답이면 무한 블로킹(75분 실측).

**P3 — 일시 오류에 retry가 없고 stderr만 표면화한다.** 실패 시 `const err = res.stderr ? res.stderr.toString('utf8') : ''`(`adapters.ts:42-45`) — `res.stdout`을 버린다. codex는 `--json` 모드라 오류를 stdout JSONL로 내므로 오류 메시지가 **빈 문자열**이 된다. 또 일시적 spawn·5xx·network 오류에 재시도가 없어 통째 실패한다.

**P4 — resume 스레드 누적이 토큰·"결과 이상"의 주범.** `isResume = !opts.freshThread && codex_thread_id 존재`(`review-codex.ts:1182`)라 재리뷰는 **기본이 resume**이다. 이전 대화 전체를 상속한 위에 매번 새 full 프롬프트(26KB)를 얹어 컨텍스트가 단조 증가하고, 모델이 옛 문서·옛 findings를 함께 재추론해 수렴 대신 심화·이동한다. 연속성 신호(`previous_codex_result`)는 이미 프롬프트 Review Context에 실리므로(`review-codex.ts:110`) resume 없이도 "무엇을 고쳤는지"는 전달된다.

## 목표

1. 리뷰 codex 호출의 **모델·추론강도를 도구가 명시 고정**한다. 기본값 `gpt-5.6-terra` / `high`, `req.config.json`으로 override 가능(`null`=전역 상속 탈출구).
2. codex 호출에 **timeout**을 걸어 무응답을 fail-closed로 끝낸다(기본 **600s** — 초기 보수값, P1 적용 후 실측으로 하향).
3. 실패 시 **stdout 마지막 부분(줄 수 + 바이트 이중 상한)을 오류에 포함**해 빈-오류를 없앤다. (retry는 이번 범위 밖 — 비목표.)
4. 재리뷰를 **기본 stateless**(새 스레드 + 현재 스냅샷)로 바꾸고, 연속성은 **opt-in resume**으로만.

## 비목표 (이번 REQ에서 하지 않음 — 각 후속 REQ)

- **P5 — full 컨텍스트 재전송/화이트리스트 스코핑·diff 청크.** 프롬프트 크기·repo 스캔 최적화는 별도 REQ. (D8 시크릿 스크러빙과 같은 축.)
- **P6 — phase 상태 durability.** 커밋된 `state.json`이 `phases:[]`라 fresh checkout에서 감사 자기검증 실패. 정확성 결함이나 성능과 독립 — 별도 REQ. (REQ-2026-012는 011식 수동 finalize로 자기 티켓만 우회했다.)
- **P7 — worktree node_modules 선검사.** UX 개선, 별도.
- **`multi_agent`·plugin 비활성화.** P1은 모델·추론강도만 고정한다. `-c features.multi_agent=false` 등 추가 override는 codex CLI 버전별 키 안정성 확인이 필요 — 이번 범위에서 제외하되 설계에서 확장 지점만 남긴다.
- **외부 bounded retry(옛 P3의 절반).** "모든 timeout·exit≠0을 즉시 재시도"는 범위가 너무 넓다 — usage-limit·model-not-found·잘못된 config까지 재호출하고, timeout이 크면 같은 실패에 시간·토큰을 배로 쓴다. codex provider에 이미 HTTP retry가 있고, **retryable(network/5xx) 분류 계약이 아직 없다**. 이번 REQ는 D6(원인 표면화)만 하고, 실제 오류 표본을 모은 뒤 "retryable 분류 + backoff/jitter"를 **별도 REQ**로 설계한다. (이로써 config 키가 4개로 유지된다 — 옛 D7의 `reviewMaxRetries` 불일치 제거.)

## 수용 기준

- 조립된 codex 인자(exec·resume 양쪽)에 `-c model="<reviewModel>"` `-c model_reasoning_effort="<reviewReasoningEffort>"`가 포함된다. 주입 가능한 `CodexRunner`로 실제 args를 캡처해 단언한다.
- `req.config.json` 미설정 시 `gpt-5.6-terra`/`high`로 해소된다. config로 override하면 그 값이 인자에 실린다.
- **명시적 `null`은 기본값으로 되돌아가지 않는다.** `reviewModel:null`/`reviewReasoningEffort:null`이면 해당 `-c`가 생략된다(전역 상속). 병합이 `?? DEFAULTS`가 아니라 `!== undefined` 분기라야 성립 — 회귀 테스트로 고정한다.
- `reviewReasoningEffort`는 **enum**(`minimal|low|medium|high|xhigh`)이라 유효하지 않은 값(오타 포함)은 **config-load에서 거부**된다(비싼 외부 호출 전).
- `reviewModel`은 **slug 패턴**으로 제한돼 따옴표·개행이 든 값을 config-load에서 거부한다(`model="…"` TOML 조립의 주입 안전).
- `reviewTimeoutMs`(기본 600s) 초과 시 명확한 timeout 오류로 throw(fail-closed) — 무한 대기하지 않는다.
- codex exit≠0일 때 오류 메시지에 **stdout 꼬리(마지막 20줄 + 8KiB 이중 상한)**가 포함된다(빈 오류 금지).
- 재리뷰 기본이 **새 스레드**다(`codex_thread_id`가 있어도 resume하지 않는다). `--resume-thread`(또는 config)일 때만 resume한다. `--fresh-thread`의 blocked-마커 회복 의미는 보존된다. `--resume-thread`와 `--fresh-thread`를 **동시에 주면 인자 오류로 throw**(fail-closed).
- 새 config 키가 **두 스키마 축**(`config.ts` `CONFIG_SCHEMA` + `workflow/req.config.schema.json`)에 모두 있고 `req-config.test.ts` 동기화 가드를 통과한다.
- `npm run typecheck`·`npm test`·`npm run smoke` 그린.

## 조사 결과 — 이번 세션에서 코드 대조로 확정

2차 요청서의 6개 원인을 현재 HEAD(main=`2ca2934`)에서 파일:라인으로 대조했다. P1~P4·P6 전부 주장과 일치(P5·P7은 구조적/환경적으로 자명). 아래는 설계에 영향을 주는 확정/유의 사항.

- **어댑터는 config 없이 조립되는 모듈-레벨 싱글턴이다**(`review-codex.ts:43` `createCodexReviewerAdapter()`). 모델·추론강도·timeout을 주입하려면 config를 어댑터까지 **엮는 경로**가 새로 필요하다. config는 `callReviewer` 흐름에서 이미 로드된다(`loadConfig`).
- **`DEFAULTS`는 "모든 프로젝트에 유효한 중립 기본값"만 담는다**는 명시 원칙이 있다(`config.ts:71-74`). `reviewModel="gpt-5.6-terra"`는 특정 모델이라 이 원칙과 긴장한다 → 설계에서 **의도적 예외**로 근거를 남긴다(D3).
- **config 스키마가 두 축이다** — `CONFIG_SCHEMA`(런타임 AJV, `config.ts:95-117`)와 `workflow/req.config.schema.json`(설치본, init이 복사·`req-config.test.ts`가 동기화 가드). 한쪽만 고치면 드리프트.
- **retry는 이번 범위에서 뺀다** — 초안은 pre-result 실패에 bounded retry를 넣었으나, (a) usage-limit·model-not-found 같은 비-일시 실패엔 무익하고, (b) 큰 timeout과 곱해 시간·토큰을 배로 쓰며, (c) codex provider에 이미 HTTP retry가 있고, (d) retryable(network/5xx) 분류 계약이 아직 없다. D6(원인 표면화)로 실제 표본을 모은 뒤 별도 REQ에서 설계한다.
- **`--fresh-thread`는 두 일을 겸한다** — (a) blocked 회로차단기 마커 초기화(`review-codex.ts:1090` `clearBlockedReview`), (b) 새 스레드 강제. P4가 (b)를 기본으로 만들어도 (a)는 명시 회복 경로로 남겨야 한다.
- **이 티켓의 design·phase-1 리뷰는 아직 옛(미고정) 경로를 탄다** — P1이 코드에 들어오기 전이므로. phase-1 커밋 이후의 리뷰부터 고정 인자가 적용된다. 이 아이러니를 감수한다.
