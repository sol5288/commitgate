# REQ-2026-154 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고.

> **테스트 실행 계층(REQ-2026-100)**: 게이트는 테스트를 **실행하지 않는다**.
> - **phase 진행 중**: 변경 영역 테스트 + `tests/unit/dispatch.test.ts`.
> - **통합 직전 1회**: **전체 스위트**(`npm test`) + `bin/verify-range.ts --base main --head HEAD --strict`.
>   🔴 `verify-range` 는 `scripts/req/` 가 아니라 **`bin/`** 이고 인자는 `--base`/`--head` 다.

🔴 **선행**: 설계 승인 직후 `state.json` 의 `phases[]` 에 아래 세 id 를 선언한다.

```
phase-1-consume-binding · phase-2-gitignore-relaxation · phase-3-porcelain-path-fidelity
```

## Phase 1 — consume 결속 (`phase-1-consume-binding`)

범위: 쓰기 전 대조 · SHA 소문자 정규화 · 복구 창 verb 차단 · **틀린 fixture 정정**.

Exit:
- 🔴 **fixture 정정이 먼저다**(결함 5). 지금 consume e2e 는 `consumed_state_sha256` 이 실제 소비
  state 와 다른데도 green 이다(실측: `bc4eacbc…` ≠ `521ee556…`).
  → fixture 의 기대 state 를 **소비 규칙과 독립적으로** 정확히 구성하고,
  → 🔴 **`sha256(HEAD:state.json) === 매니페스트 결속값`** assert 를 e2e 에 **추가**한다.
  이 assert 가 없으면 이 phase 의 다른 오라클도 믿을 수 없다.
- 🔴 **결함 1 재현 e2e**: evidence 커밋 뒤 → state 를 바꿔 checkpoint 커밋(= `req:repolicy` 가 하는 일)
  → `--finalize --run` 이 **write 전에 거부**한다. 거부 후 워킹 state 가 **바뀌지 않았다**.
- 🔴 안내대로 `git checkout -- <ticket>/state.json` 을 실행하면 **다음 `--finalize` 가 성공**한다
  (안내는 실행돼야 안내다 — e2e 로 이어서 확인).
- 🔴 **결속이 없는 옛 행은 대조를 건너뛴다** — 옛 crash window 무회귀(회귀 테스트).
- 🔴 **정상 경로(`!already`)에는 대조를 넣지 않는다** — 자기 자신을 비교하는 동어반복 금지(소스 가드).
- 🔴 **대문자 SHA 무회귀**(결함 4): 매니페스트에 `"E".repeat(64)`, 워킹 state 해시 `"e".repeat(64)`
  → **정상 복구된다**. `BindingLookup.sha` 가 소문자로 정규화돼 나온다(순수 테스트).
- 🔴 **`req:repolicy` 가 복구 창에서 거부**한다: `--run` 은 거부하고 **state 를 쓰지 않으며**
  커밋 수가 불변. `--run` 없는 호출(dry-run)은 **그대로 동작**한다.
- 🔴 **복구 창이 아니면 `req:repolicy` 무회귀** — 기존 테스트가 그대로 통과한다.
- 🔴 **변이 검사 3건**: ① 쓰기 전 대조를 지우면 결함 1 e2e 가 red ② 소문자 정규화를 지우면
  대문자 테스트가 red ③ `req:repolicy` 가드를 지우면 그 테스트가 red.
- 계약 스위트: `npx vitest run tests/unit/evidence-recovery.test.ts tests/unit/evidence-recovery-wiring.test.ts tests/unit/req-commit.test.ts tests/unit/policy-snapshot.test.ts tests/unit/dispatch.test.ts`
- Codex 승인.

## Phase 2 — `.gitignore` 완화·삭제 (`phase-2-gitignore-relaxation`)

범위: 안내에 검증 줄 추가 · 멈춤 계약 명시 · 완화·삭제 e2e.

Exit:
- 🔴 **결함 2 재현 e2e**: HEAD `.gitignore` 에 `node_modules/` 가 있고 그 디렉터리가 존재하는
  상태에서 **규칙을 삭제** → 종결 티켓 차단 → 안내대로 커밋 →
  **`git status --porcelain` 이 비어 있지 않다**는 것을 e2e 가 확인한다(= 안내가 여기서 멈추라고
  말한 지점). 실측 재현 완료: pop 뒤 `?? node_modules/` 가 남는다.
- 🔴 **규칙 추가 경우 무회귀**: REQ-2026-152 의 e2e 2건(루트·중첩)이 그대로 **끝까지 성공**한다.
- 🔴 안내에 **검증 줄**(`git status --porcelain`)이 커밋 줄과 stash 줄 **사이**에 있다(순서 고정).
- 🔴 그 줄 뒤에 **"비어 있어야 다음으로 간다 · 아니면 멈춘다"**가 말로 있다. 무엇이 남을 수 있는지
  (ignore 완화로 드러난 파일) 설명하고, **사람이 정한다**고 말한다.
- 🔴 **도구가 완화 여부를 추론하지 않는다**(소스 가드): gitignore 문법을 파싱하는 코드가 없다.
  설계 근거 — 부정 패턴 하나만 틀려도 반대로 안내한다.
- 계약 스위트: `npx vitest run tests/unit/terminal-reentry.test.ts tests/unit/req-new.test.ts tests/unit/dispatch.test.ts`
- Codex 승인.

## Phase 3 — porcelain 경로 충실도 (`phase-3-porcelain-path-fidelity`)

범위: `splitDirty` 의 `\` → `/` 변환 제거 · 역슬래시 회귀.

Exit:
- 🔴 **결함 3 회귀**: 티켓 **밖**의 리터럴 역슬래시 경로(`workflow\REQ-2026-001/x`)가
  `outsideDirty` 에 남는다(지금은 티켓 안으로 오분류된다).
- 🔴 **티켓 안의 역슬래시 파일명**(`workflow/REQ-2026-001/a\b.json`)은 티켓 안으로 잡힌다.
- 🔴 **Windows·POSIX 무회귀**: 기존 `splitDirty` 테스트가 그대로 통과한다(git 은 어느 플랫폼에서든
  `/` 로 보고하므로 변환은 처음부터 불필요했다).
- 🔴 **소스 가드**: `splitDirty` 안에 `.replace(/\\/g, '/')` 가 **없다**. `toTicketRel` 의 변환은
  **남는다**(그쪽은 win32 `relative()` 산출물의 구분자 변환 — 다른 것이다).
- 🔴 **변이 검사**: 변환을 되돌리면 결함 3 회귀가 red.
- 계약 스위트: `npx vitest run tests/unit/hardblocked-report.test.ts tests/unit/nonconvergence.test.ts tests/unit/dispatch.test.ts`
- Codex 승인.

## 완료
- 게이트 해당분 · **통합 직전 전체 스위트 1회 + `verify-range --strict`** · CHANGELOG.
- 🔴 CHANGELOG 는 **REQ-2026-152/153 이 만든 결함**임을 감추지 않는다. 특히 결함 5(틀린 fixture 로
  green 이었던 테스트)를 적는다 — 테스트가 통과했다는 사실이 증명이 아니었다.
- 통합은 `stopGate: "auto"` 다. 사전 위임 또는 `[B1]` direct push 를 사람이 승인한다.
