# REQ-2026-034 요구사항 — design-delta persona 계약 (개선 REQ-B-2b)

## 1. 배경

**G-06b(원래 P0)**: 승인 후 작은 편집이 전체 재리뷰를 부르고 리뷰어가 승인 영역을 재litigate해 승인을
되돌린다(REQ-020 14R). delta review의 **행동 계약** 절반 — B-2a는 변경 문서를 **표시**만 했다(태그).
B-2b는 리뷰어에게 "**표시된 변경분·직접 영향만 심사, 승인 영역 재심사 금지**"를 **persona 계약**으로 건다.

**토대**: [[req-2026-031-delta-review-b1]] B-1(baseline 저장)·B-2a(REQ-033: `computeDesignDelta` + 문서 태그
`DELTA_CHANGED_TAG`/`DELTA_BASELINE_TAG` + `designDelta` 게이트). B-2a는 **persona를 안 건드렸다** — 태그만.
B-2b가 그 위에 계약 persona를 얹는다.

**🔴 이 REQ는 REQ-032(B-2 통합본) 비수렴의 persona 절반이다.** 032가 6R 만에 발견한 결함을 **처음부터 전부**
반영한다: null persona 정책(r01)·policy_version 단일 배선(r02)·전송 프롬프트+로그 동시 검증(r03)·null live
로그(r06-1)·kind 격리(r06-2)·사용자 문서 계약(r06-3).

## 2. 목표(What)

design **delta 재리뷰**(B-2a의 `designDelta`가 설정될 때)에서만 리뷰어 persona에 **delta 계약 블록**
(`DESIGN_DELTA_CONTRACT`)을 얹는다. 그 **effective persona**를 프롬프트와 review-call 로그 `policy_version`
**양쪽**에 흘려, delta 리뷰가 계약을 실제로 전송하고 로그에서도 full과 구분되게 한다.

**범위 밖(B-3)**: 미변경 문서 실제 생략(토큰 절감)·`FULL_REVIEW_REQUESTED`·full review 전환·사람 승인.

## 3. 요구(정규화)

### 계약 상수·적용

- **R1 `DESIGN_DELTA_CONTRACT` 상수**: delta 계약 블록. 내용 = "① [변경됨] 표시 문서·직접 영향만 심사 /
  ② [승인 baseline]은 승인됨·재심사·재litigate 금지, 참조로만 / ③ 변경이 승인 영역 재고를 강제하면 finding으로".
  🔴 **태그 문자열은 `DELTA_CHANGED_TAG`·`DELTA_BASELINE_TAG` 상수를 참조**(하드코딩 금지 — 태그 바뀌면 계약도
  자동 반영, drift 방지). (Done #1)
- **R2 effective persona(순수 함수)**: `applyDeltaPersona(base, deltaActive): string|null`. `deltaActive`(=`designDelta`
  설정됨)면 base 뒤에 계약을 붙인다 — **base 있으면 `base + '\n' + DESIGN_DELTA_CONTRACT`**, **base null이면
  `DESIGN_DELTA_CONTRACT` 단독**. `deltaActive` 아니면 base 그대로(null이면 null). (Done #2)
- **R3 🔴 단일 effective persona 배선(032 r02·r03)**: `main()`은 effective persona **하나**를 `assembleReviewPrompt`
  (전송 프롬프트)와 `reviewPolicyVersion(...)`(review-call 로그 `policy_version`) **양쪽에** 쓴다. 프롬프트엔
  계약을 넣고 로그엔 base를 쓰는 발산이 없어야 한다 — 그러면 base 있는 live delta가 full과 같은 policy_version을
  기록한다. (Done #3)

### null persona 정책·kind 격리

- **R4 🔴 null base persona 정책(032 r01·r06-1)**: `reviewPersonaPath: null`(persona 명시적 비활성 — 지원·
  문서화된 설정)이면 base가 null이다. **delta 모드**면 `DESIGN_DELTA_CONTRACT`를 **단독 persona**로 전송하고
  로그 `policy_version = hash(contract)`(≠`'none'`). **full 모드(baseline 없음)**면 null 그대로 —
  persona 없음, `policy_version='none'`(기존 동작 무변경). (Done #2·#3)
- **R5 🔴 kind 격리(032 r06-2)**: 계약은 `designDelta`가 설정될 때만 붙는다. `designDelta`는 B-2a에서
  **design + baseline**일 때만 설정된다(phase는 구조적 제외). 따라서 phase 리뷰·full design 리뷰는 계약이
  **안 붙고** persona·policy_version이 base 그대로. (constraints)

### 사용자 문서·범위

- **R6 🔴 사용자 문서 계약 갱신(032 r06-3)**: `reviewPersonaPath: null`의 사용자 계약이 바뀐다 — full 모드는
  여전히 persona 비활성이지만 **delta design 리뷰는 내장 계약을 주입**한다. README.md·README.en.md·SSOT
  (`02-repository-and-runtime.md`)의 `reviewPersonaPath` 설명을 이 사실로 갱신한다. (Done #4)
- **R7 무회귀**: B-2a의 태그 렌더·`computeDesignDelta`·게이트는 **무변경**. `assembleReviewPrompt`도 무변경
  (persona를 입력으로 받을 뿐 — B-2b는 main이 넘기는 persona만 바꾼다). 바인딩·`processResponse` 승인 판정
  무변경. full/phase 프롬프트·policy_version은 B-2b 이전과 **바이트 동일**. (constraints)
- **R8 테스트·typecheck**: 단위·typecheck 통과. 계약 내용·effective persona·단일 배선·null 정책·kind 격리·
  무회귀를 오라클로 고정.

## 4. 비목표 — 이번 범위에서 구현하지 않음

- 🔴 **B-3**: `FULL_REVIEW_REQUESTED`·미변경 문서 실제 생략(토큰 절감)·full review 전환·사람 승인.
- delta의 실제 리뷰어 행동 개선(재litigate 감소)은 경험적 — 오라클은 프롬프트/로그 **구조**만 고정.
- B-2a의 태그·감지 로직 변경. 로그 측정(⑫⑬⑭)·accept-risk(④).

## 5. 인수 기준

1. `DESIGN_DELTA_CONTRACT`가 재심사 금지·직접 영향·finding 밝히기를 담고, 태그 문구는 `DELTA_*_TAG` 상수 참조.
2. `applyDeltaPersona`: deltaActive+base→`base+계약`, deltaActive+null→`계약 단독`, !deltaActive→base(null이면 null).
3. 🔴 base 있는 live delta design: 전송 프롬프트 persona에 base+계약이 있고, 로그 `policy_version=hash(base+계약)`
   (≠`hash(base)`). 프롬프트·로그 동시.
4. 🔴 null persona live delta design: 전송 프롬프트 persona=계약 단독, 로그 `policy_version=hash(계약)`(≠`'none'`).
5. 🔴 full design(baseline 없음)·phase 리뷰: 계약 안 붙음, persona·policy_version이 base 그대로(null이면 `'none'`).
   프롬프트가 B-2b 이전과 바이트 동일.
6. README·README.en·SSOT의 `reviewPersonaPath` null 설명이 delta 계약 주입을 반영.
7. 단위·typecheck 통과.
