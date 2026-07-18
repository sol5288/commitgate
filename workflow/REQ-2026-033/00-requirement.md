# REQ-2026-033 요구사항 — design delta 감지·프롬프트 표시 (개선 REQ-B-2a)

## 1. 배경

**G-06b(원래 P0)**: 승인 후 작은 설계 편집이 00/01/02 **전체 재리뷰**를 부르고, 리뷰어가 승인 영역을
재litigate해 승인을 되돌린다(REQ-020 14라운드). 리뷰 수렴의 세 번째 축 = delta review.

**토대(B-1, [[req-2026-031-delta-review-b1]])**: design 승인 시 문서별 blob OID를 `state.design_baseline`에
보존. `hasDesignBaseline(state)`로 legacy 판별. **B-1은 저장만. B-2a가 처음 읽어** delta를 계산·표시한다.

**재분할 유래(REQ-2026-032 종료)**: B-2(감지+표시+persona 계약)를 한 REQ로 묶었더니 design 리뷰가
6라운드 비수렴했다 — **persona 증강**이 policy_version 로그 배선·null persona 정책·kind 격리·사용자 문서
계약을 near-e2e 차원으로 폭발시켰다(감지·표시 자체는 깔끔). → **B-2a(감지+표시)** / B-2b(persona 계약+배선+
문서)로 분리(사용자 결정, [[req-2026-031-delta-review-b1]] 계열). 이 REQ는 REQ-032의 successor.

## 2. 목표(What)

design **재리뷰**에서 `state.design_baseline`과 현재 인덱스의 문서별 blob OID를 비교해 **변경 문서 집합**을
계산하고, 리뷰 프롬프트의 설계 문서 블록에 **문서별 변경 표시**를 붙인다:
각 문서를 **[변경됨 — 심사 대상]** / **[승인 baseline — 변경 없음, 참조]**으로 태그. 세 문서 본문은 모두 포함.

**🔴 이 REQ는 persona·리뷰 계약·policy_version을 건드리지 않는다.** 문서 헤더에 **정보성 태그**만 붙인다.
delta 계약 persona(재litigate 금지 지시)·그에 따른 policy_version 배선·null persona 정책·사용자 문서 갱신은
**전부 B-2b**다. 태그만으로도 리뷰어가 "무엇이 바뀌었나"를 알 수 있어 additive·안전하다. **미변경 문서 실제
생략·`FULL_REVIEW_REQUESTED` escalation은 B-3.**

## 3. 요구(정규화)

### delta 감지

- **R1 문서별 OID diff(순수)**: `computeDesignDelta(baseline, current): { changed, unchanged }`. `baseline`
  (`state.design_baseline`)과 `current`(현재 인덱스 `captureDesignDocBlobs`)의 세 키(requirement/design/plan)
  OID를 **키별** 비교 — 다르면 changed, 같으면 unchanged(위치·순서 아님). (Done #1)
- **R2 delta 게이트**: **design kind이고** `hasDesignBaseline(state)` true면 delta 모드, 아니면 full 모드(현행).
  🔴 **phase 리뷰는 절대 delta가 아니다**(kind 격리) — delta 계산·표시는 design 프롬프트 조립에만 국한.
  변경 문서가 0개(baseline==current)여도 baseline이 있으면 delta 모드(모두 baseline 태그). (Done #2)

### delta 표시

- **R3 변경 표시 authority 블록**: delta 모드에서 설계 문서 블록을 문서별로 태그한다 — 변경 문서
  `[변경됨 — 심사 대상]`, 미변경 `[승인 baseline — 변경 없음, 참조]`. **세 문서 본문 모두 포함**(미변경도
  full — 문맥 보존). 태그 문자열은 코드 상수. full 모드 블록은 **바이트 무변경**. (Done #3)

### 범위·안전

- **R4 🔴 persona·계약·policy_version 무변경**: base persona 로드·`reviewPolicyVersion(persona)` 로그 입력을
  **전혀 안 바꾼다**. delta 모드에서도 persona는 base 그대로(계약 append 없음). delta는 **설계 문서 블록의
  태그**만 바꾼다. → policy_version은 delta/full에서 동일(리뷰 계약이 안 바뀌므로 정당). null persona 정책·
  사용자 문서는 이 REQ 범위 밖(B-2b). (constraints)
- **R5 🔴 바인딩·승인 의미 무변경**: `captureDesignBinding.designHash`는 여전히 full 현재 설계를 바인딩.
  `processResponse` 승인 판정·`design_approved_hash`·B-1 baseline 저장 무변경. delta는 전송 내용(문서 태그)만. (constraints)
- **R6 하위호환**: full 모드(baseline 없음)·phase 리뷰는 B-1 이전과 **바이트 동일** 프롬프트. `req-commit.ts`·
  `machine.schema.json`·매니페스트 무변경. (constraints)
- **R7 테스트·typecheck**: 단위·typecheck 통과. delta 감지·게이트·표시·kind 격리·full 무회귀를 오라클로 고정.

## 4. 비목표 — 이번 범위에서 구현하지 않음

- 🔴 **B-2b**: design-delta persona 계약(`DESIGN_DELTA_CONTRACT`)·persona 증강·policy_version delta 배선·
  null persona 정책·사용자 문서(README/SSOT) 갱신. **전부 범위 밖.** B-2a는 태그만.
- 🔴 **B-3**: `FULL_REVIEW_REQUESTED`·미변경 문서 실제 생략·사람 full-review 승인.
- delta의 실제 리뷰어 행동 개선은 경험적 — 오라클은 프롬프트 **구조**만 고정.
- 로그 측정(⑫⑬⑭)·accept-risk(④). 별도 REQ.

## 5. 인수 기준

1. `computeDesignDelta`가 baseline vs current OID를 **키별** 비교해 changed/unchanged를 정확히 가른다
   (한 문서만 바뀌면 그 키만 changed; 전부 동일→changed 빈 배열; 전부 상이→3키 changed).
2. delta 게이트: **design kind** + `hasDesignBaseline` true면 delta, 첫 리뷰·legacy·**phase 리뷰**는 full/무표시.
3. delta 프롬프트: 변경 문서 `[변경됨]`·미변경 `[승인 baseline]` 태그, 세 본문 모두 포함. **부분 변경 시
   문서별 태그가 정확**(변경 안 된 문서에 변경 태그 안 붙음).
4. 🔴 full 모드(baseline 없음)·phase 리뷰가 B-1 이전과 **바이트 동일** 프롬프트(무회귀).
5. 🔴 `persona`·`reviewPolicyVersion(persona)` 로그 입력·`captureDesignBinding.designHash`·`processResponse`
   승인 판정·baseline 저장이 **무변경**. 전체 테스트 그린.
6. 단위·typecheck 통과.
