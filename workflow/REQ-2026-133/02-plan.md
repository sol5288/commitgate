# REQ-2026-133 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

> **테스트 실행 계층(REQ-2026-100)**: 게이트는 테스트를 **실행하지 않는다**. 아래는 비용을 줄이기 위한 실행 시점 권고다.
> - **phase 진행 중**: 변경한 소스를 import하는 테스트만(빠른 피드백). 예: `grep -rl "<변경한 모듈>" tests/`
> - **통합(main 병합) 직전 1회**: **전체 스위트**. 범위 한정은 이것을 **대체하지 않는다** — 영향 분석은 놓친 회귀를 통과시킨다.

## Phase 1 — setup 경로 지원 + 정지 지점 문구 (`phase-1-setup-keys`)

범위(DEC-1~DEC-6):
- `bin/setup.ts`
  - `VALUE_NOTES.stopGate` 세 값을 **정지 지점**으로 교체(`merge`는 묶음 없는 경우 포함).
  - `STOP_GATE_HIGH_NOTICE` 본문도 같은 사실로 교체하고, **붙이는 조건을 `q.key === 'stopGate'`로**
    바꾼다(현행 `!allowsNullValue`는 간접 조건이라 새 `onSoftLimit` 질문에 정지 지점 고지가 잘못 붙는다).
  - `SETUP_KEYS`에 `'reviewBudget.onSoftLimit'` 추가 + 점 경로 지원(`keyPath`·`subSchemaFor`·현재값 읽기).
  - **답변 patch ↔ 기록 patch 분리**(DEC-3): `toWritePatch(answers, raw)`가 유일한 변환점.
    중첩 값은 부모 객체를 `DEFAULTS → raw → 고른 값` 순서로 합성해 **최상위 키**로 넣는다.
    `deleteKeys` 판정은 **답변**(`answers.stopGate`)을 본다.
  - 질문 문구·값 설명에 **비용 통제임**을 명시.

Exit:
```sh
npm run typecheck
npx vitest run tests/unit/setup.test.ts
```
- `stopGate` 값 설명이 세 값 모두 정지 지점을 말한다(`merge`에 묶음 없는 경우 포함).
- **한 화면 안에서 모순이 없다**: `stopGate` 질문의 고지와 값 설명이 같은 사실을 말한다.
- **`onSoftLimit` 질문에는 정지 지점 고지가 붙지 않는다**(다른 축이다).
- `onSoftLimit` 질문이 스키마 enum에서 선택지를 얻고 "비움"이 **뜨지 않는다**.
- 중첩 현재값·`currentIsDefault`가 **경로 기준**으로 읽힌다
  (`{reviewBudget:{onSoftLimit:'auto',autoBudget:3,hardCap:6}}` → 현재값 `auto`·기본값 아님).
- 기존 `reviewBudget.autoBudget`·`hardCap`이 **보존**된다.
- `reviewBudget`이 없던 config에서도 결과가 스키마를 통과한다.
- 기존 setup 정합성 테스트 무회귀 · Codex 승인.

## Phase 2 — 문서 (`phase-2-docs`)

범위: `docs/configuration.md`/`.en`의 setup 관련 서술이 새 질문을 반영하는지 확인·정정 · `CHANGELOG.md`.
🔴 **`stopGate: merge` 설명도 함께 점검한다**(설계 r01 observation) — 그 문서가 묶음 없는 경우의
req-동등 정지를 말하지 않으면 setup의 새 문구와 다시 어긋난다.
🔴 새 절만 추가하고 기존 서술을 두지 않는다 — 같은 실수를 이 작업에서 이미 두 번 했다.

Exit: `npm run docs:lint` · 문서 가드 그린 · Codex 승인.

## 완료
- 게이트 해당분(typecheck·해당 시 lint) · **통합 직전 전체 스위트 1회** · 사용자 main 머지(별도 승인).
