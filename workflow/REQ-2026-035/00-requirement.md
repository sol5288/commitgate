# REQ-2026-035 요구사항 — FULL_REVIEW_REQUESTED escalation (개선 REQ-B-3a)

## 1. 배경

delta review([[req-2026-031-delta-review-b1]]) 파이프라인은 B-1(baseline 저장)·B-2a(감지·표시)·B-2b(계약)로
기능 완결됐다. **안전판**이 남았다: delta 재리뷰에서 리뷰어가 "이 변경은 승인 baseline 이후 delta로 판단하기엔
너무 근본적이다 — 전체 설계를 다시 봐야겠다"고 판단할 수 있어야 한다. 그 신호가 **FULL_REVIEW_REQUESTED**다.

**분할(사용자 결정, 2분할)**: B-3 = **B-3a(escalation 안전판 — 전체 문맥 유지)** + B-3b(미변경 문서 실제
생략, 토큰 절감). B-3a가 escalation **메커니즘**을 먼저 안전하게 세운다(생략 없음 → 문맥 무손실). B-3b가
생략을 얹을 때 이 안전판이 그 위험을 상쇄한다.

**🔴 이 REQ는 최적화가 아니라 안전판이다.** delta 파이프라인은 이미 동작한다(B-2b). B-3a는 리뷰어가 delta로
판단 불가할 때 **full review로 되돌리는** 길을 연다.

## 2. 목표(What)

codex 응답에 **`full_review_requested`(yes/no)** 신호를 추가하고, design delta 재리뷰에서 리뷰어가
`full_review_requested=yes`로 응답하면 **다음 리뷰가 full 모드로 되돌아가게** 한다:
`state.design_baseline`을 **비워** 기존 `hasDesignBaseline` 게이트(B-2a)가 자연히 full 모드를 고르게 한다.
다음 design 승인 시 B-1이 baseline을 **재설정**해 delta가 재개된다.

**🔴 전체 문맥 유지 — 미변경 문서 생략 없음.** B-3a는 escalation만. 미변경 문서 실제 생략(토큰 절감)은 B-3b.

## 3. 요구(정규화)

### 신호

- **R1 `full_review_requested` 응답 필드**: `machine.schema.json` properties에 optional `full_review_requested`
  (enum `["yes","no"]`) 추가. 🔴 **검증 SSOT는 optional**(구 archive는 이 필드가 없어도 통과 — 하위호환,
  observations 선례). `deriveStrictOutputSchema`가 root required=전체 properties로 파생하므로 **codex는 매
  응답에 emit**(대부분 `"no"`). 스키마 버전(1.1) 무변경(optional 추가는 additive). (Done #1)
- **R2 교차필드 검증**: `validateVerdict`에 규칙 추가 — `full_review_requested="yes"`면 **`commit_approved="no"`**
  여야 한다(full review를 요청하면서 동시에 승인은 모순). 그리고 **`review_kind="design"`**이어야 한다(delta는
  design 전용 — phase엔 baseline·delta가 없다). 위반 시 fail-closed(응답 무효). (Done #1)
- **R2b 🔴 escalation 지침(계약)**: 신호만으로는 리뷰어가 **언제 yes를 쓸지** 모른다(design-r01 P1). B-2b의
  `DESIGN_DELTA_CONTRACT`(delta 프롬프트 persona)에 한 줄을 **추가**한다: "변경이 너무 근본적이어서 delta로
  판단 불가하면 `full_review_requested: "yes"`(그때 `commit_approved: "no"`)로 전체 재리뷰를 요청하라". 이로써
  정상 delta 경로에 escalation 사용법이 실린다. `applyDeltaPersona` **로직**은 무변경(계약 텍스트만 확장). (Done #1)

### 전환

- **R3 🔴 full review 전환 — baseline 비움**: `processResponse`의 design 분기에서 `full_review_requested="yes"`면
  `nextState.design_baseline`을 **제거**한다. 그러면 다음 design 리뷰가 `hasDesignBaseline=false`로 full 모드가
  된다(B-2a 게이트 재사용 — `main()` 무변경). `full_review_requested="yes"`는 R2로 미승인이므로 baseline
  재설정 분기(B-1)를 타지 않는다. (Done #2)
- **R4 baseline 재개**: full review가 다음에 **승인**되면 B-1이 현재 문서로 baseline을 재설정한다(무변경 재사용).
  이후 리뷰는 다시 delta가 된다. 즉 escalation은 **1회 full 재리뷰로 리셋**하는 의미다. (constraints)

### 범위·안전

- **R5 🔴 사람 승인 게이트 불필요**: full review 전환은 **더 많은 문맥을 보내는 것**뿐이라 안전하다(리뷰어가
  요청했고, 승인·커밋의 기존 통제점은 그대로다). 새 human control point를 추가하지 않는다 — baseline 비움은
  자동. (constraints)
- **R6 무회귀**: `full_review_requested` 부재(구 응답)·`"no"`면 동작이 B-3a 이전과 **동일**하다. delta/full
  게이트·B-2a 태그·B-2b 계약·바인딩·`req-commit.ts` 무변경. `main()` 무변경(baseline 비움이 게이트를 통해
  full을 유도). (constraints)
- **R7 테스트·typecheck**: 단위·typecheck 통과. 신호 검증·전환(baseline 비움)·무회귀를 오라클로 고정.

## 4. 비목표 — 이번 범위에서 구현하지 않음

- 🔴 **B-3b**: 미변경 문서 **실제 생략**(delta 프롬프트에서 미변경 문서 본문 제거, 토큰 절감). B-3a는 문맥
  무손실(생략 없음).
- 로그 측정(`review_mode`/`full_review` 로그 확장, 배분표 ⑫⑬⑭). 별도 REQ.
- accept-risk 우회(④). 기존 REQ 소급 수정.

## 5. 인수 기준

1. `machine.schema.json`에 optional `full_review_requested`(yes/no). 이 필드 없는 구 archive가 검증 통과
   (하위호환). 이 필드 있는 응답도 통과. 스키마 버전 1.1 유지.
1b. 🔴 `DESIGN_DELTA_CONTRACT`(delta 프롬프트)에 escalation 지침(근본 변경 시 `full_review_requested=yes` 요청)이
   포함된다. `applyDeltaPersona` 로직은 무변경.
2. `validateVerdict`: `full_review_requested="yes"` + `commit_approved="yes"` → 무효(모순). `full_review_requested="yes"`
   + `review_kind="phase"` → 무효. `"no"`/부재는 제약 없음.
3. 🔴 design 리뷰 `full_review_requested="yes"` → `processResponse`가 `state.design_baseline`을 제거 →
   이어지는 design 리뷰가 full 모드(delta 태그·계약 없음).
4. 🔴 다음 full review가 승인되면 baseline이 재설정돼 delta가 재개된다.
5. 🔴 `full_review_requested` 부재/`"no"`면 B-3a 이전과 동일(delta/full 게이트·태그·계약·바인딩 무변경).
   전체 테스트 그린.
6. 단위·typecheck 통과.
