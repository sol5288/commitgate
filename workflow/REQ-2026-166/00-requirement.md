# REQ-2026-166 요구사항

## 무엇

0.25.0 도그푸드 검증에서 실측으로 찾은 결함 두 건을 고친다.

1. `commitgate check` 의 `C7` 이 **CommitGate 설치가 아닌 곳에서 거짓 조치**를 안내한다.
2. `--help` 가 `req:*` verb 중 셋에서 거부된다.

## 왜

### ① `review-persona` 축의 거짓 조치

배포된 0.25.0 으로 빈 디렉터리(`package.json`·`workflow/` 없음)에서 `npx commitgate check` 를 돌린 실측:

```
- req-scripts     : package.json 의 scripts 를 읽지 못함      ← unknown (옳다)
- vendored-schema : 스키마 사본을 읽지 못함                    ← unknown (옳다)
- review-persona  : persona 부재 — 리뷰가 fail-closed 로 멈춘다
                    → npx commitgate sync --apply --persona --persona-apply   ← 🔴 action
```

`planSync` 는 persona 부재를 **복원 대상**(`status: 'new'`)으로 보고하고, `upgrade-status` 의 판정기가
그것을 `missing → action` 으로 옮긴다. 다른 축은 입력이 없으면 자연히 `unknown` 이 되는데 이 축만 아니다.

🔴 결과: 사용자가 엉뚱한 디렉터리에서 `check` 를 돌리면 **CommitGate 프로젝트가 아닌 곳에 파일을 만들라는
안내**를 받는다. REQ-2026-161·163·165 가 반복해 고쳐 온 *"안내가 사실인가 · 실행 가능한가"* 와 같은 계열이고,
이번에는 **사실이 아닌** 쪽이다.

### ② `req:*` verb 가 사용법을 내지 않는다

감사 보고에서 "셋"이라고 적었는데 **틀렸다**. 전 verb 를 실제 CLI 진입점(`bin/commitgate.mjs`)으로 순회한 실측:

```
req:new                exit=1   commitgate: 알 수 없는 옵션: --help
req:next               exit=1   commitgate: 알 수 없는 옵션: --help
req:commit             exit=1   commitgate: 알 수 없는 옵션: --help
req:close              exit=1   commitgate: 알 수 없는 옵션: --help
req:confirm            exit=1   commitgate: 알 수 없는 옵션: --help
req:delegate           exit=0   commitgate req:delegate — stopGate:"auto" 의 사전 위임 발급·철회   ← 유일
req:doctor             exit=1   commitgate: 알 수 없는 옵션: --help
req:rebind             exit=1   commitgate: 알 수 없는 옵션: --help
req:reconstruct        exit=1   commitgate: 알 수 없는 옵션: --help
req:repolicy           exit=1   commitgate: 알 수 없는 옵션: --help
req:review-exception   exit=1   commitgate: 알 수 없는 옵션: --help
req:review-codex       exit=1   commitgate: REQ id 또는 --ticket <dir> 필요 (…)
```

**12개 중 11개**가 거부한다(`req:review-codex` 는 옵션 파싱 前 인자 검사에서 다른 문구로 죽는다).
반면 `bin/*` verb 9종은 **전부** 낸다. 즉 이것은 "셋의 누락"이 아니라 **명령군 하나가 통째로 빠진 것**이다.

🔴 하필 그 안에 사람 전용 통제점 명령이 있다 — `req:confirm`(HIGH 확인) · `req:rebind`(`--confirm` 필요) ·
`req:review-exception`(예외 승인). 사람이 `--help` 를 칠 가능성이 가장 높은 자리에서 사용법 대신 오류가 나온다.

🔴 왜 자체 감사가 이것을 3건으로 봤나: 처음엔 `node bin/dispatch.mjs` 로 호출했는데 그것은 **디스패치 순수
로직 모듈**이라 아무것도 실행하지 않고 조용히 exit 0 을 낸다. 진입점이 아닌 것을 진입점으로 써서
"지원함"으로 읽었다. 이 REQ 의 가드는 **`bin/commitgate.mjs` 로** 돌려야 한다.

## 제약

- 🔴 **설치 신호 판정을 재구현하지 않는다.** `lib/setup-gate` 의 `collectInstallSignals` 가 이미 정본이고
  `req:doctor` D24 가 그것을 쓴다. 두 벌이 되면 "doctor 는 설치로 보는데 check 는 아니라는" 상태가 생긴다.
- 🔴 **조치를 늘리지 않는다.** 이 REQ 는 거짓 조치를 **없애는** 방향이다 — 없던 경고를 새로 만들지 않는다.
- 🔴 **정상 설치본의 판정은 그대로다.** persona 부재·차이가 실제 설치본에서 조치인 것은 옳다(리뷰가
  fail-closed 로 멈춘다). 바뀌는 것은 **설치가 아닌 곳**뿐이다.
- `--help` 는 기존 verb 들과 **같은 형태**로 낸다(자체 규약을 새로 만들지 않는다). `req:delegate` 가
  이미 그 형태이고 `bin/*` 는 `HelpRequested` 를 쓴다.
- 🔴 **가드는 실제 진입점으로 돌린다.** 위 ②의 오독이 그 이유다.

## 완료 기준

1. 설치 신호가 **하나도 없는** 디렉터리에서 `C7` 의 자산 축이 `action` 을 내지 않는다(=`unknown`).
2. 정상 설치본에서 persona 부재·차이는 **여전히** `action` 이다(과잉 완화 아님).
3. `VERB_MODULES` 의 **모든** `req:*` verb 가 `-h`/`--help` 로 사용법을 낸다(exit 0, 비어 있지 않은 출력).
4. 그 사실을 가드가 **등록부에서 파생해** 고정한다 — 다음에 추가되는 verb 도 자동으로 걸린다.
5. 변경한 소스를 import 하는 테스트 그린 · 통합 직전 전체 스위트 1회 그린.

## 비목표

- 새 축·새 진단 추가.
- `planSync` 의 persona 상태 의미 변경 — 그쪽은 `sync` 의 계약이고 옳다(부재면 복원이 맞다).
  바뀌는 것은 **`check` 가 그것을 업그레이드 조치로 읽는 조건**이다.
- `bin/*` verb 의 help 문구 개선.
