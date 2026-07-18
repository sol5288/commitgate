# REQ-2026-032 리뷰 요청

## 배경

CommitGate 개선 **REQ-B-2** — design delta review. G-06b(승인 후 작은 편집이 00/01/02 전체 재리뷰를 부르고
리뷰어가 승인 영역을 재litigate해 승인을 되돌림, REQ-020 14라운드)의 세 번째 축.

**토대(B-1)**: design 승인 시 문서별 blob OID를 `state.design_baseline`에 보존했다(`hasDesignBaseline`으로
legacy 판별). **B-1은 저장만 — 아무도 안 읽었다. B-2가 처음 읽어** delta를 계산·전송한다.

**분할**: REQ-B = B-1(baseline)·**B-2(delta 감지+프롬프트+persona)**·B-3(full review 전환). 사용자 결정.

## 변경 요약

설계 문서 3종만(구현 diff 없음 — design 리뷰). 단일 phase.

- **`computeDesignDelta(baseline, current)`(순수)**: 세 키(requirement/design/plan) OID를 **키별** 비교 →
  `{changed, unchanged}`. `DesignDocBlobs`(B-1) 재사용.
- **delta 게이트**(`main()`): `hasDesignBaseline(state)` true면 delta 모드, 아니면 full(현행). full은 B-1 이전과
  **바이트 동일**.
- **delta 프롬프트**(`assembleReviewPrompt`에 optional `designDelta`): 변경 문서 `[변경됨 — 심사 대상]`,
  미변경 `[승인 baseline — 변경 없음, 참조]` 표시. **세 본문 모두 포함**(미변경도 full — 문맥 보존).
- **`DESIGN_DELTA_CONTRACT`**(코드 상수): delta 모드에서 base persona 뒤 append. "표시된 변경분·직접 영향만
  심사 / 승인 영역 재심사 금지 / 변경이 승인 영역 재고를 강제하면 finding으로." `policy_version` 자동 구분.

🔴 **핵심 안전 결정**: baseline이 있어도 **바인딩·승인 의미는 안 바꾼다**(R5). `captureDesignBinding.designHash`는
여전히 full 현재 설계를 바인딩하고, `processResponse` 승인 판정·`design_approved_hash`·B-1 baseline 저장은
무변경. delta는 **리뷰어에게 보내는 내용**만 바꾼다. 그래서 리뷰어가 delta만 보고 승인해도 승인은 "full 설계
승인"을 의미한다 — 이 gap의 안전판(`FULL_REVIEW_REQUESTED`)은 B-3다. **B-2는 미변경 문서를 참조로 포함해
gap을 최소화**하므로 B-3 없이 단독 병합해도 문맥 무손실로 안전하다(B-1 "저장만" 구조와 동형).

`req-commit.ts`·`machine.schema.json`·매니페스트 **무변경**.

## design-r01 지적 반영 (P1 1건)

1. 🔴 **null base persona 정책 미정**: `reviewPersonaPath: null`은 지원·문서화된 설정(`loadReviewPersona`가
   정상 null 반환)인데, D4가 "base persona fail-closed 필수"라 잘못 전제했다. baseline 보유 + null persona
   설정에서 delta 리뷰 시 null 처리가 미정 — null 문자열화면 계약 우회, throw면 기존 null 설정 파괴.
   → **정책 확정**: base null이면 `DESIGN_DELTA_CONTRACT`를 **단독 persona**로 사용(계약 자체가 리뷰 품질
   계약). base 있으면 `base + contract`. 양쪽 다 delta 계약을 보내고 null 우회 없음. null 설정의 full-모드
   동작(`policy_version='none'`)은 안 깨진다(delta 모드에서만 계약 부착). R4·D4 수정, O1-6(b)·O1-7에
   near-e2e 단언(null 단독 계약·`"null"` coercion 없음) 추가.

## design-r02 지적 반영 (P1 1건)

1. 🔴 **로그 policy_version이 전송 persona를 안 쓰는 배선 누락**: review-call 로그는 `reviewPolicyVersion(persona)`
   (`:1920`)로 계산되는데, 구현이 프롬프트에만 deltaPersona를 넘기고 로그는 옛 `persona`를 유지하면 base 있는
   live delta가 full과 **같은 policy_version**을 기록해 R4 위반. O1-6(순수)·O1-7(DRY-RUN, 로그 미기록)이
   못 잡는다. → **D4에 effective persona 단일화 명시**: `main()`이 전송 persona 하나(`effectivePersona`)를
   프롬프트·로그 양쪽에 흘린다(발산 지점 없음). **O1-9 추가**(near-e2e `--run`): base persona 파일 + baseline
   보유 live delta의 로그 policy_version이 `hash(base+contract)`이고 `hash(base)`가 아님을 단언.

## design-r03 지적 반영 (P1 1건)

1. 🔴 **O1-9가 로그만 봐서 프롬프트 발산을 못 잡음**: 구현이 로그엔 effectivePersona를 쓰되 `assembleReviewPrompt`엔
   base persona를 넘기면(계약이 리뷰어에게 안 감) O1-6·O1-7(null)·O1-9(로그만)가 모두 통과 — base 있는 정상
   경로에서 delta 계약이 실제 전송되지 않아 R4 위반. → **O1-9를 두 축으로 강화**: fake reviewer가 받은
   `fake.requests[0].prompt`에 **base 본문 AND `DESIGN_DELTA_CONTRACT`가 모두 존재**함을 단언(전송 프롬프트
   검증) + 로그 policy_version 단언(기존). 프롬프트·로그 어느 쪽이 발산해도 실패하게 고정.

## design-r04 지적 반영 (P1 2건)

1. 🔴 **base persona full 모드 near-e2e 부재**: O1-5(순수, main 배선 우회)·O1-8(null persona)만 있어, main()이
   baseline 검사 前 base 있으면 계약을 append하는 오구현이 기본 full 리뷰를 오염시켜도 통과. → **O1-10 추가**:
   base persona 파일 + baseline 없음 fixture에서 preview가 계약·delta 태그 없이 base persona만 + 플레인 블록임을
   near-e2e로 단언.
2. 🔴 **zero-change(baseline==current) 게이트 오라클 부재**: O1-2(순수 diff)·O1-7(일부 다른 baseline)·O1-9(baseline
   "세팅"만)라, `changed.length===0`이면 full로 보내는 오구현이 D2(zero-change도 delta 재승인)를 위반해도 통과.
   → **O1-11 추가**: baseline을 현재 OID와 완전 동일하게 세팅한 near-e2e에서 preview에 세 문서 모두 baseline
   태그 + 계약이 있음을 단언(변경 0이어도 delta). 게이트는 `hasDesignBaseline`이지 `changed.length>0`이 아님을 고정.

## design-r05 지적 반영 (P1 2건)

1. 🔴 **부분 변경 문서별 배선 미검증**: computeDesignDelta는 정확해도 main()이 "changed 있으면 전부 [변경됨]"으로
   넘기는 오구현을 현 오라클(O1-7 태그 1개만·O1-9 계약만·O1-11 zero-change)이 못 잡음. → **O1-12 추가**:
   01만 변경된 부분-변경 fixture에서 preview의 문서별 태그(00=baseline·01=changed·02=baseline)를 정확히,
   00·02에 changed 태그가 **안 붙음**까지 단언(near-e2e).
2. 🔴 **full-mode 전체 바이트 동일 미검증**: O1-5(블록 substring)·O1-10(포함/부재)는 무표시 preamble·개행
   삽입을 못 잡음. → **O1-5를 전체 문자열 `===`(하드코딩 expected)로**, **O1-10을 main 전송 prompt vs
   테스트가 같은 입력으로 재조립한 expected 전체 `===`로** 강화. 어떤 바이트 회귀도 봉쇄.

## 리뷰 포인트

리뷰 포인트는 심사 범위의 하한이다.

1. **🔴 안전 설계가 맞는가**(R5·R6). delta가 바인딩·승인 의미를 정말 안 바꾸는가 — `captureDesignBinding`·
   `processResponse`·`design_approved_hash`가 전부 무변경이고 delta는 전송 내용만인가? 리뷰어가 delta만 보고
   승인하는 gap을 "미변경 문서 참조 포함"으로 줄인 게 B-3 전까지 충분한가, 아니면 B-2 단독 병합이 위험한가?
2. **🔴 full 모드 무회귀**(R7·인수기준 4). baseline 없을 때(첫 리뷰·legacy) 프롬프트가 B-1 이전과 바이트
   동일인가? `designDelta` 유무로만 분기해 full 경로에 delta 흔적이 안 새는가? O1-5·O1-8이 이를 잡는가?
3. **🔴 delta 감지 정확성**(R1·D1). `computeDesignDelta`가 **키별** 비교인가(위치·순서 아님)? 한 문서만
   바뀌면 그 키만 changed인가(O1-1)? 전부 동일/전부 상이 경계(O1-2·O1-3)?
4. **persona 계약**(R4·D4). `DESIGN_DELTA_CONTRACT`가 재litigation 금지를 명확히 거는가? base persona가
   여전히 fail-closed 필수이고 delta 블록은 additive인가? `policy_version`이 delta/full을 자동 구분하는가(O1-6)?
5. **미변경 문서 처리**(R3·R6). 미변경 문서를 참조로 **포함**(생략 아님)하는 선택이 맞는가 — 토큰은 더
   쓰지만 문맥 보존으로 안전. 실제 생략을 B-3으로 미룬 게 옳은 분할인가?
6. **단일 phase가 맞는가**. delta 감지 + 프롬프트 + persona가 한 덩어리로 리뷰 가능한 크기인가?
7. **oracle**. O1-1~O1-3(감지)·O1-4(표시)·O1-5(무회귀)·O1-6(계약·policy_version)·O1-7/O1-8(near-e2e 게이트
   배선)이 각 "→ 실패해야 하는 구현"을 실제로 실패시키는가? near-e2e가 게이트 배선(baseline→delta)을 진짜
   증명하는가(순수 조각만이 아니라)?
