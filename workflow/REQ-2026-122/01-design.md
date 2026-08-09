# REQ-2026-122 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

| 사실 | 위치 | 확인 |
|---|---|---|
| `npm test` = `vitest run`(단일 config·전체 63파일) | `package.json`·`vitest.config.ts` | 읽음 |
| maxWorkers 2·testTimeout 30s 등은 hang 실측으로 고정된 인프라 값 | `vitest.config.ts` 주석(REQ-2026-075·079) | 읽음 |
| 실측: 상위 12파일 = 테스트 시간 91.2%(1,450s 중) — 전부 스폰 계열 | 2026-08-10 스위트 로그 | 실측 |
| 계층 규칙은 문서·02-plan 템플릿에만 있고 실행 명령이 없다 | REQ-2026-100·AGENTS.template | 읽음 |
| vitest 2.x — `defineWorkspace` + `extends`로 프로젝트 분할 지원 | `package.json` devDeps | 읽음 |

## 핵심 설계 결정

### DEC-1 · 목록 기반 분리 — 파일 이동·개명 없음

`tests/tiers.ts`:

```
/** 통합 계층(스폰·hermetic git) — 2026-08-10 실측 상위 12(테스트 시간 91.2%). 측정 ms를 주석으로 남긴다. */
export const INTEGRATION_TIER: readonly string[] = [
  'tests/unit/init.test.ts',            // 450,741ms
  'tests/unit/uninstall.test.ts',       // 234,392ms
  'tests/unit/req-review-codex.test.ts',// 195,939ms
  'tests/unit/delivery-verbs.test.ts',  // 151,233ms
  'tests/unit/req-close.test.ts',       //  54,645ms
  'tests/unit/review-lifecycle-wiring.test.ts', // 53,415ms
  'tests/unit/req-new-intake.test.ts',  //  51,689ms
  'tests/unit/reconstruct.test.ts',     //  34,002ms
  'tests/unit/req-new.test.ts',         //  28,797ms
  'tests/unit/doctor-retired-claims.test.ts', // 26,428ms
  'tests/unit/req-next.test.ts',        //  22,161ms
  'tests/unit/req-commit.test.ts',      //  19,199ms
]
```

이동·개명을 하지 않는 이유: git 이력·`grep -rl` 역의존 탐색(02-plan 권고 명령)이 경로에
의존한다. 목록은 R3 가드가 실재성을 강제하므로 조용히 낡지 못한다.

### DEC-2 · vitest workspace — 기본 실행 무변경이 최우선 제약

`vitest.workspace.ts`:

```
export default defineWorkspace([
  { extends: './vitest.config.ts', test: { name: 'fast',        exclude: [...defaultExclude, ...INTEGRATION_TIER] } },
  { extends: './vitest.config.ts', test: { name: 'integration', include: [...INTEGRATION_TIER] } },
])
```

- `vitest run`(= `npm test`)은 워크스페이스의 **모든 프로젝트**를 실행한다 = 전체(완료 기준 3).
  fast∪integration=전체가 구성적으로 성립하고, R3 가드가 집합 동일성을 별도로 고정한다.
- `test:fast` = `vitest run --project fast` · `test:integration` = `--project integration`.
- 워커·타임아웃 등 인프라 값은 `extends`로 상속 — 값 이원화 없음.

### DEC-3 · R3 가드 — `tests/unit/test-tiers.test.ts`

1. `INTEGRATION_TIER` 각 항목이 실재 파일이다(변이: 가짜 경로 → red).
2. 집합 동일성: glob(`tests/**/*.test.ts`) = fast가 볼 파일 ∪ INTEGRATION_TIER (workspace 정의를
   import해 계산 — 정의와 가드가 같은 원천을 본다).
3. 중복 없음(목록 내 중복 경로 금지).

### DEC-4 · 하지 않는 것

- 게이트·config에 테스트 실행을 배선하지 않는다(REQ-2026-100 계약: 도구는 테스트를 강제하지 않는다).
- 느린 테스트의 최적화·재작성(별건 — 이 REQ는 분류와 실행 수단만).
- timeout 조정 없음.

## Phase별 구현

**Phase 1 (`phase-1-tier-scripts`)** — `tests/tiers.ts` + `vitest.workspace.ts` +
`package.json` scripts 2줄 + `tests/unit/test-tiers.test.ts` + `docs/development.md`/`.en` +
`CHANGELOG.md`. 단일 phase(≈7파일).

## 변경 파일

| 파일 | 변경 |
|---|---|
| `tests/tiers.ts` | 신규 — 목록 SSOT(실측 주석) |
| `vitest.workspace.ts` | 신규 — fast/integration 프로젝트 |
| `package.json` | `test:fast`·`test:integration` 스크립트 |
| `tests/unit/test-tiers.test.ts` | 신규 — R3 가드 |
| `docs/development.md`/`.en` | 계층·명령·실측 근거 |
| `CHANGELOG.md` | Unreleased |

## 테스트 oracle (완료 기준 ↔ 검증)

| 완료 기준 | 오라클 | 잡는 결함 |
|---|---|---|
| 1·2 | 가드가 workspace 정의에서 각 프로젝트의 대상 집합을 계산해 단언(12 / 전체−12) | 프로젝트 정의 드리프트 |
| 3 | `npm test` 실행이 63파일 전체를 보고(수동 1회 확인 + 집합 동일성 가드) | 기본 의미 변화 |
| 4 | 목록 실재성 검사(가짜 경로 변이로 red 확인) | 조용한 목록 부패 |
| 5 | glob = fast ∪ tier 집합 동일성 | 파일 유실·이중 계층 |

## 하위호환·안전

- `npm test`·CI·게이트 전부 무변경. 새 스크립트는 opt-in 개발 편의다.
- 목록이 낡으면(파일 추가로 비중 변화) 가드는 실재성만 강제한다 — 재측정·재배치는 데이터가
  쌓이면 후속(목록 헤더에 측정일 명시).
