# REQ-2026-090 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

| 자리 | 현재 |
|---|---|
| `bin/commitgate.mjs` | `mod.runCli(decision.rest)` — 계약 위반 시 원시 TypeError |
| `scripts/req/req-rebind.ts` | 오류 경계가 `isMain` 블록에 **인라인**. `runCli` export 없음 |
| `scripts/req/req-confirm.ts` | 같음 |
| 나머지 8개 dispatch 대상 | `export function runCli` + `if (isMain) main()` — **표준 관용구** |
| `tests/unit/dispatch.test.ts` | `VERB_MODULES`에 키가 있는지만 본다 |
| `scripts/smoke.mjs` | 전 verb의 **package.json 설치**를 보고, 실제 호출은 `req:doctor` 하나 |

## 핵심 설계 결정

### DEC-1 — 표준 관용구로 **추출**한다(새로 만들지 않는다)

두 모듈의 `isMain` 인라인 경계를 그대로 `runCli`로 꺼내고, `isMain`은 그것을 부른다.

```ts
export function runCli(argv: string[]): void {
  try { main(argv) } catch (err) { console.error(`commitgate: …`) ; process.exitCode = 1 }
}
const isMain = …
if (isMain) runCli(process.argv.slice(2))
```

🔴 **접두어가 바뀐다**: 인라인 경계는 `req:rebind: …`/`req:confirm: …`를 찍었는데 표준 관용구는
`commitgate: …`다. 나머지 8개 모듈과 **같은 문구**로 맞춘다 — dispatch로 실행하면 사용자가 보는 것은
`commitgate <verb>`이므로 그 접두어가 맞고, 두 형식이 공존하면 어느 쪽이 정본인지 알 수 없다.
(R2의 "동작 불변"은 **판정·부작용**을 말한다. 오류 문구 접두어 통일은 이 REQ가 의도한 정합이다.)

### DEC-2 — `main` 폴백을 넣지 않는다

`(mod.runCli ?? mod.main)(...)`은 **한 줄로 증상을 지우지만 결함을 감춘다.** `runCli`는 스택트레이스
노출을 막는 오류 경계이고, `main`으로 폴백하면 그 경계 없이 실행돼 예외가 그대로 새어 나온다.
계약을 지키게 하는 것이 수정이지, 계약 위반을 관용하는 것이 수정이 아니다.

### DEC-3 — 계약을 **테스트로 강제**한다(R3·R4)

`VERB_MODULES`의 **모든 대상을 실제로 import**해 `typeof mod.runCli === 'function'`을 단언한다.

- 🔴 "키가 있는가"(현행 dispatch.test)나 "package.json에 설치됐는가"(smoke)가 **아니다.** 이번 결함은
  그 둘을 모두 통과했다 — 라우팅도 설치도 정상이었고 **모듈만 계약을 어겼다.**
- `VERB_MODULES`가 SSOT이므로 verb를 추가하면 이 검사가 **자동으로** 새 대상을 포함한다.
- 표본이 비면 아무것도 지키지 못하므로 **대상 수 하한**도 함께 단언한다.

### DEC-4 — bin은 계약 위반을 **읽을 수 있는 오류**로 바꾼다(R5)

테스트가 재발을 막지만, 그래도 배포본에서 깨지면 사용자가 보는 것이 원시 TypeError여선 안 된다.

```js
if (typeof mod.runCli !== 'function') {
  console.error(`commitgate: 내부 오류 — '${verb}' 모듈이 runCli를 제공하지 않습니다(dispatch 계약 위반). 이슈로 보고해 주세요.`)
  process.exit(1)
}
```

폴백이 아니다(DEC-2) — **진단 가능한 실패**로 바꿀 뿐이다.

### DEC-5 — Stage A 경로 보존

`if (isMain) runCli(process.argv.slice(2))`로 바꾼다. 기존 `main()`(인자 기본값 = `process.argv.slice(2)`)과
같은 인자이고, 오류 경계도 그대로다(R6).

## Phase별 구현

### phase-1-runcli-contract (DEC-1~5)

- `scripts/req/req-rebind.ts` · `scripts/req/req-confirm.ts` — `runCli` 추출 + `isMain`이 호출 (DEC-1·5)
- `bin/commitgate.mjs` — 계약 위반 시 진단 가능한 오류 (DEC-4)
- `tests/unit/dispatch.test.ts` — 전 대상 import 후 `runCli` 함수 단언 + 대상 수 하한 (DEC-3)

회귀 가드: ①🔴 **모든 `VERB_MODULES` 대상이 `runCli` 함수를 export**(대상 수 하한 포함)
②`req:rebind`·`req:confirm`이 dispatch로 실행돼 **TypeError 없이** 모듈에 도달
③계약 위반 모듈을 주면 bin이 **읽을 수 있는 오류**를 낸다 ④Stage A 직접 실행 경로 무회귀.

Exit: typecheck0 · 전체 스위트 그린 · Codex phase 리뷰 승인.

### phase-2-changelog

- `CHANGELOG.md` — Unreleased + **확인할 파일 표**(phase-1 커밋 SHA·경로).

## 변경 파일

| 파일 | phase |
|---|---|
| `scripts/req/req-rebind.ts` · `scripts/req/req-confirm.ts` · `bin/commitgate.mjs` | 1 |
| `tests/unit/dispatch.test.ts` | 1 |
| `CHANGELOG.md` | 2 |

## 하위호환·안전

- **동작이 넓어지는 방향**이다 — 죽던 두 명령이 산다. 새로 막히는 것은 없다.
- 판정·부작용 무변경. 바뀌는 것은 오류 문구 접두어(`req:rebind:` → `commitgate:`)뿐이며 나머지 8개와 정합한다.
- Stage A·Stage B 양쪽 경로 모두 동작(R6).
- 스키마·config 무변경 → `commitgate sync` 불요.
