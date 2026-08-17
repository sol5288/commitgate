# REQ-2026-167 설계

## 문제

문서를 그대로 따라가도 업그레이드가 **끝나지 않은 채로 끝난 줄 안다**. 실측에서 드러난 구멍 다섯:

| # | 구멍 | 현행 문서 |
|---|---|---|
| ① | 폐기 서술이 여러 자리에 있는데 한 번이면 끝나는 것처럼 적힘 | *"그것만 손으로 병합하세요"* |
| ② | 인용 문장을 그대로 `grep` 하면 안 잡힘(정규화) | 언급 없음 |
| ③ | 언제 끝났는지가 없음 | "정리" 한 줄에 `check` 가 **맨 뒤** |
| ④ | README 요약 한 줄로는 안 끝남 | `sync --apply --scripts --gitignore` 하나 |
| ⑤ | 어느 진단에도 안 걸리는 자산(companion) | 언급 없음 |

## DEC-1 — 절차를 **마커로 감싼 단일 정본**으로 둔다

`docs/upgrade.md` · `docs/upgrade.en.md` 에 `<!-- commitgate:upgrade-procedure -->` 구역을 만들고
그 안에 **순서가 있는 절차**를 둔다. 지금 절차는 문서 여기저기(②의 `sync` 설명, ④의 `quickstart` 설명,
"정리" 한 줄)에 흩어져 있고 그래서 어긋났다.

구역이 담는 것:

1. **진단 먼저** — `npx commitgate check`. 무엇을 실행할지는 축마다 다르고 그것을 아는 것은 도구다.
2. **도구가 고치는 축** — `sync --apply --scripts --gitignore` · `quickstart --apply`.
3. **도구가 고치지 않는 축(`contract-claims`)** — 🔴 **`check` 가 조용해질 때까지 반복**.
4. **도구가 보지 않는 축** — companion 자산 대조(아래 DEC-1b 가 계약을 정한다).
5. **수용 기준** — `C7` 조치 0. `caret-range` 의 "사람 확인"은 남아도 된다.

### DEC-1b — companion 자산 대조는 **경로 쌍**으로 못 박는다 (⑤ · design r01 P1-b)

"대조하라"만 적으면 무엇을 무엇과 비교하는지 사람마다 다르다. 실측으로 확인한 쌍을 **등록부에 두고**
문서가 그것을 그대로 싣는다.

| 소비 프로젝트 | 설치된 패키지 |
|---|---|
| `.claude/skills/` | `node_modules/commitgate/skills/` |
| `.claude/commands/req.md` | `node_modules/commitgate/templates/claude-command.md` |
| `.claude/skills/commitgate/SKILL.md` | `node_modules/commitgate/templates/claude-skill.md` |
| `.cursor/rules/commitgate.mdc` | `node_modules/commitgate/templates/cursor-rule.mdc` |

🔴 **정상인 비대칭 둘을 함께 적는다** — 적지 않으면 사람이 이것을 결함으로 읽는다(실측):

```
$ diff -rq .claude/skills node_modules/commitgate/skills
Only in node_modules/commitgate/skills: ATTRIBUTION.md      ← 패키지에만 있는 것이 정상
Only in .claude/skills: commitgate                          ← templates/claude-skill.md 에서 온 것이 정상
```

🔴 **`req.config.json` 은 대조 대상이 아니다.** 사용자 소유 설정이라 `req.config.json.sample` 과 다른
것이 정상이다(실측에서도 다르다). 새 설정 축은 **버전별 절**에서 알린다.

🔴 **직접 수정한 스킬은 그대로 둔다.** 이 대조는 "무엇이 달라졌는지 알라"는 것이지 "덮어써라"가 아니다.
도구가 이 축을 고치지 않는 이유와 같다.

### 검색 함정을 근거와 함께 적는다 (②)

*"인용된 문장을 그대로 `grep` 하면 안 잡힐 수 있다 — 대조 전에 강조·코드 표시 문자가 제거되기
때문이다(`normalizeForClaimScan`). 강조 문자가 없는 짧은 조각으로 찾아라."*

🔴 **함수 이름을 문서에 적는 이유**: 그래야 가드가 **언어와 무관하게** 이 서술의 존재를 고정할 수 있고,
동시에 **그 함수가 실재하는지**까지 검사할 수 있다. 죽은 심볼을 가리키는 문서를 만들지 않는다.

### 왜 문구 전체를 고정하지 않는가

한/영 두 벌이고 산문은 다듬어야 한다. 문구를 통째로 고정하면 사소한 수정마다 red 가 되어 사람이 가드를
끈다(REQ-2026-164 가 같은 결론). 고정하는 것은 **명령 · 순서 · 근거 심볼** 뿐이다.

## DEC-2 — README 의 진입점을 **진단**으로 바꾼다 (④)

`UPGRADE_SUMMARY_COMMAND` 를 `npx commitgate sync --apply --scripts --gitignore` 에서
**`npx commitgate check`** 로 바꾼다.

- 실측에서 그 한 줄만으로는 `managed-blocks`·`contract-claims` 가 남았다. **README 가 완결된 절차를
  보여 주는 척하면 안 된다** — 남은 축이 있다는 사실 자체를 `check` 가 말해 준다.
- README 구역의 계약(`npx commitgate` 명령이 **정확히 하나**)은 **그대로 둔다**. 바뀌는 것은 그 하나가
  무엇이냐다. 절차를 README 에 복제하지 않는다는 원래 취지가 오히려 강해진다.
- `npm i -D commitgate@<version>` 은 `npx commitgate` 명령이 아니므로 계약에 걸리지 않는다(현행 동일).

### 대안과 기각

| 안 | 기각 사유 |
|---|---|
| README 에 명령 두세 개를 나열 | 정본 문서와 **절차가 두 벌**이 된다 — 지금 어긋난 원인이 그것이다 |
| 상수를 배열로 바꿔 여러 명령 허용 | 같은 이유. REQ-2026-164 phase-2 에서 이미 기각된 방향이다 |
| 요약 명령을 없애고 링크만 | 무엇으로 시작하는지조차 안 보인다 — 진입점 하나는 있어야 한다 |

## DEC-3 — 버전별 절에 `0.23.1 → 0.25.x` 를 더한다

지나온 버전 절은 지우지 않는 것이 이 문서의 규칙이다. 0.24·0.25 절이 비어 있어 **그 구간에서 올라오는
사람에게는 안내가 없다**. 짧게 더한다 — `check` 가 8축을 집계하게 된 것(0.25.0), 설치가 아닌 곳의 거짓
조치와 `req:*` 사용법(0.25.1).

## DEC-4 — 리뷰어 출력 스키마의 안내 공백을 닫는다 (구현 중 실측)

이 REQ 의 phase-3 리뷰가 **자기모순 응답 3회**로 `BLOCKED` 됐다(`--fresh-thread` 회복 포함).

```
status = STEP_COMPLETE
merge_ready = yes      → 모순: merge_ready=yes 인데 status≠COMPLETE  (review-codex.ts:652)
```

원인은 판정이 아니라 **안내**다. `workflow/machine.schema.json` 의 필드별 `description` 실측:

```
commit_approved   desc      ← 모순 규칙까지 상세히 적혀 있다
merge_ready       NO-DESC   ← 🔴 교차 규칙이 어디에도 전달되지 않는다
```

교차 규칙은 `docs/ssot-design/03-domain-and-data-model.md:137` 에 있지만 **리뷰어가 받는 스키마에는 없다**.
그래서 REQ 의 **마지막 phase** 에서 리뷰어가 "이제 병합 가능"이라 판단하면 필연적으로 거부된다 —
무작위가 아니라 마지막 phase 마다 재현되는 구조다.

**무엇을 한다**: `merge_ready` 에 `description` 을 넣는다. 담을 것은 (a) 이 필드가 묻는 것은 *이 리뷰의
통과 여부가 아니라 **티켓 전체의 병합 준비***라는 것, (b) `yes` 는 `status="COMPLETE"` +
`commit_approved="yes"` 일 때만 유효하다는 것, (c) **마지막 phase 여도** `STEP_COMPLETE` 면 `no` 라는 것 —
통합은 이 리뷰가 결정하지 않는 별개 통제점이다.

🔴 **검증 규칙은 손대지 않는다.** 게이트는 옳게 거부했다. 바뀌는 것은 규칙이 **전달되는가**뿐이다.

🔴 **왜 이 REQ 안에서 고치는가**: `req:review-exception` 은 **예산 소진** 전용이라 이 상태에 열리지 않는다
(실측: *"아직 예외 불요(판정 회차 0 < autoBudget 5)"* — 무효 응답은 판정 회차로 세지 않는다).
즉 이 phase 를 통과시킬 다른 경로가 없다. 근본 원인이 한 줄이고, 고치면 막힌 자리가 그대로 열린다.

## 가드

`lib/upgrade-axes` 에 등록부를 둔다(문서가 정본을 참조하게 — 손으로 두 벌 적지 않는다).

```ts
export const PROCEDURE_MARKER = { open: '<!-- commitgate:upgrade-procedure -->', close: '…' }
export const PROCEDURE_STEPS: readonly string[]        // 구역에 이 순서로 나와야 하는 명령
                                                       // 🔴 첫 항목과 **마지막 항목**이 둘 다 `check` 다
export const PROCEDURE_ANCHORS = {                     // 블록을 여는 언어 독립 앵커
  repeat:     '<!-- procedure:repeat -->',
  search:     '<!-- procedure:search -->',
  acceptance: '<!-- procedure:acceptance -->',
  companion:  '<!-- procedure:companion -->',
}
/** 🔴 **규범 문장** — 문서가 이것을 **글자 그대로** 실어야 한다(앵커별 1개 이상, ko/en 각각). */
export const PROCEDURE_ASSERTIONS: Record<ProcedureAnchor, { ko: readonly string[]; en: readonly string[] }>
export const COMPANION_PAIRS: readonly { consumer: string; packaged: string }[]
export const CLAIM_SCAN_FN = 'normalizeForClaimScan'
```

🔴 **왜 앵커 + 규범 문장 둘 다인가**(design r01·r02 P1-a).

- **앵커만으로는 부족하다.** 앵커 뒤 블록에 `C5`·`C7` 같은 토큰만 요구하면, *"`C5` 를 확인하고 `check`
  를 다시 실행"* · *"`C7` 을 확인"* 처럼 **종료 조건과 수용 기준이 빠진 문장**으로 바꿔도 통과한다(r02 P1).
  그러면 첫 병합 뒤 조치가 남은 사용자가 다시 완료로 오인한다 — 이 REQ 가 고치려는 바로 그 상태다.
- **문서 문구 전체를 고정할 수도 없다.** 한/영 두 벌의 산문이라 사소한 수정마다 red 가 되면 사람이
  가드를 끈다.

그래서 **한 문장만** 고정한다. 각 앵커에는 **규범 문장**이 하나 있고(`PROCEDURE_ASSERTIONS`, 언어별),
문서는 그것을 **글자 그대로** 싣는다. 정본은 등록부 하나이므로 두 벌이 어긋날 자리가 없고, 나머지
설명 산문은 자유롭게 다듬을 수 있다. 문장을 바꾸려면 **등록부를 고쳐야 하고**, 그러면 두 언어가 함께
바뀐다.

규범 문장 — **ko·en 둘 다 여기서 확정한다**(design r04 P1: 한쪽만 정하면 다른 언어 문서가 종료 조건
없이 등록돼도 가드가 통과한다):

| 앵커 | ko | en |
|---|---|---|
| `repeat` | `C5` 가 아무것도 지적하지 않을 때까지 이 과정을 **반복합니다** — 한 번 고치고 끝내지 마십시오. | \*\*Repeat\*\* this until `C5` reports nothing — do not stop after a single fix. |
| `search` | 인용된 문장을 **그대로 검색하면 찾지 못할 수 있습니다** — 강조·코드 표시 문자를 뺀 짧은 조각으로 찾으십시오. | \*\*Searching for the quoted sentence verbatim may find nothing\*\* — search for a short fragment with the emphasis/code characters removed. |
| `acceptance` | `C7` 의 **조치가 0** 이면 끝입니다(`caret-range` 의 "사람 확인"은 남아도 됩니다). | You are done when `C7` reports \*\*0 actions\*\* (the `caret-range` "human check" may remain). |
| `companion` | 이 축은 `check` 도 `sync` 도 보지 않습니다 — **직접 대조**해야 합니다. | Neither `check` nor `sync` looks at this axis — you must \*\*compare it yourself\*\*. |
| `companion` (2) | 직접 수정한 파일은 **그대로 두십시오** — 이 대조는 무엇이 달라졌는지 알기 위한 것이지 덮어쓰기가 아닙니다. | Leave files you edited yourself \*\*as they are\*\* — this comparison tells you what changed; it is not an overwrite. |

🔴 **두 언어가 같은 것을 말해야 한다.** `repeat` 은 **종료 조건**(무엇이 조용해질 때까지), `acceptance` 는
**수용 기준**(조치 0 + 남아도 되는 축)을 각 언어에서 그대로 담는다. 한쪽을 "다시 실행하십시오" 같은
종료 조건 없는 문장으로 바꾸면 그 언어 문서를 따라간 사용자가 조치가 남은 상태를 완료로 오인한다.

| # | 무엇 | 왜 공허하지 않은가 |
|---|---|---|
| G1 | ko·en **둘 다** 마커 쌍을 갖고, 여는·닫는 마커가 문서당 **정확히 하나**다 | 낡은 두 번째 구역을 뒤에 붙이면 red — 사용자가 옛 절차를 따라 미완료를 완료로 읽는 경로 차단(r05 P1-b) |
| G2 | 구역이 `PROCEDURE_STEPS` 를 **그 순서로** 담는다 | 명령을 빼거나 `check` 를 뒤로 미루면 red(③이 그 형태였다) |
| G2b | `PROCEDURE_STEPS` 의 **첫 항목과 마지막 항목이 둘 다 `npx commitgate check`** 이고, 마지막 것이 **companion 대조 뒤**에 온다 | 최종 확인을 지우거나 수정 前으로 옮기면 red(r05 P1-a) |
| G3 | 앵커 **4종**이 ko·en 구역에 있고, **각 앵커 뒤 블록**이 (a) 규범 문장을 글자 그대로, (b) 필수 토큰을 담는다 | 아래 — 종료 조건·수용 기준을 흐린 문장으로 바꾸면 red(r02 P1) |
| G4 | `CLAIM_SCAN_FN` 이 `lib/retired-claims` 에서 **실제로 export** 된다 | 죽은 심볼을 가리키는 문서 차단 |
| G5 | `COMPANION_PAIRS` 의 `packaged` 경로가 **이 저장소에 실재**하고 `package.json.files` 로 배포된다 | 소비자에게 **없는 경로**를 비교하라고 시키지 않는다 |
| G6 | README ko·en 구역의 `npx commitgate` 명령이 `UPGRADE_SUMMARY_COMMAND` **하나뿐** | 기존 계약 유지(문구만 갱신) |

### `PROCEDURE_STEPS` 의 **규범 값** (design r06 P1)

순서만 검사하면 등록부 자체를 줄여 가드를 비울 수 있다 — `['npx commitgate check', 'npx commitgate check']`
로 등록해도 G2·G2b 는 통과하고, 그 문서를 따라간 사용자는 **고치는 명령을 하나도 실행하지 않는다**.
그래서 값 자체를 못 박는다.

```
1. npx commitgate check                                     ← 진단
2. npx commitgate sync --apply --scripts --gitignore        ← 도구가 고치는 축
3. npx commitgate quickstart --apply                        ← 도구가 고치는 축
4. diff -rq .claude/skills node_modules/commitgate/skills   ← 도구가 보지 않는 축
5. npx commitgate check                                     ← 다시 물어 조치 0 확인
```

**G7 이 이 값을 그대로 검사한다**(배열 전체 동일성). 테스트가 등록부 값을 한 번 더 적는 것은 중복이
아니라 **의도한 카나리아**다 — 등록부를 줄이거나 순서를 바꾸면 red 다.

### G2b — 왜 마지막 `check` 를 따로 못 박는가 (design r05 P1-a)

첫 `check` 만 강제하면, 고치고 나서 **다시 묻지 않는** 문서가 통과한다. 그러면 조치가 남아 있어도
사용자는 명령을 다 쳤으니 끝났다고 읽는다 — 이 REQ 를 만든 상태 그대로다.

그래서 `PROCEDURE_STEPS` 의 **마지막 항목도 `npx commitgate check`** 로 둔다. 순서 검사는 커서를
전진시키며 보므로, 마지막 `check` 는 **companion 대조(`diff -rq …`) 뒤에 있는 또 다른 출현**이어야만
만족된다. `repeat` 블록 안의 `check` 로는 대신할 수 없다(그 자리는 companion 대조 앞이다).

### G3 — 앵커 뒤 블록이 담아야 하는 것

**(a) 규범 문장** — `PROCEDURE_ASSERTIONS[앵커][언어]` 를 **글자 그대로**. 이것이 종료 조건과 수용
기준을 지킨다.

**(b) 필수 토큰** — 규범 문장이 가리키는 대상이 그 블록 안에 실제로 있는지:

| 앵커 | 필수 토큰 |
|---|---|
| `repeat` | `C5` · `npx commitgate check` |
| `search` | `CLAIM_SCAN_FN`(=`normalizeForClaimScan`) |
| `acceptance` | `C7` · `caret-range` |
| `companion` | `COMPANION_PAIRS` 의 소비/패키지 경로 **전부** · `ATTRIBUTION.md` · `.claude/skills/commitgate` · `req.config.json` |

🔴 `companion` 의 토큰에 **정상 비대칭 둘이 모두** 들어간다(design r03 P1). `ATTRIBUTION.md`(패키지에만)
하나만 적으면, `diff -rq` 를 돌린 사람이 `.claude/skills/commitgate`(프로젝트에만)를 결함으로 읽는다.

블록 = 앵커 다음 줄부터 **다음 앵커 또는 구역 끝**까지. 토큰이 구역 어딘가에만 있으면 통과하는 느슨한
검사가 아니라 **그 앵커가 여는 블록 안**을 본다.

🔴 **등록부 자체도 검사한다** — 규범 문장이 비어 있거나 ko/en 한쪽이 없으면 red. 문장을 지워 가드를
무력화하는 경로를 막는다.

## 완료 기준 ↔ 가드 대응 (빠진 자리 없음)

| 완료 기준 | 지키는 가드 | 어떻게 |
|---|---|---|
| 진단 먼저 | **G2** | `PROCEDURE_STEPS` 순서 — `npx commitgate check` 가 첫 항목 |
| 반복까지가 절차 | **G3**/`repeat` | 규범 문장 + `C5` · `npx commitgate check` 토큰 |
| 검색 함정 | **G3**/`search` + **G4** | 규범 문장 + `normalizeForClaimScan` 토큰, 그리고 그 심볼의 실재 |
| 수용 기준 | **G3**/`acceptance` | 규범 문장 + `C7` · `caret-range` 토큰 |
| companion 확인 방법 | **G3**/`companion` + **G5** | 규범 문장 2개 + 경로 쌍·정상 비대칭 2종·`req.config.json` 토큰, 그리고 패키지 경로의 실재·배포 |
| ko/en 양쪽 | **G1** + 위 전부 | G1~G3 을 `[ko, en]` 두 문서에 **각각** 돌린다 |
| 절차가 **한 벌**이다 | **G1** | 마커가 문서당 정확히 하나 — 낡은 구역을 남겨 둘 수 없다 |
| 고친 뒤 **다시 묻는다** | **G2b** | 마지막 단계가 `check` 이고 companion 대조 뒤에 온다 |
| README 진입점 | **G6** | 구역의 `npx commitgate` 명령 == `UPGRADE_SUMMARY_COMMAND` 하나 |
| 등록부 자체의 건전성 | **G7** | 앵커별 규범 문장이 ko·en 둘 다 **비어 있지 않다**(문장을 지워 가드를 비우는 경로 차단) |

## Phase

| phase | 내용 |
|---|---|
| 1 | 등록부(`PROCEDURE_*`·`COMPANION_PAIRS`) + 정본 문서 ko/en 절차 구역 + 0.25.x 절 + G1~G5·G7 |
| 2 | README ko/en 진입점 정정(`UPGRADE_SUMMARY_COMMAND`) + G6 갱신 |
| 3 | **`machine.schema.json` 의 `status`·`merge_ready` description(DEC-4)** + 그 가드 + CHANGELOG · 버전 |

## 비목표

- 새 진단·새 축·새 명령(이 REQ 는 문서다).
- companion 자산 **동기화 기능** 추가 — 확인 방법만 적는다.
- `AGENTS.template.md` 본문 개정.
- 과거 버전 절 삭제.
