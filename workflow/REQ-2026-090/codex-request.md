# REQ-2026-090 리뷰 요청

## 배경

소비 repo(yammy)가 0.14.0 업그레이드 직후 보고했다: `npm run req:rebind`가 즉시 죽는다.

```
TypeError: mod.runCli is not a function   (bin/commitgate.mjs:38)
```

전수 확인 결과 dispatch 대상 10개 중 **2개**(`req:rebind`·`req:confirm`)가 `runCli`를 export하지 않는다.
둘 다 오류 경계는 있는데 `isMain` 블록에 **인라인**돼 있다.

🔴 **왜 안 잡혔나**: commitgate 자신은 **Stage A**(`tsx scripts/...` 직접 실행)라 dispatch를 타지 않는다.
소비 repo만 **Stage B**(`commitgate <verb>`)로 정면으로 맞는다. `smoke.mjs`는 전 verb의 **package.json
설치**를 검사하지만 실제 호출은 `req:doctor` 하나뿐이라, "설치 배선은 맞는데 모듈이 실행 가능한가"는 보지 않았다.

🔴 **왜 심각한가**: 두 명령 모두 **도구 자신이 처방하는 해법**이다. 0.14.0이 방금 추가한 D26·
`staleBindingNotice`가 가리키는 명령이 `req:rebind`이고, HIGH 티켓의 커밋 차단을 푸는 명령이 `req:confirm`이다.
진단은 좋아졌는데 처방이 실행되지 않는다.

## 변경 요약

- 두 모듈의 인라인 경계를 표준 관용구(`export function runCli`)로 **추출**하고 `isMain`이 그것을 부른다.
- `bin/commitgate.mjs`: 계약 위반 시 원시 TypeError 대신 **진단 가능한 오류**. **`main` 폴백은 넣지 않는다.**
- `VERB_MODULES` 전 대상을 실제 import해 `runCli` 계약을 단언하는 테스트.

## 리뷰 포인트

- 🔴 **폴백을 넣지 않은 판단이 옳은가**: `(mod.runCli ?? mod.main)(...)`은 한 줄로 증상을 지우지만 오류 경계가 조용히 사라져 스택트레이스가 새어 나온다. 계약을 지키게 하는 것이 수정이지 위반을 관용하는 것이 수정이 아니라는 전제가 맞는가.
- 🔴 **가드가 이번 결함을 실제로 잡는가**: 새 테스트가 "키 존재"(기존 dispatch.test)나 "package.json 설치"(smoke)가 아니라 **모듈이 계약을 만족하는가**를 보는가. 이번 결함은 그 둘을 모두 통과했다.
- **표본 하한**: 대상 수 하한 단언이 있는가(목록이 비면 검사가 아무것도 지키지 못한다).
- **동작 보존**: 두 명령의 판정·부작용이 그대로인가. 오류 문구 접두어가 `req:rebind:` → `commitgate:`로 바뀌는 것이 나머지 8개와의 정합으로 정당한가(설계 DEC-1에 명시).
- **Stage A 무회귀**: `tsx scripts/req/req-rebind.ts` 직접 실행 경로가 그대로 동작하는가.

## 🔴 진행 상태 — 이 diff는 phase-2만 담는다

| phase | 상태 | 커밋 | 확인할 파일 |
|---|---|---|---|
| phase-1 runcli-contract | ✅ 커밋됨 | `018ff8b1` | `scripts/req/req-rebind.ts`·`req-confirm.ts`의 `export function runCli` · `bin/commitgate.mjs`의 `typeof mod.runCli !== 'function'` 가드 · `tests/unit/dispatch.test.ts`의 전 대상 계약 검사 + subprocess 실행 검사 |
| **phase-2 changelog** | **🔎 지금 리뷰 대상** | (이 diff) | `CHANGELOG.md` |

phase-1은 r01 P1(소스 문자열 검사로는 가드 동작을 못 잡음)을 실제 bin subprocess 실행 테스트로 고쳐 r02 승인됐다.
변이검사로 폴백 도입 시 `MAIN-WAS-CALLED`가 잡히는 것도 확인했다.
