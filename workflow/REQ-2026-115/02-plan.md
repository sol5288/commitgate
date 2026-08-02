# REQ-2026-115 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

> **테스트 실행 계층(REQ-2026-100)**: 게이트는 테스트를 **실행하지 않는다**. 아래는 비용을 줄이기 위한 실행 시점 권고다.
> - **phase 진행 중**: 변경한 소스를 import하는 테스트만(빠른 피드백). 예: `grep -rl "<변경한 모듈>" tests/`
> - **통합(main 병합) 직전 1회**: **전체 스위트**. 범위 한정은 이것을 **대체하지 않는다** — 영향 분석은 놓친 회귀를 통과시킨다.

> ℹ️ **stage 범위 표기**: 아래 "범위"는 **코드·문서 변경분**이다. REQ 설계 문서(`00`/`01`/`02`·
> `codex-request.md`)는 이 저장소 관례상 **첫 phase 커밋에 동반**되므로 staged tree에 함께 나타난다.

## Phase 1 — D15 정당성 정정과 오라클 강화 (`phase-1-d15-rationale`)

**책임 계약**: D15가 "왜 필요한지"를 사실대로 적고 그 주장을 테스트로 고정한다.
그리고 관측 로그 테스트가 exit **코드**까지 대조한다. **동작은 바꾸지 않는다.**

**입력**: 현재 D15 주석, `machine.schema.json`의 제약(부재), `doctor-run-log.test.ts`의 `runDoctor`.
**산출물**: 정정된 주석 + 오라클 2건.
**선행 phase**: 없음.

**범위 (4파일)**

| 파일 | 변경 |
|---|---|
| `scripts/req/req-doctor.ts` | **D15 주석만**(판정식·메시지·level 무변경) |
| `tests/unit/req-doctor.test.ts` | 같은 응답이 **스키마 통과 & D15 FAIL**임을 고정 |
| `tests/unit/doctor-run-log.test.ts` | `runDoctor`가 exit **인자**를 수집·비교 |
| `CHANGELOG.md` | Unreleased |

**stage 범위**: 위 4개 + REQ 설계 문서. `state.json`·`responses/`는 **스테이징하지 않는다**.

**공개 seam과 실패해야 할 동작**

| # | seam | 실패해야 하는 구현 |
|---|---|---|
| AC-2 | **위반을 분리한 두 입력** 각각의 `validateResponseStructure(...).ok`와 D15 level | 스키마가 그 조합을 막게 되면(주석이 낡음) 첫 단언 실패 · **각 하위 판정**이 약해지면 해당 입력에서 실패 |
| AC-3 | ① 로그 실패 전/후 exit 코드 동일 **②** 그 값이 계약값 `1` | 관측이 판정을 바꾸면 ① 실패 · exit 코드가 바뀌면 ② 실패 |

> 🔴 **설계 리뷰 r01 P1 2건이 지적한 것**: 원안은 두 오라클 모두 **변이를 잡지 못했다**.
> (a) AC-2의 입력이 `findings`와 `next_action`을 **동시에** 위반해서, 한쪽 판정을 제거해도
> 다른 쪽 때문에 여전히 FAIL이었다. (b) AC-3이 두 실행의 **동일성만** 봐서,
> 공통 `exit(1)`을 `exit(2)`로 바꾸면 양쪽 다 2가 되어 통과했다.

**변이 검사(구현 중 반드시 수행 — 각각 실제로 실패하는지 확인한다)**

| 일부러 깨뜨릴 것 | 기대 |
|---|---|
| D15의 `findingsOk` 판정 제거 | `onlyFindings` 입력에서 AC-2 실패 |
| D15의 `nextOk` 판정 제거 | `onlyNextAction` 입력에서 AC-2 실패 |
| `main()`의 `process.exit(1)` → `exit(2)` | AC-3 **②**에서 실패 |

**검증 명령** (`req.config.json`의 `packageManager: npm`)

```
npx tsc --noEmit
npx vitest run tests/unit/req-doctor.test.ts tests/unit/doctor-run-log.test.ts tests/unit/docs-stale-claims.test.ts
```

역의존 근거: 변경 파일이 `req-doctor` 하나이고, 그 검사를 다루는 테스트가 위 둘이다.
`docs-stale-claims.test.ts`는 D-체크 정본 표 대조를 담당한다(등록부는 안 바뀌지만 무회귀 확인).

**비목표**: D15 제거·완화 · 스키마에 `minItems`/`minLength` 추가 ·
선행 REQ의 완결된 설계 문서 수정(요구 문서에 근거와 함께 기록).

**Exit**: typecheck 0 · 위 검증 그린 · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(typecheck·해당 시 lint) · **통합 직전 전체 스위트 1회** · 사용자 main 머지(별도 승인).
