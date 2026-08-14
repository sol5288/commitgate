# REQ-2026-148 설계

## DEC-1 — 예약 placeholder 등록부 (결함 1)

도구가 보고에 박는 문자열(`"승인 문장"`·`"왜 대체하는가"`·`"왜 버리는가"`)을 **예약어**로 등록하고,
사람 결정을 받는 자리에서 **거부**한다.

```ts
// lib/placeholders.ts (신규, leaf)
export const RESERVED_HUMAN_PLACEHOLDERS: readonly string[] = ['승인 문장', '왜 대체하는가', '왜 버리는가', …]
export function isReservedPlaceholder(v: string): boolean
```

- 비교는 **정규화 후**다(연속 공백 1칸·앞뒤 trim·소문자화). `"  승인  문장 "` 도 걸린다.
- 🔴 **보고와 검증이 같은 등록부를 쓴다.** 보고가 문자열을 바꾸면 검증도 따라 바뀐다 — 두 벌이면
  갈라지는 순간 구멍이 다시 열린다. 보고는 등록부 값을 **참조해서** 렌더링한다.
- 적용 지점: **보고가 만들어 내는 모든 사람-결정 인자**다(설계 r01 P1 — 초안이 `--abandon` 을 뺐는데,
  보고의 `[A]` 갈래가 바로 `req:close … --abandon --reason "왜 버리는가" --confirm "승인 문장" --run` 을
  낸다. 그 verb 도 trim 만 보므로 원문 실행이 그대로 종결한다).

🔴 **표는 "보고"가 아니라 "도구가 내는 모든 안내"를 덮어야 한다**(설계 r07 P1 — 초안이
`req:next` 의 `req:confirm` 안내를 빠뜨렸다. 그 줄은 `--method "<승인 문장>"` 을 그대로 실행 가능하게
내고 `req:confirm` 은 비어 있지 않음만 본다 — 같은 고리다).

| 안내를 내는 곳 | verb | 인자 |
|---|---|---|
| hardCap 보고 | `req:review-exception --resolve replace` | `--reason` · `--confirm` |
| hardCap 보고 | `req:close --abandon` | `--reason` · `--confirm` |
| hardCap 보고 | `req:review-exception --close-stale` | `--reason` |
| **`req:next`** | **`req:confirm`** | **`--method`** |

예약 목록에는 `"<승인 문장>"`(꺾쇠 포함 형태)도 넣는다 — `req:next` 가 실제로 내는 문자열이다.

🔴 **기준은 "보고가 그 값을 출력하는가"다.** 보고가 내지 않는 인자는 넓히지 않는다 — 이 REQ 는
도구가 **자기 출력을 자기가 되받는** 고리만 끊는다.

🔴 **거부는 무조건이다 — 입력 출처를 구별하지 않는다.** 도구가 낸 값인지 사람이 친 값인지
기술적으로 구별할 방법이 없기 때문이다(설계 r03 P1: 초안의 "손으로 치면 통과한다"는 구현 불가능한
계약이었다). 예약 문자열은 **누가 넣든** 거부한다.

🔴 **무엇을 주장하지 않는가**: 값의 **진정성**은 판정하지 않는다. `--confirm "x"` 는 통과한다.
이 REQ 는 **도구가 자기 출력을 자기가 되받는 고리**만 끊는다. 그 이상을 주장하면 거짓이다.

🔴 **왜 무조건 거부해도 안전한가**: 예약값은 `"승인 문장"`·`"왜 대체하는가"` 같은 **도구가 만든
범용 라벨**이다. 실제 사람의 결정 기록이 정확히 그 문자열일 이유가 없고, 만약 그렇게 쓰고 싶다면
거부 메시지가 **무엇이 문제이고 무엇을 쓰라는지** 알려 준다.

- 보고에는 "이 값을 **바꿔서** 실행하십시오"라는 한 줄을 붙인다. 값이 자리표시자임을 명시한다.

## DEC-2 — 파킹 커밋에 pathspec 을 붙인다 (결함 2)

```diff
- git commit -m "chore(REQ-…): 설계 파킹"
+ git commit -m "chore(REQ-…): 설계 파킹" -- "workflow/REQ-…"
```

- 🔴 `git add -- <티켓>` 만으로는 부족하다. **이미 staged 인 티켓 밖 파일**은 그대로 인덱스에 있고
  pathspec 없는 `git commit` 이 전부 싣는다. `git add -A` 를 피한 것이 소용없어진다.
- `git commit -- <pathspec>` 은 인덱스가 아니라 **작업 트리의 그 경로**를 커밋한다. 티켓 밖 staged
  변경은 **인덱스에 그대로 남는다** — 요구사항 2가 원하는 그대로다.
- 같은 수정을 `req-review-exception.ts` 의 `runResolve` 안내에도 적용한다(같은 형태의 위험).
- 🔴 `ticketRel` 이 셸에 안전하게 렌더링되지 않으면 **명령을 만들지 않고** 경로를 데이터로 보여 준다.

## DEC-3 — (분리) checkpoint 복구의 증거 귀속 → **후속 REQ**

외부 리뷰가 지적한 결함 3(완료 티켓에서 임의 state 수정이 D10 예외로 커밋될 수 있음)은 **이 REQ 에서
빼고 후속 REQ 로 옮긴다**.

🔴 **왜 분리하는가**: 설계 리뷰 7라운드 중 r02~r05 의 P1 이 **전부 이 결정 하나**에서 나왔다.
판별자를 세 번 바꿨고(워킹 대비 → HEAD state 필드 → HEAD 매니페스트 vs HEAD state) 매번 실제 커밋
순서와 어긋났다 — phase 승인 state 가 HEAD 에 남지 않는다는 사실이 판정 공간을 좁게 만든다.
같은 REQ 에 있는 나머지 네 건은 r02 이후 P1 이 없었다. **묶여 있어서 같이 못 나가고 있다.**

이 저장소의 규범(설계 리뷰 상한 5 · REQ-2026-015/016/017/026/032/144 선례)대로 분할한다.

후속 REQ 가 이어받을 것:
- 결함 3 자체(완료 티켓 임의 수정 차단)
- 기각된 판별자 3종과 **기각 사유**(위조 가능한 워킹 값 / HEAD 에 없는 상태 / 첫 소비와 옛 스키마 구별)
- 정상 crash window 무회귀가 첫 오라클이라는 제약
- 🔴 **첫 phase 의 첫 소비**와 **소비 이력 없는 옛 스키마**를 durable 근거로 구별해야 한다는 미해결 문제

그때까지 결함 3 은 **남아 있다**. 이 REQ 가 고쳤다고 말하지 않는다.

## DEC-4 — 셸 안전 계약을 세 셸 공통으로 (결함 4)

```ts
// 현재: !/["`$\\\r\n]/
// 이후: 허용 목록으로 뒤집는다
const SAFE_ARG_RE = /^[A-Za-z0-9._\/@+=:#-]+$/
```

- 🔴 **금지 목록이 아니라 허용 목록이다.** 셸마다 특수문자가 다르고(cmd.exe 는 큰따옴표 안에서도
  `%VAR%` 를 확장한다), 금지 목록은 새 셸·새 문자가 나올 때마다 뚫린다. 허용 목록은 **모르는 문자를
  기본 거부**한다.
- 이 집합은 정상 branch 이름(`feat/req-2026-148-guidance-safety-and-attribution`)·REQ id·티켓 경로·
  **series_id** 를 전부 담는다.
- 🔴 **`#` 을 반드시 넣는다**(설계 r05 P1). 모든 `series_id` 는 `…#<seq>` 형태(`design:-#1`)라,
  빼면 `--close-stale`·`--resolve --series` 안내가 **정상 상태에서 통째로 사라진다** — "실행 가능한
  명령을 안내한다"는 요구를 정면으로 어긴다. `#` 은 큰따옴표 안에서 bash·PowerShell·cmd.exe 셋 다
  리터럴이다(주석 시작이 되지 않는다).
- 공백은 **담지 않는다** — 담으려면 인용 규칙이 셸마다 갈린다. 공백이 든 `ticketRoot` 는 명령 대신
  데이터로 안내한다(문서화된 제약).
- 🔴 실측 정정: `^` 는 git 이 ref 로 거부하므로 branch 로는 도달하지 않는다. 그래도 허용 목록에
  없으므로 **자동으로** 막힌다 — 목록 방식의 이점이다.
- 안전하지 않으면 `command` 를 내지 않고 값을 데이터로 보여 준다(기존 계약).
- 🔴 **적용 지점을 하나로 모은다**: `req-next.ts`·`nonconvergence.ts`·`req-review-exception`(`runResolve`)
  가 각자 판정하면 갈라진다. `lib/shell-safe.ts`(신규 leaf)로 내리고 **전부** 그것을 쓴다.
- 🔴 **명령에 박히는 모든 파생값**에 적용한다(설계 r04 P1). 초안은 branch·REQ id·티켓 경로만 봤는데,
  `successorSlug` 는 **branch 에서 파생**되므로 `feat/req-…-%PATH%` 는 `%PATH%-successor` 가 되어
  `req:new` 줄이 cmd.exe 에서 확장된다. 값이 어디서 왔든 **렌더링 직전에** 검사한다.
- 🔴 안전하지 않은 값이 하나라도 있으면 **그 갈래의 명령을 만들지 않고** 값을 데이터로 보여 준다.

## DEC-5 — replace 는 **지정한 series_id 만** 닫는다 (결함 5)

`closeSeriesHumanResolution(state, kind, phaseId, resolution)` 은 `(kind, phase)` 의 첫 열린 record 를
닫는다. 같은 키에 열린 series 가 둘이면 **지정하지 않은 것이 닫힌다**.

- `closeSeriesHumanResolutionById(state, seriesId, resolution)` 를 추가하고 `runResolve` 가 그것을 쓴다.
- 🔴 **기존 함수는 지우지 않는다** — 다른 호출부·테스트가 있고, 이 REQ 는 replace 경로만 다룬다.
  다만 새 함수가 정본임을 주석으로 못 박는다.
- 없는 `series_id`·이미 닫힌 것은 종전대로 거부(순수 판정이 이미 한다).
- 🔴 `#` 이 든 phase id 원문 대조는 유지한다.

## Phase 분해

| phase | 범위 |
|---|---|
| `phase-1-placeholder-and-shell-safe` | DEC-1 등록부 + DEC-4 허용 목록(둘 다 신규 leaf) · 배선 **세 곳**: `req-review-exception`(`--resolve`·`--close-stale`) · **`req-close`(`--abandon`)** · `req-next`/`nonconvergence`(셸 판정) |
| `phase-2-pathspec-and-series-binding` | DEC-2 파킹 pathspec + DEC-5 series 결속 · 실 git e2e |

## 변경 파일

`scripts/req/lib/placeholders.ts`(신규) · `scripts/req/lib/shell-safe.ts`(신규) ·
`scripts/req/lib/nonconvergence.ts` ·
`scripts/req/req-review-exception.ts` · **`scripts/req/req-close.ts`**(설계 r02 P1 — DEC-1 표에
`--abandon` 을 넣고도 변경 파일에서 빠져 있었다) · `scripts/req/req-next.ts` ·
`scripts/req/review-codex.ts` · 테스트 · `CHANGELOG.md`

## 안전

- 🔴 **`evidence-recovery.ts` 는 이 REQ 에서 건드리지 않는다**(DEC-3 분리). REQ-2026-142 가 연
  정상 복구 경로는 그대로다.
- `hardCap`·HIGH·BLOCKED·예산 판정은 무변경.
- 🔴 **과장 금지**: DEC-1 은 "사람 검증"이 아니다. 문서·CHANGELOG 도 그렇게 쓰지 않는다.
