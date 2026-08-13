# REQ-2026-139 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

`req.config.json`에 `reviewBudget` 키가 **없다** → 로더가 `DEFAULTS.reviewBudget`
(`autoBudget 5 · hardCap 8 · onSoftLimit "ask"`)를 쓴다. 그래서 이 저장소는 `stopGate: "merge"`인데도
소프트 한도를 넘긴 회차에서 `AWAIT_HUMAN`으로 멈춰 왔다.

## 핵심 설계 결정

### DEC-1 — 코드 변경 없음. **설정 한 블록만** 바꾼다

`onSoftLimit: "auto"` 경로는 REQ-2026-132·135가 이미 구현·검증했다. 이 REQ는 **그 스위치를 켜는 것**이다.
도구 기본값은 건드리지 않는다 — 소비자는 여전히 `ask`다.

### DEC-2 — 기본값과 같은 두 키도 **명시적으로 적는다**

`{"onSoftLimit": "auto"}`만 적어도 로더의 키 단위 병합(REQ-2026-132)이 나머지를 채운다. 그래도 셋을 다 적는다:
이 저장소가 **어떤 예산으로 도는지 설정 파일만 보고** 알 수 있어야 하고, `hardCap`이 명시돼 있으면
나중에 "auto니까 상한도 풀자"는 편집이 눈에 띈다.

### DEC-3 — `hardCap`은 **손대지 않는다**

`auto`가 없애는 것은 소프트 초과 회차의 **사람 예외 승인 하나**다. `hardCap`은 비용 상한이 아니라
**반복 백스톱**이고 `dispatched`(판정 없던 회차 포함)를 센다. 이 값을 늘리면 `auto`가 "무제한 자동"이 되어
사용자 요구의 두 번째 문장("hardCap 이후에는 계속 중단한다")을 어긴다.

### DEC-4 — 검증은 **기존 회귀 테스트**로 한다. 새 테스트를 만들지 않는다

이 REQ는 동작을 만들지 않았으므로 증명할 새 동작도 없다. 새 테스트를 쓰면 **같은 사실을 두 번 주장**하는
중복이 되고, 진짜 오라클(REQ-132·135가 만든 것)이 어디인지 흐려진다.

| 요구 검증 | 이미 있는 오라클 |
|---|---|
| 소프트 초과가 `AWAIT_HUMAN`을 만들지 않는다 | `review-soft-limit-policy.test.ts` — `req:next — auto 는 예산으로 멈추지 않는다` |
| `hardCap` 도달은 여전히 막는다 | 같은 파일 — `hardCap 도달은 두 값 모두 멈춘다` |
| 스키마 통과 | `req-config.test.ts` · 실제 로드(`--kind` 실행 자체가 config를 읽는다) |

🔴 **`stopGate`와 예산은 서로 독립이다**(그래서 "merge + auto" 조합 테스트가 따로 없다).
`resolveNext`는 둘을 **별개 입력**으로 받고, 예산 판정(`budgetAllowsDispatch`)은 `stopGate`를 보지 않는다.
`stopGate`에 의존하는 것은 **업그레이드 안내뿐**이고 그건 별도 테스트가 고정한다
(`phase 를 고른 사용자에게는 재촉하지 않는다`). 조합 테스트를 새로 만들면 **직교인 두 축의 곱**을
테스트로 고정하게 되어, 나중에 축이 늘 때마다 곱이 커진다.

## Phase별 구현

단일 phase.

## 변경 파일

| 파일 | 변경 |
|---|---|
| `req.config.json` | `reviewBudget` 블록 추가 |
| `CHANGELOG.md` | Unreleased — **도구 변경이 아니라 이 저장소의 정책 채택**임을 명시 |

## 하위호환·안전

- 배포물에 영향 없음: `req.config.json`은 **이 저장소의 설정**이고 패키지 payload가 아니다.
- 되돌리기: `reviewBudget` 블록을 지우면 즉시 `ask`로 복귀한다(스냅샷 대상이 아니라 **라이브로 읽힌다**).
  🔴 그래서 **진행 중인 티켓에도 즉시 적용된다** — 이 점을 CHANGELOG에 적는다.
- 검증: `npm run typecheck` · `npm run docs:lint` · 위 표의 기존 테스트 파일 2종.
