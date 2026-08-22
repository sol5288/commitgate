# REQ-2026-170 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

`scripts/req/lib/intake-batch.ts` 가 두 곳에서 직접 스폰한다:

| 자리 | 호출 | 필요한 계약 |
|---|---|---|
| `listHeadTreeEntries` | `git ls-tree -r -z <ref> -- <pathspec>` | stdout **무가공**(`-z` 프레이밍) · **exit code 보존** |
| `repoHasAnyCommit` | `git rev-parse --verify --quiet HEAD^{commit}` | exit code 보존(0/≠0 이 곧 답) |

둘 다 `spawn.sync`(cross-spawn) 직접 호출이라 `external-call-boundary` 가 red 다.

## 핵심 설계 결정

### DEC-1 — 등록부를 늘리지 않고 **기존 경계를 쓴다**

`adapters.ts` 의 `safeSpawnSyncStatus` 가 이 두 요구를 정확히 충족한다:

```ts
export function safeSpawnSyncStatus(file, args, opts):
  { status: number | null; stdout: string; stderr: string }
```

- **shell 없는 cross-spawn 단일 경로** — 명령 주입 차단이라는 실제 안전 속성이 그대로다.
- **exit code 를 호출자에게 넘긴다**(REQ-2026-050 D5). `safeSpawnSync` 는 non-zero 를 전부 throw 하므로
  쓸 수 없다 — "커밋이 없어서 실패" 와 "그 밖의 실패" 를 갈라야 하기 때문이다.
- **stdout 을 가공하지 않는다.** `GitAdapter.exec` 는 계약상 후행 공백을 제거해 `-z` 프레이밍을 깨뜨리므로
  여기서 쓸 수 없다(REQ-2026-169 DEC-5). `safeSpawnSyncStatus` 는 `res.stdout.toString('utf8')` 그대로다.

🔴 **왜 등록부 추가가 아닌가**: 가드 파일이 스스로 규범을 적어 두었다 — *"대부분은 `safeSpawnSync` 를
쓰는 것이 옳다"*. 등록부는 **그 규범이 통하지 않는 예외**를 담는 곳이고(`git-batch` 의 stdin 스트리밍,
`init` 의 패키지 매니저 실행), 이 모듈은 예외가 아니다. 예외가 아닌 것을 예외 목록에 넣으면
목록의 의미가 옅어지고 다음 사람이 같은 판단을 더 쉽게 내린다.

### DEC-2 — `git-batch.ts` 는 **건드리지 않는다**

`readBlobsByOid` 는 요청 목록을 **stdin 으로 흘려보내는** `cat-file --batch` 다. `safeSpawnSyncStatus` 에
`input` 옵션이 있어 형식상 가능하지만, 그 모듈은 이미 등록부에 **그 사유로** 등재돼 있다
(*"safeSpawnSync의 1회 왕복 모델로는 표현되지 않는 로컬 git 배치"*). 이 REQ 의 범위가 아니다.

### DEC-3 — 계수 오라클은 **그대로 유효하다**(확인된 사실)

`tests/unit/intake-scan-cost.test.ts` 는 `cross-spawn` 과 `node:child_process` 를 **모두** 감싸 실제 git
스폰을 센다. `adapters.ts` 도 `cross-spawn` 을 쓰므로 경유 경로가 바뀌어도 계수에 그대로 잡힌다 —
실행으로 확인했다(50건 green). 즉 이 변경은 REQ-2026-169 의 성능 계약을 **관측 불가능하게 만들지 않는다.**

🔴 이것을 확인 없이 넘겼다면 계수 오라클이 조용히 아무것도 세지 않게 될 수 있었다.

### DEC-5 — 🔴 `maxBuffer` 를 **명시적으로 넘긴다**(design-r01 P1)

`listHeadTreeEntries` 의 현행 호출은 `maxBuffer: 256 * 1024 * 1024` 다.
`safeSpawnSyncStatus` 의 기본값은 **64 MiB**(`opts.maxBuffer ?? 64 * 1024 * 1024`)이므로,
그냥 교체하면 **상한이 조용히 1/4 로 줄어든다.**

그 차이는 이론이 아니다: `ls-tree -r`은 `<ticketRoot>/` **전량**을 내고, `ticketRoot: "."` 설치본에서는
저장소 전체 트리다. 출력이 64 MiB 를 넘고 256 MiB 이하인 저장소는 지금은 정상 스캔되지만 교체 후에는
버퍼 초과로 **실패**한다 — "동작 동일" 이라는 이 REQ 의 전제가 깨진다.

→ 교체 시 `{ cwd, maxBuffer: 256 * 1024 * 1024 }` 를 **명시**한다.
   `repoHasAnyCommit` 은 출력이 SHA 한 줄이라 기본값으로 충분하다(상한을 늘릴 이유가 없다).

🔴 **이 계약을 테스트로 고정한다.** 64 MiB 를 넘는 실제 저장소를 만드는 것은 비현실적이므로,
   경계에 **실제로 전달된 옵션**을 관측한다(`adapters` 를 감싸 호출 인자를 캡처).
   값이 다시 기본값으로 새면 red 여야 한다 — 주석만으로는 다음 사람이 지운다.

### DEC-4 — leaf 불변식

`intake-batch` → `adapters` 는 새 의존이다. `adapters.ts` 는 스스로 *"req 스크립트에 의존하지 않는 leaf"*
이므로 순환이 생기지 않는다. 모듈 헤더의 의존 목록을 갱신해 사실과 문서를 맞춘다.

## Phase별 구현

### phase-1 — 경계 경유 (`phase-1-boundary`)

- `scripts/req/lib/intake-batch.ts`
  - `import spawn from 'cross-spawn'` → `import { safeSpawnSyncStatus } from './adapters'`
  - `listHeadTreeEntries`: `spawn.sync(...)` → `safeSpawnSyncStatus(..., { cwd, maxBuffer: 256 * 1024 * 1024 })`.
    🔴 `maxBuffer` 명시(DEC-5 — 기본 64 MiB 로 줄면 동작이 달라진다) ·
    `res.error` 분기 제거(경계가 이미 throw 한다) · `res.stdout ?? ''` → `res.stdout`
  - `repoHasAnyCommit`: 같은 교체, `status === 0` 만 본다.
  - 헤더 주석: 의존 목록 갱신 + **직접 스폰하지 않는다**는 사실과 이유를 적는다.

Exit: typecheck 0 · `external-call-boundary`·`intake-batch`·`intake-scan-cost` green ·
  **전체 스위트 green**(이 REQ 의 존재 이유가 전체 스위트 red 이므로 그것으로 닫는다) · Codex phase 리뷰 승인.

## 변경 파일

| 파일 | 성격 |
|---|---|
| `scripts/req/lib/intake-batch.ts` | 스폰 경로 교체 + 헤더 주석 |
| `tests/unit/intake-batch.test.ts` | 🔴 `maxBuffer` 전달 회귀 테스트 **추가만**(DEC-5) |

🔴 `tests/unit/external-call-boundary.test.ts` 는 **변경하지 않는다**. 가드를 고쳐 통과시키는 것이
이 REQ 가 하지 않으려는 바로 그 일이다.

## 하위호환·안전

- **동작 동일**: 두 호출 모두 같은 인자로 같은 git 을 부른다. 달라지는 것은 **어느 경계를 지나는가** 뿐이다.
- **안전 속성 강화**: shell 없는 실행은 그대로이고, kill switch·주입 차단이 사는 모듈을 지나게 된다.
- **실패 의미 보존**: spawn 자체 실패(git 부재 등)는 `safeSpawnSyncStatus` 가 throw 하고,
  exit≠0 은 그대로 호출자가 해석한다 — REQ-2026-169 가 세운 "실패를 티켓 없음으로 삼키지 않는다"가 유지된다.
