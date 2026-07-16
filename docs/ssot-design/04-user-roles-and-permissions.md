# 04. 역할·권한·통제점

CommitGate에는 로그인 세션·토큰·RBAC 같은 **애플리케이션 인증/인가가 존재하지 않는다**(`해당 없음` — 로컬 CLI 도구). "권한"은 (1) 협력 계약상의 **역할**, (2) fail-closed **게이트**, (3) 사람만 통과시킬 수 있는 **통제점**으로 구현된다.

## 1. 역할 매트릭스

| 역할 | 주체 | 할 수 있는 것 | 할 수 없는 것 |
|---|---|---|---|
| **Builder** | AI 에이전트(Claude/Cursor) | 티켓 생성, 설계·구현, `git add`, 리뷰 실행, `req:next` 루프 | `req:commit` 경로에서 승인 없는 커밋(단, `git commit` 직접 실행은 게이트를 우회 — 하드 강제 아님), 통제점 자기승인, 승인 문장 확대해석 |
| **Reviewer(PM)** | Codex CLI | 구조화 응답으로 승인/차단·findings·observations 판정 | 코드 수정(read-only 샌드박스), 게이트 우회 |
| **Human** | 사람 | 통제점 승인 문장 발화, `req:commit --run`·push·publish 실행/확인 | (도구가 대신 못 하는 판단을 위임받음) |

역할 계약의 정본은 [AGENTS.template.md](../../AGENTS.template.md)이며, `.claude/`·`.cursor/`·`CLAUDE.md` 진입점은 이를 가리키는 **얇은 포인터**다([08-architecture-and-module-spec.md](08-architecture-and-module-spec.md) §2.10).

## 2. 인증 수명주기

- **애플리케이션 인증**: 없음. `해당 없음`.
- **Reviewer 인증**: Codex CLI가 `codex login`으로 자체 관리. CommitGate는 자격증명을 읽거나 저장하지 않는다. 미인증/실패 시 리뷰 명령이 fail-closed로 실패(조용한 승인 없음, [README.md](../../README.md) FAQ).
- **세션/토큰 저장 위치·갱신·폐기**: Codex CLI 소관이며 저장소로는 `확인 불가`.

## 3. 인가 시행 지점(fail-closed 게이트)

인가는 "누가"가 아니라 "무엇이 일관적인가"로 강제된다. 상세 규칙은 [07-business-rules-and-state-machines.md](07-business-rules-and-state-machines.md).

| 시행 지점 | 무엇을 막는가 | 근거 |
|---|---|---|
| 리뷰 승인 규칙 | `findings`가 있으면 승인 불가(R10) | [scripts/req/review-codex.ts](../../scripts/req/review-codex.ts) `validateVerdict` |
| 승인 바인딩(D9) | 승인 후 staged tree가 바뀌면 stale로 차단 | [scripts/req/req-doctor.ts](../../scripts/req/req-doctor.ts) `finalizeD9Check` |
| clean-tree(D10) | 리뷰/커밋 시점 미스테이지·미추적 존재 차단 | `findUnstagedOrUntracked` |
| 설계 우선(D13) | 유효 설계 승인 없이 허용 목록(현재 티켓 문서·scratch·현재 티켓 responses) 외 변경 차단 | `req-doctor` D13 |
| feature branch(D11) | `main`에서 또는 prefix 미준수 브랜치에서 커밋 차단 | `req-doctor` D11 |
| 증거 검증(D6/D16/D17) | 증거 sha 불일치·손편집·부재 차단 | `evidenceProblems` |
| 리뷰 전 clean-tree | 리뷰어에게 미승인 컨텍스트 노출/오염 차단 | `review-codex` `findUnstagedOrUntracked` |
| Codex 샌드박스 | 리뷰어가 코드/인덱스 변경 차단(read-only) | [scripts/req/lib/adapters.ts](../../scripts/req/lib/adapters.ts) |

## 4. 통제점(사람만 통과)

각 통제점은 **고유한 승인 문장**을 가지며, 한 통제점의 승인은 다음으로 **이월되지 않는다**([AGENTS.template.md](../../AGENTS.template.md) §5). 승인 문장이 모호하면 확대 해석하지 않고 다시 묻는다.

| # | 통제점 | 멈추는 시점 | 승인 문장 |
|---|---|---|---|
| — | HIGH commit 실행 | `req:commit --run` 직전(HIGH 티켓) | `req:commit --run 승인`(+ `user_commit_confirmed` 기록) |
| `I1` | 통합 — PR 열기(경로 A) | feature branch push + PR 생성 직전 | `feature branch push + PR 생성 승인` |
| `I2` | 통합 — PR 머지(경로 A) | required checks green 확인 후 머지 직전 | `required checks green 확인 후 PR merge 승인` |
| `B1` | 통합 — direct push(경로 B) | protected branch에 direct push 직전 | `branch protection bypass를 사용한 direct push 승인` |
| `R1` | 릴리즈 — tag | 버전 tag 생성·push 직전 | `tag 생성·push 승인` |
| `R2` | 릴리즈 — publish | 패키지 publish 직전 | `npm publish 승인` |
| `R3` | 릴리즈 — release | GitHub release 생성 직전 | `GitHub release 생성 승인` |

- protected branch 반영 경로는 **A(PR 경유, 선택)**와 **B(direct push)** 둘 다 유효하다. PR은 의무가 아니라 선택이다.
- **경로 B에서 CI는 사후 검증**이다(push 이후 실행). 그 green은 반영을 *사전에* 막아 준 것이 아니므로 보고에서 생략하지 않는다.
- push 응답의 `remote: Bypassed rule violations`는 우회가 **이미 일어난 뒤**의 사후 신호이므로 사전 정지 근거가 될 수 없다 — push 전에 멈춘다.
- `R1/R2/R3`는 반영 이후 CI green 확인 뒤 각각 따로 요청한다. 셋을 하나의 "릴리즈 승인"으로 뭉뚱그리지 않는다.

## 5. HIGH 위험 커밋의 사람 확인

`risk_level="HIGH"` 티켓은 `req:commit --run`이 `userConfirmGate`로 차단된다. 통과하려면 `state.user_commit_confirmed`에 유효 레코드(`confirmed:true` + `method` + ISO `confirmed_at`)가 있어야 한다([scripts/req/req-commit.ts](../../scripts/req/req-commit.ts)). **어떤 CLI도 이 레코드를 자동 생성하지 않는다** — 사람이 직접 기록해야 한다(위조 불가 증명이 아니라 감사 기록이며, 가장 강한 보장은 사람이 직접 `req:commit`을 실행하는 것).

## 6. 민감 흐름
- **권한 상승/계정 복구/탈퇴**: 애플리케이션 개념이 없어 `해당 없음`.
- **가장 민감한 외부 노출**: 리뷰 시 리뷰 대상(phase=staged diff, design=00/01/02 본문) + repo 루트(read-only)가 Codex(OpenAI)로 전달됨. 이는 인가가 아니라 **데이터 유출 경계**이며 [09-security-and-reliability.md](09-security-and-reliability.md) §2에서 다룬다. 리뷰 전 staged 내용 확인은 도구가 강제하지 않는 **Builder의 의무**([AGENTS.template.md](../../AGENTS.template.md) §6).

## 7. 역할 분리의 보장 수준

Reviewer가 Builder와 다른 프로세스/모델이라는 점은 자기검토 편향을 줄이지만, 조직 IAM 수준의 separation of duties는 아니다.

- 같은 로컬 사용자가 persona·schema·config·state를 수정할 수 있다. git과 doctor가 많은 변조를 탐지하지만 사람 신원 자체를 인증하지 않는다.
- HIGH 확인의 `method`는 감사 문자열이지 서명된 사용자 신원 증명서가 아니다.
- 통합·릴리즈 승인 문장은 계약이며 CLI가 원격 권한 주체를 검증하지 않는다.
- Codex 계정과 Builder 계정이 실제로 다른 사람/조직인지 CommitGate는 알 수 없다.

따라서 현재 권한 모델은 **협조적 에이전트의 행동 분리 + 아티팩트 무결성**이다. 팀/규제 환경의 강한 인가는 CI identity, protected branch, 서명된 provenance와 결합해야 하며 STR-01의 정책 프로필에서 다룬다([14-product-strategy-and-roadmap.md](14-product-strategy-and-roadmap.md)).
