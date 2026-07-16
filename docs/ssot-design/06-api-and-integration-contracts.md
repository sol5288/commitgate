# 06. API·연동 계약

CommitGate에는 HTTP API·웹훅·메시지 큐가 없다(`해당 없음`). "API"는 (1) **CLI 명령 계약**, (2) **Codex(외부 프로세스) 연동 계약**, (3) **git 연동 계약**, (4) **npm/npx 연동**이다. 각 계약을 생략 없이 표로 정리한다.

## 1. CLI 명령 계약(전수)

인자 파서는 각 스크립트의 `parseArgs`. 공통: 위치 인자(비-`-`) → `reqId`. **`req:new`·`req:next`·`req:doctor`·`req:commit`** 4개 파서는 bare `--`를 POSIX end-of-options로 흡수(이후 옵션은 계속 파싱)하고 **알 수 없는 `-…` 옵션 → throw(fail-closed)**([tests/unit/req-args.test.ts](../../tests/unit/req-args.test.ts)가 이 4개만 검증). 단 **`req:review-codex`의 `parseArgs`는 예외**: 미인식 `-…` 인자를 조용히 무시하며 bare `--` 특수처리도 없다([scripts/req/review-codex.ts](../../scripts/req/review-codex.ts) `parseArgs` L1148 — 최종 else 없음). 단, `--kind`/`--phase`는 잘못된 값이면 throw한다.

### 1.1 `req:new`([scripts/req/req-new.ts](../../scripts/req/req-new.ts))
| 항목 | 값 |
|---|---|
| 인자 | `<slug>`(위치, kebab), `--run`, `--risk LOW\|HIGH`(기본 LOW), `--title <v>`, `--root <v>` |
| 선행조건 | clean 워킹트리(scratch 제외) |
| 부작용(--run) | 브랜치 생성, 티켓 디렉터리+4문서+state.json, `git add`+스캐폴드 커밋 |
| 출력 | 계획/생성 요약 + 다음 단계 힌트(pm 파생) |
| 실패 | slug 누락/비-kebab, 더티 트리, 잘못된 플래그 → throw |
| exit | 성공 0, throw 시 비-0 |

### 1.2 `req:next`([scripts/req/req-next.ts](../../scripts/req/req-next.ts)) — 읽기 전용
| 항목 | 값 |
|---|---|
| 인자 | `<id>`(위치), `--ticket <v>`, `--root <v>`, `--json` |
| 부작용 | 없음(`createReadOnlyGit`: 허용 서브커맨드 `rev-parse/status/diff/ls-files`만, `--no-optional-locks` 강제) |
| 출력 | `kind`(RUN/AGENT/AWAIT_HUMAN/DONE/BLOCKED) + 명령/승인문장/diagnostics; `--json` 지원 |
| exit | RUN 0, AGENT 0, BLOCKED 2, AWAIT_HUMAN 10, DONE 11 |

`DONE`은 계산 결과이지 state 전이 이벤트가 아니다. 명령은 `state.phase`를 포함한 어떤 파일도 쓰지 않는다.

### 1.3 `req:review-codex`([scripts/req/review-codex.ts](../../scripts/req/review-codex.ts))
| 항목 | 값 |
|---|---|
| 인자 | `<id>`, `--kind design\|phase`(기본 phase), `--phase <id>`, `--run`/`--dry-run`, `--fresh-thread`, `--handoff <p>`, `--root <v>`, `--ticket <v>` |
| 선행 | 페르소나 유효, clean-tree, phase면 designValid, blocked<2회 |
| 부작용(--run) | codex 호출, `codex-response.json`·`.review-preview.txt` 기록, `state.json` verdict 적용, `responses/*.json` 아카이브 |
| 외부 전송 | phase: `git diff --cached` 전문 / design: 인덱스의 00/01/02 본문(`readDesignDocsFromIndex`) → Codex(OpenAI). 두 경우 모두 codex가 repo 루트 read-only 접근 |
| exit | approved 0, invalid 1, blocked 2, needs-fix 3 |

### 1.4 `req:doctor`([scripts/req/req-doctor.ts](../../scripts/req/req-doctor.ts))
| 항목 | 값 |
|---|---|
| 인자 | `<id>`, `--finalize`, `--root <v>`, `--ticket <v>` |
| 부작용 | 티켓 상태·소스 파일 변경 없음(검사만, 자동 수정 없음). 단 git 플러밍상 `git write-tree`가 `.git/objects`에 tree object를, `git status`(`--no-optional-locks` 미사용)가 `.git/index` stat-cache를 갱신할 수 있음(`req:next`가 이를 방지하는 것과 대비) |
| 출력 | D-체크별 OK/WARN/FAIL + 요약 |
| exit | FAIL≥1 → 1, 아니면 0 |

### 1.5 `req:commit`([scripts/req/req-commit.ts](../../scripts/req/req-commit.ts))
| 항목 | 값 |
|---|---|
| 인자 | `<id>`, `--run`, `-m/--message <v>`, `--message-file <f>`, `--finalize`, `--finalize-design`, `--root <v>`, `--ticket <v>` |
| 선행 | doctor PASS, `commit_allowed=true`, 유효 증거, staged==approved tree, HIGH면 사용자 확인 |
| 부작용(--run) | 소스 커밋 + evidence-finalize 커밋(2커밋), `consumeState` |
| 배타 | `--finalize`와 `--finalize-design` 동시 금지; `-m`과 `--message-file` 동시 금지 |
| exit | 성공 0, 게이트 실패 throw 비-0 |

정상 성공 뒤 `consumeState`는 로컬 `state.json`을 쓰지만 그 변경을 자동 커밋하지 않는다. 두 git 커밋의 성공과 실행 상태 뷰의 원격 내구화는 별개다.

### 1.6 설치기 `commitgate` / `commitgate uninstall`
| 명령 | 인자 | 부작용 |
|---|---|---|
| `commitgate` | `--dir <p>`, `--force`, `--dry-run`, `--strict`, `--no-agent-entrypoints`, `-h` | 파일 복사·주입(프리플라이트 통과 후). 커밋 없음 |
| `commitgate uninstall` | `--dir <p>`, `-h` | 없음(읽기 전용 계획만) |

## 2. Codex 리뷰 연동 계약

리뷰어 어댑터([scripts/req/lib/adapters.ts](../../scripts/req/lib/adapters.ts) `createCodexReviewerAdapter`)가 codex 프로세스를 호출한다. 프롬프트는 **stdin**으로 전달, 응답은 `--json` JSONL + `--output-last-message`로 수신.

### 2.1 argv 조립
override 인자(모델/추론강도)는 값이 있을 때만 주입: `-c model="<model>"`, `-c model_reasoning_effort="<effort>"`. `null`이면 생략(전역 상속). 주입 안전성은 `CONFIG_SCHEMA`의 모델 슬러그 pattern·effort enum이 보장(조립부에 이스케이프 없음).

| 경로 | argv(핵심) |
|---|---|
| exec(새 스레드) | `codex exec <override…> --json --sandbox read-only --output-schema <strict.json> --output-last-message <last> -` |
| resume(재개) | `codex exec resume <threadId> -c sandbox_mode="read-only" <override…> --json --output-schema <strict.json> --output-last-message <last> -` |

- resume는 `--sandbox`를 거부하므로 read-only를 `-c sandbox_mode="read-only"`로 강제.
- **현재 라이브 경로는 항상 exec(stateless)**: `main()`이 `isResume=false` 고정([scripts/req/review-codex.ts](../../scripts/req/review-codex.ts) 주석 — resume 누적이 토큰 증가·목표 이동을 유발해 비활성). resume argv는 향후 opt-in용으로 보존.

### 2.2 출력 스키마(strict)
`deriveStrictOutputSchema`([scripts/req/lib/adapters.ts](../../scripts/req/lib/adapters.ts))가 원본을 파싱→수정→직렬화한 **파생 copy**를 만들어 `--output-schema`로 넘긴다. 원본 `machine.schema.json`은 **검증 SSOT로 불변**이며, 응답·아카이브 검증에는 계속 원본을 쓴다. 파생은 두 가지를 적용한다.

1. **root `required` = `Object.keys(properties)` 전체**(REQ-2026-005) — OpenAI structured-outputs strict 모드는 모든 키를 required로 요구한다. 원본은 검증 SSOT로 남아 `observations`가 선택으로 유지된다.
2. **`findings[].severity.enum` = `["P1"]`**(REQ-2026-018) — 리뷰어가 P2/P3를 차단 채널에 낼 수 없게 한다. 검증 enum(`P1|P2|P3`)은 그대로 두어 기존 아카이브 하위호환을 유지한다 → [03 §4.2](03-domain-and-data-model.md).

파생이 스키마를 **통째로 복사**하므로 `description`도 함께 전달된다. P1 정의(4요소)와 `commit_approved` 승인 규칙이 리뷰어에게 닿는 경로가 바로 이것이다 — 별도 배선이 없다.

**경로 부재 시 throw(fail-closed)**: `properties.findings.items.properties.severity.enum`이 없으면 파생이 조용히 건너뛰지 않고 throw한다 → 리뷰 실패 = 승인 불가. 건너뛰면 P2가 다시 차단 채널로 들어오는 **정책 구멍**이 스키마가 깨진 순간에만 열려 아무도 눈치채지 못한다. `machine_schema_version`이 `1.1`로 고정된 MANAGED 파일이므로 정상 경로에서 이 throw는 발생하지 않는다.

> **하위호환 주의**: 구버전 스키마(severity description·MANAGED 갱신 이전)를 가진 기존 설치본은 이 강제가 **적용되지 않을 뿐** 리뷰는 계속 동작한다.

### 2.3 스레드·응답 파싱
`parseThreadId`가 JSONL에서 `type==='thread.started'`의 `thread_id`를 추출. null이면 `thread_id 파싱 실패`로 throw. `lastMessage`는 `--output-last-message` 파일에서 읽음.

### 2.4 검증 파이프라인
1. **AJV 구조 검증**(`validateResponseStructure`, `Ajv({allErrors:true})`).
2. **도메인 검증**(`validateVerdict`): 스키마 버전 `1.1` 고정, enum, `review_base_sha` 일치(비교 기준은 **리뷰 시점에 캡처한 현재 `git rev-parse HEAD`** — `captureGitBinding`의 `reviewBaseSha`이며, 기존 `state.review_base_sha`가 아니다), NEEDS_FIX면 findings 비어있지 않고 `next_action` 비공백, 교차모순(yes+NEEDS_FIX / merge_ready 규칙), **R10**(yes+findings≠[] → 모순).
3. **kind/설계 검증**: 응답 `review_kind`가 요청 kind와 불일치 → `kindMismatch`; design인데 해시 없음 → `designHashMissing`; design인데 설계 유효성 실패 → `designBlocked`.
4. `ok = 구조 && 도메인 && !kindMismatch && !designHashMissing && !designBlocked`.

### 2.5 실패·재시도 처리
- codex 프로세스 실패(exit≠0)는 `safeSpawnSync`가 `명령 실패(exit=...)`로 throw. **조용한 승인 없음**.
- blocked(지적 없음+미승인)는 회로차단: 같은 대상 `count>=2` 누적이면 codex 호출 없이 exit 2. 회복은 사람이 `--fresh-thread`(마커 초기화로 count 리셋). "1회만"은 계약 지침이며 코드가 사용 횟수를 강제하지 않는다.
- 재리뷰는 **stateless**(새 스레드). 직전 같은 대상 NEEDS_FIX findings만 "지시가 아닌 데이터" 블록으로 참고 삽입(프롬프트 주입 방어: 구분자 중성화 `<<<|>>>`→`⟪⟫`).

> **알려진 진단 함정**([codex 조사]/사용자 메모리): `명령 실패(exit=1): codex`는 대개 usage limit이다. 어댑터는 stderr만 읽는데 codex가 오류를 stdout에 쓰는 경우가 있어 진단이 유실될 수 있다. [gaps-and-decisions.md](gaps-and-decisions.md) 참조.

## 3. git 연동 계약

[scripts/req/lib/adapters.ts](../../scripts/req/lib/adapters.ts) `createGitAdapter`: `run('git', args, {cwd:root, encoding:'utf8', maxBuffer:64MiB})` 후 **후행 공백만 trim**(porcelain 선행 XY 공백 보존). 사용하는 git 명령:

| 목적 | git 명령 | 사용처 |
|---|---|---|
| 기준 SHA | `rev-parse HEAD` | `captureGitBinding` |
| staged 트리 OID | `write-tree` | 승인 바인딩(phase) |
| 인덱스 해시(읽기) | `ls-files -s` → sha256 | `captureIndexHash`(next는 write-tree 불가) |
| 설계 바인딩 | `ls-files -s -- 00/01/02` → 정렬 sha256 | `captureDesignBinding`(정확히 3개 tracked) |
| 인덱스 내용 | `show :<path>` | `readDesignDocsFromIndex` |
| staged diff | `diff --cached` | phase 권위 아티팩트 |
| 워킹트리 상태 | `status --porcelain=v1 -z --untracked-files=all` | `parseStatusZ` |
| 브랜치 | `rev-parse --abbrev-ref HEAD`, `rev-parse --verify --quiet refs/heads/<b>` | D2/D3 |
| 커밋 | `checkout -b`, `add`, `commit -m/-F`, `revert`(uninstall 안내) | new/commit |

`git status`는 `-z` 사용(경로에 `"`/`\`/제어문자/비ASCII가 있어도 C-quote로 깨지지 않게). rename/copy는 `-z`에서 NEW 먼저·OLD 다음 순서([scripts/req/lib/porcelain.ts](../../scripts/req/lib/porcelain.ts)).

## 4. npm/npx 연동
- 배포 산출물은 `package.json` `files[]`로 화이트리스트(`scripts/req`, `workflow/*.schema.json`, `review-persona.md`, `bin`, `templates`, `AGENTS.template.md`, `req.config.json.sample`, README, CHANGELOG 등).
- `npx commitgate`는 전역 설치가 아니라 npm 캐시 `_npx/<hash>/`에서 1회 실행([README.md](../../README.md) 제거 섹션).
- 설치기가 대상 `package.json`에 주입: 스크립트 `req:new/review-codex/doctor/next/commit` = `tsx scripts/req/*.ts`; devDeps `ajv ^8.20.0`, `cross-spawn ^7.0.6`, `tsx ^4.19.1`(기존 키는 보존, 없는 키만 주입)([bin/init.ts](../../bin/init.ts) `REQ_SCRIPTS`/`REQ_DEV_DEPS`).

## 5. 멱등성·레이트 제한·부작용 요약

| 명령 | 멱등성 | 레이트 제한 | 주요 부작용 |
|---|---|---|---|
| `req:new` | 아니오(채번 증가) | 없음 | 브랜치·티켓·커밋 |
| `req:next` | 예(읽기 전용) | 없음 | 없음 |
| `req:review-codex` | 조건부(재리뷰 안전, 라운드 증가) | Codex 계정 usage limit(외부) | state·아카이브 |
| `req:doctor` | 예 | 없음 | 티켓 상태·소스 변경 없음(단 git `write-tree`가 `.git/objects`, `status`가 `.git/index` stat-cache 갱신 가능 — §1.4) |
| `req:commit` | 조건부(evidence-finalize 중복 skip) | 없음 | 2커밋·state |
| `commitgate`(install) | 예(기존 보존, 재실행 skip) | 없음 | 파일 복사·주입 |
| `commitgate uninstall` | 예(읽기 전용) | 없음 | 없음 |

## 6. 목표 API와 현재 API의 경계

[14-product-strategy-and-roadmap.md](14-product-strategy-and-roadmap.md)의 `commitgate verify`, `req:repair`, `req:report`, `commitgate status --explain`, `commitgate upgrade --plan`은 **제안된 인터페이스**이며 0.6.0에는 존재하지 않는다. 재구현 시 위 §1의 실제 명령에 임의로 추가하지 않는다. 구현될 때는 다음 공통 계약을 먼저 고정해야 한다.

- 안정적 machine-readable 오류 코드와 전 명령 JSON envelope
- evidence/event schema version 및 하위호환 정책
- read-only 명령의 git capability allowlist
- 외부 전송 manifest와 호출 전 정책 결과
- dry-run과 live-run의 동일 판정 코어
