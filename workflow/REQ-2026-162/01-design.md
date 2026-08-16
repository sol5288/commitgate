# REQ-2026-162 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

`tests/unit/pm-derived-strings.test.ts` 의 소스 스캔:

```
expected '…' not to match /npm run req|pnpm req:|yarn req:/
  scripts/req/lib/command-surface.ts
  scripts/req/req-doctor.ts
```

두 곳 모두 **주석**이고, 실측 재현 사례를 그대로 인용하다 리터럴이 들어갔다.

## 핵심 설계 결정

### DEC-1 — 사실은 남기고 **리터럴만** 뺀다

가드의 취지는 "pm 별로 파생하라"이고 주석은 파생 대상이 아니다. 그러나 가드는 **소스 전체**를 스캔한다 —
주석 예외를 만들면 실제 사용자 대면 문구가 주석 옆에 붙는 순간 검사가 새어 나간다. 그래서 **가드를 완화하지
않고** 주석 쪽을 pm 중립으로 적는다.

- `command-surface.ts`: 실측 인용을 *"패키지매니저가 `req:delegate` 스크립트를 찾지 못해 `not found` 로 죽었다"* 로.
- `req-doctor.ts`: *"`req:next` 가 `req:delegate` 실행을 안내했는데"* 로.

🔴 **가드를 고치지 않는다.** 이 검사가 잡은 것은 오탐이 아니라 **내가 넣은 리터럴**이다.

## Phase별 구현

| phase | 내용 |
|---|---|
| 1 | 주석 2곳 pm 중립화 + 스위트 확인 |

단일 phase 다 — 저장소 규범(완결 REQ 사후정정 = 단일 phase micro-REQ, REQ-2026-046 선례).

## 변경 파일

- `scripts/req/lib/command-surface.ts`(주석) · `scripts/req/req-doctor.ts`(주석)

## 하위호환·안전

- 동작 변경 0. 주석만 바뀌므로 export·출력·게이트 판정에 영향이 없다.
- 기존 가드(`pm-derived-strings`)가 그대로 회귀 방지를 계속한다 — 새 가드를 만들지 않는다.
