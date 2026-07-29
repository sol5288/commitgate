# REQ-2026-090 요구사항

dispatch 대상 전부가 runCli 경계를 갖게 한다 — `req:rebind`·`req:confirm` 크래시 수정

## 배경 — 소비자(yammy) 0.14.0 업그레이드 직후 보고

`npm run req:rebind`가 **즉시 죽는다**(0.13.1·0.14.0 동일 재현).

```
TypeError: mod.runCli is not a function
    at node_modules/commitgate/bin/commitgate.mjs:38:5
```

### 원인

`bin/commitgate.mjs`는 dispatch 대상이 **모두 `runCli(argv)`를 export한다고 가정**하고 무조건 호출한다.

```js
const mod = await import(...)
mod.runCli(decision.rest)      // ← 없으면 TypeError
```

dispatch 대상 10개를 전수 확인한 결과 **2개가 그 계약을 지키지 않는다.**

| verb | `runCli` |
|---|---|
| req:new · req:next · req:review-codex · req:doctor · req:commit · req:reconstruct · req:close · req:review-exception | ✅ |
| **req:rebind** | 🔴 없음 |
| **req:confirm** | 🔴 없음 |

둘 다 오류 경계 자체는 있는데 **`isMain` 블록 안에 인라인**돼 있어 export되지 않는다.

### 왜 지금까지 안 잡혔나 — dogfooding 사각지대

commitgate 자신은 **Stage A**(`"req:rebind": "tsx scripts/req/req-rebind.ts"`)로 모듈을 직접 실행한다.
그 경로는 `isMain` 블록을 타므로 **dispatch를 한 번도 거치지 않는다.** 소비 repo는 **Stage B**
(`"req:rebind": "commitgate req:rebind"`)라 정면으로 맞는다.

`scripts/smoke.mjs`가 dispatch를 검증하긴 하는데, **`req:doctor` 하나만 실제로 호출**한다. 나머지 verb는
"대상 `package.json`에 `commitgate <verb>`로 설치됐는가"만 본다 — **설치 배선은 맞는데 모듈이 실행
가능한지는 보지 않는다.** 가드가 있었지만 틀린 것을 재고 있었다.

### 🔴 이번 릴리스에서 특히 아픈 이유

두 명령 모두 **도구 자신이 처방하는 해법**이다.

| 막힌 상황 | 도구가 안내하는 명령 | 상태 |
|---|---|---|
| 설계 재승인으로 phase 결속이 끊김 → 티켓이 안 닫힘 | `req:rebind` | 🔴 크래시 |
| HIGH 위험 티켓 커밋 차단 | `req:confirm` | 🔴 크래시 |

특히 **0.14.0이 방금 추가한 D26·`staleBindingNotice`가 가리키는 명령이 바로 `req:rebind`다.**
진단은 좋아졌는데 처방이 실행되지 않는다. `req:confirm`은 더 나쁠 수 있다 — HIGH 티켓은
`userConfirmGate`가 커밋을 막고 `req:confirm`을 실행하라고 하는데, 그게 죽으면 **빠져나갈 길이 없다.**

## 요구사항

- **R1** dispatch 대상 **전부**가 `runCli(argv)`를 export한다.
- **R2** 두 명령의 **기존 동작·오류 문구가 바뀌지 않는다** — 인라인 경계를 추출하는 것이지 새로 만드는 것이 아니다.
- **R3** `runCli`를 빠뜨린 dispatch 대상이 생기면 **테스트가 실패**한다(같은 사각지대 재발 방지).
- **R4** R3의 검사는 "설치 배선"이 아니라 **모듈이 실제로 그 계약을 만족하는가**를 본다.
- **R5** 만에 하나 계약이 깨진 채 배포돼도 사용자가 보는 것이 **원시 TypeError + 스택트레이스**가 아니어야 한다.
- **R6** Stage A(직접 실행) 경로가 그대로 동작한다.

## 비목표

- `bin/commitgate.mjs`가 `main`으로 **폴백하지 않는다.** `runCli`는 예외를 한 줄 메시지 + exit 1로 바꾸는
  **오류 경계**다. 폴백하면 그 경계가 조용히 사라져 스택트레이스가 노출된다 — 결함을 감추는 수정이다.
- verb를 추가·제거하지 않는다. dispatch 라우팅 자체는 정상이다(두 verb 모두 라우팅까지는 도달했다).
