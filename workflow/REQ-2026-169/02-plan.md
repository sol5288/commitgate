# REQ-2026-169 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

> **테스트 실행 계층(REQ-2026-100)**: 게이트는 테스트를 **실행하지 않는다**. 아래는 비용을 줄이기 위한 실행 시점 권고다.
> - **phase 진행 중**: 변경한 소스를 import하는 테스트만(빠른 피드백). 예: `grep -rl "<변경한 모듈>" tests/`
> - **통합(main 병합) 직전 1회**: **전체 스위트**. 범위 한정은 이것을 **대체하지 않는다** — 영향 분석은 놓친 회귀를 통과시킨다.

## Phase 1 — 배치 리더 + 배치 포트 (`phase-1-batch-ports`)

범위 (3파일):
- `scripts/req/lib/git-batch.ts` — `readBlobsByOid(cwd, oids)` **추가**(DEC-4). 기존 `readBlobsAtRef`·
  `parseCatFileBatchOutput` 은 **불변**(파서만 공유).
- `scripts/req/lib/intake-batch.ts` — **신규**. `listHeadTreeEntries`(DEC-5 · execFileSync 직접) ·
  `ticketIdsFromEntries`(DEC-8 · 순수) · `intakePrefetchPaths`(DEC-3 · 순수) · `createBatchView` ·
  `withBatchedHeadReads`(DEC-2 · DEC-6 폴백).
- `tests/unit/intake-batch.test.ts` — **신규**. git 없이 순수 부분 검증:
  프리페치 필터 · 티켓 id 파생 · `<ticketRoot>` 안/밖 미스 구분(DEC-6 3분기) · `headArchivePaths` 필터 ·
  배치 읽기 실패 시 throw(하위호환·안전).

Exit: typecheck 0 · `intake-batch`·`git-batch` 단위 그린 · Codex phase 리뷰 승인.
🔴 이 phase 는 아직 **아무 곳에도 배선하지 않는다** — `scanIntake` 는 그대로 옛 경로다.
   (배선과 새 모듈을 한 phase 에 넣으면, 리뷰가 "새 코드가 옳은가" 와 "옳게 꽂혔는가" 를 함께 봐야 한다.)

## Phase 2 — `scanIntake` 배선 + 계수 오라클 (`phase-2-wire-and-count`)

범위 (2파일):
- `scripts/req/lib/intake.ts` — `scanIntake` 가 뷰를 **1회** 만들어 티켓마다 주입.
  🔴 `listHeadTicketIds` 호출 **제거** → `ticketIdsFromEntries`(DEC-8). 함수 자체는 `req:reconstruct`
  때문에 남긴다.
  `scanTicketIntake(root, ticketRel, id, portsOverride?)` — **선택 4번째 인자**로만 확장
  (`req:commit:1287`·`req:doctor:1833` 의 3인자 호출 무수정).
- `tests/unit/req-new-intake.test.ts` — 테스트 **추가만**:
  - 계수(DEC-7-2): 티켓 N개 스캔 시 git 실행 **정확히 2회**, N 을 늘려도 2.
    계수는 `scanIntake` 가 내는 **모든** git 경로(열거·배치)를 관측한다.
  - 동등성(DEC-8): 실 git 저장소에서 `ticketIdsFromEntries(...)` 와 `listHeadTicketIds(...)` 가 같은 집합.
  🔴 **기존 단정은 한 줄도 고치지 않는다** — 고쳐야 한다면 판정이 바뀐 것이고 DEC-1 위반이다.

Exit: typecheck 0 · `req-new-intake`·`intake-guidance`·`req-new` 단위 그린 ·
  이 저장소에서 `req:new` dry-run **10초 이내** 실측 기록 · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(typecheck·해당 시 lint) · **통합 직전 전체 스위트 1회** · 사용자 main 머지(별도 승인).
