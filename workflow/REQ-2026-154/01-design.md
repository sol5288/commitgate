# REQ-2026-154 설계

## DEC-1 — 결속 대조를 **소비 state 를 쓰기 전**으로 옮긴다 (결함 1·4)

지금은 대조가 `planEvidenceRecovery` 의 checkpoint 분기 하나에만 있다. 그것이 **판정 지점**이고,
`consume` 경로는 그 판정을 지나지 않는다. 대조를 **쓰기 직전**에도 둔다.

```
finalizeEvidenceAndConsume
  … already(=HEAD 에 소비 행 있음) 분기 …
  consumed = consumeState(…)
  🔴 [신설] HEAD 행에 결속이 있으면 sha256(serializeState(consumed)) 와 대조 → 다르면 throw
  writeState(consumed)
```

- 🔴 **정상 경로(`!already`)에는 대조가 필요 없다.** 그 경로는 결속을 **지금 만들어** 매니페스트에
  넣으므로 정의상 일치한다. 거기서 또 대조하면 자기 자신을 비교하는 동어반복이다.
- 🔴 **결속이 없는 옛 행은 건너뛴다**(하위호환 — REQ-2026-152 와 같은 규칙).
- 🔴 **write 전에 막는다.** 쓰고 나서 알면 이미 워킹 state 가 오염됐고, 그 상태가 다음 복구의
  입력이 된다(결함 1 의 4단계가 정확히 그 모양이다).
- 🔴 **대소문자를 정규화한다**(결함 4). `SHA256_RE` 가 `/i` 인 것은 **기존 계약**이므로 바꾸지
  않는다. 대신 **비교 양쪽을 소문자로** 맞춘다. `BindingLookup` 이 `sha` 를 **소문자로 정규화해
  돌려주는 것**이 정본이다 — 호출부마다 `toLowerCase()` 를 기억해야 하면 언젠가 빠진다.

### 대조에 걸렸을 때 무엇을 말하는가

교착을 만들지 않으려면 **나가는 길**이 있어야 한다. 이 상태의 원인은 하나뿐이다: 복구 창 안에서
누군가 state 를 바꿨다(사람이 손으로, 또는 `req:repolicy` 같은 도구가).

```text
소비 state 가 커밋된 증거의 결속과 다릅니다 — 복구 창 안에서 state.json 이 바뀌었습니다.
  이 창에서는 정책·확인 같은 state 변경을 하지 않습니다. 먼저 복구를 끝내십시오.
  워킹 변경을 되돌린 뒤(git checkout -- <ticket>/state.json) 다시 실행하십시오.
```

- 🔴 안내는 **실행 가능해야 한다**(이 저장소가 다섯 번 밟은 부류). `git checkout --` 은 HEAD 의
  state 로 되돌리고, 그 다음 `--finalize` 가 정상 복구를 이어 간다.
- 🔴 경로는 셸 안전 판정을 통과할 때만 명령으로 낸다(REQ-2026-149 계약).

## DEC-2 — 복구 창에서는 state 변경 verb 를 막는다 (결함 1)

대조만 넣으면 **막을 뿐 원인을 남긴다**. `req:repolicy` 가 그 창에서 checkpoint 를 커밋하는 것
자체가 잘못이다.

```ts
/** 복구 창(= 소비가 끝나지 않음)인가. `pending_evidence_for` 또는 `approval_evidence` 가 살아 있다. */
export function inRecoveryWindow(state): boolean
```

- `req:repolicy --run` 이 이 창이면 **쓰지 않고 거부**한다. 안내: "먼저 `req:commit --finalize --run`
  으로 복구를 끝낸 뒤 다시 채택하십시오."
- 🔴 **dry-run 은 막지 않는다** — 무엇이 바뀔지 보는 것은 안전하고, 막으면 사람이 판단할 근거를
  잃는다.
- 🔴 **`req:repolicy` 만 막는다.** 지금 관측된 것이 그것 하나다. "state 를 쓰는 모든 verb" 로
  넓히면 `req:confirm`·`req:rebind` 까지 걸려 **새 교착**을 만든다 — 근거 없이 넓히지 않는다.
  (다른 verb 가 같은 문제를 내면 그때 같은 술어를 쓴다. 술어를 **공유 가능한 형태로** 둔다.)

## DEC-3 — `.gitignore` **완화·삭제**는 자동 안내하지 않는다 (결함 2)

`.gitignore` 의 dirty 상태는 두 종류이고 **반대 방향**이다.

| 종류 | stash 가 하는 일 | 안내 |
|---|---|---|
| 규칙 **추가**(ignored 가 늘어남) | 규칙이 사라져 파일이 드러난다 | 커밋하면 해결 ✅ |
| 규칙 **삭제·완화**(ignored 가 줄어듦) | 규칙이 돌아와 파일이 감춰진다 | 커밋하면 **노출이 영구화** ❌ |

🔴 **판정 근거는 "HEAD 대비 무엇이 ignored 에서 빠졌는가"다.** 파일 내용을 파싱해 규칙을 비교하지
않는다 — gitignore 문법(부정 패턴·중첩·순서)을 손으로 해석하는 것은 이 저장소가 여러 번 실패한
"손수 oracle" 부류다. **git 에게 묻는다**:

```
git check-ignore --stdin   (워킹 .gitignore 기준)  vs  같은 판정을 HEAD 기준으로
```

🔴 그런데 HEAD 기준 판정을 얻는 표준 수단이 없다(`check-ignore` 는 워킹 규칙만 본다).
**그래서 더 단순한 관측으로 대신한다**: 안내한 커밋을 **실제로 수행했을 때 워킹트리가 clean 이
되는가**. 그것이 우리가 정말로 필요한 성질이고, 도구가 직접 확인할 수 있다.

**결론 — 판정을 뒤집는다.** "무엇이 바뀌었는지"를 추론하지 않고, **결과를 관측**한다:

```
① 미커밋 .gitignore 가 있고
② 그것을 커밋했다고 가정했을 때 남는 더러움이 있는가?
```

②는 실제로 커밋해 보지 않고는 알 수 없다. 🔴 **그러므로 도구는 그 판정을 하지 않는다.**
대신 **안내에 검증 줄을 넣는다**:

```text
    git add -- ".gitignore"
    git commit -m "chore: .gitignore" -- ".gitignore"
    git status --porcelain          # ← 🔴 비어 있어야 다음 줄로 갑니다
    git stash push --include-untracked -m "REQ-… follow-up"
```

- 🔴 **비어 있지 않으면 멈추라고 말한다.** 그리고 그때 남는 것이 무엇인지(ignore 완화로 드러난
  파일) 설명하고, **사람이** 정리할지 다시 ignore 할지 정하게 한다. 도구가 대신 정하지 않는다.
- 🔴 **왜 "감지해서 다른 안내"가 아닌가**: 감지하려면 HEAD 기준 ignore 판정이 필요하고, 그것을
  손으로 만들면 gitignore 문법 전체를 재구현하게 된다(부정 패턴 하나만 틀려도 반대로 안내한다).
  **관측 가능한 성질(clean 인가)로 대신하는 것이 정확하고 작다.**
- 🔴 이미 있는 "실패하면 멈추십시오"와 같은 계약이다 — 새 개념을 만들지 않는다.

## DEC-4 — `splitDirty` 는 git 이 준 경로를 그대로 쓴다 (결함 3)

```ts
// 지금: paths = …map((p) => p.replace(/\\/g, '/'))   ← git 경로를 바꾼다
// 이후: paths = …                                     ← 그대로
```

- 🔴 `-z` porcelain 이 준 경로가 **정본**이다. POSIX 에서 역슬래시는 파일명의 일부다.
- 🔴 `ticketRel` 쪽의 `.replace()` 도 뺀다 — 입력은 `toTicketRel` 이 만든 POSIX 값이라는 것이
  이미 계약이고(REQ-2026-153 주석), 방어적 변환을 남기면 계약이 흐려진다.
- 🔴 **Windows 무회귀**: git 은 플랫폼과 무관하게 `/` 로 보고한다 — 변환은 처음부터 불필요했다.

## Phase 분해

| phase | 범위 |
|---|---|
| `phase-1-consume-binding` | DEC-1·2 — 쓰기 전 대조 · 소문자 정규화 · 복구 창 verb 차단 · fixture 결속 정정(결함 5) |
| `phase-2-gitignore-relaxation` | DEC-3 — 검증 줄 · 멈춤 안내 · 완화·삭제 e2e |
| `phase-3-porcelain-path-fidelity` | DEC-4 — 경로 정규화 제거 · 역슬래시 회귀 |

🔴 **phase-1 이 먼저다.** 결함 1 이 유일하게 **영구 교착**을 만드는 것이고, 결함 5(틀린 fixture)를
고쳐야 그 phase 의 오라클이 성립한다.

## 변경 파일

`scripts/req/req-commit.ts` · `scripts/req/req-repolicy.ts` · `scripts/req/lib/evidence-recovery.ts` ·
`scripts/req/lib/hardblocked-facts.ts` · 테스트 4종 · `CHANGELOG.md`

## 안전

- 🔴 정상 crash window 무회귀가 세 phase 모두의 첫 오라클이다.
- 🔴 새로 막는 것마다 **나가는 길**을 함께 낸다 — 안전장치가 새 교착을 만들면 안 된다.
- 🔴 결속이 없는 옛 증거의 동작은 한 글자도 바뀌지 않는다.
