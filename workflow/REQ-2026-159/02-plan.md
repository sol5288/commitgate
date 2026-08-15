# REQ-2026-159 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **테스트 실행 계층(REQ-2026-100)**: 게이트는 테스트를 **실행하지 않는다**.
> - **phase 진행 중**: 그 phase 의 계약 스위트만.
> - **통합 직전 1회**: **전체 스위트**(`npm test`) + `bin/verify-range.ts --base main --head HEAD --strict`.

🔴 **선행**: 설계 승인 직후 `state.json` 의 `phases[]` 에 아래 id 를 선언한다.

```
phase-1-integration-policy-binding
phase-2-contract-and-migration
phase-3-policy-target-binding
```

🔴 **phase-3 은 외부 리뷰가 phase-1·2 이후에 낸 P1 이다.** 계획에 뒤늦게 들어왔지만 **통합 전에
반드시 수행한다** — 건너뛰면 phase-1 이 막은 결함의 우회로가 열린 채로 통합된다.

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

## Phase 3 — 정책 대상 결속 (`phase-3-policy-target-binding`) — 외부 리뷰 P1

**선행: `phase-2-contract-and-migration` 승인·커밋 완료.**

브랜치 이름이 `branchPrefix` 만 만족하고 REQ 번호 형식이 아니면 `scopeOfBranch()` 가 `null` 이고,
phase-1 은 그때 정책 대상을 비워 **현재 config 로 폴백**했다 — `auto` 스냅샷을 약화시키는 우회로.
🔴 내가 그 자리에 "오늘 동작 그대로다"라고 주석까지 달아 뒀다. **보존한 것이 곧 구멍이었다.**

Exit:
- 🔴 **정책 대상과 위임 대상을 분리**한다. 위임 권한은 그대로 브랜치 scope 만, 정책은 **범위의 커밋
  귀속**에서도 티켓을 찾는다(`policyTargetIds`).
- 🔴 대상이 비면 **판정 불가**다 — config 폴백 분기를 제거한다.
- 🔴 귀속되지 않은 커밋이 하나라도 있거나 묶음 멤버를 못 읽으면 **모름(null)** 이다.
- 🔴 회귀: `feat/req-renamed` + auto 스냅샷 + config merge + 비대화형 → exit 1 · merge 0회 ·
  같은 입력 legacy → 병합(무회귀) · state 손상 → 거부, 대화형 y → 병합.
- 🔴 **변이 2건**: 폴백 복원 → red · 귀속 무시(브랜치 scope 만) → red.
  🔴 첫 시도에서 폴백 변이가 **green 이었다** — `policyTargetIds` 가 `[]` 를 돌려주는 것만 보고
  그 `[]` 가 판정 불가로 이어지는지는 아무도 안 봤다. `resolveIntegrationPolicy` 직접 오라클 추가.
- 🔴 계약·문서: "권한 판단은 설정값이나 브랜치 이름만으로 내려지지 않는다"를 명시.

- 계약 스위트: `npx vitest run tests/unit/integrate-delegation.test.ts tests/unit/integrate-verb.test.ts tests/unit/ci-workflow-policy.test.ts tests/unit/agent-autonomy-contract.test.ts` + `npm run docs:lint`
- Codex 승인.

## 완료

🔴 **phase-1·2·3 이 모두 승인·커밋된 뒤에만** 아래로 간다.

- 게이트 해당분 · **통합 직전 전체 스위트 1회 + `verify-range --strict`** · CHANGELOG.
- 🔴 CHANGELOG 는 **의도적 동작 변경 둘을 각각** 적는다(DEC-9 와 일치):
  ① 티켓 state·묶음 레코드를 **읽지 못하면** 판정 불가 — 비대화형 거부 · 대화형 최종 확인.
  ② **정책 대상을 확정할 수 없으면**(대상 없음 또는 모름) 판정 불가 — 예전의 "대상이 비면
     현재 config 를 따른다" 폴백이 사라진다.
- 🔴 CHANGELOG 는 **계약 문서 결함이 설치 프로젝트 전체에 복사된다**는 점을 적는다 —
  도구가 맞아도 계약이 틀리면 에이전트는 계약을 따른다.
- 통합은 `stopGate: "auto"` 다. 사전 위임 또는 `[B1]` direct push 를 사람이 승인한다.

## 범위 밖 (후속 큐 — 외부 점검의 "추가 제안")
- setup 종료 요약 · `doctor` 실효 자율 모드 한 줄 · npm tarball 설치 E2E 를 CI 에 ·
  전체 스위트 진행 로그/shard.
