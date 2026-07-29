# REQ-2026-085 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

### A. 병합 관측 — 아무 점검도 없다

`req-doctor.ts` 머리말: *"D1/D7·D4a 등 registry/merge 의존은 2차"*. 실제로 D2~D24 어디에도 trunk 관련
점검이 없다. D11은 "지금 feature 브랜치 위인가"만 본다. config에도 trunk 이름 키가 없다.

종결 사실은 이미 **커밋된 파일**로 남는다 — `<ticketRoot>/<REQ>/responses/ticket-close.jsonl`
(`dev-complete` / `series-terminal` / `migrated-complete`). 즉 "trunk에 도달했는가"는 **trunk 트리에
그 파일이 있는가**로 판정할 수 있다. 브랜치가 병합 후 삭제됐어도 정답이 나온다.

### B. `state.phase` — 죽었을 뿐 아니라 두 곳에서 해롭다

| 자리 | 현재 | 문제 |
|---|---|---|
| `req-new.ts` | 스캐폴드에 `phase: 'INTAKE'` 방출 | 이후 아무도 갱신 안 함 |
| `review-codex.ts` `loadState` | `!s.id \|\| !s.phase` → **필수 필드** | 값이 없으면 티켓 로드가 실패 |
| `review-codex.ts` Review Context | `- phase: ${reviewContext.phase}` | 🔴 **모든 리뷰 프롬프트에 `INTAKE` 주입** — 거짓 정보 |
| `req-doctor.ts` D11 | `if (phase !== 'DONE' && …)` | 🔴 **런타임이 절대 쓰지 않는 값으로 게이트가 열린다** |

🔴 **D11의 `DONE` 예외는 도달 불가능한 탈출구가 아니라 위조 가능한 우회로다.**
전수 확인 결과 런타임 코드 어디에도 `phase`에 `'DONE'`을 쓰는 곳이 없다(`req-next`의 `NextKind`는 무관한
별개 enum). 즉 이 조건은 **정상 경로에서 항상 참**이라 아무 기능도 하지 않는다. 그런데 `runChecks`는
**워킹 `state.json`**을 읽으므로, 손으로 `"phase": "DONE"`을 써 넣으면 `main` 위에서도 D11이 통과한다.
`tests/unit/req-doctor.test.ts`가 이 통과를 정답으로 고정하고 있다.
(참고: `req-new`의 intake 스캔은 같은 위조를 이미 HEAD blob 기준으로 차단한다 — 위조가 실재하는 위협임을
그 테스트가 이미 인정하고 있다. D11만 무방비다.)

### C. 부기 커밋 — 표식이 없다

도구가 커밋을 만드는 자리는 **11곳**이다.

| 파일 | 자리 | 빈도(yammy 108커밋 기준) |
|---|---|---|
| `review-codex.ts` | ledger attempt-opened(pre-call) | 41 |
| `lib/state-checkpoint.ts` | state checkpoint | 22 |
| `req-commit.ts` | evidence-finalize | 16 |
| `lib/evidence.ts` | design-finalize | (설계 승인마다) |
| `review-codex.ts` | ledger attempt-closed(보상) · series-terminal close proof | 드묾 |
| `req-new.ts` | 티켓 생성 | REQ당 1 |
| `req-close.ts` · `req-rebind.ts`(2) · `req-reconstruct.ts` · `req-review-exception.ts` · `bin/delivery.ts`(2) | lifecycle | 드묾 |

메시지 규약(`chore(REQ-…)`)은 있지만 **사람이 손으로 쓴 `chore(REQ-…)` 커밋과 구별되지 않는다.**

## 핵심 설계 결정

### DEC-1 — D25: 판정 근거는 **trunk 트리의 close proof**다

```
git ls-tree -r --name-only <trunk> -- <ticketRoot>      ← 1회 호출
→ 그 목록에 <REQ>/responses/ticket-close.jsonl 이 있는가
```

- **왜 브랜치가 아니라 파일인가**(R2): 병합 후 브랜치를 지우는 것이 정상 운영이다. 브랜치 존재로 판정하면
  "정리 잘한 repo"가 계속 경고를 받는다. close proof는 커밋된 증거라 병합되면 trunk 트리에 **반드시** 있다.
- **왜 티켓마다 `git log`를 돌리지 않는가**: 티켓이 80개면 호출 80회다. `ls-tree` 1회로 끝난다.
- 대상은 **워킹트리에 close proof가 있는 티켓**(= 도구가 "끝났다"고 판정한 것)뿐이다. 진행 중 티켓은 세지 않는다.

### DEC-2 — trunk는 설정값, 판정 불가면 조용히 통과

`req.config.json`에 `trunkBranch`(기본 `"main"`, `null` = D25 비활성).
`git rev-parse --verify <trunk>`가 실패하면(로컬에 없음·이름 다름·shallow) **OK '점검 불요'**다(R3).

> **왜 fail-closed가 아닌가**: D25는 *알림*이지 게이트가 아니다. 판정 불가를 FAIL로 만들면 trunk 이름이
> 다른 repo 전부가 매번 빨간 줄을 보고, 그러면 사람이 doctor 출력 전체를 무시하기 시작한다 —
> **오탐은 진짜 경고까지 죽인다.** 차단은 여전히 D2·D9·D10·D13이 한다.

### DEC-3 — 자기 티켓은 세지 않는다

doctor는 티켓 하나를 대상으로 돈다. 방금 `dev-complete`된 그 티켓이 trunk에 없는 것은 **정상**이다.
따라서 D25는 **대상 티켓을 제외한** 나머지만 센다. 1건이라도 있으면 WARN — REQ-A를 안 병합하고 REQ-B를
시작하면 바로 보인다(이 REQ가 막으려는 상황 그 자체).

### DEC-4 — D25는 **절대 FAIL하지 않는다**

D18과 같은 advisory 계열이다. 병합 시점은 사람이 정한다(`stopGate`). 이 REQ는 `stopGate`·D11·병합 정책을
바꾸지 않는다 — **보이게만** 한다.

### DEC-5 — `state.phase` 제거는 네 자리 동시에

1. `req-new.ts` — 스캐폴드에서 방출 중단 (R4)
2. `loadState` — 필수 필드 검사에서 제외. **옛 티켓은 값이 남아 있어도 무시되므로 그대로 동작한다** (R6)
3. Review Context — `- phase: <state.phase>` → **진행 중인 phase**(`current_phase`, 없으면 `-`) (R5)
4. D11 — `phase !== 'DONE' &&` 조건 **삭제**

### DEC-5b — D11의 `DONE` 예외 삭제는 **게이트를 좁히는** 변경이다

정상 경로 동작은 **완전히 동일**하다(런타임이 `'DONE'`을 쓰지 않으므로 조건은 늘 참이었다).
달라지는 것은 **위조 경로 하나가 닫히는 것**뿐이다. `tests/unit/req-doctor.test.ts`의
"phase=DONE면 브랜치 무관 OK"는 **정답이 뒤집힌다** — 그 테스트를 "위조해도 FAIL"로 갱신하고
왜 뒤집혔는지 주석에 남긴다(이 REQ가 없애는 것이 정확히 그 통과다).

### DEC-6 — 부기 표식은 **trailer 한 줄**, 단일 헬퍼 경유

```
chore(REQ-2026-085): state checkpoint — design 승인
                                                      ← 빈 줄
CommitGate-Bookkeeping: true
```

- `scripts/req/lib/bookkeeping.ts`에 `bookkeepingMessage(subject: string): string` 하나만 둔다.
  11곳 전부 이 함수를 통과한다 — 규약이 한 곳에만 있어야 드리프트하지 않는다.
- 🔴 **커밋 경로·pathspec·순서·내구성은 하나도 바뀌지 않는다**(R9). `-m` 문자열만 길어진다.
  특히 pre-call ledger 커밋의 "호출 **전**" 순서는 이 REQ의 손이 닿지 않는다.
- **왜 trailer이고 subject prefix가 아닌가**: subject는 이미 `chore(REQ-…)`인데 사람도 같은 형식을 쓴다.
  trailer는 도구만 쓰는 별도 줄이라 사람 커밋과 확실히 갈린다.

### DEC-7 — 읽기 경로는 새 verb가 아니라 문서화된 `git log` 한 줄

```
git log --oneline --invert-grep --grep='^CommitGate-Bookkeeping: true'
```

`commitgate log` verb는 만들지 않는다(비목표 — YAGNI). 대신 **이 명령이 실제로 동작하는지 테스트로
고정**한다: 실 git repo에 부기 커밋 2개 + 코드 커밋 1개를 만들고, 위 명령이 코드 커밋만 내는지 단언한다.
문서에 적힌 문자열과 테스트가 쓰는 문자열은 **같은 상수**에서 온다 — 갈라지면 문서가 거짓이 된다.

## Phase별 구현

### phase-1-dead-state-phase (DEC-5·5b)

- `scripts/req/req-new.ts` — 스캐폴드 `phase: 'INTAKE'` 제거.
- `scripts/req/review-codex.ts` — `loadState` 필수 검사에서 `phase` 제외 · Review Context를 `current_phase` 기반으로.
- `scripts/req/req-doctor.ts` — `const phase = String(s.phase)` 및 D11의 `phase !== 'DONE' &&` 삭제.
- 테스트: ①신규 스캐폴드에 `phase` 없음 ②`phase` 없는 state가 로드됨 ③`phase` 있는 옛 state도 로드됨
  ④Review Context에 `INTAKE`가 없고 진행 phase가 들어감 ⑤**`phase:'DONE'` 위조 + main → D11 FAIL**(뒤집힌 정답).

### phase-2-bookkeeping-marker-core (DEC-6 — 고빈도 경로)

- `scripts/req/lib/bookkeeping.ts` **신설** — `BOOKKEEPING_TRAILER` 상수 + `bookkeepingMessage()`.
- 적용: `review-codex.ts`(attempt-opened·attempt-closed·series-terminal) · `lib/state-checkpoint.ts` ·
  `lib/evidence.ts`(design-finalize) · `req-commit.ts`(evidence-finalize).
- 테스트: 헬퍼 형태(빈 줄 + trailer) · state checkpoint 실 커밋에 trailer가 실림 · **경로(pathspec)와 커밋 수 불변**.

### phase-3-bookkeeping-marker-lifecycle (DEC-6 — 저빈도 경로)

- 적용: `req-new.ts` · `req-close.ts` · `req-rebind.ts`(2곳) · `req-reconstruct.ts` ·
  `req-review-exception.ts` · `bin/delivery.ts`(2곳).
- 테스트: 11개 자리 **전부** 헬퍼를 통과하는지 정적 확인(누락 1곳이 규약을 깬다).

### phase-4-unmerged-warning (DEC-1·2·3·4)

- `scripts/req/lib/config.ts` — `trunkBranch` 기본값·스키마.
- `scripts/req/req-doctor.ts` — D25(순수 판정 + main()의 입력 계산).
- 테스트: ①미병합 2건 → WARN·목록 ②자기 티켓 제외 ③전부 병합 → OK ④trunk 없음 → OK '점검 불요'
  ⑤`trunkBranch: null` → 비활성 ⑥**절대 FAIL 아님**.

### phase-5-docs-changelog (DEC-7)

- `docs/workflow.md`·`docs/workflow.en.md` — 부기 표식과 읽기 명령.
- `CHANGELOG.md` — Unreleased + **확인할 파일 표**(앞 phase의 실제 커밋 SHA·경로).

## 변경 파일

| 파일 | phase |
|---|---|
| `scripts/req/req-new.ts` | 1·3 |
| `scripts/req/review-codex.ts` | 1·2 |
| `scripts/req/req-doctor.ts` | 1·4 |
| `scripts/req/lib/bookkeeping.ts` (신설) | 2 |
| `scripts/req/lib/state-checkpoint.ts` · `lib/evidence.ts` · `req-commit.ts` | 2 |
| `scripts/req/req-close.ts` · `req-rebind.ts` · `req-reconstruct.ts` · `req-review-exception.ts` · `bin/delivery.ts` | 3 |
| `scripts/req/lib/config.ts` | 4 |
| `docs/workflow.md` · `docs/workflow.en.md` · `CHANGELOG.md` | 5 |
| 각 phase의 `tests/unit/*` | 1~4 |

## 하위호환·안전

- **옛 티켓**: `state.phase`가 남아 있어도 읽지 않으므로 무해하다. 마이그레이션 없음(비목표).
- **D11**: 정상 경로 판정 불변. 위조 경로 하나만 닫힌다(DEC-5b) — 테스트 정답이 뒤집히는 **유일한** 자리다.
- **부기 커밋**: 메시지 외 **아무것도** 바뀌지 않는다. 경로·순서·커밋 수·내구성 보장 전부 그대로(R9).
  기존 커밋에는 trailer가 없으므로, 읽기 명령은 "이 변경 이후 커밋"에만 완전하다 — 문서에 명시한다.
- **D25**: WARN 상한. 판정 불가는 조용히 통과. `stopGate`·병합 정책 무변경.
- **config**: `trunkBranch` 미지정 = `"main"`. 기존 설정 파일을 고치지 않아도 동작하고,
  trunk 이름이 다른 repo는 D25가 조용히 꺼진다(FAIL 아님).
