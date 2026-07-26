# REQ-2026-062 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

| 축 | 현재 | 근거 |
|---|---|---|
| 설정 스키마 | `CONFIG_SCHEMA`(코드) + `workflow/req.config.schema.json`(파일) **2벌**, 드리프트 가드 테스트 있음 | `config.ts:145`, `tests/unit/req-config.test.ts:298` |
| `setup` | 모델·effort만 쓴다. **마커를 쓰지 않는다**(REQ-060 비목표) | `bin/setup.ts` |
| root 해소 | `resolveRoot`가 못 찾으면 **package root fallback** | `config.ts:203-210` |
| 워크플로 verb | 공통 preflight **없음** — 각자 `loadConfig`만 한다 | `scripts/req/*.ts` |
| doctor | D1~D23, **D19~D23은 WARN 상한**(하드 게이트라서) | `req-doctor.ts:472-495` |
| verb 표면 SSOT | `VERB_MODULES` | `bin/dispatch.mjs` |

## 핵심 설계 결정

### DEC-1 — 마커는 `req.config.json` 안에 둔다
별도 마커 파일을 만들지 않는다. REQ-2026-060이 setup의 쓰기 표면을 **이 파일 하나**로 고정하고
temp+rename으로 원자성을 **구조로** 보장했다(그 REQ의 DEC-5). 마커를 다른 파일로 빼면 두 파일 사이에
원자성 계약이 새로 필요해진다.

```jsonc
"setup": { "completedVersion": "0.9.10", "completedAt": "2026-07-26T…Z" }
```

- `completedVersion` = setup을 실행한 commitgate 버전(진단·마이그레이션 근거).
- `completedAt` = **실제 시계**에서 읽는다. 🔴 지어내면 REQ-2026-019 폐기 사유(타임스탬프 날조)의 재발이다.
- 🔴 **스키마 2벌을 동시에 확장**한다(`CONFIG_SCHEMA` + `workflow/req.config.schema.json`).
  드리프트 가드 테스트가 어차피 잡지만, 한쪽만 고치면 소비자 repo의 vendored 스키마가 신규 키를
  `additionalProperties:false`로 **거부**해 모든 명령이 죽는다.

### DEC-2 — 마커는 **팀 공유 사실**이고 로그인은 아니다
`req.config.json`은 커밋된다. 따라서 마커의 의미는 **"이 프로젝트의 설정이 끝났다"**이지
"내가 로그인돼 있다"가 아니다. 로그인은 개발자별이라 마커가 팀원의 인증을 보증하지 않는다.
→ 이 게이트는 **로그인을 매번 확인하지 않는다**(REQ-F 소관). 문서에 이 경계를 적는다.

### DEC-3 — 게이트 root는 **git top-level 또는 명시 root**
`resolveRoot`의 package-root fallback을 타면 소비자 repo가 아니라 CommitGate 패키지 자신을 본다(C3).
→ 순서: ① 명시 `--root` → ② `git rev-parse --show-toplevel` → ③ cwd.
**`req.config.json` 존재 여부로 root를 정하지 않는다** — 마커가 없는 상태를 판정하는 것이 이 게이트의 일인데
그 파일의 존재로 root를 찾으면 순환이다.

### DEC-4 — 판정은 순수 함수 `setupGateVerdict(facts)`
```ts
type GateVerdict =
  | { kind: 'pass'; reason: 'marker' | 'grandfathered'; evidence: string[] }
  | { kind: 'block'; message: string }
```
IO(파일 존재·파싱)는 호출부가 수집한다. `req:doctor`의 `checks(inp)`와 같은 관례.

### DEC-5 — grandfather는 **복수 증거**로 판정하고 근거를 출력한다 (C2)
```
grandfathered ⇔ 유효 티켓 ≥ 1  AND  설치 신호 ≥ 2
```
- **유효 티켓** = `<ticketRoot>/REQ-*/state.json`이 파싱되고 `state.id`가 **디렉터리명과 일치**한다.
  빈 디렉터리·복사된 껍데기는 세지 않는다(수용기준 4).
- **설치 신호**(각 1점): `package.json`에 `req:*` 스크립트 존재 / `req.config.json` 존재 /
  `workflow/machine.schema.json` 존재 / `AGENTS.md`에 계약 마커(`<!-- commitgate:contract -->`) 존재.
- 🔴 **판정 근거(`evidence[]`)를 pass/blocked 양쪽 메시지에 출력**한다 — 근거가 안 보이면 오판을 아무도 못 잡는다.

### DEC-6 — 차단 대상은 **변경을 만드는 워크플로 verb**뿐
| 구분 | verb | 게이트 |
|---|---|---|
| 변경 | `req:new` · `req:review-codex` · `req:commit` · `req:close` · `req:reconstruct` · `req:review-exception` | **차단** |
| 다음 행동 계산 | `req:next` | **차단**(읽기 전용이지만 "다음에 뭘 할지"의 출발점이라, 여기서 막아야 에이전트가 헛돌지 않는다) |
| 진단 | `req:doctor` · `commitgate check` | **통과**(막으면 문제를 진단할 수단이 사라진다 — 수용기준 6) |
| 유지보수·설정 | `init` · `migrate` · `sync` · `uninstall` · `quickstart` · `setup` | **통과**(setup 이전에 쓰이거나 setup 자체) |

### DEC-7 — 차단 메시지는 "실행하라"가 아니라 **"요청하라"**
`setup`은 대화형 전용 = 사람 전용 명령이다(REQ-060 DEC-12, `AGENTS.md`). 에이전트가 이 메시지를 읽고
setup을 실행하면 비-TTY로 즉시 실패한다. 따라서 메시지는 **사용자에게 실행을 요청하라**고 지시한다.

### DEC-8 — doctor **D24는 WARN 상한** (C1)
마커가 없으면 WARN + 근거. **FAIL을 내지 않는다** — `req:commit`이 doctor를 하드 게이트로 spawn하므로
FAIL이면 커밋이 벽돌이 된다. 차단은 D24가 아니라 DEC-6의 verb preflight가 한다.

### DEC-9 — `setup`이 마커를 쓴다
REQ-060의 `runSetup` ⑦(유일한 쓰기)에서 모델·effort 패치와 **함께** 마커를 넣는다.
🔴 **패치가 비어 있어도(모두 Enter) 마커는 쓴다** — "설정을 확인했다"가 마커의 의미이고,
값을 안 바꾼 것도 확인의 결과다. 단 마커가 **이미 있고 값 변경이 없으면** 쓰지 않는다(무의미한 diff 방지).

### DEC-10 — 업그레이드 경로: 진행 중 티켓 보호 (C4)
grandfather(DEC-5)가 이 경우를 덮는다 — 진행 중 티켓이 있으면 유효 티켓 ≥ 1이고, 그 repo에는
설치 신호가 여러 개 있다. 즉 **업그레이드 직후 아무 조치 없이 계속 작업할 수 있다.**
D24 WARN이 setup을 권할 뿐이다.

## Phase별 구현

| phase | 내용 | 코드 파일 |
|---|---|---|
| **phase-1** | 마커 스키마 2벌 확장 + `setup`이 마커 기록(DEC-1·DEC-9) | 4 |
| **phase-2** | 공통 게이트 모듈(순수 판정 + root 해소 + 증거 수집, DEC-3~DEC-5·DEC-7) | 2 |
| **phase-3** | 워크플로 verb 7종 배선 + doctor D24(DEC-6·DEC-8) | 8 |
| **phase-4** | 문서(한/영)·CHANGELOG | 0(docs) |

## 변경 파일

- `scripts/req/lib/config.ts` — `SetupMarker` 타입 + `CONFIG_SCHEMA.setup`
- `workflow/req.config.schema.json` — 같은 확장(드리프트 금지)
- `bin/setup.ts` — 마커 기록
- `scripts/req/lib/setup-gate.ts` **(신규)** — 순수 판정 + 증거 수집
- `scripts/req/{req-new,req-next,review-codex,req-commit,req-close,req-reconstruct,req-review-exception}.ts` — preflight 배선
- `scripts/req/req-doctor.ts` — D24
- `tests/unit/setup-gate.test.ts` **(신규)** · `tests/unit/{setup,req-config,req-doctor}.test.ts`
- `docs/*` · `CHANGELOG.md`

## 하위호환·안전

- **기존 설치본 무영향**(DEC-5·DEC-10): 유효 티켓 + 설치 신호가 있으면 grandfather로 통과한다.
- **신규 설치만 막는다** — 그 시점엔 잃을 작업이 없고 setup 실행이 유일한 다음 단계다.
- **진단 수단은 남긴다**(DEC-6): `req:doctor`·`check`는 마커 없이도 동작한다.
- **doctor는 WARN 상한**(DEC-8) — 하드 게이트 경로에 새 FAIL을 넣지 않는다.
- **스키마 2벌 동시 확장**(DEC-1) — 한쪽만 고치면 vendored 스키마가 신규 키를 거부해 소비자가 죽는다.

### 미측정 (정직성 경계)

1. **소비자 repo에서의 실제 grandfather 판정** — 이 저장소는 dogfood(packageRoot === root)라
   `req:doctor`의 여러 체크가 "점검 불요"로 빠진다. e2e는 격리 repo 실설치로 확인한다(로드맵 말미).
2. **`git rev-parse --show-toplevel`이 실패하는 환경**(비-git 디렉터리) — 그때는 cwd로 떨어지며,
   `req:new`가 어차피 git repo를 요구하므로 게이트가 먼저 죽지 않는다. phase-2 테스트로 확인한다.
