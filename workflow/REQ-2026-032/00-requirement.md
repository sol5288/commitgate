# REQ-2026-032 요구사항 — design delta review (개선 REQ-B-2)

## 1. 배경

**G-06b(원래 P0)**: 승인 후 작은 설계 편집이 00/01/02 **전체 재리뷰**를 부르고, 리뷰어가 이미 승인된
영역을 새로 읽어 새 모순을 찾아 승인을 되돌린다(REQ-020 design 14라운드: r02 승인 → r03 반려 → …).
리뷰 수렴의 세 번째 축 = **delta review**: 승인 baseline 이후 **무엇이 바뀌었는지**를 리뷰어에게 명시하고,
"변경분과 그 직접 영향만 심사, 승인된 영역은 재litigate 금지"를 계약으로 건다.

**토대(B-1, [[req-2026-031-delta-review-b1]])**: design 승인 시 문서별 blob OID를 `state.design_baseline`에
보존했다. `hasDesignBaseline(state)`로 legacy를 가른다. **B-1은 저장만 — 아무도 안 읽었다. B-2가 처음 읽는다.**

**분할**: REQ-B = B-1(baseline 저장)·**B-2(delta 감지+프롬프트+persona)**·B-3(full review 전환). 사용자 결정.

## 2. 목표(What)

design **재리뷰**에서 `state.design_baseline`과 현재 인덱스의 문서별 blob OID를 비교해 **변경 문서 집합**을
계산하고, 리뷰 프롬프트를 **delta 인지 형태**로 조립한다:
1. 각 설계 문서를 **[변경됨](심사 대상)** / **[승인 baseline·변경 없음](참조)**으로 표시.
2. **design-delta 계약**을 persona에 증강 — "표시된 변경분과 그 직접 영향만 심사, 승인 영역 재심사 금지,
   변경이 승인 영역 재고를 강제하면 그것을 finding으로 밝혀라".

**🔴 안전 우선 — B-3 없이 단독 병합 가능해야 한다.** 그래서 B-2는 미변경 문서를 **생략하지 않는다**
(full 포함, "승인 baseline·참조"로 표시). 재litigation 감소는 persona 계약 + 변경 표시로 얻고, 문맥은
숨기지 않는다. **실제 생략(토큰 절감)·`FULL_REVIEW_REQUESTED` escalation·사람 full-review 승인은 B-3.**

## 3. 요구(정규화)

### delta 감지

- **R1 문서별 OID diff(순수 함수)**: `computeDesignDelta(baseline, current): { changed, unchanged }`를 만든다.
  `baseline`(`state.design_baseline`)과 `current`(현재 인덱스의 `captureDesignDocBlobs`)의 세 키(requirement/
  design/plan) OID를 각각 비교 — 다르면 changed, 같으면 unchanged. **키별 비교**(위치·순서 아님). (Done #1)
- **R2 delta 게이트**: design kind이고 `hasDesignBaseline(state)`가 true면 **delta 모드**, 아니면(첫 리뷰·legacy)
  **full 모드**(현행 그대로). full 모드는 B-1 이전과 **바이트 동일** 프롬프트여야 한다(무회귀). (Done #2)

### delta 프롬프트

- **R3 변경 표시 authority 블록**: delta 모드에서 설계 문서 블록을 문서별로 표시한다 — 변경 문서는
  `[변경됨 — 심사 대상]`, 미변경 문서는 `[승인 baseline — 변경 없음, 참조]`. **세 문서 본문은 모두 포함**
  (미변경도 full — B-3 전까지 문맥 보존). full 모드 블록은 무변경. (Done #3)
- **R4 design-delta persona 계약**: delta 모드에서만 **delta 계약 블록**(코드 상수 `DESIGN_DELTA_CONTRACT`)을
  persona에 붙인다. 계약 = "[변경됨] 문서·그 직접 영향만 심사 / [승인 baseline]은 승인됨·재심사 금지 /
  변경이 승인 영역 재고를 강제하면 finding으로 밝혀라". 🔴 **null base persona 정책**: `reviewPersonaPath: null`
  (persona 명시적 비활성 — 지원·문서화된 설정)이면 base가 null이다. 그때 delta 모드는 `DESIGN_DELTA_CONTRACT`를
  **단독 persona**로 쓴다(계약 자체가 리뷰 품질 계약). base 있으면 `base + contract`. **양쪽 다 delta 계약을
  보낸다** — null 우회 없음. null 설정의 기존 full-모드 동작(`policy_version='none'`)은 안 깨진다. `policy_version`
  (persona 해시 파생)이 delta에서 자동 구분된다. (Done #4)

### 범위·안전

- **R5 🔴 바인딩·승인 의미 무변경**: `captureDesignBinding.designHash`는 **여전히 full 현재 설계**를 바인딩한다.
  delta는 **리뷰어에게 보내는 내용**만 바꾸고 승인이 무엇을 의미하는지(=full 설계 승인)는 **안 바꾼다**.
  D13 freshness·`processResponse` 승인 판정·`design_approved_hash`는 전부 현행. baseline 저장(B-1)도 그대로
  (승인 시 현재 OID로 갱신). (constraints)
- **R6 🔴 정직한 gap**: 리뷰어가 delta만 보고 승인해도 승인은 full 설계를 의미한다. 이 gap의 안전판(리뷰어가
  full review를 요청하는 `FULL_REVIEW_REQUESTED` 경로)은 **B-3**이다. B-2는 미변경 문서를 **참조로 포함**해
  gap을 최소화한다(리뷰어가 필요하면 승인 영역도 볼 수 있음). B-2 단독으로도 안전(문맥 무손실). (constraints)
- **R7 하위호환**: full 모드(baseline 없음)는 기존 동작과 바이트 동일. `req-commit.ts`·`machine.schema.json`·
  매니페스트 무변경. delta는 design 재리뷰 프롬프트 조립에만 국한. (constraints)
- **R8 테스트·typecheck**: 단위·typecheck 통과. delta 감지·게이트·프롬프트 표시·persona 증강을 오라클로 고정.

## 4. 비목표 — 이번 범위에서 구현하지 않음

- 🔴 **B-3**: `FULL_REVIEW_REQUESTED` 응답 상태·full review 전환·사람 full-review 승인 경로. **미변경 문서
  실제 생략(토큰 절감)도 B-3** — B-2는 참조로 포함(안전 우선).
- delta의 실제 **리뷰어 행동 개선**(재litigation 감소)은 경험적이라 단위로 증명 불가 — 오라클은 프롬프트
  **구조**(delta 계산 정확·계약 존재·문서 표시)만 고정한다(정직성).
- 로그 측정(⑫⑬⑭)·accept-risk 우회(④). 별도 REQ.
- 기존 REQ 문서·state 소급 수정.

## 5. 인수 기준

1. `computeDesignDelta`가 baseline vs current OID를 **키별** 비교해 changed/unchanged를 정확히 가른다
   (한 문서만 바뀌면 그 문서만 changed).
2. delta 게이트: `hasDesignBaseline` true인 design 재리뷰는 delta 모드, 첫 리뷰·legacy는 full 모드.
3. delta 프롬프트: 변경 문서 `[변경됨]`·미변경 `[승인 baseline]` 표시, 세 본문 모두 포함. persona에
   `DESIGN_DELTA_CONTRACT` 계약이 append된다. `policy_version`이 full과 다르다.
4. 🔴 full 모드(baseline 없음)는 B-1 이전과 **바이트 동일** 프롬프트(무회귀).
5. 🔴 `captureDesignBinding.designHash`·`processResponse` 승인 판정·`design_approved_hash`·baseline 저장이
   **무변경**(delta는 전송 내용만 바꾼다). 전체 테스트 그린.
6. 단위·typecheck 통과.
