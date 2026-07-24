# REQ-2026-052 리뷰 요청

## 배경

REQ-051(B1)은 원장을 승인 시에만 커밋한다 — `attempt-opened`는 외부 호출 전 워킹트리에 쓰이지만 다음 durable checkpoint(승인)에서야 커밋된다. NEEDS_FIX 후 폐기·브랜치 전환 시 원장이 소실될 수 있다. 이 REQ는 "원장이 있다"(working tree)와 "원장이 durable하다"(HEAD committed blob)를 구분하고, scratch state가 사라져도 HEAD만으로 티켓 상태·req:new 허용·재구성 여부를 판별 가능하게 한다.

개선 6건(A·B1·B2·C·D·E) 중 **B2**다. lifecycle 실패 분류·예산 규칙(C), 예외 명령(D), lockfile 축소(E)는 범위 밖.

## 변경 요약

- **DEC-A**: pre-call 원장 커밋. `attempt-opened`를 외부 호출 **전** 커밋해 durable화. **1 커밋/호출**(opened만; closed는 다음 커밋에 편승 — 유실돼도 opened가 "예산 사용·미확정" 증명). 2 커밋/attempt를 비용 분석 후 기각.
- **DEC-A2**: pre-call 커밋을 `captureGitBinding` **전**으로. 안 그러면 `afterTree===reviewTree` 오판·`reviewBaseSha` 어긋남 → review-codex 흐름 재구성.
- **DEC-B**: 커밋되는 `responses/ticket-close.jsonl`(append-only, 원장과 별도). 6-상태를 committed 사실에서 **파생**(legacy·reconstructed·series-terminal·developing·needs-recovery·dev-complete·integrated). "개발 완료"≠"통합 완료".
- **DEC-C**: req:new가 committed proof만으로 티켓 스캔 → 미종결 durable 티켓이면 fail-closed. legacy는 표시만.
- **DEC-D**: `req:reconstruct` — immutable archive+approvals로 검증가능 사실만, reconstructed 표시, 추정 금지, 사람 확인.

## r01 반영 (P1 3건)

r01 지적 3건 모두 유효해 반영했다.

1. **legacy 판정이 state.json marker에 의존 vs DEC-E scratch 모순** → **DEC-A4 신설**: state.json의 두 역할을 분리. `req:new`가 커밋하는 **scaffold state.json**(marker 포함, HEAD blob에 실존 — 확인함)이 marker 정본이자 불변이고, 런타임 갱신분만 scratch다. legacy 판정은 HEAD scaffold marker만 본다.
2. **needs-recovery가 워킹 승인을 입력으로 씀 vs HEAD-only 원칙** → **6-상태 파생을 HEAD-committed 4종만 입력으로 재정의**. needs-recovery = HEAD durable 원장의 `attempt-closed(approved)`와 HEAD 증거의 불일치(워킹 승인 아님). 승인 closed 자체가 유실됐으면 `developing`(예산 사용·미확정)으로 떨어져 역시 req:new fail-closed.
3. **phase-3 선행이 phase-1만인데 ⑱이 phase-2 산출물 사용** → phase-3 선행을 **phase-2로 정직하게 선언**.

## r02 반영 (P1: integrated 파생 불가 + 상태 개수)

r02 P1이 정확했다 — `integrated`는 4종 HEAD blob으로 파생 불가(ancestry 정보 없음). 상태 모델을 재구조화했다:
- **기본 상태 5개(순수·배타·완결)**: `legacy` > `series-terminal` > `dev-complete` > `needs-recovery` > `developing`. 항상 정확히 하나.
- **오버레이 2개**: `reconstructed`(close proof blob·순수) · `integrated`(git-ancestry·순수 아님·**상태 보고 전용, req:new 게이트 무관**).
- observation(7개 나열·reconstructed 게이트 정책 부재)도 반영: 기본/오버레이 분리로 개수 정합, 게이트 표에 오버레이 무관 규칙 명시.

## r03 설계 보정 (phase-2 착수 전 발견 갭 — semantic identity 도입)

phase-2 구현을 확인하던 중, 승인된 DEC-A2가 pre-call 원장 커밋과 세 기존 기계의 상호작용을 놓친 것을 발견했다. 사용자 판정에 따라 보정했다:

- **approval binding 의미 불변**(DEC-A2 개정): `reviewBaseSha`/`reviewTree`는 pre-call 커밋 **이후의 실제 HEAD/전체 index tree**. 응답 검증·D9·req:commit이 그대로 사용. `reviewTree`를 pathspec-only hash로 **바꾸지 않는다**(D9의 전체 staged-tree 승인 바인딩 유지).
- **semantic identity 신설**(DEC-A5): `scripts/req/lib/review-target.ts` — 작은 인터페이스 하나("현재 리뷰의 semantic identity 계산"). read-only `git ls-files -s`에서 **정확히 `review-ledger.jsonl` 줄만 제외**하고 SHA256. approvals·docs·code·일반 HEAD 변경은 제외 **안 함**(non-ledger 변경은 identity를 바꿔야 함). blocked breaker·compare_hash·req:next G2가 이 identity 사용 → 원장 커밋에 안 흔들림. 구형 marker(semantic_identity 없음)는 안전 재판정.
- **실행 순서 고정**(DEC-A6): identity 후보 계산 → D10+blocked short-circuit → 예산/예외 → attempt-opened+pre-call ledger-only commit → 실제 binding 캡처 → identity 재계산 assert → 프롬프트·호출 → 사후 검사 → marker·last_review 기록. 🔴 **blocked면 커밋·기록·예산·호출 모두 미발생**.

이 delta review는 위 보정(DEC-A2 개정·A5·A6)에 집중해 검토를 요청한다.

## r03-delta 반영 (P1: evidence-finalize가 identity를 흔들어 G2 회귀)

r03-delta P1이 정확했다 — semantic identity를 "ledger 한 줄만 제외"로 하면 evidence-finalize가 approvals·아카이브를 커밋할 때 identity가 바뀌어, 방금 승인·내구화한 리뷰를 req:next G2가 stale로 오판한다(옛 designHash가 피하던 것, 요구 #4 위반).

수정: exclusion을 **ledger 한 줄 → 티켓 `responses/` audit 디렉터리 전체**로 넓혔다. 근거: `responses/`는 순수 audit(ledger·approvals·아카이브·close-proof·codex-response·preview)이고 **리뷰 대상은 절대 그 안에 없다**(design 문서=티켓루트 0N-*.md, phase 코드=workflow/ 밖). 따라서 responses/ 전체를 제외해도 리뷰 대상은 identity에 남고, pre-call 커밋과 evidence-finalize 양쪽 bookkeeping에 identity가 불변이다. oracle ⑭b(정상 승인→evidence-finalize→G2 통과) 추가.

**⚠️ 사용자 지침 "approvals archive를 광범위하게 제외 말라"에서 의도적 이탈**: 그대로 두면 evidence-finalize가 요구 #4를 어긴다(리뷰어 확증). 사용자의 더 깊은 의도(정상 흐름 무회귀·bookkeeping에 identity 불변)를 지키는 유일한 방법이라 표기하고 진행한다.

## phase-2 구현 노트 (이번 staged diff)

DEC-A6 순서로 review-codex 흐름을 재구성했다. 이 phase-2 리뷰 자체가 pre-call 커밋을 **자기 자신에게 dogfood**한다.

- **`scripts/req/lib/review-target.ts`(신규)**: `computeReviewSemanticIdentity(ticketRel, gitFn)` = read-only `git ls-files -s`에서 `<ticketRel>/responses/` 제외 SHA256. malformed 행 보수적 포함·빈 ticketRel fail-closed.
- **review-codex 재구성**: `withAttemptRecorded`를 `gateAndRecordAttempt`(게이트+기록) + call로 분리. mainImpl: semantic identity 계산 → D10 → blocked short-circuit(identity) → gate+record → 원장 opened append + `precallCommitLedgerRow`(pathspec·durable만) → `captureGitBinding`(post-commit) → identity 재계산 assert → 프롬프트 → 호출. opened row `prompt_sha256=null`(순환의존 해소), closed row가 prompt_sha256 담음.
- **blocked marker**: `review_base_sha`+`review_binding` → `semantic_identity`. 구형 marker(필드 없음)는 `sameBlockedReviewTarget`이 불일치로 봐 재판정.
- **compare_hash = semantic identity**(design·phase 통일). **req:next**: `currentSemanticIdentity` 추가, G2 candidate compareHash가 이 값 재계산(currentDesignHash는 freshness로 유지).
- **req:new --successor-of**: `durableParentSeriesTerminal`로 부모 series-terminal close proof + ledger를 pathspec 커밋(멱등).
- **테스트 fake reviewer**: `echoPromptBase`(기본 on)로 프롬프트의 REVIEW_BASE_SHA를 응답에 echo — pre-call 커밋으로 base가 옮겨져도 near-e2e가 신경 안 쓰게. base 불일치 검증은 processResponse 단위 테스트(변경 없음).

**검증**: typecheck 0 · **전체 1510 green**. 신규 테스트: review-target 단위 10 · phase-2 near-e2e 10(⑨~⑲+⑭b, 실 git) · 부모 terminal proof 1. 사용자 필수 테스트 전부 포함 — pre-call 뒤 base=post-commit HEAD·identity 전후 동일·3번째 blocked 0(commit/attempt/ledger/reviewer)·staged 변경 시 해제·non-ledger HEAD 변경 시 해제·evidence-finalize 뒤 G2 불변·구형 marker 1회 재판정·pre-call 실패 시 호출 0·legacy 무접촉·pathspec이 staged 문서 미변조.

## 리뷰 포인트 (보정 관련 우선)

R1. **semantic identity 입력 범위가 옳은가.** `git ls-files -s`에서 `review-ledger.jsonl` **한 줄만** 제외한다. 이게 "audit-only 원장 변화만 제외하고 non-ledger 변경(approvals·docs·code·HEAD)은 identity를 바꾼다"를 정확히 달성하는가. `ls-files -s`가 원장의 3상태(untracked·modified-unstaged·committed)에서 모두 안정적으로 제외되는가.

R2. **binding 캡처 시점.** approval binding을 pre-call 커밋 **후** 캡처하면 D9·응답 검증이 정합하다는 주장이 맞는가. 특히 리뷰 시점 reviewTree(원장 opened 포함)와 req:commit D9 시점 staged tree(원장 opened 커밋됨·closed는 evidence-finalize가 D9 후 커밋)가 일치하는가.

R3. **identity 재계산 assert(6단계)가 의미 있는가.** pre-call 커밋 전후 semantic identity가 동일함을 assert한다. 이 불변식이 깨질 수 있는 정상 경로가 있는가(예: 원장 외 무언가가 커밋에 딸려감).

R4. **compare_hash 통일의 하위호환.** design compare_hash를 designHash(docs subset)→semantic identity(전체−ledger)로 바꾼다. design 재리뷰에서 baseline(non-doc) 변경 시 identity가 바뀌어 G2가 재리뷰를 허용하는 것이 옳은가. 기존 design 흐름(doc만 바뀌는 정상 series)에서 회귀가 없는가.

R5. **구형 marker 재판정이 안전한가.** semantic_identity 필드 없는 기존 blocked marker를 "불일치"로 봐 한 번 신선 리뷰 후 새 marker를 쓴다. 이게 무한 재리뷰를 열지 않는가(한 번만 재판정).

R6. **호출자 범위.** review-target.ts를 review-codex와 req:next(G2 재계산)가 공유한다. 사용자 지침 "호출자는 review-codex와 테스트뿐"과 요구 2(G2가 semantic identity 사용)가 충돌하는데, req:next를 정당한 두 번째 호출자로 두는 것이 맞는가(현재 captureIndexHash도 양쪽 공유).

## 리뷰 포인트 (기존)

1. **1 커밋/호출이 정말 하한인가.** DEC-A는 각 외부 호출이 opened를 호출 전 durable화해야 하므로 매 호출 선커밋이 불가피하다고 논증한다. 더 적은 커밋으로 같은 보장(요구 #1: 외부 호출 직전 durable opened가 process 종료 후 HEAD에서 보임)을 낼 대안이 있는가. off-HEAD 저장은 "HEAD blob 기준" 원칙 위반으로 배제했는데 타당한가.

2. **closed 유실 허용이 요구를 어기지 않는가.** closed는 다음 커밋에 편승하고, 없으면 유실된다. 요구는 "closed 유실돼도 opened로 '예산 사용·미확정' 판별 가능"이면 충족이라 본다. 이 해석이 맞는가, 아니면 closed도 durable해야 하는 경로가 있는가.

3. **DEC-A2 재구성의 안전성.** recordAttempt+opened 커밋을 `captureGitBinding` 앞으로 옮긴다. 예산·terminal·예외 게이트 순서와 R9(반환 state 계보) 불변식이 보존되는가. pre-call 커밋이 design 문서·phase 코드 staged 항목을 인덱스에 보존한다는 주장(pathspec 커밋)이 `afterTree===reviewTree`·phase의 `captureIndexHash` 바인딩과 정합하는가.

4. **6-상태 파생이 완결·배타적인가.** DEC-B 표의 상태들이 겹치거나 빈 구간을 남기지 않는가. 특히 `developing`↔`needs-recovery` 경계, `dev-complete`↔`integrated` 구분(도구가 integrated를 선언하지 않는다는 결정)이 옳은가.

5. **req:new 게이트가 정상 흐름을 막지 않는가.** DEC-C 표에서 `dev-complete`(미병합)를 허용한다. 단일 worktree 경계에서 이게 두 미병합 브랜치를 유발하지 않는가. 반대로 `developing` 차단이 정당한 재개(같은 티켓 이어가기)를 막지 않는가.

6. **재구성이 사실을 지어내지 않는가.** DEC-D는 archive_inventory로 "라운드가 아카이브됐다"만 유도하고 소실된 opened·예외 소비·실패 원인은 unknown으로 둔다. 이 경계가 "검증 불가능한 값을 만들지 않는다"(요구 #8)를 충족하는가.

7. **phase 경계.** phase-1(순수)·phase-2(pre-call 커밋)·phase-3(dev-complete·게이트)·phase-4(재구성)가 독립 커밋·독립 리뷰 가능한가. phase-2/3이 서로를 요구하지 않는다는 주장이 맞는가(phase-3 near-e2e가 phase-2 산출물을 입력으로 쓰는 것은 순서 선호이지 컴파일 의존이 아님).

8. **비목표 준수.** lifecycle 값(`completed`)을 바꾸지 않고, state.json을 커밋 정본으로 승격하지 않으며, 게이트 판정 로직을 바꾸지 않는다. 설계가 이를 어기지 않는가.
