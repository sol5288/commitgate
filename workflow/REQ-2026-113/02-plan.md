# REQ-2026-113 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

> **테스트 실행 계층(REQ-2026-100)**: 게이트는 테스트를 **실행하지 않는다**. 아래는 비용을 줄이기 위한 실행 시점 권고다.
> - **phase 진행 중**: 변경한 소스를 import하는 테스트만(빠른 피드백). 예: `grep -rl "<변경한 모듈>" tests/`
> - **통합(main 병합) 직전 1회**: **전체 스위트**. 범위 한정은 이것을 **대체하지 않는다** — 영향 분석은 놓친 회귀를 통과시킨다.

> ℹ️ **stage 범위 표기**: 아래 "범위"는 **코드·문서 변경분**이다. REQ 설계 문서(`00`/`01`/`02`·
> `codex-request.md`)는 이 저장소 관례상 **첫 phase 커밋에 동반**되므로 staged tree에 함께 나타난다.

## Phase 1 — 델타 관측 필드와 gaps 현황 정정 (`phase-1-delta-observability`)

**책임 계약**: 리뷰 호출 로그 1행이 **델타 모드 여부**와 **전면 재리뷰 요청 여부**를 담는다.
그리고 설계 gaps 문서 두 항목이 현재 사실을 반영한다.

**입력**: 빌더가 이미 받는 `verdict`, main이 이미 계산한 `designDelta`.
**산출물**: 로그 필드 2개 + 정정된 gaps 항목 2개.
**선행 phase**: 없음(단일 phase).

**범위 (4파일)**

| 파일 | 변경 |
|---|---|
| `scripts/req/review-codex.ts` | `ReviewCallLogRow`에 `full_review_requested?`·`delta_mode?` · 빌더 인자 `deltaMode: boolean`(**필수**) · `verdict`에서 파생 · 호출부에 `deltaMode: designDelta !== null` |
| `tests/unit/req-review-codex.test.ts` | 필드 집합 단언 19→21 갱신 + 정규화·파생 테스트 |
| `docs/ssot-design/gaps-and-decisions.md` | G-06b 해소 표기 · G-11 갱신 |
| `CHANGELOG.md` | Unreleased |

**stage 범위**: 위 4개 + REQ 설계 문서. `state.json`·`responses/`는 **스테이징하지 않는다**.

**공개 seam과 실패해야 할 동작**

| # | seam | 실패해야 하는 구현 |
|---|---|---|
| AC-1 | `buildReviewCallLogRow(...).full_review_requested` | `'yes'`를 `false`로, 또는 `'no'`·부재를 `true`로 정규화 → 실패 |
| AC-2 | 같은 행의 `delta_mode` | `deltaMode` 인자를 무시하거나 상수로 고정 → 실패 |
| AC-3 | `Object.keys(row).sort()` **전수 단언** | 필드 누락·이름 오타·의도치 않은 추가 → 실패 |
| AC-4 | `gaps-and-decisions.md`의 G-06b | 델타 리뷰를 여전히 미구현으로 서술 → 실패 |
| AC-5 | 같은 문서의 G-11 | 관측 로그 2종을 반영하지 않음 → 실패 |
| AC-6 | 폐기 문구 가드 | 정정문이 옛 문구를 축자 인용 → 실패 |

> 🔴 **배선 오라클을 따로 두지 않는 근거는 설계에 있다**(01의 "배선 오라클을 따로 두지 않는 이유").
> `full_review_requested`는 **넘길 인자가 없고**(verdict에서 파생), `delta_mode`는 **필수 인자**라
> 호출부 누락이 컴파일 오류가 된다. 실제 진입점 e2e는 유료 codex 호출이 필요해 둘 수 없다.
> **남는 한계**: 호출부가 `deltaMode`에 잘못된 값(상수 등)을 넘기는 경우는 타입이 못 잡는다.

**검증 명령** (`req.config.json`의 `packageManager: npm`)

```
npx tsc --noEmit
npx vitest run tests/unit/req-review-codex.test.ts tests/unit/docs-stale-claims.test.ts
```

역의존 실측: `grep -rln "buildReviewCallLogRow\|ReviewCallLogRow" tests/` → `req-review-codex.test.ts` 하나.
gaps 문서는 `docs/**`라 `docs-stale-claims.test.ts`가 검사한다(AC-6).

**비목표**: 페르소나·지침 텍스트 변경 · escalation 동작 변경 · 필드/기능 제거 · 집계 CLI ·
다른 gaps 항목 전수 감사.

**Exit**: typecheck 0 · 위 검증 그린 · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(typecheck·해당 시 lint) · **통합 직전 전체 스위트 1회** · 사용자 main 머지(별도 승인).
