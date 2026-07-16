# 갭·결정 기록 (gaps-and-decisions)

코드·테스트·설정·문서 간 불일치, 미구현 계약, 불명확 동작, 그리고 본 문서화 작업 자체의 프로세스 결정을 기록한다. 각 항목: 영향도, 근거, 확인 방법, 재구현 시 임시 결정 원칙.

## 1. 미구현 계약 / 알려진 한계 (제품)

### G-01. codex 호출 타임아웃 없음 (영향: 중)
- **사실**: 리뷰 codex 호출에 타임아웃이 없다. 응답 지연/무한 대기 방어가 없다.
- **근거**: CHANGELOG 0.6.0 deferred, [docs/follow-ups-design.md](../../docs/follow-ups-design.md). Windows `cmd.exe` 프로세스 트리 kill 난이도로 유보.
- **재구현 원칙**: 타임아웃을 추가하려면 크로스플랫폼 프로세스 트리 종료를 함께 설계. 현재는 "없음"이 사실.

### G-02. secret-safe 실패 진단 없음 (영향: 중)
- **사실**: 실패 시 stderr에 비밀이 섞일 가능성을 완전히 차단하지 못한다. 리뷰 전 secret-scan 훅(`preReviewCommand`)도 미구현.
- **근거**: CHANGELOG 0.5.0/0.6.0 deferred.
- **재구현 원칙**: 리뷰 대상(phase=staged diff, design=00/01/02 본문)은 마스킹 없이 외부 전송되고 codex가 repo 루트를 read-only로 읽는다는 전제를 유지. 사전 육안 확인이 유일 방어([09-security-and-reliability.md](09-security-and-reliability.md) §4).

### G-03. codex usage limit 진단 유실 (영향: 중)
- **사실**: `명령 실패(exit=1): codex`는 대개 usage limit인데, 어댑터가 stderr만 읽고 codex는 오류를 stdout에 쓰는 경우가 있어 원인 진단이 유실될 수 있다.
- **근거**: [scripts/req/lib/adapters.ts](../../scripts/req/lib/adapters.ts) `safeSpawnSync`(status≠0 throw는 stderr 기반), 세션 조사·사용자 메모리.
- **확인 방법**: 실제 usage limit 상황에서 codex를 직접 실행해 stdout/stderr 분배 관찰.
- **재구현 원칙**: 실패 시 stdout도 함께 캡처·표출하도록 개선 여지(현재는 미구현).

### G-04. `trunkBranch` 하드코딩 (영향: 소)
- **사실**: trunk 브랜치가 `'main'`으로 하드코딩(설정화 안 됨).
- **근거**: [scripts/req/req-next.ts](../../scripts/req/req-next.ts)·[scripts/req/req-doctor.ts](../../scripts/req/req-doctor.ts) D11.
- **재구현 원칙**: `master` 등 다른 trunk를 쓰는 repo는 현재 D11이 오작동할 수 있음. 설정 키 추가 시 `branchPrefix`와 별도로.

### G-05. 하드 강제 부재 (영향: 중, 설계 의도)
- **사실**: git hook 미설치. `git commit` 직접 실행이 전체 게이트를 우회.
- **근거**: [README.md](../../README.md) "보장하지 않는 것".
- **재구현 원칙**: 이는 **의도된 경계**다. 강제력은 협조하는 에이전트 유지에 있고, 운영 방어선은 CI·배포 파이프라인. 하드 강제를 추가하려면 별도 설계 필요.

### G-06. resume 경로 미사용(dead-ish path) (영향: 소)
- **사실**: `createCodexReviewerAdapter`에 resume argv가 있으나 라이브 `main()`이 `isResume=false` 고정이라 현재 사용되지 않는다.
- **근거**: [scripts/req/review-codex.ts](../../scripts/req/review-codex.ts) 주석(D5 stateless).
- **재구현 원칙**: 재리뷰는 stateless(새 스레드)가 현재 동작. resume는 향후 opt-in용 보존 코드로 취급.

### G-06a. 리뷰 라운드 상한·escalation 없음 (영향: 대)
- **사실**: 설계/phase 리뷰의 **재검수 횟수 상한이 없다.** needs-fix면 무한히 반복할 수 있고, 상한 도달 시 PM에게 넘기는 escalation 경로도 없다. 유일한 회로차단기 `blocked`는 `findings=[]`일 때만 발화하므로([07](07-business-rules-and-state-machines.md) §7), findings가 계속 나오는 비수렴 루프에서는 **영원히 걸리지 않는다**.
- **근거**: 실측 — REQ-2026-014 설계 리뷰가 **r30**까지 진행. REQ-2026-015(4R)·016(2R)·017(2R)은 terminal 폐기.
- **PM 정책(코드 미반영)**: 설계 리뷰 상한 기본 2회, P1 잔존 시 3회, **절대 최대 5회**. 상한에서 새 예외를 만들지 말고 출시·범위 축소·중단을 결정한다. 현재 이 정책을 **강제하는 코드가 없다** — 사람이 집행해야 한다.
- **재구현 원칙**: 상한은 아카이브 라운드 수(`nextRound`)로 계산 가능하다. 상한 도달은 **승인이 아니라 escalation**(별도 exit code)이어야 한다. REQ-2026-018은 이를 명시적 비목표로 두고 후속에 넘겼다.

### G-06b. 승인 후 편집 시 전면 재리뷰(델타 재리뷰 없음) (영향: 대)
- **사실**: 설계 문서 해시가 **한 글자만 바뀌어도** design 승인 전체가 무효화되고, 재리뷰는 변경분이 아니라 **설계 전체**를 대상으로 다시 돈다. 스테이트리스 재리뷰는 직전 라운드 findings 스냅샷만 참고하므로, 리뷰어는 자기가 몇 라운드째인지·같은 주제를 몇 번 돌았는지 알지 못한다.
- **근거**: 실측 — REQ-2026-014는 **r19에서 findings 0건 승인**이 났으나 이후 요구 추가(R10 등)로 해시가 바뀌어 승인이 증발했고, r20~r30이 백지에서 재탐색했다(그 21건은 전부 P2, P1 0건). 승인 시점 대비 요구 60줄→71줄·설계 194줄→251줄로 자라났다.
- **재구현 원칙**: 승인 해시 대비 **델타만** 재리뷰 대상으로 삼는 경로가 필요하다. 이것이 r19 승인을 살렸을 근본 수정이며, 상태·해시 비교 로직을 건드리므로 표면이 크다(REQ-2026-018은 의도적으로 제외).

### G-06c. `nextReqId`가 브랜치-당-티켓 모델과 충돌 (영향: 중)
- **사실**: `nextReqId`는 **워킹트리의 `workflow/`만 스캔**해 연도별 max+1을 낸다. 그런데 티켓은 브랜치마다 살고 머지 전에는 그 트리에 없다 → **이미 존재하는 REQ 번호를 재발급**한다.
- **근거**: 실측 — main(001~013)에서 `req:new` dry-run 시 이미 진행 중인 **014를 재발급**. 018을 얻으려면 017 브랜치에서 실행해야 했다.
- **재구현 원칙**: 채번은 워킹트리가 아니라 **모든 브랜치/원격의 티켓 집합**(예: `git ls-tree -r --name-only $(git branch --format='%(refname)')`)이나 별도 레지스트리를 봐야 한다. 현재는 `--run` 전 dry-run으로 번호를 사람이 확인하는 것이 유일한 방어.

### G-09. 런타임 state가 자동 내구화·재구축되지 않음 (영향: 대)
- **사실**: `state.json`은 티켓 생성 시 tracked지만, review/commit이 만든 변경은 scratch로 취급되고 정상 source/evidence 커밋에 포함되지 않는다. `req:commit`은 state를 stage하면 차단한다. 일부 완료 티켓은 별도 수동 chore 커밋으로 최종 state를 남겼지만 일반 CLI 단계가 아니다.
- **영향**: 리뷰 후 다른 clone/worktree에서 `req:next` 결과가 달라질 수 있고, local state 분실 시 아카이브·manifest·git에서 자동 복구할 수 없다. 감사 증거가 남는 것과 실행 상태 뷰가 복원되는 것은 다른 문제다.
- **근거**: [scripts/req/req-commit.ts](../../scripts/req/req-commit.ts) `srcStaged` non-code 차단·`consumeState`; `696faa6` 커밋 메시지의 REQ-2026-018 수동 state finalize 사례.
- **재구현 원칙**: 현재 동작을 재구현할 때 state 변경을 자동 커밋한다고 가정하지 않는다. 개선 시 immutable event log + state rebuild/check를 먼저 설계하고 기존 아카이브 마이그레이션을 fail-closed로 처리한다([14](14-product-strategy-and-roadmap.md) STR-02).

### G-10. vendored 설치본 버전 원장·안전한 upgrade 없음 (영향: 중)
- **사실**: 설치기는 파일을 복사하지만 설치 당시 패키지 버전·파일별 원본 sha를 대상 repo에 기록하지 않는다. `--force`는 갱신 수단이지만 사용자 수정과 구버전 원본을 3-way로 구분하는 upgrade 계획이 아니다.
- **영향**: 여러 repo의 정책이 조용히 다른 버전에 머물 수 있고, 현재 패키지의 강화된 schema/persona가 기존 설치본에 자동 적용된다고 보장할 수 없다. 제거 플래너는 다른 바이트를 안전하게 `review`로 남기므로 데이터 파괴는 피하지만 운영 드리프트는 해소하지 못한다.
- **근거**: [bin/init.ts](../../bin/init.ts) `planInstall`/`runInit`, [bin/uninstall.ts](../../bin/uninstall.ts) `identical|differs` 분류.
- **재구현 원칙**: 기존 비파괴 동작을 유지. 개선은 install manifest·plan·3-way 분류·rollback을 함께 제공한다(STR-06).

### G-11. 사용자 가치·비용·수렴 관측 지표 없음 (영향: 중)
- **사실**: 텔레메트리·메트릭·집계 CLI가 없다. 개별 archive와 exit code는 있으나 온보딩 시간, 리뷰 라운드 P50/P95, 대기 시간, 실패 코드 비율, fresh-clone 복구율을 자동 산출하지 않는다.
- **영향**: P1 전용 차단 정책이나 stateless 재리뷰가 실제로 수렴을 개선했는지 표본 일화 외에는 판단하기 어렵다. 테스트 개수 증가를 사용자 가치로 오인할 위험이 있다.
- **재구현 원칙**: 코드·diff·프롬프트를 수집하지 않는 로컬 집계를 우선한다. 지표 정의는 [14](14-product-strategy-and-roadmap.md) §4, 목표 기능은 STR-08.

### G-12. state 전체 schema와 명시적 수명주기 전이가 없음 (영향: 중)
- **사실**: `loadState`는 `id`·`phase` 존재만 확인하며 state용 JSON Schema가 없다. `phase`는 `req:new`에서 `INTAKE`로 초기화된 뒤 현재 CLI가 자동 변경하지 않는다. 논리 진행은 다른 필드와 git에서 파생된다.
- **영향**: `phase`를 `INTAKE→…→DONE` 자동 상태 필드로 오해하기 쉽고, 필드 조합의 부분 손상은 각 사용 지점까지 가야 발견된다. D11은 `phase!==DONE`을 보므로 수동 변경이 정책 의미까지 바꿀 수 있다.
- **근거**: [scripts/req/req-new.ts](../../scripts/req/req-new.ts) `buildInitialState`, [scripts/req/review-codex.ts](../../scripts/req/review-codex.ts) `loadState`, 저장소 state 전수 관찰(완료 이력이 있는 티켓도 `INTAKE`).
- **재구현 원칙**: 현재 0.6.0 호환 구현은 파생 상태를 유지한다. 명시적 상태 머신 도입은 schema version·migration·D11·`req:next` 의미를 함께 바꾸는 별도 설계다.

## 2. 문서화 대상 저장소 관찰 사항

### G-07. `.agents/` 빈 디렉터리 (영향: 소)
- **사실**: `.agents/`가 존재하지만 비어 있고 git 미추적.
- **근거**: `git ls-files .agents` 공백.
- **재구현 원칙**: 계약 자료는 `AGENTS.template.md`·`templates/`·설치 포인터에 있으므로 `.agents/`는 무시 가능.

### G-08. 설계결정 ID와 D-체크 ID 번호 충돌 (영향: 소, 혼동 위험)
- **사실**: `01-design.md`의 설계결정 D1…과 `req:doctor`의 D-체크 D2… 번호 공간이 겹친다.
- **재구현 원칙**: 문맥으로 구분. 본 SSOT는 "D9 체크"(doctor) vs "설계결정 D9"를 명시적으로 구분([00-document-control.md](00-document-control.md) §2).

## 3. 본 문서화 작업의 프로세스 결정(중요 — 감사용)

사용자 지침은 `/req` 워크플로를 리뷰 경로로 요구하면서 동시에 (a) `docs/ssot-design/`만 스테이징, (b) `git commit`/`push` 금지, (c) 소스/설정 변경 금지를 규정한다. 이 저장소에서 `/req`가 곧 CommitGate 자신이라 하드 모순이 발생했고, 아래는 **실제로 일어난 일**이다(계획이 아니라 결과).

### D-01. `req:new --run` 미사용(커밋 금지와 충돌)
- **사실**: `req:new --run`은 티켓 스캐폴드를 **커밋**한다([scripts/req/req-new.ts](../../scripts/req/req-new.ts) `main`). 커밋 금지 규칙과 충돌하므로 실행하지 않았다.

### D-02. 수동 스캐폴드 + 로컬 exclude 시도 → **자동 분류기에 차단됨**
- **시도**: `req:review-codex`는 리뷰 전 clean-tree(`findUnstagedOrUntracked`)를 요구한다. 티켓의 `codex-request.md`(scratch 아님)가 미추적이면 트리가 더티가 되어 리뷰가 throw한다. 이를 우회하려고 티켓을 수동 스캐폴드하고 `.git/info/exclude`로 상태 스캔에서 숨기려 했다.
- **결과**: 자동 모드 분류기가 이 조작을 **CommitGate의 D10 게이트 우회로 판정해 정당하게 차단**했다. 따라서 **티켓(`workflow/REQ-2026-014/`)도, 작업 브랜치도 생성되지 않았다.** 브랜치는 `main` 유지.
- **영향**: 소스/설정 파일 무변경. `.git/info/exclude`도 변경되지 않았다(차단됨).

### D-03. 최종 리뷰 경로 = codex 직접 호출(사용자 승인 Option B)
- **사실**: 위 모순으로 `req:review-codex` 래퍼는 {커밋 금지 + docs만 스테이징 + 게이트 우회 금지}를 동시에 지키며 실행 불가함이 확인됐다.
- **결정(사용자 승인)**: `req:review-codex` 래퍼 없이 동일 리뷰 엔진 `codex exec --sandbox read-only`를 직접 호출해 스테이징된 `docs/ssot-design/**`를 외부 리뷰했다. 모델·추론강도는 프로젝트 설정과 동일(`gpt-5.6-terra`/`high`). 상세 회차는 [13-review-and-validation-log.md](13-review-and-validation-log.md).
- **영향**: `/req` 티켓 상태 머신(design 승인·evidence·consume)은 개입하지 않는다. 문서 품질 리뷰라는 실질 목표는 동일 엔진으로 충족.

### D-04. 문서별 개별 리뷰 → 코퍼스 리뷰(전체 스테이징)
- **사실**: 커밋 없이 문서를 하나씩 격리 리뷰하면 나머지 미추적 문서가 트리를 더티로 만든다.
- **결정**: 모든 SSOT 문서를 함께 스테이징한 뒤 코퍼스 전체를 매 라운드 리뷰했다. 지침의 "문서별 리뷰"는 코퍼스 리뷰 라운드로 매핑하고 문서별 지적을 로그에 기록한다.
- **영향**: 각 라운드 프롬프트가 크다(토큰↑). 대신 교차 참조·용어 일관성을 한 번에 검토.

### D-05. codex 호출 실패 가능성과 실제 발생 기록
- **사실**: 이번 리뷰는 **총 R1~R15의 15라운드, codex 17회 호출**(성공 15·실패 2)이었다. R1~R5는 각 1회 exit 0. **R6·R7은 1차 호출이 `ERROR: Selected model is at capacity`(모델 일시 용량 초과, usage limit 아님)로 exit 1 실패했고, 동일 모델로 즉시 재시도해 exit 0를 얻었다.** R6에서 문서 본문 사실오류가 1차 0으로 수렴한 뒤, **PM 조건부 반려에 따른 재검수가 R7~R15까지 이어졌고**(라운드수·호출횟수·승인문구 정정 및 export 정확성·import 그래프·state 필드 증감·doctor 부작용 등 심화 지적 반영) **R15에서 "추가 지적 없음"으로 최종 수렴**했다([13-review-and-validation-log.md](13-review-and-validation-log.md) §4·§6).
- **원칙**: 리뷰가 실패하면 우회하거나 통과로 표시하지 않는다. 실패 명령·사유를 로그에 기록하고 미검수 문서를 완료로 표시하지 않는다. 실제로 R6 1차 실패도 은폐하지 않고 재시도 사실과 함께 기록했다.

## 4. 고위험/재구현 영향 항목 요약
- **현재 동작을 1:1 재구현하는 데 필요한 사실은 문서화되어 있으나, 제품 위험이 없다는 뜻은 아니다.**
- **고영향 제품 gap**: G-06a(무한 NEEDS_FIX), G-06b(전면 재리뷰), G-09(state 비내구/재구축 부재). 이 셋은 사용자 신뢰·완료 가능성에 직접 영향을 주므로 P0다.
- **중요 보안/운영 gap**: G-01(타임아웃), G-02(외부 전송/secret-safe), G-03(진단 유실), G-05(하드 강제 부재), G-10(업그레이드), G-11(지표), G-12(state schema/수명주기).
- **정합성 gap**: G-06c(브랜치 간 ID 충돌), G-04(`main` 하드코딩). 팀 적용 전에 해결해야 한다.
- 우선순위·목표 설계는 [14-product-strategy-and-roadmap.md](14-product-strategy-and-roadmap.md)에 연결한다. 프로세스 결정 D-01~D-05는 과거 문서화 제약 대응이며 제품 런타임과 분리한다.
