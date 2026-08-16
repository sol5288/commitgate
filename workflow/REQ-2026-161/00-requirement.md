# REQ-2026-161 요구사항

## 무엇

1. 설치본의 `req:*` **명령 표면**이 설치된 패키지의 verb 표면보다 좁으면 진단이 그 사실을 말하고
   해소 명령을 안내한다.
2. 그 상태를 되돌릴 **좁은 복구 경로**를 제공한다.
3. `commitgate delivery` 묶음이 `stopGate: "auto"` 에서도 동작한다는 사실을 정본 문서와 help 에 적는다.

## 왜

### 갭 1 — 명령 표면 skew 가 어디에도 보이지 않는다

새 verb 가 릴리스에 추가돼도 **기존 설치본은 문서화된 업그레이드 절차를 그대로 따라서는 그 verb 를
얻지 못한다.** 그리고 그 사실을 말하는 진단이 없다.

실측(0.23.1 설치본 2곳 — `45_MBTI_kiosk` · `23_blomi_blog`):

| 층 | 출력 | 실제 |
|---|---|---|
| `commitgate check` | C1~C5 **PASS** | `req:delegate`·`req:repolicy` 부재 |
| `req:doctor` | `OK D19: 설치 모드: Stage B` | D19 는 5개 키(`REQ_SCRIPT_KEYS`)의 **값 형태**만 본다 — 키 **집합**은 시야 밖 |
| `commitgate sync` | `변경 없음 — 이미 동기화되어 있습니다` | 설계상 `package.json` 미접촉(`docs/upgrade.md` §"sync는 스키마 축만") |
| `commitgate migrate` | 해당 없음 | 값이 **옛 주입값인 키만 변환**한다 — 부재 키를 추가하지 않는다 |

`docs/upgrade.md` 의 요약 절차는 `설치 → sync --apply → quickstart --apply → (필요 시) migrate` 이고
**`init` 재실행이 없다.** 그래서 절차를 정확히 따른 사용자도 이 상태에 도달한다.

드러나는 방식이 문제다 — 진단이 아니라 **실행 실패**로만 드러난다. `req:next` 가 통합 통제점에서
정확히 이 명령을 렌더링하는데:

```
승인 후 실행: $ pnpm req:delegate --scope ticket:REQ-2026-242 --source "…" --sentence "…" --run
```

실행하면:

```
ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL  Command "req:delegate" not found
Did you mean "pnpm req:close"?
```

즉 **사람 승인을 받은 직후, 통제점을 통과시키는 바로 그 명령이 실패한다.** 사용자는 도구가 시킨 것을
그대로 했는데 막히고, 어떤 진단도 왜인지 말해 주지 않는다.

이것은 REQ-2026-038(vendored asset skew)과 **동종이되 축이 다르다** — 그쪽은 파일 자산, 이쪽은
**명령 표면**이다. 그때 D20 을 만든 이유가 여기서 그대로 반복됐다.

### 갭 2 — `delivery` × `auto` 조합이 문서에 없다

`bin/delivery.ts` 의 help 와 `docs/workflow.md` · `docs/workflow.en.md` 는 묶음을 **`stopGate: "merge"`
전용**인 것처럼 서술한다. 실제로는 `defersToIntegration`(`'merge' | 'auto'`)이 두 값을 함께 덮고,
`bin/integrate.ts` 는 `delivery:<slug>` scope 위임을 정식으로 처리한다(`AutoFacts.deliveryMembers` ·
멤버별 `effectiveStopGate` 해소).

그래서 **정지 횟수를 가장 크게 줄이는 조합**(`auto` + 묶음 = 묶음당 `seal`·`approve`·위임 3회 고정,
티켓 수와 무관)이 문서 어디에도 없다. `auto` 사용자는 묶음을 쓸 이유를 알 수 없고, 묶음 사용자는
`merge` 로 내려가야 하는 줄 안다.

## 제약

- 🔴 **`sync` 의 "package.json 미접촉" 기본 동작을 바꾸지 않는다.** 세 문서가 그 비목표를 명시한다.
  복구는 **opt-in 축**으로만 연다(`--persona` · `--gitignore` 와 같은 형태).
- 🔴 **D19 를 고치지 않는다.** D19 는 "설치 **모드**"(Stage A/B/mixed) 판정이고 이 건은 "표면 **집합**"이다.
  같은 체크에 두 질문을 섞으면 한쪽 답이 다른 쪽을 가린다(지금 `OK Stage B` 가 부재를 가린 것처럼).
- 🔴 **기존 사용자 값을 덮지 않는다.** 주입은 `init` 과 같은 insert-only 규칙(`if (!(k in scripts))`)이다.
- 🔴 **verb 목록을 손으로 적지 않는다.** SSOT 는 `bin/dispatch.mjs` 의 `VERB_MODULES` 다
  (`STAGE_B_REQ_VERBS` 가 이미 그렇게 파생된다). 새 verb 를 추가할 때 이 REQ 가 만든 코드를
  고칠 일이 없어야 한다.
- 진단은 **advisory(WARN 상한)** — 게이트를 깨지 않는다. 스크립트 부재로 기존 커밋 경로가 벽돌이
  되면 안 된다.

## 완료 기준

1. `req:*` 키 집합이 패키지 verb 표면보다 좁은 설치본에서 `commitgate check` 와 `req:doctor` 가
   **누락된 verb 이름**과 **해소 명령**을 출력한다(둘 다 WARN 상한).
2. 그 해소 명령이 실제로 누락분을 채우고, **기존 키는 한 글자도 바뀌지 않는다.**
3. dogfood/dev repo(패키지 루트 == 대상 루트)에서는 D20/D21 과 같은 기준으로 skip 한다.
4. `VERB_MODULES` 에 verb 를 추가하면 진단·복구가 **자동으로 따라간다**(하드코딩 목록 부재를
   회귀 가드가 고정한다).
5. `docs/workflow.md` · `docs/workflow.en.md` · `bin/delivery.ts` help 가 묶음의 `stopGate` 조건을
   `merge` 와 `auto` **둘 다**로 적고, `docs/upgrade.md`(한/영)의 업그레이드 절차가 명령 표면 축을
   포함한다.
6. 변경한 소스를 import 하는 테스트 그린 · 통합 직전 전체 스위트 1회 그린.

## 비목표

- `sync` 기본 동작 확장(플래그 없이 package.json 을 건드리는 것).
- `init` 재실행 경로의 개선 — 이 REQ 는 좁은 축 하나만 연다.
- delivery 워크플로 자체의 기능 변경(문서·help 서술만 다룬다).
- 소비자 프로젝트(`44_meallo` · `45_MBTI_kiosk` · `23_blomi_blog`)의 직접 수정 — 그쪽은 이 릴리스를
  설치하면 해소된다.
