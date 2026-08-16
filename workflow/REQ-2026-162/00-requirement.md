# REQ-2026-162 요구사항

## 무엇

`scripts/req/**` 소스 주석에 들어간 패키지매니저 실행 리터럴 2건을 제거한다.

## 왜

REQ-2026-161 이 phase-1·phase-4 에서 실측 사례를 **인용**하며 주석에 `pnpm req:delegate` 를 적었다.
`tests/unit/pm-derived-strings.test.ts` 는 `scripts/req/**` **소스 전체**에서
`/npm run req|pnpm req:|yarn req:/` 를 금지한다(REQ-2026-011 D2) — 문구가 pm 별로 파생되지 않으면
npm 프로젝트에 pnpm 명령이 새어 나가기 때문이다. 주석도 예외가 아니다.

- `scripts/req/lib/command-surface.ts` — 헤더 주석의 실측 인용
- `scripts/req/req-doctor.ts` — D33 주석의 실측 인용

REQ-2026-161 의 **통합 직전 전체 스위트**가 이것을 잡았고(2 fail / 3858), 그 티켓은 이미
`dev-complete` 라 덧phase 가 차단된다(REQ-2026-151). 저장소 규범대로 **단일 phase micro-REQ** 로 고친다.

🔴 현재 `main` 은 이 2건으로 red 다. 이 티켓이 그것을 되돌린다.

## 제약

- **주석만 고친다.** 동작·시그니처·출력 문자열 변경 0.
- 실측 사실 자체는 지우지 않는다 — pm 중립 표현으로 남긴다(왜 이 검사가 존재하는지가 근거다).

## 완료 기준

`tests/unit/pm-derived-strings.test.ts` 그린 · `scripts/req/**` 에 pm 리터럴 0건 · typecheck 0 ·
통합 직전 전체 스위트 그린.

## 비목표

REQ-2026-161 이 남긴 **도구 결함**(orphan review series 가 auto 통합을 차단 · dev repo `req:next`
렌더링 사각지대)은 여기서 다루지 않는다 — 별도 REQ 다. 이 티켓은 main 을 green 으로 되돌리는 것만 한다.
