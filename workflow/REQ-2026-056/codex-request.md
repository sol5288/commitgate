# REQ-2026-056 리뷰 요청 — lockfile 프롬프트 요약 + frozen-lockfile doctor

## 배경

리뷰 프롬프트가 `git diff --cached` 전문을 담아 lockfile(수천 줄 기계생성)이 프롬프트를 오염시킨다. 또
lockfile 위생(존재·tracked)을 알려 주는 진단이 없다. yammy 운영감사 후속 E.

## 변경 요약

- **DEC-E1/E2** lockfile diff 요약(`lib/lockfile-diff.ts` 순수) — staged diff의 lockfile 구획 hunk를 요약
  (경로·헤더 보존·±N/M·sha256(생략분))으로 대체. config `lockfilePromptFull`(default false)로 전문 opt-in.
  🔴 **프롬프트만** 바꾼다 — 바인딩(reviewTree·approved_diff_hash)은 전체 index라 불변. 측정 로그·ledger
  prompt_sha256은 실제 전송(=요약) 프롬프트 기준이라 자동 정합.
- **DEC-E3** doctor D23 — PM 기대 lockfile 부재/untracked면 **WARN**(FAIL 아님). PM 실행 없이 존재·tracked 위생만.

## 리뷰 포인트

1. **바인딩 불변(DEC-E2)**: 요약이 프롬프트만 바꾸고 reviewTree·approved_diff_hash·사후 tamper 검증
   (afterTree===reviewTree)에 무영향인가? 승인이 여전히 **전체 lockfile을 결속**하는가?
2. **측정 정합(DEC-E2)**: assembledPromptSha256·promptBytes·ledger prompt_sha256이 **전송된(요약) 프롬프트**
   기준이라 자동 정합하는가(불일치 창 없음)?
3. **요약 정확·경계(DEC-E1)**: 구획 분할이 rename/삭제/binary·혼합 diff(package.json+lock)를 올바로 다루는가?
   basename 일치만(경로 부분문자열 오탐 없음)? lockfile 없는 diff는 완전 no-op(기존 near-e2e byte-identical 무회귀)?
4. **doctor WARN 상한(DEC-E3)**: D23이 절대 FAIL이 아닌가(req:commit 하드 게이트 벽돌화 방지)? 입력 필드가
   optional additive라 기존 doctor 테스트 base가 안 깨지는가?
5. **비목표 경계**: lockfile↔package.json 동기 검사(PM 실행)를 안 하고 존재·tracked만 보는 게 정당한가?
