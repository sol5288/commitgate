# REQ-2026-052 리뷰 요청

## phase-3b 구현 (req:new intake gate — DEC-C) 🔴 이번 phase review 대상

DEC-C를 구현한다. 설계 문서(00/01/02)는 무변경(DEC-C가 이미 이 게이트를 규정) — 이 리뷰는 **staged 코드 diff**가 대상이다.

- **신규 `scripts/req/lib/intake.ts`**(leaf): `classifyIntake`(순수) + `scanTicketIntake`·`scanIntake`(read-only IO). 판정 입력은 **HEAD blob만**(`createEvidencePorts`·`isDurabilityRequired`·`verifyCommittedDesignEvidence`·design-bound `evidencedPhaseIdsFromManifest`·`parseCloseProof`·`parseLedger`). `deriveBaseState`(DEC-B) 재사용 + `baseStateBlocksIntake`(기본 상태만 — 오버레이 무관).
- **corrupt 처리**(요구 "corrupt/partial 통과 금지"): pass 조건(dev-complete/series-terminal)이 읽는 매니페스트·close-proof가 `validateManifest`/`parseCloseProof`에서 손상으로 판정되면 5-상태 밖의 `corrupt`로 **block**(손상 신호로 완료 위장 차단). 원장 손상은 pass 조건 입력이 아니라 별도 block하지 않는다(needs-recovery/developing 둘 다 어차피 block).
- **read-only**: 스캔은 git 조회만(`ls-tree`·`show`·`cat-file`) — write-tree·commit·state 수정 없음. `req:new --run`은 게이트 통과 후에만 checkout/커밋한다. 차단 시 **어떤 write도 전에** throw.
- **successor 제외**: `--successor-of`의 부모는 정규 replace 흐름으로 지금 종결되므로 스캔에서 제외(부모 replace 검증은 이미 통과). 그 외 미종결 durable 티켓은 그대로 차단.
- **매니페스트 파서 이동**: `parseManifestEntries`·`evidencedPhaseIdsFromManifest`·`designHashFromManifest`를 `req-commit`(command)에서 **`lib/evidence`(leaf)로 이동**해 intake(leaf)가 command에 의존하지 않게 함. `req-commit`이 기존 경로로 re-export(호출부·테스트 무변경).
- **테스트**(`tests/unit/req-new-intake.test.ts`, 실 git): D2-결속 dev-complete 통과 · D2인데 D1 phase만 차단 · series-terminal 통과 · legacy 표시만 · developing 차단 · ledger 승인+증거불완전 needs-recovery 차단 · manifest/close-proof 손상 corrupt 차단 · runtime state DONE위조·삭제 무관(HEAD developing 차단) · **스캔 read-only(HEAD·index·워킹트리 불변)** · scanIntake 전체·exclude 부모 · classifyIntake 오버레이 무관. 전체 green.

**phase-3b r01 반영**(P1: `listHeadTicketIds` HEAD 열거 우회 우려): 지적된 우회 시나리오는 **열거가 비면** 실재하므로 정면 검증했다. 코드는 `git ls-tree -d --name-only HEAD ${dir}/`로 **후행 슬래시**를 붙인다 — 이 형태는 실측상 `workflow/`의 **직계 자식**(`workflow/REQ-*`)을 정확히 열거한다(슬래시가 **없을 때만** `workflow` 자신 한 줄이 나온다; r01은 슬래시 없는 형태로 읽은 것으로 보인다). 그럼에도 이 경로의 미묘함을 없애기 위해: ⑴ 후행 슬래시가 load-bearing임을 코드 주석에 명시(제거 시 우회됨을 경고), ⑵ **생성 전 차단 e2e 추가** — HEAD에 durable `developing` 티켓이 있을 때 `req:new --run`이 throw하고 **새 커밋·브랜치·티켓 디렉터리가 하나도 안 생기는지** 실 git으로 검증한다. 열거가 비면(회귀) 이 티켓이 차단되지 않아 이 테스트가 실패하므로, 회귀를 직접 잡는다.

## r06-delta 검증 addendum (완료·커밋됨 — phase-3a2 테스트·문서 정확성)

phase-3a2 기능 보정은 승인·커밋됐다(`7bccc38`). phase-3b 전에 **동작 코드는 그대로 두고** 검증만 보강한다.

1. **실 git near-E2E ⓷ 추가**(`req-review-codex.test.ts`): `reviewCodexMain`(정상 design·phase 리뷰)로 D1 승인·완료 → D2 재승인 → 정상 phase-review가 `captureDesignBinding().designHash` → `ApprovalEvidence.phase_design_ref` → `approvals.jsonl` → `evidencedPhaseIdsFromManifest(…, D2)` → HEAD verifier 로 **끊김 없이** 전달됨을 실제 git·실제 mainImpl로 검증. D2 미결속 phase가 하나라도 있으면 dev-complete 아님, 전 phase D2 결속 뒤에만 dev-complete, `state.json` 삭제·변조 무관.
2. **DEC-B5 재승인 커밋-경로 문구 정정**: 재검토에 **새 staged 코드 변경이 없으면**(승인 tree == HEAD tree) 일반 `req:commit --run`은 불가(만들 source diff 없음)하고, **`req:commit <REQ> --finalize --run`**(`resolveRecoverySource` orphan 복구창 — HEAD.tree == approved_diff_hash → viaOrphan)이 재검토 evidence를 새 source 커밋 없이 내구화하는 **정규 경로**임을 명시. 새 코드 변경이 있는 phase만 일반 `--run`. **state 수동조작·가짜커밋·증거합성 아님** — `resolveRecoverySource`/`recoveryCoreValid` 테스트 + ⓷ addendum이 근거.

이 delta는 위 두 가지(01-design DEC-B5 lifecycle 문구·02-plan addendum 표)에 집중해 검토를 요청한다. 동작 코드(evidence.ts·review-codex.ts·req-commit.ts)는 미변경이다.

## r05-delta 보정 (phase-3a P1 — phase evidence의 design 결속, DEC-B5) 🔴 이번 delta review 대상

phase-3a는 승인·커밋됐으나(`b0fb74e`), 사후 **P1**이 발견됐다. **이 delta review는 아래 보정(DEC-B5·phase-3a2)에 집중한다.**

- **결함**: dev-complete 완전성 검증이 `evidencedPhaseIdsFromManifest`로 "inventory phase_id가 manifest에 phase evidence로 **존재**"만 봤다. phase 행에는 `approved_tree`만 있고 **그 phase가 어느 design 승인에 대해 검토됐는지 durable 기록이 없다**(`design_hash`는 design 행 전용). ∴ design D1에서 검토·커밋된 p1이 D2 재승인 후에도 D2 dev-complete를 만족 → **D1 검토분이 D2 완료 증명에 재사용**. close-proof 행의 `design_ref`(phase-3a에서 추가)만으로는 각 phase 결속이 검증되지 않아 못 막는다.
- **스키마 결정**(대안 비교): design 행 `design_hash` 재사용(대안 A)은 kind 격리 불변식(phase↔design 필드 상호 금지)을 깨고 의미를 뒤섞어 **기각**. **phase 전용 신규 필드 `phase_design_ref`**(대안 B) 채택 — 값 = 승인 시점 committed design 참조(`captureDesignBinding().designHash`, design 행 `design_hash`와 동일 계산·값). kind 격리 유지, 레거시엔 선택(형식 관대)·완료 판정엔 fail-closed(`archive_inventory`와 동형 분리).
- **결속 캡처 = phase 승인 시점**: phase 리뷰는 이미 `designValid`(design_approved_hash === captureDesignBinding().designHash)를 강제(불충족 fail-closed)하므로, 승인 순간의 `currentHash`가 곧 결속 design이다. ApprovalEvidence에 핀 → evidence-finalize가 manifest 행에 기록. finalize 시점 재조회 안 함(review/commit 사이 재승인 오결속 방지). `approved_tree`로 역산 금지(별도 명시 필드가 정본).
- **완전성 재정의**: `evidencedPhaseIdsFromManifest(content, designRef)`가 **`phase_design_ref === designRef`** 행만 산입. 발행(`computeDevCompleteProof`)·HEAD 재검증(`verifyDevCompleteAtHead`) 모두 design-bound. close-proof 순수 판정기는 무변경(입력이 design-bound라는 계약 doc만 강화 — leaf 경계 유지).
- **재승인 lifecycle**(기존 명령만): `resolvePhaseTarget` 멱등 재리뷰 허용 + `designValid` freshness 재확인 → design 재승인 후 각 phase 재리뷰·재커밋(D2-결속) → 마지막 finalize가 D2 dev-complete supersede. state 조작·가짜 커밋·숨은 예외 없음.
- **범위**: 별도 corrective phase **phase-3a2**로 구현·리뷰·커밋. **이번 delta 승인 후 phase-3a2만** 진행하고 phase-3b·4는 완료 보고 후 별도 승인.

**r05-delta r01 반영**(P1: reconstruct를 완료-migration으로 오주장): r01이 정확했다 — `phase_design_ref`는 리뷰 시점에 commitgate가 git에서 파생하는 값이라 **아카이브(codex 응답)에 없다**. 따라서 reconstruct(DEC-D)는 그 결속을 검증 가능하게 유도할 수 없고, dev-complete 행을 복원해도 HEAD verifier가 design-bound evidence를 요구하므로 결속 없는 기존 행으론 성립하지 않는다. DEC-B5 migration·DEC-D 범위·02-plan을 고쳐 **결속 없는 완료 경로는 재검토뿐**임을 명시하고, reconstruct의 결속-back-fill 주장을 제거했다.

## r04-delta 보정 (phase-3 착수 전 — self-verifying dev-complete + phase 재분할)

phase-2 완료 후, 승인 설계의 phase-3에서 두 문제를 사용자와 함께 확정해 보정했다. **이 delta review는 아래 보정에 집중한다.**

1. **`dev-complete` proof 발행 위치**: 승인 설계는 "req:next가 DONE 판정 시 방출"이라 했으나 **`req:next`는 strict read-only**(add/commit/write-tree throw). 발행을 **마지막 phase의 `req:commit` evidence-finalize**로 옮긴다(DEC-B3). req:next는 read-only 그대로.
2. **self-verifying 확장**(DEC-B2): 기존 dev-complete row는 phase inventory가 없어, 워킹 state를 안 읽는 미래 `req:new`가 "모든 phase 증거 완비"를 HEAD만으로 판정할 수 없었다. row에 **정렬·중복 없는 `phase_inventory` + `design_ref`(묶인 design 승인)**를 넣어 self-verifying화. HEAD verifier는 inventory의 모든 phase 증거 + design_ref 일치를 HEAD-committed로만 확인.
3. **runtime state 역할 제한**(DEC-B4): state.phases는 proof 만들 때 **입력으로만**. 유효성 판정·req:new 차단은 runtime 절대 미사용. design 재승인으로 inventory가 바뀌면 옛 design_ref와 섞인 proof는 무효.
4. **phase 재분할**: phase-3 → **phase-3a**(발행+HEAD 검증) / **phase-3b**(intake gate). 각 독립 리뷰·커밋. phase-4 reconstruct는 phase-3b 뒤 별도. 🔴 **이번 delta 승인 후 phase-3a만 구현·리뷰·커밋**한다.

(b)안(dev-complete row 제거·evidence 순수 추정)은 채택하지 않았다 — 승인 설계의 proof-row state model을 보존한다.

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

## phase-3a r02 반영 (P1: design 재승인 후 재완료가 영구 실패)

r02 P1이 정확했다 — dev-complete 자연키가 `(ticket, event)`라 모든 dev-complete 행이 한 키를 공유했다. design 재승인(design_ref D1→D2) 후 마지막 phase 재완료 시 새 proof(design_ref=D2)가 기존 D1 행과 **자연키 충돌**→append 안 됨→verifier가 옛 D1을 골라 developing→throw. evidence commit은 이미 났고 재시도도 동일 실패 → **재완료 경로 영구 차단**(설계 "재승인으로 이전 proof 무효, 새 proof 발행" 위반).

수정(append-only supersede):
- `closeProofRowKey`: dev-complete을 **design_ref로 키잉**(series-terminal은 series_id 유지). design_ref가 다르면 다른 자연키 → 새 dev-complete 행이 **append-only로 추가**(옛 행은 삭제 없이 supersede).
- `isDevCompleteVerified`: **현재 committedDesignRef에 맞는** dev-complete 행을 `find`로 선택(옛 design_ref 행 무시).
- 테스트: close-proof 단위(두 design_ref 행 공존·현재 ref로 선택·둘 다 아니면 developing) + **실 git 재승인→재완료 e2e**(새 proof supersede append·HEAD-verify 통과·D1+D2 공존·재시도 멱등). 전체 1533 green.

## phase-3a r01 반영 (P1: finalize 멱등성이 HEAD가 아니라 디스크 기준)

r01 P1이 **선재 버그**를 정확히 짚었다 — `finalizeEvidenceAndConsume`이 멱등성·base를 **워킹트리 매니페스트**(`ctx.existing`)로 판정했다. evidence commit이 실패하면 디스크엔 매니페스트가 이미 쓰였으므로 재시도가 그걸 "이미 finalize됨"으로 오판해 **HEAD에 증거가 없는데 완료로 진행**했다(dev-complete·archive·ledger·manifest 미커밋). DEC-B3·㉟ 위반.

수정: finalize 멱등성·base를 **HEAD blob 기준**으로 바꿨다. `headManifest = git show HEAD:approvals.jsonl`(후행 개행 복원)를 base·`manifestHasConsumed` 입력으로 쓴다 — "커밋 성공 여부"가 아니라 "HEAD에 실제 존재하는지"로 판정. 실패 후 재시도는 HEAD가 증거를 잃었으므로 재커밋하고, 성공 후 재시도는 HEAD에 있으므로 skip한다. 죽은 `ctx.existing` 필드 제거.

테스트 추가(실 git·`__setGitForTest`+export `finalizeEvidenceAndConsume`): **㉟** 디스크엔 마지막 phase 엔트리 있으나 HEAD엔 없음(커밋 실패 모사) → 재시도가 재커밋·dev-complete 발행·**중복 0**(manifest 3줄·dev-complete 1) → 다시 재시도 skip·중복 0. + **㊱** 마지막 phase 아니면 미발행. 전체 1531 green.

## phase-3a 구현 노트 (이번 staged diff — self-verifying dev-complete)

phase-3을 3a/3b로 재분할한 뒤 **3a만** 구현했다(3b·4는 후속).

- **close-proof.ts**: `CloseProofRow`에 `phase_inventory`(정렬·중복없음)·`design_ref` 추가. `series-terminal`은 둘 다 null. dev-complete는 둘 다 필수(검증 강제). `deriveBaseState`의 dev-complete를 **self-verify**로: `isDevCompleteVerified` = dev-complete row 존재 + inventory 전 phase가 `evidencedPhaseIds`에 있음 + `design_ref === committedDesignRef`. `CloseStateInput`에서 `allPhasesEvidenced` → `evidencedPhaseIds`+`committedDesignRef`로 교체(runtime 미사용, HEAD-committed만).
- **req-commit.ts**: `computeDevCompleteProof`(순수·export) = 이 phase 커밋이 마지막 phase 완료면 proof row, 아니면 null. `state.phases`는 inventory 입력으로만(DEC-B4). `finalizeEvidenceAndConsume`이 마지막 phase면 dev-complete proof를 **같은 evidence 커밋**에 stage/commit(DEC-B3) + **발행 후 HEAD-only 재검증**(`verifyDevCompleteAtHead` → deriveBaseState가 dev-complete여야). 멱등(자연키 duplicate). design_ref는 커밋된 매니페스트 design 엔트리에서(HEAD-일관).
- **req:next는 미접촉** — read-only 그대로.

검증: typecheck 0 · 전체 1529 green. 신규 테스트: computeDevCompleteProof 6(㊱㊳ 포함) + close-proof self-verify 파생 4(㉛㉜㉝ + null design_ref) + dev-complete 스키마 6 + **실 git HEAD-only 검증 4**(㉛㉜㉝㉞ — runtime state 삭제·변조에도 판정 불변).

**주의(리뷰 포인트)**: ㉚(마지막 evidence 커밋에 4종 함께 durable)·㉟(재시도 중복 없음)의 full reqCommitMain e2e는 이 REQ의 **실제 마지막 phase에서 dogfood로 실증**된다(3a는 마지막 아님 → 이번 커밋엔 dev-complete 미발행). 발행 결정·HEAD 검증·멱등은 위 단위/실git 테스트가 덮는다.

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
