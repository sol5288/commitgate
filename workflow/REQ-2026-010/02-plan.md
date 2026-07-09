# REQ-2026-010 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

> **phase-1의 1a/1b 분할은 편의가 아니라 안전 요건이다** (01-design D3-1). `review-persona.md`를 대상 repo에 **깔아 놓기 전에** fail-closed 소비를 켜면 신규 설치본의 모든 리뷰가 멈춘다. 설치 → 소비 순서를 phase 경계로 강제한다.

## Phase 1a — persona 파일 + 설치/제거 배선 (`phase-1a-persona-install`)

범위 (8파일):
- `workflow/review-persona.md` (신규) — D5 매핑표대로. **가드레일 필수**: 승인은 findings 0건 / 비차단은 observations / 부채를 findings로 밀어 올리지 말 것.
- `scripts/req/lib/config.ts` — `export const DEFAULT_REVIEW_PERSONA_RELPATH = 'workflow/review-persona.md'` **만** 추가(소비 없음).
- `bin/init.ts` — `KIT_COPY_RELPATHS = [...KIT_SCHEMA_RELPATHS, DEFAULT_REVIEW_PERSONA_RELPATH]` 신설, 복사기가 이를 사용. `KIT_SCHEMA_RELPATHS`는 **불변**(uninstall의 schemaPath 축 판정 보존).
- `bin/uninstall.ts` — `tool` 분류를 `KIT_COPY_RELPATHS` 기준으로. **경로 축만** — `reviewPersonaPath` config 해소는 이 phase에 존재하지 않는 키라 불가(1b로 이관, design R3 P3).
- `package.json` — `files[]`에 `workflow/review-persona.md`.
- `tests/unit/init.test.ts` — **`KIT_COPY_RELPATHS`가 `DEFAULT_REVIEW_PERSONA_RELPATH`를 포함**(P1 재발 방지 회귀) · 복사 대상에 persona 포함 · dry-run 무쓰기.
- `tests/unit/uninstall.test.ts` — persona가 `tool`로 분류되고 바이트 동일 시 `identical`.
- `tests/unit/package-payload.test.ts` — 신규 파일이 payload 스캔 대상에 포함, 대조군 유지.

Test-First: `init.test.ts`의 SSOT 포함 단언을 Red로 먼저.

Exit: typecheck 0 · 단위 그린 · `npm pack --dry-run --json` payload에 `workflow/review-persona.md` 포함(격리된 `npm_config_cache`) · Codex phase 리뷰 승인.

## Phase 1b — persona 프롬프트 주입 + fail-closed (`phase-1b-persona-inject`)

전제: **1a 커밋 완료**(대상 repo·이 repo 모두 `workflow/review-persona.md` 존재).

범위 (8파일):
- `scripts/req/lib/config.ts` — `RawConfig`·`ResolvedConfig`·`DEFAULTS`·`CONFIG_SCHEMA`에 `reviewPersonaPath`, confinement 적용(D2), `reviewPersonaPathAbs` 파생.
- `workflow/req.config.schema.json` — 같은 키 추가(양쪽 스키마 동기).
- `scripts/req/review-codex.ts` — `ReviewPromptInput.persona` + **첫 블록**(D1), `main()`에서 읽기 + **부재 시 throw**(D3). `assembleReviewPrompt`는 순수 유지(파일 미읽기).
- `req.config.json.sample` — `reviewPersonaPath` 추가.
- `bin/uninstall.ts` — 해소된 `reviewPersonaPath`가 `DEFAULT_REVIEW_PERSONA_RELPATH`와 다르면 info(설정 축, `schemaPath`와 대칭). **이 phase에서야 키가 존재**한다(design R3 P3).
- `tests/unit/req-config.test.ts` — 기본값 = `DEFAULT_REVIEW_PERSONA_RELPATH` · confinement(절대경로·탈출 거부) · `null` 비활성 · unknown key 거부 · **`init`이 config에 이 키를 주입하지 않음**(D4).
- `tests/unit/req-review-codex.test.ts` — persona가 첫 블록 · 빈 문자열/공백 생략 · `null` 생략 · 파일 부재 throw · `assembleReviewPrompt` 순수성.
- `tests/unit/uninstall.test.ts` — 설정 축 info(커스텀 `reviewPersonaPath`).

Test-First: `req-config` → `req-review-codex` 순으로 Red.

Exit: typecheck 0 · 단위 그린 · **이 repo 자신의 다음 리뷰가 persona 블록을 포함**(`.review-preview.txt` 첫 블록 육안 확인) · Codex phase 리뷰 승인.

## Phase 2 — `req:next` 상태기계 명령 (`phase-2-req-next`)

범위 (7파일):
- `scripts/req/req-next.ts` (신규) — 순수 `resolveNext(input): NextAction`(D6 판정표 10분기 + G1/G2 게이트) + IO만 하는 `main()`. `--json` 출력. **`captureGitBinding` 호출 금지**(write-tree). **`blocked_review` 미참조**(tree OID 재계산 불가 → stale 판정 불가, design R5 P2). 모든 git 호출은 `--no-optional-locks` 래퍼 경유.
- `scripts/req/review-codex.ts` — `resolveReviewOutcome`이 `last_review` 자문 마커 기록(D6-2): `outcome` 4종 + `compare_hash` + **`count`**(같은 target 반복 카운터) + **`errors`**(`invalid`일 때만, 20×500자 상한). `compare_hash` = design은 기존 `designHash`, phase는 `sha256(sorted(git ls-files -s))`. **어떤 게이트도 이 필드를 읽지 않는다.**
- `bin/init.ts` — `REQ_SCRIPTS`에 `req:next` 추가(D9).
- `package.json` — `scripts["req:next"]`.
- `tests/unit/req-next.test.ts` (신규) — 아래 참조.
- `tests/unit/req-review-codex.test.ts` — `last_review` 기록(4가지 outcome) · `compare_hash` 산식 · `count` 증가/리셋(target 동일/변경) · **`errors`는 `invalid`일 때만 채워지고 상한(20×500)이 적용됨** · **승인 바인딩(`approved_diff_hash`)은 여전히 tree OID**(D9 불변 회귀).
- `tests/unit/init.test.ts` — 주입 스크립트 5개 단언 갱신, 기존 키 미덮어씀 유지.

Test-First: 판정표 분기 + G1/G2 + allowlist를 Red로 먼저.

고정할 불변식(테스트로):
- **진행도 정본은 `consumed_approvals[].phase_id`**이지 `phases[].approved`가 아니다. `approved`는 sticky(`applyVerdict`가 `false`로 되돌리지 않음)라, 승인 후 재리뷰 NEEDS_FIX 상태에서 `approved` 기준으로 세면 대상 phase가 0개가 되어 판정이 무너진다. **회귀 테스트로 이 상태를 재현**한다.
- **G2(바인딩 신선도)는 outcome-aware다** — 같은 `(kind, phase_id)` + 같은 `compare_hash`일 때 `last_review.outcome`별로 분기한다. 5행 전부 테스트:
  | outcome | 기대 | 회귀 의도 |
  |---|---|---|
  | `needs-fix` | `AGENT` | NEEDS_FIX 후 무한 `RUN` 루프 방지 |
  | `blocked` | `BLOCKED` | findings 0건에 "수정하라"는 지시 금지 (`AGENTS.md` §3) |
  | `invalid` + `count===1` | `RUN` | 일시적 파손 응답 1회 재시도 |
  | `invalid` + `count>=2` | `BLOCKED` + `last_review.errors` 출력 | 반복 = 도구/스키마 문제 → 에스컬레이션 |
  | `approved` | `BLOCKED`(방어적) | 1번에서 걸러지므로 도달 불가 |
  **바인딩을 바꾸면(다른 `compare_hash`) 5행 전부에서 `RUN`이 나오는지도 테스트** — stale 마커가 진행을 막지 않음을 고정.
- **`req:next`는 `blocked_review`를 읽지 않는다**(design R5 P2). 그 마커의 `review_binding`은 tree OID라 재계산 불가 → stale 판정 불가. **회귀 테스트: `blocked_review.count>=2`가 있어도 `compare_hash`가 다르면 `RUN`이 나온다.** 강제는 `review-codex`의 `shouldShortCircuitBlockedReview`가 계속 담당(exit 2).
- **`req:next`는 `--fresh-thread`를 자동 지시하지 않는다** — `clearBlockedReview()`가 마커를 지워 회로차단기가 무력화된다. 테스트로 고정(`blocked` 분기 출력에 `--fresh-thread` 명령이 없음).
- **G1(D10 전제)**: staged 있음 + unstaged/untracked 있음 → `RUN`이 아니라 `AGENT`. `findUnstagedOrUntracked`를 재사용(복제 금지).
- **`last_review` 부재(구 state) → G2 통과(`RUN`)** — fail-forward. 여기서 막으면 구 티켓이 진행 불가.
- **`req:next`는 검증기를 다시 돌리지 않는다** — `invalid` 진단은 `last_review.errors`에서 읽는다. `codex-response.json` 재파싱·AJV 재실행 없음(순수·읽기 전용 유지). 테스트로 고정.
- 1번(`commit_allowed=true` → AWAIT_HUMAN)이 8·9번보다 **앞** — 뒤집히면 D9가 깨진다.
- 2번(문서 미인덱스 → AGENT)이 3번(design freshness)보다 **앞** — `captureDesignBinding` throw가 새지 않는다. `resolveNext`는 `currentDesignHash: string | null`을 **입력으로** 받는다.
- 4번과 5~7번이 `approval_evidence_required` **필드 존재 여부**로 갈린다 — 레거시 티켓이 4번에 묶이지 않는다.
- 5번은 **staged 변경 있음**으로 좁혀져 있고, 7번(`DONE (legacy)`)이 "소비 이력 있음 + clean"을 잡는다 — 레거시가 `DONE`에 도달할 수 있다.
- 10번 `DONE`은 `phases[].id` 전부가 `consumed_approvals[].phase_id`에 있을 때만.
- fallback은 `DONE`이 아니라 `BLOCKED`.

읽기 전용 검증 3단(D6-1):
1. allowlist — fake adapter가 받은 호출의 첫 subcommand(전역 플래그 제외)가 allowlist에 있는지. `write-tree` 등장 시 실패.
2. `--no-optional-locks` — 모든 호출의 `args[0]` 단언.
3. no-write 회귀 — 임시 repo를 **stat cache dirty**(내용 동일·mtime만 변경) 상태로 만든 뒤 실행. `.git/objects` 목록 · **`.git/index` 바이트** · `state.json` 바이트 · `git status` 출력 전후 동일. clean repo에서는 우연히 통과하므로 dirty가 요점.

Exit: typecheck 0 · 단위 그린 · `npm run req:next -- 2026-010`이 실제 티켓 상태에서 올바른 분기 출력 · Codex phase 리뷰 승인.

## Phase 3a — 진입점 템플릿 + 설치 (`phase-3a-entrypoint-install`)

범위 (8파일):
- `templates/claude-skill.md`, `templates/claude-command.md`, `templates/cursor-rule.mdc`, `templates/CLAUDE.template.md` (신규 4종) — 얇은 포인터(D7). 계약 본문 복제 금지. `AGENTS.md` 마커 부재 시 fallback 문구 포함.
- `AGENTS.template.md` — `<!-- commitgate:contract -->` 마커 추가. **마커 경고 로직과 같은 phase여야 테스트가 성립**한다.
- `bin/init.ts` — `KIT_AGENT_ENTRYPOINTS`(D8) + `src→dest` 복사기 + `CLAUDE.md` 부재 시 생성 + `AGENTS.md` 마커 경고 + `--no-agent-entrypoints` opt-out. **preflight에서 대상 부모 디렉터리 쓰기 검사**(부분 설치 방지).
- `package.json` — `files[]`에 `templates`.
- `tests/unit/init.test.ts` — 신규 복사 대상 · 중첩 디렉터리 생성 · 비파괴(기존 `.claude/commands/req.md` 미덮어씀) · `--no-agent-entrypoints` · 마커 경고 · dry-run 무쓰기.

Exit: typecheck 0 · 단위 그린 · `npm run smoke` 통과 · Codex phase 리뷰 승인.

## Phase 3b — 진입점 제거 계획 분류 (`phase-3b-entrypoint-uninstall`)

범위 (2파일):
- `bin/uninstall.ts` — 진입점 3종 `tool`(`src≠dest` sha256 비교 — `ToolArtifact`에 원본 절대경로 분리), `CLAUDE.md` `ambiguous`.
- `tests/unit/uninstall.test.ts` — 분류 정확성(tool vs ambiguous) · `src≠dest` 비교 경로 · 편집된 진입점은 `differs`(자동 제거 후보 제외).

Exit: typecheck 0 · 단위 그린 · **실 sandbox 검증**(임시 git repo → pack tarball 설치 → `commitgate` bin 실행 → 진입점 5개 파일 생성 확인 → `commitgate uninstall`이 tool/ambiguous 올바르게 분류. 격리된 `npm_config_cache`) · Codex phase 리뷰 승인.

## Phase 4 — 문서 갱신 + 버전 (`phase-4-docs-version`)

범위 (4파일):
- `README.md` / `README.en.md` — Quick Start를 "긴 프롬프트 붙여넣기"에서 "설치 후 `/req` 또는 요구사항 입력"으로 교체. `req:next` 명령표 · `reviewPersonaPath` 설정표 · `--no-agent-entrypoints` · 제거 절차에 신규 파일 반영.
- `package.json` + `package-lock.json` — `0.4.0` (분리 커밋).

`AGENTS.template.md`의 명령표에 `req:next` 추가와 "페르소나는 도구 주입"은 phase-3a에서 마커와 함께 처리하거나 여기서 마무리한다(마커 자체는 3a 필수).

Exit: typecheck 0 · 단위 그린 · Codex phase 리뷰 승인.

## 수행하지 않는 것 (별도 통제점)

- `v0.4.0` tag 생성·push (`[R1]`)
- `npm publish` (`[R2]`)
- GitHub release (`[R3]`)
- main 반영 (`[I1]`/`[I2]` PR 경유 또는 `[B1]` direct push)

## 완료

- 게이트 해당분(unit·typecheck) · phase 6개 전부 Codex 승인 · `req:commit` 6회(각각 사용자 확인) · 사용자 main 반영(별도 승인).
