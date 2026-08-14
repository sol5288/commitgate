# REQ-2026-150 설계

## DEC-1 — 판별자: **HEAD 가 그 소비 행을 방금 추가한 evidence-finalize 커밋인가**

기각된 3종이 공통으로 실패한 이유는 **판정 입력이 워킹 트리에 있거나, HEAD 에 아예 없는 것**을
봤기 때문이다. 둘 다 아닌 것을 찾는다.

crash window 의 구조적 사실:

```
① evidence-finalize 커밋   ← approvals.jsonl 에 소비 행 R 을 append. state.json 은 커밋 안 함
② writeState(consumed)     ← 워킹만 바뀐다
③ checkpoint 커밋          ← 여기서야 HEAD state 가 R 을 담는다
```

**②와 ③ 사이에서만** 다음이 동시에 참이고, 셋 다 **커밋해야만** 바꿀 수 있다:

| # | 관측 | 근거 |
|---|---|---|
| A | **HEAD 매니페스트에 R 이 있고 `HEAD^` 매니페스트에는 없다** | R 을 추가한 것이 **HEAD 자신**이다 |
| B | HEAD `state.json` 의 `consumed_approvals` 에 R 이 **없다** | checkpoint 가 아직 안 왔다 |
| C | 워킹트리에서 더러운 것이 `<ticket>/state.json` **뿐**이다 | 복구가 만질 것이 그것뿐이다 |

- **A 가 핵심이다.** "HEAD 가 방금 R 을 추가했다"는 완료된 티켓·옛 티켓 어디에서도 성립하지 않는다.
  완료된 티켓의 HEAD 는 checkpoint 커밋(또는 그 이후)이라 `HEAD^` 에도 R 이 있다.
- 🔴 **A 는 위조하려면 커밋해야 한다.** 그 순간 위조 비용이 게이트 통과 비용과 같아진다 — 기각된
  판별자 1(워킹 값)과 결정적으로 다르다.
- B 는 A 를 보강한다: A 만으로도 대부분 갈리지만, checkpoint 가 이미 왔는데 HEAD 가 우연히
  evidence 커밋인 경우를 배제한다.
- 🔴 동일성 키는 `(consumed_by_commit_sha, phase_id)` — **시각을 넣지 않는다**(기각 3).

### 이 판정이 막는 것

| 시도 | 왜 막히나 |
|---|---|
| 완료 티켓에서 임의 필드 수정 | HEAD 가 checkpoint 커밋이라 **A 실패**(R 이 `HEAD^` 에도 있다) |
| `approval_consumed_at` 만 변조 | 키에 시각이 없다 → 같은 R → **A 실패** |
| 매니페스트 행을 워킹 `consumed_approvals` 에 복사 | 워킹 값은 **판정 입력이 아니다** → **A 실패** |
| 옛(legacy) 티켓 | HEAD 가 evidence-finalize 커밋이 아니다 → **A 실패** |

### 이 판정이 **놓치는** 것 (fail-closed 쪽으로)

🔴 evidence-finalize 뒤에 **다른 커밋을 하나라도 더 하면** HEAD 가 그 커밋이 되어 A 가 깨진다.
그러면 복구가 열리지 않는다. **의도한 것이다** — 안전한 쪽으로 틀린다. 그 상황은 이 REQ 범위 밖이고,
사용자는 그 커밋을 되돌리거나 사람이 판단한다. 문서에 그대로 적는다(막지 못하는 것을 막는다고 쓰지 않는다).

## DEC-2 — 첫 phase·`consumed_approvals` 부재

새 티켓의 첫 소비에서는 HEAD state 에 `consumed_approvals` 키 자체가 없다. **없음을 빈 배열로 본다** —
B("R 이 없다")가 자연히 성립한다.

🔴 이것이 legacy 티켓을 열지 않는 이유는 **A 가 따로 막기 때문**이다. B 만 썼다면 legacy 가 통과했을
것이다(REQ-2026-148 r06 이 지적한 자리). A 와 B 는 각자 다른 것을 막는다.

## DEC-3 — 입력은 전부 주입, 판정은 순수

```ts
// evidence-recovery.ts
export interface CheckpointFacts {
  /** HEAD 의 `approvals.jsonl`(없으면 ''). */
  headManifest: string
  /** 🔴 `HEAD^` 의 `approvals.jsonl`(없거나 부모 없으면 ''). A 판정의 다른 한쪽. */
  parentManifest: string
  /** HEAD 의 `state.json` 텍스트(없으면 null). */
  headStateText: string | null
  dirtyPaths: readonly string[]
}
```

- `evidence-recovery.ts` 는 leaf 로 남는다 — git 은 호출부(`req-doctor`·`req-commit`)가 읽어 넣는다.
- 🔴 **두 호출부가 같은 조립 함수**(`buildRecoveryFacts`)를 쓴다. 갈라지면 "doctor 는 통과, commit 은
  거부"라는 새 교착이 생긴다(REQ-2026-142 DEC 와 같은 이유).

## Phase 분해

| phase | 범위 |
|---|---|
| `phase-1-checkpoint-attribution` | A/B/C 판정(순수) · 두 호출부 조립 확장 · 실 git e2e · 문서 |

한 phase 다 — 파일 3개(`evidence-recovery` + 두 호출부) + 테스트.

## 변경 파일

`scripts/req/lib/evidence-recovery.ts` · `scripts/req/req-doctor.ts` · `scripts/req/req-commit.ts` ·
`tests/unit/evidence-recovery.test.ts` · `tests/unit/evidence-recovery-wiring.test.ts` · `CHANGELOG.md`

## 안전

- 🔴 **정상 crash window 무회귀가 첫 오라클**이다. 실 git 으로 그 창을 만들어 한 번에 수렴하는지 본다.
- D10 의 일반 판정·`consumeState` 스키마는 무변경.
- 🔴 막지 못하는 것(evidence-finalize 뒤 추가 커밋)을 막는다고 쓰지 않는다.
