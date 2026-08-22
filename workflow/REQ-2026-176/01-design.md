# REQ-2026-176 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

`scripts/req/lib/verify-range.ts` `collectDeepInput`:

```ts
// 4) head tree 경로 목록 1회
const treePaths = new Set(git.exec(['ls-tree', '-r', '--name-only', head, '--', ticketRoot])…)
// 5) 배치 1회차: manifest + state + attestations
const batch1 = readBlobs(head, [...manifestPaths, ...statePaths, ...(wantAtt ? [attPath] : [])])
// 6) 배치 2회차: 소비 행이 참조하는 아카이브
const batch2 = readBlobs(head, inTree)
```

호출부 **7곳**:

| 파일 | 자리 |
|---|---|
| `bin/verify-range.ts` | 239 |
| `bin/report.ts` | 128 |
| `bin/integrate.ts` | 199 · 428 · 914 |
| `scripts/req/lib/delegation-preflight-facts.ts` | 72 |
| `scripts/req/lib/trunk-advance.ts` | 140 |

## 핵심 설계 결정

### DEC-1 — 🔴 `ls-tree` 한 호출에서 OID 를 **함께** 받는다

`--name-only` 를 떼면 `<mode> <type> <oid>\t<path>` 가 나온다. **git 프로세스가 늘지 않는다.**

🔴 REQ-2026-169 가 같은 자리에서 배운 것: *"OID 를 얻겠다고 `ls-tree` 를 한 번 더 부르면
   절감의 상당 부분을 되돌려 준다."* 그래서 **기존 호출을 바꾼다**(추가하지 않는다).

파싱은 `-z` 를 쓰지 않는다 — 기존 호출도 쓰지 않았고, 경로에 개행이 있으면 **지금도** 깨진다.
이 REQ 는 그 성질을 바꾸지 않는다(바꾸면 `treePaths` 판정이 달라져 게이트가 움직인다).

### DEC-2 — 🔴 새 포트는 **필수 인자**다

```ts
export function collectDeepInput(
  git: GitPort,
  readBlobs: ReadBlobsPort,
  base: string, head: string, ticketRoot: string,
  readByOid: ReadBlobsByOidPort,   // 🔴 필수
): DeepInput
```

선택 인자로 두면 `(ref, paths) => readBlobsAtRef(root, ref, paths)` 같은 **람다가 조용히
떨어뜨린다** — 이번 작업에서만 배선 끊김이 다섯 번 났고 전부 선택 필드였다.
필수로 두면 tsc 가 **7곳 전부**에서 멈춘다. 컴파일러가 배선 검사를 대신한다.

`ports` 객체를 받는 두 호출부(`delegation-preflight-facts`·`trunk-advance`)는
인터페이스에 멤버가 하나 늘고, 그 **구성 지점**에서도 tsc 가 멈춘다(연쇄가 전부 검사된다).

#### 🔴 그 연쇄가 실제로 닿는 자리 (design-r01 P1)

*"tsc 가 멈춘다"* 로 끝내면 **어디서 멈추는지**를 세지 않은 것이다. 실제 구성 지점은 다음이고,
**전부 phase 범위**다 — 하나라도 빠지면 `typecheck 0` 이라는 exit 기준 자체를 만족할 수 없다:

| 구성 지점 | 무엇을 만드는가 |
|---|---|
| `scripts/req/req-delegate.ts:459` | `preflightPorts: { … }` (`PreflightFactPorts`) |
| `scripts/req/req-next.ts:1351` | `readBlobs` 를 담은 공유 `ports` — preflight·trunk-advance 양쪽에 넘긴다 |
| `bin/integrate.ts:453` | `authorizeTrunkAdvance` 에 넘기는 `{ git, readBlobs, ticketRoot }` |
| `tests/unit/delegate-verb.test.ts:336` | 타입드 포트 factory |
| `tests/unit/trunk-advance.test.ts` `ports` | 타입드 포트 factory |

🔴 **`req-next.ts` 를 놓치면 특히 나쁘다**: 그 포트는 REQ-2026-172·173 이 만든
   *"사람에게 묻기 전에 미리 판정한다"* 경로다. 거기가 안 고쳐지면 빌드가 깨진다.

### DEC-3 — 🔴 OID 를 못 얻은 경로는 **경로 요청으로 폴백**한다

`oidByPath` 는 `treePaths` 와 같은 출력에서 나오므로 원리적으로 빠질 수 없다.
그래도 폴백을 둔다 — 빠지면 그 경로의 blob 이 **조용히 `null`** 이 되고,
`null` 은 "읽기 실패 = 검증 불가"로 해석돼 **정상 커밋이 미입증으로 떨어진다.**

🔴 이 저장소가 반복해 데인 유형이다: *읽지 못한 것을 사실로 쓰면 거짓 사유가 나온다*(REQ-2026-160).
   그래서 "없으면 없는 대로"가 아니라 **"없으면 옛 방식으로 반드시 읽는다"** 로 닫는다.

### DEC-4 — 🔴 `git-batch.ts` 의 **거짓 서술을 정정한다**

현재 주석(`git-batch.ts:63-65`):

> 경로만 아는 호출부(`verify-range`·`report`·`integrate`)는 계속 `readBlobsAtRef` 를 쓴다 —
> **그쪽은 요청 집합이 작아** 이 REQ 의 대상이 아니다.

**실측이 반증한다**: 332경로(=누적 티켓 수 × 2)이고 티켓 수에 선형으로 는다.
서술을 고치지 않으면 다음 사람이 같은 오판을 반복한다.

## Phase별 구현

### phase-1 — OID 요청 (`phase-1-oid-blobs`)

- `verify-range.ts`: `ls-tree -r`(OID 포함) 파싱 → `oidByPath` · `batch1`/`batch2` 를
  OID 로 요청하고 결과를 **경로 키로 되돌린다** · 시그니처에 `readByOid` 필수 추가.
- 호출부 7곳 배선 · `ports` 인터페이스 2곳 멤버 추가.
- `git-batch.ts` DEC-4 주석 정정.
- 테스트(`tests/unit/verify-range-oid-cost.test.ts`, **신규**):
  - 🔴 **계수 오라클**: `cross-spawn`·`node:child_process` 를 모킹해 **실제** `cat-file --batch`
    stdin 을 가로채고, 요청 줄이 **전부 hex OID**(≠ `<ref>:<path>`)임을 단정.
    (REQ-2026-169 `intake-scan-cost.test.ts` 와 같은 방식 — 진짜 호출을 센다.)
  - 🔴 **`ls-tree` 호출 수 불변**: git 인자 목록을 가로채 `ls-tree` 가 **1회**임을 단정.
  - 🔴 **동치 오라클**(실 git): 같은 저장소에서 경로 요청으로 만든 `DeepInput` 과
    OID 요청으로 만든 것이 **판정 필드 전부 동일**.
  - 🔴 **폴백**: `oidByPath` 에서 항목을 지워도 그 blob 이 **여전히 읽힌다**(DEC-3).

Exit: typecheck 0 · 위 green ·
  🔴 **변이 3종**: ① OID 경로를 경로 요청으로 되돌림 → 계수 red
  ② 폴백 제거 + OID 누락 → 폴백 테스트 red ③ `ls-tree` 를 한 번 더 부름 → 호출 수 red ·
  **커밋 전 전체 스위트 1회**(단일 phase) · Codex phase 리뷰 승인.

## 변경 파일

| 파일 | 성격 |
|---|---|
| `scripts/req/lib/verify-range.ts` | ls-tree OID · 배치 2곳 · 시그니처 |
| `scripts/req/lib/git-batch.ts` | 거짓 서술 정정(DEC-4) |
| `bin/verify-range.ts`·`bin/report.ts`·`bin/integrate.ts` | 배선 5곳(+ 포트 구성 1곳) |
| `scripts/req/lib/delegation-preflight-facts.ts`·`trunk-advance.ts` | 포트 멤버 1개씩 |
| `scripts/req/req-delegate.ts`·`scripts/req/req-next.ts` | 🔴 포트 **구성** 지점(design-r01 P1) |
| `tests/unit/delegate-verb.test.ts`·`tests/unit/trunk-advance.test.ts` | 타입드 포트 factory 갱신 |
| `tests/unit/verify-range-oid-cost.test.ts` | **신규** |

## 하위호환·안전

- 🔴 **게이트 판정은 한 줄도 바뀌지 않는다.** 같은 blob 을 같은 키로 담아 넘긴다 —
  동치 오라클이 그것을 증명한다.
- `readBlobsAtRef` 는 **그대로 남는다**(폴백·다른 호출부가 쓴다).
- 새로 막히는 것이 없다. 실패 모드도 종전과 같다(읽기 실패 → `null` → 검증 불가).
