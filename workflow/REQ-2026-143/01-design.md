# REQ-2026-143 설계

## DEC-1 — 완결 티켓 문서는 **정오표 절만 덧붙인다**

REQ-2026-142 의 `01-design.md`·`02-plan.md` 본문을 고치지 않는다. 그 문서는 **그 시점의 승인 대상**이고,
커밋된 매니페스트의 `design_hash` 가 그 내용을 가리킨다. 본문을 고치면 사후에 "승인받은 것"이 달라진다 —
감사 기록으로서 거짓이 된다.

대신 문서 **끝에 `## 정오표 (REQ-2026-143)` 절을 덧붙여**, 무엇이 틀렸고 실제는 무엇인지 적는다.
🔴 이렇게 하면 해시는 어차피 바뀌지만, **바뀐 사실이 문서 안에 남는다**는 점이 다르다. 조용히 고쳐
놓으면 나중에 읽는 사람이 승인 시점 내용을 복원할 방법이 없다.

## DEC-2 — 정오표 3건

| # | 어디 | 문서가 말하는 것 | 실제 |
|---|---|---|---|
| 1 | `01-design.md` DEC-2 | `items: { path; sha256 }[]` | `PinnedInventoryItem = { response_path; sha256 }` |
| 2 | `02-plan.md` phase-1 | `tests/unit/evidence.test.ts` | 그런 파일은 **없다**. `tests/unit/evidence-module.test.ts` |
| 3 | `01-design.md` DEC-5 | `resumeFrom: 'stage'│'evidence-commit'│'reverify'│'checkpoint'` | `'evidence'│'consume'│'checkpoint'` |

🔴 **#2 가 가장 위험하다.** vitest 는 매칭되는 파일이 없어도 **exit 0** 으로 끝난다. 그 줄을 그대로
복사한 사람은 "계약 스위트 통과"를 보지만 실제로는 **아무것도 돌지 않았다**. 정오표에 그 사실을 적는다.

## DEC-3 — `stopGate: "auto"` 전환은 **티켓 안에서** 한다

착수 시 "config 를 먼저 커밋해야 한다 → REQ 밖 커밋 필요"로 보였으나, `req:repolicy` 가 그 경로를 연다.

```
req:new(스냅샷=merge) → config 를 auto 로 → req:repolicy <REQ> --run(스냅샷=auto) → 이 티켓부터 auto
```

- D32 는 드리프트를 **WARN** 으로 내고 `req:repolicy` 를 안내한다 — FAIL 이 아니라서 진행이 막히지 않는다.
- 🔴 **repolicy 는 이 티켓의 스냅샷만 바꾼다.** 다른 티켓은 각자의 스냅샷을 유지한다("한 티켓이 두 정책으로
  판정되지 않도록"이라는 D32 문구 그대로다).

## DEC-4 — 도그푸딩은 **부정 사례를 먼저** 확인한다

위임을 받기 전에 `integrate --run` 을 먼저 돌려 **차단**을 실측한다.

🔴 **관측할 계약을 정확히 적는다**(설계 r01 P1 정정). 초안은 `AWAIT_HUMAN` 을 약속했으나 그건 틀렸다 —
`stopGate: "auto"` 에서 위임이 없으면 `delegationGate()` 가 `denied(absent)` 를 내고 integrate 는
**exit 1 로 차단**한다(`AWAIT_HUMAN` 은 `merge`·`req` 정책의 표면이다). 관측 대상은 다음 셋이다:

| 관측 | 기대 |
|---|---|
| 종료 코드 | `1` |
| 사유 | `absent` (위임 없음) |
| trunk | **변하지 않음**(병합이 일어나지 않았다) |

이 REQ 는 코드를 바꾸지 않으므로 **표면을 바꾸지 않고 실제 표면을 기록**한다. 예측을 실측에 맞추는 것이지
실측을 예측에 맞추는 것이 아니다.

🔴 **순서를 뒤집으면 아무것도 증명하지 못한다.** 위임을 먼저 주고 병합이 되는 것만 보면, 그것이 위임
때문인지 원래 그냥 되는 것인지 구별할 수 없다. 막히는 것을 먼저 보고, 위임 하나만 더해서 풀리는 것을 봐야
그 위임이 원인이라고 말할 수 있다.

권한은 **`local_merge` 만**이다. `--allow-push`·`--allow-bypass` 를 주지 않으므로 push 는 계속 막혀야
하고, 그 사실도 실측 대상이다.

## Phase 분해

한 phase 다 — docs + config 뿐이고 코드 변경이 없다.

| phase | 범위 |
|---|---|
| `phase-1-errata-and-auto` | REQ-142 문서 정오표 3건 · `req.config.json` `stopGate: "auto"` · CHANGELOG |

## 변경 파일

`workflow/REQ-2026-142/01-design.md` · `workflow/REQ-2026-142/02-plan.md` · `req.config.json` · `CHANGELOG.md`

## 안전

- 코드 변경이 없으므로 런타임 동작은 그대로다. `auto` 는 **명시 opt-in** 이고 위임이 없으면 종전대로 멈춘다.
- 🔴 이 REQ 는 `hardCap`·HIGH·BLOCKED 를 건드리지 않는다. 도그푸딩이 안전 중단을 무르게 하면 그건 실패다.
