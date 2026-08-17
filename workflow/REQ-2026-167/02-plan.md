# REQ-2026-167 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

> **테스트 실행 계층(REQ-2026-100)**: 게이트는 테스트를 **실행하지 않는다**. 아래는 비용을 줄이기 위한 실행 시점 권고다.
> - **phase 진행 중**: 변경한 소스를 import하는 테스트만(빠른 피드백). 예: `grep -rl "<변경한 모듈>" tests/`
> - **통합(main 병합) 직전 1회**: **전체 스위트**. 범위 한정은 이것을 **대체하지 않는다** — 영향 분석은 놓친 회귀를 통과시킨다.

## Phase 1 — 절차 정본 구역 (DEC-1·DEC-3) (`phase-1-procedure-canon`)

**책임**: 흩어진 절차를 마커로 감싼 한 구역으로 모으고, 실측한 함정 셋(반복·검색·수용 기준)과
도구가 보지 않는 축을 담는다. ko/en 동시.

**입력**: 0.22.0 → 0.25.1 실측 결과(00-requirement 의 표) · `retired-claims.normalizeForClaimScan` ·
`sync --help` 의 *"companion skills · req.config.json 은 건드리지 않습니다"*.

**산출물**
| 파일 | 변경 |
|---|---|
| `scripts/req/lib/upgrade-axes.ts` | `PROCEDURE_MARKER` · `PROCEDURE_STEPS` · `PROCEDURE_ANCHORS` · `PROCEDURE_ASSERTIONS` · `COMPANION_PAIRS` · `CLAIM_SCAN_FN` |
| `docs/upgrade.md` | 절차 구역 신설 · 흩어진 "정리" 줄 정리 · `0.23.1 → 0.25.x` 절 |
| `docs/upgrade.en.md` | 동일(영문 정본) |
| `tests/unit/upgrade-procedure.test.ts` (신규) | G1~G5 · G7(앵커 4종 · 규범 문장 ko/en) |

🔴 과거 버전 절은 지우지 않는다(이 문서의 규칙).
🔴 문구 **전체**를 고정하지 않는다. 고정 대상은 명령·순서·앵커 뒤 블록의 토큰, 그리고 앵커마다
   **규범 문장 한 줄**(`PROCEDURE_ASSERTIONS` — 문서가 글자 그대로 싣는다)이다.
🔴 companion 대조는 **경로 쌍**(설계 DEC-1b)을 그대로 싣는다. 정상 비대칭 둘(`ATTRIBUTION.md` ·
   `.claude/skills/commitgate`)과 `req.config.json` 이 대조 대상이 **아니라는** 것도 함께 적는다.

**선행 조건**: 없음(설계 승인 완료).

**독립 검증**
```
npx tsc --noEmit -p tsconfig.json
npx vitest run tests/unit/upgrade-procedure.test.ts tests/unit/upgrade-axes.test.ts
```
리뷰어 재현: `docs/upgrade.md` 의 절차 구역만 읽고 그대로 따라갔을 때, 마지막에 무엇을 확인하면
끝인지가 문서 안에서 답이 되는가.

**Exit**: typecheck0 · 위 두 파일 그린 · Codex phase 리뷰 승인.

## Phase 2 — README 진입점 (DEC-2) (`phase-2-readme-entrypoint`)

**책임**: README(ko/en)의 업그레이드 구역이 **진단**으로 시작하게 한다. 구역 계약(명령 정확히 하나)은
그대로 두고 그 하나의 정체만 바꾼다.

**산출물**
| 파일 | 변경 |
|---|---|
| `scripts/req/lib/upgrade-axes.ts` | `UPGRADE_SUMMARY_COMMAND` = `npx commitgate check` |
| `README.md` · `README.en.md` | 요약 구역 문구 갱신(마커 안) |
| `tests/unit/upgrade-axes.test.ts` | 기존 G6 가 새 상수로 그대로 동작하는지 확인 |

**선행 조건**: phase-1 승인.

**독립 검증**
```
npx tsc --noEmit -p tsconfig.json
npx vitest run tests/unit/upgrade-axes.test.ts tests/unit/upgrade-procedure.test.ts
```

**Exit**: typecheck0 · 그린 · Codex phase 리뷰 승인.

## Phase 3 — 배포 부기 (`phase-3-release-notes`)

**산출물**: `CHANGELOG.md` · `package.json`/`package-lock.json`(patch bump).

**선행 조건**: phase-1·2 승인.

**Exit**: typecheck0 · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(typecheck·해당 시 lint) · **통합 직전 전체 스위트 1회** · 사용자 main 머지(별도 승인).
