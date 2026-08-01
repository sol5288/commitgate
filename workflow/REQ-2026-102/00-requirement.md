# REQ-2026-102 요구사항

## 배경 — 소비자 개선 요청(yammy-sales, 0.17.0) 중 **일부만** 채택

리포터 제기: "legacy 티켓에서 `req:doctor`가 상시 FAIL한다. legacy는 취할 수 있는 조치가
하나도 없는데(intake·close가 그렇게 말한다) doctor만 3건의 FAIL과 exit 1을 낸다."

**재현은 정확하다.** 인용 지점(`req-doctor.ts:1045-1052`·`intake.ts:85`·`req-close.ts:154`)도
전부 맞다. 그러나 실측 결과 **전제가 성립하지 않는다.**

## 실측 1 — `legacy` 축이 두 개이고 겹치지 않는다

| 축 | 필드 | 원천 | 효과 |
|---|---|---|---|
| intake legacy | `evidence_durability_required` | **HEAD** | `req:new` intake만 안 막음 |
| review legacy | `review_series_model_version` | **워킹 state** | `req:review-codex`가 **거부** |

**리포터 저장소(124티켓) 실측**: 둘 다 legacy = **0건** · intake만 legacy = **4건**
(REQ-001·002·003·062 — 리포터가 든 바로 그 4건). 이 저장소는 43건 중 **21건**이 같은 상태.

→ **리포터가 든 4건 전부가 `req:review-codex`를 통과할 수 있다.** 즉 리뷰받고 커밋까지 진행
가능하며, D2/D3/D11은 정확히 그것을 지키고 있다.

## 실측 2 — 면제·WARN 강등은 커밋 경로를 연다

`req:commit`은 이 doctor를 **exit≠0에 throw하는 하드 게이트로 spawn**한다
([req-doctor.ts:544,563](../../scripts/req/req-doctor.ts) 주석이 근거). 따라서 리포터 제안
(a)면제·(b)WARN강등을 택하면 위 4건(이 저장소 21건)이 **main에서 커밋 가능**해진다.

**→ 동작은 바꾸지 않는다.**

## 실측 3 — "모순"은 축이 다르다. 다만 문구가 그것을 숨긴다

intake·`req:close`의 "legacy는 막지 않는다"는 전부 **`req:new` intake 차단**에 한정된 진술이고,
D2/D3/D11은 **작업 위치**에 관한 것이다. 논리적 모순은 없다. 그러나 그 범위 한정이 문구에
드러나지 않아 읽는 사람이 모순으로 읽는다 — 리포터가 실제로 그렇게 읽었다.

## 진짜 결함 — REQ-2026-097이 만든 낡은 문장 (우리 책임)

[req-close.ts:154-155](../../scripts/req/req-close.ts):

> `durable 티켓이 아닙니다(legacy) — 포기 종결 대상이 아닙니다.`
> `  legacy 티켓은 req:new intake를 막지 않으므로 **탈출구가 필요 없습니다.**`

이 문장은 REQ-2026-097 **이전**에 쓰였다. 그때는 "종결"의 효용이 *intake 통과* 하나뿐이었고
legacy는 이미 통과하므로 참이었다. **REQ-097이 종결에 새 효용을 붙였다** — 종결되면 D2/D3/D11이
면제된다. 그 순간부터 legacy 티켓에도 탈출구가 **필요해졌는데** 문장은 갱신되지 않았다.

REQ-2026-098(없는 조치를 권함)·REQ-2026-100(게이트가 안 하는 일을 문서가 보장)과 **같은 결함 class**다.

## 요구사항

- **R1** — **동작을 바꾸지 않는다.** D2/D3/D11은 legacy에서 계속 FAIL한다(실측 2).
- **R2** — `req:close`의 "탈출구가 필요 없습니다"를 **사실로 정정**한다. 없는 경로를 안내하지도 않는다
  (REQ-2026-094 교훈: 없는 명령을 안내하면 막다른 길로 보낸다).
- **R3** — doctor가 legacy 티켓에서 FAIL할 때 **왜 면제되지 않는지**를 말한다. 지금은 아무 사유가
  없어 사용자가 원인을 추적할 수 없다(리포터가 리포트를 쓴 이유다).
- **R4** — 새 술어를 만들지 않는다. 판정 원천은 REQ-097이 쓰는 `scanTicketIntake().baseState` 그대로다.

## 범위 밖 (의도적으로 하지 않는 것)

- **legacy 종결 경로 신설** — 실재하는 갭이지만 `deriveBaseState`가 `durabilityRequired`를 **가장 먼저**
  보므로 `--abandon` 허용만으로는 부족하다(종결 행이 있어도 `legacy`로 남는다). 설계가 필요한
  별건이다. 이 REQ는 **현재 상태를 정직하게 말하는 것**까지만 한다.
- **개선-2(`req:*`에 `--help`)** — 채택하지 않는다. 근거:
  루트 도움말이 나열하는 명령은 8개(`init`·`setup`·`check`·`sync`·`quickstart`·`delivery`·`migrate`·
  `uninstall`)이고 **전부 `--help`를 구현한다**(전수 확인). 즉 "각 명령의 상세 옵션은 `--help`로"는
  **자기가 안내한 명령에 대해서는 참**이며 거짓 진술이 아니다. `req:*`는 그 목록에 없다.
  또 리포터의 심각도 근거("`--message-file`은 CHANGELOG로만 알 수 있다")도 사실이 아니다 —
  `req:next` 출력([req-next.ts:432](../../scripts/req/req-next.ts))이 커밋 직전에 명령 형태로 안내하고,
  `AGENTS.md` 명령표·`docs/workflow.md`·`docs/troubleshooting.md`(한/영)에도 있다.
  usage 문자열 10개를 새로 만들면 **parseArgs와 갈라지는 드리프트 표면**이 10개 늘어난다.
