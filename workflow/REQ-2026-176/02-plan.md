# REQ-2026-176 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

> **테스트 실행 계층(REQ-2026-100)**: 게이트는 테스트를 **실행하지 않는다**. 아래는 비용을 줄이기 위한 실행 시점 권고다.
> - **phase 진행 중**: 변경한 소스를 import하는 테스트만(빠른 피드백). 예: `grep -rl "<변경한 모듈>" tests/`
> - **통합(main 병합) 직전 1회**: **전체 스위트**. 범위 한정은 이것을 **대체하지 않는다** — 영향 분석은 놓친 회귀를 통과시킨다.

## Phase 1 — OID 요청 (`phase-1-oid-blobs`)

범위: `collectDeepInput` 의 blob 읽기를 OID 요청으로. **읽는 양은 불변**(설계 비목표 참조).

- `scripts/req/lib/verify-range.ts` — `ls-tree -r`(OID 포함) 1회 · batch1/batch2 OID 요청 ·
  `readByOid` **필수** 인자(DEC-2)
- 호출부 배선 5곳(`bin/verify-range.ts`·`bin/report.ts`·`bin/integrate.ts` x3) ·
  포트 멤버 2곳(`delegation-preflight-facts.ts`·`trunk-advance.ts`)
- 🔴 포트 **구성** 지점(design-r01 P1 — 빠지면 typecheck 0 자체가 불가):
  `scripts/req/req-delegate.ts:459` · `scripts/req/req-next.ts:1351` · `bin/integrate.ts:453` ·
  타입드 포트 factory `tests/unit/delegate-verb.test.ts:336` · `tests/unit/trunk-advance.test.ts`
- `scripts/req/lib/git-batch.ts` — 실측이 반증한 서술 정정(DEC-4)
- `tests/unit/verify-range-oid-cost.test.ts` **신규** — 계수·ls-tree 호출 수·동치·폴백

Exit: typecheck 0 · 위 green · **변이 3종**(OID 되돌리기·폴백 제거·ls-tree 추가호출) 전부 red ·
  **커밋 전 전체 스위트 1회** · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(typecheck·해당 시 lint) · **통합 직전 전체 스위트 1회** · 사용자 main 머지(별도 승인).
