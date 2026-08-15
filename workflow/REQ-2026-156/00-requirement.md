# REQ-2026-156 요구

외부 종료 검토 2건. **둘 다 실측 확인했다.** 다만 P1 의 **하위 주장 하나는 반증**됐다.

## 결함 1 (P1) — checkpoint 복구 창이 가드에서 빠져 있다

REQ-2026-155 의 `inRecoveryWindow(state)` 는 `pending_evidence_for` 하나만 본다. 그런데
`consumeState` 가 그 키를 **제거한다**(`req-commit.ts:198`
— `const { approval_evidence: _consumed, pending_evidence_for: _pending, ...rest } = state`).

그러므로 **evidence-finalize 는 끝났고 소비 state 만 워킹트리에 남은 checkpoint 창**에서는
`inRecoveryWindow(state) === false` 이고 네 verb 가 전부 통과한다.

재현:
1. evidence 커밋은 성공, state checkpoint 커밋만 실패한 정상 중단 상태.
   - HEAD: `consumed_state_sha256` 이 든 evidence 커밋
   - 워킹 `state.json`: 올바른 소비 state — `approval_evidence`·`pending_evidence_for` **둘 다 없다**
2. `npx commitgate req:repolicy REQ-… --run`
3. 가드가 통과하고 policy snapshot 이 바뀐 state 를 **checkpoint 커밋**한다.
4. 증거가 결속한 소비 state 와 **다른 state 가 HEAD 에 영구 기록**된다.
   🔴 그리고 워크트리가 깨끗해져 이후 `--finalize` 는 **결속 대조를 할 기회조차 없다**.

`req:confirm`·`req:review-exception --resolve`·`review-codex --run` 도 같은 창에서 열린다.

🔴 **순수 state 술어로는 끝낼 수 없다.** 이 창의 표식은 state 안이 아니라 **HEAD 와 워킹트리의
관계**에 있다(REQ-2026-150 의 판별자 A·B: "HEAD 매니페스트가 그 소비 행을 방금 추가했고
HEAD state 에는 아직 없다").

### 🔴 하위 주장 하나는 반증됐다 — `review-codex` dry-run preview

검토는 "dry-run 이 preview 파일을 써서 복구 plan 의 `foreign-files` 판정을 막을 수 있다"고 했다.
**그렇지 않다**:

```
$ git check-ignore -v workflow/REQ-2026-155/.review-preview.txt
.gitignore:11:workflow/**/.review-preview.txt   workflow/REQ-2026-155/.review-preview.txt
```

이 파일은 **ignored** 이고, `STATUS_Z_ARGS`(`status --porcelain=v1 -z --untracked-files=all`)는
`--ignored` 를 쓰지 않으므로 porcelain 출력에 **나타나지 않는다**. `dirtyPaths` 에 들어가지 않으니
`foreign-files` 를 발화시키지 못한다. → **dry-run 을 막을 근거가 없다.**

## 결함 2 (P3) — phase 게이트 parity 테스트가 실제 호출부와 다르다

`req-commit.test.ts` 의 "phase 게이트와 바이트 파리티" 는 비교 기준을 이렇게 만든다:

```ts
const fromGate = git([...STAGED_NAMES_Z_ARGS]).split('\0').map((p) => p.replace(/\\/g, '/')).filter((p) => p.length > 0)
```

실제 호출부(`review-codex.ts:2933`)는:

```ts
sourceCommitForbiddenStaged(git([...STAGED_NAMES_Z_ARGS]).split('\0'), ticketRel)
```

**두 축이 어긋나 있다**(검토가 지적한 정규화 + 내가 확인한 빈 문자열 필터):
- 테스트는 `\`→`/` 를 적용하지만 호출부는 raw 다 — 정규화가 재도입돼도 일반 경로에서는 통과한다.
- 테스트는 빈 조각을 거르지만 호출부는 거르지 않는다 — `-z` 마지막 NUL 뒤 빈 문자열이 그대로 간다.

## 범위 밖

- D10 예외 폭 · hardCap · HIGH 확인 · SHA/범위 불일치 — 완화하지 않는다.
- `review-codex` dry-run 차단 — 위 반증대로 근거가 없다.
