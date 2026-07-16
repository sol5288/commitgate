# REQ-2026-017 요구사항 — 원자적 재검수-예약 / 상한 코어

## 배경 (REQ-2026-016 재분할)

REQ-2026-016("설계 검수 무한 반복 방지 최소 안전 코어")는 라이브 검수 2/2를 소진하고 **terminal escalation으로 동결**됐다. 남은 finding:
- **P1**: plan-lint를 모든 design 리뷰 전 강제하고 meta 없으면 fail-closed 하는데, 기존 티켓·`req:new` 템플릿엔 meta가 없어 **하위호환 붕괴** → 이건 단순 lint 수정이 아니라 **기존 티켓 전체 rollout/migration 정책**이다.
- **P2**: count=3 경계 모호(3에 도달시키는 호출 vs 이미 3인 다음 preflight), 동시 실행 state **원자성** 미정의(병렬 `--run`이 상한 우회).

PM 결정(B): 재분할. 016을 동결하고, **원자적 상한 코어**만 이 REQ(A 트랙)에서 종결한다. **plan-lint는 별도 후속 REQ(B 트랙)** 로 완전히 분리한다 — 한 REQ에서 둘을 다시 다루면 최소 코어가 또 넓어진다.

## What (이 REQ의 유일한 목적)

**외부 Codex 호출을 원자적으로 예약·확정해, 재검수 상한을 동시성·프로세스 중단 상황에서도 우회 불가능하게 만드는 코어.**

### 1. review series + 3회 상한
- 재검수 count는 문서 hash가 아니라 **ticket·kind·미승인 series**에 귀속(016 DEC 승계). 승인만 새 series를 연다.
- 기본 상한 3.

### 2. 상한 경계의 정본 (016 P2#2 종결)
- **3에 도달시키는 실제 호출은 발생**하고, 그 결과에서 즉시 terminal escalation을 기록한다.
- **이미 count=3인 상태의 다음 호출**은 외부 호출 없이 escalation을 재확인하고 종료한다.
- 두 경우를 명확히 분리해 정본 동작·회귀로 고정한다.

### 3. ticket 단위 원자성 (016 P2#3 종결)
- 외부 Codex 호출 **전에 ticket lock을 획득**하고, `pending_review_attempt`를 state에 **원자적으로 기록**한다.
- pending attempt는 **count를 소비한 예약**이다.
- 호출 직후 프로세스가 종료되어도 다음 호출은 **자동 재시도하지 않고 fail-closed** 한다.
- 승인 결과면 pending을 해제하고 series를 전환한다.
- 비승인 결과면 예약 count를 확정한다.
- lock/pending이 비정상적으로 남으면 **자동 삭제·자동 재시도하지 않는다.** `req:doctor`가 진단만 하고 human recovery가 필요함을 표기한다.

### 4. container 단위 legacy fail-closed (016 승계)
- 리뷰 이력 전무 ticket만 fresh 초기화. `last_review`가 하나라도 있고 series가 없으면 design/phase 구분 없이 fail-closed.

### 5. terminal escalation + 마지막 NEEDS_FIX snapshot 보존 (016 승계)
- series에 마지막 domain-valid NEEDS_FIX snapshot 보존. 이후 INVALID/BLOCKED가 덮어도 escalation `open_findings`를 그 snapshot에서 재현. 유효 needs-fix 없으면 `[]`+사유(생성 금지).

## 명시적 제외 범위 (후속 REQ)

- **plan-lint 전체** — `req:new` 템플릿 meta 생성, 기존 ticket 적용 정책(opt-in/명시 migration), lint 활성화 시점·하위호환, L2 및 확장 lint는 **별도 후속 REQ**.
- P2 비차단 승인, reviewer persona/machine schema v2, findings ledger, phase-start/commit gate, region/amendment, legacy evidence inventory/adapter, Stage B(REQ-2026-014).
- **auto resume·auto 재검수·auto 예외·auto lock 해제** 일체.

## 설계 원칙

- 현행 reviewer contract 불변(finding 있으면 기존 보수적 차단).
- 상한은 예약(pending)으로 소비되므로 hash·이름·재실행·동시성으로 우회 불가.
- 비정상 상태(dangling lock/pending)는 **fail-closed + human recovery**, 자동 복구 금지.
- 기존 승인 무결성·staged-tree 바인딩·증거 보존 약화 없음. plan-lint는 이 REQ에 없다.

## Constraints

- 사용자 대상 응답·보고는 **한국어**. 코드·CLI·JSON 필드명·파일명은 원문 유지.
- REQ 절차: 구현 전 Codex 설계 검수 승인.
- **REQ-2026-014·015·016·main worktree는 변경하지 않는다.** 별도 worktree/브랜치.
- 초안 후 dry-run만, 외부 호출은 PM 승인 후에만.

## Done when

1. 재검수 count가 문서 hash로 초기화되지 않고 미승인 series에서 승계된다(count-not-reset 회귀 최우선).
2. count=3 도달 호출과 이미-3 상태 다음 preflight의 동작이 분리·정의·테스트된다.
3. 외부 호출 전 ticket lock 획득 + `pending_review_attempt` 원자적 기록으로, 동시 `--run`이 상한을 우회하지 못한다(병렬 회귀).
4. 프로세스 중단으로 pending이 남으면 다음 호출이 자동 재시도 없이 fail-closed 하고, `req:doctor`가 진단·human recovery를 표기한다.
5. container 단위 legacy fail-closed가 유지된다(이력 있으면 전 target 차단).
6. terminal escalation `open_findings`가 마지막 유효 NEEDS_FIX snapshot으로 보존된다.
7. **이 REQ에 plan-lint가 전혀 포함되지 않음**이 문서·코드로 확인된다.
8. 위 항목 단위·회귀 테스트 + 기존 흐름 회귀가 추가된다.
9. README/AGENTS가 상한·lock·pending·escalation 동작과 일치하고 제외(plan-lint 후속)를 명시한다.
