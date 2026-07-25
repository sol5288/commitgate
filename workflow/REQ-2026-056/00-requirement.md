# REQ-2026-056 요구사항

lockfile 리뷰 프롬프트 요약 + frozen-lockfile doctor 진단 (yammy 운영감사 후속 E)

## 문제

1. **리뷰 프롬프트의 lockfile 전문**: `req:review-codex`는 `git diff --cached` 전문을 프롬프트에 담는다(권위
   아티팩트 = staged diff). lockfile(`package-lock.json`·`pnpm-lock.yaml` 등)이 staged면 **수천 줄의
   기계생성 diff**가 프롬프트에 통째로 들어가 토큰을 낭비하고 사람/리뷰어 신호를 묻는다. lockfile 줄 하나하나는
   사람이 검토하는 대상이 아니다(무엇이 바뀌었나는 `package.json`으로 본다).
2. **frozen-lockfile 위생 미진단**: lockfile이 없거나 커밋되지 않으면 `npm ci`·`pnpm install --frozen-lockfile`로
   재현 가능한 설치가 불가한데, 이를 알려 주는 진단이 없다.

## 목표

1. **lockfile 프롬프트 요약**(opt-in 전문): staged diff의 lockfile 구획을 **요약**(경로·변경 통계 ±N/±M·생략분
   sha256)으로 대체해 프롬프트에 넣는다. 기본 요약, config로 전문 opt-in. 🔴 **바인딩(reviewTree)은 불변** —
   요약은 **프롬프트(리뷰어 view)만** 바꾸고, 승인은 여전히 전체 index tree를 결속한다.
2. **frozen-lockfile doctor 진단**: 감지된 PM의 lockfile이 없거나 untracked면 **WARN**(강제 게이트 아님 —
   사용자 확정). 재현 가능한 설치를 위해 커밋하라고 안내.

## 비목표

- 예산·리뷰 판정·승인 바인딩 변경 없음(요약은 프롬프트만). lockfile 내용 자체를 바꾸지 않는다.
- lockfile ↔ package.json **동기 여부**를 PM 실행으로 검사하지 않는다(느림·환경의존) — 존재·tracked 위생만.
- doctor를 FAIL로 만들지 않는다(D19~D22와 동일: `req:commit`이 doctor를 하드 게이트로 spawn하므로 WARN 상한).

## 완료 기준

- staged lockfile diff가 요약으로 프롬프트에 들어간다(전문 config 시 전문). 바인딩·측정 로그 정합 불변.
- lockfile 부재/untracked → doctor D23 WARN(FAIL 아님). 단위 테스트 그린·typecheck 0·smoke 그린.
