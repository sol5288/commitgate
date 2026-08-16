# REQ-2026-163 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **테스트 실행 계층(REQ-2026-100)**: 게이트는 테스트를 **실행하지 않는다**.
> phase 중에는 **변경한 소스를 import 하는 테스트만**(`grep -rl "<모듈>" tests/`),
> **전체 스위트는 통합 직전 1회**(~17분 — REQ 마다 돌리지 않는다).

## Phase 1 — orphan series 술어 + integrate 판정 (`phase-1-orphan-series-predicate`)

범위: `scripts/req/lib/review-series.ts`(신규) · `bin/integrate.ts` · `tests/unit/review-series.test.ts`(신규).

- `orphanPhaseSeries(state)` — `review_kind === 'phase'` 이고 `phase_id` 가 `phases[]` 에 없으며 열린 것.
  🔴 `series_id` 를 **파싱하지 않는다** — phase id 에 `#` 가 들어갈 수 있다(design r01 observation).
- `inconclusiveSeries(state)` — 열린 series 에서 orphan 을 뺀 것. `integrate` 가 이것을 쓴다.
- 🔴 `design:` series 는 제외 대상이 **아니다**.
- 🔴 `budgetHardCapReached` 는 **건드리지 않는다**(개명으로 예산이 리셋되면 안 된다).

Exit: typecheck 0 · 신규 테스트 그린(orphan 제외 · 정상 열린 series 는 그대로 미판정 · `design:` 불변 ·
예산 축 불변) · **REQ-2026-161 의 실제 state 형태**로 회귀 고정 · Codex phase 리뷰 승인.

## Phase 2 — `--close-orphan` 종결 경로 (`phase-2-close-orphan`)

범위: `scripts/req/req-review-exception.ts` · `scripts/req/lib/close-proof.ts`(`TerminalResolution` 확장) ·
`scripts/req/review-codex.ts`(`closed_reason` 계약 확장) · `scripts/req/lib/intake.ts`(baseState 제외) ·
해당 테스트.

- `--close-orphan <series_id> --reason "…"` — close-proof `series-terminal`(`resolution: 'orphaned'`,
  자연키 `(ticket, event, series)`) + `state.review_series[].closed_reason: 'orphaned'` + 커밋.
  🔴 리뷰 원장(`attempt-*`)은 series 수준을 담을 수 없다 — close-proof 가 정본이다(설계 DEC-3).
- 🔴 두 enum 은 **추가만** 한다. 캐스트로 우회하지 않는다(계약 밖 값 기록 금지).
- 🔴 **`orphaned` proof 는 티켓 baseState 판정에서 제외**한다(설계 DEC-3b). 그러지 않으면 진행 중인
  티켓이 `series-terminal` 로 판정되어 doctor 의 종결 면제(D2·D3·D11)를 잘못 받는다.
- 🔴 **재실행은 수렴**한다 — 이미 닫힌 orphan 이면 쓰지 않고 그 사실을 출력한다(거부 아님).
- 🔴 **`--confirm` 을 요구하지 않는다**(설계 DEC-3): 사람 판단이 아니라 도구가 검증하는 사실이다.
  `--reason` 은 요구한다.
- 🔴 **`phases[]` 에 있는 phase 의 series 는 거부**한다 — 리뷰 우회 경로가 되면 안 된다.
- 🔴 **멱등** — 이미 닫힌 series 는 다시 쓰지 않는다(원장이 정본).

Exit: typecheck 0 · 테스트 그린(orphan 종결 · 정상 phase 거부 · `--reason` 누락 거부 ·
재실행 수렴 + 그 문구가 help·oracle 에 고정) · **baseState 양쪽 회귀**:
developing 티켓(개명→종결 후에도 baseState 불변·종결 면제 없음) · `dev-complete` 티켓
(REQ-2026-161 의 `phase:phase-2-check-c6#1` 형태 → 후퇴 없음) · Codex phase 리뷰 승인.

## Phase 3 — `doctor` D34 + 07 정본 표 (`phase-3-doctor-d34`)

범위: `scripts/req/req-doctor.ts` · `docs/ssot-design/07-business-rules-and-state-machines.md` · doctor 테스트.

- `D_CHECK_IDS` 에 `'D34'` 등재 + **07 표 행을 같은 phase 에서** 추가
  (`docs-stale-claims` 가 양방향 대조 — 미루면 스위트가 red).
- 열린 orphan 이 있으면 WARN(series id + 사라진 phase id + **`--close-orphan` 해소 명령**), 없으면 OK.
  미계산은 점검 불요. 🔴 해소 명령을 함께 내야 **해소 가능한 WARN** 이 된다.
- 🔴 WARN 상한. 🔴 미계산 경로에서도 `applicable:false` 로 **반드시 방출**한다.

Exit: typecheck 0 · doctor 테스트 그린 · `docs-stale-claims` 그린 · **변이 검사**(입력 채우는 줄 제거 시 red) ·
Codex phase 리뷰 승인.

## Phase 4 — dogfood 명령 표면 보강 (`phase-4-dogfood-req-scripts`)

범위: `package.json`(이 저장소).

- 누락된 `req:*` 를 **Stage A 형태**(`tsx scripts/req/<file>.ts`)로 채운다. Stage B 로 넣지 않는다.
- 값은 `bin/dispatch.mjs` 의 `VERB_MODULES` 대상 모듈과 일치해야 한다.

Exit: `npm run req:delegate -- --status` 등 `req:next` 가 안내하는 형식이 **실제로 실행된다** ·
`classifyInstallMode` 판정이 여전히 `stage-a` · Codex phase 리뷰 승인.

## Phase 5 — CHANGELOG (`phase-5-changelog`)

범위: `CHANGELOG.md` Unreleased.

Exit: Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(typecheck) · **통합 직전 전체 스위트 1회**(162·163 을 함께 담은 마지막 브랜치에서) ·
  사용자 main 머지(별도 승인 — 162 먼저, 163 다음).
