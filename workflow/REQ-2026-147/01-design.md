# REQ-2026-147 설계

## 현재 상태 (실측)

| 자리 | 현재 |
|---|---|
| `review-codex.ts` `hard-blocked` 분기 | 한 줄 `throw` — 왜 멈췄는지도, 다음에 뭘 할지도 없다 |
| `responses/review-ledger.jsonl` | 라운드별 `attempt-closed`(outcome·at). **커밋돼 있다** |
| `responses/<base>-rNN-*.json` | 라운드별 verdict(`findings[]`: `severity`·`detail`·`file`). 🔴 **워킹트리에만** |
| `req:review-exception --resolve replace` | REQ-2026-145 로 **개설됨** — 갈래 B 가 실행 가능해졌다 |
| `req:close --abandon` | `--reason`·`--confirm` 필수 |
| `req:review-exception --close-stale` | **열린 attempt 가 있을 때만** 유효 |

## DEC-1 — 보고는 읽기만 한다. **조언이지 증거가 아니다**

- 입력: 원장 행 + 라운드 verdict(**워킹트리**). 출력: 문자열. state·원장·매니페스트에 **아무것도 쓰지 않는다**.
- 🔴 `archive_inventory` 에 **기대지 않는다** — 승인 시점에만 생기므로 hardCap 상황에는 항상 없다.
  아카이브는 `expectedArchivePaths` 와 같은 이름 규칙으로 디렉터리에서 찾는다.
- 🔴 출력 머리에 **"조언(감사 증거 아님)"** 임을 밝힌다. 승인·커밋·병합 어느 판정도 이 문자열을 읽지 않는다.
- 🔴 LLM 을 부르지 않는다.

## DEC-2 — 비수렴의 신호는 **반복된 축**이다

라운드가 8번 돌았다는 사실은 정보가 아니다. 정보는 **같은 것이 계속 걸렸는가**다.

```ts
export interface RepeatedAxis {
  kind: 'file' | 'topic'
  key: string
  /** 이 축이 등장한 라운드 번호(오름차순·중복 없음). */
  rounds: number[]
}
```

- **2라운드 이상** 등장한 축만 담는다. 1회는 반복이 아니다.
- 정렬: `rounds.length` 내림차순 → `key` 오름차순(**결정론**).
- `topic` 키는 `detail` 앞 60자를 정규화(연속 공백 1칸·소문자화). 🔴 의미 유사도를 흉내 내지 않는다 —
  그러면 결정론과 설명 가능성을 둘 다 잃는다. 같은 문장으로 반복되는 경우만 잡으면 충분하다.

## DEC-3 — 분해안은 **관측에서만** 나온다. 네 갈래다

| 관측 | 무엇을 말하는가 |
|---|---|
| 분석 가능한 라운드가 **0개** | 🔴 "**분석할 자료가 없다**" — 아카이브가 없거나 전부 파손. 분해안을 내지 **않는다** |
| 반복 축 **0개**(자료는 있음) | "매 라운드 지적이 달랐다" — 범위가 넓다는 신호. 라운드별 파일 수를 근거로 |
| 반복 축 **1개** | "그 축 하나가 미해결이다" — 나눌 것이 없다. 분할을 권하지 않는다 |
| 반복 축 **2개 이상** | 축별로 나누라고 제안하고 각 축의 라운드를 근거로 |

🔴 **첫 줄이 REQ-2026-144 r06 P1 이다.** 초안은 "자료 없음"과 "매번 달랐다"를 한 갈래로 묶어,
아무것도 관측하지 못한 상태에서 "범위가 넓다"고 **단정**했다. 관측에서만 나온다는 계약 위반이다.

## DEC-4 — 선택지는 **지금 이 상태에서 성공하는 명령**

REQ-2026-144 가 6라운드에 걸쳐 깎아 낸 형태다. 구조는 **선행 정리(조건부) + 갈래 2개**.

```text
[선행] 열린 회차가 남아 있을 때만
  npx commitgate req:review-exception REQ-2026-147 --close-stale "design:-#1" --reason "…" --run

[갈래 A] 이 REQ 를 버린다
  npx commitgate req:close REQ-2026-147 --abandon --reason "…" --confirm "…" --run

[갈래 B] 대체 REQ 로 잇는다 (순서대로)
  npx commitgate req:review-exception REQ-2026-147 --resolve replace --series "design:-#1" --reason "…" --confirm "…" --run
  git add -- "workflow/REQ-2026-147"                        ← 티켓이 더러울 때만(두 줄)
  git commit -m "chore(REQ-2026-147): 설계 파킹"
  npx commitgate req:new hardcap-... --successor-of REQ-2026-147 --run
```

🔴 **가운데 줄이 설계 r01·r02 P1 이다.** hardCap 시점 워킹트리는 **보통 더럽다**(미승인 변경 +
needs-fix 아카이브). `--resolve` 는 자기가 바꾼 `state.json` 만 커밋하므로(REQ-2026-145 DEC-3b —
남의 staged 파일을 커밋하면 코드·비밀이 딸려 들어간다) 그다음 `req:new` 가 clean-worktree 검사에 막힌다.

🔴 **`git commit -m` 만으로는 부족하다**(r02 P1). 그것은 **이미 staged 인 것만** 커밋하는데,
needs-fix 아카이브는 **untracked** 로 남는다. 그래서 **티켓 디렉터리를 명시 stage** 한다.

- `git add -- "<티켓 디렉터리>"` — 🔴 **`git add -A` 가 아니다.** 무엇이 더러운지 모르는 채 전부 담으면
  코드·비밀이 딸려 들어간다(이 저장소가 `-A` 를 금지하는 이유). 경로는 **따옴표로 감싼다**
  (`ticketRoot` 에 공백·한글이 있으면 인자가 쪼개진다).
- 🔴 **파킹은 두 줄이다**(설계 r02 P1). 한 줄로 잇는 구분자가 **모든 셸에 없다** — PowerShell 5.1 은
  `&&` 를 모르고 cmd.exe 는 `;` 를 명령 구분자로 쓰지 않는다. "붙여넣으면 실행된다"를 지키려면
  줄을 나누는 수밖에 없다.
- 파킹 줄은 **티켓이 더러울 때만** 낸다 — `ticketDirty` 를 입력으로 받는다.
- 🔴 **티켓 밖에 더러운 것이 있으면** 그 경로들을 **데이터로 열거**하고, 그것까지 정리해야 `req:new` 가
  된다고 말한다. 명령으로 만들지 않는다 — 그 파일들이 무엇인지 도구는 모른다(REQ-2026-145 DEC-3b 와 동형).
- 파킹 줄은 **비-CommitGate 명령**이라 `npx commitgate … --run` 형식 검사에서 제외된다(REQ-2026-145 r02).

- 🔴 `--close-stale` 은 **열린 attempt 가 실제로 있을 때만** 낸다. hardCap 상태에선 보통 다 닫혀 있고,
  없는데 안내하면 그 명령이 실패한다.
- 🔴 REQ id·series id·slug 는 **실제 값**을 박는다. 사람이 채울 자리는 **따옴표 안**의 사유·승인 문장뿐.
- 🔴 **꺾쇠 금지**(PowerShell 리디렉션). slug 는 `successorSlug`(REQ-2026-145)로 **산출**한다.
- 🔴 **`hardCap` 을 올리라는 선택지를 넣지 않는다.** 목록에 있으면 그게 기본 답이 된다.
- 🔴 갈래 B 는 **네 줄**(티켓이 깨끗하면 두 줄)이다. 줄을 줄이려고 실행에 필요한 단계를 빼면
  그 갈래가 실행 불가가 된다 — 이 REQ 가 고치려는 결함과 같은 모양이다.

## DEC-5 — 반복 출력은 억제하지 않고 **길이로 묶는다**

억제 상태를 만들지 않는다(플래그는 지워지면 거짓말이 되고, 지우는 경로가 또 하나의 표면이다).

| 항목 | 상한 |
|---|---|
| 라운드 요약 | **1줄**(`r01 needs-fix · r02 needs-fix · …`) |
| 반복 축 | 상위 **3개** |
| 갈래 | **2개** + 선행 정리 최대 1줄 |
| 명령 줄 | **6줄 이하**(선행 1 + A 1 + B 4 — 파킹이 두 줄) |

🔴 상한을 **갈래 수**로 잡고 줄 수는 그 결과로 둔다. 갈래를 줄이려고 실행에 필요한 줄을 빼면
그 갈래가 실행 불가가 된다(REQ-2026-144 r03·r04 P1).

## DEC-5a — 워킹트리 판독은 **`-z`** 다(설계 r02 P1)

`git status --porcelain` 단독은 공백·비ASCII 경로를 **C-quote** 한다(`"workflow/í°…"`).
손으로 자르면 **티켓 경로가 티켓 밖으로 오분류**되고, 그러면 파킹 줄이 빠져 다음 `req:new` 가 막힌다.
이 저장소가 이미 쓰는 `STATUS_Z_ARGS` + `parseStatusZ` 를 그대로 쓴다 — 새 파서를 만들지 않는다.

## DEC-6 — 보고가 차단을 흔들 수 없다

- 보고 생성 전체를 `try` 로 감싸고, 실패하면 **원래 한 줄 메시지**로 떨어진다.
- 🔴 부수 기능이 주 기능을 이길 수 없다. 보고를 만들다 죽어서 차단이 사라지면 게이트 붕괴다.
- 파손된 라운드 하나는 **그 라운드만 건너뛰고** 나머지로 만든다(전부 버리지 않는다).

## Phase 분해

| phase | 범위 |
|---|---|
| `phase-1-nonconvergence-analyzer` | `lib/nonconvergence.ts` — 반복 축·네 갈래 분해안·상태 기반 선택지·상한(전부 순수) |
| `phase-2-hardcap-report-wiring` | `hard-blocked` 분기 배선 · 실패 시 원문 fallback · 문서 · CHANGELOG |

## 변경 파일

`scripts/req/lib/nonconvergence.ts`(신규) · `scripts/req/review-codex.ts` · 테스트 ·
`docs/workflow.md`·`docs/workflow.en.md` · `CHANGELOG.md`

## 안전

- `hardCap` 판정(`checkReviewBudget`·`budgetCounts`)은 **무변경**. 이 REQ 는 그 뒤에 붙는 출력만 바꾼다.
- 🔴 무회귀 오라클: 보고 생성이 어떤 이유로든 실패해도 `hard-blocked` 는 **여전히 throw** 한다.
