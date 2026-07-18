# REQ-2026-031 요구사항 — design 승인 baseline blob OID 보존 (개선 REQ-B-1)

## 1. 배경

**원래 P0 두 개 중 나머지(G-06b)**: 승인 후 작은 설계 편집이 00/01/02 전체 재리뷰를 부르고, 리뷰어가
이미 승인된 영역을 새로 읽어 새 모순을 찾아 승인을 되돌린다. REQ-020의 design 14라운드가 이것이었다
(r02 승인 → r03 반려 → …). 배칭(A0)·상한(A)과 함께 리뷰 수렴의 세 번째 축이 **delta review**(REQ-B)다:
승인 baseline 이후 **변경분과 직접 영향 범위만** 재검토한다.

delta review가 성립하려면 먼저 **"승인 시점의 설계가 무엇이었나"를 문서별로 기억**해야 한다. 그래야 재리뷰
때 "무엇이 바뀌었나"를 계산한다. 이 REQ(B-1)는 그 **baseline 저장**이다.

**실측 토대**: `captureDesignBinding`(`review-codex.ts:238`)이 이미 `git ls-files -s -- 00 01 02`를 파싱한다.
그 출력의 각 줄에 **mode·blob OID·stage·path**가 있다 — 즉 **문서별 blob OID가 이미 손 안에 있다.** 지금은
3줄을 정렬·sha256해 `designHash`로 뭉뚱그릴 뿐이다. B-1은 그 blob OID를 **문서별로** 뽑아 승인 evidence에
보존한다.

**분할**: REQ-B를 B-1(baseline)·B-2(delta 프롬프트+persona)·B-3(full review 전환)으로 나눴다(사용자 결정).
근거: A 계열이 ~360줄 단위로 4라운드 이내 수렴했고, 026 통합은 미수렴했다. **이 REQ(B-1)는 baseline 저장
+ legacy 판별까지만.** delta 감지·프롬프트 변경은 B-2다.

## 2. 목표(What)

design 승인 시 **문서별 blob OID**(00·01·02 각각)를 **별도 top-level `state.design_baseline`**에 보존한다
(NEEDS_FIX 재리뷰에서 살아남는 위치). 그리고 그 필드가 **없는 구버전 state**(B-1 이전 승인)를 판별할 수
있게 한다 — B-2가 그런 티켓을 full review로 fallback하기 위해.

**🔴 이 REQ는 아무 동작도 바꾸지 않는다.** delta 감지·프롬프트 축소·페르소나 분기는 전부 B-2다. B-1은
**저장만** 한다 — 저장된 baseline은 아직 아무도 읽지 않는다. 그래야 B-2가 안전한 토대 위에서 delta를 얹는다.

## 3. 요구(정규화)

### baseline 저장

- **R1 문서별 blob OID 추출**: `git ls-files -s -- 00 01 02` 출력에서 **문서별 blob OID**를 파싱하는 순수
  함수를 만든다. 각 줄 `<mode> <oid> <stage>\t<path>`에서 **`mode`·`stage`는 무시하고, `path`로 문서 키
  (requirement/design/plan)를 매핑한다**(위치·순서가 아니라 **path 매핑**). 🔴 커스텀 designDocs 파일명이면
  `ls-files -s`가 경로 알파벳순으로 나와 위치가 뒤섞이므로, path로 매핑하지 않으면 baseline이 오염된다.
  기존 `captureDesignBinding`의 `designHash`(3줄 정렬 sha256)는 **무변경** — 별도로 blob OID 맵을 추출한다. (Done #1)
- **R2 🔴 별도 top-level `design_baseline`에 보존 — NEEDS_FIX에서 살아남는다**(design-r04 P1): design 승인
  시 `state.design_baseline = { requirement, design, plan }`(각 blob OID)에 저장한다. **`design_approval_evidence`
  안에 두지 않는다** — `processResponse`가 design 재리뷰 시 `design_approval_evidence`를 stale로 무조건 제거
  하므로(`:1184`), 거기 두면 NEEDS_FIX 재리뷰 한 번에 baseline이 소멸해 다음 재리뷰가 legacy로 오판된다.
  `design_baseline`은 **design 승인 시에만 갱신**되고 NEEDS_FIX·stale 제거가 건드리지 않는다(개념적으로
  "마지막 승인된 설계 스냅샷"). `design_hash`·`design_approval_evidence`는 그대로 둔다. (Done #1)
- **R3 승인 경로에서만 저장**: baseline은 **design 승인이 실제로 성립할 때만** 기록한다(needs-fix·blocked·
  invalid에는 없음). `processResponse`의 design 승인 분기(`nextState.design_approved===true && args.archive`,
  `:1190`)에서 `nextState.design_baseline`을 설정한다 — `design_approval_evidence` 재부착과 같은 지점. (Done #1)

### legacy 판별

- **R4 legacy 판별 순수 함수**: `state.design_baseline`이 3 OID를 가졌는지 판별하는 순수 함수를 만든다
  (`hasDesignBaseline(state): boolean`). B-2가 이걸로 "delta 가능 / full review fallback"을 가른다. (Done #2)
- **R5 🔴 legacy 무침습·무동작**: B-1 이전에 승인된 티켓(`state.design_baseline` 없음)을 **소급
  수정하지 않는다.** 그리고 B-1은 그 판별 결과로 **아무것도 하지 않는다** — 판별 함수만 제공하고, 그것을
  써서 분기하는 것은 B-2다. (constraints)

### 범위·안전

- **R6 동작 무변경**: `captureDesignBinding`의 `designHash`·design 승인 게이트·`assembleReviewPrompt`·
  프롬프트 조립·리뷰 흐름을 **바꾸지 않는다.** B-1은 top-level state 필드를 **추가**할 뿐이다. 저장된 baseline은
  아직 read되지 않는다. (constraints)
- **R7 하위호환**: `design_baseline`은 optional top-level state 필드. 매니페스트·evidence 검증
  (`validateManifest`·`buildManifestEntry`·D17 등)이 **이 필드 유무와 무관하게** 통과한다 — state 필드라
  `MANIFEST_KEYS` 밖이므로 애초에 매니페스트에 들어가지 않는다. `machine.schema.json`은 변경하지 않는다
  (state는 codex 응답 스키마가 아니다). `req-commit.ts` 무변경. (constraints)
- **R8 테스트·typecheck**: 단위 테스트·typecheck 통과. blob OID 추출·evidence 보존·legacy 판별을
  오라클로 고정한다. (Done #3)

## 4. 비목표 — 이번 범위에서 구현하지 않음

- 🔴 **B-2**: delta 감지(baseline vs 현재 blob OID diff)·delta 프롬프트 조립(변경분+인접 문맥만 전송)·
  design-delta 전용 persona. **전부 범위 밖.** B-1은 저장만.
- 🔴 **B-3**: `FULL_REVIEW_REQUESTED` 상태·full review 전환·사람 승인 경로.
- 로그 측정(배분표 ⑫⑬⑭)·accept-risk 우회 게이트(④). 별도 REQ.
- 기존 REQ-001~030의 문서·state·승인 evidence 소급 수정.

## 5. 인수 기준

1. 순수 함수가 `git ls-files -s` 출력에서 문서별 blob OID를 정확히 파싱한다 — **mode·stage는 무시하고
   path로 키 매핑**, OID 추출. 커스텀 designDocs(경로 알파벳순이 문서 순서와 다름)에서도 각 키가 해당
   경로의 OID를 받는다.
2. design 승인 시 `state.design_baseline`(00·01·02 각 blob OID)이 저장된다. needs-fix 등 미승인엔 저장 안 함.
3. `captureDesignBinding`의 `designHash`가 무변경(기존 오라클 그대로 통과).
4. `hasDesignBaseline`이 `state.design_baseline` 있으면 true, 없는(legacy) state면 false.
4b. 🔴 design 승인 뒤 문서 편집·재리뷰가 **NEEDS_FIX**여도 `state.design_baseline`이 **보존**된다
   (`design_approval_evidence`처럼 stale 제거되지 않는다). 두 번째 재리뷰에서도 baseline이 남아 있다.
5. 🔴 저장 외에 **아무 동작도 안 바뀐다** — 프롬프트 조립·리뷰 흐름·design 게이트 무변경. 기존 evidence
   검증·매니페스트·D17이 새 필드와 무관하게 통과(전체 테스트 그린).
6. 단위 테스트·typecheck 통과.
