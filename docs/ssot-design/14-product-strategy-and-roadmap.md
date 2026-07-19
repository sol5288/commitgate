# 14. 제품 전략·개선 로드맵

> **문서 성격**: 이 문서는 현재 구현 명세가 아니라 **목표 상태(Target)**와 투자 우선순위를 정의한다. 현재 동작의 SSOT는 01~12이고 13은 검수 이력이다. 여기의 제안은 구현·테스트·릴리즈가 끝나기 전까지 제품 보장으로 간주하지 않는다.
>
> **기준점**: `commitgate@0.6.0`, 2026-07-17, `main@0962d37`. 우선순위는 사용자 가치·신뢰 위험·선행 의존성·구현 비용을 함께 고려한 제품 판단이다.

## 1. 전략 결론

CommitGate의 가장 큰 가치는 “AI가 코드를 잘 쓰게 하는 것”이 아니라 **AI가 만든 변경을 사람이 통제 가능한 증거 단위로 바꾸는 것**이다. 현재 제품은 이 가치의 핵심인 다음 세 가지를 이미 구현한다.

1. **정확한 대상**: 승인을 설명문이 아니라 git staged tree OID에 바인딩한다.
2. **독립된 판정**: Builder와 Reviewer를 분리하고 구조화 응답을 다시 검증한다.
3. **감사 가능한 결과**: 승인 응답 해시·아카이브·소비 커밋을 연결한다.

그러나 현재 강제력은 협조적 에이전트와 로컬 단일 worktree에 머물고, 외부 전송 안전·리뷰 수렴·상태 복구·CI 강제가 약하다. 따라서 다음 성장 단계의 전략은 기능 수를 늘리는 것이 아니라 아래 순서로 **신뢰 폐쇄 루프**를 완성하는 것이다.

```text
요구 정의 → 독립 리뷰 → 정확한 변경 바인딩 → 승인 소비 → CI 재검증 → 감사·학습
               ↑                                           ↓
               └──────── 수렴·복구·정책 개선 ──────────────┘
```

## 2. 목표 사용자와 핵심 작업(JTBD)

| 우선 사용자 | 상황 | 해결해야 할 작업 | 성공의 모습 |
|---|---|---|---|
| **AI 중심 1인 개발자** | 에이전트가 빠르게 여러 파일을 수정 | “내가 모든 diff를 다시 읽지 않아도, 승인받은 변경만 커밋하고 싶다.” | 다음 행동이 명확하고, 정상 변경은 1~2회 리뷰 안에 커밋된다. |
| **소규모 개발팀** | 사람·에이전트가 같은 repo에서 작업 | “누가 어떤 변경을 어떤 근거로 승인했는지 PR/CI에서 검증하고 싶다.” | 로컬 승인과 원격 CI가 동일 증거를 확인한다. |
| **보안·감사 민감 팀** | 소스 외부 전송과 변경 추적이 중요 | “무엇이 외부로 나가는지 사전에 통제하고, 감사 증거를 보존하고 싶다.” | 전송 정책 위반은 호출 전에 막히고, 증거 체인을 재현할 수 있다. |

### 비목표 사용자

- 비협조적 공격자를 로컬 CLI 하나로 완전히 통제하려는 조직. 이 요구에는 protected branch·CI·서버 측 정책이 함께 필요하다.
- 다중 writer·다중 worktree의 강한 분산 일관성을 즉시 요구하는 환경. 먼저 단일 writer 모델의 복구 가능성을 완성한 뒤 확장한다.
- AI 리뷰를 법적·안전 인증 자체로 간주하려는 환경. CommitGate는 승인 과정의 무결성을 높이지, Reviewer의 판단이 항상 옳음을 보증하지 않는다.

## 3. 제품 가치 체계

### 3.1 사용자 가치

| 가치 | 현재 제공 방식 | 현재 한계 |
|---|---|---|
| **통제감** | `req:next`가 다음 행동을 결정하고 통제점에서 멈춤 | 직접 `git commit`으로 우회 가능, CI에서 재검증하지 않음 |
| **정확성** | staged tree/design hash에 승인 바인딩, stale 거부 | 설계 델타 재리뷰가 없어 작은 수정도 전체 재검수 |
| **감사성** | 응답 아카이브 + sha256 + `approvals.jsonl` + 소비 커밋 | 런타임 `state.json`은 자동 내구화·재구축되지 않음 |
| **효율** | phase 분해, 구조화 판정, stateless 재리뷰 | 라운드 상한·escalation·시간/비용 지표 없음 |
| **안전** | shell-free spawn, read-only Reviewer, fail-closed | 비밀 스캔·전송 크기 상한·격리 리뷰 컨텍스트 없음 |
| **이식성** | Stage B 런타임 패키지(devDependency), 3 OS × 3 Node CI | 관리 자산↔런타임 version skew 감지 수단·안전한 업그레이드 부재 |

### 3.2 차별화 원칙

1. **승인은 말이 아니라 불변 아티팩트에 묶는다.** “리뷰 완료” 문자열보다 git 객체와 해시를 우선한다.
2. **Builder와 Reviewer를 분리한다.** 같은 에이전트의 자기확신을 승인으로 취급하지 않는다.
3. **불확실하면 통과시키지 않는다.** 단, 비차단 개선까지 차단해 영구 비수렴을 만드는 것도 실패로 본다.
4. **사람의 권한을 명시적으로 남긴다.** 고위험·통합·배포 통제점은 서로 이월하지 않는다.
5. **로컬 우선, 서버 검증 가능**으로 진화한다. 사용 시작은 가볍게 유지하되 팀 경계에서는 CI가 같은 계약을 강제해야 한다.
6. **외부 전송은 기능이 아니라 데이터 경계다.** 전송 대상·크기·정책·동의를 제품의 일급 개념으로 취급한다.
7. **증거는 재구축 가능해야 한다.** scratch 상태가 사라져도 커밋된 이벤트와 git 객체로 판정을 복원할 수 있어야 한다.

## 4. 성공 지표

현재 제품에는 텔레메트리나 집계 명령이 없으므로 아래 값은 **목표 지표**이며 아직 측정되지 않는다. 원본 코드·diff·프롬프트는 수집하지 않고, 로컬 집계 또는 CI 아티팩트로 측정하는 것을 원칙으로 한다.

### 4.1 North Star

**검증된 변경 완료율(Verified Change Completion Rate, VCCR)**

```text
유효한 승인 증거와 소비 커밋이 CI에서 재검증된 완료 티켓 수
────────────────────────────────────────────────────────────
CommitGate 워크플로로 시작한 전체 완료·중단 티켓 수
```

VCCR만 높이기 위해 위험한 변경을 쉽게 승인하면 안 되므로, 아래 안전·수렴 지표를 함께 본다.

### 4.2 보호 지표와 목표

| 영역 | 지표 | 1차 목표 |
|---|---|---|
| 온보딩 | 설치→첫 승인 커밋까지 중앙값 | 10분 이하 |
| 수렴 | 설계/phase 승인까지 리뷰 라운드 P50 / P95 | ≤2 / ≤5 |
| 비수렴 | 최대 라운드 도달 후 escalation 전환율 | 100% |
| 무결성 | stale/증거 불일치 테스트 거부율 | 100% |
| 원격 강제 | protected branch 반영 커밋의 CI 증거 검증률 | 100% |
| 전송 안전 | 정책 미확인·secret scan 실패 상태의 외부 호출 | 0건 |
| 복구 | fresh clone에서 티켓 판정 재구축 성공률 | 100% |
| 진단 | 알려진 실패가 안정적 오류 코드로 분류되는 비율 | 95% 이상 |
| 업그레이드 | 사용자 수정 손실 없는 업그레이드 비율 | 100% |

## 5. 우선순위 모델

- **P0 — 신뢰 폐쇄**: 현재 가치 제안을 훼손하거나 보안·증거·복구 경계를 깨는 문제. 다음 확장보다 먼저 해결한다.
- **P1 — 채택과 운영성**: 정상 사용의 마찰·진단·업그레이드·팀 적용을 개선한다.
- **P2 — 플랫폼 확장**: provider·배포 모델·조직 기능을 넓힌다. P0/P1 계약이 안정된 뒤 진행한다.

같은 등급 안에서는 `사용자 영향 × 위험 감소 × 선행성`이 큰 항목을 먼저 하고, 구현량이 큰 항목은 독립적으로 검증 가능한 얇은 phase로 나눈다.

## 6. 우선순위 백로그

| 순위 | ID | 개선 축 | 우선순위 | 핵심 결과 | 주요 선행 |
|---:|---|---|---|---|---|
| 1 | **STR-01** | CI 증거 검증과 정책 프로필 | P0 | 직접 커밋 우회를 원격 경계에서 탐지·차단 | 증거 포맷 버전화 |
| 2 | **STR-02** | 재구축 가능한 상태·원자적 복구 | P0 | fresh clone에서도 동일한 `req:next` 판정 | 이벤트 계약 |
| 3 | **STR-03** | 외부 전송 안전 경계 | P0 | secret/크기/경로 정책 위반을 Codex 호출 전에 차단 | 오류 코드 |
| 4 | **STR-04** | 리뷰 수렴·델타 재리뷰·escalation | P0 | 무한 리뷰 제거, P95 5라운드 이내 의사결정 | 내구 이벤트·지표 |
| 5 | **STR-05** | 티켓 ID·trunk·동시성 기초 | P1 | 브랜치 간 번호 충돌과 `main` 하드코딩 제거 | 상태 재구축 |
| 6 | **STR-06** | 설치 원장·업그레이드·마이그레이션 (**부분 실현: REQ-2026-038**) | P1 | 관리 자산↔런타임 version skew를 감지하고 자산을 안전하게 갱신 — `commitgate sync`+doctor D20으로 감지·복구·문서 실현, 커밋 install 원장·3-way·rollback은 미착수 | 포맷 버전 |
| 7 | **STR-07** | 타임아웃·진단·구조화 오류 | P1 | 멈춤과 원인 유실 제거, 자동화 가능한 실패 | 오류 코드 |
| 8 | **STR-08** | 로컬 품질 리포트 | P1 | 비용·수렴·차단 원인을 코드 유출 없이 측정 | 이벤트 계약 |
| 9 | **STR-09** | 설명 가능한 단일 진입 UX | P1 | “왜 막혔고 무엇을 할지” 한 명령에서 확인 | STR-05/07 |
| 10 | **STR-10** | Stage B 런타임(**실현됨**) · Reviewer provider 확장(**미착수**) | P2 | 런타임 전환은 `0962d37`로 실현 — 남은 범위는 조직별 Reviewer 선택뿐 | (provider 부분) STR-01~09 안정화 |

## 7. 핵심 개선 설계

### 7.1 STR-01 — CI 증거 검증과 정책 프로필

**문제**: 로컬 `req:commit`은 정확하지만 직접 `git commit`으로 우회할 수 있고, 현재 CI는 타입·테스트·스모크만 실행한다.

**설계**

- `commitgate verify --base <sha> --head <sha> --json`을 추가한다.
- 범위 내 각 source commit에 대해 승인 아카이브 sha, approved tree, 소비 커밋, schema version을 검증한다.
- `solo`, `team`, `regulated` 정책 프로필을 둔다. 예: `solo`는 경고 허용, `team`은 증거 누락 FAIL, `regulated`는 전송 정책·HIGH 사람 승인까지 요구한다.
- GitHub Actions용 공식 예제를 제공하고 protected branch의 required check로 사용한다.
- 로컬 hook은 선택적 편의 기능으로만 제공한다. 보안 경계는 서버 측 CI다.

**수용 기준**

- 승인 없는 source commit, 재사용된 승인, 변조된 아카이브, 다른 tree 승인, 미지원 schema를 각각 안정적 오류 코드로 거부한다.
- 로컬 `verify`와 CI가 같은 fixture에서 byte-for-byte 동일 JSON 판정을 낸다.
- 정상 evidence-finalize 이력은 fresh clone에서 통과한다.

### 7.2 STR-02 — 재구축 가능한 상태와 원자적 복구

**문제**: `state.json`의 진행 변경은 scratch이고 정상 `req:commit`이 커밋하지 않는다. 최종 상태 수동 커밋 사례가 있지만 제품 계약이 아니며, fresh clone에서 런타임 판정을 자동 복원하지 못한다([gaps G-09](gaps-and-decisions.md)).

**설계**

- 변경 불가능한 `workflow/REQ-*/events.jsonl` 또는 동등한 버전 이벤트 원장을 도입한다.
- 이벤트 최소형: `ticket_created`, `design_approved`, `phase_approved`, `approval_consumed`, `review_escalated`, `ticket_closed`.
- `state.json`은 이벤트+git에서 만든 **캐시/뷰**로 강등하고 `req:repair --check|--write`로 재구축한다.
- 파일 쓰기는 임시 파일→fsync 가능한 범위→atomic rename 순서로 수행하고, 단일 active worktree 모델 안에서 잠금 파일을 사용한다.
- 기존 0.6.0 티켓은 approvals/archive/commit에서 가능한 범위만 이관하고, 불확실하면 추정 승인하지 않고 BLOCKED 진단을 낸다.

**수용 기준**

- source commit 직후, evidence-finalize 직전, state 삭제, fresh clone의 네 지점에서 복구 fixture를 검증한다.
- 재구축 전후 `req:next --json` 의미 결과가 동일하다.
- 이벤트 손상·중복·순서 역전은 fail-closed로 탐지한다.

### 7.3 STR-03 — 외부 전송 안전 경계

**문제**: phase diff와 design 문서가 외부로 전송되고 Reviewer가 repo 루트를 읽을 수 있으나 마스킹·secret scan·크기 상한이 없다.

**설계**

- `reviewPolicy`에 `allowedKinds`, `maxPayloadBytes`, `blockedPathPatterns`, `preReviewCommand`, `repositoryRead`를 추가한다.
- 실호출 전 `commitgate review --explain-transmission`으로 대상 파일·바이트 수·repo read 권한·정책 결과를 출력한다.
- secret scanner는 argv 배열 기반 플러그인으로 실행하고, 비-0/timeout/파싱 실패 모두 호출 전 차단한다. 이 phase의 timeout은 **scanner subprocess**에 한정하고, Codex 호출 전체 timeout·공통 오류 체계는 STR-07에서 일반화한다.
- `repositoryRead: staged-only`는 임시 격리 컨텍스트에서 최소 파일만 제공하고, `repositoryRead: root-readonly`는 현재 동작을 명시적으로 허용한다.
- 로그·오류에는 diff 본문과 scanner 원문을 기본 포함하지 않는다.

**수용 기준**

- scanner 실패·payload 초과·금지 경로·정책 부재가 Codex 프로세스 spawn 전에 차단된다.
- dry-run과 live-run의 전송 manifest 해시가 동일하다.
- Windows/POSIX에서 scanner timeout 후 자식 프로세스 트리가 남지 않는다.

### 7.4 STR-04 — 리뷰 수렴·델타 재리뷰·escalation

**문제**: NEEDS_FIX 라운드는 상한이 없고, 승인 후 한 글자 수정도 설계 전체를 stateless로 다시 리뷰한다.

**설계**

- 기본 정책: 일반 2회, P1 잔존 시 3회, 절대 최대 5회. 최대 도달은 승인도 실패도 아닌 `ESCALATE`다.
- `req:next`는 escalation에서 `AWAIT_HUMAN`과 선택지(범위 축소/위험 수용/중단/전체 재리뷰)를 반환한다.
- design 승인에는 세 문서의 blob OID도 저장한다. 후속 편집은 승인 baseline 대비 patch를 권위 아티팩트로 전달한다.
- 인터페이스·보안 경계·수용 기준 변경처럼 상호작용 위험이 큰 변경은 자동으로 전체 재리뷰한다.
- Reviewer가 delta만으로 판단 불가하면 전체 재리뷰를 요청할 수 있으나 라운드 예산을 초기화하지 않는다.

**수용 기준**

- 동일 binding의 6번째 자동 리뷰 호출은 발생하지 않는다.
- 오탈자 수준 설계 수정 fixture는 delta 경로, 보안 계약 수정 fixture는 full 경로를 선택한다.
- escalation 선택과 근거가 내구 이벤트로 남는다.

### 7.5 STR-05 — 티켓 ID·trunk·동시성 기초

- `trunkBranch`를 설정화하고 설치 시 `refs/remotes/origin/HEAD`→현재 기본 브랜치 순으로 감지한다.
- `nextReqId`는 현재 worktree뿐 아니라 로컬/원격 refs의 티켓을 스캔한다. 장기적으로 표시용 번호와 내부 UUID를 분리한다.
- branch 생성 직전에 ID·branch 존재를 다시 확인해 TOCTOU 충돌을 fail-closed로 거부한다.
- 다중 worktree 강한 일관성은 여전히 비목표로 두되, 충돌을 조용히 허용하지 않는다.

### 7.6 STR-06 — 설치 원장과 안전한 업그레이드

**문제(Stage B 기준으로 갱신)**: Stage B 전환으로 **실행 코드의 vendored 파일 드리프트는 해소됐다** — 런타임은 이제 `node_modules/commitgate`에 있고 init은 `scripts/req/**`를 복사하지 않는다([bin/init.ts](../../bin/init.ts) `planInstall`). 그러나 문제가 사라진 것이 아니라 **자리를 옮겼다**: 대상 repo에 남는 **관리 자산**(스키마·persona·config·계약·진입점)과 **런타임 패키지 버전** 사이의 skew를 자동으로 감지할 수단이 없다. `npm update commitgate`는 런타임만 올리고 자산은 그대로 둔다. `req:doctor` D19는 `req:*` 값의 **형태만** 보고 manifest·lockfile·`node_modules`·버전을 검증하지 않는다([scripts/req/req-doctor.ts](../../scripts/req/req-doctor.ts) `classifyInstallMode`) — 즉 skew는 조용히 남는다([gaps G-10](gaps-and-decisions.md)).

**설계**

- `.commitgate/installation.json`에 설치 시점 패키지 버전, 자산 파일별 원본 sha256, 설정 schema version을 기록한다.
- `commitgate upgrade --plan`은 자산을 `unchanged`, `user-modified`, `obsolete`, `new`로 분류하고, **런타임 패키지 버전과 자산 원장 버전의 skew를 명시적으로 보고**한다.
- unchanged만 자동 교체하고 user-modified는 3-way merge 제안 또는 명시적 보존을 요구한다.
- upgrade 전 백업 manifest와 rollback 명령을 출력하며, 감사 티켓 데이터는 절대 자동 삭제하지 않는다.
- 기존 Stage A 설치본은 [bin/migrate.ts](../../bin/migrate.ts)가 `package.json`의 `req:*`만 전환하는 것으로 끝난다 — 자산 업그레이드는 이 항목의 범위이며 아직 없다.

**부분 실현(2026-07-19, REQ-2026-038) — MVP manifest-free content-oracle**

- **감지·복구·문서**를 원장 없이 실현했다. **`commitgate sync`**([bin/sync.ts](../../bin/sync.ts))가 vendored 스키마 축을
  설치 패키지 사본으로 되돌리고(페르소나는 opt-in·부재 복원만·사용자 편집 불가침), **`req:doctor` D20**이 shipped vs
  vendored `machine.schema.json`을 **content-hash**로 비교해 skew를 WARN한다(FAIL 아님 — 커밋 게이트 무영향).
  README(한/영)에 "업그레이드 (0.x)" 절 신설 + 캐럿 범위 함정 문서화.
- **원장(`installation.json`)을 쓰지 않는 이유**: shipped 사본(`packageRoot/workflow`, `npm update`가 갱신)을 **살아있는
  기준**으로 삼으면 커밋 원장 없이도 skew를 잡을 수 있고, 커밋 아티팩트·rollback 기계장치가 clean-tree 요구와 충돌하지 않는다.
- **여전히 이 항목(STR-06)에 남는 것**: 커밋 install 원장(패키지 버전 + 자산별 sha)·`upgrade --plan`의 4-way 분류·백업/rollback·
  **persona 자동 3-way 구별**(현재는 다르면 보존만 — manifest 없이는 stale-kit↔사용자편집을 자동 구분 못 함)·버전 원장 skew 보고.

### 7.7 STR-07~09 — 운영성과 UX

- **STR-07**: codex timeout, 자식 트리 종료, stdout/stderr 안전 요약, 오류 코드(`CG-REVIEW-…`, `CG-STATE-…`)와 전 명령 `--json` 계약을 추가한다.
- **STR-08**: `req:report`가 라운드 수·대기 시간·outcome·오류 코드·복구 횟수만 로컬 집계한다. 코드·diff·프롬프트·파일명 원문은 수집하지 않는다.
- **STR-09**: `req:next`를 중심으로 `commitgate status <id> --explain`을 제공해 현재 판정, 실패한 불변식, 정확한 복구 명령, 외부 전송 여부를 한 화면에 보여 준다.

### 7.8 STR-10 — Stage B와 provider 확장

이 항목은 **두 부분으로 나뉘며 현재 진행 상태가 서로 다르다.**

**(a) Stage B 런타임 전환 — 실현됨(`0962d37`, REQ-2026-014).** 원래 계획은 "P0/P1 계약이 안정된 후 vendored 코어를 버전 런타임으로 옮긴다"였으나, 실제로는 P0/P1 안정화를 기다리지 않고 먼저 수행됐다. 현재 동작: `commitgate`를 대상 repo의 **devDependency로 설치**하고(`npm install -D commitgate` → `npx commitgate init`), init은 **관리 자산만 배치하며 `scripts/req/**` 실행 코드를 복사하지 않는다**([bin/init.ts](../../bin/init.ts) `planInstall`). `tsx`·`ajv`·`cross-spawn`도 대상에 주입하지 않는다 — 패키지의 runtime `dependencies`다. verb는 [bin/dispatch.mjs](../../bin/dispatch.mjs) `VERB_MODULES`가 패키지 내부 모듈로 보낸다. 기존 Stage A 설치본은 삭제 대상이 아니라 [bin/migrate.ts](../../bin/migrate.ts)의 **비파괴 마이그레이션 대상**이다(기본 dry-run, `--apply` 시 `package.json` 한 파일만 수정). **현재 동작의 SSOT는 01~12이며, 이 문단은 목표가 아니라 완료 사실의 요약이다.**

**(b) Reviewer provider 확장 — 미착수(목표 유지).** Reviewer는 `codex`를 기본 provider로 유지하되 `ReviewerAdapter` 계약에 맞는 로컬/조직 provider를 선택할 수 있게 한다. provider가 달라도 출력 schema·바인딩·증거 검증은 동일해야 한다. 이 부분은 P0/P1 계약이 안정된 뒤 진행한다는 원래 순서를 그대로 둔다.

> (a)가 끝났다고 STR-10 전체가 완료된 것이 아니다. 또한 런타임이 패키지로 옮겨진 것과 **자산↔런타임 skew를 감지·해소하는 것은 별개 문제**이며 후자는 STR-06에 남아 있다([gaps G-10](gaps-and-decisions.md)).

## 8. 실행 순서와 마일스톤

| 마일스톤 | 범위 | 종료 조건 |
|---|---|---|
| **M0 계약 고정** | 오류 코드, evidence/event schema version, 위협 모델, 지표 정의 | 호환성 fixture와 ADR 승인 |
| **M1 원격 신뢰 폐쇄** | STR-01 최소 CI verifier + STR-02 읽기 전용 rebuild/check | fresh clone 검증·복구 green |
| **M2 안전한 리뷰** | STR-03 전송 manifest/scanner timeout + STR-04 상한/escalation | 비밀 호출 0, 6번째 자동 리뷰 0 |
| **M3 운영 가능한 제품** | STR-05~09 | 충돌·업그레이드·진단·리포트 인수 기준 충족 |
| **M4 플랫폼화** | STR-10 | ~~기존 vendored 설치와 호환 마이그레이션~~ → **실현됨**([bin/migrate.ts](../../bin/migrate.ts), `0962d37`) · **provider 계약 테스트는 미충족** |

### 권장 phase 분해

각 전략 항목을 한 티켓에 모두 넣지 않는다. 예를 들어 STR-01은 (A) read-only verifier 코어, (B) CLI/JSON 계약, (C) Actions 예제·정책 프로필로 나눈다. 각 phase는 8파일 권고를 따르되, 보안 불변식이 절반만 적용되는 중간 상태는 같은 phase로 묶는다.

## 9. 의사결정 게이트

다음 질문에 “예”라고 답하지 못하면 다음 마일스톤으로 넘어가지 않는다.

1. **무결성**: 새 기능이 승인↔아티팩트↔소비 커밋 연결을 약화하지 않는가?
2. **복구성**: 중간 실패와 fresh clone에서 같은 판정을 재구축할 수 있는가?
3. **전송 안전**: 외부로 나가는 데이터와 권한을 호출 전에 설명·차단할 수 있는가?
4. **수렴성**: 자동 반복이 유한하며, 끝에서 사람의 의사결정으로 전환되는가?
5. **호환성**: 기존 아카이브와 설치본을 조용히 무효화하지 않는가?
6. **관측성**: 코드 내용을 수집하지 않고도 효과와 실패를 측정할 수 있는가?

## 10. 즉시 착수 권고

첫 실행 단위는 **STR-02의 read-only `req:repair --check` 설계 + STR-01 verifier의 증거 읽기 코어**다. 둘은 같은 증거 해석기를 공유하며, 이후 CI 강제·상태 복구·지표의 기반이 된다. 동시에 STR-03의 전송 manifest를 작은 독립 phase로 시작하면 사용자 신뢰 위험을 빠르게 낮출 수 있다. STR-10의 **남은 부분(Reviewer provider 확장)**은 이 기반이 안정될 때까지 보류한다 — 런타임 전환은 이 순서를 기다리지 않고 이미 `0962d37`로 실현됐다(§7.8).
