# REQ-2026-151 설계

## DEC-1 — 종결 재진입은 **source 커밋 前에** 막는다

`req:commit` 정상 `--run` 경로에서 **doctor 직후·HIGH 게이트 근처**, 즉 **어떤 write 보다도 앞**에서
HEAD 정본 lifecycle 을 판정한다.

```
runDoctor
🔴 [신설] terminalReentryProblem — HEAD 정본 판정, 종결이면 여기서 throw
HIGH 게이트 → staged tree 대조 → markPendingEvidence → source 커밋 → evidence-finalize
```

- 판정 입력은 **`scanTicketIntake(root, ticketRel, id).baseState`** 다. `req-doctor` 가 이미 쓰는
  그 경로를 그대로 쓴다 — 🔴 **술어뿐 아니라 입력 획득까지** 같아야 한다(REQ-2026-094 교훈:
  같은 술어를 쓰고도 입력이 달라 판독이 갈렸다).
- 차단 대상: `dev-complete` · `migrated-complete` · `abandoned`. 🔴 `series-terminal` 은 **차단하지
  않는다** — 그것은 series 종결이지 티켓 완료가 아니고, 대체 REQ 흐름이 그 상태를 지난다.
- 판정 실패(예외·판독 불가)는 **차단하지 않는다**. 이 검사는 **추가** 안전장치이고, 못 읽었다고
  정상 커밋을 막으면 새 교착을 만든다. 못 막는 경우는 종전 동작(=지금의 교착)으로 떨어진다.

### 안내는 실행 가능해야 한다

🔴 **안내가 이 REQ 의 계약을 스스로 어기면 안 된다**(설계 r01 P1). 초안은 꺾쇠(`<slug>`·`<id>`)와
등록부 밖 문자열(`"…"`)을 썼고, `--resolve replace` 에는 **열린 series 가 없어** 그 명령이 거부된다.

**종결 티켓에서 실제로 성공하는 것은 micro-REQ 하나뿐이다.** 대체 REQ 경로는 `--resolve replace` 가
**열린 series** 를 요구하는데 종결 티켓에는 없다 — 그러므로 **안내하지 않는다**.

🔴 **차단 뒤에도 staged 변경은 남는다**(설계 r02 P1 — 그것이 이 차단의 요점이다: 아무것도 건드리지
않는다). 그런데 `req:new` 는 **clean tree** 를 요구하므로 한 줄만 내면 그 명령이 거부된다.
**보관 → 생성 → 복원** 세 줄이 필요하다.

```text
REQ-2026-149 는 이미 dev-complete 입니다 — 완료된 티켓에는 새 작업을 붙이지 않습니다.
  사후 정정은 **단일 phase micro-REQ** 로 만드십시오(이 저장소 규범). 순서대로:
    git stash push -m "REQ-2026-149 follow-up"
    npx commitgate req:new req-2026-149-followup --run
    git stash pop
```

- 🔴 slug 는 **산출한다**(`<slug>` 를 내지 않는다) — 종결 티켓 id 에서 `-followup` 을 붙인다.
  `successorSlug`(REQ-2026-145)와 같은 원칙: 식별자는 사람의 창의가 필요한 값이 아니다.
- 🔴 이 명령들에는 **사람-결정 인자가 없다** — 자리표시자 등록부가 필요 없다. 셸 안전 판정만 통과하면 된다.
- `git stash` 는 **비-CommitGate 명령**이라 `npx commitgate … --run` 형식 검사에서 제외된다
  (REQ-2026-149 의 파킹 안내와 같은 취급).
- 🔴 **`-u` 를 쓰지 않는다.** untracked 는 브랜치 전환에 영향을 받지 않아 새 브랜치로 그대로 따라온다.
  `-u` 로 stash 하면 오히려 옛 티켓의 응답 아카이브까지 옮겨 다니게 된다.
- 🔴 이 세 줄이 **실제로 이어지는지** e2e 로 본다 — 안내는 실행돼야 안내다.
- 🔴 **명시적 reopen 전이는 이 REQ 에서 만들지 않는다.** 필요하다는 근거가 아직 없고, 만들면
  "완료"의 의미가 바로 약해진다. 필요해지는 REQ 가 그때 설계한다.

## DEC-2 — 소비 state 를 **HEAD 증거에 결속**한다

checkpoint 복구가 "정확히 도구가 만든 state" 만 커밋하게 하려면, 그 바이트를 **커밋된 증거**가
알고 있어야 한다.

`evidence-finalize` 가 매니페스트 소비 행에 **`consumed_state_sha256`** 을 함께 적는다:

```ts
// ManifestEntry (선택 키 — 옛 행에는 없다)
consumed_state_sha256?: string   // consumeState 산출을 serializeState 한 바이트의 sha256
```

- 값은 `sha256(serializeState(consumed))` 다. 🔴 **`serializeState` 가 정본**이다(REQ-2026-057) —
  checkpoint 커밋이 이미 "디스크 내용 == 도구가 쓴 상태"를 바이트로 대조하므로 같은 함수를 쓴다.
- 🔴 **순서**: evidence 커밋 **안에** 이 값이 들어가야 한다. 소비 state 를 쓰기 **전에** 계산할 수
  있다 — `consumeState` 는 순수 함수다.
- 🔴 **같은 객체를 재사용한다**(설계 r01 관찰). 해시를 만들 때 쓴 `consumed` 를 그대로 `writeState`
  에 넘긴다. `consumeState` 를 두 번 부르면 `consumed_at` 이 **다른 시각**이 되어 바이트가 갈리고,
  정상 crash window 가 `state-mismatch` 로 거부된다 — 이 REQ 가 지키려는 무회귀를 스스로 깬다.
- 옛 행에는 이 키가 없다. **부재는 "결속 없음"** 이고, 그때는 REQ-2026-150 의 A/B/C 만으로 판정한다
  (하위호환 — 옛 crash window 를 막지 않는다).

## DEC-3 — checkpoint 판정에 결속 대조를 더한다

REQ-2026-150 의 A/B/C 에 **D** 를 더한다:

| # | 관측 |
|---|---|
| A | HEAD 매니페스트에 소비 행 R 이 있고 `HEAD^` 에 없다 |
| B | HEAD state 의 `consumed_approvals` 에 R 이 없다 |
| C | 더러운 것이 `<ticket>/state.json` 뿐 |
| **D** | R 에 `consumed_state_sha256` 이 **있으면**, 워킹 `state.json` 바이트의 sha256 이 **정확히 일치** |

- 불일치·읽기 실패 → `state-mismatch`(신규 사유) → `recoveryAllowlist` 를 만들지 않는다.
- 🔴 **키가 없으면 D 를 건너뛴다**(옛 증거 하위호환). 그때 남는 위험은 **이 REQ 이전과 같다** —
  새로 열지 않는다. 문서에 그대로 적는다.
- 🔴 `hashUtf8` 은 이미 `RecoveryFacts` 에 있다. 워킹 state 바이트는 `archiveSha` 와 같은 주입
  경로(`fileSha`)로 읽는다 — 새 IO 를 만들지 않는다.

## Phase 분해

| phase | 범위 |
|---|---|
| `phase-1-terminal-reentry-guard` | DEC-1 — source 커밋 前 차단 · 안내 · 실 CLI e2e |
| `phase-2-consumed-state-commitment` | DEC-2·3 — 매니페스트 결속 기록 + 판별자 D · 실 CLI e2e |

🔴 **phase-1 이 먼저다.** 그것이 이 세션에서 실제로 밟은 교착이고, phase-2 의 e2e 를 만들 때도
그 교착에 빠지지 않아야 한다.

## 변경 파일

`scripts/req/req-commit.ts` · `scripts/req/lib/evidence.ts`(매니페스트 키) ·
`scripts/req/lib/evidence-recovery.ts` · 테스트 · `CHANGELOG.md`

## 안전

- 🔴 정상 crash window 무회귀가 두 phase 모두의 첫 오라클이다.
- 🔴 종결 판정 실패는 **차단하지 않는다** — 추가 안전장치가 새 교착을 만들면 안 된다.
- 매니페스트 새 키는 **선택**이다. 검증기가 옛 행을 거부하면 안 된다.
