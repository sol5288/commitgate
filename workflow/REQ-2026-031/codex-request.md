# REQ-2026-031 리뷰 요청

## 배경

CommitGate 개선 **REQ-B-1** — design 승인 baseline blob OID 보존. REQ-B(design delta review)의 토대.

**원래 P0 나머지(G-06b)**: 승인 후 작은 편집이 00/01/02 전체 재리뷰를 부르고, 리뷰어가 승인된 영역을
새로 읽어 승인을 되돌린다(REQ-020 14라운드). delta review = 승인 baseline 이후 변경분만 재검토. 그러려면
먼저 "승인 시점 설계가 무엇이었나"를 문서별로 기억해야 한다. 이 REQ가 그 **baseline 저장**이다.

**실측 토대**: `captureDesignBinding`이 이미 `git ls-files -s -- 00 01 02`를 파싱한다 — 각 줄에 문서별
**blob OID**가 있다. B-1은 그걸 문서별로 뽑아 승인 evidence에 보존한다.

**분할**: REQ-B를 B-1(baseline)·B-2(delta 프롬프트+persona)·B-3(full review 전환)으로 나눴다(사용자 결정,
A 계열 수렴 근거). **이 REQ(B-1)는 저장만 — 아무 동작도 안 바꾼다.** delta 감지·프롬프트는 B-2.

## design-r01 지적 반영 (P1 1건 + observation)

1. 🔴 **path 매핑 vs 위치 할당 모순**: 요구·오라클은 "path 무시"라 썼는데 설계 D2는 "path 매핑"이라 모순.
   커스텀 designDocs(`z/a/m.md`)면 `ls-files -s`가 경로순(a,m,z)으로 나와 위치 할당 시 baseline 오염.
   → **요구 R1·인수기준·D2·O1-1을 "mode·stage 무시, path로 키 매핑"으로 통일.** O1-1b 추가(비정렬 custom
   designDocs에서 각 키가 해당 경로 OID를 받음 — 위치 할당 구현은 실패).

observation: `buildApprovalEvidence`는 `main()`이 아니라 `processResponse()` 내부 호출 → §D3에 배선 경로
(main baseArgs → processResponse 인자 → buildApprovalEvidence) 명시.

## design-r02·r03 지적 반영

**r02** 🔴 R6 검증 오라클 부재 → **O1-8 추가**(baseline 有/無 state에서 프롬프트·판정 동일).
**r03** 🔴 O1-8은 "호출하고 버리는" 구현을 못 잡음 → `hasDesignBaseline` 호출 부재(negative)는 in-module이라
`vi.spyOn`으로 깨끗이 테스트 불가. **두 가지로 고정**: ① O1-8을 **byte-identical 프롬프트 + 동일 판정**으로
강화(호출·폐기해도 행동이 다르면 잡힘). ② **구조적 사실**: B-1에서 `hasDesignBaseline`은 **프로덕션 호출
지점 0개**(테스트만 호출) — 작은 diff라 리뷰어가 diff로 확인. 02-plan 정직성 절에 명시.

## design-r04 지적 반영 (P1 1건 — 저장 위치 재설계)

1. 🔴 **NEEDS_FIX 재리뷰에서 baseline 소멸**: baseline을 `design_approval_evidence`에 저장하면,
   `processResponse`가 design 재리뷰마다 `design_approval_evidence`를 **무조건 stale 제거**하므로(`:1184`),
   B-1 승인 후 문서를 편집해 NEEDS_FIX를 한 번만 받아도 baseline이 사라진다 → 다음 재리뷰가 "B-1 이후인데
   baseline 없음 → legacy"로 오판. delta review는 NEEDS_FIX 사이클 내내 baseline이 살아야 성립한다.
   → **저장 위치를 별도 top-level `state.design_baseline`으로 이동**(evidence·매니페스트 아님). stale 제거
   대상이 아니라 `stateRest`에 남고, design 승인 시에만 갱신("마지막 승인된 설계 스냅샷"). `buildApprovalEvidence`
   무변경 — 설정 지점은 `processResponse` 승인 분기(`:1190`)로 이동. 인수기준 4b·O1-6(NEEDS_FIX 보존
   near-e2e) 추가 — 두 번째 재리뷰에서도 baseline이 남아 있음을 검증.
   R2·R3·R7, D1·D3·D4, 00/01/02 전반을 `design_doc_blobs`(evidence) → `design_baseline`(state)으로 통일.

## 변경 요약

설계 문서 3종만(구현 diff 없음 — design 리뷰). 단일 phase.

- **`WorkflowState.design_baseline?`**(optional top-level) — `{requirement, design, plan}` 각 blob OID.
- **`captureDesignDocBlobs`(순수)**: `git ls-files -s` 출력에서 문서별 OID 파싱. `captureDesignBinding`의
  `designHash`는 **무변경**(별도 함수로 OID만 뽑음).
- **`hasDesignBaseline(state)`(순수)**: `state.design_baseline`이 baseline을 가졌는지 판별. B-1은
  **제공만·호출 없음**(B-2가 씀).
- **`processResponse` 승인 분기(`:1190`)에서 `nextState.design_baseline` 설정** — `main()`이
  `captureDesignDocBlobs` 호출 → `processResponse` 인자로 전달. `buildApprovalEvidence` 무변경.

🔴 **핵심 결정(design-r04 P1)**: baseline을 **별도 top-level `state.design_baseline`**에 저장하고,
`design_approval_evidence` 안에도 매니페스트(approvals.jsonl)에도 넣지 않는다. evidence에 두면
`processResponse`의 same-kind stale 제거(`:1184`)로 **NEEDS_FIX 한 번에 소멸**한다 — delta는 NEEDS_FIX
사이클 내내 baseline이 살아야 하므로 stale 제거 대상이 아닌 top-level 필드여야 한다. state 필드라
`MANIFEST_KEYS`·`buildManifestEntry`·`validateManifest`를 전혀 안 건드린다 → `req-commit.ts` 무변경.

`captureDesignBinding.designHash`·design 게이트·`assembleReviewPrompt`·`buildApprovalEvidence`·
`machine.schema.json` **무변경**.

## 리뷰 포인트

리뷰 포인트는 심사 범위의 하한이다.

1. **🔴 정말 아무 동작도 안 바꾸는가**(R6). baseline은 저장만 되고 **아무도 안 읽는가**? `hasDesignBaseline`이
   제공만 되고 호출 안 되는가? 프롬프트 조립·design 게이트·리뷰 흐름이 불변인가? B-1 단독 병합이 안전한가
   (A-1의 "계수만" 구조와 같은가)?
2. **🔴 NEEDS_FIX 보존이 실제로 성립하는가**(R2·인수기준 4b·D1·D3, r04 핵심). baseline을 top-level
   `state.design_baseline`에 둔 선택이 `processResponse`의 stale 제거(`:1184`)를 실제로 회피하는가 —
   `stateRest`에 남아 NEEDS_FIX 재리뷰 뒤에도, **두 번째 재리뷰에서도** 살아있는가? O1-6이 이를 잡는가?
   승인 분기(`:1190`)에서만 갱신되고 needs-fix/phase에선 새 값을 안 쓰되 기존 값을 **지우지도 않는가**?
3. **🔴 매니페스트 무영향이 실제로 성립하는가**(R7·D1). `design_baseline`을 state 필드로 둔 선택이
   `buildManifestEntry`·`MANIFEST_KEYS`·`validateManifest`를 진짜로 안 건드리는가(state 필드라 애초에
   매니페스트 밖)? O1-7이 이를 잡는가? `req-commit.ts` 무변경이 맞는가?
4. **🔴 blob OID 파싱 정확성**(R1·D2). `captureDesignDocBlobs`가 `<mode> <oid> <stage>\t<path>`에서 OID만
   정확히 뽑는가(mode·stage 무시, **path로 키 매핑**)? 커스텀 designDocs 비정렬에서도 정확한가(O1-1b)?
   3개 누락 시 fail-closed? `captureDesignBinding.designHash`와 분리돼 그것을 안 바꾸는가?
5. **승인 경로 격리**(R3·D3). baseline이 **design 승인에만** 저장되고 phase 승인·needs-fix·blocked·invalid엔
   새로 안 쓰이는가(O1-4·O1-5)?
6. **legacy 무침습**(R5). 기존 승인 state를 소급 수정하지 않는가? `design_baseline` 없는 state가
   `hasDesignBaseline` false이고, 그것으로 B-1이 아무 분기도 안 하는가(호출 지점 0개)?
7. **단일 phase가 맞는가**. baseline 저장 + legacy 판별이 한 덩어리로 리뷰 가능한 크기인가?
8. **oracle**. O1-1/O1-1b(path 매핑 OID 파싱)·O1-4(near-e2e 승인 저장)·O1-5(승인 외 미설정)·
   O1-6(NEEDS_FIX 보존)·O1-7(매니페스트 무영향)·O1-8(byte-identical 동작 불변)이 각 "→ 실패해야 하는
   구현"을 실제로 실패시키는가?
