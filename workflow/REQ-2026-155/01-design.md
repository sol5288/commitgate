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
| `req-review-exception.ts` | **거부** | 같은 창에서 state 를 바꿔 checkpoint 커밋한다 |
| `review-codex.ts` (design 승인) | **거부** | 같음 |

- 🔴 **허용 목록이 아니라 거부 목록으로 두지 않는다.** "결속 불변인 verb 만 허용"은 새 verb 가
  생길 때마다 **묵시적으로 허용**되는 구조다(지금 상태가 정확히 그것이다). 반대로 둔다:
  **checkpoint 를 부르는 곳은 기본 거부**, 복구 자신만 예외.
- 🔴 **거부는 `--run` 경로에서만.** dry-run 은 무엇이 바뀔지 보는 것이라 안전하고, 막으면 사람이
  판단할 근거를 잃는다(REQ-2026-154 와 같은 계약).
- 🔴 **판정은 하나의 술어를 공유한다** — `inRecoveryWindow(state)`(이미 있다). 호출부마다 다시
  구현하면 갈라진다(REQ-2026-094 교훈).
- 🔴 **안내는 실행 가능해야 한다**: `npx commitgate req:commit <REQ> --finalize --run` 으로 복구를
  끝낸 뒤 다시 하라고 말하고, **아무것도 쓰지 않았음**을 밝힌다.

### 🔴 구조로 고정한다 — 이것이 이 phase 의 핵심 오라클

주석·규율로는 네 번째 재발을 막지 못한다(이미 세 번 재발했다). **소스 가드**를 둔다:

```
`commitStateCheckpoint(` 를 부르는 파일은 반드시 같은 함수 안에서 `inRecoveryWindow` 를 참조한다.
예외는 `req-commit.ts` 하나이고, 그 예외는 **명시적 목록**으로 적는다.
```

- 🔴 새 호출부를 추가하면 가드가 **바로 red** 다. 목록에 넣는 것은 의도적 행위여야 한다.
- 🔴 `review-codex.ts` 는 파일이 커서 "같은 함수 안"을 정확히 잘라내기 어렵다 — **호출부 앞뒤
  60줄 창** 안에서 찾는 것으로 근사한다. 근사임을 주석에 적는다(정확한 AST 분석은 이 결함 하나에
  과하다).

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
