# REQ-2026-156 설계

## DEC-1 — 가드는 **두 창**을 본다 (결함 1)

결속이 깨질 수 있는 구간은 둘이고, **표식이 다른 곳에 있다**:

| 창 | 상태 | 표식 |
|---|---|---|
| ① source 커밋 뒤·소비 전 | 승인 핀 살아 있음 | `state.pending_evidence_for` (state 안) |
| ② evidence 커밋 뒤·checkpoint 전 | 소비 끝남 — **핀이 둘 다 없다** | **HEAD 와 워킹트리의 관계** |

REQ-2026-155 는 ①만 보았다. ②의 표식은 state 안에 없으므로 **순수 state 술어로는 끝낼 수 없다**.

②의 판정은 REQ-2026-150 이 이미 만든 것이다(판별자 A·B):

```
A: HEAD 매니페스트에 소비 행 R 이 있고 `HEAD^` 에 없다   (= HEAD 가 방금 추가했다)
B: HEAD `state.json` 의 consumed_approvals 에 R 이 없다  (= checkpoint 미도래)
```

**둘 다 참이면 ②다.** 그 두 사실은 `consumedKeysAddedByHead`·`consumedKeysInState`(순수)가 이미 준다.

### 새 술어 — 사실은 주입한다

```ts
// lib/recovery-window.ts (leaf)
export interface CheckpointWindowFacts {
  headManifest: string        // HEAD:<ticket>/responses/approvals.jsonl (없으면 '')
  parentManifest: string      // HEAD^ 같은 파일 (없으면 '')
  headStateText: string | null // HEAD:<ticket>/state.json
}
export function inCheckpointWindow(f: CheckpointWindowFacts): boolean

/** 두 창을 합친 것 — verb 가드가 쓰는 하나의 진입점. */
export function stateWriteBlocked(state, facts: CheckpointWindowFacts): boolean
```

- 🔴 **순수하게 유지한다.** fs·git 은 호출부가 읽어 넣는다 — 그래야 창별 조합을 테스트로 전수한다.
- 🔴 **`lib/evidence-recovery` 를 verb 가 직접 import 하지 않는다.** 그 모듈은 "호출부는
  `req:doctor`·`req:commit` 둘뿐"이라는 구조 가드로 **D10 예외 표면**을 좁게 유지한다(REQ-2026-142).
  `recovery-window` 가 그 leaf 에서 **순수 키 헬퍼만** 가져와 재노출한다 — D10 예외를 여는 것과
  창을 아는 것은 다른 일이다. 🔴 **그 구별을 기존 가드의 주석에 명시**해 우회로 보이지 않게 한다.

### 읽기 실패는 **차단하지 않는다**

- HEAD blob 을 못 읽으면(신규 저장소·부모 없음) 빈 문자열로 떨어지고 ②는 false 다.
- 🔴 추가 안전장치가 새 교착을 만들면 안 된다(이 저장소의 반복 원칙). 못 읽었다고 정상 verb 를
  막지 않는다 — 그 경우 남는 위험은 이 REQ 이전과 같다.

### 어느 verb 가, 언제

- 네 verb(`req:confirm`·`req:repolicy`·`req:review-exception`·`review-codex`)의 **`--run` 경로만**.
  자리는 REQ-2026-155 가 정한 그대로 — **첫 write·모드 분기 앞**이다.
- 🔴 **dry-run 은 여전히 막지 않는다.** 그리고 `review-codex` dry-run 의 preview 파일은
  **gitignored 라 `dirtyPaths` 에 들어가지 않는다**(실측: `.gitignore:11`,
  `STATUS_Z_ARGS` 에 `--ignored` 없음) — 검토가 우려한 `foreign-files` 오염은 **일어나지 않는다**.
  근거를 주석에 남긴다.
- 안내는 종전과 같은 `recoveryWindowProblem` 을 쓴다 — 두 창 모두 나가는 길은 `--finalize` 하나다.

🔴 **①에서 ②로 넘어가도 안내가 같아야 한다.** 창마다 다른 말을 하면 사람이 "무엇이 달라졌나"를
추적해야 한다. 다른 것은 **왜 막혔는지**뿐이므로 한 줄만 덧붙인다.

## DEC-2 — parity 테스트를 실제 호출부와 맞춘다 (결함 2)

```ts
// 지금(테스트): …split('\0').map((p) => p.replace(/\\/g,'/')).filter((p) => p.length > 0)
// 실제 호출부  : …split('\0')                                   ← 정규화도 필터도 없다
```

- 비교 기준을 **호출부와 동일**하게 바꾼다.
- 🔴 그러면 `stagedNames()`(빈 조각을 거른다)와 **다를 수 있다** — 그 차이가 실재하는지 본다.
  같아야 한다면 호출부를 고치고, 달라도 무해하면 그 사실을 테스트에 적는다.
  **어느 쪽이든 지금처럼 "테스트만 정규화해서 같아 보이게" 두지 않는다.**
- 🔴 **POSIX 리터럴 역슬래시 fixture** 로 검사한다 — 일반 경로 fixture 로는 정규화 재도입을 못 잡는다.
  win32 에서는 그 파일을 만들 수 없으므로 **사유를 출력하고 건너뛴다**(POSIX CI 가 정본).

## Phase 분해

단일 phase — `phase-1-checkpoint-window-guard`. DEC-2 는 몇 줄이고 같은 "raw 입력 충실도" 축이다.

## 변경 파일

`scripts/req/lib/recovery-window.ts` · 네 verb · `tests/unit/recovery-window.test.ts` ·
`tests/unit/req-commit.test.ts` · `tests/unit/evidence-recovery-wiring.test.ts` · `CHANGELOG.md`

## 안전

- 🔴 **복구 자신은 막히지 않는다.** `req:commit --finalize` 는 두 창 모두에서 동작해야 한다 — e2e.
- 🔴 **정상 경로 무회귀**: 승인 직후(핀 있음·소비 전)는 ①이라 이미 막힌다. 그 밖의 평시에는
  ②가 false 여야 한다 — 전량 스위트가 그것을 증명한다.
- 🔴 읽기 실패는 차단하지 않는다.
