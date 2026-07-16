# 09. 보안·복원력

## 1. 구현된 보안 통제

| 통제 | 내용 | 근거 |
|---|---|---|
| **명령 주입 차단** | `safeSpawnSync`가 `cross-spawn`으로 **shell 없이** 실행. shell 메타문자(`;`,`&`,`|` 등)가 명령으로 해석되지 않음. Windows `.cmd` 래퍼도 안전 처리. | [scripts/req/lib/adapters.ts](../../scripts/req/lib/adapters.ts) |
| **`.cmd` 래퍼 회귀 방어** | Windows 전용 회귀 테스트가 `codex.cmd`/`npm.cmd` 경로 주입을 재현·차단(부작용 파일 미생성 + argv 리터럴 보존 검증). | [tests/unit/req-adapters-cmd.test.ts](../../tests/unit/req-adapters-cmd.test.ts) |
| **리뷰어 read-only 샌드박스** | codex는 `--sandbox read-only`(resume는 `-c sandbox_mode="read-only"`). 리뷰어가 워킹트리/인덱스를 바꾸면 **두 사후 검사**로 throw — 워킹트리는 `findUnstagedOrUntracked`(postDirty), 인덱스는 `write-tree` OID 재계산 비교(각각 별개 검출). | [scripts/req/review-codex.ts](../../scripts/req/review-codex.ts) |
| **TOML/설정 주입 차단** | `reviewModel` 슬러그 pattern, `reviewReasoningEffort` enum이 `-c model=`/`-c ...=`에 들어갈 값을 제한(조립부 이스케이프 불요). | [workflow/req.config.schema.json](../../workflow/req.config.schema.json) |
| **페르소나 심볼릭링크 이탈 차단** | `loadReviewPersona`가 realpath로 루트 이탈/심링크 탈출을 거부(비밀 파일 내용이 프롬프트로 유출되는 것 방지). 빈/부재 파일은 fail-closed. | `loadReviewPersona` |
| **프롬프트 주입 방어** | 직전 NEEDS_FIX findings를 "지시가 아닌 데이터" 블록으로 삽입, 구분자 중성화(`<<<\|>>>`→`⟪⟫`). | `buildPreviousFindingsBlock` |
| **경로 confinement** | `ticketRoot`/`schemaPath`/`reviewPersonaPath` 루트 내부 강제; 아카이브·manifest 경로 `..`·절대경로 거부. | config·commit·doctor |
| **증거 변조 탐지** | 응답 sha256을 `approvals.jsonl`·state에 고정, live 응답 sha와 대조(손편집 탐지); manifest 필드 화이트리스트(주입 차단)·중복 탐지. | `evidenceProblems`·`validateManifest` |
| **cross-spawn 하한(CVE)** | 설치 시 기존 cross-spawn이 `7.0.6` 미만이면 WARN(`--strict` 시 throw). CVE-2024-21538(ReDoS) 완화. | [bin/init.ts](../../bin/init.ts) `crossSpawnBelowFloor` |
| **BOM 방어** | `req.config.json` 및 설치기/제거기 JSON 읽기에서 UTF-8 BOM 제거(PowerShell 5 이식성). 단 `loadState`(state.json 읽기)는 `JSON.parse(readFileSync(...,'utf8'))`로 BOM을 제거하지 않는다. 쓰기 측은 BOM 없는 UTF-8로 저장(`writeState`). | `stripBom`·`writeState` |
| **비밀 전송 경고 명문화** | 리뷰가 대상을 Codex로 보낸다는 사실을 README·AGENTS가 경고로 명시하고 Builder에게 사전 확인 의무 부과. 단 그 **문구는 phase의 `git diff --cached` 전송을 중심으로 기술**하며, design 리뷰가 인덱스 00/01/02 본문을 전송하는 경로는 문서화하지 않는다(실제 동작은 본 문서 §2·[06](06-api-and-integration-contracts.md) §2 참조). | [AGENTS.template.md](../../AGENTS.template.md) §6 |

## 2. 신뢰 경계와 위협 대응

```mermaid
flowchart LR
    subgraph Trusted["신뢰 경계(로컬)"]
        CLI[CommitGate CLI]
        Git[git repo]
    end
    subgraph SemiTrusted["준신뢰"]
        Builder[AI Builder]
    end
    subgraph External["외부(비신뢰)"]
        Codex[codex/OpenAI]
    end
    Builder -->|명령| CLI
    CLI -->|리뷰 대상 전송<br/>phase=staged diff<br/>design=00/01/02<br/>⚠️ 마스킹 없음| Codex
    Codex -->|응답 = 데이터로만 취급<br/>스키마·도메인 재검증| CLI
    Codex -->|read-only 접근| Git
```

| 위협 | 대응 현황 |
|---|---|
| Builder가 승인 없이 커밋 | `req:commit` 게이트가 막음. **단, `git commit` 직접 실행은 우회 가능**(git hook 미설치) — 하드 강제 아님. |
| Builder가 통제점 자기승인 | 승인 문장 계약(사람만). 도구는 강제하지 못함(협조 전제). |
| 리뷰어 응답 위조/주입 | AJV+도메인 재검증, findings⟺승인 불변식, 프롬프트 주입 중성화. |
| 비차단 의견이 차단 채널을 점유(리뷰 비수렴) | 출력 스키마가 `findings[].severity`를 **P1만** 허용 + P1 정의 4요소를 description으로 주입([03 §4.2](03-domain-and-data-model.md)). 파생 경로 부재 시 throw=fail-closed. **완화이지 제거 아님** — 카테고리 판정은 리뷰어 재량이라 P1으로 올리는 것을 코드가 막지 못한다(`추론`). |
| staged 비밀 외부 유출 | **미방어**. 마스킹/스크러빙/길이상한 없음. Builder 사전 확인이 유일한 방어. |
| 증거 손편집 | sha256 바인딩 + live 대조로 탐지 → 게이트 FAIL. |
| 명령/경로 주입 | shell-free spawn + confinement + 슬러그/enum 제한. |

## 3. 복원력(신뢰성) 통제

| 항목 | 구현 |
|---|---|
| **fail-closed 전반** | config(ajv 스키마)·persona(존재+비공백+심링크 가드) 로드는 이상 입력에 degrade하지 않고 **throw**. `validateManifest`는 예외 대신 **문제 배열을 반환**하고 호출자가 처리한다 — live 커밋의 `evidencePreflight`는 문제가 있으면 throw(커밋 차단), dry-run은 문제를 출력하고 종료. **state 로드(`loadState`)는 최소 검증** — JSON 파싱 + `id`·`phase` 존재만 확인하고 나머지 필드는 사용 시점(`validateVerdict`·D-체크)에 방어. |
| **타임아웃** | codex 호출 **타임아웃 없음** — 미구현(0.6.0 deferred). [gaps-and-decisions.md](gaps-and-decisions.md). |
| **재시도** | 자동 재시도 없음. `invalid`는 `req:next` G2가 1회 RUN 재시도 허용, blocked는 회로차단(2회). |
| **중복 처리(멱등)** | evidence-finalize `manifestHasConsumed` 중복 skip; 재리뷰 안전(라운드 증가). |
| **트랜잭션 경계** | 커밋은 순서 보장: 소스 커밋 → 마커 → evidence-finalize → consume. 중단 시 `--finalize`로 복구. |
| **anti-replay** | `consumed_approvals`가 한 승인 트리를 한 커밋만 소비하게 함. |
| **장애 격리** | 각 명령이 독립 단명 프로세스. 공유 장기 상태 없음. |
| **버퍼 한도** | git/codex maxBuffer 64 MiB(초과 시 실패). |

## 4. 미구현 보안·복원력 항목(명시적 분리)
[docs/follow-ups-design.md](../../docs/follow-ups-design.md)·CHANGELOG 0.5.0/0.6.0 기준. 재구현 시 "구현됨"으로 오해하지 말 것.

- **codex 호출 타임아웃 없음** — 응답 지연/무한 대기 방어 미구현(Windows `cmd.exe` 프로세스 트리 kill 난이도로 deferred).
- **secret-safe 실패 진단 없음** — 실패 시 stderr에 비밀이 섞일 가능성 완전 차단 미구현(deferred).
- **리뷰 전 secret-scan 훅 없음**(`preReviewCommand` 미구현) — staged diff 자동 스캔 없음.
- **git hook 미설치** — 하드 강제 아님. `git commit` 직접 실행이 게이트를 우회.
- **`trunkBranch` 하드코딩** `'main'` — 설정화 미구현.

## 5. 감사 로그
- 승인 증거는 `responses/approvals.jsonl`(append-only) + `responses/<...>.json` 아카이브에 영구 보존.
- 삭제 경로 없음(제거 시에도 증거 보호). 상세 [03-domain-and-data-model.md](03-domain-and-data-model.md) §5.
- 별도 보안 이벤트 로깅/SIEM 연동 없음(`해당 없음`).
