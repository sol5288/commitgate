# REQ-2026-057 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

### 상태가 쓰이는 지점과 커밋되는 지점의 어긋남

| 경계 | 상태 쓰기 | 커밋되는 것 | 상태 커밋? |
|---|---|---|---|
| design 승인 | `review-codex.ts:2426` `writeState(persistedState)` — **커밋보다 먼저** | `durableDesignEvidence` 경로가 아카이브·`approvals.jsonl`·ledger를 pathspec 커밋 | ❌ pathspec에 없음 |
| phase 승인 소비 | `req-commit.ts:567` `writeState(consumeState(...))` — **evidence 커밋보다 나중** | `finalizeEvidenceAndConsume`가 아카이브·`approvals.jsonl`·ledger·dev-complete 커밋 | ❌ 시점상 불가 |

두 경계 모두 상태가 워킹 변경으로만 남는다. design 경로는 **순서는 맞고 pathspec에서 빠졌을 뿐**이고,
phase 경로는 **쓰기가 커밋보다 뒤**라 pathspec에 넣을 수조차 없다.

### 지켜야 하는 기존 불변식

1. **source 커밋 = 코드만**(`docs/guarantees.md`). D9는 staged tree와 승인 tree의 동일성을 본다.
2. **evidence 커밋 = `responses/` 만** — `req-commit.ts:558`의 `choreLeak` 가드가
   `responses/` 밖 staged를 전부 거부한다(주석: "코드/state 누수").
3. **복구 마커 규약** — `markPendingEvidence`가 `pending_evidence_for`를 심고(`req-commit.ts:748`),
   `consumeState`가 `approval_evidence`와 함께 **그것을 제거한다**(`:122`). `--finalize` 복구는 그 마커
   (없으면 HEAD==승인 source인지 대조해 재구성)와 `approval_evidence`에 의존한다(`recoveryClassify`).
4. **pathspec 커밋 관용구가 이미 있다** — `precallCommitLedgerRow`(`review-codex.ts:1325`)와
   `evidence-ports.commitPaths`가 `git add -- <paths>` → `git commit -- <paths>`로 **인덱스를 건드리지 않고**
   특정 경로만 커밋한다. 설계 문서를 stage한 채 리뷰를 도는 정상 경로가 이 관용구에 의존한다.

## 핵심 설계 결정

### DEC-1. 상태는 **자기 커밋**으로 내구화한다 — 증거 커밋에 끼워 넣지 않는다

`<ticketRel>/state.json` **한 경로만** 담는 pathspec 커밋을 승인·소비 경계마다 발행한다.

왜 증거 커밋에 합치지 않는가:

- 합치려면 `choreLeak` 가드(불변식 2)를 완화해야 한다. 그 가드는 "코드/state 누수"를 막는 **마지막 방어선**이고,
  완화 조건을 정확히 좁히는 일(어느 티켓의 어느 경로인지)은 가드의 판정 로직을 복잡하게 만든다.
- phase 경로에서는 애초에 불가능하다. 소비된 상태는 evidence 커밋 **뒤에** 확정되기 때문이다(아래 DEC-2).

**대가**: 티켓당 커밋이 경계 수만큼 늘어난다(설계 승인 1 + phase당 1). 이 저장소는 이미 ledger
attempt-opened·design-finalize·evidence-finalize chore 커밋을 경계마다 발행하므로 이력 관용구가 일관된다.

### DEC-2. **순서를 바꾸지 않는다.** consume은 지금처럼 evidence 커밋 **뒤**에 쓰고, 그다음 checkpoint를 커밋한다

"consume을 커밋 앞으로 옮겨 같은 커밋에 싣자"는 안은 **복구를 깨뜨린다**. `consumeState`는
`pending_evidence_for`와 `approval_evidence`를 제거하므로(불변식 3), evidence 커밋이 실패하면
디스크 상태는 이미 소비됐는데 증거는 없고 `--finalize`가 근거로 삼을 마커도 사라진다.

그래서 최종 순서는:

```
phase 경로:  source 커밋(코드만) → pending 마커 → evidence 커밋(responses/) → consume 쓰기 → **state checkpoint 커밋**
design 경로: 상태 쓰기 → ledger 행 → design evidence 커밋(responses/) → **state checkpoint 커밋**
```

**원자성 손실의 범위**: evidence 커밋과 checkpoint 커밋 사이에서 중단되면 `state.json`이 dirty로 남는다 —
그것은 **정확히 오늘의 동작**이므로 회귀가 아니고, `req:commit --finalize` 재실행이나 다음 경계의 checkpoint가
그대로 흡수한다(DEC-4 멱등).

### DEC-3. checkpoint는 **도구가 방금 쓴 값**만 커밋한다(임의 편집분 무비판 커밋 금지)

헬퍼는 커밋 직전에 **디스크의 `state.json`을 다시 읽어, 호출자가 방금 `writeState`한 상태 객체와
직렬화 결과가 바이트 동일한지** 확인한다. 다르면 fail-closed로 중단한다(외부 편집·경쟁 쓰기 감지).

추가로 `state.id`가 대상 티켓 디렉터리와 일치하는지 확인한다 — 다른 티켓의 상태를 이 티켓의 커밋에
싣지 않는다.

> 이 검증은 "상태가 승인 증거와 의미상 정합한가"를 다시 판정하지 **않는다.** 그 판정은 이미
> `processResponse`·`consumeState`·evidence preflight가 했고, checkpoint는 그 결과를 **그대로 보존**하는
> 역할이다. 검증을 이중화하면 두 판정이 갈라질 때 어느 쪽이 정본인지 모호해진다.

### DEC-4. 멱등 — 변경이 없으면 커밋하지 않는다

`git status --porcelain -- <ticketRel>/state.json`이 비어 있으면 **무동작**(빈 커밋 금지). 그래서:

- 같은 경계를 두 번 지나도(멱등 재실행·`--finalize` 반복) 커밋이 늘지 않는다.
- 이미 checkpoint된 상태로 다음 경계에 도달하면 조용히 지나간다.

### DEC-5. 배선 지점은 **두 곳뿐**이다

| 지점 | 위치 | 커밋 메시지 |
|---|---|---|
| design 승인 | `review-codex.ts` — durable design evidence 커밋 직후 | `chore(<id>): state checkpoint — design 승인` |
| phase 소비 | `req-commit.ts` `finalizeEvidenceAndConsume` — `writeState(consumeState(...))` 직후 | `chore(<id>): state checkpoint — phase <id> 소비` |

리뷰 시도 중간 상태(attempt 증가·NEEDS_FIX 등)는 **내구화하지 않는다.** 그 지점들은 티켓 내부의 과도
상태이고, 다음 경계에서 함께 커밋된다. 완료 기준 1·2가 요구하는 것은 "완주 직후 clean"이지 "항상 clean"이 아니다.

### DEC-6. 병합 충돌 표면

`state.json`이 tracked·커밋 대상이 되면 브랜치 간 병합에서 충돌할 수 있다. ledger의 `.jsonl`은
append-only라 union 병합이 되지만 `state.json`은 통짜 JSON이다.

이 도구의 보장 범위가 **단일 활성 워크트리 · 협조적 워커**이고 티켓 디렉터리는 티켓별로 갈라지므로,
서로 다른 REQ가 같은 `state.json`을 건드리는 경우는 없다. 같은 티켓을 두 브랜치에서 동시에 진행하는
것은 이미 지원 범위 밖이다. 이 사실을 설계 기록으로 남기고 별도 장치(`.gitattributes` merge 전략 등)는
두지 않는다 — 지원하지 않는 시나리오를 위한 기계장치는 부채다.

## Phase별 구현

### Phase 1 — checkpoint 헬퍼 + design 경로 (`phase-1-checkpoint-design-path`)

새 leaf 모듈 `scripts/req/lib/state-checkpoint.ts`에 `commitStateCheckpoint`를 두고 design 경로에 배선한다.
leaf로 두는 이유: `review-codex`·`req-commit` 양쪽이 import해야 하는데, 한쪽에 두면 순환이 생긴다
(`lib/scratch.ts`가 같은 이유로 leaf다).

### Phase 2 — phase 경로 + 완주 회귀 (`phase-2-checkpoint-phase-path`)

`req-commit.ts`의 소비 직후에 배선하고, **완료 기준 1·2를 직접 검증하는 회귀 테스트**를 추가한다:
티켓을 완주시킨 픽스처에서 ① `git status`가 clean이고 ② 이어지는 `req:new --run`의 clean-tree 검사가
통과하는지. "state가 커밋된다"만 보는 테스트는 공허하다 — 마지막 쓰기가 마지막 커밋 뒤에 남는
바로 그 결함을 놓친다.

## 변경 파일

| Phase | 파일 | 변경 |
|---|---|---|
| 1 | `scripts/req/lib/state-checkpoint.ts` | **신규** — `commitStateCheckpoint`(멱등·바이트 대조·pathspec 커밋) |
| 1 | `scripts/req/review-codex.ts` | design evidence 커밋 직후 배선 |
| 1 | `tests/unit/state-checkpoint.test.ts` | **신규** — 멱등·바이트 불일치 거부·id 불일치 거부·pathspec 격리 |
| 2 | `scripts/req/req-commit.ts` | 소비 직후 배선 |
| 2 | `tests/unit/req-commit.test.ts` | 완주 후 clean + 후속 `req:new` 통과 회귀 |

## 하위호환·안전

- **게이트 완화 0건**: D9·D10·`choreLeak` 가드·승인 규칙 모두 불변. 추가되는 것은 티켓 `state.json`
  단일 경로를 담는 커밋뿐이다.
- **source 커밋 불가침**: checkpoint는 pathspec 커밋이라 인덱스를 건드리지 않는다. 사용자가 stage해 둔
  코드/문서는 그대로 남는다(기존 ledger 커밋과 같은 관용구).
- **복구 경로 불변**: 순서를 바꾸지 않으므로 `pending_evidence_for`·`--finalize`·`recoveryClassify`의
  전제가 그대로다.
- **기존 티켓**: 이미 진행 중인 티켓은 다음 경계에서 checkpoint가 붙는다. 소급 커밋은 하지 않는다.
- **실패 시 열화 방향**: checkpoint 커밋이 실패해도 오늘과 같은 상태(dirty state.json)로 남을 뿐,
  증거·승인은 이미 커밋돼 있다.
