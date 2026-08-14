# REQ-2026-152 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고.

> **테스트 실행 계층(REQ-2026-100)**: 게이트는 테스트를 **실행하지 않는다**.
> - **phase 진행 중**: 변경 영역 테스트 + `tests/unit/dispatch.test.ts`.
> - **통합 직전 1회**: **전체 스위트**(`npm test`) + `bin/verify-range.ts --base main --head HEAD --strict`.
>   🔴 `verify-range` 는 `scripts/req/` 가 아니라 **`bin/`** 이고 인자는 `--base`/`--head` 다.

🔴 **선행**: 설계 승인 직후 `state.json` 의 `phases[]` 에 아래 두 id 를 선언한다.

```
phase-1-untracked-stash-guidance · phase-2-binding-integrity
```

## Phase 1 — untracked stash 안내 (`phase-1-untracked-stash-guidance`)

범위: `terminalReentryProblem` 의 stash 줄 · 회귀 테스트 방향 전환 · untracked 있는 실 CLI e2e.

Exit:
- 🔴 **실 CLI e2e**: 종결 티켓 + staged 코드 변경 + **루트 untracked `notes.txt`** 상태에서
  차단 → 안내 세 줄을 순서대로 실행 → **셋 다 성공**하고, 마지막에 staged 변경과
  `notes.txt` 가 **둘 다** 새 티켓 브랜치에 복원돼 있다. (지금은 2번째 줄이 거부된다.)
- 🔴 안내가 `--include-untracked` 를 쓴다(축약 `-u` 아님). **`--all` 은 쓰지 않는다** — 고정 문자열
  부재 검사로 고정(ignored 파일까지 보관하면 `node_modules`·`.env` 가 들어간다).
- 🔴 **회귀 테스트를 반대 계약으로 다시 쓴다** — 지금의 "`-u` 를 쓰지 않는다"는 틀린 동작을
  고정하고 있다. 지우지 말고 뒤집는다(무엇이 계약인지 남긴다).
- 🔴 출력에 꺾쇠(`<`)가 없다 · slug 는 산출한다 · 셸 안전 판정 통과 — REQ-2026-151 계약 무회귀.
- 🔴 **정상(미종결) 티켓 무회귀**: 커밋 경로가 한 글자도 달라지지 않는다.
- 계약 스위트: `npx vitest run tests/unit/terminal-reentry.test.ts tests/unit/req-new.test.ts tests/unit/dispatch.test.ts`
- Codex 승인.

## Phase 2 — 결속 무결성 (`phase-2-binding-integrity`)

범위: 매니페스트 형식 검증 · `consumedStateShaFor` 3갈래 판정 · `resumeFrom:'consume'` e2e.

Exit:
- 🔴 **`validateManifest` 회귀**: `null` · 숫자 · 빈 문자열 · 63자리 · 비-hex(`g` 포함) · 대문자 hex
  각각이 **거부**된다. **키 부재는 통과**한다(레거시 무회귀).
- 🔴 **복구 판정 3갈래**가 타입으로 강제된다 — `absent` 는 D 를 건너뛰고, `malformed` 는
  `state-mismatch` 로 거부하며, `bound` 만 대조한다. `string | null` 로 되돌아가지 않는다.
- 🔴 **형식 불량 행 + 임의 워킹 state** 조합이 실 CLI 에서 거부된다(결함 2의 정확한 재현).
- 🔴 **`resumeFrom: 'consume'` 실 CLI e2e**: 승인 핀·인벤토리·approved tree 를 갖춘 fixture 로
  ① `--finalize --run` 한 번에 수렴(exit 0 · clean tree)
  ② 복구가 커밋한 `HEAD:state.json` 의 sha256 == 매니페스트 `consumed_state_sha256`.
- 🔴 **변이 검사 2건**: ① `consumedAtOfRow(...)` → `new Date().toISOString()` 이면 위 ②가 red.
  ② `malformed` 거부를 지우면 형식 불량 테스트가 red.
  🔴 **①이 red 가 되지 않으면 이 phase 를 닫지 않는다** — e2e 가 그 코드를 지나지 않는다는 뜻이다.
  🔴 fixture 를 못 만들면 **보고하고 멈춘다.** 구조 가드로 대체하지 않는다(이번 결함을 놓친 방식).
- 🔴 **옛 행(키 부재) 무회귀**: 종전 e2e·순수 테스트가 그대로 통과한다.
- 계약 스위트 + `npx vitest run tests/unit/evidence-recovery.test.ts tests/unit/evidence-recovery-wiring.test.ts tests/unit/evidence-module.test.ts tests/unit/req-commit.test.ts`
- Codex 승인.

## 완료
- 게이트 해당분 · **통합 직전 전체 스위트 1회 + `verify-range --strict`** · CHANGELOG.
- 🔴 CHANGELOG 는 REQ-2026-151 의 **판단 두 가지를 뒤집었다**고 적는다(`-u` 배제 · "도달 불가일
  수 있다"). 정정을 감추지 않는다.
- 통합은 `stopGate: "auto"` 다. 사전 위임 또는 `[B1]` direct push 를 사람이 승인한다.
