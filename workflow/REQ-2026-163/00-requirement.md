# REQ-2026-163 요구사항

## 무엇

REQ-2026-161 진행 중 실측으로 밟은 **도구 결함 2건**을 해소한다.

1. **orphan review series 가 `auto` 통합을 영구 차단한다.** 닫는 전용 경로가 없다.
2. **이 저장소(dev repo)에서 `req:next` 가 실행 불가능한 명령을 렌더링한다.**

## 왜

### ① orphan review series

리뷰 지적을 따라 **mid-ticket 으로 phase 를 개명·재정렬**하면(REQ-2026-161 에서 `phase-2-check-c6` →
`phase-3-check-c6`) `state.json` 의 옛 series 레코드가 `closed_reason: null` 로 남는다.
attempt 는 전부 `attempt-closed` 인데 **series 레코드만** 열려 있다.

`bin/integrate.ts` 가 `series.some((s) => s.closed_reason === null)` 로 `reviewInconclusive` 를 판정하므로
`stopGate: "auto"` 자율 통합이 **영구 차단**된다:

```
사전 위임이 이 통합을 허용하지 않습니다 (review-inconclusive): BLOCKED 또는 미판정 리뷰가 남아 있다
```

기존 탈출구가 둘 다 맞지 않는다:

| 경로 | 왜 안 되나 |
|---|---|
| `req:review-exception --close-stale <series>` | **attempt 축**이다 — `버릴 열린 attempt 가 없다` 로 거부 |
| `req:review-exception --resolve replace` | 닫아 주지만 의미가 **"successor REQ 로 대체"** 이고 안내가 `req:new --successor-of` 로 이어진다. 같은 티켓 안에서 대체된 경우엔 successor 가 없어 **의미를 빌려 쓰는 것**이다 |

🔴 phase 개명·재정렬은 **리뷰 지적을 따르는 정상 행위**다. 정상 행위의 부작용이 영구 교착을 만드는데
나가는 길이 없다 — 이 저장소가 반복해 온 계열이다(REQ-092·093·141·142·145·146).

🔴 **integrate 에서야 드러난다.** 그 전 어떤 진단도 말하지 않았다.

### ② dev repo 의 렌더링 사각지대

이 저장소의 `package.json` 은 Stage A(`tsx scripts/req/*.ts`) 형태로 `req:*` 를 **5개만** 갖는데
`VERB_MODULES` 의 `req:*` 는 **12개**다. 그래서 `req:next` 가 통합 통제점에서 안내한 명령이 실패했다:

```
승인 후 실행: $ npm run req:delegate -- --scope ticket:REQ-2026-161 ...
→ npm error Missing script: "req:delegate"
```

소비자 축은 REQ-2026-161 의 C6/D33 이 진단하지만 **dogfood 는 의도적으로 skip** 이라 사각지대다.
도구가 자기 저장소에서 자기 안내를 따를 수 없는 상태다.

## 제약

- 🔴 **조용한 멱등으로 만들지 않는다**(REQ-2026-151 DEC-1). 완료·대체된 series 를 소리 없이 닫으면
  lifecycle 의미가 흐려진다. **막고 안내하거나, 기록을 남기며 닫는다.**
- 🔴 `--resolve replace` 의 의미를 넓히지 않는다 — 그 결정은 successor REQ 를 전제한다.
- 진단은 **WARN 상한**. 새 차단 지점을 만들지 않는다.
- ②는 이 저장소의 `package.json` 만 바꾼다. `buildScriptInvocation` 렌더링 규칙은 건드리지 않는다
  (소비자 축은 C6/D33·`sync --scripts` 가 이미 덮는다).

## 완료 기준

1. **통합이 풀린다** — orphan series 는 `reviewInconclusive` 로 세지 않는다. 사람 조치 없이 풀린다
   (정상 행위의 부작용마다 승인을 늘리지 않는다).
2. **기록이 정확해진다** — orphan series 를 `closed_reason` 과 durable 원장 행으로 **닫는 경로**가 있다.
   승인 게이트가 아니다(사람 판단이 없다 — 도구가 검증 가능한 사실로 닫는다). 멱등이다.
3. **integrate 전에 보인다** — 열린 orphan 이 있으면 `req:doctor` 가 WARN 으로 알리고, 2 의 경로로
   **해소 가능**하다(해소할 수 없는 WARN 은 만들지 않는다).
4. 이 저장소에서 `req:next` 가 안내한 `req:*` 명령이 **그대로 실행된다**.
5. 변경한 소스를 import 하는 테스트 그린 · 통합 직전 전체 스위트 1회 그린.

## 비목표

- `--close-stale`(attempt 축)·`--resolve`(대체 결정)의 기존 의미 변경.
- 소비자 `package.json` 자동 수정 — `sync --apply --scripts`(REQ-2026-161)가 담당한다.
