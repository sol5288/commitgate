# REQ-2026-159 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **테스트 실행 계층(REQ-2026-100)**: 게이트는 테스트를 **실행하지 않는다**.
> - **phase 진행 중**: 그 phase 의 계약 스위트만.
> - **통합 직전 1회**: **전체 스위트**(`npm test`) + `bin/verify-range.ts --base main --head HEAD --strict`.

🔴 **선행**: 설계 승인 직후 `state.json` 의 `phases[]` 에 아래 id 를 선언한다.

```
phase-1-integration-policy-binding
phase-2-contract-and-migration
```

## Phase 1 — 통합 정책 결속 (`phase-1-integration-policy-binding`)

Exit — **판정 경로**:
- 🔴 `readTicketFacts` 가 `policy_snapshot.stop_gate` 를 함께 읽고, 읽기 실패를 **legacy 와 구분**해
  돌려준다(부재/손상 = legacy · 읽기 실패 = unreadable).
- 🔴 해소 함수가 **멤버별 `effectiveStopGate`** 를 적용하고 그 결과만 합친다(DEC-2 표).
  🔴 **합치기 규칙을 따로 만들지 않는다** — 설계 r01 P1 이 그 자리에서 유효한 `merge` 스냅샷이
  버려지는 것을 잡았다. ticket scope 는 멤버가 하나인 경우다(함수 하나).
- 🔴 결과는 `delegationRequired: boolean` + `basis` 다 — `phase`/`req`/`merge` 는 통합 통제점에서
  구별되지 않으므로 없는 구별을 `StopGate` 로 지어내지 않는다.
- 🔴 `delegationGate` 가 `deps.stopGate` 를 **더 이상 읽지 않는다** — `Pick` 에서 빼서
  참조하면 tsc 가 잡게 한다.
- 🔴 `runIntegrate` 가 해소된 값을 넘기고, `indeterminate` 면 **병합 전에** exit 1 로 멈춘다.

Exit — **회귀(`runIntegrate` 를 태운다)**:
- 🔴 DEC-5 의 **일곱** 시나리오. **비대화형 + `--run`**.
  🔴 #6(묶음 `merge`+`merge` · config `auto` → 병합됨)은 **r01 P1 의 회귀 오라클**이다.
- 🔴 각 시나리오에서 **merge 호출 횟수**를 센다(exit code 만 보지 않는다).
- 🔴 **변이 검사**: 해소 함수를 `cfg.stopGate === 'auto'` 반환으로 되돌리면
  **#1·#3·#4·#6** 이 red 임을 확인한다.

Exit — **무회귀**:
- 🔴 기존 `integrate` 테스트가 그대로 통과한다.
- 🔴 `hardCap`·HIGH·BLOCKED·범위 밖·위임 만료/철회/소비 경로를 **한 줄도 바꾸지 않는다**.

- 계약 스위트: `npx vitest run tests/integration/integrate-*.test.ts tests/unit/delegation*.test.ts`
- Codex 승인.

## Phase 2 — 계약·이행 (`phase-2-contract-and-migration`)

Exit — **계약 문서**(`AGENTS.template.md` 세 곳 전부 + 관리 블록):
- 🔴 57행 · 75~77행 · 81~83행 · 관리 블록 예외표 #1 이 모두 `auto` 를 정확히 말한다.
- 🔴 DEC-6 의 **정본 문장**을 쓴다. `stopGate` 와 `onSoftLimit` 을 한 문장에 섞지 않는다.
- 🔴 `auto` 에서도 멈추는 다섯(HIGH · hardCap · BLOCKED · 범위 밖 · 위임 만료/철회/소비)을 적는다.

Exit — **계약 회귀 가드**(`tests/unit/agent-autonomy-contract.test.ts`):
- 🔴 정지 지점 열거가 **`CONFIG_SCHEMA` 의 `StopGate` enum 전체**를 덮는다(손으로 적지 않는다).
- 🔴 옛 단정("어느 값에서도 필요하다" 등)이 **축자로** 없다.
- 🔴 **변이 검사 3건**: 열거에서 `auto` 제거 → red · 옛 단정 복원 → red ·
  관리 블록 예외표에서 `auto` 예외 제거 → red.

Exit — **이행 통지**:
- 🔴 `scripts/req/lib/retired-claims.ts` 에 옛 계약 문구를 **축자로** 추가한다.
- 🔴 `commitgate check` C5 가 "이 계약은 auto 통합 규칙 이전 버전"이라고 **구체적으로** 말하고,
  갱신 경로(`quickstart --apply` = 관리 블록 · 관리 블록 밖은 사람이 병합)를 안내한다.
- 🔴 **`AGENTS.md` 를 자동으로 고치지 않는다** — 이 원칙을 테스트로 고정한다.

Exit — **무회귀**:
- 🔴 `npm run docs:lint` 통과.
- 🔴 REQ-2026-158 의 문서 정합 가드가 그대로 통과한다.

- 계약 스위트: `npx vitest run tests/unit/agent-autonomy-contract.test.ts tests/unit/setup-docs-parity.test.ts tests/unit/docs-stale-claims.test.ts tests/unit/check.test.ts` + `npm run docs:lint`
- Codex 승인.

## 완료
- 게이트 해당분 · **통합 직전 전체 스위트 1회 + `verify-range --strict`** · CHANGELOG.
- 🔴 CHANGELOG 는 **"읽지 못함 → 거부"가 유일한 의도적 동작 변경**임을 적는다.
- 🔴 CHANGELOG 는 **계약 문서 결함이 설치 프로젝트 전체에 복사된다**는 점을 적는다 —
  도구가 맞아도 계약이 틀리면 에이전트는 계약을 따른다.
- 통합은 `stopGate: "auto"` 다. 사전 위임 또는 `[B1]` direct push 를 사람이 승인한다.

## 범위 밖 (후속 큐 — 외부 점검의 "추가 제안")
- setup 종료 요약 · `doctor` 실효 자율 모드 한 줄 · npm tarball 설치 E2E 를 CI 에 ·
  전체 스위트 진행 로그/shard.
