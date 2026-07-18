# REQ-2026-037 설계 — LOW phase 자동 커밋 opt-in

> 정본 결정은 SSOT(07 상태기계 C·04 통제점표). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

- **Gate A — 매 phase 정지**([req-next.ts:480-487](../../scripts/req/req-next.ts)). `resolveNext` 분기 1:
  `if (state.commit_allowed === true) return { kind:'AWAIT_HUMAN', command: commitCmd(pm,target),
  controlPoint:'req:commit --run 직전', approvalSentence:'req:commit --run 승인' }`. **risk와 무관하게 무조건** 정지.
  이것이 교체 대상.
- **`commitCmd`**([req-next.ts:324](../../scripts/req/req-next.ts)) — `req:commit <target> --run`을 **메시지 없이** 렌더.
  지금은 사람이 정지점에서 `-m "..."`를 붙여 실행하므로 문제없다.
- **`resolveMessageSource`**([req-commit.ts:770](../../scripts/req/req-commit.ts)) — `-m`/`--message-file`/`REQ_COMMIT_MESSAGE_FILE`
  중 하나 없으면 `'커밋 메시지 필요'`로 throw. `req:next`는 read-only라 메시지를 만들 수 없다. → 자동 커밋 RUN은
  반드시 메시지를 실어야 한다(D2, **최우선 블로커**).
- **종단 DONE**([req-next.ts:558-563](../../scripts/req/req-next.ts)) — 모든 phase 소비 후 `DONE`(exit 11)으로
  "통합은 I1/B1, 사람이 승인" 안내. `command` 없는 안내문.
- **NextInput**([req-next.ts:123-139](../../scripts/req/req-next.ts)) — `reviewBudget`은 cfg에서 실려 오나 phase-commit
  정책은 없다. `risk_level`·`user_commit_confirmed`는 `state`에 이미 있다.
- **exit 계약**([req-next.ts:109-115](../../scripts/req/req-next.ts)) — `RUN=0`·`AGENT=0`·`BLOCKED=2`·`AWAIT_HUMAN=10`·`DONE=11`.
  분기 1의 **kind만** 바꾸면 되고 exit map은 무변경.
- **Gate B — HIGH 백스톱**([req-commit.ts:239-247](../../scripts/req/req-commit.ts), 호출 [755-757](../../scripts/req/req-commit.ts)).
  `userConfirmProblem`([227](../../scripts/req/req-commit.ts))은 **export됨**. `risk_level==='HIGH'` + 유효
  `user_commit_confirmed` 없으면 커밋 차단. **무변경**(백스톱).
- **설정 SSOT 2곳**: [lib/config.ts](../../scripts/req/lib/config.ts) 인라인 `CONFIG_SCHEMA`(additionalProperties:false)와
  설치용 [req.config.schema.json](../../workflow/req.config.schema.json). 드리프트 가드([req-config.test.ts](../../tests/unit/req-config.test.ts))가 둘의 deep-equal을 강제.
- **테스트**: [req-next.test.ts](../../tests/unit/req-next.test.ts) 7개 assert(:71·:325·:372·:693·:730·:744·:826)가
  `commit_allowed:true→AWAIT_HUMAN`(risk_level 없는 baseState)을 고정 — **갱신 대상**.

## 핵심 설계 결정

### D1. 설정 `phaseCommit.autoApprove` (R1) — 2값·기본 never

`reviewBudget` 배선 패턴을 그대로 따른다. `lib/config.ts`의 5곳(RawConfig·ResolvedConfig·DEFAULTS·인라인
`CONFIG_SCHEMA`·merged 블록)과 설치용 `req.config.schema.json`에 추가.

```jsonc
"phaseCommit": { "autoApprove": "never" | "low-only" }   // 기본 never
```

- 값은 `"never"`(기본·현행) / `"low-only"`. **`"all"`은 만들지 않는다** — HIGH는 Gate B가 매 phase 신선한
  `user_commit_confirmed`를 요구하므로 `"all"`은 HIGH에서 무한 livelock이거나 타임스탬프 위조를 유발한다
  (REQ-2026-019 폐기 사유). "auto-except-high"라는 축은 존재할 수 없다.
- 부재 → `DEFAULTS`가 `never`. 잘못된 값 → 스키마 enum이 loadConfig에서 fail-closed throw.
- 인라인 `CONFIG_SCHEMA`와 `req.config.schema.json`은 **byte-정합**으로 추가(드리프트 가드 유지).

### D2. 자동 커밋 분기 — fail-closed·메시지 탑재 (R2·R4)

`resolveNext` 분기 1을 조건부로. **읽는 값은 `state.commit_allowed`·`state.risk_level`·`input.hasStagedChanges`·
정책**뿐(순수).

```ts
if (state.commit_allowed === true) {
  const auto =
    input.phaseCommitAutoApprove === 'low-only' &&   // 정책 opt-in
    state.risk_level === 'LOW' &&                     // ✅ LOW 정확 일치만 (fail-closed)
    input.hasStagedChanges                            // 복구 가드(R4)
  if (auto)
    return { kind:'RUN', command: autoCommitCmd(pm, target), // -m 자리표시자 포함(D3)
             detail:'phase 승인이 살아 있다 — conventional 메시지를 작성해 자동 커밋한다.' }
  // fail-closed: never·비-LOW·누락·불명·staged 없음 → 현행 정지
  const recovering = state.commit_allowed === true && !input.hasStagedChanges
  return { kind:'AWAIT_HUMAN',
           command: commitCmd(pm, target),
           detail: recovering
             ? 'phase 승인이 살아 있으나 staged가 비었다 — 부분 커밋일 수 있다. `req:commit --finalize --run`으로 복구한다.'
             : 'phase 승인이 살아 있다. 커밋 전 사람 확인이 필요하다.',
           controlPoint:'req:commit --run 직전',
           approvalSentence:'req:commit --run 승인' }
}
```

- **fail-closed 핵심**: `risk_level!=='LOW'`(HIGH·누락·`'Low'` 오타·손상)는 전부 else → `AWAIT_HUMAN`.
  "HIGH가 아님"을 "자동 안전"으로 해석하지 않는다. HIGH(R3)는 이 else로 자연히 정지하고, Gate B가 이중 백스톱.
- **복구 가드(R4)**: `commit_allowed && !hasStagedChanges`는 정상 pre-commit(staged==approved)과 구별되는
  부분 커밋/finalize 대기 상태. 이때 자동 RUN을 내면 `req:commit`이 `'staged 변경 없음'`으로 죽어 루프가
  스핀한다. → `AWAIT_HUMAN`으로 `--finalize` 안내(자동 RUN 억제). `hasStagedChanges`는 resolveNext가 이미 계산.
- 분기 순서 무변경: 분기 0(modelProblems→BLOCKED, [471](../../scripts/req/req-next.ts))이 여전히 선행 →
  손상 state는 BLOCKED가 이긴다(:188/:283/:311 유지). 분기 1이 legacy(1.5)·design(3)보다 앞 — 무변경.

### D3. 자동 커밋 명령의 메시지 (R2) — Builder가 작성

`req:next`는 read-only라 메시지를 합성할 수 없다. 메시지 작성은 **늘 Builder의 몫**이었다(지금도 사람이 정지점에서
`-m`을 친다). 자동 커밋 RUN의 `command`는 명시적 `-m` 자리표시자를 실어 렌더한다:

```
npm run req:commit -- 2026-037 --run -m "<이 phase의 conventional 커밋 메시지>"
```

- `detail`이 "자리표시자를 실제 conventional 메시지로 바꿔 실행하라"를 지시. 이것은 RUN 중 유일하게 에이전트가
  인자를 채우는 지점(AGENT 단계에서 `git add` 파일을 고르는 것과 동형). SKILL/AGENTS 문구에 명시.
- 최악의 경우(자리표시자 그대로 실행)에도 **게이트는 안전** — 메시지 내용은 doctor/게이트가 검사하지 않는다.
  결과는 "메시지가 못생긴 커밋"일 뿐 fail-closed 위반이 아니다.
- 구현: `commitCmd`는 그대로 두고 `autoCommitCmd(pm, target)`를 신설(`-m "<...>"` 토큰 추가). `renderAction`의
  RUN 경로는 무변경(그 명령을 그대로 출력).

### D4. 병합 단일 게이트 (R5) — low-only일 때 종단을 AWAIT_HUMAN으로

정책 `low-only`에서 phase 커밋이 자동으로 흐르면, 사용자 목표인 "병합 전 단일 확인"이 실체가 되려면 종단이
멈춰야 한다. DONE(exit 11)은 `command` 없는 안내문이라 나이브한 셸 루프가 "성공, 진행"으로 오독할 수 있다.

```ts
// 모든 phase 소비 + 워킹트리 clean 종단(현 DONE 지점)
if (input.phaseCommitAutoApprove === 'low-only')
  return { kind:'AWAIT_HUMAN',
           detail:'모든 phase가 자동 커밋됐다. feature→main 통합은 사람 승인이 필요하다.',
           controlPoint:'통합(feature→main)',
           approvalSentence:'통합 통제점 — [I1] PR 생성 또는 [B1] direct push 중 택1, 해당 승인 문장을 받는다' }
return { kind:'DONE', detail:/* 현행 그대로 */ }   // never → 무회귀
```

- `never`(기본)는 DONE 유지 — **기존 사용자 무회귀**. 통합 승인 문장(I1/I2/B1)의 정확한 문구는 계약 통제점표가
  정본이고, 여기선 경로 선택을 사람에게 넘긴다(도구가 경로를 못 정한다). exit 10(AWAIT_HUMAN)으로 루프가 확실히
  멈춘다. CommitGate는 협조 게이트이므로 이 정지도 물리적 강제가 아니라 계약 정지다(전 phase 정지와 동일 성격).

### D5. Gate B·정합성 게이트 무변경 (R3·R8)

- `req-commit.ts`의 `userConfirmGate`/`userConfirmProblem`은 **무변경**. HIGH는 자동 분기(D2)에서 걸러지고,
  설령 어떤 값이 HIGH RUN을 냈어도 Gate B가 `req:commit`에서 다시 throw한다(이중 방어).
- `gateRunCandidate`의 terminal·G3 escalation·legacy(1.5)·design(3) 분기는 `commit_allowed===false` 경로라
  분기 1과 **불상**(disjoint) — 무변경. NEEDS_FIX 수렴 보호(G2)·리뷰예산(G3)도 그대로.
- `req-next`는 정책을 `state`가 아니라 `NextInput`(cfg 파생)으로 받는다 — `reviewBudget`과 동일. `state.json`
  스키마는 무변경.

## Phase별 구현

각 phase ≤리뷰가능 크기. 설정→결정로직→종단→문서 순(의존 방향).

| phase | 범위 | 변경 파일 |
|---|---|---|
| `phase-1-config-policy` | D1 — `phaseCommit.autoApprove` 설정 배선(2 SSOT)·기본 never·enum fail-closed. **런타임 동작 무변경** | `lib/config.ts`·`workflow/req.config.schema.json`·`req-config.test.ts` |
| `phase-2-autocommit-branch` | D2·D3 — `NextInput` 필드·`resolveNext` 분기 1 조건부(fail-closed LOW-only + 복구 가드)·`autoCommitCmd`·main 배선. 깨지는 7 assert 갱신 + 신규 케이스 | `req-next.ts`·`req-next.test.ts` |
| `phase-3-merge-gate` | D4 — 종단 분기 low-only→AWAIT_HUMAN·never→DONE + 테스트 | `req-next.ts`·`req-next.test.ts` |
| `phase-4-docs-optin` | D5 문서화 — AGENTS §4·README(ko/en)·SSOT 07/04·CHANGELOG + 이 repo `req.config.json=low-only`(R7) | 문서·`req.config.json` |

## 변경 파일

- `scripts/req/lib/config.ts` — `phaseCommit` 배선 5곳
- `workflow/req.config.schema.json` — `phaseCommit` 속성(드리프트 lockstep)
- `scripts/req/req-next.ts` — `NextInput.phaseCommitAutoApprove`·`resolveNext` 분기 1·종단 분기·`autoCommitCmd`·main 배선
- `tests/unit/req-next.test.ts`·`tests/unit/req-config.test.ts` — 갱신·신규
- 문서: `AGENTS.template.md`·`README.md`·`README.en.md`·`docs/ssot-design/07-…`·`docs/ssot-design/04-…`·`CHANGELOG.md`
- `req.config.json` — 이 repo opt-in

**`req-commit.ts`·`machine.schema.json`·`state.json` 스키마·`req-doctor.ts` 무변경**(D5).

## 하위호환·안전

- **opt-in 무회귀**: 설정 부재/`never`면 분기 1·종단 전부 현행과 동일(`AWAIT_HUMAN`/`DONE`). `never`가 완전한
  no-op임을 테스트로 고정(R8).
- **fail-closed 강화**: 자동은 `risk_level==='LOW'` 정확 일치 + `low-only` + staged 존재의 3중 AND. 누락·손상·HIGH는
  전부 정지. 종전(무조건 정지)보다 관대해지되, "not HIGH ⇒ auto"의 fail-open은 만들지 않는다.
- **Codex 게이트 불변**: `commit_allowed`는 여전히 STEP_COMPLETE·findings=[]에서만 참. 커밋시점 doctor(D6/D9/D16)가
  디스크에서 승인을 재검증. 자동화는 *사람 정지*만 제거하고 리뷰 보장은 건드리지 않는다.
- **HIGH 이중 방어**: 분기 1 else(D2) + `req:commit` Gate B(D5). 어느 한쪽이 뚫려도 다른 쪽이 막는다.
- **루프 안전**: 메시지 탑재(D3)로 자동 RUN이 첫 phase에서 죽지 않는다. 복구 가드(D4/R4)로 부분 커밋 스핀 차단.
  실제 구동자는 협조 에이전트(오류·AWAIT_HUMAN·BLOCKED에서 정지)라 커밋 throw 시 무한 재시도가 아니라 보고로 멈춘다.
- **잔여 트레이드오프(문서화)**: LOW 티켓의 phase별 리스크는 재평가되지 않는다(risk_level은 티켓 단위, req:new
  1회 설정). LOW 티켓의 고위험 phase 자동 커밋 가능성은 Codex 리뷰가 1차 방어이며, phase별 상향 신호는 **후속 REQ**.
