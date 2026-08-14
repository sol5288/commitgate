# REQ-2026-144 설계

## 현재 상태

| 자리 | 현재 |
|---|---|
| `review-codex.ts:1875` | `decision.kind === 'hard-blocked'` → 한 줄 `throw` |
| `lib/review-ledger.ts` | 라운드별 `attempt-closed`(outcome·lifecycle·at) 커밋돼 있음 |
| `responses/<base>-rNN-*.json` | 라운드별 verdict — `findings[]`(`severity`·`detail`·`file`). 🔴 **워킹트리에만** 있다(승인 전엔 미커밋) |
| `approvals.jsonl` `archive_inventory` | 승인 시에만 생긴다 — **hardCap 상황에는 없다** |

즉 **필요한 데이터는 디스크에 이미 있다.** 없는 것은 그것을 읽어 정리하는 자리뿐이다.

## DEC-1 — 보고는 **읽기만** 한다. 새 호출도, 새 상태도 만들지 않는다

- 입력: 원장 행 + 라운드 아카이브 verdict.
- 출력: 문자열(사람이 읽는 보고). state·원장·매니페스트에 **아무것도 쓰지 않는다**.
- 🔴 **LLM 을 부르지 않는다.** "멈췄다"고 알리려고 또 부르는 것은 자기모순이고, 그 호출은 `hardCap`
  회계 밖에서 비용을 만든다.

### 🔴 아카이브는 **워킹트리에서** 읽는다 (설계 r04 P1 정정)

초안은 "이미 커밋된 증거만"이라고 했으나 **그 전제가 이 REQ 의 대상 상황에서 거짓이다**:
`approvals.jsonl`·`archive_inventory` 는 **승인일 때만** 내구화되므로, 8회 전부 needs-fix 로 hardCap 에
닿은 티켓에는 커밋된 아카이브가 **하나도 없다**.

| 자료 | 어디서 | 왜 |
|---|---|---|
| 원장 행 | 워킹 `review-ledger.jsonl` | 라운드마다 append·커밋되지만, 마지막 라운드는 미커밋일 수 있다 |
| 라운드 verdict | 워킹 `responses/<base>-rNN-*.json` | **커밋된 사본이 존재하지 않는다** |

이것이 허용되는 이유는 **보고가 아무것도 게이트하지 않기 때문**이다. 승인·커밋·병합 어느 판정도
이 문자열을 읽지 않는다. 🔴 그래서 보고는 스스로 **증거라고 주장하지 않는다** — 출력 머리에
"조언(감사 증거 아님)"임을 밝히고, 파일이 없거나 깨진 라운드는 조용히 건너뛴다(DEC-5).

🔴 **`archive_inventory` 에 기대지 않는다.** 그 목록은 승인 시점에만 생기므로 여기서는 항상 없다.
아카이브는 `expectedArchivePaths` 와 같은 이름 규칙으로 디렉터리에서 찾는다.

## DEC-2 — 비수렴의 신호는 **반복된 축**이다

라운드가 8번 돌았다는 사실 자체는 정보가 아니다. 정보는 **같은 것이 계속 걸렸는가**다.

```ts
export interface RepeatedAxis {
  /** 축의 종류 — 파일 경로이거나(`file`), 파일 없는 지적의 본문 앞부분이거나(`topic`). */
  kind: 'file' | 'topic'
  key: string
  /** 이 축이 등장한 라운드 번호(오름차순, 중복 없음). */
  rounds: number[]
}
```

- **라운드 2회 이상** 등장한 축만 담는다. 1회는 반복이 아니다.
- 정렬: `rounds.length` 내림차순 → `key` 오름차순. 🔴 **결정론** — 같은 입력이면 같은 순서다.
- `topic` 키는 `detail` 의 앞 **60자**를 정규화(연속 공백 1칸·소문자화)해 만든다.
  🔴 완벽한 클러스터링을 시도하지 않는다. 지적이 같은 문장으로 반복되는 경우만 잡으면 충분하고,
  의미 유사도를 흉내 내면 **결정론과 설명 가능성을 둘 다 잃는다**.

## DEC-3 — 권장 분해안은 **관측에서만** 나온다

"이렇게 나누세요"를 지어내지 않는다. 관측된 축을 그대로 후보로 제시한다.

- 반복 축이 **2개 이상**이면: 축별로 나누라고 제안하고 각 축의 라운드를 근거로 붙인다.
- 반복 축이 **1개**면: 분할이 아니라 **그 축 하나가 미해결**이라고 말한다(나눌 것이 없다).
- 반복 축이 **0개**면: 매 라운드 지적이 달랐다는 뜻 — 범위가 넓다는 신호로 말하고,
  라운드별 파일 수를 근거로 붙인다.

🔴 **세 경우의 문구가 달라야 한다.** 하나로 뭉뚱그리면 "분할하세요"가 항상 나오고, 분할이 답이 아닌
경우(축 1개·범위 과대)에 잘못된 길로 민다.

## DEC-4 — 다음 선택지는 **지금 이 상태에서 성공하는 명령**이어야 한다

설계 r01 P1: 초안의 선택지는 자리표시자였고, 값을 채워도 **정상 hardCap 상태에서 전부 실패**한다.
`--close-stale` 는 열린 attempt 가 있어야 하고(hardCap 상태에선 보통 다 닫혀 있다), `req:close --abandon`
은 `--reason`·`--confirm` 이 필수이며, `req:new --successor-of` 는 부모의 replace 결정 기록을 요구한다.

**그래서 선택지는 상태에서 계산하고, 실제 실행 형태로 적는다.**

보고의 구조는 **선행 정리(조건부 1줄) + 갈래 2개**다. 갈래는 서로 배타적이고, 각 갈래는 그 갈래를
끝까지 수행하는 명령 **전부**를 담는다.

```text
[선행] 열린 회차가 남아 있을 때만
  npx commitgate req:review-exception REQ-2026-144 --close-stale design#1 --reason "…" --run

[갈래 A] 이 REQ 를 버린다
  npx commitgate req:close REQ-2026-144 --abandon --reason "…" --confirm "…" --run

[갈래 B] 대체 REQ 로 잇는다 (순서대로 두 줄)
  npx commitgate req:review-exception REQ-2026-144 --resolve replace --series design#1 --reason "…" --confirm "…" --run
  npx commitgate req:new hardcap-nonconvergence-report-successor --successor-of REQ-2026-144 --run
```

- 🔴 **`npx commitgate <verb>` 접두와 `--run` 을 반드시 포함한다**(설계 r03 P1). 접두가 없으면 셸이 명령을
  못 찾고, `--run` 이 없으면 dry-run 이라 **아무것도 일어나지 않는다** — 둘 다 "실행되는 명령"이 아니다.
- 🔴 **`--resolve` 는 대상 series 를 명시로 받는다**(`--series <id>`). `--close-stale` 과 같은 모양이다.
  티켓에 design·phase series 가 동시에 열려 있을 수 있으므로 도구가 짐작하지 않는다.

- 🔴 REQ id·series id 는 **실제 값**을 박는다(REQ-2026-072 "적용 가능한 안내"). 사람이 채울 자리는
  사유·승인 문장처럼 **사람만 쓸 수 있는 것**뿐이고, 그 자리는 **따옴표 안**(`"…"`)에 둔다.
- 🔴 **꺾쇠 자리표시자를 출력하지 않는다**(설계 r02 P1). PowerShell 에서 `<` 는 리디렉션 토큰이라
  `req:new <slug> …` 를 복사해 실행하면 **명령 자체가 파싱 오류**로 죽는다. 따옴표 밖에는 사람이 채울
  자리를 두지 않는다.

### 대체 REQ 의 slug 는 **산출한다**

`req:new` 의 slug 는 사람의 창의가 필요한 값이 아니라 **식별자**다. 부모에서 결정론적으로 만든다.

```
부모 branch  feat/req-2026-144-hardcap-nonconvergence-report
             └ 접두 `feat/req-<year>-<num>-` 제거 → hardcap-nonconvergence-report
산출 slug    hardcap-nonconvergence-report-successor
```

- 부모 `state.branch` 에서 접두를 벗겨 쓴다. 벗길 수 없으면 `req-<번호>-successor` 로 떨어진다
  (예: `req-2026-144-successor`) — **어떤 경우에도 자리표시자가 남지 않는다**.
- 이미 그 이름의 브랜치가 있어도 `req:new` 가 스스로 거부하므로 여기서 중복 검사를 흉내 내지 않는다
  (판정을 두 곳에 두지 않는다).
- 🔴 **순서가 있는 것은 순서로 제시한다.** 대체 REQ 는 한 명령이 아니라 두 단계다 — 한 줄로 보이면
  실행하는 사람이 첫 단계에서 막힌다.
- 🔴 **`hardCap` 을 올리라는 선택지는 넣지 않는다.** 목록에 있으면 그게 기본 답이 된다.

## DEC-4a — 🔴 대체 REQ 경로를 **실제로 연다**(범위 확대)

`req:new --successor-of` 의 선행 조건을 기록하는 CLI 표면이 **없다**(요구사항 "착수 중 발견").
보고가 그 경로를 제시하려면 먼저 그 경로가 존재해야 한다.

`req:review-exception <REQ> --resolve replace --series <series_id> --reason "<사유>" --confirm "<승인 문장>" --run` 을 연다.

- 🔴 **대상은 `--series` 로 명시**한다. `closeSeriesHumanResolution` 은 `(kind, phase_id)` 로 열린 series 를
  찾는데, 티켓에 design·phase 가 동시에 열려 있을 수 있다. 도구가 짐작하면 **엉뚱한 series 를 종결**한다.
  `--series` 값에서 `(kind, phase_id)` 를 해소한다(`--close-stale` 이 이미 쓰는 해소 경로 재사용).

- 이 verb 를 고른 이유: `--close-stale` 과 **같은 축**(series 수명주기)이다. 새 verb 를 만들면 표면이
  하나 더 늘고, 사람이 어느 것을 쓸지 또 골라야 한다.
- 내부는 **이미 있는 `closeSeriesHumanResolution` 을 부른다**. 새 판정 로직을 만들지 않는다 —
  이 결함은 "로직이 없다"가 아니라 **"배선이 없다"**이므로 배선만 하면 된다.
- 🔴 `--reason`·`--confirm` 필수. 사람의 결정 기록이므로 근거 없이 쓰지 않는다(`--close-stale` 과 동형).
- 🔴 **state 변경을 커밋한다 — 실행 후 워킹트리가 clean 해야 한다**(설계 r05 P1). 이 verb 는
  `state.json` 의 series 를 human-resolution 으로 바꾸는데, 그대로 두면 바로 다음 단계인
  `req:new --successor-of` 가 **clean-worktree 검사에서 막힌다**. 두 단계로 안내해 놓고 첫 단계가
  둘째 단계를 막으면 그 경로는 실행 불가다 — 이 REQ 가 고치려는 결함과 **정확히 같은 모양**이다.
  `--close-stale` 이 이미 쓰는 `commitStateCheckpoint` 경로를 그대로 쓴다(새 커밋 경로를 만들지 않는다).
- 🔴 원장에도 사람 결정을 남긴다 — scratch state 만 바뀌면 그 결정이 **감사 이력에 남지 않는다**.
- 🔴 **`decision` 은 `replace` 만 연다.** 다른 값은 지금 소비처가 없다 — 쓰이지 않는 값을 받으면
  나중에 그 값이 무엇을 뜻하는지 아무도 모른다.

## DEC-5 — 보고가 차단을 흔들 수 없다

원장이 없거나 아카이브가 깨졌거나 JSON 이 파손됐어도 **차단은 그대로**여야 한다.

- 보고 생성은 전부 `try` 로 감싸고, 실패하면 **원래의 한 줄 메시지**로 떨어진다.
- 🔴 보고를 만들다 죽어서 차단 자체가 사라지면 그것은 게이트 붕괴다. 부수 기능이 주 기능을 이길 수 없다.
- 파손된 아카이브 한 개는 **그 라운드만 건너뛰고** 나머지로 보고를 만든다(전부 버리지 않는다).

## DEC-6 — 반복 출력은 **억제하지 않고 길이로 묶는다**

설계 r01 P1 정정: 초안은 "호출 지점이 하나면 한 번만 나온다"고 했으나 **틀렸다**. 같은 상태에서 같은
명령을 다시 실행하면 같은 분기를 다시 지나 같은 보고가 다시 나온다.

**억제 상태를 만들지 않는다**(그 플래그는 지워지면 거짓말이 되고, 지우는 경로가 또 하나의 표면이다).
대신 **출력을 묶는다**:

| 항목 | 상한 |
|---|---|
| 반복 축 | 상위 **3개** |
| 라운드 요약 | **1줄**(`r01 needs-fix · r02 needs-fix · …` 형태) |
| 갈래 | **2개**(A 버린다 / B 대체 REQ) + 선행 정리 **최대 1줄** |
| 명령 줄 | **4줄 이하**(선행 1 + A 1 + B 2) — 요구사항 제약과 같은 값이다 |

🔴 초안은 "명령 3개 이하"였는데 갈래 B 가 두 단계라 stale 이 있는 경우 4줄이 되어 **DEC-4 와 모순**이었다
(설계 r03 P1). 상한을 갈래 수로 잡고 줄 수는 그 결과로 두는 것이 옳다 — **갈래를 줄이려고 실행에 필요한
줄을 빼면 그 갈래가 실행 불가가 된다**.

🔴 반복 실행돼도 부담이 없을 만큼 짧으면 억제가 필요 없다. 발화 지점은 여전히 `hard-blocked` 분기
하나이고, `req:next` 는 보고를 복제하지 않는다.

## Phase 분해

| phase | 범위 |
|---|---|
| `phase-1-nonconvergence-analyzer` | `lib/nonconvergence.ts` — 반복 축 추출·세 갈래 분해안·상태 기반 선택지(전부 순수) |
| `phase-2-resolve-replace-verb` | `req:review-exception --resolve replace` 배선(DEC-4a) — 탈출구를 실제로 연다 |
| `phase-3-hardcap-report-wiring` | hard-blocked 분기 배선 · `req:next` 한 줄 안내 · 실패 시 원문 fallback · 문서 |

🔴 **phase-2 가 phase-3 보다 앞이다.** 보고가 제시할 명령이 먼저 존재해야 한다 — 순서를 뒤집으면
중간 커밋이 "실행 불가한 명령을 안내하는" 상태로 남는다.

## 변경 파일

`scripts/req/lib/nonconvergence.ts`(신규) · `scripts/req/req-review-exception.ts`(`--resolve`) ·
`scripts/req/review-codex.ts` · `scripts/req/req-next.ts` · 테스트 · `docs/workflow*.md` · `CHANGELOG.md`

## 안전

- `hardCap` 판정 로직(`checkReviewBudget`)은 **건드리지 않는다**. 이 REQ 는 그 뒤에 붙는 출력만 바꾼다.
- 🔴 무회귀 오라클: 보고 생성이 어떤 이유로든 실패해도 `hard-blocked` 는 **여전히 throw** 한다.
