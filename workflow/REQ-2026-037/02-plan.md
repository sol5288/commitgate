# REQ-2026-037 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.** (이 티켓은 HIGH — 각 phase 커밋은 사람 확인.)

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고.

의존 방향: 설정(1) → 결정 로직(2) → 종단(3) → 문서·opt-in(4). 1은 런타임 무변경이라 안전하게 선행.

## Phase 1 — 설정 정책 배선 (`phase-1-config-policy`)

범위(D1/R1):
- `lib/config.ts`: `RawConfig`·`ResolvedConfig`에 `phaseCommit?: { autoApprove: 'never'|'low-only' }`,
  `DEFAULTS.phaseCommit = { autoApprove: 'never' }`, 인라인 `CONFIG_SCHEMA`에 `phaseCommit` 속성
  (object·additionalProperties:false·autoApprove enum), merged 블록에 병합(`reviewBudget` 패턴).
- `workflow/req.config.schema.json`: 동일 `phaseCommit` 속성(byte-정합).
- **런타임 동작 무변경** — resolveNext는 아직 이 값을 읽지 않는다.

테스트 오라클(`req-config.test.ts`):
- 설정 부재 → `loadConfig().phaseCommit.autoApprove === 'never'`(기본값).
- `{ phaseCommit: { autoApprove: 'low-only' } }` → `'low-only'` 반환.
- `{ phaseCommit: { autoApprove: 'sometimes' } }` → loadConfig throw(enum fail-closed, `reviewReasoningEffort` enum 테스트와 동형).
- 드리프트 가드(:296): `req.config.schema.json` deep-equal `CONFIG_SCHEMA` — 두 파일 동시 갱신으로 그린 유지.

Exit: eslint0·typecheck0 · 단위 그린 · Codex phase 리뷰 승인.

## Phase 2 — 자동 커밋 분기 (`phase-2-autocommit-branch`)

범위(D2/D3/R2/R4):
- `req-next.ts`: `NextInput`에 `phaseCommitAutoApprove: 'never'|'low-only'`; `resolveNext` 분기 1을 조건부
  (fail-closed: `low-only` AND `risk_level==='LOW'` AND `hasStagedChanges` → RUN `autoCommitCmd`; 그 외 →
  현행 `AWAIT_HUMAN`; `commit_allowed && !staged` → `--finalize` 안내 detail); `autoCommitCmd(pm,target)` 신설
  (`-m "<...>"` 자리표시); main() `resolveNext({...})` 호출에 `phaseCommitAutoApprove: cfg.phaseCommit.autoApprove` 추가.

테스트 오라클(`req-next.test.ts`, baseInput 기본 정책 명시):
- **auto**: `risk_level:'LOW'` + `commit_allowed:true` + staged + `low-only` → `kind==='RUN'`,
  `command`에 `req:commit`·`--run`·`-m` 포함, `nextExitCode('RUN')===0`.
- **HIGH 유지**: `risk_level:'HIGH'` + `low-only` + staged → `kind==='AWAIT_HUMAN'`,
  controlPoint `req:commit --run 직전`, approvalSentence `req:commit --run 승인`.
- **fail-closed 누락**: `risk_level` 부재/`'Low'`/`'MEDIUM'` + `low-only` → `AWAIT_HUMAN`(자동 아님).
- **never 무회귀(R8)**: 정책 `never` + LOW + staged → `AWAIT_HUMAN`(controlPoint·approvalSentence 현행 동일).
- **복구 가드(R4)**: `commit_allowed:true` + `!hasStagedChanges` + `low-only` + LOW → `AWAIT_HUMAN`, detail에
  `--finalize` 포함(자동 RUN 아님).
- **미설정 기본**: baseInput이 정책 필드를 안 주면 resolveNext가 `never`로 해소(auto 아님).
- **우선순위 회귀**: modelProblems(:188 중복 id·:283 argv-unsafe·:311 id 불일치) → BLOCKED가 여전히 선행
  (auto/AWAIT 둘 다보다 앞). commit_allowed가 legacy(1.5)보다 앞 유지.
- **target 보존**: auto RUN의 `command`에 `--ticket <dir>`(상대·절대)/positional reqId 보존.
- 깨지는 기존 assert 갱신: :71·:325·:372·:693·:730·:744·:826 — risk_level/정책을 명시해 의도한 kind로 재작성.

Exit: eslint0·typecheck0 · 단위 그린 · Codex phase 리뷰 승인.

## Phase 3 — 병합 단일 게이트 (`phase-3-merge-gate`)

범위(D4/R5):
- `req-next.ts`: 모든 phase 소비 + 워킹트리 clean 종단에서 `low-only` → `AWAIT_HUMAN`(controlPoint
  `통합(feature→main)`, 통합 승인 안내); `never` → 현행 `DONE`.

테스트 오라클(`req-next.test.ts`):
- 모든 phase consumed + clean + `low-only` → `kind==='AWAIT_HUMAN'`, controlPoint에 `통합`·`feature→main` 취지.
- 동일 상태 + `never`(및 미설정) → `kind==='DONE'`(현행 detail 유지, exit 11).
- legacy 종단 DONE 경로도 정책에 따라 동일 규칙(무회귀 확인).

Exit: eslint0·typecheck0 · 단위 그린 · Codex phase 리뷰 승인.

## Phase 4 — 문서·opt-in (`phase-4-docs-optin`)

범위(D5/R6/R7):
- `AGENTS.template.md` §4: LOW phase는 Codex 승인 후 자동 커밋(사람 정지 없음), HIGH는 매 phase 확인,
  `phaseCommit.autoApprove` 정책(never 기본|low-only) 명시. 보고 사유의 "HIGH commit 직전" 유지.
- `README.md`/`README.en.md`: 루프 설명(LOW 자동 커밋·AWAIT_HUMAN은 HIGH/escalation/terminal/legacy/통합에서),
  통제점 요약(라인 86)에서 per-phase `req:commit` 정지 제거 또는 HIGH-scope, config 표에 `phaseCommit` 행.
- `docs/ssot-design/07-…` 상태기계 C: S1 노드를 risk_level/정책 분기로(LOW+low-only→RUN auto commit;
  그 외→AWAIT_HUMAN). `docs/ssot-design/04-…` 통제점표: LOW는 통제점 아님(자동) 주석.
- `CHANGELOG.md` Unreleased: 동작 변경 + `phaseCommit.autoApprove` 신설(opt-in·기본 never) 기록. minor 범프 후보 명시.
- `req.config.json`: `phaseCommit.autoApprove: "low-only"` 추가(R7 dogfood).

Exit: typecheck0 · 문서 정합(SSOT↔코드) · Codex phase 리뷰 승인.
(문서 phase는 콘텐츠-assert 테스트가 없음 — init.test/package-payload는 이 문구를 검사하지 않음.)

## 완료
- 게이트 해당분(unit·typecheck·lint) · 사용자 main 머지(별도 승인 — 통합 통제점).
