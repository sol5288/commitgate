# REQ-2026-052 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

- **원장 쓰기 시점**(B1): `withAttemptRecorded`가 `recordAttempt` + `writeState`(state.json scratch) + `onAttemptOpened`(원장 working-tree append)를 **호출 전**에 한다. 그러나 그 원장은 **커밋되지 않는다** — 커밋은 승인 시 `durableDesignEvidence`(design) 또는 `finalizeEvidenceAndConsume`(phase)에서 일어난다.
- **git 바인딩**: `captureGitBinding()`(review-codex 내부)이 `reviewBaseSha=HEAD`·`reviewTree=write-tree(index)`를 캡처한다. 호출 후 `afterTree === reviewTree`로 **리뷰 중 인덱스 무변경**을 검증한다.
- **내구성 판정 자산**(B1·048): `isDurabilityRequired(HEAD blob)`·`verifyCommittedDesignEvidence(HEAD)`·`isLegacyTicket(review_series_model_version 부재)`·`DURABILITY_MARKER='evidence_durability_required'`.
- **pathspec 커밋 패턴**: `finalizeEvidenceAndConsume`이 `git add <경로들>` + leak 가드(`responses/` 밖 staged 금지) + `git commit`으로 **인덱스의 다른 staged 항목을 보존**한 채 특정 경로만 커밋한다.

## 핵심 설계 결정

### DEC-A. durable checkpoint 정책 — pre-call 원장 커밋, **1 커밋/호출**

**요구**: `attempt-opened`가 외부 호출 전에 HEAD에 durable해야 한다(요구 #1). 그러려면 호출 전에 커밋해야 한다.

**커밋 수 분석**:

| 방식 | 커밋/attempt | 판정 |
|---|---|---|
| opened 커밋 + closed 커밋 | 2 | ❌ closed는 자체 커밋이 불필요하다(아래) |
| **opened만 pre-call 커밋, closed는 다음 커밋에 편승** | **1** | ✅ 채택 |
| pre-call 커밋 없음(round 끝에 1커밋) | 1 | ❌ opened가 호출 전 durable하지 않음 → 요구 #1 위반 |

**1 커밋/호출이 하한이다**: 각 외부 호출은 그 호출의 opened를 **호출 전** durable하게 만들어야 하고, 호출 성공 여부를 미리 알 수 없으므로 매 호출마다 선(先)커밋이 불가피하다. off-HEAD 저장(stash·별도 ref)은 "HEAD committed blob 기준" 원칙을 위반한다.

**closed는 자체 커밋이 불필요**: `attempt-closed`는 유실돼도 durable `attempt-opened`가 "예산 사용·결과 미확정"을 증명한다(요구 원칙). 따라서 closed는 **다음 durable checkpoint에 편승**한다:
- 다음 round의 pre-call 커밋(그 커밋이 이전 round의 working-tree closed도 함께 담는다),
- 또는 승인 시 evidence-finalize 커밋,
- 또는 human-resolution/종결 시 terminal 커밋.

이 셋 중 어느 것도 없이 티켓이 폐기되면 마지막 closed는 잃지만, opened는 durable하므로 요구를 충족한다.

**비용·사용성**: 리뷰 라운드는 예산으로 유계(autoBudget 5·hardCap 8)라 series당 pre-call 커밋 ≤8. pathspec-scoped 저소음 `chore` 커밋이고, 기존 evidence-finalize 커밋과 같은 성격이다. 이 커밋 노이즈가 감수 비용이며, 그 대가로 미승인 라운드의 감사 내구성을 얻는다.

### DEC-A2. 🔴 approval binding은 pre-call 커밋 **후** 캡처하되 의미는 바꾸지 않는다

pre-call 원장 커밋이 HEAD·인덱스를 바꾸므로, `afterTree === reviewTree`와 응답 `review_base_sha` 정합은 **커밋 후에 실제 approval binding을 캡처**하면 해결된다. 그래서 흐름에서 `captureGitBinding`을 원장 커밋 **뒤**로 옮긴다(DEC-A6 순서).

🔴 **approval binding의 의미를 바꾸지 않는다**(사용자 판정):
- `reviewBaseSha` = pre-call 원장 커밋 **이후의 실제 HEAD**.
- `reviewTree` = pre-call 원장 커밋 **이후의 실제 전체 index tree**(`git write-tree`).
- 응답 검증·**D9**·`req:commit`은 이 값을 그대로 쓴다. `reviewTree`를 리뷰 대상 pathspec만의 hash로 **바꾸지 않는다** — `reviewTree`·`approved_diff_hash`는 D9의 전체 staged-tree 승인 바인딩으로 유지한다.

즉 approval binding은 원장을 포함한 실제 인덱스를 그대로 반영하며, 원장이 커밋돼도 D9는 정합하다(리뷰 시점과 커밋 시점의 인덱스에 원장 opened가 동일하게 포함되므로 — closed는 evidence-finalize가 D9 이후에 커밋).

pre-call 커밋은 **원장 경로만** stage/commit한다(design 문서·phase 코드 staged를 인덱스에 보존 — evidence-finalize의 leak 가드와 동일 기법). `git commit -- <ledger>`가 다른 staged 항목을 건드리지 않는다.

### DEC-A5. 🔴 semantic identity — 원장 커밋에 흔들리지 않는 별도 정체성

approval binding(DEC-A2)은 원장을 포함하므로 매 라운드 원장 커밋으로 값이 바뀐다. 그런데 다음 두 판정은 **같은 리뷰의 반복**을 감지해야 하므로 원장 audit 변화에 흔들리면 안 된다(발견된 갭):
- **blocked-review circuit breaker**(무한 재리뷰 차단) — 현재 `review_base_sha`+`review_binding`(reviewTree)로 키잉 → 원장 커밋마다 키가 바뀌어 **차단 붕괴**.
- **`last_review.compare_hash`** 및 **req:next G2**(바인딩 신선도) — phase는 `captureIndexHash`(전체 ls-files)라 원장 커밋마다 리셋. (design은 `designHash`=docs subset이라 이미 원장-안정.)

**신규 모듈 `scripts/req/lib/review-target.ts`** — 작은 인터페이스 하나: "현재 리뷰의 semantic identity를 계산한다". git 필터링·정렬·hash 규칙을 내부에 숨긴다.

```
computeReviewSemanticIdentity(ticketRel, gitFn): string
  = SHA256( sorted( `git ls-files -s` 각 줄 ) 중 경로가
            `<ticketRel>/responses/` **아래**인 줄을 전부 제외 )
```

- **입력 범위(안전) — 티켓 `responses/` audit 디렉터리 전체를 제외**한다.
  - 🔴 **design-r03-delta P1 반영(중요)**: 처음엔 "review-ledger.jsonl 한 줄만 제외"로 설계했으나, 리뷰어가 정상 경로 회귀를 찾았다 — evidence-finalize가 `approvals.jsonl`·아카이브를 커밋하면 identity가 바뀌어 **방금 승인·내구화한 리뷰를 req:next G2가 stale로 오판**한다(옛 designHash가 피하던 것, 요구 #4 위반). ledger뿐 아니라 evidence-finalize 산출물(approvals·archive·close-proof)도 **audit bookkeeping**이라 identity를 흔들면 안 된다.
  - 🔴 **`responses/`는 순수 audit이고 리뷰 대상은 절대 그 안에 없다**: design 문서 = 티켓 루트 `00/01/02-*.md`, phase 코드 = `workflow/` 밖. `responses/`에는 ledger·approvals·아카이브·close-proof·codex-response·preview만 있다. 따라서 `responses/` 전체를 제외해도 **리뷰 대상은 identity에 그대로 남는다**.
  - **비-audit 변경은 여전히 identity를 바꾼다**: 리뷰 대상 staged 변경(design 문서·phase 코드)과 `responses/` 밖의 non-ledger HEAD 변경(다른 소스·기준선)은 identity를 **바꾼다** — 다른 리뷰 맥락이 잘못 short-circuit되지 않는다.
  - **⚠️ 사용자 지침에서의 의도적 이탈**: 사용자는 "approvals archive를 광범위하게 제외하지 말라"고 했으나, 그러면 evidence-finalize가 identity를 바꿔 요구 #4를 어긴다(리뷰어 확증). 사용자의 더 깊은 의도(요구 #4 정상 흐름 무회귀 + 요구 2 bookkeeping에 identity 불변)를 지키려면 audit 산출물 전체를 제외해야 한다. `responses/`가 audit 전용이라 리뷰 대상 손실 없이 이 목표를 달성한다.
- **design vs phase 의미**(계산은 동일=전체 index−ledger, 의미만 명시):
  - **design**: identity가 design 문서 변경 **또는** 검토에 의미 있는 non-ledger 기준선 변경에 반응한다(둘을 구분).
  - **phase**: identity가 staged source 변경 **또는** non-ledger 기준선 변경에 반응한다(둘을 구분).
- **읽기 전용**: `git ls-files -s`만 쓴다(`git write-tree`는 object DB에 쓰므로 금지). `captureIndexHash`와 같은 read-only 기법.
- **audit 안정성**: 원장(untracked/modified/committed 어느 상태든)·approvals·아카이브·close-proof 전부 `responses/` 아래라 **경로로 제외**되므로, pre-call 원장 커밋과 evidence-finalize 양쪽에 identity가 불변이다.
- **호출자**: `review-codex`(생성) + **`req:next` main(G2 재계산)** + 테스트. req:next가 두 번째 호출자인 것은 요구 2가 compare_hash·G2를 semantic identity에 할당했기 때문이다(현재 `captureIndexHash`도 양쪽이 공유한다 — 같은 패턴). git 세부는 전부 review-target.ts 안에 있다.

**정체성 사용처 전환**:
- blocked marker에 `semantic_identity` 필드 신설. `sameBlockedReviewTarget`을 `review_kind`+`phase_id`+`semantic_identity` 비교로 바꾼다(base_sha·reviewTree 키잉 제거).
- `compare_hash` = semantic identity(design·phase **통일**). 기존 designHash/captureIndexHash 대신. req:next G2도 같은 값 재계산.
- 🔴 **designHash·reviewTree는 approval binding(freshness·D9)에서 그대로 유지** — 정체성 전환은 breaker·compare_hash에만 적용한다.

**구형 marker 안전 재판정**: 기존 state의 `blocked_review` marker가 `semantic_identity` 필드가 없으면(구형) `sameBlockedReviewTarget`이 **불일치로 본다** → short-circuit 안 함 → 한 번 신선하게 리뷰가 돌고 새 marker(semantic_identity 포함)가 기록된다. 구형 marker를 새 정체성과 같다고 **가정하지 않는다**.

### DEC-A6. 실행 순서(고정)

🔴 **같은 semantic target이 이미 blocked면** pre-call 커밋·attempt 기록·예산 소비·외부 호출이 **모두 일어나지 않는다**(2단계에서 차단).

```
1. semantic identity 후보 계산(review-target.ts) — 원장 커밋 전
2. D10 가드 + blocked short-circuit 검사(semantic identity 기준)  ← 여기서 blocked면 즉시 exit 2
3. 예산/예외 gate
4. attempt-opened 기록(state.json scratch) + **pre-call ledger-only commit**
5. 실제 approval binding 캡처(captureGitBinding: reviewBaseSha·reviewTree = post-commit)
6. semantic identity 재계산 + **pre-commit 값과 동일함 assert**(원장 커밋이 audit-only임을 검증)
7. 프롬프트 조립 + 외부 호출
8. 사후 무수정 검사(afterTree === reviewTree, actual binding) + 응답 검증(review_base_sha)
9. semantic identity 기반 blocked marker·last_review 기록
```

### DEC-A3. 재시도 멱등 — 중복 행·중복 proof 없음

- 원장 append는 B1의 자연키 멱등(`appendLedgerRow` duplicate/conflict). pre-call 커밋 재실행도 같은 opened를 재기록하지 않는다(duplicate=no-op).
- close proof append도 자연키 멱등(아래 DEC-B). evidence commit 실패 후 재시도가 중복 proof를 만들지 않는다.
- pre-call 커밋 자체가 실패하면(예: 커밋 훅) **fail-closed**로 중단 — opened가 durable하지 않은 채 호출하면 요구 위반이다.

### DEC-A4. 🔴 state.json의 두 역할 — committed scaffold marker vs runtime scratch

design-r01 P1이 지적한 모순을 명시적으로 해소한다. `state.json`은 **두 부분**이다:

- **committed scaffold**: `req:new`가 티켓 생성 시 초기 `state.json`(`evidence_durability_required:true` + `review_series_model_version:1` 포함)을 **커밋한다**(실측: HEAD blob에 존재). 이 초기 커밋본이 **durability marker의 정본**이고 **불변**이다.
- **runtime cache(scratch)**: 리뷰 진행 중 `writeState`가 갱신하는 부분은 커밋되지 않는다(D10 scratch).

따라서 "state.json은 scratch"(DEC-E)와 "legacy는 committed marker로 판정"(DEC-B)은 모순이 아니다 — **legacy 판정은 HEAD blob의 scaffold marker만** 본다(`isDurabilityRequired(headText)` — B1/048), 런타임 갱신분이 아니다. runtime 갱신이 사라져도 scaffold marker는 HEAD에 남아 durable/legacy 구분이 유지된다.

### DEC-B. close proof 상태 모델 — 커밋되는 `responses/ticket-close.jsonl`

원장과 **별도**의 append-only 커밋 파일. 원장은 attempt 단위, close proof는 **티켓/series 단위 lifecycle**이다(둘을 섞지 않는다 — 요구가 "함께 내구화"라 명시).

한 줄 = 한 lifecycle 전이:

```json
{"ticket_id":"REQ-2026-052","event":"series-terminal","series_id":"design:-#1",
 "resolution":"human-resolution","phase_inventory":null,"design_ref":null,"at":"…","reconstructed":false,"evidence_basis":null}
{"ticket_id":"REQ-2026-052","event":"dev-complete","series_id":null,"resolution":null,
 "phase_inventory":["phase-1-a","phase-2-b","phase-3-c"],"design_ref":"<design_hash>","at":"…","reconstructed":false,"evidence_basis":null}
```

### DEC-B2. 🔴 `dev-complete` proof는 **self-verifying**하다 (design-r04-delta 반영)

승인 설계는 dev-complete row에 phase inventory가 없어, **워킹 state를 안 읽는 미래의 `req:new`가 "모든 phase 증거가 완비됐는지"를 HEAD만으로 판정할 수 없었다**. inventory 없이 발행하면 (a) scratch state에 다시 의존하거나 (b) 존재하는 approval 행만 보고 완료를 오판한다. 그래서 dev-complete row를 self-verifying하게 확장한다:

- **`phase_inventory`**: 완료 대상으로 확정된 **정렬·중복 없는** phase ID 목록. 이 목록이 "무엇이 완료인가"의 정본이다(runtime `state.phases`가 아니라).
- **`design_ref`**: 이 inventory가 묶인 design approval의 참조(= 발행 시점 committed design 승인의 `design_hash`). 🔴 **design 재승인으로 phase inventory가 달라지면**, 이전 design 참조와 섞인 dev-complete proof는 **무효**다(검증기가 design_ref ≠ 현재 committed design 승인이면 dev-complete 아님).
- `series-terminal` row는 `phase_inventory`·`design_ref`가 `null`(기존 의미·자연키 멱등 유지).
- 🔴 prompt·응답 본문·민감 데이터는 넣지 않는다(경로/해시/식별자만).

**HEAD-only 검증(미래 `req:new`가 쓴다)**: dev-complete는 다음이 **전부 HEAD-committed로** 성립할 때만이다:
1. HEAD close proof에 `dev-complete` row가 있다.
2. 🔴 그 row의 `phase_inventory`의 **모든 phase**가 HEAD `approvals.jsonl`에 **현재 committed design_ref에 결속된**(phase 행 `phase_design_ref === design_ref`) phase evidence(consumed 엔트리)를 갖는다(DEC-B5). **단순 phase_id 존재는 불충분** — design-blind면 D1에서 검토된 phase가 D2 재승인 후에도 D2 완료 증명에 새어든다(phase-3a P1).
3. row의 `design_ref`가 HEAD의 committed design 승인(`verifyCommittedDesignEvidence`의 design_hash)과 **일치**한다.

하나라도 어긋나면 dev-complete가 **아니며**, `req:new`는 차단한다(요구). **runtime state는 검증에 절대 안 쓴다** — 오직 proof inventory + committed evidence만.

**5개 기본 상태(순수 파생) + 2개 오버레이**로 나눈다(design-r02 P1: `integrated`는 4종 blob으로 파생 불가). 순수 파생기의 입력은 🔴 **오직 HEAD-committed 아티팩트 4종**: ① HEAD scaffold marker(`isDurabilityRequired`) ② HEAD `ticket-close.jsonl` ③ HEAD `review-ledger.jsonl`(durable 원장) ④ HEAD 증거(`approvals.jsonl`·아카이브 — `verifyCommittedDesignEvidence` 계열). 워킹 state·워킹 승인은 절대 쓰지 않는다.

**기본 상태(순수·배타·완결 — 정확히 하나)**:

| 기본 상태 | 판정(HEAD-committed만) |
|---|---|
| `legacy` | HEAD scaffold state.json에 durability marker 부재/파손 → 이하 판정 안 함 |
| `series-terminal` | HEAD close proof에 `series-terminal` 행 존재(replace·human-resolution) |
| `dev-complete` | durable · HEAD close proof에 `dev-complete` 행 존재 · 그 행의 **`phase_inventory` 모든 phase가 현재 design_ref에 결속된 HEAD phase evidence를 가짐**(design-bound, DEC-B5) · 행의 **`design_ref` = 현재 committed design 승인**(DEC-B2 self-verify) |
| `needs-recovery` | durable · **HEAD 증거 내부 불일치**: durable 원장에 `attempt-closed(approved)`가 있으나 그 승인의 HEAD 증거(approvals 엔트리·아카이브)가 불완전 |
| `developing` | durable · 위 어디에도 안 걸림(HEAD에 완결 승인 흔적 없음 — "예산 사용·미확정" 포함) |

우선순위: `legacy` > `series-terminal` > `dev-complete` > `needs-recovery` > `developing`(기본값). 항상 정확히 하나를 낸다(완결·배타).

**오버레이(기본 상태에 얹는 boolean 속성)**:

| 오버레이 | 판정 | 순수? |
|---|---|---|
| `reconstructed` | HEAD close proof에 `reconstructed:true` 행 존재 | 예(blob) |
| `integrated` | 🔴 **git ancestry** — 티켓의 마지막 증거 커밋이 기본 브랜치에서 도달 가능한가(`git merge-base --is-ancestor`). **순수 아님**(git 질의). **상태 보고 전용이며 req:new 게이트 판정에는 쓰지 않는다.** | 아니오 |

**🔴 `integrated`를 순수 파생에서 뺀 이유**(design-r02 P1): 같은 committed snapshot이 미병합 feature 브랜치에선 `dev-complete`, main 병합 후엔 `integrated`여야 하는데, 4종 blob에는 브랜치·ancestry 정보가 없어 순수 파생기는 구분 불가다. 따라서 `integrated`는 `dev-complete` 위에 얹는 **git-ancestry 오버레이**로 분리한다. **"개발 완료"(`dev-complete`, 순수)와 "통합 완료"(`integrated`, ancestry)를 명확히 가른다** — 요구 목표 3.

**🔴 `needs-recovery`는 워킹 승인이 아니라 HEAD durable 원장으로 판정한다**(design-r01 P1). 워킹 승인/state를 삭제해도 HEAD 원장의 `attempt-closed(approved)` 흔적은 남아 불일치가 감지된다. 승인 closed 자체가 유실됐다면(DEC-A로 closed 유실 가능) HEAD엔 opened만 남아 `developing`으로 판정 — 이 역시 req:new fail-closed(DEC-C)라 완료 위장 없음.

**"개발 완료" ≠ "통합 완료"**: `dev-complete`는 모든 phase 증거가 durable하다는 뜻이고, `integrated`(git-ancestry 오버레이)는 그 증거가 기본 브랜치에 도달 가능하다는 뜻이다. `integrated`는 **사람 병합의 결과**를 ancestry로 관측할 뿐 도구가 close proof로 선언하지 않는다.

### DEC-B3. 🔴 `dev-complete` proof 발행 위치·순서 — `req:next`가 아니라 `req:commit` (design-r04-delta)

승인 설계는 "req:next가 DONE 판정 시 방출"이라 했으나 **`req:next`는 strict read-only**다(`createReadOnlyGit`이 add/commit/write-tree를 실행 전 throw). 그대로는 구현 불가. 발행 책임을 **마지막 phase의 `req:commit` evidence-finalize 경로**로 옮긴다. `req:next`는 read-only 그대로 두고, 어떤 write도 side effect도 넣지 않는다.

**발행 위치·순서(고정)**:
1. 마지막 phase의 **source commit 이후**.
2. 그 phase의 **approval archive·approvals manifest·ledger closed를 포함하는 evidence-finalize와 동일한 durable commit 경로**에서, `dev-complete` proof도 함께 stage/commit한다(한 커밋 또는 같은 finalize 트랜잭션).
3. **proof 생성 전**: prospective evidence content를 검증한다 — 이번 소비로 **모든 phase가 완료되는가**(runtime `state.phases`를 **입력으로만** 사용해 inventory를 만든다), 각 phase 증거가 실제로 있는가, design 승인이 committed인가.
4. **commit 후**: HEAD blob만 읽어 inventory의 모든 phase evidence + design_ref 완비를 **재검증**(DEC-B2 HEAD-only 검증). 어긋나면 실패(fail-closed).
5. **멱등**: evidence commit 실패·복구·재시도에서 proof·manifest·ledger 행이 **중복되지 않는다**(자연키 멱등 + `manifestHasConsumed` 계열 skip).

**마지막 phase가 아니면** dev-complete proof를 **발행하지 않는다**(중간 phase의 finalize는 그대로).

### DEC-B4. 🔴 runtime state의 역할 제한 (design-r04-delta)

- runtime `state.phases`는 **proof를 만들 때의 입력**으로만 쓴다(inventory 산출).
- **생성된 proof의 유효성 판정과 `req:new` 차단 판단은 runtime state를 절대 읽지 않는다** — 오직 proof의 phase inventory + committed evidence(HEAD blob).
- future HEAD verifier(DEC-B2)는 proof inventory와 committed evidence만 쓴다. scratch state를 삭제·변조해도 HEAD 판정이 안 변한다.
- design 재승인으로 inventory가 달라지면, 이전 design 참조와 섞인 dev-complete proof를 허용하지 않는다(design_ref 불일치 → dev-complete 아님). 🔴 나아가 **각 phase evidence 자체가 현재 design_ref에 결속돼 있어야** 완료다(DEC-B5) — proof 행의 design_ref만으로는 부족하다.

### DEC-B5. 🔴 phase evidence의 design 결속 — dev-complete의 design-bound 완전성 (phase-3a P1 보정)

**발견된 결함(phase-3a P1)**: DEC-B2는 dev-complete를 "phase_inventory의 모든 phase가 HEAD approvals.jsonl에 phase evidence를 **갖는다** + 행의 design_ref = 현재 committed design"으로 판정했다. 그러나 **phase evidence 행 자체에는 그 phase가 어느 design 승인에 대해 검토됐는지 durable하게 기록되지 않았다**(phase 행은 `approved_tree`만, `design_hash`는 design 행 전용). 결과: design D1에서 검토·커밋된 phase p1이, D2 design 재승인 후에도 D2 dev-complete의 "p1 증거 있음"을 만족시켜 **D1 검토분을 D2 완료 증명에 재사용**할 수 있다. `design_ref`를 **close-proof 행에만** 넣은 것으로는 못 막는다 — inventory의 각 phase 결속이 검증되지 않기 때문이다.

**스키마 결정(대안 비교, 요구 불변식 #1)**:
- **대안 A(기각) — design 행의 `design_hash`를 phase 행에 재사용**: phase 행이 `design_hash`를 갖게 하면 `validateManifest`의 kind 격리("phase 행에 design_hash 금지", "design 행에 approved_tree 금지")가 무너진다. 그 격리는 주입·혼동 방어의 load-bearing 불변식이다. 또 `design_hash`의 의미("이 design 승인 문서들의 해시")와 "이 phase가 결속된 design"의 의미가 뒤섞인다.
- **대안 B(채택) — phase 행에 의미가 분명한 신규 필드 `phase_design_ref`**: 값 = 그 phase 승인 시점의 **committed design 참조**(= `captureDesignBinding().designHash`, design 행의 `design_hash`와 **동일 계산·동일 값**). kind 격리를 유지한다(phase 전용, design 행엔 금지). 레거시 phase 행엔 부재 → **선택 필드**(형식 검증은 관대·무회귀)이되 durable 완료 판정에서는 부재를 **fail-closed**(아래 migration). 검증의 관대함(legacy 호환)과 완료의 엄격함을 분리하는 기존 패턴(`archive_inventory`)과 동형.

**결속 캡처 지점 = phase 승인 시점**(finalize 아님): phase 리뷰는 이미 `designValid`(= `state.design_approved === true && design_approved_hash === captureDesignBinding().designHash`)를 **강제**하고, 불충족이면 호출·커밋·기록 전 fail-closed다(review-codex DEC-A6 step 2a, line 2153). 즉 phase가 승인되는 순간의 `currentHash`가 바로 "그 phase가 검토된 committed design"이다. 이 값을 `ApprovalEvidence.phase_design_ref`에 핀하고, evidence-finalize가 manifest phase 행에 그대로 쓴다. 🔴 **finalize 시점의 committed design을 다시 읽지 않는다** — 재승인이 review와 commit 사이에 끼면 잘못된 design으로 오결속될 수 있기 때문(승인 당시 값이 정본). `review_base_sha`·`approved_tree`가 승인 시점에 핀되는 것과 같은 태도.

⚠️ **`approved_tree`와 혼동 금지**(요구 불변식 #1): `approved_tree`는 phase 승인 시점의 full-index write-tree(응답 무수정 검증용)다. 그 안에 design 문서 blob이 들어 있어도 그것을 design 참조로 역산하지 않는다 — 별도의 명시 필드가 정본이다.

**dev-complete 완전성 재정의**(DEC-B2 point 2를 대체, 요구 불변식 #2): "inventory의 각 phase가 **현재 committed design_ref에 결속된**(`phase_design_ref === committedDesignRef`) committed phase evidence를 갖는다." 이 design-bound 필터는 **manifest를 읽는 경계**(`evidencedPhaseIdsFromManifest(content, designRef)`)에서 적용하고, close-proof 순수 판정기(`isDevCompleteVerified`)는 그 결과 집합만 소비한다 — close-proof는 manifest를 파싱하지 않는 leaf라, 필터를 그 안으로 넣으면 모듈 경계가 깨진다. 판정기 계약(입력 `evidencedPhaseIds`가 이미 design-bound)만 doc로 강화한다.

**design 재승인 lifecycle**(요구 불변식 #3 — end-to-end):
- design_hash가 D1→D2로 바뀌면 D1-결속 phase 행은 D2 dev-complete에 **못 쓴다**(design-bound 필터가 제외). 재승인만으로는 dev-complete가 성립하지 않고 상태는 `developing`으로 되돌아간다.
- **정상 재검토 경로는 기존 명령만으로 성립한다**(최소 인터페이스 — 신규 명령 불필요): `resolvePhaseTarget`는 **이미 승인된 phase의 재리뷰를 허용**(멱등, line 1395)하고, `designValid`는 재승인된 D2에 대해 freshness를 재확인한다. 그러므로 ⑴ design 문서 수정 → `req:review-codex --kind design --run` 승인 → `req:commit`(D2 커밋), ⑵ 각 phase `req:review-codex --kind phase --phase pN --run` 승인 → **아래 커밋-경로 선택** 규칙으로 finalize(phase 행이 D2-결속으로 내구화), ⑶ 마지막 phase finalize가 D2 dev-complete를 append(design_ref 키잉 supersede)한다. 🔴 **state.json 수동 조작·가짜 source commit·숨은 예외 없음** — 전부 정규 게이트다. 재검토된 phase는 새 sha·새 아카이브라 manifest 중복키(`kind:phase:sha`) 충돌도 없다(D1 행은 이력으로 공존, D2 행이 완료를 만족).
- 🔴 **커밋-경로 선택(재검토 시 정확한 명령)**: 재승인 후 phase 재검토는 **설계 문서만 바뀌고 phase 코드는 그대로**인 경우가 흔하다. 그때는 staged 코드 변경이 없어 **승인 tree == HEAD tree**다.
  - **staged 코드 변경 없음(승인 tree == HEAD tree)** → 일반 `req:commit <REQ> --run`은 **쓸 수 없다**(만들 source diff가 없다). 정규 경로는 **`req:commit <REQ> --finalize --run`** — 새 source 커밋을 만들지 않고 재검토 evidence(새 `phase_design_ref` 포함)를 evidence-finalize로 내구화한다. 이는 `resolveRecoverySource`의 **orphan 복구창**(HEAD.tree == `approved_diff_hash` → `viaOrphan=true`)을 그대로 재사용하는 것이다. **state 수동 조작·가짜 커밋·증거 합성이 아니다** — 실제 승인 evidence(commit_allowed·approval_evidence·approved_diff_hash == HEAD.tree)를 검증한 뒤에만 성립한다. 이 판정은 `resolveRecoverySource`/`recoveryCoreValid` 테스트가, 전 파이프라인 전달은 addendum near-E2E가 고정한다.
  - **새 staged 코드 변경 있음**(재승인이 구현 변경을 동반) → 일반 `req:commit <REQ> --run`(source 커밋 + evidence-finalize, 2-커밋). 이 경우에만 새 source 커밋이 정당하다.
- **동일 design 참조의 단순 재시도/재내구화**는 불필요한 재리뷰를 강제하지 않는다: `manifestHasConsumed`(source sha + evidence identity) 멱등이 중복 행을 막고, `phase_design_ref`가 그대로라 design-bound 집합도 안 변한다.

**migration·legacy**(요구 불변식 #4):
- `phase_design_ref` **부재** phase 행(레거시·이 보정 이전 커밋분)은 durable 완료의 증거로 **조용히 추론하지 않는다** — design-bound 필터에서 제외되어 "현재 design에 결속된 증거 없음"으로 fail-closed.
- **legacy 티켓**(durability marker 없음)은 애초에 dev-complete 판정 대상이 아니다(`legacy` 기본 상태 우선). 표시만 하며 판정에 영향 없다.
- 🔴 **reconstruct는 결속 back-fill 경로가 아니다**(r05-delta P1): `req:reconstruct`(DEC-D)는 immutable archive·approvals로 **검증 가능한 close-proof lifecycle 행**(series-terminal·dev-complete)만 복원한다. `phase_design_ref`는 리뷰 시점에 commitgate가 **git에서 파생해 핀**하는 값이라 **아카이브(codex 응답)에 기록되지 않는다** → reconstruct가 검증 가능하게 유도할 근거가 없다. 설령 dev-complete 행을 복원해도 HEAD verifier는 여전히 design-bound phase evidence를 요구하므로 결속 없는 기존 행으로는 성립하지 않는다. 따라서 **결속 없는 티켓의 완료 경로는 재검토(위 정상 경로)뿐**이며, reconstruct는 완료-migration으로 주장하지 않는다.
- **이 REQ(2026-052) 자체**의 이미 커밋된 phase-1/2/3a 행은 `phase_design_ref`가 없다(보정 전 커밋). 따라서 이들을 포함한 REQ-052의 durable 완료는 **각 phase 재검토(위 정상 경로)** 전까지 성립하지 않는다 — 요구 #4의 **의도된 fail-closed**(결함 아님). 완료 시점에 재검토로 처리한다.

### DEC-B6. 🔴 phase 승인 archive 무결성 — dev-complete는 archive blob 존재·SHA 일치까지 (phase-3b P1 보정)

**발견된 결함(phase-3b P1)**: intake·`verifyDevCompleteAtHead`가 phase를 산입할 때 manifest 행의 `response_path`·`response_sha256` **형식**과 `phase_design_ref`만 봤다. 그러나 그 phase 승인 **archive blob이 HEAD에 실제 존재하는지, 그 SHA가 `response_sha256`과 일치하는지**는 확인하지 않았다. ∴ phase 승인 archive를 **삭제·변조한 뒤에도 dev-complete가 통과**한다 — "committed proof/evidence only" + corrupt/partial fail-closed 계약 위반. (design archive는 `verifyCommittedDesignEvidence`가 이미 존재·SHA·완전성을 검증하지만, phase archive는 대응물이 없었다.)

**보정(요구 불변식 #1·#2·#3)**:
- 🔴 **공유 leaf 모듈 `verifyPhaseArchives`**(`lib/evidence`): manifest의 phase evidence 행마다 `response_path` blob이 HEAD에 존재하고 그 sha256이 `response_sha256`과 일치하는지 검증한다(순수 + `headBlobSha256` 포트 주입 — leaf 유지, on-disk·워킹트리 미접촉). **강한 정책(요구 #1 우선안): 모든 phase manifest 행을 검증**(inventory 한정이 아니라). 감사 내구성상 재승인 이전 라운드 행까지 archive가 온전해야 한다.
- 🔴 **intake·req:commit 발행 후 verifier가 이 모듈을 공유**(요구 #3): `verifyPhaseArchives`를 `scanTicketIntake`와 `verifyDevCompleteAtHead` **양쪽이 호출**한다 → 두 경로의 phase archive 규칙이 갈라질 수 없다. `close-proof` leaf는 manifest/blob IO를 여전히 모른다(archive 검증은 `evidence` leaf에 산다). state.json·워킹트리·온디스크 파일은 판정 근거가 아니다(HEAD blob만).
- 🔴 **corrupt 처리**: phase archive가 하나라도 부재/불일치면 → intake는 `corrupt`로 **block**, req:commit 발행 후 verifier는 **throw**(fail-closed). 손상 신호로 완료를 위장할 수 없다. (**부재/불일치**는 archive 손상이므로 `corrupt` — 반면 "archive는 온전하나 현재 design_ref에 결속된 phase evidence가 없음"은 `developing`이다. 둘을 구분한다.)

**dev-complete 4조건(HEAD-only, 요구 불변식 #2)**: ① 현재 committed design 참조가 존재하고 dev-complete proof의 `design_ref`와 일치(기존 `isDevCompleteVerified`) ② close proof가 유효(파싱·자연키 정상 — 손상 시 corrupt) ③ inventory 전 phase가 현재 `design_ref`에 결속(DEC-B5, design-bound `evidencedPhaseIds`) ④ 🔴 **모든 phase 승인 archive가 HEAD에 존재하며 `response_sha256`과 일치**(DEC-B6, `verifyPhaseArchives`). ④가 이 P1의 핵심 추가다.

⚠️ **발행(emission)은 그대로 lenient**: `computeDevCompleteProof`는 마지막 phase 판정(design-bound inventory)만 한다 — archive는 방금 같은 finalize 커밋에 담겼으므로 발행 시점엔 온전하다. 무결성은 **발행 후 verifier**(`verifyDevCompleteAtHead`)와 **이후 intake**가 강제한다(사후 삭제·변조를 잡는 것이 목적).

⚠️ **design evidence 유효성(요구 #2 ①의 "유효 design")**: dev-complete는 현재 committed `design_ref` 존재·매칭을 요구한다(위 ①). design **archive** 완전성(`verifyCommittedDesignEvidence`)까지 dev-complete 조건에 넣는 대칭 강화는 이 phase-archive P1의 범위를 넘고 광범위한 fixture 변경을 요하므로, **대칭 hole로 명시**하고 별도 후속으로 남긴다(현재 needs-recovery 판정엔 이미 쓰인다). 이 delta는 요구가 명시한 **phase archive**에 집중한다.

### DEC-B7. 🔴 design 승인 archive 무결성 — dev-complete의 대칭 결함 보정 (phase-3b3)

**발견된 결함(phase-3b2 후속)**: DEC-B6은 **phase** archive 무결성만 넣고 design archive는 "별도 후속"으로 미뤘다. 그러나 dev-complete가 `design_ref`를 근거로 삼는 이상, 그 **design 승인 증거의 HEAD archive 무결성도 완료 판정의 필수 조건**이다. 현재 `verifyCommittedDesignEvidence.durable`은 **needs-recovery 판정에만** 쓰이고 dev-complete/series-terminal 통과에는 강제되지 않아, **최신 design 승인 archive나 `archive_inventory` 항목을 삭제·변조해도 dev-complete/series-terminal이 통과**한다. phase archive와 대칭인 hole다.

**보정(요구 불변식 #1·#2·#3)** — 기존 함수 **재사용**(중복 규칙 금지):
- 🔴 **공유 deep 모듈 `verifyCommittedEvidenceIntegrity(ticketRel, manifestText, ports)`**(`lib/evidence`): design·phase 증거 무결성을 한 인터페이스로 판정한다. 내부는 **재사용**:
  - **design**: manifest에 design 행이 있으면 **기존 `verifyCommittedDesignEvidence`**(REQ-2026-048 DONE 게이트) 호출 — 그 함수가 이미 최신 design 승인 archive 존재·SHA(4) + `archive_inventory` 비어있지 않음(5) + 승인본 포함(6) + **HEAD design archive 집합 == inventory**(7) + **각 inventory 항목 존재·SHA**(8)를 검증한다. `durable=false`면 무결성 문제.
  - **phase**: **기존 `verifyPhaseArchives`**(DEC-B6) 재사용 — 모든 phase 행 archive 존재·SHA.
  - 🔴 호출자는 이 **한 함수만** 부른다(design·phase 검증 순서·세부 조건 은닉 — 얕은 인터페이스 금지, 요구 #3). `verifyPhaseArchives`와 규칙 중복 없음(그대로 호출). `verifyCommittedDesignEvidence`와도 중복 없음(그대로 호출).
  - 🔴 순수/포트: `ports.headText`·`headBlobSha256`·`headArchivePaths`(HEAD blob만). close-proof leaf는 blob IO 무접촉. state.json·워킹트리·on-disk 미사용.
- 🔴 **intake·req:commit 발행 후 verifier가 이 모듈을 공유**(요구 #2): `scanTicketIntake`는 `verifyPhaseArchives` 호출을 **`verifyCommittedEvidenceIntegrity`로 교체**(design까지 포괄), `verifyDevCompleteAtHead`도 동일 교체. 두 경로가 같은 leaf 규칙을 쓴다.
- 🔴 **corrupt 처리·series-terminal 정책 명시**(요구 #2): `verifyCommittedEvidenceIntegrity.problems`가 있으면 **모든 durable 티켓**(dev-complete·series-terminal·developing 포함)에서 intake=`corrupt` block·req:commit=throw. 즉 **series-terminal도 손상된 committed audit evidence(삭제·변조된 design/phase archive)로는 통과하지 못한다**. 단 **불완전(incomplete)과 손상(tampered)은 구분**: design 행 자체가 없는 티켓(예: 대체된 미완 티켓·design 미승인)은 무결성 검사 대상이 아니라 통과 가능하고(series-terminal), 승인 흔적만 있고 committed 증거가 없는 티켓은 여전히 `needs-recovery`다. "design 행 존재 + 그 archive/inventory 손상"만 corrupt다.

**dev-complete 5조건(HEAD-only, 요구 불변식 #1)**: ① close proof 유효 ② 현재 committed `design_ref`와 일치(dev-complete proof) ③ **현재 design 승인 archive + `archive_inventory` 전체가 HEAD에 존재·SHA 일치**(DEC-B7, `verifyCommittedDesignEvidence`) ④ **모든 phase archive가 HEAD에 존재·SHA 일치**(DEC-B6, `verifyPhaseArchives`) ⑤ inventory 전 phase가 현재 `design_ref`에 결속(DEC-B5). ③④는 `verifyCommittedEvidenceIntegrity`가 corrupt로 선차단하므로, dev-complete/series-terminal은 증거가 온전할 때만 도달한다.

### DEC-C. req:new 게이트 — committed proof만으로 판정

`req:new`가 티켓 생성 전, `workflow/REQ-*` 각 티켓을 **HEAD blob 기준**으로 스캔:

- 판정 입력은 **HEAD-committed 아티팩트만**(scaffold marker·close proof·durable 원장·HEAD 증거). 워킹 state.json은 무시한다.
- **legacy**(HEAD scaffold marker 없음): 차단하지 않되 목록에 `legacy`로 표시(자동 완료 위장 금지 — 요구).
- **durable**인데 파생 상태가 `developing` 또는 `needs-recovery`인 티켓이 하나라도 있으면 **fail-closed**: 이유 + 복구 명령 안내. (`developing`은 "opened만 durable = 예산 사용·미확정"을 포함하므로, 소실된 승인 흔적이 있어도 완료 위장 없이 막힌다.)
- 파생 상태가 `dev-complete`·`series-terminal`·`integrated`이면 통과.

**허용/차단 규칙 요약**(기본 상태 기준 — 오버레이는 게이트에 무관):

| 기본 상태 | req:new | 근거 |
|---|---|---|
| `developing` | **차단** | 미종결 durable 티켓("예산 사용·미확정" 포함) |
| `needs-recovery` | **차단** | HEAD 증거 불일치 — 복구 필요 |
| `dev-complete` | 허용 | 레코드 durable(오버레이 `integrated` 여부 무관) |
| `series-terminal` | 허용 | replace/human-resolution 종결(`--successor-of` 정상 경로) |
| `legacy` | 허용(표시만) | 하위호환 |

**오버레이는 게이트 판정을 바꾸지 않는다**: `reconstructed`가 얹힌 `developing`은 여전히 차단(불완전 티켓을 재구성했다고 완료되지 않는다), `reconstructed`가 얹힌 `dev-complete`는 허용. `integrated`는 `dev-complete`의 하위 관측이라 마찬가지로 허용. 즉 게이트는 **기본 상태만** 본다.

판정은 **committed proof/evidence만**(+ `integrated` 관측 시에만 git ancestry). 워킹 state.json은 무시한다.

### DEC-D. 재구성 경로 — 명시적·검증가능만·추정 금지

- 새 명령 `req:reconstruct <REQ> [--run]`(dry-run 기본). **immutable archive + approvals evidence로 검증 가능한 사실만** 복원한다.
- 복원 행에 `reconstructed:true` + `evidence_basis`(어떤 아카이브/매니페스트에서 유도했는지) 기록.
- **복원 불가한 attempt·예외 소비·실패 원인은 `unknown`으로 남기고 추정하지 않는다.** 예: approvals의 `archive_inventory`로 "이 라운드가 아카이브됐다"는 유도 가능하지만, 아카이브 없이 소실된 opened는 복원 불가 → 만들지 않는다.
- 🔴 **범위 밖(r05-delta P1)**: reconstruct는 **close-proof lifecycle 행**만 복원한다. manifest phase 행의 `phase_design_ref`(DEC-B5) 같은 **아카이브에 기록되지 않은 결속값은 합성하지 않는다** — 결속 없는 완료를 만들 수 없다. 결속 없는 티켓의 완료는 재검토가 유일 경로다.
- **자동 실행 금지**: 사람 확인(`--run` + 명시적 확인 문장) 후에만.

### DEC-D2. 🔴 복원 가능성 매트릭스 — reconstruct가 실제로 복원할 수 있는 것 (phase-4)

reconstruct는 **HEAD-committed immutable evidence만** 읽고, 그 evidence가 close-proof 행의 **모든 필수 필드를 명확·모호하지 않게 결정할 때만** 복원한다. close-proof lifecycle event는 `dev-complete`·`series-terminal` 둘뿐이다. 각각의 복원 가능성:

| event | 복원 가능? | immutable HEAD evidence 출처 | 근거 |
|---|---|---|---|
| **dev-complete** | ❌ **절대 불가** | (없음) | `phase_inventory`(무엇이 완료인가의 정본, DEC-B5)를 approvals.jsonl의 phase_id 집합으로 **합성하면 계획됐으나 미커밋인 phase를 조용히 빼는 DEC-B5 P1이 재발**한다. inventory를 독립 기록하는 immutable 증거가 없다 → self-verifying dev-complete 행이 없으면 그 행을 복원할 **근거가 없다**. 유일한 정상 경로는 **재검토·재내구화**(reconstruct는 완료 migration을 맡지 않는다). |
| **series-terminal** (replace) | ✅ **조건부** | 커밋된 **successor** 티켓 S의 `state.json`(HEAD blob) `successor_of` | S가 이 티켓을 `req_id`로 지목하고 `parent_replace_resolution.decision='replace'`인 것 = 이 티켓 replace 종결의 immutable 증거. 필드 결정: `ticket_id`=이 티켓 · `series_id`=`successor_of.parent_series_id` · `resolution`='replace' · `at`=`parent_replace_resolution.at`. |
| **series-terminal** (human-resolution/terminate) | ❌ 불가 | (successor 없음) | `terminate`는 successor를 만들지 않아 attesting 증거가 없다. |

🔴 **필수 evidence 보강(reconstruct 소비 대상)**: 현재 `SuccessorOf`는 replace 종결(`parent_replace_resolution`)과 시점은 담으나 **`series_id`를 안 담아** series-terminal 행을 완전히 결정하지 못한다. phase-4는 `SuccessorOf`에 **`parent_series_id`를 추가**한다(additive·backward-compat — `resolveSuccessorLineage`가 이미 찾은 replace series의 `series_id`를 그대로 기록). 🔴 이것은 **reconstruct가 소비할 verifiable 증거를 완성**하는 것이며 리뷰·게이트 등 reconstruct 외 동작은 무변경이다. 구식 `successor_of`(parent_series_id 없음)는 series_id 미결정 → **복원 불가**(fail-closed).

**series-terminal 복원 조건(모두 충족해야, 요구 불변식 #1·#3)**:
1. `verifyCommittedEvidenceIntegrity(이 티켓)` 통과 — 손상(close-proof·manifest·design·phase archive) 티켓은 복원하지 않고 fail-closed.
2. 커밋된 successor S: HEAD `S/state.json`의 `successor_of.req_id`=이 티켓 · `parent_series_id` 존재 · `parent_replace_resolution.decision='replace'` · `isValidHumanResolution`.
3. 이 티켓 HEAD close-proof에 그 `series_id`의 `series-terminal` 행이 **없다**(있으면 복원 불필요; 자연키 멱등이 중복 방지).
4. 복원 결과가 기존 HEAD close-proof와 **모순되지 않는다**(자연키 충돌=conflict면 복원 불가).
5. 하나라도 부족·모호 → 그 행 **복원 불가**(사유 표시). 티켓 전체에 복원 가능한 행이 하나도 없으면 명령은 **정직한 no-op/fail-closed**.

**실행 모델(DEC-D 유지·강화, 요구 불변식 #4)**:
- `req:reconstruct <REQ> [--run]`. 기본 **dry-run**: 복원 예정 행·`evidence_basis`·불가 사유 표시, **write 0**.
- **`--run` + 사람 확인(명시적 확인 문장)** 후에만 write. 확인 없으면 write 0.
- 새 close-proof 행은 **`reconstructed:true` + 비어있지 않은 `evidence_basis`**(경로/식별자만) — close-proof validation이 강제한다.
- **append-only·자연키 멱등**(`appendCloseProofRow`) → 재시도가 중복 행·추가 커밋을 만들지 않는다. write는 **durable commit**(pathspec, `responses/` 밖 미접촉). 실패·재시도에서 반쪽/중복 없음.
- 🔴 **state.json을 고치지 않고 DONE으로 바꾸지 않는다.** `dev-complete`·`phase_design_ref`·design/phase archive는 **절대 합성하지 않는다**(요구 #2·#6).
- reconstructed overlay는 **기본 상태 규칙을 안 바꾼다**: series-terminal 행이 생기면 기본 상태는 `series-terminal`(그 event 때문이지 overlay 때문이 아니다). intake는 `baseStateBlocksIntake`(기본 상태만) — reconstructed 여부 무관(요구 #7).

### DEC-E. 하위호환·안전

- state.json은 scratch 유지. 이 REQ는 커밋 정본으로 승격하지 않는다.
- pre-call 커밋은 **신규(durable) 티켓만** — legacy 티켓의 리뷰는 기존 동작 그대로(pre-call 커밋 없음).
- 정상 승인·evidence-finalize·DONE 흐름 무회귀(요구 #4).

## Phase별 구현

### phase-1-close-proof-core
- 책임: close proof 스키마·직렬화·파싱·검증·멱등 append, 6-상태 파생(순수), 재구성 유도(순수).
- 입력: B1 원장 모델·`verifyCommittedDesignEvidence`.
- 산출물: `scripts/req/lib/close-proof.ts` · 테스트.
- 선행: 없음. 독립 검증: `vitest close-proof` · typecheck.

### phase-2-precall-durable-checkpoint
- 책임: **semantic identity 모듈(review-target.ts)** + review-codex 흐름을 DEC-A6 순서로 재구성(pre-call ledger-only 커밋 → 실제 binding 캡처 → identity 재계산 assert) + blocked breaker·compare_hash를 semantic identity로 전환(구형 marker 안전 재판정) + req:next G2 재계산 전환 + human-resolution/replace terminal proof 커밋.
- 입력: phase-1.
- 산출물: `scripts/req/lib/review-target.ts`(신규) · `review-codex.ts`·`req-next.ts`(G2)·`req-new.ts`(successor-of terminal proof)·`scratch.ts` 배선 · 테스트(요구 #1·#2·#3 + semantic identity 안정성).
- 선행: phase-1.

### phase-3a-devcomplete-proof (design-r04-delta: phase-3 재분할)
- 책임: **self-verifying `dev-complete` proof**를 마지막 phase의 `req:commit` evidence-finalize에서 발행(phase_inventory + design_ref, DEC-B2/B3) + prospective 검증(발행 전) + HEAD-only 재검증(발행 후) + 멱등 복구 + HEAD verifier(DEC-B2, close-proof.ts의 순수 판정 확장).
- 입력: phase-1(close-proof 스키마·파생) · phase-2(durable ledger·evidence 경로).
- 산출물: `scripts/req/lib/close-proof.ts`(dev-complete row에 phase_inventory·design_ref 추가·self-verify 파생) · `scripts/req/req-commit.ts`(마지막 phase 발행·HEAD 재검증·멱등) · 테스트.
- **선행: phase-1 + phase-2**.
- 독립 검증: `vitest close-proof req-commit` · typecheck · 임시 git 저장소로 발행·복구·HEAD 검증.

### phase-3a2-phase-design-binding (phase-3a P1 보정 — DEC-B5)
- 책임: phase evidence에 `phase_design_ref` 신설(DEC-B5). **kind별 strict validation·ApprovalEvidence·manifest build/parse·evidence-finalize·close-proof verifier 전부 일관 반영**(요구 불변식 #1):
  - `evidence.ts`: `ManifestEntry.phase_design_ref?`(phase 전용·선택) + `MANIFEST_KEYS` + `validateManifest`(phase면 형식 검증·design 행엔 금지) + `buildManifestEntry`(phase 승인 evidence의 값을 조건부 기록 — 부재 시 바이트 무회귀).
  - `review-codex.ts`: `ApprovalEvidence.phase_design_ref?` + `buildApprovalEvidence`·`processResponse`가 phase 승인에 값 부착 + mainImpl이 **승인 시점 `currentHash`**(designValid 통과값)를 캡처해 배선.
  - `req-commit.ts`: `evidencedPhaseIdsFromManifest(content, designRef)` **design-bound** 전환 + `computeDevCompleteProof`·`verifyDevCompleteAtHead`가 그 필터 사용(발행·HEAD 재검증 모두 design-bound).
  - `close-proof.ts`: 판정기 무변경 — 입력 `evidencedPhaseIds`가 design-bound라는 **계약 doc만 강화**(모듈 경계 유지).
- 입력: phase-1·phase-2·phase-3a.
- 산출물: `scripts/req/lib/evidence.ts` · `scripts/req/review-codex.ts` · `scripts/req/req-commit.ts` · `scripts/req/lib/close-proof.ts`(doc) · 테스트.
- **선행: phase-3a**.
- 독립 검증: `vitest close-proof evidence req-commit req-review-codex` · typecheck · 실 git fixture. 필수 테스트:
  ⑴ D1의 p1·p2 evidence+dev-complete 상태에서 **D2 design 승인만 추가**하면 `developing`(dev-complete 아님).
  ⑵ D2에서 **p2만 재검증**해도 p1이 D1-결속이면 여전히 미완료.
  ⑶ D2에서 **inventory 전 phase가 D2-결속 evidence**를 얻은 뒤에만 dev-complete.
  ⑷ 동일 design 참조 **retry는 중복 proof/evidence 없음**.
  ⑸ HEAD `state.json` 삭제·변조해도 결과 불변.
  ⑹ pre-call ledger/evidence-finalize가 **semantic identity·approval binding 무회귀**(+ phase_design_ref 캡처).
  ⑺ **legacy manifest(부재) vs durable manifest(결속)** 판정 차이를 실 git fixture로.

### phase-3b-intake-gate (design-r04-delta: phase-3 재분할)
- 책임: `req:new`가 `workflow/REQ-*`를 **HEAD-committed proof/evidence만으로** 스캔해 각 티켓 기본 상태를 파생, `developing`/`needs-recovery`가 있으면 fail-closed(이유+복구 명령), legacy는 표시만. runtime state 미사용. dev-complete 판정은 **design-bound**(DEC-B5) `evidencedPhaseIdsFromManifest(content, designRef)`를 그대로 재사용한다.
- 입력: phase-3a(self-verifying dev-complete proof) · phase-3a2(design-bound 완전성).
- 산출물: `scripts/req/req-new.ts`(intake scan·게이트) · 테스트(요구 #4·#5·#6·#7·#9).
- **선행: phase-3a2**.
- 독립 검증: `vitest req-new` · typecheck · 임시 git 저장소로 scratch 삭제 후 판정 불변.

### phase-4-reconstruct-command
- 책임: `req:reconstruct` 명령 — **복원 가능성 매트릭스(DEC-D2)**대로 HEAD-committed immutable evidence만으로 검증가능 close-proof 행만 복원·reconstructed 표시·추정 금지·사람 확인. dev-complete 절대 합성 안 함·series-terminal(replace)은 successor lineage로만.
- 입력: phase-1(close-proof) · phase-3b3(verifyCommittedEvidenceIntegrity) · phase-2(SuccessorOf에 parent_series_id 추가).
- 산출물: `scripts/req/lib/reconstruct.ts`(순수 매트릭스) · `scripts/req/req-reconstruct.ts`(CLI) · `scripts/req/review-codex.ts`(SuccessorOf.parent_series_id) · `bin/dispatch` 등록 · 테스트(DEC-D2 매트릭스).
- **선행: phase-3b3 완료 후**(사용자 지시 — reconstruct 외 기능 안 섞음).

## 변경 파일

| phase | 파일 |
|---|---|
| 1 | `scripts/req/lib/close-proof.ts`(신규) · `tests/unit/close-proof.test.ts`(신규) |
| 2 | `scripts/req/lib/review-target.ts`(신규) · `scripts/req/review-codex.ts` · `scripts/req/req-next.ts` · `scripts/req/req-new.ts` · `scripts/req/lib/scratch.ts` · 테스트 |
| 3a | `scripts/req/lib/close-proof.ts`(dev-complete row·self-verify) · `scripts/req/req-commit.ts`(발행·HEAD 재검증·멱등) · 테스트 |
| 3a2 | `scripts/req/lib/evidence.ts`(`phase_design_ref` 스키마·검증·build) · `scripts/req/review-codex.ts`(캡처·배선) · `scripts/req/req-commit.ts`(design-bound 필터) · `scripts/req/lib/close-proof.ts`(계약 doc) · 테스트 |
| 3b | `scripts/req/req-new.ts`(intake scan·게이트) · `scripts/req/lib/intake.ts`(신규) · 테스트 · `docs/guarantees.{md,en.md}` |
| 3b2 | `scripts/req/lib/evidence.ts`(`verifyPhaseArchives`) · `scripts/req/lib/intake.ts`(archive corrupt) · `scripts/req/req-commit.ts`(verifyDevCompleteAtHead 공유) · 테스트 |
| 3b3 | `scripts/req/lib/evidence.ts`(`verifyCommittedEvidenceIntegrity` — design+phase 재사용) · `scripts/req/lib/intake.ts` · `scripts/req/req-commit.ts` · 테스트 |
| 4 | `scripts/req/lib/reconstruct.ts`(신규·순수 매트릭스) · `scripts/req/req-reconstruct.ts`(신규 CLI) · `scripts/req/review-codex.ts`(`SuccessorOf.parent_series_id`) · `bin/dispatch` · 테스트 |

## 하위호환·안전

- **기존 티켓**: legacy는 미접촉. durable 티켓만 새 규칙.
- **게이트 무변경**: 승인·차단 판정 로직은 그대로. 이 REQ는 durability 관측·게이트만 추가한다.
- **fixture 불변**: `44_yammy_sales`는 읽기전용. git 동작 검증은 임시 저장소로.
- **미해결로 남기는 것**: lifecycle 실패 분류·예산 규칙(C)·예외 명령(D)은 범위 밖.
