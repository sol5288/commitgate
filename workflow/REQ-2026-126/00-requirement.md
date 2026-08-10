# REQ-2026-126 요구사항

MergeGate — 로컬 통합 seam(`commitgate integrate`) + GitHub CI **실행** 명시 opt-in

## 배경 (무엇이 문제인가)

1. **verify-range는 실제 merge와 결속되지 않는다.** 0.21.0의 `verify-range`는 사람이 따로 실행하는
   보고 도구다. 통합 통제점(I1/B1)의 실제 절차 — clean 확인·증거 검증·CI 선택·사람 확인·`git merge` —
   는 전부 수작업이며, 검증을 건너뛰고 병합해도 아무것도 막지 않는다. "머지 직전 로컬 승인 증거 검사"가
   기본 절차가 되려면 그 절차를 소유하는 seam이 필요하다.
2. **GitHub CI "실행" 경로가 없다.** REQ-2026-125가 조회(`--check-github-ci`)의 어휘를 정리했고,
   실행(workflow_dispatch)은 이름만 예약돼 있다(`--run-github-ci`). 사용자가 명시적으로 원할 때
   CI를 실행하고 완료를 확인하는 경로를, 조회와 혼동되지 않게 추가해야 한다.
3. **기존 `delivery integrate`는 다른 층이다.** delivery set의 feature→delivery 브랜치 통합이며
   trunk 병합이 아니다. trunk 통합 seam은 별도 verb가 필요하고, 이름·문서에서 구별돼야 한다.

## 요구

### R1 — `commitgate integrate`: 통합 직전 절차를 소유하는 seam

기본 dry-run(계획 출력·병합 없음), `--run`이 실행. 최소 흐름:

1. 저장소·config 로드, 현재 브랜치와 target trunk(`trunkBranch`) 확인
2. 전제 거부: trunk 위에서 실행(자기 병합) · feature 브랜치 아님(`branchPrefix` 불일치) ·
   dirty worktree · 진행 중 merge/rebase · trunk ref 부재
3. **로컬 승인 증거 검증(strict)**: `merge-base(trunk, HEAD)..HEAD`를 verify-range 코어로 분류,
   미입증·manifest 문제가 있으면 차단하고 목록 표시(범주별 개수 + 미입증 커밋)
4. GitHub CI **실행** 여부 결정(아래 R2) — 생략은 정상 상태이며 실패가 아니다
5. 사람의 최종 통합 확인(대화형 `[y/N]` 기본 No; 비대화형은 `--run` 자체가 확정 동작임을 문서 명시)
6. trunk 체크아웃 → `git merge --no-ff <feature>` — 충돌 시 `merge --abort` 후 원래 브랜치로 복귀
   (원상 복구), 명확히 실패
7. 결과를 로컬 감사 로그에 append(아래 R4)
8. **push는 하지 않는다**

안전 조건: 자동 stash 금지 · 자동 reset 금지 · 자동 push 금지 · 자동 branch 삭제 금지 ·
사용자의 마지막 확인 없이 merge 금지 · CI 생략이 실패로 보이면 안 됨.

### R2 — GitHub CI 실행은 명시 opt-in + 사용자 소유 설정

- config 신설(additive): `"githubCi": { "workflow": "ci.yml", "timeoutMinutes": 30 }`
  (`workflow` 필수 — CommitGate가 임의 워크플로를 추측하지 않는다. `timeoutMinutes` 기본 30).
- CLI: `--run-github-ci`(명시 실행) / `--no-github-ci`(명시 생략). 대화형이고 config가 있으면
  "GitHub CI workflow를 실행하시겠습니까? GitHub Actions 사용량 또는 비용이 발생할 수 있습니다. [y/N]"
  기본 No. **config가 없으면 질문하지 않고 생략**(정상). 비대화형은 명시 옵션 없이는 절대 실행 안 함.
- `--run-github-ci`인데 config 부재 → 명확히 실패. workflow_dispatch 미지원(HTTP 422 등) → 명확히 실패.
  feature 브랜치가 원격에 없으면 → 자동 push 하지 말고 명확히 실패.
- **CI 결과는 병합할 local HEAD에 결속한다**: dispatch 전에 원격 `refs/heads/<feature>` SHA가
  로컬 HEAD와 일치하는지 대조하고, 다르면(미push 커밋 존재) 자동 push 없이 명확히 실패한다.
  선택한 run의 `head_sha`도 그 SHA와 일치해야 한다 — 불일치는 실패다(CI가 검사하지 않은 커밋을
  green으로 오인하는 fail-closed 우회 방지).
- dispatch 후 해당 실행을 정확히 식별한다: dispatch 직전 시각 T를 기록하고, 같은 workflow·같은 ref·
  `event=workflow_dispatch`·`created>=T`·`head_sha=로컬 HEAD`인 run만 후보로 삼는다(과거 run
  오연결 금지). 완료까지 `timeoutMinutes` 동안 폴링하고, timeout·red·cancelled·run 미출현은 전부
  실패로 표시한다.
- 실패 시(사용자가 명시 요청한 실행·확인 실패) 통합을 중단한다.
- 로그에는 run id·conclusion·시각만 남긴다 — CI 출력 본문을 저장하지 않는다.
- 선택은 실행 단위이며 저장하지 않는다. 실행한 적이 있어도 다음 통합에서 자동 실행하지 않는다.

### R3 — MergeGate는 작은 인터페이스의 깊은 모듈

- 순수 코어 `scripts/req/lib/merge-gate.ts`: `planIntegration(facts) → IntegrationPlan`
  (전제 판정·차단 사유·실행 단계 산출 — git/fs/네트워크 모름).
- CI 실행 포트 `scripts/req/lib/github-ci-run.ts`: 판정 순수 함수 + gh 어댑터 + **fake**(테스트 전용).
- `bin/integrate.ts`는 수집(git)·질문·실행·렌더만. 호출자가 실행 순서 불변식을 알 필요가 없게 한다.
- 테스트는 fake GitHub adapter로만 수행한다 — 실제 gh 호출·Actions 사용량 발생 금지.

### R4 — 감사 로그

`workflow/.integrate-runs.jsonl`(gitignored·로컬 전용) 1실행 1행: 시각·trunk/feature·base/head SHA·
verify 범주 개수·CI 선택/결과·merge 여부·merge SHA·exit. 유지 규칙 3종 세트 준수:
`templates/workflow.gitignore` 앵커형 규칙 + `scripts/smoke.mjs` check-ignore 단언 +
troubleshooting 인벤토리 표 행. gitignore 규칙이 없으면 기록을 건너뛰고 경고만(verify-range 관례 —
안내는 `sync --apply --gitignore`). 기록 실패는 판정·병합 결과를 바꾸지 않는다.

## 완료 기준

1. 기본 dry-run이 병합 없이 계획·차단 사유를 출력한다(fake 포트 테스트).
2. strict 검증: 미입증 커밋이 있으면 `--run`이어도 병합하지 않는다.
3. CI: config 없음 → 질문 없이 생략 · `--run-github-ci`+config 없음 → 명확 실패 ·
   dispatch 후 식별·폴링·timeout/red/cancelled/미출현 실패가 fake로 고정된다.
4. 과거 run을 새 실행으로 오연결하지 않는다(생성 시각·event·ref 필터 테스트).
5. 충돌 시 원상 복구된다(merge --abort + 원래 브랜치 복귀 — 실 git 테스트 1건).
6. 감사 로그 1행 append + 유지 규칙 3종(smoke 단언 포함).
7. 테스트 어디에서도 실제 gh·네트워크를 호출하지 않는다.

## 비목표

- PR 생성·PR merge·push·원격 브랜치 관리(로컬 통합으로 한정).
- `delivery` set 흐름 변경(별도 층 — 문서에서 구별만).
- HIGH 티켓의 delivery-scope 사람 확인 이전(移轉) — 그 확인은 기존 `req:confirm`/delivery 경로가
  소유한다. integrate의 최종 확인은 통합 승인이지 HIGH 확인의 대체가 아니다.
- verify-range 분류 심화·attestation(REQ-2026-127) — integrate는 코어를 공유하므로 후속 강화를
  자동으로 소비한다.
- report 반영(REQ-2026-128) · push/PR 시 CI 자동 실행(절대 금지 항목).

## Failure mode

- CI run 식별 실패(동시 dispatch 경쟁): created>=T·event·ref 필터로 좁히되, 다중 후보면 가장 이른
  것을 선택하지 않고 **식별 불가로 실패**한다(오연결보다 보수적).
- 폴링 중 gh 오류: 실패로 표시하고 통합 중단(사용자가 명시 요청한 확인이므로).
- merge 충돌: abort + 원래 브랜치 복귀. 복귀 실패는 상태를 그대로 두고 수동 안내.
- 감사 로그 쓰기 실패: 경고만, 결과 불변.

## 하위호환

- 신규 verb·신규 config 키(additive·미지정 시 기존과 동일 동작). 기존 명령·로그 스키마 불변.
- verify-range의 조회 축(`--check-github-ci`)과 이름·의미 충돌 없음.

## Rollback

- verb·모듈·config 키 추가만이므로 revert로 완전 복구. 감사 로그 파일은 gitignored 로컬 파일.
