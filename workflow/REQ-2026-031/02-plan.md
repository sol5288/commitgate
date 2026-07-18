# REQ-2026-031 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

> **오라클 원칙(REQ-2026-025 교훈)**: 오라클은 "필드가 있다"가 아니라 **"지우면/뒤집으면 실패한다"** 로 쓴다.

## Phase 1 — baseline capture (`phase-1-baseline-capture`)

범위: D1~D4. `captureDesignDocBlobs`·`hasDesignBaseline`(순수) · `WorkflowState.design_baseline` ·
`processResponse` 배선(승인 시 설정, NEEDS_FIX 보존). **저장만 — 아무 동작도 안 바꾼다.**

변경 파일: `scripts/req/review-codex.ts` · `tests/unit/req-review-codex.test.ts`

### Oracle — 순수 함수

- **O1-1 🔴 blob OID 파싱 — path 매핑**(R1): `captureDesignDocBlobs`가 `100644 <oid> 0\t<path>`에서 문서별
  OID를 뽑는다 — **mode·stage 무시, path로 키 매핑**. 3개 중 누락이면 throw.
- **O1-1b 🔴 커스텀 designDocs·비정렬 출력**(R1, design-r01 P1): `designDocs={requirement:'z.md',
  design:'a.md', plan:'m.md'}`이고 `ls-files -s`가 경로 알파벳순(a,m,z)으로 나올 때, **각 키가 해당 경로의
  OID**를 받는다. → **위치로 할당한 구현은 실패한다**(requirement에 a.md OID). path 매핑 강제.
- **O1-2 `captureDesignBinding.designHash` 무변경**(R6): 기존 `designHash`가 그대로(기존 오라클 통과).
  → blob OID 추출을 designHash에 섞으면 실패.
- **O1-3 🔴 `hasDesignBaseline(state)` 판별**(R4): `state.design_baseline`이 3 OID 객체면 true, 없거나 불완전하면
  false. → 부재를 true로 보면 B-2가 legacy를 delta로 처리해 오작동.

### Oracle — near-e2e (design 승인 저장 · NEEDS_FIX 보존)

- **O1-4 🔴 실제 design 승인이 `state.design_baseline`을 설정한다**(R2·R3, near-e2e): A-1 하네스(fake reviewer)로
  design **approved**를 돌려, 승인 후 **`state.design_baseline`**이 3 OID로 채워짐을 단언(`hasDesignBaseline` true).
  → `main()`/`processResponse`가 안 설정하면 실패.
- **O1-5 🔴 NEEDS_FIX·phase엔 baseline 미설정, 그러나 기존 값 보존**(R3): design **NEEDS_FIX** near-e2e에서
  `design_baseline`이 새로 설정되지 않는다(승인 아님). phase 승인도 설정 안 함(design 전용).
- **O1-6 🔴 NEEDS_FIX가 기존 baseline을 지우지 않는다**(R2·인수기준 4b, design-r04 P1, near-e2e):
  `state.design_baseline`이 이미 있는 state에서 design **NEEDS_FIX**를 돌리면, `design_approval_evidence`는
  stale 제거되지만 **`design_baseline`은 그대로 남는다**. 이어 두 번째 재리뷰에서도 `hasDesignBaseline` true.
  → **baseline을 `design_approval_evidence`에 저장한 구현은 여기서 실패한다**(NEEDS_FIX 한 번에 소멸 → 다음
  재리뷰가 legacy 오판). B-1의 핵심 저장-위치 결정을 이 오라클이 고정한다.

### Oracle — 무변경

- **O1-7 🔴 매니페스트·기존 흐름 무변경**(R7): `design_baseline`은 state 필드라 `buildManifestEntry`(req-commit)가
  만든 매니페스트 엔트리엔 **없다**(MANIFEST_KEYS 밖). `validateManifest`가 통과. `req-commit.ts` 무변경.
- **O1-8 🔴 baseline은 동작을 바꾸지 않는다 — byte-identical**(R6, design-r02 P1, near-e2e): **baseline 보유
  state**와 **legacy state**에서 같은 문서로 design 재리뷰를 fake reviewer로 돌려, ① 프롬프트 문자열이
  **byte-identical** ② **판정·최종 게이트 state 동일**을 단언. → baseline을 읽어 동작을 바꾸는 구현은 실패.

### 정직성 — 이 phase가 증명하지 않는 것

- **`main()` 배선**(design 승인 시 `captureDesignDocBlobs` 호출·전달)은 near-e2e(O1-4·O1-6)가 덮는다.
- **baseline이 delta에 쓰인다**는 것은 B-2다. B-1은 저장만.
- 🔴 **`hasDesignBaseline`이 재리뷰 중 호출되지 않음**(R5)은 단위 테스트로 완전히 증명할 수 없다
  (design-r03 P1) — in-module 호출이라 `vi.spyOn(export)`가 못 가로챈다. **두 가지로 고정**: ① 행동 증거
  (O1-8 byte-identical) ② 구조적 사실 — B-1에서 `hasDesignBaseline`은 **프로덕션 호출 지점 0개**(테스트만),
  작은 diff라 리뷰어가 diff로 확인. B-2가 첫 호출 지점을 추가할 때 O1-8이 경계 변화를 드러낸다.

Exit: typecheck0 · 단위 그린 · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(unit·typecheck) · 사용자 main 반영(별도 승인).
- 이 REQ는 additive다. **B-2·B-3을 기다리지 않고 단독 병합한다.**
- 이 repo에 lint 스크립트는 없다(게이트 = typecheck + vitest).
