# REQ-2026-112 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

> **테스트 실행 계층(REQ-2026-100)**: 게이트는 테스트를 **실행하지 않는다**. 아래는 비용을 줄이기 위한 실행 시점 권고다.
> - **phase 진행 중**: 변경한 소스를 import하는 테스트만(빠른 피드백). 예: `grep -rl "<변경한 모듈>" tests/`
> - **통합(main 병합) 직전 1회**: **전체 스위트**. 범위 한정은 이것을 **대체하지 않는다** — 영향 분석은 놓친 회귀를 통과시킨다.

> ℹ️ **stage 범위 표기**: 아래 "범위"는 **코드·문서 변경분**이다. REQ 설계 문서(`00`/`01`/`02`·
> `codex-request.md`)는 이 저장소 관례상 **첫 phase 커밋에 동반**되므로 staged tree에 함께 나타난다.

## Phase 1 — 서술 정정과 가드 범위 확장 (`phase-1-notice-truth`)

**책임 계약**: 폐기된 HIGH 백스톱 주장이 남아 있는 6곳을 실제 동작에 맞게 고치고, 같은 주장이
**배포되는 지침 파일**과 **setup 화면 문구**로 되돌아오지 못하게 가드를 넓힌다.

**입력**: 현재의 6개 위치와 `docs-stale-claims.test.ts`의 등재 목록.
**산출물**: 정정된 서술 + 확장된 가드.
**선행 phase**: 없음.

**범위 (6파일)**

| 파일 | 변경 |
|---|---|
| `bin/setup.ts` | `STOP_GATE_HIGH_NOTICE` 문구를 "정지 지점을 이 값이 정한다"로 · 위 주석의 근거 서술도 정정 |
| `AGENTS.template.md` | 77행 |
| `docs/ssot-design/04-user-roles-and-permissions.md` | 54행 |
| `scripts/req/lib/config.ts` | 39·53·214행 주석 |
| `tests/unit/docs-stale-claims.test.ts` | 대상 확장(4표면) · 변형 등재 · 상수 검증 |
| `CHANGELOG.md` | Unreleased |

**stage 범위**: 위 6개 + REQ 설계 문서. `state.json`·`responses/`는 **스테이징하지 않는다**.

**공개 seam과 실패해야 할 동작**

| # | seam | 실패해야 하는 구현 |
|---|---|---|
| AC-1a | **배포 지침 표면** 4곳의 내용 | `AGENTS.template.md` 등을 안 고침 → 실패 |
| **AC-1b** | **코드 표면 목록**(`bin/setup.ts` · `scripts/req/lib/config.ts`)의 내용 | 🔴 `config.ts` 주석 3곳·`setup.ts` 근거 주석 중 **하나라도** 옛 주장 그대로 남김 → 실패 |
| AC-2 | `STOP_GATE_HIGH_NOTICE` 값 | 화면 문구가 다시 폐기 주장을 담음 → 실패 |
| AC-3 | 검사 대상 목록과 **제외 목록** | 확장이 조용히 빠짐(글로브 오타 등)·제외가 과하게 넓어짐 → 실패 |
| AC-4 | 변형 문자열 등재 | `정책과 무관하게 유지`가 재발 → 실패 |

> 🔴 **AC-1b는 r01 설계 리뷰가 지적한 공백이다.** 원안은 배포 문서와 상수만 검사해서,
> 코드 주석 4곳을 안 고쳐도 모든 검증이 통과했다. 6곳 정정을 요구하면서 4곳에 오라클이 없었다.
> 🔴 대상은 **손으로 적은 파일 목록**이지 `**/*.ts` 글로브가 아니다(정정문까지 막힌다).
> 제외 목록(`retired-claims.ts`·가드 자신·`CHANGELOG.md`·`workflow/REQ-*`)도 함께 단언한다.

**검증 명령** (`req.config.json`의 `packageManager: npm`)

```
npx tsc --noEmit
npx vitest run tests/unit/docs-stale-claims.test.ts tests/unit/setup.test.ts tests/unit/init.test.ts tests/unit/req-config.test.ts
```

역의존 실측(`grep -rln` 결과):
- `bin/setup` → `setup.test.ts` · `setup-gate.test.ts` · `codex-missing-guidance.test.ts`
- `AGENTS.template` → `init.test.ts` · `uninstall.test.ts`
- `lib/config` → 10개 파일(광범위) — 이 phase는 **주석만** 고치므로 대표로 `req-config.test.ts`를 돌린다

위 명령은 그중 **직접 영향권**(문구·템플릿·등재 목록)을 고른 것이다. 전량은 통합 직전 1회.

**선행 확인**: 범위를 넓힌 직후 **기존 13개 등재 항목이 새 대상 파일에서 발화하지 않는지** 먼저 본다.

**비목표**: `stopGate` 동작 변경 · 소비자 파일 수정 · D29(Phase 2) · CHANGELOG 과거 기록 수정.

**Exit**: typecheck 0 · 위 검증 그린 · Codex phase 리뷰 승인.

## Phase 2 — 폐기 주장 정본화와 소비자 알림 (`phase-2-retired-claims-check`)

**책임 계약**: 폐기 문구 목록을 **배포되는 모듈** 하나로 옮기고, 그것을 근거로 소비자의 계약 파일에
남은 폐기 주장을 **WARN으로 알린다**. 파일은 고치지 않는다.

**입력**: Phase 1이 정리한 등재 목록.
**산출물**: `RETIRED_CLAIMS` 정본 + D29.
**선행 phase**: Phase 1 (등재 목록이 확정돼 있어야 옮길 대상이 정해진다).

**범위 (6파일)**

| 파일 | 변경 |
|---|---|
| `scripts/req/lib/retired-claims.ts` (신규) | `RetiredClaim`·`RETIRED_CLAIMS`·**`retiredClaimsIn`(매칭 정본)** |
| `tests/unit/docs-stale-claims.test.ts` | 사본 제거 → 정본 import |
| `scripts/req/req-doctor.ts` | `D_CHECK_IDS`에 `D29` · `DoctorInputs` 확장 · 검사 · `main()`이 파일 읽어 주입 · 🔴 **`RETIRED_CLAIMS`는 import하지 않고 `retiredClaimsIn`만** 가져와 재수출(결속 seam) |
| `docs/ssot-design/07-business-rules-and-state-machines.md` | §3 정본 표에 D29 행 |
| `tests/unit/doctor-retired-claims.test.ts` (신규) | AC-5·AC-6·AC-7 |
| `CHANGELOG.md` | Unreleased 보강 |

**공개 seam과 실패해야 할 동작**

| # | seam | 실패해야 하는 구현 |
|---|---|---|
| AC-5 | hermetic repo에서 `main()` 실행 후 D29 줄 | 배선 끊김(검사만 있고 `main()`이 입력을 안 채움) → 실패 |
| AC-6 | 폐기 문구 없는 `AGENTS.md`에서 D29 | 무조건 WARN(오탐) → 실패 |
| **AC-7a** | `req-doctor`가 재수출한 `retiredClaimsIn` ↔ 정본 `toBe` | 🔴 **내용이 같은 사본 구현** → 실패 |
| **AC-7b** | `RETIRED_CLAIMS` 전 항목을 각각 `AGENTS.md`에 넣고 `main()`으로 D29 발화 확인 | 배선 끊김 · 사본 드리프트 → 실패 |

> 🔴 **AC-7이 두 겹이 된 경위(r01·r02 P1 연속)**
> - r01: "같은 모듈 import 확인"은 **동일한 배열 사본**을 통과시킨다.
> - r02: 전수 발화만으로는 **사본이 정본보다 적을 때만** 잡힌다 — 내용이 같은 사본은 통과.
>
> 그래서 **구조로 먼저 막는다**: `req-doctor`는 배열을 import하지 않고 매칭 함수만 가져간다
> → 사본을 둘 자리가 없다. 그 위에 AC-7a(참조 동일성)·AC-7b(행동 전수)를 얹는다.
> 남는 한계는 설계 DEC-4에 명시했다(소스 정규식은 쓰지 않는다 — REQ-2026-099).
| — | 기존 `[REQ-2026-099]` 정본 표 테스트 | D29를 표에 안 적음 → 실패 |
| — | 기존 죽은-항목 탐지 테스트 | D29가 어떤 변형에서도 push 안 함 → 실패 |

**검증 명령**

```
npx tsc --noEmit
npx vitest run tests/unit/doctor-retired-claims.test.ts tests/unit/docs-stale-claims.test.ts tests/unit/req-doctor.test.ts tests/unit/doctor-terminal-wiring.test.ts
```

**비목표**: 소비자 파일 자동 수정 · D29를 FAIL로 올리기 · 다른 폐기 주장 전수 감사.

**Exit**: typecheck 0 · 위 검증 그린 · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(typecheck·해당 시 lint) · **통합 직전 전체 스위트 1회** · 사용자 main 머지(별도 승인).
