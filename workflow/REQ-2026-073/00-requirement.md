# REQ-2026-073 요구사항 — 설치 경로·정지 지점 문서 전면 갱신

## 왜 지금인가

0.10.0(setup CLI)과 REQ-2026-071(stopGate 단일 지배)이 **설치 절차와 안전 속성을 둘 다 바꿨는데**
문서는 그 전 상태를 기술한다. 그 결과 두 가지 실해가 있다.

1. 🔴 **문서가 없는 보장을 약속한다.** REQ-071은 "HIGH 위험 티켓은 정책과 무관하게 매 phase 확인"이라는
   백스톱을 **의도적으로 제거**하고 확인을 `stopGate`가 정한 한 지점으로 옮겼다. 문서 5곳이 아직
   그 백스톱을 보장한다고 쓴다. 보장 문서가 실제보다 강한 약속을 하는 것은 가장 나쁜 종류의 결함이다 —
   읽는 사람이 그 약속을 믿고 자기 검토를 생략한다.
2. 🔴 **랜딩이 필수 설치 단계를 빠뜨린다.** `commitgate setup`을 마치지 않으면 `req:new`가 **막히는데**
   README의 "3분 시작"은 `install` + `init` 두 단계만 보여 준다. 처음 오는 사람이 그대로 따라 하면 막힌다.

## 실측 (2026-07-27, main=9b4df82)

문서 9종 × 한/영. `grep -c` 실측:

| 항목 | README ko/en | quick-start | configuration | workflow | guarantees | agent-prompt |
|---|---|---|---|---|---|---|
| `commitgate setup` | **0** | 1 | 3 | 0 | 0 | **0** |
| `stopGate` | **0** | 0 | 6 | 6 | **0** | 0 |
| `req:confirm` | **0** | 0 | 0 | 2 | 0 | 0 |
| `req:rebind` | **0** | 0 | 0 | 6 | 0 | 0 |

## 결함 목록

### P1 — 거짓 보장

- **F1** `docs/configuration.md:15` · `.en.md:15` — "HIGH 위험 티켓은 어느 값에서도 매 phase 확인".
- **F2** `docs/configuration.md:16` · `.en.md:16` — "HIGH 티켓은 어느 값에서도 매 phase 확인(`userConfirmGate` 백스톱)".
- **F3** `docs/workflow.md:28~33` · `.en.md:30~34` — "기본값은 매 phase 커밋 전에 `AWAIT_HUMAN`으로 멈춥니다"
  (기본값은 이제 `req`) + 같은 거짓 HIGH 주장.
  🔴 **같은 문서 192행의 새 절과 정면 모순**이라 어느 쪽을 믿어야 할지 알 수 없다.

### P2 — 설치 경로 누락

- **F4** README ko/en "3분 시작"이 `setup`을 빠뜨린다 — 따라 하면 `req:new`에서 막힌다.
- **F5** README ko/en에 `stopGate` 개념이 없다. "사람은 결정에만 참여합니다"라고 하면서
  **그 지점을 사용자가 고른다**는 사실을 말하지 않는다.

### P3 — 신규 기능 미문서화

- **F6** quick-start가 setup이 **무엇을 묻는지** 알려주지 않는다(3문항 · ↑/↓ 선택 · 기본값).
- **F7** README 명령표에 `req:confirm`·`req:rebind`·`req:review-exception`이 없다.
- **F8** `guarantees.md`에 `stopGate`·사람 확인 계약이 없다 — 보장 문서의 핵심 축인데 빠졌다.
- **F9** `agent-prompt.md`에 `setup`이 없다 — 에이전트가 **실행하면 안 되는** 사람 전용 명령이다.

## 수용 기준

1. F1~F3의 거짓 보장이 제거되고, 그 자리에 **실제 계약**(`stopGate`가 확인 지점을 단독으로 정한다)이 들어간다.
   🔴 "완화됐다"는 사실을 **숨기지 않는다** — 무엇이 없어졌는지 읽는 사람이 알 수 있어야 한다.
2. `workflow.md` 안에서 정지 지점 기술이 **한 곳**이 된다(HIGH 절이 정본, 앞쪽은 그리로 보낸다).
3. README ko/en의 시작 절차가 **install → init → setup** 3단계이고, setup을 건너뛰면 막힌다고 말한다.
4. README ko/en이 `stopGate` 선택을 소개하고 기본값(`req`)과 그 뜻을 한 문장으로 말한다.
5. quick-start ko/en이 setup의 3문항·조작(↑/↓·Enter·Ctrl+C)·기본값(`gpt-5.6-terra`/`medium`/`req`)을 기술한다.
6. `guarantees.md` ko/en에 사람 확인 계약이 들어가고, **보장하지 않는 것**(HIGH 매 phase 백스톱은 더 이상 없다)도 명시한다.
7. `agent-prompt.md` ko/en이 `setup`을 사람 전용 명령으로 기술한다.
8. 한/영 **양쪽**이 같은 내용을 담는다. `docs:lint`(링크 검증) green.

## 범위 밖

- 문서 **구조** 개편(REQ-2026-042에서 이미 했다). 이번은 **내용 정합**만.
- 코드 변경. 문서가 코드를 따라가는 것이지 그 반대가 아니다.
- 릴리스 판단. 069~071 미배포분은 별도 결정.
