# REQ-2026-155 설계

## DEC-1 — 복구 창 판정을 **verb 이름이 아니라 동작**에 건다 (결함 1)

REQ-2026-154 는 `req:repolicy` 하나만 막았다. 근거는 "관측된 것만 막는다"였고, 그것이 부족했다 —
`req:confirm` 이 같은 일을 한다. **다음에 또 생긴다.**

판정 기준을 옮긴다: **복구 창에서 `commitStateCheckpoint` 를 부르는 경로는 전부 거부한다.**

호출부는 6곳이고 각각을 이렇게 다룬다:

| 호출부 | 처리 | 왜 |
|---|---|---|
| `req-commit.ts` (소비 checkpoint) | **허용** | 🔴 이것이 **복구 그 자체**다. 막으면 나갈 길이 없다 |
| `req-commit.ts` (복구 재개 checkpoint) | **허용** | 같음 |
| `req-confirm.ts` | **거부** | 결함 1 — `user_commit_confirmed` 는 결속에 들어간다 |
| `req-repolicy.ts` | **거부** | REQ-2026-154(기존) |
| `req-review-exception.ts` | **거부**(모든 모드) | `--close-stale`·`--resolve`·일반 — 전부 state 를 바꾼다 |
| `review-codex.ts` | **거부**(모든 kind) | design·phase 둘 다 원장·state 를 쓰고 유료 호출을 한다 |

- 🔴 **허용 목록이 아니라 거부 목록으로 두지 않는다.** "결속 불변인 verb 만 허용"은 새 verb 가
  생길 때마다 **묵시적으로 허용**되는 구조다(지금 상태가 정확히 그것이다). 반대로 둔다:
  **checkpoint 를 부르는 곳은 기본 거부**, 복구 자신만 예외.
### 🔴 거부는 **첫 write 앞**이어야 한다 (설계 r02 P1)

"checkpoint 호출 근처에서 막는다"는 **너무 늦다**. `review-codex` 는 그 지점에 닿기 전에
`gateAndRecordAttempt()`(원장 기록)와 `writeState(persistedState)` 를 이미 끝냈고, **유료 Codex
호출까지 마쳤다**. 거기서 거부해도 결속 대상 state 는 이미 바뀌었고 — "아무것도 쓰지 않았습니다"가
거짓말이 된다.

🔴 **그리고 verb 의 "어떤 한 경로"가 아니라 `--run` 하는 **모든 모드**여야 한다**(설계 r03 P1).
초안은 `review-codex` 를 "design 승인 경로", `req:review-exception` 을 "일반 경로"로만 보았다.
실제로는:

- `review-codex` 는 `--kind design` 과 `--kind phase` 둘 다 `gateAndRecordAttempt()` → 유료 호출 →
  `writeState` 를 한다. **kind 와 무관하게** 막아야 한다.
- `req:review-exception` 은 `--close-stale` 와 `--resolve` 를 **일반 경로 가드보다 앞에서**
  `runCloseStale()`·`runResolve()` 로 넘긴다. 둘 다 state 를 바꾸고 후자는 checkpoint 도 낸다.

**그러므로 가드를 `main()` 안, state 를 읽은 직후 · 모드 분기보다 앞에 둔다.**

```
main()
  … 인자 파싱 · --run 판정 …
  state = loadState(...)
  🔴 [신설] inRecoveryWindow(state) → throw          ← 모드 분기·write·유료 호출 전부보다 앞
  … --close-stale / --resolve / 일반 경로 분기 …
```

- 🔴 **한 자리에 두는 것이 요점이다.** 모드마다 가드를 흩어 놓으면 새 모드가 생길 때 또 빠진다 —
  이번이 그 실패의 두 번째 사례다(REQ-2026-154 는 verb 하나만, 초안은 모드 하나만 보았다).
- 🔴 `review-codex` 를 늦게 막으면 **돈까지 쓴다**. 이 저장소에서 리뷰 호출은 실제 비용이다.
- 🔴 **거부는 `--run` 경로에서만.** dry-run 은 무엇이 바뀔지 보는 것이라 안전하고, 막으면 사람이
  판단할 근거를 잃는다(REQ-2026-154 와 같은 계약).
- 🔴 **판정은 하나의 술어를 공유한다** — `inRecoveryWindow(state)`(이미 있다). 호출부마다 다시
  구현하면 갈라진다(REQ-2026-094 교훈).
- 🔴 **안내는 실행 가능해야 한다**: `npx commitgate req:commit <REQ> --finalize --run` 으로 복구를
  끝낸 뒤 다시 하라고 말하고, **아무것도 쓰지 않았음**을 밝힌다.

### 🔴 구조로 고정한다 — 이것이 이 phase 의 핵심 오라클

주석·규율로는 네 번째 재발을 막지 못한다(이미 세 번 재발했다). **소스 가드**를 둔다:

🔴 **예외를 파일·함수 단위로 두면 안 된다**(설계 r01 P1). `req-commit.ts` 를 통째로 예외로 두면
그 파일에 **새 비-복구 호출**을 넣어도 가드가 green 이다. 함수 단위도 부족하다 — 허용 호출 하나가
거대한 `main()` 안에 있어 `main` 을 예외로 두면 같은 구멍이 생긴다.

**예외는 호출 지점에 붙인다.** 허용되는 두 호출 **바로 위**에 고정 마커를 둔다:

```ts
// commitgate:recovery-checkpoint — 복구 자신이다(REQ-2026-155 DEC-1 예외)
commitStateCheckpoint({ … })
```

가드 규칙:

```
`commitStateCheckpoint(` 가 나오는 모든 자리는 다음 중 하나여야 한다:
  (a) 바로 위 2줄 안에 마커 문자열이 있다        → 복구 자신(예외)
  (b) 앞뒤 60줄 창 안에 `inRecoveryWindow` 가 있다 → 가드가 걸려 있다
그 밖은 **red**.
```

- 🔴 **어디에 새 호출을 넣든 red 다** — `req-commit.ts` 안이라도 마찬가지다. 마커를 붙이는 것은
  "이것은 복구 자신이다"라는 **명시적 주장**이고, 리뷰가 그 주장을 본다.
- 🔴 마커 개수도 센다: **정확히 2개**여야 한다. 늘어나면 red — 마커를 복사해 우회하는 것을 막는다.
- 🔴 (b)의 60줄 창은 **근사**다(`review-codex.ts` 는 커서 함수 경계를 정확히 자르기 어렵다).
  창을 벗어난 배치는 못 잡는다 — 그 한계를 주석에 적는다. 정확한 AST 분석은 이 결함 하나에 과하다.

**그리고 위 가드만으로는 부족하다**(설계 r02 P1) — checkpoint 근처에만 있어도 통과하기 때문이다.
**순서 가드**를 함께 둔다:

```
네 verb 파일 각각의 진입 함수(`main`) 본문에서
  index(`inRecoveryWindow`)
    <  index(첫 `writeState(` · `gateAndRecordAttempt(` · `commitStateCheckpoint(`
             · 모드 분기 `runCloseStale(` · `runResolve(`)
```

- 🔴 이것은 **소스 순서 프록시**다 — 실행 순서와 다를 수 있다(조건 분기·헬퍼 호출). 그래서
  **e2e 가 정본**이고(각 verb 에서 state 바이트·커밋 수 불변), 이 가드는 재발 방지용 보조다.
  그 한계를 주석에 적는다.

## DEC-2 — git 이 준 경로를 **바꾸지 않는다** (결함 2·3)

바꾸는 곳을 전부 뺀다:

| 위치 | 지금 | 이후 |
|---|---|---|
| `evidence-recovery.ts` `planEvidenceRecovery` | `facts.dirtyPaths.map(norm)` | 그대로 |
| `review-codex.ts` `findUnstagedOrUntracked` | allowlist·scratch 를 `norm` | 그대로 |
| `req-commit.ts` `stagedNames()` | `p.replace(/\\/g,'/')` | 그대로 |
| `lib/scratch.ts` | 같음 | 그대로 |
| `review-codex.ts` `phaseCodeFiles` | 같음 | 그대로 |

- 🔴 **정규화는 `ticketRel` 한 곳에만 남는다.** 그것은 도구가 `relative()` 로 **만든** 값이고
  win32 에서 `\` 가 나온다. git 이 **준** 경로와는 출처가 다르다.
- 🔴 **Windows 무회귀**: git 은 플랫폼과 무관하게 `/` 로 보고한다 — 이 변환은 처음부터 불필요했다.
  (`core.quotePath` 는 `-z` 에서 인용을 하지 않으므로 무관하다.)
- 🔴 **양쪽을 같이 고쳐야 한다.** plan 만 고치면 D10 과 여전히 갈리고, D10 만 고치면 반대로 갈린다.
  갈리는 순간 "plan 은 Ready 인데 실행은 거부"라는 교착이 그대로 남는다.
- 🔴 `allowedScratch` 도 `norm` 을 뺀다 — 그 값은 `lib/scratch` 가 만든 repo-상대 POSIX 경로다.
  🔴 **만약 어딘가 OS 경로를 넣고 있으면 그것이 진짜 결함**이므로, 뺀 뒤 전량 스위트로 확인한다.

## DEC-3 — 부정 판정에서 `trim()` 을 뺀다 (결함 4)

```ts
// 지금: line.trim().startsWith('!')
// 이후: line.startsWith('!')
```

- **실측 근거**: `.gitignore` 가 `*.log` + ` !keep.log`(선행 공백)일 때 `git check-ignore -v keep.log`
  는 `**.gitignore:1:*.log**` 를 돌려준다 — 2행은 이기지 못한다. 선행 공백이 있으면 **부정이 아니다.**
- gitignore 는 **후행** 공백만 버린다(이스케이프하지 않은 경우). 선행 공백은 패턴의 일부다.
- 🔴 `\!literal` 은 지금도 부정이 아니다(첫 글자가 `\`) — 그대로 유지된다.
- 🔴 **현재 테스트가 틀린 동작을 고정**하고 있다("앞뒤 공백 무시"). 지우지 말고 **반대 계약으로
  다시 쓴다** — 무엇이 계약인지 남긴다(REQ-2026-152 에서 같은 처리를 했다).
- 🔴 이 변경은 판정을 **덜 보수적**으로 만든다. 그런데 안전하다: ` !x` 는 실제로 커버리지를 좁히지
  않으므로(위 실측), 안전하다고 판정하는 것이 **옳다**.

## Phase 분해

| phase | 범위 |
|---|---|
| `phase-1-checkpoint-verb-guard` | DEC-1 — 4개 verb 거부 · 공유 술어 · **소스 가드** |
| `phase-2-raw-input-fidelity` | DEC-2·3 — git 경로 변환 제거(5곳) · `isNegation` trim 제거 |

🔴 **한 phase 로 묶지 않는다.** DEC-1 은 게이트를 **넓히고**, DEC-2·3 은 판정을 **바꾼다** —
회귀 위험의 성격이 다르고, 섞으면 어느 쪽이 무엇을 깼는지 분리되지 않는다.

## 변경 파일

`scripts/req/req-confirm.ts` · `scripts/req/req-review-exception.ts` · `scripts/req/review-codex.ts` ·
`scripts/req/req-commit.ts` · `scripts/req/lib/scratch.ts` · `scripts/req/lib/evidence-recovery.ts` ·
`scripts/req/lib/gitignore-coverage.ts` · 테스트 · `CHANGELOG.md`

## 안전

- 🔴 **복구 자신은 막히지 않는다** — 그것이 유일한 나갈 길이다. e2e 로 고정한다.
- 🔴 정상 경로(복구 창이 아닐 때) 무회귀가 두 phase 모두의 첫 오라클이다.
- 🔴 경로 변환 제거는 **Windows·POSIX 양쪽** 무회귀를 전량 스위트로 확인한다.
