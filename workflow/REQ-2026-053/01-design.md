# REQ-2026-053 설계 — durable close-proof 마이그레이션 (`req:close`)

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

- `scripts/req/lib/close-proof.ts` — `CloseProofEvent = 'series-terminal' | 'dev-complete'`,
  `CloseBaseState = 'legacy' | 'series-terminal' | 'dev-complete' | 'needs-recovery' | 'developing'`,
  `deriveBaseState`, `closeProofRowProblems`, `closeProofRowKey`, `baseStateBlocksIntake`.
- `scripts/req/lib/intake.ts` — `scanTicketIntake`(HEAD blob 사실 수집)·`classifyIntake`(순수 판정) —
  `deriveBaseState` 결과로 `baseStateBlocksIntake`가 차단 여부를 정한다.
- `scripts/req/lib/evidence.ts` — `verifyCommittedEvidenceIntegrity`·`designHashFromManifest`·
  `evidencedPhaseIdsFromManifest`(designRef 없이 호출하면 **매니페스트의 모든 phase-evidenced id**).
- `bin/dispatch.mjs` — `VERB_MODULES`가 현재 req 명령 표면의 SSOT(REQ-2026-052 P4c·DEC-D3). init/migrate/
  uninstall/smoke가 여기서 파생 → 새 verb 추가는 패키징 표면에 **자동 반영**된다.
- 실측 잠금: HEAD에서 REQ-049/050/051/052가 durable + `developing`(close-proof 없음·design 결속 없음) →
  `req:new`가 fail-closed. `--finalize`·`--reconstruct`·bypass 모두 적용 불가(00-requirement 근거).

## 핵심 설계 결정

### DEC-M1 — 새 close-proof 이벤트 `migrated-complete` (+ 동명 기본 상태)

dev-complete를 흉내 내지 않는다. dev-complete는 **self-verifying**(phase가 현재 design_ref에 결속) 이라
레거시 티켓엔 성립할 수 없다. 대신 **정직한 별도 이벤트**를 둔다:

- `CloseProofEvent += 'migrated-complete'`.
- `CloseBaseState += 'migrated-complete'`.
- `deriveBaseState` 우선순위: `legacy > series-terminal > dev-complete > migrated-complete >
  needs-recovery > developing`.
  - **dev-complete 아래**: 정상 dev-complete가 가능하면 그것이 이긴다(마이그레이션이 강한 경로를 가리지 않음).
  - **needs-recovery 위**: 일단 운영자가 마이그레이션으로 종결하면 종결이다. 단 `req:close`가 needs-recovery/
    corrupt에 **스탬프를 애초에 찍지 않으므로**(DEC-M3) 이 우선순위가 recovery 필요를 가리는 일은 없다.
- `baseStateBlocksIntake('migrated-complete') === false`(비차단). `classifyIntake` reason에 케이스 추가.

### DEC-M2 — `migrated-complete` 행의 형태 (감사 정직성)

`series-terminal`도 self-verifying `dev-complete`도 아닌 **운영자 확인 마이그레이션 스탬프**임을 스키마가 드러낸다:

| 필드 | 값 |
|---|---|
| `event` | `'migrated-complete'` |
| `series_id` | `null` |
| `resolution` | `null` |
| `phase_inventory` | 커밋된 매니페스트의 **모든 phase-evidenced id**(정렬·중복 제거) — "무엇이 완료였나" |
| `design_ref` | 커밋된 design 승인의 `design_hash`(`designHashFromManifest`) — 어느 설계에 대해 완료였나 |
| `at` | 실제 시계(ISO) |
| `reconstructed` | **`true` 강제** — 사후 스탬프다. 원본(reviewer 응답 시점 발행)과 구별 |
| `evidence_basis` | 완료를 뒷받침하는 커밋 아티팩트 **경로 목록**(`approvals.jsonl` + design·phase 아카이브 경로) — 본문 아님 |

- 자연키(멱등·supersede): `(ticket_id, event)`. `closeProofRowKey`의 discriminator에서 `migrated-complete`는
  **빈 문자열**(`series_id`/`design_ref` 모두 미사용) → 티켓당 1행.
- 검증(`closeProofRowProblems`): `series_id===null`·`resolution===null`·`phase_inventory` 비지 않은 정렬·중복
  없는 문자열 배열·`design_ref` 비지 않은 문자열·`reconstructed===true` **필수**. `reconstructed:true`이므로
  기존 규칙에 의해 `evidence_basis`도 비어선 안 된다(근거 없는 복원 금지 — 이미 강제됨).

### DEC-M3 — `req:close` 자격 판정 (HEAD-committed only · fail-closed)

`req:close <REQ> --migrate`는 **HEAD blob + git ancestry만** 읽어(워킹 state 미참조) 아래를 **전부** 만족할
때만 스탬프한다:

1. durability marker 존재(durable 티켓) — 아니면 legacy라 애초에 차단 안 됨(거부: "legacy는 종결 불필요").
2. HEAD 증거 무결성 통과(`verifyCommittedEvidenceIntegrity.problems === []`) — design·phase 아카이브 부재/
   변조면 **거부**(손상된 티켓에 완료를 스탬프하지 않는다).
3. 커밋된 design 승인 존재(`designHashFromManifest !== null`) — 없으면 거부(무엇에 대한 완료인지 불명).
4. phase 증거 ≥1(`evidencedPhaseIdsFromManifest(manifest).length > 0`) — 실제 phase를 거친 티켓만.
5. 현재 기본 상태가 `developing` — needs-recovery·corrupt면 거부(먼저 복구). 이미 종결(dev-complete/
   series-terminal/migrated-complete)이면 **거부가 아니라 성공 no-op**(DEC-M7).
6. **정상 dev-complete가 가능하면 거부**: design-bound phase 집합(`evidencedPhaseIds(…, designRef)`)이 전체
   evidenced inventory를 덮으면 정상 `req:commit --finalize` 경로를 쓰라고 안내(마이그레이션으로 강한 경로 우회 금지).
7. 🔴 **완료성 증명 = integrated (P1-1 대응)**: 티켓의 `approvals.jsonl`을 **마지막으로 수정한 HEAD 커밋**이
   **mainline의 조상**이어야 한다(`git merge-base --is-ancestor <c> <mainline>`). 즉 티켓 작업이 **본선에
   병합·출시된 완료 티켓**만 마이그레이션한다.
   - **왜 integrated인가**: 레거시 티켓의 per-ticket 커밋 증거만으로는 "완료(unbound)"와 "진행 중(P1만
     unbound·P2 미완)"을 **구조적으로 구별할 수 없다** — 커밋된 `state.phases`는 스캐폴드 `[]`이고, 매니페스트는
     **완료된** phase만 보일 뿐 "계획됐으나 미완"을 못 담는다. 병합 여부(git ancestry)만이 그 둘을 가른다.
     진행 중 티켓은 본선에 없어 → 거부됨(강한 finalize/완료 경로로 유도).
   - 🔴 **mainline ref는 운영자 입력을 받지 않는다(r02 P1)**. `--mainline <ref>` 같은 override는 진행-중 티켓
     작업자가 자기 feature 브랜치/`HEAD`를 넘겨 integrated=true로 만드는 **자명한 우회**라 **두지 않는다**.
     대신 **신뢰된 ref만** 고정 순서로 해소한다: ① `git symbolic-ref refs/remotes/origin/HEAD`(원격이 선언한
     기본 브랜치) → ② `origin/main`·`origin/master`(원격 추적) → ③ 로컬 `main`·`master`. 아무것도 없으면
     **fail-closed**("mainline 결정 불가 — main/origin/main 필요"). 운영자가 로컬 `main`을 강제 이동해 거짓
     mainline을 만드는 것은 감사 전체 날조와 같은 급의 **의도적 손상**이라 위협모델 밖으로 명시한다(우발적/
     구조적 우회만 방어; REQ-019 부류).
   - 🔴 이 검사는 **command 전용 precondition**이다. B2의 "integrated는 오버레이·`deriveBaseState`에 넣지
     않음"(순수 파생 밖) 원칙은 그대로 — deriveBaseState는 여전히 integrated를 보지 않는다.

거부는 전부 fail-closed(비-스탬프) + 사유·대안 경로 출력.

phase_inventory = 매니페스트의 무결성 검증된 phase-evidenced id 전체(정렬·중복 제거). 병합된 완료 티켓이므로
이 집합이 곧 완료 inventory다.

### DEC-M4 — dry-run 기본 · `--run` 실행 · durable pathspec 커밋

- `--run` 없으면 dry-run: 자격 판정·발행할 행을 **보여만** 주고 쓰지 않는다.
- `--run`: `ticket-close.jsonl`에 append하고 **pathspec 커밋**(`git add/commit -- <ticket-close 경로>`) —
  staged 코드 미접촉(`precallCommitLedgerRow`·`durableParentSeriesTerminal`과 동일 기법).
- 쓰기 전 close-proof 경로 **clean 가드**: `git status --porcelain -- <close-proof>`가 dirty면 fail-closed
  (미커밋 close-proof를 HEAD 기반 쓰기가 덮어 잃지 않게 — `req:reconstruct`의 P1 가드와 동형).
- `state.json` 미변경(HEAD-committed only 원칙 — 워킹 state 안 봄·안 씀).

### DEC-M7 — 재실행 계약 (P1-2 대응: 명시적 command-level no-op)

`at`이 실제 시계이므로 두 번째 실행이 만드는 행은 첫 행과 **byte-동일이 될 수 없다** → 자연키 append 멱등에
기댈 수 없다(같은 키·다른 내용 = conflict). 따라서 멱등은 **command 레벨**에서 처리한다:

- 계획 **전에** HEAD close-proof를 읽어 **이미 terminal close(dev-complete/series-terminal/migrated-complete)가
  있으면** → **성공 no-op**: 기존 행을 **그대로 보존**(새 `at`으로 재작성하지 않음), "이미 종결(<상태>)" 출력,
  exit 0, write·commit 없음.
- 그렇지 않을 때만 DEC-M3 판정 → 신규 migrated-complete 행 append·커밋.
- 결과: 동일 `req:close --migrate --run` 재실행은 커밋 1개(2번째 no-op) — DEC-M3.5의 "이미 종결"은 거부가
  아니라 이 no-op이다. dry-run 재실행도 "이미 종결" 표시만.

### DEC-M5 — 순수/IO 분리 · dispatch 표면

- `scripts/req/lib/close-migrate.ts` — **순수** `planMigrationClose(facts)`: 자격(DEC-M3)을 판정하고
  적격이면 `migrated-complete` 행을, 부적격이면 거부 사유를 낸다. facts는 intake와 같은 HEAD 사실.
- `scripts/req/req-close.ts` — CLI 경계: HEAD blob 수집(intake 포트 재사용) → `planMigrationClose` →
  dry-run/`--run` + clean 가드 + append + pathspec 커밋.
- `bin/dispatch.mjs` `VERB_MODULES += 'req:close'` → Stage-B 표면 자동 포함(P4c). init/migrate/uninstall/
  smoke는 파생이라 코드 수정 불요; per-verb smoke가 `req:close`를 자동 검증. init.test의 STAGE_B 파생 집합
  비교 테스트는 dispatch 파생이라 자동 통과(하드코딩 목록 있으면 갱신).

### DEC-M6 — 하위호환·릴리스

- 이벤트/상태 추가는 **additive**. 기존 close-proof(series-terminal/dev-complete)는 그대로 유효.
- `migrated-complete`를 담은 close-proof는 **≥REQ-053 코드**를 요구한다(구 리더는 알 수 없는 event로 fail-closed).
  close-proof는 저장소-내부 아티팩트이고 053이 함께 배포되므로 야생 구-리더 문제 없음(스키마 discriminator라
  ledger의 lifecycle **값** forward-compat와 달리 관용할 수 없음을 명시).

## Phase별 구현

- **Phase 1 — `migrated-complete` 스키마 (leaf, 순수)**: close-proof.ts에 event·base state·검증·
  `deriveBaseState`·`closeProofRowKey` 추가 + close-proof 단위 테스트.
- **Phase 2 — `req:close` 명령 + intake 배선**: lib/close-migrate.ts(순수 planner) + req-close.ts(CLI) +
  dispatch VERB_MODULES + classifyIntake reason + 실git 테스트(픽스처 레거시 티켓 종결 → intake 통과).

## 변경 파일

- `scripts/req/lib/close-proof.ts` (P1)
- `tests/unit/close-proof.test.ts` (P1)
- `scripts/req/lib/close-migrate.ts` (P2, 신규)
- `scripts/req/req-close.ts` (P2, 신규)
- `bin/dispatch.mjs` (P2)
- `scripts/req/lib/intake.ts` (P2 — reason 케이스만)
- `tests/unit/close-migrate.test.ts`·`tests/unit/req-close.test.ts` (P2)
- `tests/unit/init.test.ts` 등 STAGE_B 파생 목록 하드코딩분 있으면 (P2)

## 하위호환·안전

- HEAD-committed only·read-only 분류·pathspec 커밋·clean 가드·멱등 — B2 close-proof 계열 규칙 그대로 계승.
- dev-complete 강한 경로 불변. 마이그레이션은 좁은 틈(완전 증거·결속 부재·developing)에만.
- code/main 무변경. main 통합은 C·D·E와 함께 마지막에 사용자 확인.
