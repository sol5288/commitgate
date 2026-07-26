# REQ-2026-063 요구사항

stopGate 단일 축 + phaseCommit alias

## 배경

사람이 어디서 멈출지를 고르는 설정이 지금은 `phaseCommit.autoApprove`(`never`/`low-only`)다.
이것은 **구현 언어**(자동 커밋을 켤 것인가)이고, 사용자가 실제로 고르고 싶은 것은 **멈춤 위치**다.

`commitgate setup`(REQ-2026-060)이 이 설정을 묻게 되면 그 간극이 바로 드러난다 —
"자동 승인 정책이 never냐 low-only냐"는 질문은 사용자가 답할 수 있는 형태가 아니다.

## 요구사항

| # | 내용 |
|---|---|
| **R1** | 멈춤 위치를 **단일 축 `stopGate`** 로 표현한다 — `phase`(매 phase 멈춤) / `req`(REQ 완료 시 멈춤) |
| **R2** | 기존 `phaseCommit.autoApprove`를 **deprecated alias**로 존치한다(무회귀) |
| **R3** | 둘이 **모순**되면 fail-closed로 거부한다 |
| **R4** | `setup`이 `stopGate`를 묻는다 |

## 🔴 제약

### C1. 충돌 검사는 **raw key의 명시 여부**로 한다
`config.ts`의 해소는 `raw.phaseCommit ?? DEFAULTS.phaseCommit`이라 **키가 없어도 `{autoApprove:'never'}`로
채워진다**. 해소값을 비교하면 `stopGate: "req"`만 쓴 **정상 설정**이 "never와 모순"으로 오탐되어 거부된다.
→ 모순 판정은 **두 키가 raw에 모두 명시**됐을 때만 한다.

### C2. 기존 설정 무회귀
`phaseCommit`만 쓰던 기존 사용자의 동작이 바뀌면 안 된다. `setup`을 실행한 적 없는 프로젝트도 마찬가지다.

### C3. REQ-2026-019의 결론을 우회하지 않는다
`stopGate`가 무엇이든 **HIGH 위험 티켓은 매 phase 사람 확인**이다. `"all"`류 값을 만들지 않는다 —
HIGH는 매 phase 신선한 `user_commit_confirmed`를 요구하므로 자동화하면 livelock 또는 타임스탬프 위조가 된다.

## 🔴 비목표

| 비목표 | 이유 |
|---|---|
| **`stopGate: "merge"`** | delivery set이 필요하다 — 별도 REQ(B3). 이 REQ는 **2값만** 도입한다 |
| **`phaseCommit` 제거** | 기존 설정을 깨뜨린다. deprecated alias로 남긴다 |
| **`req:next`·`req:commit`의 판정 로직 변경** | 이 REQ는 **축을 재표현**할 뿐 멈춤 동작 자체를 바꾸지 않는다 |

## 수용 기준

1. `stopGate: "phase"` = 기존 `phaseCommit.autoApprove: "never"`와 **동일 동작**.
2. `stopGate: "req"` = 기존 `"low-only"`와 **동일 동작**.
3. `phaseCommit`만 있는 기존 설정이 **그대로 동작**한다(C2).
4. `stopGate`만 있는 설정이 **거부되지 않는다**(C1 — 해소된 기본값과의 오탐 없음).
5. 둘 다 명시됐고 모순이면 **fail-closed**로 거부하고, 무엇이 모순인지 알려 준다.
6. `setup`이 `stopGate`를 묻고, **HIGH는 어느 값에서도 매 phase 멈춘다**고 화면에 명시한다.
7. `npm test` green · `tsc --noEmit` 0.
