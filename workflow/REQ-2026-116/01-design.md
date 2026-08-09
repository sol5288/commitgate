# REQ-2026-116 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

| 사실 | 위치 | 확인 |
|---|---|---|
| 실행 코드에 GitHub API/`gh` 호출 0건 | `bin/`·`scripts/req/` 전수 grep | 실측 |
| 도구는 main 머지를 수행하지 않는다(DEC-11) — feature→delivery 로컬 병합만 | `bin/delivery.ts:776` 부근 | 읽음 |
| 통합 통제점은 `req:next` AWAIT_HUMAN 안내 문구뿐 — CI 조회 코드 없음 | `scripts/req/req-next.ts:890` 부근 | 읽음 |
| D25/D30은 **티켓 단위** trunk 도달만 판정 — 커밋 범위 검증 없음 | `scripts/req/req-doctor.ts` | 읽음 |
| 도구 커밋은 전부 trailer 보유(`CommitGate-Bookkeeping: true`) | `scripts/req/lib/bookkeeping.ts:21` | 실측(git log) |
| 승인 소비는 manifest에 `consumed_by_commit_sha`로 기록·커밋됨 | `scripts/req/lib/evidence.ts:130` | 읽음 |
| 로컬 관측 로그 선례: `workflow/.doctor-runs.jsonl`(gitignored, append-only, 판정 불변) | `req-doctor.ts:1280`·`.gitignore`·`templates/workflow.gitignore` | 읽음 |
| `sync --gitignore`가 kit 템플릿의 누락 행만 append(기설치 소비자 백필 경로) | `bin/sync.ts` gitignore 축 | 읽음 |
| STR-01이 "GitHub Actions를 required check로 사용"을 목표로 서술 | `docs/ssot-design/14-product-strategy-and-roadmap.md` §7.1 | 읽음 |
| 비대화형 진단 verb 선례(순수 판정 + 입력 수집 분리, `--json`) | `bin/check.ts` | 읽음 |

## 핵심 설계 결정

### DEC-1 · verify-range는 **보고 우선**이다 — 기본 exit 0, `--strict`만 게이트화

미입증 커밋이 있어도 기본 exit는 0이고 목록·요약을 출력한다. `--strict`일 때만 미입증 > 0 → exit 1.

**왜 fail-closed 기본이 아닌가**: 워크플로 밖 정당 커밋이 실재한다 — `init`/`setup`/`sync` 스캐폴딩
산출물의 직접 커밋은 계약이 명시한 규정 절차고(`AGENTS.template.md` 커밋 정책), 릴리스 커밋·병합 커밋도
승인 소비 SHA를 갖지 않는다. fail 기본은 첫 실행부터 오탐 차단이 된다. 이 verb의 소비자는 통합
통제점(I1/B1)의 **사람 승인자**다 — 판단 재료(미입증 목록)를 만들어 주는 것이 1차 역할이고, 게이트로
쓰고 싶은 저장소는 `--strict`를 스크립트에 넣으면 된다. doctor 관측(REQ-2026-111)이 밟은 순서와
같다: **관측을 먼저, 강제는 데이터를 본 뒤**.

### DEC-2 · 커밋 분류는 4범주·판정 순서 고정 — 입력은 로컬 git과 head 트리의 커밋된 증거뿐

`git rev-list base..head` 각 커밋을 다음 순서로 판정한다(첫 일치가 범주):

| 순서 | 범주 | 판정 |
|---|---|---|
| 1 | `merge` | 부모 2개 이상 |
| 2 | `bookkeeping` | 커밋 메시지에 trailer 줄(`^CommitGate-Bookkeeping: true`) — `BOOKKEEPING_TRAILER` 상수 재사용 |
| 3 | `approved` | SHA ∈ **head 트리**의 `workflow/REQ-*/responses/approvals.jsonl` 전수에서 뽑은 `consumed_by_commit_sha` 집합 |
| 4 | `unproven` | 위 어디에도 없음 |

- 증거는 **head 트리에서 읽는다**(`git ls-tree`로 manifest 경로 나열 + `git show <head>:<path>`) —
  워킹트리·체크아웃에 의존하지 않아 어떤 ref에도 적용되고, fresh clone에서도 동작한다.
- manifest 파싱은 관대하다: JSON 파싱 실패 행은 건너뛰고 **파싱 문제 수를 요약에 표기**한다(손상을
  숨기지 않되, 손상 하나가 전체 검증을 죽이지 않는다 — D30의 fail-open 태도와 동일).
- 경계(문서·출력에 명시): squash/rebase로 재작성된 커밋은 소비 시점 SHA와 다르므로 `unproven`으로
  나온다. 이 도구는 **주어진 범위를 있는 그대로** 검증한다 — B1 direct push/merge-commit 이력에서
  가장 유효하다. "모든 우회를 잡는다" 같은 절대 보장은 하지 않는다(단일 활성 worktree·협조적 작업자 경계).

### DEC-3 · GitHub CI opt-in의 의미는 **결과 확인(조회)**이다 — 트리거가 아니다

확정 정책은 "y일 때만 GitHub CI를 실행"과 "CommitGate가 워크플로를 자동 실행하게 만들지 마라"를 함께
요구한다. 로컬 머지 직전의 head는 push 전일 수 있어 CommitGate가 CI를 *일으킬* 방법 자체가 없고,
workflow_dispatch 트리거는 사용자 소유 워크플로의 실행 주체가 되는 길이라 기각한다. 따라서 opt-in의
구현 의미는 **head SHA에 대한 CI 결과 확인**이다(정책 12의 "CI 실행 **또는 결과 확인**"에 부합):

- 포트: `GithubCiPort { check(headSha): CiCheckResult }`.
- 기본 어댑터: `gh api "repos/{owner}/{repo}/commits/<sha>/check-runs?per_page=100"` 1회 호출(gh가
  `{owner}/{repo}`를 현재 repo에서 해석). **폴링하지 않는다**(비인증 rate limit 60/h 이력 — 이 저장소의
  실측 교훈).
- 🔴 **부분 결과를 성공으로 판정하지 않는다**(설계 리뷰 r01 P1): 이 endpoint는 기본 `per_page=30`
  첫 페이지만 반환한다. 응답의 `total_count`가 실제 수신한 `check_runs` 수보다 크면(=미조회 run 존재)
  **확인 실패**로 처리한다 — 안 본 run 중에 red가 있을 수 있으므로 ok를 낼 근거가 없다.
  `per_page=100`은 실패 빈도를 낮추는 완화일 뿐 판정 근거가 아니다(추가 페이지네이션은 하지 않는다 —
  100개 초과 check-run은 확인 실패로 정직하게 보고하고 사유에 개수를 표기한다).
- 판정(수신 전수 기준): `total_count ≤ 수신 수`이고 전부 completed+success/neutral/skipped → ok ·
  하나라도 실패/취소/미완료 → fail · **check-run 0건 → fail**("이 SHA에 대한 CI 실행이 없습니다 —
  push 전이거나 CI 미구성") · `total_count > 수신 수` → fail(부분 결과). 명시 요청에 대한 확인 불가는
  성공으로 눙치지 않는다(정책 12).
- gh 미설치·미인증·네트워크 오류 → fail(사유 그대로 표시). **이 경로는 opt-in일 때만 실행**되므로
  기본 경로는 gh·인증·네트워크 무의존(정책 13).
- 테스트는 전부 fake `GithubCiPort` 주입. 기본 어댑터 단위 테스트는 spawn 함수 주입으로 gh 무호출.

### DEC-4 · 대화형 판정과 질문 계약

- 대화형 = `stdin.isTTY && stdout.isTTY` **그리고** `--json` 아님 **그리고** 두 플래그 다 없음.
- 질문(고정 문구): `GitHub CI 검사를 실행하시겠습니까? 비용 또는 사용량이 발생할 수 있습니다. [y/N] `
- `y`/`Y`만 실행. Enter·`n`·`N`·그 외 입력 전부 생략(기본 No).
- 선택은 이번 실행에만 유효 — 어디에도 저장하지 않는다(정책 11).
- `--github-ci`와 `--no-github-ci` 동시 지정은 오류(fail-closed 인자 파싱 — `check.ts` 선례).

### DEC-5 · 감사 로그 `workflow/.verify-runs.jsonl` — 관측은 판정을 바꾸지 않는다

`.doctor-runs.jsonl`(REQ-2026-111)과 같은 성격·같은 자리·같은 규칙:

- 1실행 = 1행: `{ at, base, head, counts: {approved, bookkeeping, merge, unproven}, strict,
  ci: 'skipped-default' | 'skipped-explicit' | 'checked-ok' | 'checked-fail', exit }`.
  커밋 메시지·파일 내용·프롬프트 본문은 담지 않는다(SHA·개수·선택뿐).
- 쓰기 실패는 경고만 — 검증 판정·exit에 영향 없다.
- gitignore 2곳 동시 갱신: 루트 `.gitignore`(`workflow/.verify-runs.jsonl`) ·
  `templates/workflow.gitignore`(앵커드 `/.verify-runs.jsonl`) — REQ-025/038 자산 skew 재발 방지.
  기설치 소비자는 기존 `sync --gitignore` 축이 누락 행을 백필한다(코드 변경 불요 — kit 템플릿에 행만 추가).

### DEC-6 · 배선 — `req:next` 통합 안내에 한 줄, verb 등록은 기존 SSOT를 따른다

- `req:next`의 통합 AWAIT_HUMAN detail에 verify-range 안내 한 줄을 추가한다(죽은 기능 방지 —
  `full_review_requested` 0/323의 실측 교훈). 판정 로직(kind·exit)은 무변경, 문구만.
- verb 등록: `bin/dispatch.mjs` `VERB_MODULES`에 `'verify-range': 'verify-range.ts'` 추가.
  `req:*`가 아니므로 init 스크립트 주입 대상이 아니고, `--help` 본문(`bin/init.ts` printHelp)에
  한 줄 추가 + 기존 help↔dispatch 정합 가드가 있으면 그에 따른다.

### DEC-7 · exit 계약

| 상황 | exit |
|---|---|
| 검증 수행(미입증 있어도, CI 생략 포함) | 0 |
| `--strict`이고 `unproven > 0` | 1 |
| CI를 명시·대화형으로 요청했는데 확인 실패 | 1 |
| 사용 오류(인자·repo 아님·base 계산 불가) | 1 |

기본 base = `merge-base(trunkBranch, head)`(config `trunkBranch`, 기본 `main`), 기본 head = `HEAD`.
`trunkBranch`가 null이면 `--base` 필수(오류 안내).

## Phase별 구현

**Phase 1 (`phase-1-verify-core`)** — 순수 코어: 커밋 분류·manifest SHA 추출·판정(`scripts/req/lib/verify-range.ts`),
포트 정의(GitPort는 기존 어댑터 관례), 단위 테스트(분류 4범주·파싱 관대·strict 판정).

**Phase 2 (`phase-2-cli-ci-optin`)** — CLI verb(`bin/verify-range.ts`)+dispatch 등록+help, 대화형 [y/N]·플래그·
비대화형 기본 생략, `GithubCiPort`+gh 어댑터(spawn 주입), 감사 로그+gitignore 2파일, `req:next` 안내 한 줄,
완료 기준 10개 시나리오 테스트.

**Phase 3 (`phase-3-docs`)** — `docs/workflow.md`/`.en`·`docs/guarantees.md`/`.en`에 verify-range와
"CI는 선택·비용 고지" 추가, `docs/ssot-design/14` STR-01 정정(로컬 검증 우선·원격은 opt-in 예제로 격하),
`docs/ssot-design/09`·`12`의 해당 갭 서술 갱신, CHANGELOG.

## 변경 파일

| 파일 | 변경 | phase |
|---|---|---|
| `scripts/req/lib/verify-range.ts` | 신규 — 순수 분류·판정 | 1 |
| `tests/unit/verify-range.test.ts` | 신규 | 1·2 |
| `bin/verify-range.ts` | 신규 — CLI·프롬프트·CI 포트·감사 로그 | 2 |
| `bin/dispatch.mjs` | verb 1행 | 2 |
| `bin/init.ts` | help 1행 | 2 |
| `scripts/req/req-next.ts` | 통합 안내 1행 | 2 |
| `.gitignore` · `templates/workflow.gitignore` | 로그 파일 규칙 | 2 |
| `docs/workflow.md`/`.en` · `docs/guarantees.md`/`.en` | CI 선택·비용, verify-range | 3 |
| `docs/ssot-design/14`·`09`·`12` | STR-01·갭 정정 | 3 |
| `CHANGELOG.md` | Unreleased | 3 |

## 테스트 oracle (완료 기준 ↔ 검증)

| 완료 기준 | 오라클 | 잡는 결함 |
|---|---|---|
| 1·2·4·6·9 (생략 경로들) | fake `GithubCiPort.calls === 0` + 분류 결과 존재 | 기본값이 opt-out으로 뒤집히는 회귀 |
| 3·5 (opt-in) | `calls === 1` (정확히 1회) | 중복 호출·미호출 |
| 7 (요청 실패) | fake가 fail 반환 → exit 1 + 실패 문구 | 실패 삼킴(정책 12 위반) |
| 8 | CI 생략 실행의 결과 객체에 4범주 counts·unproven 목록 | 로컬 검증 생략 회귀 |
| 10 | 포트 주입 구조 자체 + gh 어댑터는 spawn 주입 단위 테스트 | 실 API 의존 유입 |
| DEC-3 부분 결과 | fake 응답: 수신 30건 전부 success인데 `total_count=31` → fail | 미조회 페이지의 red를 ok로 눙침 |
| DEC-1 | unproven>0: 기본 exit 0 / `--strict` exit 1 | 게이트 기본값 뒤집힘 |
| DEC-5 | 로그 쓰기 실패 주입 → 판정·exit 불변 | 관측이 게이트를 바꿈 |
| DEC-2 | trailer/approved/merge/unproven 각 1케이스 + 손상 manifest 행 | 분류·관대 파싱 회귀 |

## 하위호환·안전

- 기존 게이트·스키마·원장 형식 무변경. 새 verb는 읽기 전용 + gitignored 로그 append뿐.
- `req:next` 변경은 안내 문구 1줄 — kind·exit·판정 무변경.
- 소비자 GitHub Actions 설정을 읽기만 하고(opt-in 시 check-runs 조회) 쓰지 않는다.
- 새 gitignore 행은 kit 템플릿에 추가 → 기설치 소비자는 기존 `sync --gitignore`로 백필(강제 아님).
  백필 전이라도 로그는 루트 `.gitignore`가 아닌 소비자 쪽에 없을 수 있으나, D10 스크래치 허용목록
  밖 untracked는 리뷰를 막을 수 있으므로 **로그 쓰기는 gitignore 부재 시 건너뛴다**(fail-open,
  경고 1줄) — REQ-2026-047이 기록한 "첫 리뷰 뒤 D10 FAIL" 재발 방지.
