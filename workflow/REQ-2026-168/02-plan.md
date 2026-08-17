# REQ-2026-168 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

> **테스트 실행 계층(REQ-2026-100)**: 게이트는 테스트를 **실행하지 않는다**. 아래는 비용을 줄이기 위한 실행 시점 권고다.
> - **phase 진행 중**: 변경한 소스를 import하는 테스트만(빠른 피드백). 예: `grep -rl "<변경한 모듈>" tests/`
> - **통합(main 병합) 직전 1회**: **전체 스위트**. 범위 한정은 이것을 **대체하지 않는다** — 영향 분석은 놓친 회귀를 통과시킨다.

## Phase 1 — 판정 불가의 사유를 나눈다 (DEC-1·DEC-2) (`phase-1-indeterminate-cause`)

**책임**: 왜 막혔는지를 사실대로 말한다. 통과·차단 판정 자체는 **한 글자도 바꾸지 않는다** — 바뀌는
것은 해상도뿐이다.

**입력**: 소비자 리포트 재현 결과(00-requirement) · `range-attribution.ts:166-173` 의 분류 ·
`integrate.ts:679·701` 의 두 사유.

**산출물**
| 파일 | 변경 |
|---|---|
| `scripts/req/lib/range-attribution.ts` | `unattributableCommits[].category` 추가 |
| `bin/integrate.ts` | `PolicyTargets` 결과 타입 · `AutoFacts.policyUnknown` · 사유별 메시지 |
| `tests/unit/integrate-indeterminate-cause.test.ts` (신규) | G1·G2·G3 |

🔴 `why`(산문)를 파싱해 사유를 추정하지 않는다.
🔴 `policyMembersUnknown: boolean` 을 남겨 두지 않는다 — 두 벌이 되면 한쪽만 고쳐진다.

**선행 조건**: 없음(설계 승인 완료).

**독립 검증**
```
npx tsc --noEmit -p tsconfig.json
npx vitest run tests/unit/integrate-indeterminate-cause.test.ts tests/unit/integrate-delegation.test.ts
```
리뷰어 재현: 리포트의 입력(귀속 불가 `attested` 1건 · delivery 없음)으로 `resolveIntegrationPolicy` 를
불러 메시지에 `delivery` 가 없고 SHA·범주가 있는지 본다.

**Exit**: typecheck0 · 위 두 파일 그린 · Codex phase 리뷰 승인.

## Phase 2 — `--allow-attested` (DEC-3) (`phase-2-allow-attested`)

**책임**: 비대화형 통과 경로를 **사전 위임**으로만 연다. 기본 불허 · 원장 기록 · 1회 소비 · 만료.

**입력**: 기존 `high_risk_ack` 축의 형태(발급·검증·소비) · 차단 지점 둘
(`resolveIntegrationPolicy` · `scopeRangeProblem`).

**산출물**
| 파일 | 변경 |
|---|---|
| `scripts/req/lib/delegation.ts` | `attested_ack` 필드 · `RangeAttribution.unattributableAttested` · `scopeRangeProblem` 판정 |
| `scripts/req/req-delegate.ts` | `--allow-attested` 파싱·발급·출력 |
| `scripts/req/lib/verb-help.ts` | 등록부에 새 플래그 |
| `bin/integrate.ts` | 정책 판정에서 `attested_ack` 반영 · 보고에 실린 attested SHA 출력 |
| `tests/unit/allow-attested.test.ts` (신규) | G4~G7 |

🔴 **`attested` 외에는 아무것도 열지 않는다.** `unproven`·`invalid-evidence`·`approved`(소비 행 없음)·
   분류 미상(`null`)이 하나라도 섞이면 `attested_ack` 와 무관하게 거부한다.
🔴 두 차단 지점이 **같은 판정**을 써야 한다 — 한쪽만 고치면 다른 쪽이 막고, 그 상태는 진단이 더 어렵다.

**선행 조건**: phase-1 승인.

**독립 검증**
```
npx tsc --noEmit -p tsconfig.json
npx vitest run tests/unit/allow-attested.test.ts tests/unit/delegate-verb.test.ts tests/unit/verb-help.test.ts
node bin/commitgate.mjs req:delegate --help    # 새 플래그가 사용법에 있다
```

**Exit**: typecheck0 · 그린 · Codex phase 리뷰 승인.

## Phase 3 — 계약 문서 + 배포 부기 (`phase-3-docs-release`)

**책임**: 부기 트레일러 오해(DEC-4)를 계약 문서에 닫고, 배포 부기를 남긴다.

**산출물**: `AGENTS.template.md`(트레일러는 도구가 붙인다) · `CHANGELOG.md` ·
`package.json`/`package-lock.json`(minor bump — 새 위임 축은 기능 추가다).

**선행 조건**: phase-1·2 승인.

**Exit**: typecheck0 · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(typecheck·해당 시 lint) · **통합 직전 전체 스위트 1회** · 사용자 main 머지(별도 승인).
