# REQ-2026-145 요구사항

## 무엇을

사람이 "이 REQ 는 대체하겠다"고 결정한 것을 **기록할 CLI 표면**을 연다.

```sh
npx commitgate req:review-exception REQ-2026-144 --resolve replace --series "design:-#1" --reason "설계가 6라운드 비수렴이라 범위를 나눠 다시 만든다" --confirm "REQ-2026-144 대체 승인" --run
npx commitgate req:new hardcap-report-successor --successor-of REQ-2026-144 --run
```

🔴 **예제에 꺾쇠 자리표시자를 쓰지 않고, 줄바꿈으로 잇지도 않는다**(설계 r03·r04 P1). PowerShell 에서
`<` 는 리디렉션 토큰이고 줄 끝 `\` 는 continuation 이 아니다 — 둘 다 붙여넣으면 명령이 죽는다.
사람이 바꿔 넣을 값도 **실제 값 모양 그대로** 적어, 그대로 실행해도 동작하고 무엇을 바꿔야 하는지도 보이게 한다.

둘째 줄이 성공해야 한다 — 워킹트리에 **다른 변경이 없다면 바로**, 남아 있다면 **무엇이 막는지 정확히
지목받은 뒤**.

## 왜 — 안내받은 탈출구가 **실행 불가**다(실측)

`hardCap` 에 닿으면 도구가 이렇게 말한다.

```text
review 예산 소진 — 9회차는 어떤 경로로도 실행하지 않는다(hardCap=8).
종료하거나 정합한 대체 REQ를 작성한다.
```

그런데 `req:new --successor-of` 는 부모 state 에 `closed_reason='human-resolution'` +
`human_resolution.decision='replace'` 를 요구하고(`resolveSuccessorLineage`), **그 값을 쓰는
`closeSeriesHumanResolution` 은 어떤 CLI verb 도 호출하지 않는다** — 저장소 전수 검색 결과 호출부는
테스트뿐이다. 따라서 안내대로 하면 이렇게 막힌다.

```text
--successor-of REQ-...: 부모에 대체(replace)를 허용한 유효한 사람 결정 기록이 없다
```

🔴 **이 저장소 반복 계열 5번째다** — REQ-092(승인 행 교착) · REQ-093(`--abandon`) ·
REQ-141(`--close-stale`) · REQ-142(finalize 복구). 전부 "안내받은 명령이 그 상황에서 실행 불가"였다.

**로직은 이미 있다. 없는 것은 배선뿐이다.**

## 제약

- 🔴 **`hardCap` 을 열지 않는다.** 이 verb 는 예산을 되돌리지 않고 회차를 늘리지도 않는다.
  대체 REQ 는 **새 티켓**이고 새 예산이며, 부모 이력은 lineage 로 보존된다.
- 🔴 **`--reason`·`--confirm` 필수.** 사람의 결정 기록이므로 근거 없이 쓰지 않는다(`--close-stale` 동형).
- 🔴 **대상 series 를 짐작하지 않는다.** `--series <id>` 로 명시받는다 — 한 티켓에 design·phase series 가
  동시에 열려 있을 수 있고, 잘못 고르면 **엉뚱한 series 를 종결**한다.
- 🔴 **이 verb 가 만든 더러움은 스스로 0 으로 만든다**(`state.json` 을 커밋한다). 안 그러면 1단계가
  2단계를 막는 — 이 REQ 가 고치려는 결함과 **같은 모양**이 된다.
- 🔴 **남의 staged 파일은 건드리지 않는다.** 실제 hardCap 상태엔 리뷰에 올린 설계 문서가 staged 로
  남아 있는데, 무엇인지 모르는 채 커밋하면 코드·비밀이 딸려 들어간다(`git add -A` 금지와 같은 이유).
  대신 **막는 경로를 실제 값으로 열거하고 다음 명령을 준다**.
- 🔴 **`replace` 만 연다.** 다른 `decision` 값은 지금 소비처가 없다.

## 완료 기준

1. 트리가 깨끗한 상태에서 `--resolve replace --run` 직후 `req:new --successor-of --run` 이
   **다른 조작 없이** 성공한다.
2. 트리에 다른 변경이 남아 있으면 **그 경로들을 실제 값으로 열거**하고 다음 명령을 준다.
3. 사람의 결정(`--confirm`·`--reason`)이 **각각 제 필드에 커밋된 상태**로 남는다.
4. 잘못된 대상(없는·이미 닫힌 series)·근거 없는 실행은 거부된다.
