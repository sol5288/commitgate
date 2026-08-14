# REQ-2026-142 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

| 자리 | 현재 |
|---|---|
| `lib/review-types.ts` `ApprovalEvidence` | 승인 아카이브 **하나**(`response_path`·`response_sha256`)만 핀. **inventory 없음** |
| `lib/evidence.ts:164` 매니페스트 행 `archive_inventory?` | **finalize 시점에** 쓰인다 — 복구 판정에 쓸 수 없다(그 시점이 곧 깨진 지점) |
| `lib/evidence.ts:487` `expectedArchivePaths` | base+`rNN` **패턴**으로 디스크를 훑는다 — 무관 파일도 잡는다 |
| `review-codex.ts:2356` `findUnstagedOrUntracked` | `responses/` 하위는 **untracked 단일 아카이브만** 허용. `approvals.jsonl` 수정은 무조건 flag |
| `req-doctor.ts:643` D10 | 위 함수를 그대로 쓴다 — 복구 문맥을 모른다 |

## 핵심 설계 결정

### DEC-1 — "D10 을 끈다"가 아니라 **검증된 증거만 좁은 예외로 통과시킨다**

D10 의 보호("커밋된 증거 변조/주입 차단")는 정당하다. 조건을 완화하는 대신, **무엇이 허용되는지를
승인 시점에 못 박아 두고** 복구가 그것과 바이트 단위로 일치할 때만 연다.

| 접근 | 왜 아닌가 |
|---|---|
| `--finalize` 면 `responses/` 허용 | 플래그 하나가 게이트를 연다 — 주입 구멍 |
| 패턴(`base-rNN`)으로 허용 | 무관한 `…-r99-approved.json` 이 통과(REQ-141 r02 실측) |
| 승인 아카이브 하나만 허용 | 정상 `needs-fix`+`approved` 복구가 막힘(REQ-141 r06 실측) |
| **승인 시 핀한 inventory 와 정확히 일치** | ← 이 REQ |

### DEC-2 — `archive_inventory` 를 **승인 시점에** 만들어 state 에 핀한다

지금은 finalize 가 디스크를 훑어 만든다. 그 시점이 깨져 있으므로 **더 이른 시점**에 확정해야 한다.

```ts
export interface PinnedArchiveInventory {
  /** 이 승인에 이르는 라운드 아카이브. 경로는 repo-상대(POSIX). */
  items: { path: string; sha256: string }[]
  /** 🔴 목록 자체의 안정 해시 — 핀 이후 목록이 바뀌었는지 한 값으로 본다. */
  inventory_sha256: string
  /** 결속: 어느 리뷰의 어느 라운드 묶음인가. */
  review_kind: ReviewKind
  phase_id: string | null
  /** 승인 응답 아카이브(= `ApprovalEvidence.response_path`)가 목록 안에 있어야 한다. */
  source_response_path: string
}
```

- `ApprovalEvidence.archive_inventory?: PinnedArchiveInventory` — **선택 키**다. 옛 승인에는 없다.
- 🔴 **`inventory_sha256` 은 `items` 를 정규형으로 직렬화해 계산**한다(경로 오름차순·고정 키 순서).
  목록이 같으면 항상 같은 값이어야 두 시점 비교가 성립한다.
- 🔴 **없으면 복구를 적용하지 않는다.** 옛 승인은 근거가 없으므로 `Blocked` 다 — 근거 없이 열지 않는다.

### DEC-3 — `EvidenceFinalizationRecovery` — 깊은 모듈, 좁은 인터페이스

```ts
export function planEvidenceRecovery(input: RecoveryInput): RecoveryPlan   // Ready | Blocked
export function executeEvidenceRecovery(ready: Ready, adapters: RecoveryAdapters): RecoveryResult
```

🔴 **`req:commit --finalize` 가 유일한 호출자다.** 다른 경로가 이 모듈을 부르면 그 경로에도 예외가
생긴다 — 호출자를 하나로 묶어 두는 것이 예외를 좁게 유지하는 구조적 수단이다(소스 가드로 고정).

### DEC-3a — 🔴 진행 지점은 **scratch state 가 아니라 HEAD 에서** 읽는다

설계 리뷰 r01 P1: ④는 `approval_evidence`·`pending_evidence_for` 를 **지운 state 를 쓴 뒤** 커밋한다.
그 사이에서 죽으면 워킹 `state.json` 에 핀이 없어 plan 의 2번(`inventory` 존재)을 영영 통과 못 하고
`Blocked` 가 된다 — **이 REQ 가 고치려는 교착의 정확한 재현**이다.

**답: 판정의 정본을 durable 로 옮긴다.** REQ-2026-141 이 원장에서 얻은 결론과 같다(scratch 는 언제든
지워질 수 있고 durable 은 남는다).

| 관측 | 정본 | 비고 |
|---|---|---|
| inventory·승인 결속 | **HEAD 의 `approvals.jsonl` 행** ‖ 없으면 워킹 `state.approval_evidence` | 둘 다 있으면 **일치해야** 한다(불일치=`pin-divergent`) |
| 어디까지 진행됐나 | **HEAD** — evidence 커밋 존재 여부·소비 행 유무 | 워킹트리를 믿으면 커밋과 다른 것을 검증한다(D13/D17 전례) |

그래서 `Ready` 는 **재개 지점**을 함께 낸다.

```ts
type Ready = { kind: 'ready'; resumeFrom: 'stage' | 'evidence-commit' | 'reverify' | 'checkpoint'; … }
```

- HEAD 의 매니페스트에 이 source 커밋의 **소비 행이 이미 있으면** → 증거는 끝났다 → `resumeFrom: 'checkpoint'`.
  이 분기에서는 워킹 state 에 핀이 없어도 **정상**이다(2번을 HEAD 근거로 만족).
- 그 행이 없으면 → 아직 증거 단계 → 워킹 state 의 핀이 필요하다(없으면 `inventory-absent`).

🔴 **"핀이 없다"가 두 뜻**임을 구분하는 것이 이 DEC 의 전부다: *아직 안 만들었다*(옛 승인 — 거부)와
*이미 소비했다*(정상 완료 — no-op/checkpoint)는 완전히 다르다. HEAD 를 봐야 구별된다.

**`plan` 이 확인하는 것(전부 통과해야 `Ready`)**

| # | 검증 | 실패 시 |
|---|---|---|
| 1 | source commit tree == `approved_diff_hash` | `tree-mismatch` |
| 2 | inventory 결속이 **HEAD 또는 워킹 state** 에 있음(DEC-3a) | `inventory-absent` |
| 2b | 둘 다 있으면 **서로 일치** | `pin-divergent` |
| 3 | `inventory_sha256` 이 `items` 재계산과 일치 | `inventory-tampered` |
| 4 | 각 archive 파일의 **현재 바이트** SHA-256 이 `items` 와 일치 | `archive-mismatch` |
| 5 | `source_response_path` 가 `items` 안에 있음 | `inventory-unbound` |
| 6 | 작업 트리의 staged/unstaged/untracked 가 **허용 집합의 부분집합** | `foreign-files` |

**허용 write set** = `items[].path` ∪ `approvals.jsonl` ∪ `review-ledger.jsonl` ∪ `state.json`
(전부 **그 티켓의** 경로). 그 밖은 하나라도 있으면 거부.

🔴 **부분집합이지 동일집합이 아니다.** 중단 지점에 따라 일부만 더러울 수 있다 — 예를 들어 아카이브는
이미 커밋됐고 `approvals.jsonl` 만 남았을 수 있다. "정확히 이만큼 더러워야 한다"고 요구하면 정상 복구가
중단 지점에 따라 막힌다(REQ-141 r06 과 같은 종류의 과잉 조임).

### DEC-4 — D10 예외는 **plan 이 `Ready` 일 때만**

```ts
// req-doctor.ts
const dirty = findUnstagedOrUntracked(entries, scratch, ticketRel, recoveryAllowlist)
```

- `recoveryAllowlist` 는 **plan 이 `Ready` 일 때만** 채워진다. `Blocked` 면 `undefined` — 지금과 동일 판정.
- 🔴 **정상 경로(`finalize=false`)는 인자가 `undefined` 라 한 글자도 바뀌지 않는다.** 첫 번째 오라클이다.
- 🔴 `--finalize` 플래그는 **plan 을 계산할 자격**일 뿐 예외의 근거가 아니다.

### DEC-5 — 실행 순서와 **멱등 재개**

```
① 정확한 pathspec 으로 stage   (허용 집합만 — `git add -A` 금지)
② evidence-finalize bookkeeping commit
③ HEAD 에서 inventory·manifest·state 재검증
④ approval 소비 checkpoint commit
```

🔴 **각 단계는 "이미 되어 있으면 건너뛴다".** 재실행이 어느 지점에서든 이어붙어야 한다 —
REQ-2026-141 이 `--close-stale` 에서 얻은 교훈과 같다(그때 커밋을 append 분기에 묶어 두어
"파일엔 썼는데 커밋 전 중단"이 영영 안 풀렸다).

| 중단 지점 | 재실행이 하는 일 | 근거 |
|---|---|---|
| ① 전 | 처음부터 | HEAD 에 소비 행 없음 · 워킹 핀 있음 |
| ① 후 ② 전 | stage 는 이미 됨 → ②부터 | 〃 |
| ② 후 ③ 전 | evidence 커밋 존재 확인 → ③부터 | HEAD 에 소비 행 **있음** |
| ③ 후 ④ 전 | 재검증 통과 → ④만 | 〃 |
| 🔴 ④의 **state write 후 commit 전** | `resumeFrom: 'checkpoint'` — 워킹 state 에 핀이 없어도 정상 | HEAD 에 소비 행 있음(DEC-3a) |
| ④ 후 | 할 일 없음(no-op)으로 성공 | HEAD 에 checkpoint 커밋 있음 |

🔴 **③이 ②의 결과를 HEAD 에서 다시 본다**는 것이 중요하다. 워킹트리를 믿으면 커밋과 다른 것을
검증하게 된다 — 이 저장소가 D13/D17 에서 이미 겪은 자리다.

### DEC-6 — 이 REQ 가 **풀지 않는 것**

`hardCap` · HIGH 확인 · BLOCKED 리뷰 · 승인 tree 불일치 · 범위 불일치는 **안전 중단**이고 그대로 둔다.
이 REQ 는 **실패 복구**만 다룬다. 그 경계를 흐리면 "복구"라는 이름으로 게이트가 열린다.

## Phase별 구현

| phase | 범위 |
|---|---|
| 1 | `PinnedArchiveInventory` 타입·정규형 해시·승인 시점 생성/핀(`buildApprovalEvidence`) — 순수 + 배선 |
| 2 | `EvidenceFinalizationRecovery.plan` — 6항 검증(순수) · 거부 사유 등록부 |
| 3 | D10 allowlist 배선(DEC-4) + `execute` 멱등 재개(DEC-5) + 실 git 중단 재현 |

## 변경 파일

`lib/review-types.ts` · `lib/evidence.ts` · `lib/evidence-recovery.ts`(신규) ·
`review-codex.ts`(승인 시 핀) · `req-doctor.ts`(allowlist 인자) · `req-commit.ts`(유일 호출자) ·
테스트 다수 · `docs/workflow*.md` · `CHANGELOG.md`

## 하위호환·안전

- **옛 승인(inventory 없음)** 은 `Blocked` 다 — 동작이 지금과 같다(복구 불가). 새 승인부터 복구된다.
- **정상 경로 무회귀**가 최우선 오라클이다: D10 은 `recoveryAllowlist === undefined` 에서 지금과 완전히 동일.
- 🔴 **이 REQ 자신이 그 중단을 다시 밟을 수 있다.** 그때 phase-3 이 아직 없으면 복구할 수 없으므로,
  phase 마다 커밋 직후 `git status` 로 확인하고 중단 흔적이 보이면 즉시 보고한다.

## 정오표 (REQ-2026-143)

🔴 **본문은 승인 시점 그대로 두고 여기에만 정정을 적는다.** 본문을 고치면 "승인받은 것"이 사후에 달라져
감사 기록으로서 거짓이 된다.

| # | 어디 | 이 문서가 말하는 것 | 실제 구현 |
|---|---|---|---|
| 1 | DEC-2 코드 예시 | `items: { path: string; sha256: string }[]` | `items: PinnedInventoryItem[]` = `{ response_path; sha256 }` |
| 2 | DEC-5 `resumeFrom` | `'stage' │ 'evidence-commit' │ 'reverify' │ 'checkpoint'` | `'evidence' │ 'consume' │ 'checkpoint'` |

**#1** — 필드명을 `response_path` 로 둔 이유는 매니페스트 행의 `archive_inventory` 와 **같은 모양**이어야
DEC-3a 의 교차 대조(HEAD 행 vs 워킹 핀)가 필드 단위로 성립하기 때문이다. `lib/review-types.ts` 의
`PinnedInventoryItem` 이 정본이고 `evidence.ts` 의 `ArchiveInventoryItem` 은 그 별칭이다.

**#2** — `finalizeEvidenceAndConsume` 이 stage·커밋·재검증을 **이미 HEAD 기준 멱등**으로 처리하므로
(REQ-2026-052 phase-3a P1) 그 안을 다시 쪼개면 **진행 지점이라는 개념이 두 벌**이 되고 둘이 갈라진다.
DEC-5 의 4단계 실행 순서는 그대로이며, 표의 6개 중단 지점과 3개 값의 대응표는
`scripts/req/lib/evidence-recovery.ts` 의 `RecoveryResumeStage` 주석에 있다.
