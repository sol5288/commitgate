# REQ-2026-163 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

`bin/integrate.ts` (`readTicketFacts`):

```ts
const series = Array.isArray(st.review_series) ? (...) : []
budgetHardCapReached: series.some((s) => typeof s.attempts === 'number' && s.attempts >= hardCap),
reviewInconclusive: series.some((s) => s.closed_reason === null),
```

`phases[]` 에서 사라진 phase 의 series 도 그대로 센다.

## 핵심 설계 결정

### DEC-1 — **탈출구를 만들지 않는다. 판정을 바로잡는다**

먼저 `--close-orphan` 같은 수동 탈출구를 검토했다가 기각했다. 이 저장소가 반복해 온 진단은
*"게이트가 옳게 거부하지만 나가는 길이 없다"* 인데, **여기서는 게이트가 옳게 거부한 것이 아니다.**

`phases[]` 에 없는 phase 의 series 가 열려 있다는 사실은 **현재 phase 들이 검수됐는지에 대해 아무것도
말하지 않는다.** 존재하지 않는 phase 에는 소비될 승인이 없다. 그러므로 그것을 `reviewInconclusive`
로 세는 것은 **판정 오류**이고, 사람 승인으로 열어 줄 일이 아니라 세지 않아야 할 일이다.

수동 탈출구를 택했다면 정상 행위(리뷰 지적을 따른 phase 개명)마다 사람 승인이 하나씩 늘었을 것이다.

### DEC-2 — 우회가 열리지 않는가 (검증)

"phase 를 개명하면 BLOCKED 리뷰를 피할 수 있는가?" — **아니다.**

- 승인 증거는 **phase 별**이다. 새 이름의 phase 는 자기 승인을 새로 받아야 `req:commit` 을 통과한다.
- 예산 축은 **그대로 센다**: `budgetHardCapReached` 는 `series.some(attempts >= hardCap)` 이고
  이 REQ 는 그 줄을 **건드리지 않는다**. 개명으로 리뷰 예산이 리셋되지 않는다.
- 즉 이 변경이 없애는 것은 **"존재하지 않는 phase 의 미판정"** 하나뿐이다.

### DEC-3 — 판정 제외와 **기록 종결은 다른 축**이다 (design r01 P1)

앞선 판은 판정에서만 빼고 state 는 그대로 뒀다. 그러면 `closed_reason: null` 인 옛 series 가 영원히
남고, D34 는 **해소할 수 없는 WARN** 이 된다 — 해소 불가능한 경고는 사용자가 무시하는 법을 배운다.

두 축을 **함께** 둔다:

| 축 | 무엇 | 왜 |
|---|---|---|
| **판정** (DEC-1) | orphan 을 `reviewInconclusive` 로 세지 않는다 | 교착을 없앤다. 사람 조치가 필요 없다 |
| **기록** (여기) | orphan 을 닫는 **명시 경로**를 준다 | lifecycle 레코드를 정확하게 만든다. D34 가 해소된다 |

**`req:review-exception --close-orphan <series> --reason "…"`**

**durable 기록의 정본은 close-proof 의 `series-terminal` 이다**(design r02 P1). 리뷰 원장
(`review-ledger.jsonl`)은 `attempt-opened|attempt-closed` 뿐이고 자연키가
`(ticket_id, series_id, attempt, event)` 라 **series 수준 사건을 담을 수 없다** — 이미 닫힌 attempt 를
다시 쓰면 무결성 가드가 던진다. 반면 close-proof 는 `series-terminal` 이벤트를 이미 갖고 있고
자연키가 `(ticket_id, event, series_id)` 라 정확히 이 층이다(`--resolve replace` 와 `req:new
--successor-of` 가 같은 매체를 쓴다).

| 무엇 | 어디에 | 값 |
|---|---|---|
| durable 종결 | `close-proof` `series-terminal` | `resolution: 'orphaned'` — `TerminalResolution` 확장 |
| 런타임 상태 | `state.review_series[].closed_reason` | `'orphaned'` — 계약 확장 |

🔴 **두 계약 확장은 소유 파일을 phase 범위에 포함해야 한다**(design r02 P1):
- `TerminalResolution`(`'replace' | 'human-resolution'`) → `scripts/req/lib/close-proof.ts`
- `SeriesRecord.closed_reason`(`'approved' | 'human-resolution' | null`) → `scripts/req/review-codex.ts`

캐스트로 우회하지 않는다 — 계약 밖 값을 기록하면 소비자가 조용히 틀린다.

### DEC-3b — `orphaned` proof 는 **티켓 종결 사건이 아니다** (design r03 P1)

현 계약에서 `series-terminal` 은 **존재만으로 티켓 baseState** 가 된다. 그대로 두면 정상 진행 중인
티켓에서 phase 를 개명하고 `--close-orphan` 을 쓴 순간 그 티켓이 `series-terminal` 로 판정되어
**doctor 의 종결 면제(D2·D3·D11)를 잘못 받는다.** 진행 중인 티켓이 종결로 보이는 것은 이 REQ 가
고치려는 것보다 나쁜 결함이다.

🔴 **계약**: `resolution === 'orphaned'` 인 `series-terminal` 행은 **series 기록일 뿐**이며
**티켓 baseState 판정에서 제외**한다. 기존 `resolution`(`replace`·`human-resolution`)의 의미는 불변이다
— 그것들은 사람이 series 를 종결하고 **대체 REQ 로 넘어가는** 결정이라 티켓 수준 사건이 맞다.

판정 지점(구현이 전수 확인): `scripts/req/lib/intake.ts`(`scanTicketIntake` 의 baseState) ·
`scripts/req/req-doctor.ts:1860` 계열.

🔴 **양쪽 회귀를 고정한다**: developing 티켓(개명 후 orphan 종결 → baseState 불변·면제 없음) ·
`dev-complete` 티켓(REQ-2026-161 형태 → baseState 후퇴 없음).

🔴 **재실행은 수렴한다**(design r03 observation). 이미 닫힌 orphan 에 다시 실행하면 **아무것도 쓰지 않고
그 사실을 출력**한다(거부가 아니다 — `--close-stale` 이 같은 규율이다). help 와 테스트 oracle 에 고정한다.

🔴 **`baseState` 를 되돌리지 않는지 확인한다.** `req-doctor.ts` 의 종결 판정은 `series-terminal` 도
baseState 로 읽는다(`req-doctor.ts:1860`). 이미 `dev-complete` 인 티켓(REQ-2026-161)에 orphan 종결을
쓰면 baseState 가 `series-terminal` 로 **후퇴**하면 안 된다 — 그러면 완료된 티켓이 미완료로 보인다.
구현이 실제 형태로 확인한다.
- **멱등** — 이미 닫힌 series 는 다시 쓰지 않는다(같은 자연키에 새 타임스탬프면 무결성 가드가 던진다 —
  `--close-stale` 이 같은 이유로 원장을 정본으로 둔다).
- 🔴 **`--confirm` 을 요구하지 않는다.** `--resolve replace` 는 *"successor REQ 로 대체한다"* 는 **사람
  판단**이라 승인 문장이 필요하다. 여기엔 판단이 없다 — *"이 phase 는 `phases[]` 에 없다"* 는 도구가
  검증하는 **사실**이고, 사실 확인에 승인을 요구하면 정상 행위마다 통제점이 하나씩 늘어난다.
  `--reason` 은 요구한다(왜 사라졌는지는 사람만 안다).
- 🔴 **`phases[]` 에 있는 phase 의 series 는 거부한다** — 그것을 닫으면 필요한 리뷰를 건너뛰는 길이 된다.

### DEC-3a — 진단: `req:doctor` D34(WARN)

열린 orphan 이 있으면 series id 와 사라진 phase id, 그리고 **DEC-3 의 해소 명령**을 함께 낸다.

🔴 **WARN 상한**(D19~D33 과 동일 근거). `req:commit` 이 doctor 를 하드 게이트로 spawn 하므로
FAIL 이면 개명을 한 티켓의 모든 커밋이 벽돌이 된다.
🔴 **integrate 전에** 보여야 한다 — 실측에서 이 사실은 통합 시점에야 드러났다.

### DEC-4 — 술어는 순수 함수 하나

`scripts/req/lib/review-series.ts`(신규):

```ts
export function orphanPhaseSeries(state): { seriesId: string; phaseId: string }[]
export function inconclusiveSeries(state): string[]   // orphan 제외한 열린 series
```

🔴 **`series_id` 를 파싱하지 않는다**(design r01 observation). 레코드에 이미 `review_kind` 와
`phase_id` 가 보존돼 있다. phase id 에 `#` 가 들어갈 수 있어 문자열 분해는 조용히 틀린다 —
기존 코드도 같은 이유로 분해를 피한다.

`integrate` 와 `doctor` 가 **같은 술어**를 쓴다. 두 곳에서 각자 판정하면 "doctor 는 괜찮다는데
integrate 가 막는" 상태가 다시 생긴다(REQ-2026-094 가 같은 결론에 도달했다).

🔴 **`design:` series 는 대상이 아니다.** `phase:<pid>#N` 만 phase 소속을 물을 수 있다.
`design` series 는 `phases[]` 와 무관하므로 열려 있으면 그대로 미판정이다.

### DEC-5 — ② 는 이 저장소의 `package.json` 을 고친다

`req:next` 의 렌더링 규칙(`buildScriptInvocation`)은 **정상**이다 — 소비자 축의 부재는
REQ-2026-161 의 C6/D33·`sync --apply --scripts` 가 이미 덮는다. 여기서 틀린 것은
**이 저장소가 자기 명령 표면을 갖추지 않은 것**이다.

Stage A 형태(`tsx scripts/req/<file>.ts`)로 누락 7개를 채운다. Stage B(`commitgate <verb>`)로
넣지 않는다 — 이 저장소는 소스에서 돌고, `detectStageA`(D19)가 Stage A 서명으로 판정하는 곳이다.

## Phase별 구현

| phase | 내용 |
|---|---|
| 1 | `lib/review-series.ts` 순수 술어 + `integrate` 판정 배선 |
| 2 | `--close-orphan` 종결 경로(기록·멱등·승인 불요) |
| 3 | `req:doctor` D34 + `07` 정본 표 |
| 4 | 이 저장소 `package.json` 의 Stage A `req:*` 누락 7개 보강 |
| 5 | CHANGELOG |

🔴 phase 1·2 는 **배선 phase** 다 — 순수 테스트만으로는 배선 끊김을 못 잡는다.
실경로(REQ-2026-161 의 실제 state 형태)로 확인하고 변이 검사로 고정한다.

## 변경 파일

- 신규: `scripts/req/lib/review-series.ts` · `tests/unit/review-series.test.ts`
- 수정: `bin/integrate.ts` · `scripts/req/req-review-exception.ts` · `scripts/req/lib/close-proof.ts` ·
  `scripts/req/review-codex.ts` · `scripts/req/lib/intake.ts` · `scripts/req/req-doctor.ts` ·
  `docs/ssot-design/07-business-rules-and-state-machines.md` · `package.json` · `CHANGELOG.md`

## 하위호환·안전

- **차단이 늘지 않는다.** 판정에서 빼는 방향이고 D34 는 WARN 이다.
- **예산 축 불변** — `budgetHardCapReached` 는 건드리지 않는다(DEC-2).
- `design:` series·정상 phase 의 열린 series 는 **그대로 미판정**이다. 좁게만 뺀다.
- `--close-orphan` 은 `phases[]` 에 있는 phase 의 series 를 **거부**한다 — 리뷰 우회 경로가 되지 않는다.
- 두 enum 확장은 **추가만** 한다(기존 값 의미 불변). `closed_reason !== null` 로 판정하는 기존 소비자
  (`req-review-exception` 의 `--resolve` 가드)는 `'orphaned'` 를 **종결로** 읽어야 정상이다 — 그렇다.
- `orphaned` proof 는 티켓 baseState 에서 제외된다(DEC-3b) — developing·dev-complete 양쪽 회귀 고정.
- 기존 `resolution` 값(`replace`·`human-resolution`)의 티켓 종결 의미는 **불변**이다.
- `package.json` 보강은 이 저장소 한정이고 값은 Stage A 형태라 D19 판정이 바뀌지 않는다.
