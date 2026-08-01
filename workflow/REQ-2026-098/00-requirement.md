# REQ-2026-098 요구사항

## 배경 — 도그푸딩 중 발견(REQ-2026-096 phase 리뷰)

`granularityGate`의 **기본값은 `warn`**이다([lib/config.ts:237](../../scripts/req/lib/config.ts),
REQ-2026-087이 0.13.0의 `block` 기본값을 0.13.1에서 정정). warn 모드에서는 임계를 넘어도 리뷰가
**그대로 실행되고 과금된다.** 그런데 안내 문구는 `block` 모드를 가정하고 쓰여 있다.

REQ-2026-096 phase 리뷰(코드 9파일)에서 실제로 나온 출력:

```
[req:review-codex] ⚠️ phase 검수 면적 초과: 코드 변경 9파일 > 8(granularityMaxFiles)
리뷰 라운드는 면적에 비례해 늘어납니다(…). 리뷰를 실행하지 않았습니다 — 소모된 것이 없습니다.

둘 중 하나를 선택하세요.
  A. 지금 나눈다 (권장 — 코드는 한 줄도 바뀌지 않습니다)
  B. 이 phase는 원래 크다고 선언한다 …

(정책 자체를 끄려면 req.config.json에 "granularityGate": "warn" — 경고만 내고 진행합니다.)
⚠️  codex 실제 호출 (exec) — 호출 1회 발생        ← 실제로는 실행됐고 과금됐다
```

## 거짓인 것 세 가지

[review-codex.ts:1338-1352](../../scripts/req/review-codex.ts) `phaseAreaMessage`는 `block` 전용으로
쓰였는데 [review-codex.ts:2693-2695](../../scripts/req/review-codex.ts)가 **두 모드 모두**에 쓴다.
warn 모드에서 다음이 전부 사실과 다르다:

1. **"리뷰를 실행하지 않았습니다 — 소모된 것이 없습니다."** — 실행됐고 호출 1회가 소모됐다.
   비용에 관한 거짓 진술이라 가장 나쁘다.
2. **"(정책 자체를 끄려면 … `"granularityGate": "warn"`)"** — 이미 `warn`이다. 아무 효과 없는 조치를
   권한다. 실제로 멈추게 하려면 `"block"`인데 그 말은 어디에도 없다.
3. **"둘 중 하나를 선택하세요."** — 선택하지 않아도 리뷰는 이미 진행됐다. 차단 앞의 분기처럼 읽힌다.

## 이 규칙은 이미 저장소에 있다 — 한 표면만 빠졌다

REQ-2026-086 phase-2 r01 P1이 **정확히 같은 원칙**을 세웠고
[req-doctor.ts:206-211](../../scripts/req/req-doctor.ts)에 주석으로 남아 있다:

> 🔴 문구는 **실제 설정에 종속**된다(phase-2 r01 P1). `granularityGate:"warn"`인 사용자에게
> "막힙니다"라고 하면 도구가 하지 않을 일을 약속하는 것이다 — 안내가 거짓이면 사람은 안내를 믿지 않게 된다.

그때 **doctor의 D18**은 `phaseGranularityWarnings(codeFiles, maxFiles, gate)`로 고쳤는데
**리뷰 경로의 `phaseAreaMessage`는 함께 고치지 않았다.** 같은 결함 class, 다른 표면이다.

## 전수 확인(사전 실측)

"차단한다·소모되지 않았다"고 주장하는 사용자 문구를 전부 훑어 각 표면의 실제 동작과 대조했다:

| 표면 | 주장 | 실제 | 판정 |
|---|---|---|---|
| `phaseAreaMessage`(review-codex:1338) | 실행 안 함·소모 없음 | warn이면 **실행·과금** | ❌ 결함 |
| `forbiddenStagedMessage`(review-codex:1365) | 실행 안 함·소모 없음 | `:2627`에서 항상 `throw` | ✅ 정확 |
| `phaseGranularityWarnings`(req-doctor:204) | 모드별 분기 | 모드별 분기 | ✅ 정확 |
| `bin/init.ts`의 "막힙니다" 4곳 | setup·`req:new` 차단 | 실제 차단 | ✅ 정확 |

**결함 표면은 정확히 하나다.**

## 요구사항

- **R1** — 안내 문구가 `granularityGate` 설정에 종속돼야 한다. warn 모드에서 "실행하지 않았다"·
  "소모되지 않았다"고 말하면 안 된다.
- **R2** — warn 모드 문구는 **이미 있는 설정을 다시 권하지 않는다.** 실제로 멈추려면 `"block"`임을 알린다.
- **R3** — `block` 모드 문구는 **바뀌지 않는다**(그 모드에서는 현재 문구가 정확하다).
- **R4** — 회귀는 고정 문자열로 잠근다. 두 모드가 서로의 문구를 갖지 않음을 검사한다.

## 범위 밖

- granularity 정책·임계·기본 모드 자체는 건드리지 않는다(REQ-2026-086/087에서 정해진 것).
- D18 doctor 문구는 이미 정확하므로 변경하지 않는다.
