# REQ-2026-165 요구사항

## 무엇

`commitgate check` 가 **업그레이드 8축 전부**를 축별 상태·조치와 함께 보고하게 한다.
그래서 소비자 프로젝트에 내리는 지시가 한 줄이 된다: *"`npx commitgate check` 를 돌리고 나온 대로 하라."*

## 왜

REQ-2026-164 가 축 등록부와 정본 표를 만들었지만, **소비자 프로젝트 안에서는 그 어느 것에도 도달할 수
없다.** 실측(0.24.0 설치본 `45_MBTI_kiosk`):

| 도달 경로 | 상태 |
|---|---|
| `node_modules/commitgate/docs/upgrade.md` | ❌ **`docs/` 가 npm 패키지 `files` 에 없다** |
| 설치된 `AGENTS.md`(계약) | ❌ 업그레이드 언급 **0건** |
| 설치된 `CLAUDE.md`(진입점) | ❌ **0건** |
| `node_modules/commitgate/README.md` | ⚠️ 있으나 **GitHub URL** 로 보낸다 |
| `npx commitgate check` | ⚠️ **8축 중 2축**(`req-scripts`=C6 · `contract-claims`=C5) |
| `npx commitgate req:doctor` | ⚠️ 나머지를 덮지만 **REQ id 가 필수** |

🔴 **가장 아픈 지점**: 업그레이드 **직후**에는 진행 중인 티켓이 없을 수 있는데 `req:doctor` 는 REQ id 를
요구한다. 그래서 `vendored-schema`(D20) · `managed-blocks`(D21) · `workflow-gitignore`(D22) ·
`mixed-install`(D19) 네 축은 **확인할 방법이 없다.** 티켓 없이 돌릴 수 있는 유일한 명령(`check`)은
그중 하나도 보지 않는다.

즉 정본 축 표는 **정작 필요한 곳에서 읽히지 않고**, 쓸 수 있는 명령은 8축 중 2축만 본다.

## 제약

- 🔴 **판정을 재구현하지 않는다.** 다섯 축의 술어는 이미 존재한다(`classifyInstallMode` ·
  `unprotectedRepoRootScratch` — `req-doctor` · `quickstartBackfillTargets` — `bin/quickstart` ·
  스키마 sha 비교 · persona 상태 — `bin/sync`). `check` 가 자기 판정을 새로 쓰면 `doctor` 와 갈라져
  "doctor 는 괜찮다는데 check 가 막는" 상태가 생긴다(REQ-2026-094 가 같은 결론에 도달했다).
- 🔴 **축 목록은 REQ-2026-164 의 등록부에서 나온다.** 여기서 목록을 다시 적으면 그 REQ 가 없앤
  갈라짐이 되살아난다. 축을 늘리면 `check` 출력이 **자동으로** 따라와야 한다.
- 🔴 **`check` 의 exit 계약을 바꾸지 않는다.** 지금 FAIL 만 exit 1 이다. 업그레이드 축은 **WARN 상한**이다 —
  업그레이드가 안 끝났다는 이유로 CI·에이전트가 죽으면 안 된다.
- 판정 불가(파일 조회 실패 등)는 **"부족"이 아니다**. 모르면 모른다고 말한다.

## 완료 기준

1. `npx commitgate check` 가 **티켓 없이** 8축 전부의 상태를 낸다(조치가 필요한 축은 그 명령과 함께).
2. 축이 등록부에서 파생된다 — 축을 늘리면 출력이 따라오고, 목록을 손으로 적은 자리가 없다.
3. 판정은 기존 술어를 **재사용**한다(재구현 0).
4. exit 계약 불변(축은 WARN 상한) · 판정 불가는 "부족"으로 세지 않음.
5. 변경한 소스를 import 하는 테스트 그린 · 통합 직전 전체 스위트 1회 그린.

## 비목표

- **조치 실행**(`check` 가 `sync` 를 대신 돌리는 것). `check` 는 읽기 전용이 계약이다 —
  그것을 깨면 "진단이 곧 변경"이 되어 사용자가 결과를 예측할 수 없다.
- 새 진단 축 추가(8축은 REQ-2026-164 가 확정했다).
- `req:doctor` 를 티켓 없이 돌게 만드는 것 — 그쪽은 티켓 게이트가 존재 이유다.
- `docs/` 를 npm 패키지에 넣을지는 **설계에서 판정**한다(`check` 가 전부 말하면 문서는 보조다).
