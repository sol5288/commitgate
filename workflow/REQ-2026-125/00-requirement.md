# REQ-2026-125 요구사항

0.21 긴급 정정 — gitignore 백필 안내의 `--apply` 누락, GitHub CI "조회/실행" 용어 정정, 0.22 업그레이드 문서

## 배경 (무엇이 문제인가)

0.21.0 릴리스 검수에서 소비자에게 직접 노출되는 안내 3건의 결함이 확인됐다(전부 실측).

1. **gitignore 백필 안내가 동작하지 않는 명령을 제시한다.** `sync`의 기본은 dry-run(쓰기 0건)인데,
   백필을 안내하는 표면들이 `npx commitgate sync --gitignore`(=계획만 출력)를 제시한다. 소비자가
   경고를 그대로 복사해 실행하면 **아무 파일도 바뀌지 않고**, 다음 실행에서 같은 경고를 또 본다.
   실측 위치: `bin/verify-range.ts:368`(런타임 경고 — 가장 위험, 복사-실행 대상),
   `CHANGELOG.md` 0.21.0 업그레이드 안내 2곳, `docs/troubleshooting.md`/`.en.md` 인벤토리 표 4행×2.
   (doctor D22의 안내는 `--gitignore --apply`로 이미 올바르다 — 표면 간 불일치이기도 하다.)
2. **`--github-ci`가 "실행"으로 읽히지만 실제로는 조회다.** 구현은 head SHA의 check-runs를
   `gh api`로 **1회 조회**할 뿐 워크플로를 디스패치하지 않는다(`bin/verify-range.ts:119` — 저장소
   전체에 `workflow_dispatch` 호출 없음). 그런데 사용자 문구는 "GitHub CI 검사를 **실행**하시겠습니까?
   비용 또는 사용량이 발생할 수 있습니다"(`CI_PROMPT`, `bin/verify-range.ts:135`)다. 사용자는
   Actions 사용량이 발생한다고 오해하고, 반대로 후속 REQ가 진짜 실행(workflow_dispatch)을 추가하면
   같은 이름이 두 의미를 갖게 된다. 조회와 실행은 이름에서 구별돼야 한다.
3. **0.20/0.21 → 0.22 업그레이드 절차 문서가 없다.** 소비자 3곳은 전부 0.20.0이고 package 범위가
   `^0.20.0`(2곳)·`0.20.0`(1곳)이라 npm 0.x caret 특성상 자동으로 minor를 넘지 않는다. 또한 3곳 모두
   `workflow/.gitignore`에 `/.verify-runs.jsonl` 규칙이 없다(0.21.0 신설 로그). 업그레이드 절차
   (설치 명령·sync 백필·검증 순서·rollback)를 `docs/upgrade.md` 버전별 절에 추가해야 한다.

## 요구

### R1 — 백필 안내는 실제로 백필되는 명령이어야 한다

- "백필한다/반영한다/보강한다" 문맥의 모든 안내는 `npx commitgate sync --apply --gitignore`를 제시한다.
- dry-run 예시는 `--apply` 없이 유지하되 "계획만 출력"임을 명시한다.
- 회귀 가드: 안내 표면(bin/scripts 소스·docs·README·templates·CHANGELOG)에서
  `sync --gitignore`를 포함하는 줄은 같은 줄에 `--apply`도 포함해야 한다(줄 단위 규칙 —
  과거 CHANGELOG의 `sync --gitignore [--apply]` 표기는 통과). `workflow/`(티켓 감사 기록)는 제외.
- 한/영 문서가 같은 의미를 갖는다.

### R2 — CI "조회"와 "실행"을 이름에서 구별한다

- 현 동작(기존 check-runs 조회)의 정식 옵션명을 `--check-github-ci`(부정형 `--no-check-github-ci`)로 한다.
- 대화형 문구는 "기존 GitHub CI 결과를 **조회**하시겠습니까?"로 바꾸고, 워크플로를 실행하지 않음을 명시한다.
- 기존 `--github-ci`/`--no-github-ci`는 **한 릴리스 동안 deprecated alias**로 유지한다 — 의미는
  기존과 동일(조회)이며, 사용 시 새 옵션명을 안내하는 deprecation 문구를 낸다. 의미를 조용히
  "조회→실행"으로 바꾸지 않는다.
- 실행(workflow_dispatch)은 이 REQ의 범위가 아니다 — 후속 REQ(MergeGate)가 `--run-github-ci`로 추가한다.
  이 REQ는 그 이름과 충돌하지 않는 어휘만 확정한다.
- 문구를 축자 인용하는 문서(`docs/workflow.md`/`.en.md`)와 help(`bin/init.ts` HELP_TEXT,
  `verify-range` printHelp)를 함께 갱신한다.

### R3 — 0.22 업그레이드 절 추가

- `docs/upgrade.md`·`docs/upgrade.en.md` "버전별 주의사항"에 0.20/0.21 → 0.22 절을 추가한다.
- 포함: 0.x caret가 minor를 자동으로 넘지 않음 · 권장 설치 명령(`npm install -D commitgate@^0.22.0`) ·
  lockfile 갱신 · `npx commitgate sync --apply --gitignore` · `npx commitgate check` ·
  secretScan 기본 `block`(0.21.0부터) · D31은 WARN 전용 · GitHub CI는 선택 사항 ·
  새 로컬 로그(`.verify-runs.jsonl` 등)와 기존 로그의 하위호환 · rollback 방법
  (`npm install -D commitgate@0.20.0` + 자산은 그대로 두면 구버전이 무시) ·
  소비자 파일을 자동으로 덮어쓰지 않음.
- 이 절은 이 REQ 시점에 참인 내용만 담는다. 0.22.0에서 추가될 기능(조회/실행 분리의 실행 축 등)은
  해당 REQ가 자기 절을 덧붙인다 — 미구현 기능을 미리 서술하지 않는다.

## 완료 기준

1. `verify-range`의 gitignore 경고를 그대로 복사해 실행하면 실제로 규칙이 반영된다(명령이 `--apply` 포함).
2. 회귀 가드가 `--apply` 없는 백필 안내의 재등장을 잡는다(가드 규칙 자체의 단위 테스트 + 실제 트리 스캔).
3. `--check-github-ci`가 기존 `--github-ci`와 동일하게 동작하고, `--github-ci`는 deprecation 문구를 낸다.
4. 대화형 CI 질문이 "조회"임과 "워크플로 미실행"을 명시한다.
5. upgrade 문서 한/영에 0.22 절이 있고 `docs:lint`(링크 검증)가 통과한다.

## 비목표

- workflow_dispatch 실행 축(후속 REQ — MergeGate).
- `sync` 자체의 동작 변경(안내 문구 문제이지 sync 결함이 아니다).
- 완결 REQ 설계문서(`workflow/REQ-*`) 내 옛 문구 수정 — 감사 기록이므로 손대지 않는다.
- 소비자 프로젝트 파일 변경.

## Failure mode

- 가드 범위를 CHANGELOG 전체로 잡으면 과거 절의 정당한 표기(`[--apply]`)가 걸릴 수 있다 → 줄 단위
  "같은 줄에 `--apply` 포함" 규칙으로 회피(사전 확인: 기존 트리에서 위양성 0건이어야 한다).
- deprecated alias 제거를 이번에 하면 0.21 사용자 스크립트가 깨진다 → 제거하지 않고 alias 유지.
- 축자 인용 문서와 코드 문자열이 어긋나면 문서가 거짓이 된다 → 인용부를 코드와 같은 phase에서 갱신.

## 하위호환

- `--github-ci`/`--no-github-ci`: 동작 유지(조회) + deprecation 안내. 제거는 차기 릴리스 이후 별도 결정.
- `VerifyRunRow.ci` 값(`skipped-default|skipped-explicit|checked-ok|checked-fail`)은 변경하지 않는다
  (기존 로그·report 집계 호환).

## Rollback

- 문구·문서·alias 추가만이므로 커밋 revert로 완전 복구된다. 스키마·로그 형식 변경 없음.
