# REQ-2026-152 설계

## DEC-1 — 안내는 `--include-untracked` 로 보관한다

`terminalReentryProblem` 의 첫 줄을 바꾼다.

```text
    git stash push --include-untracked -m "REQ-2026-149 follow-up"
```

- 🔴 **판단 근거를 뒤집는다.** REQ-2026-151 은 "`-u` 는 옛 티켓의 응답 아카이브까지 옮겨 다니게
  한다"를 이유로 뺐다. 그 부작용은 실재하지만 **안내가 아예 실행되지 않는 것보다 작다.** 옮겨간
  아카이브는 `stash pop` 으로 같은 경로에 복원되고, `req:new` 는 기존 티켓 직계의 도구 산출물을
  이미 예외로 두므로 다음 티켓 생성도 막지 않는다. **유실은 없고, 위치도 되돌아온다.**
- 축약형 `-u` 가 아니라 **`--include-untracked`** 를 쓴다. 안내는 읽는 사람이 무엇을 하는지 알아야
  한다(이 저장소가 `-z`·`--message-file` 에서 반복 확인한 원칙).
- 🔴 **`--all` 은 쓰지 않는다.** gitignore 대상까지 보관하면 `node_modules`·`.env` 가 stash 로 들어간다.
  `req:new` 도 ignored 는 위반으로 보지 않으므로 필요도 없다.

### 회귀 테스트의 방향을 뒤집는다

`tests/unit/terminal-reentry.test.ts` 의 "🔴 `-u` 를 쓰지 않는다" 는 **틀린 동작을 고정**하고 있다.
지우는 것이 아니라 **반대 계약으로 다시 쓴다** — untracked 를 포함하되 `--all` 은 아니다.

### 오라클은 e2e 다

🔴 순수 문자열 검사만으로는 같은 실수가 반복된다(이번이 그 증거다). **untracked 일반 파일이 있는
상태**로 세 줄을 실제로 이어 본다. 지금 e2e 는 fixture 에 untracked 가 없어 통과했다.

## DEC-2 — 키가 있으면 형식을 검증한다(부재만 레거시)

`validateManifest` 에 `phase_design_ref` 와 **같은 형태**의 검사를 더한다.

```ts
// REQ-2026-152: 부재는 레거시(정상). 있으면 64hex — 형식 불량은 "결속 없음"이 아니라 잘못된 증거다.
if ('consumed_state_sha256' in e && (typeof e.consumed_state_sha256 !== 'string' || !SHA256_RE.test(e.consumed_state_sha256)))
  problems.push(`line ${ln}: consumed_state_sha256 비-64hex`)
```

- 🔴 **하위호환과 충돌하지 않는다.** 이 REQ 이전 행에는 **키 자체가 없다.** 키가 있는데 형식이
  틀린 행은 정상 코드가 만들지 않는다 — 그러므로 거부해도 옛 crash window 를 막지 않는다.
- `validateManifest` 는 `finalizeEvidenceAndConsume` 이 HEAD 매니페스트를 읽을 때 이미 부른다
  (`무결성 실패(fail-closed)`). 그러므로 이 검사 하나로 **커밋 경로도 함께** 닫힌다.

## DEC-3 — 복구 판정도 같은 자리에서 fail-closed 한다

`consumedStateShaFor` 는 지금 "문자열이고 빈 값 아님"만 본다. 그 조건을 통과하지 못한 값을
`null`(=결속 없음)로 **강등**하는 것이 결함의 본체다. 셋으로 나눈다.

| 행의 상태 | 판정 |
|---|---|
| 키 **없음** | `null` — 레거시. D 를 건너뛴다(종전과 같다) |
| 키 있고 **64hex** | 그 값으로 D 를 수행 |
| 키 있고 **그 밖**(`null`·숫자·빈 문자열·63자리·비-hex) | 🔴 **거부** — `state-mismatch` |

반환 타입을 바꾼다:

```ts
export type BindingLookup =
  | { kind: 'absent' }            // 레거시 — D 건너뜀
  | { kind: 'bound'; sha: string }
  | { kind: 'malformed'; detail: string }
```

- 🔴 **강등을 문법으로 불가능하게 만든다.** `string | null` 로 두면 호출부가 다시 "없으면 건너뛴다"로
  뭉갤 수 있다. 세 갈래를 타입으로 강제하면 `malformed` 를 조용히 넘길 수 없다.
- 🔴 **`validateManifest` 가 이미 막는데 왜 또 보는가**: 복구 판정은 `planEvidenceRecovery` 를 통해
  `req:doctor` 에서도 불리고, 그 경로가 매니페스트 검증을 거쳤다고 **가정하지 않는다**. 두 곳 모두
  fail-closed 여야 "키가 있으면 정확히 결속한다"가 계약이 된다(REQ-2026-094 교훈: 술어를 공유해도
  입력 획득이 갈리면 판독이 갈린다).

## DEC-4 — `resumeFrom: 'consume'` 실 CLI e2e 를 만든다

지금 e2e fixture 는 승인 핀이 없어(`ev === null`) 전부 checkpoint 분기로 간다. `'consume'` 분기는
**핀이 살아 있는** 상태를 요구한다:

- `state.json`: `commit_allowed: true` · `approved_diff_hash` = source 커밋의 tree · `approval_evidence`
  (승인 핀: `review_kind`·`phase_id`·`response_path`·`response_sha256`·`review_base_sha`·
  `archive_inventory` 핀)
- HEAD 매니페스트: 그 승인의 소비 행이 **이미 있고** `consumed_state_sha256` 이 박혀 있다
- 아카이브 파일이 인벤토리의 sha 와 **바이트 일치**

오라클:
1. 🔴 `--finalize --run` 한 번으로 **수렴**한다(exit 0 · clean tree).
2. 🔴 복구가 커밋한 `HEAD:state.json` 의 sha256 이 매니페스트의 `consumed_state_sha256` 과 **일치**한다.
   ← 이것이 `consumedAtOfRow` 의 진짜 오라클이다.
3. 🔴 **변이 검사**: `consumedAtOfRow(...)` 를 `new Date().toISOString()` 으로 되돌리면 ②가 red 다.
   red 가 되지 않으면 이 e2e 는 여전히 그 코드를 지나지 않는 것이다 — **변이가 red 임을 확인하기
   전에는 이 phase 를 닫지 않는다.**

🔴 fixture 를 만들 수 없으면 **그 사실을 보고하고 멈춘다.** "구조 가드로 대신한다"로 물러서지 않는다 —
그것이 이번에 결함을 놓친 방식이다.

## Phase 분해

| phase | 범위 |
|---|---|
| `phase-1-untracked-stash-guidance` | DEC-1 — 안내 수정 · 회귀 테스트 방향 전환 · untracked 있는 e2e |
| `phase-2-binding-integrity` | DEC-2·3·4 — 매니페스트 형식 검증 · 3갈래 판정 · consume e2e · 변이 검사 |

## 변경 파일

`scripts/req/req-commit.ts` · `scripts/req/lib/evidence.ts` · `scripts/req/lib/evidence-recovery.ts` ·
`tests/unit/terminal-reentry.test.ts` · `tests/unit/evidence-recovery.test.ts` ·
`tests/unit/evidence-recovery-wiring.test.ts` · `CHANGELOG.md`

## 안전

- 🔴 정상 crash window 무회귀가 두 phase 모두의 첫 오라클이다.
- 🔴 형식 검증은 **키가 있는 행**만 대상이다 — 옛 행(키 부재)의 복구 경로는 한 글자도 달라지지 않는다.
- 🔴 종결 판정 실패는 여전히 차단하지 않는다.
