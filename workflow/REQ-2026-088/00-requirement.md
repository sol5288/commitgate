# REQ-2026-088 요구사항

낡은 design_ref 결속을 벽에 부딪히기 전에 알린다

## 배경 — 소비자(yammy) 0.13.1 운영 실측

0.13.1 업그레이드 후 감사에서 나왔다. **REQ-2026-084/085/086 세 티켓 중 하나가 종결 불가 상태로 향하고
있는데 도구가 아무 말도 하지 않는다.**

### 현상

`REQ-2026-086`의 커밋된 승인 매니페스트다.

```
design 승인                      design_hash=4a00cb74e154
design 승인                      design_hash=907ca2cbf1fc
  phase-1-smoke-contract    →    phase_design_ref=907ca2cbf1fc
  phase-2-principal-aa      →    phase_design_ref=907ca2cbf1fc
design 승인                      design_hash=206a7c7652cf   ← 세 번째 승인
  phase-3-visual-fixture    →    phase_design_ref=206a7c7652cf
```

phase-3 직전에 설계를 다시 승인받으면서 **앞선 두 phase가 옛 해시에 남았다.**

`computeDevCompleteProof`는 *"각 inventory phase가 **현재 design_ref에 결속된** 증거를 가져야"* 발행한다.
따라서 남은 `phase-4`를 마쳐도 **`dev-complete`가 발행되지 않고**, 티켓이 닫히지 않으며, 다음 `req:new`도 막힌다.

### 🔴 진짜 문제 — 예고가 없다

지금 `req:next`를 돌리면 이렇게만 말한다.

```
[req:next] AGENT  REQ-2026-086
  phase `phase-4-visual-repoint`를 구현하고 테스트를 통과시킨 뒤 git add 하고 다시 req:next.
```

**판정에 필요한 데이터는 이미 커밋된 매니페스트에 전부 있다.** 그런데 `phase-4`를 다 만들고 커밋까지 한
**뒤에야** 벽에 부딪힌다. 그 시점에 하는 일은 어차피 `req:rebind` 2회인데, 그걸 미리 알면 계획이 달라진다.

### 이미 있는 것과 없는 것

| | 상태 |
|---|---|
| 판정 술어 `splitUnboundPhases(manifest, designRef)` | ✅ 있음(순수) |
| 안내 생성기 `recoveryGuidance(...)` | ✅ 있음(순수) — rebind 명령 + 확인 문장까지 만든다 |
| 해법 `req:rebind` | ✅ 있음(배포됨) |
| **진행 중에 이 사실을 알리는 곳** | ❌ **없음** |

`recoveryGuidance`의 유일한 호출부는 **intake 스캔**(`req:new` 차단)과 `req:close --migrate` 거부다.
둘 다 **이미 갇힌 뒤**에 동작한다.

### 같은 종류의 결함을 이미 한 번 고쳤다

REQ-2026-085의 D25(미병합 누적 경고)가 정확히 같은 병이었다 — **도구가 아는 사실을 사람에게 미리
말하지 않는 것**. 이번 건도 데이터는 다 있고 시점만 늦다.

## 요구사항

- **R1** 티켓이 **진행 중일 때** 낡은 design_ref에 묶인 phase가 있으면 알린다.
- **R2** 안내는 **적용 가능**해야 한다 — 실행할 명령(확인 문장 포함)을 그대로 준다.
- **R3** 🔴 **아무것도 막지 않는다.** 진행 중 결속이 끊긴 것은 그 자체로 오류가 아니다(마지막에 재결속하면 된다).
- **R4** 판정 근거는 **커밋된** 매니페스트다 — 워킹트리 사본은 쓰기 도중일 수 있다.
- **R5** 안내 문구·명령은 intake·`req:close --migrate`가 쓰는 것과 **같은 생성기**에서 나온다.
  한쪽이 권하는 명령을 다른 쪽이 거부하는 상태(REQ-2026-072가 고친 결함)를 재발시키지 않는다.
- **R6** 재결속 불가(레거시 `phase_design_ref` 부재) phase에는 `req:rebind`를 권하지 않는다 —
  `recoveryGuidance`가 이미 그 분기를 갖는다(막다른 길을 하나 더 만들지 않는다).
- **R7** 결속이 온전한 티켓에는 **아무 문구도 추가되지 않는다**(노이즈 금지).

## 비목표

- 자동 재결속을 하지 않는다. "이 설계 변경이 그 phase의 검수를 무효화하는가"는 **사람의 판단**이고,
  `req:rebind`가 확인 문장을 요구하는 이유가 그것이다.
- `dev-complete` 술어·`req:rebind`·intake 판정을 바꾸지 않는다. **알리는 시점만** 추가한다.
- 설계 재승인 자체를 막거나 줄이지 않는다.
