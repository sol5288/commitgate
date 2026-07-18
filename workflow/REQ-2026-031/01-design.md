# REQ-2026-031 설계 — design 승인 baseline blob OID 보존

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

- **`captureDesignBinding`(`review-codex.ts:238`)** — `git ls-files -s -- 00 01 02` 파싱. 출력 각 줄 =
  `<mode> <blob-oid> <stage>\t<path>`. 지금은 3줄 정렬·sha256 → `designHash`. **blob OID가 이미 그 안에 있다.**
- **`processResponse`(`:1182` design 분기)** — design 재리뷰 처리. `:1184`에서 `design_approval_evidence`를
  **무조건 stale 제거**(`stateRest`에서 omit), `:1190`에서 승인일 때만 재부착. **여기가 baseline 설정 지점**
  (승인 분기 `:1190`). `nextState.design_baseline`은 top-level이라 stale 제거 대상이 아니다(`stateRest`에 남음).
- **`WorkflowState`** — top-level `design_baseline?: { requirement, design, plan }` 추가(optional).
  `design_approval_evidence`(stale 제거됨)와 **다른 위치** — NEEDS_FIX 생존이 목적.
- **`buildManifestEntry`(`req-commit.ts:89`)·`MANIFEST_KEYS`(`:43`)** — 매니페스트는 evidence 필드를 선별해
  넣는다. `design_baseline`은 **state 필드**라 매니페스트와 무관 → `req-commit.ts` 무변경.
- **`machine.schema.json`** — codex **응답** 스키마. state·매니페스트는 응답이 아니다 → 무관.

## 핵심 설계 결정

### D1. baseline은 **state evidence에만** 저장하고 매니페스트엔 넣지 않는다 (R2·R7)

🔴 **결정적 선택(design-r04 P1)**: baseline을 **별도 top-level `state.design_baseline`**에 두고
`design_approval_evidence` 안에도, 매니페스트(`approvals.jsonl`)에도 넣지 않는다.

```ts
state.design_baseline = { requirement: <oid>, design: <oid>, plan: <oid> }
```

근거:
- 🔴 **NEEDS_FIX에서 살아남아야 한다** — `processResponse`가 design 재리뷰 때 `design_approval_evidence`를
  **무조건 stale 제거**한다(`:1184` `const { design_approval_evidence: _staleDesignEv, ...stateRest }`), 승인일
  때만 재부착(`:1190`). baseline을 evidence 안에 두면 **NEEDS_FIX 재리뷰 한 번에 소멸**해, 다음 재리뷰가
  "B-1 이후 티켓인데도 baseline 없음 → legacy fallback"으로 오판한다. delta review는 NEEDS_FIX 사이클 내내
  baseline이 살아 있어야 성립한다. → **top-level `design_baseline`은 stale 제거 대상이 아니다**(`stateRest`에
  그대로 남는다). design 승인 시에만 갱신된다("마지막 승인된 설계 스냅샷").
- **delta는 진행 중 재리뷰가 읽는다**(B-2) — 커밋된 감사 기록이 아니라 작업 중 state가 필요하다.
- 매니페스트에 안 넣으므로 `MANIFEST_KEYS`·`buildManifestEntry`·`validateManifest`를 **전혀 건드리지
  않는다**(R7). `design_baseline`은 state 필드이지 evidence·매니페스트 항목이 아니다.

따라서 이 REQ는 **`req-commit.ts`를 안 건드린다.** top-level state 필드 추가만이다.

### D2. 문서별 blob OID 추출 (R1)

**`captureDesignDocBlobs(ticketRelDir, gitFn, designDocs): { requirement, design, plan }`(순수)**:
`git ls-files -s -- 00 01 02` 출력에서 문서별 blob OID를 파싱한다.

- 줄 형식: `<mode> <oid> <stage>\t<path>`. `\t`로 path 분리, 공백으로 `[mode, oid, stage]` 분리 → oid는 [1].
- 🔴 **path로 문서 키를 매핑한다 — 위치·순서가 아니라 path 매핑**(design-r01 P1). `path`를 designDocs
  파일명(`requirement`·`design`·`plan`)에 대응시켜 그 OID를 해당 키에 넣는다. 커스텀 designDocs
  (`{requirement:'z.md', design:'a.md', plan:'m.md'}`)면 `ls-files -s`가 경로 알파벳순(a,m,z)으로 나와
  **위치가 문서 순서와 다르다** — 위치로 할당하면 requirement에 a.md OID가 들어가 오염된다. `mode`·`stage`만
  무시한다. 3개 다 매핑돼야 하고, 없으면 throw(fail-closed — `captureDesignBinding`과 같은 계약).
- **`captureDesignBinding`의 `designHash`는 안 바꾼다**(R6) — 별도 함수로 blob OID만 뽑는다. 두 함수가 같은
  `ls-files -s` 출력을 각자 파싱한다(중복 git 호출 피하려면 B-2에서 통합 고려 — B-1은 최소 변경).

blob OID 형식은 git OID(40hex SHA-1 또는 64hex SHA-256) — 기존 `GIT_OID_RE`와 같은 패턴.

### D3. 승인 시 `state.design_baseline` 설정 (R2·R3)

`processResponse`의 **design 분기 승인 지점**(`:1190`, `nextState.design_approved === true && args.archive`)에서
`nextState.design_baseline = designDocBlobs`를 설정한다. `buildApprovalEvidence`는 안 건드린다 — baseline은
evidence가 아니라 top-level state 필드다.

```ts
if (ok && nextState.design_approved === true && args.archive) {
  nextState.design_approval_evidence = buildApprovalEvidence({ ... }) // 기존 그대로
  if (args.designDocBlobs) nextState.design_baseline = args.designDocBlobs // 신규(승인 시에만)
}
```

- **NEEDS_FIX·blocked·invalid는 이 분기를 안 타므로** `design_baseline`이 갱신되지 않는다 — 그러나
  `stateRest`에 **기존 값이 그대로 남는다**(stale 제거 대상은 `design_approval_evidence`뿐, `:1184`).
  → **마지막 승인 baseline이 NEEDS_FIX 사이클 내내 보존된다**(R2·인수기준 4b).
- **배선 경로**: `main()`이 `captureDesignDocBlobs`를 호출(이미 `captureDesignBinding`을 부르는 지점 근처,
  같은 git 대상) → `processResponse`의 `args.designDocBlobs`로 전달. `processResponse` 인자에
  `designDocBlobs?` 추가.

### D4. legacy 판별 (R4·R5)

**`hasDesignBaseline(state): boolean`(순수)**: `state.design_baseline`이 3개 OID를 가진 객체인지 판별.
B-1은 이 함수를 **제공만** 하고 **아무 데서도 호출하지 않는다**(R5) — B-2가 delta/full 분기에 쓴다.

**legacy 무침습**(R5): B-1 이전 승인된 state는 `design_baseline`이 없다. 소급 수정하지 않는다 — 그 티켓이
다음 design 재리뷰로 승인될 때 자연히 채워진다(또는 B-2가 full review로 fallback).

## Phase별 구현

단일 phase — baseline 저장 + legacy 판별은 한 덩어리이고 작다(순수 함수 2개 + evidence 필드 + 배선).

| phase | 범위 | 변경 파일 |
|---|---|---|
| `phase-1-baseline-capture` | D1~D4 — `captureDesignDocBlobs`·`hasDesignBaseline`·`WorkflowState.design_baseline`·`processResponse` 배선(승인 시 설정, NEEDS_FIX 보존) | `review-codex.ts`·테스트 |

## 변경 파일

- `scripts/req/review-codex.ts` — `WorkflowState.design_baseline` · `captureDesignDocBlobs`(순수) ·
  `hasDesignBaseline`(순수) · `processResponse` designDocBlobs 인자 + 승인 분기 설정 · `main()` 배선
- `tests/unit/req-review-codex.test.ts` — 오라클

**`req-commit.ts` 무변경**(D1) — baseline은 매니페스트에 안 들어간다.

## 하위호환·안전

- **동작 무변경**(R6): `captureDesignBinding.designHash`·design 게이트·`assembleReviewPrompt`·리뷰 흐름
  그대로. 저장된 baseline은 **아무도 읽지 않는다**(B-2가 읽는다). 이 REQ는 evidence에 optional 필드를
  **추가**할 뿐이다.
- **매니페스트·D17 무영향**(R7): `design_baseline`은 top-level state 필드(evidence·매니페스트 아님). `MANIFEST_KEYS`·`buildManifestEntry`·
  `validateManifest` 무변경 → 기존 evidence 검증·finalize·doctor가 새 필드와 무관하게 통과.
- **`machine.schema.json` 무변경**: evidence는 codex 응답이 아니다. v1.1 archive 검증 그대로.
- **legacy 무침습**(R5): 기존 승인 evidence 소급 수정 없음. `hasDesignBaseline`은 판별만, 호출 없음.
- 이 REQ는 **additive**다. B-2·B-3을 기다리지 않고 단독 병합한다. baseline만 쌓이고 동작은 불변이라
  단독 병합이 안전하다(A-1이 "계수만, 막지 않음"이었던 것과 같은 구조).
