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
 "resolution":"human-resolution","at":"…","reconstructed":false}
{"ticket_id":"REQ-2026-052","event":"dev-complete","at":"…","reconstructed":false}
```

**5개 기본 상태(순수 파생) + 2개 오버레이**로 나눈다(design-r02 P1: `integrated`는 4종 blob으로 파생 불가). 순수 파생기의 입력은 🔴 **오직 HEAD-committed 아티팩트 4종**: ① HEAD scaffold marker(`isDurabilityRequired`) ② HEAD `ticket-close.jsonl` ③ HEAD `review-ledger.jsonl`(durable 원장) ④ HEAD 증거(`approvals.jsonl`·아카이브 — `verifyCommittedDesignEvidence` 계열). 워킹 state·워킹 승인은 절대 쓰지 않는다.

**기본 상태(순수·배타·완결 — 정확히 하나)**:

| 기본 상태 | 판정(HEAD-committed만) |
|---|---|
| `legacy` | HEAD scaffold state.json에 durability marker 부재/파손 → 이하 판정 안 함 |
| `series-terminal` | HEAD close proof에 `series-terminal` 행 존재(replace·human-resolution) |
| `dev-complete` | durable · **모든 phase가 HEAD 증거 완비** · HEAD close proof에 `dev-complete` 행 |
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

**"개발 완료" ≠ "통합 완료"**: `dev-complete`(순수 기본 상태)는 모든 phase 증거가 durable하다는 뜻이고, `integrated`(git-ancestry 오버레이)는 그 증거가 기본 브랜치에 도달 가능하다(사람이 병합함)는 뜻이다. `dev-complete` 전이는 **자동**(마지막 phase evidence-finalize 직후 req:next가 close proof 방출), `integrated`는 **사람 병합의 결과**를 ancestry로 관측할 뿐 도구가 close proof로 선언하지 않는다.

**close proof 방출 시점**:
- `series-terminal`: human-resolution/replace를 사람이 확정할 때(현재 state.json 수동편집 → B2가 원장+proof를 함께 커밋). 이 REQ는 이 경로를 **`req:new --successor-of`가 부모에 기록**하는 형태로 durable화한다(전용 명령 신설은 D의 몫이므로 최소 접점).
- `dev-complete`: 마지막 phase의 evidence-finalize 직후. req:next가 DONE/AWAIT_HUMAN 판정 시, 모든 phase 증거가 durable하면 `dev-complete` proof를 **커밋**(멱등).

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
- **자동 실행 금지**: 사람 확인(`--run` + 명시적 확인 문장) 후에만.

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

### phase-3-devcomplete-and-intake-gate
- 책임: req:next가 `dev-complete` proof 방출(멱등), req:new 게이트(committed proof 스캔·fail-closed).
- 입력: phase-1·phase-2.
- 산출물: `req-next.ts`·`req-new.ts` 배선 · 테스트(요구 #4·#5·#6·#7·#9).
- **선행: phase-1 + phase-2**(design-r01 P1). near-e2e ⑱이 phase-2가 만든 durable 원장을 실측 입력으로 쓴다 — 순수 판정은 phase-1만으로 가능하나 near-e2e 검증은 phase-2를 요구하므로, 선행을 phase-2로 정직하게 선언한다.

### phase-4-reconstruct-command
- 책임: `req:reconstruct` 명령 — 검증가능 사실만·reconstructed 표시·추정 금지·사람 확인.
- 입력: phase-1.
- 산출물: `bin/reconstruct.ts` + dispatch 등록 · 테스트(요구 #8).
- 선행: phase-1.

## 변경 파일

| phase | 파일 |
|---|---|
| 1 | `scripts/req/lib/close-proof.ts`(신규) · `tests/unit/close-proof.test.ts`(신규) |
| 2 | `scripts/req/lib/review-target.ts`(신규) · `scripts/req/review-codex.ts` · `scripts/req/req-next.ts` · `scripts/req/req-new.ts` · `scripts/req/lib/scratch.ts` · 테스트 |
| 3 | `scripts/req/req-next.ts` · `scripts/req/req-new.ts` · 테스트 · `docs/guarantees.{md,en.md}` |
| 4 | `bin/reconstruct.ts`(신규) · `bin/dispatch.mjs` · 테스트 |

## 하위호환·안전

- **기존 티켓**: legacy는 미접촉. durable 티켓만 새 규칙.
- **게이트 무변경**: 승인·차단 판정 로직은 그대로. 이 REQ는 durability 관측·게이트만 추가한다.
- **fixture 불변**: `44_yammy_sales`는 읽기전용. git 동작 검증은 임시 저장소로.
- **미해결로 남기는 것**: lifecycle 실패 분류·예산 규칙(C)·예외 명령(D)은 범위 밖.
