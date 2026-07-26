# REQ-2026-062 요구사항

setup 완료 강제 — 마커·공통 preflight·grandfather

## 배경

REQ-2026-060이 `commitgate setup`을 만들었지만 **강제하지 않는다**(그 REQ의 명시적 비목표).
그래서 지금은 설치 직후 사용자가 리뷰 모델·추론강도를 확인하지 않고, codex 로그인도 하지 않은 채
바로 티켓을 열 수 있다. 그 결과는 첫 리뷰 호출에서야 드러나고, 그 실패는 `dispatched`로 분류되어
**리뷰 예산까지 차감한다**(`adapters.ts:190-192`).

## 요구사항

| # | 내용 |
|---|---|
| **R1** | setup 완료를 **커밋되는 마커**로 기록한다 |
| **R2** | 마커가 없으면 **워크플로 명령을 fail-closed**로 막고, 무엇을 해야 하는지 안내한다 |
| **R3** | 🔴 **기존 설치본을 벽돌로 만들지 않는다**(grandfather) |
| **R4** | `req:doctor`가 상태를 **진단**한다 |

## 🔴 제약 — 이 REQ가 깨뜨리면 안 되는 것

### C1. doctor에 신규 FAIL을 넣지 않는다
`req-doctor.ts:472-495`의 D21/D22 주석이 규칙을 명시한다 — *"req:commit이 이 doctor를 하드 게이트로
spawn하므로 FAIL이면 커밋이 벽돌이 된다"*. D19~D23이 전부 WARN 상한인 이유다.
→ 신규 체크 **D24는 WARN 상한**이다.

### C2. grandfather 판정은 복수 증거로 한다
`workflow/REQ-*` 디렉터리 하나만으로 판정하면 **복사된 과거 산출물이나 빈 디렉터리만으로 신규
프로젝트가 영구 grandfather**가 된다. CommitGate 설치를 식별하는 신호를 조합하고, **판정 근거를 출력**한다.

### C3. root 해소가 `resolveRoot`의 fallback을 타면 안 된다
`config.ts:203-210`의 `resolveRoot`는 `req.config.json`을 못 찾으면 **package root로 fallback**한다.
마커 판정이 그 fallback에 속으면 소비자 repo가 아니라 **CommitGate 패키지 자신**을 본다.
→ git top-level 또는 명시 root를 쓴다.

### C4. 진행 중 티켓을 막지 않는다
업그레이드 직후 진행 중이던 티켓이 있는 사용자가 **커밋도 리뷰도 못 하는** 상태가 되면 안 된다.
그 상태에서는 setup을 실행해도 워킹트리가 dirty해져 상황이 더 나빠진다(`req.config.json`은 추적 파일).

## 🔴 비목표

| 비목표 | 이유 |
|---|---|
| **`stopGate` 도입** | REQ-B2 소관. 이 REQ는 마커와 게이트만 다룬다 |
| **리뷰 호출 auth preflight** | REQ-F 소관. 이 REQ는 "setup을 했는가"만 보고 **로그인 상태를 매번 확인하지 않는다** |
| **읽기 전용 명령 차단** | `req:doctor`·`commitgate check`는 **진단이므로 막지 않는다** — 막으면 문제를 진단할 수단까지 사라진다 |
| **유지보수 verb 차단** | `init`/`migrate`/`sync`/`uninstall`/`quickstart`/`setup`/`check`는 setup 이전에 쓰이거나 setup 자체다 |

## 수용 기준

1. 신규 설치(티켓 0개·마커 없음)에서 `req:new`가 **fail-closed**로 막히고 `commitgate setup` 실행을 **사용자에게 요청하라**고 안내한다.
2. `setup`을 마치면 마커가 `req.config.json`에 기록되고 워크플로 명령이 통과한다.
3. 기존 설치본(유효한 티켓 + 설치 신호 복수)에서는 마커가 없어도 **막히지 않는다**(grandfather).
4. `workflow/REQ-xxx/` 빈 디렉터리만 만들어 둔 신규 프로젝트는 grandfather **되지 않는다**.
5. `req:doctor`의 D24가 **WARN**을 내고 FAIL을 내지 않는다.
6. `req:doctor`·`commitgate check`는 마커가 없어도 **정상 동작**한다.
7. `npm test` green · `tsc --noEmit` 0.
