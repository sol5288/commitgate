# REQ-2026-141 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

| 자리 | 현재 |
|---|---|
| `scripts/req/req-delegate.ts` 끝 | `const runCli = …` — **export 없음**(dispatch 계약 위반) |
| `review-codex.ts:2356` `findUnstagedOrUntracked` | `responses/` 하위는 **untracked 단일 아카이브만** 허용. `approvals.jsonl` 수정은 무조건 flag |
| `req-doctor.ts:643` D10 | 위 함수를 그대로 쓴다 — **finalize 모드를 구분하지 않는다** |
| `review-codex.ts:1718` `appendLedgerRowToDisk` | 같은 자연키에 내용이 다르면 throw(fail-closed) — 해소 경로 없음 |

## 핵심 설계 결정

### DEC-1 — `runCli` export는 **버그 수정이지 계약 변경이 아니다**

`dispatch.test.ts`가 이미 계약을 고정하고 있었고 이 verb만 어겼다. 다른 verb와 같은 형태로 맞춘다.
🔴 **테스트를 고치지 않는다** — 계약이 옳고 구현이 틀렸다.

### DEC-2 — 🔴 D10 finalize 예외는 **이 REQ에서 뺀다**(분할)

설계 리뷰 **7라운드**가 전부 이 하나에서 나왔고, 매 라운드가 인접한 실결함을 새로 찾았다:
① 패턴 허용은 무관 아카이브 주입 구멍 → ② 경로 하나로 좁히니 정상 `needs-fix`+`approved` 복구가 막힘
→ ③ `archive_inventory` 로 결속하니 **그 필드가 `ApprovalEvidence` 에 없다**(승인 시점 생성·pin·SHA
검증 계약이 통째로 필요).

지적은 전부 타당하고 해법도 보인다. 다만 그것은 **승인 증거 모델을 건드리는 별도 작업**이지
"D10 조건 하나 완화"가 아니다. 이 저장소는 같은 상황에서 **동결·분할**을 택해 왔다
(REQ-2026-015·016·017). 설계 리뷰 상한(2/3/최대 5)도 이미 넘겼다.

**따라서 이 REQ 는 확정된 두 가지만 싣는다**: `runCli` 경계 수정(확정적 red 스위트)과
열린 attempt 해소 경로. D10 finalize 예외는 **후속 REQ**에서 `archive_inventory` 생성·state pin·
SHA 검증과 함께 다룬다.

🔴 **탈출구가 하나는 생긴다.** `--close-stale` 이 있으면 원장 충돌 교착은 풀린다.
finalize 교착은 남지만, 그때는 이 REQ 가 만든 경로로 되감아 재리뷰할 수 있다 — 완전한 봉쇄는 아니다.

### DEC-3 — 닫히지 않은 attempt는 **기록을 남기며** 해소한다

원장은 append-only 다. 해소도 **행을 더하는 것**이어야 한다 — 지우거나 덮어쓰면 그 순간 원장이
"무슨 일이 있었는지"를 말하지 못한다.

```
req:review-exception <REQ> --close-stale <series_id> --reason "<사유>" --run
```

🔴 **`<REQ>` 가 필요하다**(설계 리뷰 r01 P1). series id 는 `design:-#1`·`phase:<id>#1` 형태라 **REQ 를
담지 않는다** — 티켓 인자 없이는 어느 `state.json`·`review-ledger.jsonl` 을 여는지 정할 수 없다.
기존 `req:review-exception` 과 같은 위치 인자를 쓰고, **그 state 의 열린 series 와 id 가 일치할 때만** 처리한다.

🔴 **새 event 를 만들지 않는다 — `attempt-closed` 를 쓴다**(r02 P1). 원장 모델은 `LedgerEvent` 가
`attempt-opened | attempt-closed` 두 개뿐이고 키 화이트리스트가 있어, `attempt-abandoned` 행은
**검증기에 거부되어 append 자체가 실패한다.** 그런데 이 행위의 의미는 정확히 "이 attempt 를 닫는다" 다.

| 항목 | 값 |
|---|---|
| `event` | `attempt-closed` (**기존 값 — 변경 없음**) |
| `outcome` | `'abandoned'` — `LedgerOutcome`·`OUTCOMES` 에 **값 하나 추가**(additive) |
| `lifecycle` | `'abandoned'` — `lifecycle` 은 이미 forward-compatible(모르는 값을 거부하지 않는다) |
| 사유 | 선택 키 `stale_close_reason?: string \| null` 를 `OPTIONAL_LEDGER_KEYS` 에 추가 |
| 자연키·멱등성 | `(series_id, attempt, event)` — **아래 DEC-3a 참조**(재실행이 수렴해야 한다) |
| 옛 원장 호환 | 값 추가·**선택** 키 추가뿐이라 기존 커밋 원장은 그대로 유효(계약 1: 선택 키를 필수에 넣지 않는다) |

🔴 **선택 키는 `null | string` 만 허용된다**(r03 P1). 직렬화가 `o[k] = row[k] ?? null` 이고 검증기가
그 두 형태만 받으므로, **객체를 넣으면 그 행이 손상으로 판정된다.** 그래서 사유는 문자열 한 칸이다.
정합화의 근거는 별도 필드가 아니라 **행 자체**가 말한다 — `attempt: N` 이 닫혔다는 사실이 곧
`attempts` 가 N 이 된 이유다.

🔴 **예산 회계는 `void_attempts` 다**(r03 P1). "productive 가 아니다"를 **말로만** 두면 실제로는
늘어난다: productive = `attempts - refunded_attempts - void_attempts` 인데 `attempts` 만 N 으로 올리면
그만큼 productive 도 는다. `void_attempts` 는 **호출은 나갔으나 판정이 없던** 회차를 위한 기존 필드이고
(REQ-2026-084 DEC-4) 버려진 attempt 가 정확히 그것이다.

| 필드 | 변화 | 효과 |
|---|---|---|
| `attempts` | `max(attempts, N)` | 다음 리뷰가 **N+1** 을 연다(자연키 충돌 해소) |
| `void_attempts` | `+1` | `autoBudget` 에서 빠져 **productive 불변** |
| `hardCap` | — | dispatched 는 그대로 — 비용은 이미 발생했다 |

실측 확인(재현 상태): before `attempts=1, void=0` → productive **1**.
after `attempts=2, void=1` → productive **1**. 같다.

🔴 **행 하나로는 충돌이 안 풀린다**(r01 P1 — 이것이 더 중요하다). 재현 상태는
`원장에 attempt-opened #2` vs `state.attempts=1` 이다. `abandoned` 는 **별개 event** 라 이 어긋남을
바꾸지 않는다 — 다음 리뷰는 여전히 state 기준으로 `#2` 를 열려다 같은 자연키에 부딪힌다.
그래서 close 는 **원장을 정본으로 state 를 끌어올린다**.

| 규칙 | 왜 |
|---|---|
| 사유 **필수**(빈 문자열 거부) | 근거 없는 종결은 기록이 아니다(REQ-140 phase-3 과 같은 교훈) |
| 대상은 **열린 attempt 뿐** | 닫힌 것을 다시 닫으면 이력이 흐려진다 |
| 🔴 **대상은 `review_series[]` 의 그 `SeriesRecord`** — top-level 이 아니다(r03 P1) | 다음 리뷰(`recordAttempt`)가 보는 값이 거기다. top-level 을 올려도 아무 효과가 없다 |
| 🔴 `rec.attempts = max(rec.attempts, 원장의 그 attempt 번호)` | **이것이 충돌을 푸는 유일한 부분**이다 |
| `attempts` 를 **줄이지 않는다** | 시도한 사실도 비용도 사라지지 않는다 |
| 정합화 사실을 `attempt-closed(outcome=abandoned)` 행이 말한다 | 조용히 숫자를 올리면 그것이 곧 이력 조작이다 |
| 이 행 없이는 여전히 fail-closed | 탈출구를 만들되 **기본은 잠긴 채로** |

🔴 **한 series 에 열린 attempt 가 둘 이상이면 가장 이른 것부터** 닫는다(리뷰 r04 observation).
그래야 `--close-stale` 재실행이 남은 것을 순서대로 해소하고, 어느 것이 닫혔는지가 결정적이다.

🔴 **`attempts === N` 인 열린 attempt 를 닫으면 productive 는 1 줄어든다**(같은 observation).
그것이 `abandoned` 의 의미다 — 판정을 못 받은 회차가 예산을 먹고 있던 것을 되돌린다.
위 "productive 불변" 은 **정합화가 필요한 재현 상태**(`attempts < N`)의 이야기다. 두 경우를 각각 테스트한다.

### DEC-3a — 🔴 `--close-stale` 자신이 **부분 실패로 교착되면 안 된다**(리뷰 r05 P1)

이 명령은 **두 곳**을 바꾼다: durable 원장(append+커밋)과 scratch `SeriesRecord`. 그 사이에서 끊기면
원장에는 `attempt-closed(abandoned) #N` 이 남고 state 는 `attempts=1` 그대로다. 그러면 재리뷰는 다시
`#N` 을 열려다 충돌하고, close 재실행은 "이미 닫힘"이라 막힌다 — **고치려던 교착을 그대로 재생산한다.**
이 REQ 가 그 함정에 스스로 빠지면 안 된다.

**해법: 원장을 정본으로 두고 명령을 멱등하게 만든다.**

| 재실행 시점 상태 | 동작 |
|---|---|
| 원장에 abandoned 행 **없음** | 행 append + 커밋 → state 정합화 |
| 원장에 abandoned 행 **있음**(부분 실패 복구) | **append 하지 않는다** — state 정합화만 수행하고 그렇게 말한다 |
| 원장·state 둘 다 이미 정합 | no-op 이라고 말하고 exit 0 |

🔴 **재실행에서 새 행을 만들지 않는 것이 핵심이다.** 같은 자연키에 **새 타임스탬프**로 행을 구성하면
내용이 달라 무결성 가드가 던진다 — 그래서 "행이 이미 있는가"를 **행을 만들기 전에** 본다.

🔴 **state 는 원장에서 파생된다**(단방향). 원장이 durable 이고 state 는 scratch 이므로, 충돌이 나면
언제나 원장이 이긴다. 이 방향을 고정해 두면 어느 지점에서 끊겨도 재실행이 **수렴**한다.

🔴 **왜 `req:review-exception` 에 붙이나**: 이미 "예산·재리뷰의 사람 개입"을 다루는 verb 다.
새 verb 를 만들면 사용자가 외울 표면이 하나 늘고, 같은 축의 명령이 두 곳으로 갈라진다.

### DEC-4 — REQ-2026-140 phase-6 변경을 **그대로** 싣는다

`runCli` 수정과 push 배선 테스트 4종은 이미 작성·검증됐고 리뷰 승인까지 받았다(그 승인 증거는
게이트 교착으로 커밋되지 못했다). 내용을 다시 만들지 않고 패치로 복원한다 —
**같은 코드를 두 번 쓰면 두 번째가 미묘하게 달라진다.**

## Phase별 구현

| phase | 범위 |
|---|---|
| 1 | `runCli` export + push 배선 테스트 4종(REQ-140 phase-6 복원) · `dispatch.test.ts` 그린 |
| 2 | `--close-stale`(DEC-3·DEC-3a) + 원장 확장 + 문서 |

## 변경 파일

`scripts/req/req-delegate.ts` · `scripts/req/lib/review-ledger.ts`(outcome·선택 키 확장) ·
`scripts/req/review-codex.ts`(series 정합화) · `scripts/req/req-review-exception.ts` ·
`tests/support/integrate-fakes.ts` · 테스트 다수 · `docs/workflow*.md`(복구 절차) · `CHANGELOG.md`

## 하위호환·안전

- **정상 경로 무회귀가 최우선 오라클**이다. D10 은 `finalize=false` 에서 지금과 **완전히 동일**하게 판정하고,
  원장은 `--close-stale` 없이는 지금과 **완전히 동일**하게 막는다.
- 🔴 **이 REQ 자신이 그 교착을 다시 밟을 수 있다.** phase 마다 커밋이 중단되면 같은 상태가 된다 —
  그래서 phase-2 를 먼저 넣고 싶은 유혹이 있지만, `runCli` 는 **전체 스위트를 red 로 두는 실결함**이라
  그것을 먼저 고친다. 교착은 확률적이고 red 스위트는 확정적이다.
