# REQ-2026-169 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

`scripts/req/req-new.ts:243`

```
scanIntake(root, ticketRootRel, gitFn, exclude)
  └ listHeadTicketIds()                        → git ls-tree -d           (1회)
  └ 티켓마다 scanTicketIntake(root, ticketRel, id)
       └ createEvidencePorts(root, `${ticketRel}/responses`)   ← 포트를 티켓마다 새로 만든다
       └ ports.headText(state.json)                            → git show (1)
       └ ports.headText(responses/approvals.jsonl)             → git show (1)
       └ ports.headText(responses/ticket-close.jsonl)          → git show (1)
       └ ports.headText(responses/review-ledger.jsonl)         → git show (1)
       └ verifyCommittedEvidenceIntegrity({ticketRel, manifestText, ports})
            └ verifyCommittedDesignEvidence({ticketRel, ports})
                 ├ ports.headText(state.json)                  → git show (1)  ← 위와 중복 조회
                 ├ ports.headText(responses/approvals.jsonl)   → git show (1)  ← 중복
                 ├ ports.headBlobSha256(design 승인 archive)   → git cat-file (1)
                 ├ ports.headArchivePaths(responses/)          → git ls-tree  (1)
                 └ ports.headBlobSha256(inventory 항목마다)    → git cat-file (N)
            └ verifyPhaseArchives(manifest, ports.headBlobSha256)
                 └ phase 행마다 headBlobSha256                 → git cat-file (M)
```

`lib/evidence-ports.ts` 의 세 `head*` 포트는 전부 `execFileSync('git', ...)` 1회다.
**호출 1회 = 프로세스 1개**이고, Windows 에서 그 비용이 ~197ms 다.

포트가 읽는 경로는 **전부 `<ticketRoot>/REQ-*/` 아래**로 닫혀 있다:
- `headText` → `<ticket>/state.json`, `<ticket>/responses/*.jsonl`
- `headBlobSha256` → 매니페스트의 `response_path`. `validateManifest` 가 `<ticketRel>/responses/` 로
  **경로 confinement 를 강제**한다.
- `headArchivePaths` → `<ticket>/responses/`

즉 **HEAD tree 에서 `<ticketRoot>/` 하위를 한 번 열거하면 필요한 blob 의 전체 집합을 미리 알 수 있다.**
이것이 이 설계가 성립하는 근거다.

## 핵심 설계 결정

### DEC-1 — 판정은 손대지 않는다. **포트만 바꾼다.**

`classifyIntake`·`deriveBaseState`·`verifyCommittedEvidenceIntegrity`·`verifyCommittedDesignEvidence`·
`verifyPhaseArchives` 는 **한 줄도 바꾸지 않는다.** 이들은 이미 `EvidencePorts` 를 주입받으므로,
같은 인터페이스의 **다른 구현**을 넣으면 된다.

🔴 성능 작업이 판정 코드를 건드리기 시작하면, 회귀가 났을 때 "느려서 고친 것"과 "판정이 바뀐 것"을
분리할 수 없다. 경계를 포트에 둔다.

### DEC-2 — 배치 포트는 **기존 포트의 데코레이터**다(교체가 아니라 덮어쓰기)

```ts
createBatchedIntakePorts(base: EvidencePorts, view: BatchView, ticketRel): EvidencePorts
// = { ...base, headText, headBlobSha256, headArchivePaths }  ← 3개만 덮어쓴다
```

나머지 포트(`readText`·`writeText`·`sha256`·`listArchiveNames`·`headCommitSha`·`commitPaths`)는
**실물 그대로** 남는다. intake 는 그것들을 쓰지 않지만, 스텁으로 두면 나중에 판정이 그 포트를 쓰게
됐을 때 조용히 틀린 값을 받는다. 덮어쓰지 않은 것은 **원래 동작 그대로**라는 것이 이 형태의 요점이다.

### DEC-3 — 프리페치 집합은 **경로 패턴**으로 정한다(매니페스트를 먼저 읽지 않는다)

```
<ticketRoot>/REQ-<4자리>-<숫자>/state.json
<ticketRoot>/REQ-<4자리>-<숫자>/responses/**
```

매니페스트를 읽어야 `response_path` 를 알 수 있지만, 그러려면 매니페스트를 먼저 읽어야 하는
순환이 생긴다. **경로 confinement 덕분에** 위 두 패턴이 요청 가능한 모든 경로의 **상위집합**이므로
1-pass 로 끝난다.

`.md` 설계 문서(이 저장소 workflow 의 5.3MB 중 대부분)는 **프리페치하지 않는다** — intake 가 읽지 않는다.

### DEC-4 — 🔴 `cat-file --batch` 요청은 **OID 로 한다**. `<ref>:<path>` 로 하지 않는다.

이 저장소(166 티켓 · 1,608 blob)에서 실측:

| 요청 형식 | `cat-file --batch` 소요 |
|---|---|
| `HEAD:<path>` — 기존 `lib/git-batch.ts` 의 `readBlobsAtRef` 방식 | **5,859 ms** |
| OID — `ls-tree -r` 가 준 값 | **199 ms** |

`<ref>:<path>` 는 요청마다 트리를 되짚어야 해서 **29배** 비싸다. `ls-tree -r`(`--name-only` 없이)이
경로와 OID 를 함께 주므로 추가 비용이 없다.

🔴 그래서 **기존 `readBlobsAtRef` 를 그대로 재사용하지 않는다.** 재사용하면 목표(10초)는 넘기지만
30배를 버린다. 대신 `lib/git-batch.ts` 에 **OID 요청용 함수를 추가**하고 파서(`parseCatFileBatchOutput`)는
그대로 공유한다 — 파서는 이미 Buffer 기준 프레이밍으로 테스트돼 있다.

`bin/report.ts`·`bin/verify-range.ts`·`bin/integrate.ts` 의 기존 경로-요청 호출부는 **이번에 바꾸지 않는다**
(요청 집합이 작고, 범위 밖이다). 관측 사실만 여기 남긴다.

### DEC-5 — 🔴 `-z` 열거는 `GitAdapter.exec` 를 거치지 않는다

`GitAdapter.exec` 는 계약상 결과의 **후행 공백을 제거**한다(`git status --porcelain` 의 선행 공백
보존이 목적). `-z` 출력의 마지막 NUL 이 잘리면 마지막 항목의 프레이밍이 달라진다.
`lib/evidence-ports.ts` 의 `headBlobSha256` 이 **같은 이유로** 이미 어댑터를 우회하고 있다 —
어댑터 우회가 아니라 **다른 계약**이 필요해서다.

### DEC-6 — 캐시 미스는 **폴백**이지 `null` 이 아니다

배치는 **캐시**이지 대체가 아니다.

| 요청 경로 | 처리 |
|---|---|
| 프리페치에 있음 | 캐시된 Buffer 사용 (git 호출 0) |
| `<ticketRoot>/` **아래**인데 열거 목록에 없음 | HEAD 에 없는 것이 **확정** → `null` (git 호출 0) |
| `<ticketRoot>` **밖** | 🔴 **원래 포트로 폴백**(git 호출 1) |

3번째 줄이 핵심이다. 매니페스트가 confinement 를 어긴 경로를 담고 있으면(`validateManifest` 가
corrupt 로 잡을 상태), 배치 구현이 그것을 무조건 `null` 로 만들면 **옛 구현과 다른 값**을 낸다.
같은 입력에 같은 결과라는 DEC-1 이 깨지므로 폴백한다. 정상 데이터에서는 **한 번도 실행되지 않는다.**

### DEC-8 — 🔴 열거는 **하나뿐**이다. 티켓 목록도 그 재귀 열거에서 파생한다.

design-r01 P1: 현재 `scanIntake` 는 `listHeadTicketIds()` 로 `ls-tree -d` 를 **따로** 돌린다.
배치 읽기만 얹으면 정상 경로가 `ls-tree -d` + `ls-tree -r` + `cat-file` = **3 프로세스**가 되어,
완료 기준("2개")이 거짓이 된다. 열거를 하나로 합친다.

```
listHeadTreeEntries(cwd, ticketRoot)   → 재귀 blob 목록 (git 1회)
   ├ ticketIdsFromEntries(entries, ticketRoot)  → 티켓 id 집합 (순수 · git 0회)
   └ intakePrefetchPaths(entries, ticketRoot)   → 프리페치 대상 (순수 · git 0회)
```

**동등성 논증**: git 은 **빈 디렉터리를 추적하지 않는다.** 따라서 HEAD 에 존재하는 모든 티켓
디렉터리는 blob 을 최소 1개 담고 있고, `ls-tree -r` 의 경로 접두에 반드시 나타난다.
`ls-tree -d`(직계 자식 tree 열거)와 **같은 집합**이다.

🔴 이 동등성을 **산문으로만 두지 않는다** — 실 git 저장소에서
`ticketIdsFromEntries(...) === listHeadTicketIds(...)` 를 단정하는 테스트로 고정한다.
(옛 함수의 후행 슬래시 함정은 그 함수의 기존 테스트가 계속 지킨다.)

🔴 `listHeadTicketIds` 는 **삭제하지 않는다** — `req:reconstruct`(`req-reconstruct.ts:87`)가 여전히
쓰는 살아 있는 호출부다. 그쪽은 열거가 1회뿐이라 이 REQ 의 대상이 아니다.

### DEC-7 — 회귀 오라클: 실 git e2e **유지** + 호출 횟수 **계수**

두 가지가 **모두** 필요하다.

1. **정확성**: `tests/unit/req-new-intake.test.ts`(실 git · 아카이브 삭제/변조/주입/read-only/생성 전 차단)
   의 단정을 **한 줄도 고치지 않는다.** 고쳐야 한다면 그건 판정이 바뀐 것이고 DEC-1 위반이다.
2. **배칭이 실제로 쓰였는가**: 위 테스트는 배치가 통째로 폴백으로 되돌아가도 **전부 녹색**이다
   (결과가 같으니까). 이 저장소가 반복해 데인 **공허한 오라클**이다.
   → `scanIntake` 가 내는 **모든** git 실행을 계수 가능한 형태로 주입받고,
     "티켓 N개 스캔 = git 호출 2회"를 단정하는 테스트를 새로 넣는다. N 을 늘려도 2 여야 한다.
   🔴 **일부만 세면 또 공허해진다**: 열거를 `gitFn` 으로, 배치를 별도 포트로 주입해 놓고 한쪽만
     계수하면, 다른 쪽이 티켓마다 스폰해도 테스트가 녹색이다. 계수 지점은 **두 경로를 모두 덮어야**
     하고, `ls-tree -d` 가 남아 있으면 그 자리에서 3이 나와 즉시 red 여야 한다(DEC-8).

🔴 이 저장소의 반복 교훈: **배선 끊김은 순수 테스트가 못 잡는다.** 계수 테스트는 배선을 본다.

## Phase별 구현

### phase-1 — 배치 리더 + 배치 포트 (`phase-1-batch-ports`)

- `lib/git-batch.ts`: `readBlobsByOid(cwd, oids)` 추가(파서 재사용). 기존 `readBlobsAtRef` 는 그대로.
- `lib/intake-batch.ts` (신규):
  - `listHeadTreeEntries(cwd, ticketRootRel)` — `ls-tree -r -z HEAD -- <root>/` → `{oid, type, path}[]`
    (execFileSync 직접 — DEC-5)
  - `ticketIdsFromEntries(entries, ticketRoot)` — DEC-8 티켓 id 파생(순수)
  - `intakePrefetchPaths(entries, ticketRoot)` — DEC-3 패턴 필터(순수)
  - `createBatchView(entries, blobs, ticketRoot)` — 경로 집합 + Buffer 맵
  - `withBatchedHeadReads(base, view)` — DEC-2 데코레이터(순수 로직 + 폴백)
- 단위 테스트: 프리페치 필터·폴백 판정·`headArchivePaths` 필터를 **git 없이** 검증.

### phase-2 — `scanIntake` 배선 + 계수 오라클 (`phase-2-wire-and-count`)

- `lib/intake.ts`: `scanIntake` 가 phase-1 을 써서 뷰를 1회 만들고 티켓마다 주입.
  🔴 `listHeadTicketIds` 호출을 **제거**하고 `ticketIdsFromEntries` 로 대체(DEC-8) — 그 함수 자체는
  `req:reconstruct` 를 위해 남긴다.
  `scanTicketIntake(root, ticketRel, id, portsOverride?)` — **선택 4번째 인자**로만 확장해
  `req:commit`·`req:doctor` 의 기존 3인자 호출을 그대로 둔다.
- 계수 테스트(DEC-7-2) + 동등성 테스트(DEC-8) + 기존 `req-new-intake.test.ts` 무수정 통과.
- 이 저장소에서 `req:new` dry-run 실측을 기록한다(완료 기준 3).

## 변경 파일

| 파일 | 성격 |
|---|---|
| `scripts/req/lib/git-batch.ts` | 추가(OID 요청 함수) — 기존 함수 불변 |
| `scripts/req/lib/intake-batch.ts` | **신규** |
| `scripts/req/lib/intake.ts` | `scanIntake` 배선(열거 단일화 · DEC-8) · `scanTicketIntake` 선택 인자 |
| `tests/unit/intake-batch.test.ts` | **신규**(순수) |
| `tests/unit/req-new-intake.test.ts` | 계수 테스트 **추가만** — 기존 단정 무수정 |

`lib/evidence.ts`·`lib/close-proof.ts`·`lib/evidence-ports.ts`·`req-new.ts` 는 **변경 없음**.

## 하위호환·안전

- **게이트가 약해지지 않는다**: 판정 함수·입력(HEAD blob)이 동일하다. 차이는 그 바이트를 어떻게
  가져오는가뿐이다. 손상 탐지(삭제·SHA 변조·주입)는 전부 판정 쪽에 있고 그대로다.
- **실패 방향**: 배치 읽기가 실패하면(`spawn` 오류·exit≠0) **throw** 한다 — 조용히 빈 뷰로 계속하면
  모든 티켓이 "HEAD 에 없음 = legacy" 로 보여 **게이트가 통째로 우회된다.** 읽지 못한 것은
  "없음" 이 아니라 "모름" 이고, 모르면 멈춘다.
- **read-only 유지**: 새 코드는 `ls-tree`·`cat-file` 만 쓴다. 기존 read-only 단정 테스트가 이를 고정한다.
- **단일 티켓 호출부 무회귀**: `req:commit:1287`·`req:doctor:1833` 은 3인자 호출 그대로 — 배치 없이
  기존 포트를 쓴다(티켓 1개라 이득이 없고, 바꾸면 그 두 명령의 동작 표면이 넓어진다).
