# REQ-2026-052 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN.

## Phase 1 — close proof 코어 (`phase-1-close-proof-core`)

| 항목 | 내용 |
|---|---|
| 책임 계약 | close proof 스키마·직렬화·파싱·검증·멱등 append + 6-상태 파생(순수) + 재구성 유도(순수) |
| 입력 | B1 원장 모델 · `verifyCommittedDesignEvidence` 관례 |
| 산출물 | `scripts/req/lib/close-proof.ts` · `tests/unit/close-proof.test.ts` |
| 선행 phase | 없음 |
| 독립 검증 | `npx vitest run tests/unit/close-proof.test.ts` · `npm run typecheck` |

**범위**: 부작용 0. fs·git 미접촉. 호출부 없음 → 단독 커밋해도 런타임 무변경.

**Red 먼저**: ① 직렬화 고정 키순+개행 ② round-trip ③ 자연키 멱등(dup/conflict) ④ 손상 fail-closed ⑤ 모르는 키 거부·모르는 값 forward-compat ⑥ 6-상태 파생이 각 입력에서 정확 ⑦ 본문 저장 자리 없음(prompt/response) ⑧ 재구성 유도가 검증가능 사실만 내고 나머지 unknown.

## Phase 2 — pre-call durable checkpoint (`phase-2-precall-durable-checkpoint`)

| 항목 | 내용 |
|---|---|
| 책임 계약 | semantic identity(review-target.ts)가 원장 커밋에 불변 · 원장 opened가 외부 호출 **전** 커밋(binding은 커밋 후 캡처) · blocked breaker·compare_hash·G2가 semantic identity 사용 · human-resolution/replace가 원장+terminal proof 커밋 |
| 입력 | phase-1 |
| 산출물 | `review-target.ts`(신규) · `review-codex.ts`(DEC-A6 재구성) · `req-next.ts`(G2) · `req-new.ts`(terminal proof) · `scratch.ts` · 테스트 |
| 선행 phase | phase-1 |
| 독립 검증 | `npx vitest run tests/unit/review-target.test.ts tests/unit/req-review-codex.test.ts tests/unit/req-next.test.ts tests/unit/req-new.test.ts` · `npm run typecheck` |

**Red 먼저**(요구 #1·#2·#3 + 사용자 필수 테스트):
| # | oracle |
|---|---|
| ⑨ | ledger-only pre-call commit **뒤** actual `reviewBaseSha`/`reviewTree`가 응답 검증·D9에 정상 사용된다 |
| ⑩ | ledger-only commit **전후 semantic identity 동일**(review-target 순수 + near-e2e assert) |
| ⑪ | 동일 staged source로 BLOCKED 2회 후 **3번째는 ledger commit·예산 소비·Codex 호출 없이 차단**(near-e2e — 호출 0건·원장 무증가·예산 무증가) |
| ⑫ | source staged diff가 바뀌면 semantic identity가 달라져 **차단기 해제** |
| ⑬ | ledger 아닌 HEAD 변경은 semantic identity를 바꿔 이전 BLOCKED 재사용 안 함 |
| ⑭ | phase last_review/G2 비교가 ledger-only commit으로 **리셋 안 됨** |
| ⑭b | 🔴 정상 승인→**evidence-finalize(approvals·아카이브 커밋)**→req:next G2가 **여전히 통과**(semantic identity가 responses/ 제외라 불변 — design-r03-delta P1) |
| ⑮ | design 재리뷰도 동일 원칙(원장·evidence 안정·doc 변경 시 identity 변화) |
| ⑯ | pre-call commit 실패 → 호출 **전** fail-closed |
| ⑰ | 외부 호출 **전** HEAD에 opened committed(호출이 throw해도 남는다 — process 종료 모사, 요구 #1) |
| ⑱ | replace 종결이 원장+`series-terminal` proof를 커밋(요구 #3) |
| ⑲ | 구형 blocked marker(semantic_identity 없음)는 안전 재판정(한 번 신선 리뷰) |
| ⑳ | legacy 티켓은 pre-call 커밋 없음·기존 동작(요구 #7) |

**핵심 재구성 주의**: DEC-A6 순서 고정. recordAttempt+opened 커밋을 binding 캡처 앞으로 옮기되 예산·terminal·예외 게이트 순서·R9 계보 보존. blocked short-circuit(2단계)은 커밋·기록·예산·호출 전에 판정.

## Phase 3a — self-verifying dev-complete proof (`phase-3a-devcomplete-proof`)

design-r04-delta: phase-3을 3a(발행+HEAD 검증)/3b(intake gate)로 재분할. 각각 독립 리뷰·커밋.

| 항목 | 내용 |
|---|---|
| 책임 계약 | 마지막 phase `req:commit` evidence-finalize가 self-verifying `dev-complete` proof(phase_inventory+design_ref)를 같은 durable commit에 발행 · 발행 전 prospective 검증 · 발행 후 HEAD-only 재검증 · 멱등 복구 · close-proof.ts에 HEAD-only dev-complete 판정 |
| 입력 | phase-1(스키마·파생) · phase-2(durable ledger·evidence 경로) |
| 산출물 | `scripts/req/lib/close-proof.ts`(row 확장·self-verify 파생) · `scripts/req/req-commit.ts`(발행·재검증·멱등) · 테스트 |
| 선행 phase | phase-1 + phase-2 |
| 독립 검증 | `npx vitest run tests/unit/close-proof.test.ts tests/unit/req-commit.test.ts` · `npm run typecheck` · 임시 git 저장소 발행/복구/HEAD검증 |

**Red 먼저**(사용자 필수 테스트):
| # | oracle |
|---|---|
| ㉚ | 마지막 phase evidence-finalize commit에 approval archive·approvals manifest·ledger closed·**dev-complete proof**가 함께 durable |
| ㉛ | HEAD verifier가 proof inventory의 **모든 phase**에 대응하는 committed evidence를 확인 → dev-complete |
| ㉜ | inventory 중 하나라도 evidence 없음 → dev-complete **아님** |
| ㉝ | design_ref가 현재 committed design 승인과 불일치(재승인으로 inventory 변경 모사) → dev-complete **아님** |
| ㉞ | scratch state 삭제·변조해도 HEAD 판정 불변(runtime 미사용) |
| ㉟ | 마지막 evidence commit 실패 후 재시도 → 중복 proof·manifest·ledger 행 없음(멱등) |
| ㊱ | **아직 마지막 phase 아님** → dev-complete proof 발행 안 함 |
| ㊲ | legacy 티켓은 기존 동작(발행 없음) |
| ㊳ | phase_inventory는 정렬·중복 없음(runtime state.phases를 입력으로만) |

## Phase 3a2 — phase evidence의 design 결속 (`phase-3a2-phase-design-binding`)

phase-3a 리뷰 P1 보정(DEC-B5). dev-complete가 phase evidence의 **design 결속**을 검증하지 않아, D1에서 검토된 phase가 D2 재승인 후에도 D2 완료 증명에 새어들 수 있던 결함을 닫는다.

| 항목 | 내용 |
|---|---|
| 책임 계약 | phase evidence에 `phase_design_ref`(phase 전용·승인 시점 committed design 결속) 신설 → **kind별 strict validation·ApprovalEvidence·manifest build/parse·evidence-finalize·close-proof verifier 일관 반영**(요구 #1) · dev-complete 완전성을 **design-bound**로 재정의(요구 #2) · 재승인 lifecycle은 기존 명령만으로 성립(요구 #3) · 부재 행 fail-closed·legacy 표시만(요구 #4) |
| 입력 | phase-1 · phase-2 · phase-3a |
| 산출물 | `scripts/req/lib/evidence.ts` · `scripts/req/review-codex.ts` · `scripts/req/req-commit.ts` · `scripts/req/lib/close-proof.ts`(계약 doc) · 테스트 |
| 선행 phase | phase-3a |
| 독립 검증 | `npx vitest run tests/unit/close-proof.test.ts tests/unit/evidence-module.test.ts tests/unit/req-commit.test.ts tests/unit/req-review-codex.test.ts` · `npm run typecheck` · 실 git fixture |

**Red 먼저**(사용자 필수 테스트):
| # | oracle |
|---|---|
| ㊹ | D1의 p1·p2 evidence+dev-complete(D1) 상태에서 **D2 design 승인만 추가**하면 파생 상태 `developing`(dev-complete 아님) |
| ㊺ | D2에서 **p2만 D2-결속 재검증**해도 p1이 D1-결속이면 여전히 미완료 |
| ㊻ | D2에서 **inventory 전 phase가 D2-결속 evidence**를 얻은 뒤에만 dev-complete(supersede row) |
| ㊼ | 동일 design 참조 **retry는 중복 proof/evidence 없음**(natural-key·`manifestHasConsumed` 멱등) |
| ㊽ | HEAD `state.json` 삭제·변조해도 판정 불변(design-bound 필터도 HEAD manifest만) |
| ㊾ | `evidencedPhaseIdsFromManifest(content, designRef)`가 `phase_design_ref` 불일치 행을 제외 · design 행엔 `phase_design_ref` 금지 · phase 행 형식 검증 |
| ㊿ | pre-call ledger/evidence-finalize가 semantic identity·approval binding 무회귀 + **phase 승인이 `phase_design_ref` 캡처**(near-e2e) |
| ⓵ | **legacy manifest(부재) vs durable manifest(결속)** 판정 차이를 실 git fixture로 |
| ⓶ | 레거시 phase 행(`phase_design_ref` 부재)은 durable 완료 증거로 **불산입**(fail-closed) · 바이트 무회귀(부재 시 기존 행과 동일) |

**검증 addendum**(phase-3b 착수 전 — 동작 코드 무변경, 테스트·문서 정확성만 보강):
| # | oracle |
|---|---|
| ⓷ | 🔴 **실 git near-E2E 전 파이프라인**: `reviewCodexMain`(정상 design·phase 리뷰)로 D1 승인·완료 → D2 재승인 → 정상 phase-review가 `captureDesignBinding().designHash` → `ApprovalEvidence.phase_design_ref` → `approvals.jsonl` → `evidencedPhaseIdsFromManifest(…, D2)` → HEAD verifier 로 **끊김 없이** 전달. D2 미결속 phase가 하나라도 있으면 dev-complete 아님, 전 phase D2 결속 뒤에만 dev-complete. `state.json` 삭제·변조 무관. |

**재승인 커밋-경로 문구 정정**(DEC-B5): 재검토에 **새 staged 코드 변경이 없으면**(승인 tree == HEAD tree) 일반 `req:commit --run`은 불가하고 **`req:commit <REQ> --finalize --run`**(orphan 복구창 — `resolveRecoverySource` `viaOrphan`)이 정규 경로임을 명시. 새 코드 변경이 있는 phase만 일반 `--run`. state 수동조작·가짜커밋·증거합성 아님(→ `resolveRecoverySource`/`recoveryCoreValid` 테스트 + ⓷ addendum이 근거).

## Phase 3b — req:new intake gate (`phase-3b-intake-gate`)

| 항목 | 내용 |
|---|---|
| 책임 계약 | req:new가 HEAD-committed proof/evidence만으로 티켓 스캔·기본 상태 파생 · `developing`/`needs-recovery`면 fail-closed(이유+복구) · legacy 표시만 · runtime state 미사용 · dev-complete 판정은 design-bound(DEC-B5) 재사용 |
| 입력 | phase-3a2(design-bound 완전성) |
| 산출물 | `scripts/req/req-new.ts`(intake scan·게이트) · 테스트 · `docs/guarantees.{md,en.md}` |
| 선행 phase | phase-3a2 |
| 독립 검증 | `npx vitest run tests/unit/req-new.test.ts` · `npm run typecheck` · 임시 git 저장소 |

**Red 먼저**(요구 #4·#6·#7·#9):
| # | oracle |
|---|---|
| ㊴ | 정상 흐름 무회귀(dev-complete 티켓 있으면 req:new 허용) |
| ㊵ | scratch state 삭제 후 main에서 req:new → 미종결 durable(developing/needs-recovery) 감지·fail-closed(실 git·HEAD proof만) |
| ㊶ | legacy 티켓은 req:new 차단 안 함(표시만) |
| ㊷ | 기본 상태별 req:new: `developing`·`needs-recovery` 차단 / `dev-complete`·`series-terminal` 허용 |
| ㊸ | AWAIT_HUMAN·통합 대기·DONE 각각 HEAD proof만으로 허용/차단 판정 |

## Phase 3b2 — phase 승인 archive 무결성 (`phase-3b2-phase-archive-integrity`)

phase-3b 리뷰 P1 보정(DEC-B6). phase 승인 archive blob 존재·SHA를 검증하지 않아, archive 삭제·변조 뒤에도 dev-complete가 통과하던 결함을 닫는다.

| 항목 | 내용 |
|---|---|
| 책임 계약 | **공유 leaf `verifyPhaseArchives`**(`lib/evidence`)로 phase manifest 행의 승인 archive HEAD 존재·SHA 일치 검증(강한 정책=모든 phase 행) · intake·`verifyDevCompleteAtHead` **양쪽이 공유**(요구 #3) · 손상 시 intake=corrupt block·req:commit=throw · close-proof leaf는 blob IO 미접촉 · HEAD blob만(state·워킹트리·on-disk 미사용) |
| 입력 | phase-1(close-proof) · phase-3a2(design-bound) · phase-3b(intake) |
| 산출물 | `scripts/req/lib/evidence.ts`(verifyPhaseArchives) · `scripts/req/lib/intake.ts` · `scripts/req/req-commit.ts`(verifyDevCompleteAtHead 공유) · 테스트 |
| 선행 phase | phase-3b |
| 독립 검증 | `npx vitest run tests/unit/evidence-module.test.ts tests/unit/req-new-intake.test.ts tests/unit/req-commit.test.ts` · `npm run typecheck` · 실 git |

**Red 먼저**(사용자 필수 테스트):
| # | oracle |
|---|---|
| ⓸ | 유효 design + D2-bound phase manifest + valid dev-complete에서, 현재 inventory phase 승인 archive를 HEAD에서 **삭제**하면 corrupt/block |
| ⓹ | 같은 조건에서 archive 바이트를 바꿔 **SHA 불일치**로 만들면 corrupt/block |
| ⓺ | archive 정상·SHA 일치면 dev-complete/pass |
| ⓻ | D1 archive는 있어도 D2-bound phase evidence가 없으면 developing/block(archive 손상 아님 — corrupt와 구분) |
| ⓼ | req:new --run 차단 시 HEAD·index·branch·새 티켓 디렉터리 모두 불변 |
| ⓽ | req:commit 발행 후 `verifyDevCompleteAtHead`도 **동일** phase archive 무결성 규칙을 통과해야 dev-complete(공유 규칙 — 삭제/변조면 throw) |

## Phase 3b3 — design 승인 archive 무결성 (`phase-3b3-design-archive-integrity`)

phase-3b2 후속 대칭 보정(DEC-B7). dev-complete가 design_ref를 근거로 삼으므로 그 design 승인 증거의 HEAD archive 무결성도 완료 판정 필수 조건.

| 항목 | 내용 |
|---|---|
| 책임 계약 | **공유 deep `verifyCommittedEvidenceIntegrity`**(`lib/evidence`)가 design(재사용 `verifyCommittedDesignEvidence`)+phase(재사용 `verifyPhaseArchives`) 무결성을 한 인터페이스로 판정 · intake·`verifyDevCompleteAtHead` 양쪽이 이 한 함수 공유(요구 #3, 중복 규칙 없음) · 손상 시 intake=corrupt·req:commit=throw · **series-terminal도 손상 audit evidence로 통과 불가**(불완전≠손상 구분) · HEAD blob만·close-proof leaf blob IO 무접촉 |
| 입력 | phase-3b(intake) · phase-3b2(verifyPhaseArchives) |
| 산출물 | `scripts/req/lib/evidence.ts`(verifyCommittedEvidenceIntegrity) · `scripts/req/lib/intake.ts` · `scripts/req/req-commit.ts` · 테스트 |
| 선행 phase | phase-3b2 |
| 독립 검증 | `npx vitest run tests/unit/evidence-module.test.ts tests/unit/req-new-intake.test.ts tests/unit/req-commit.test.ts` · `npm run typecheck` · 실 git |

**Red 먼저**(사용자 필수 테스트):
| # | oracle |
|---|---|
| ⑽ | 최신 design 승인 archive 삭제 → corrupt/block |
| ⑾ | 최신 design 승인 archive SHA 변조 → corrupt/block |
| ⑿ | archive_inventory 안의 과거 needs-fix/design archive 삭제·변조 → corrupt/block |
| ⒀ | design·phase archive 모두 정상일 때만 dev-complete/pass |
| ⒁ | req:commit 발행 후 HEAD verifier도 design archive 손상에서 throw |
| ⒂ | 차단 시 req:new --run은 HEAD/index/branch/티켓 생성 모두 불변 |
| ⒃ | legacy는 기존 표시-only 유지 · **series-terminal도 손상 evidence면 corrupt**(온전/design-행-없음이면 통과) |

## Phase 4 — 재구성 명령 (`phase-4-reconstruct-command`)

복원 가능성 매트릭스(DEC-D2): dev-complete=절대 불가(inventory 합성 금지)·series-terminal(replace)=successor의 committed `successor_of`(+parent_series_id)로만·terminate=불가.

| 항목 | 내용 |
|---|---|
| 책임 계약 | `req:reconstruct <REQ>`가 **HEAD-committed immutable evidence만**으로 close-proof 행을 복원(모든 필드 명확 결정 시만) · dev-complete 절대 합성 안 함 · series-terminal은 successor lineage로만 · `verifyCommittedEvidenceIntegrity` 실패 티켓 fail-closed · dry-run 기본·`--run`+사람확인 후만 write · `reconstructed:true`+`evidence_basis` 필수 · append-only·자연키 멱등·durable commit · state.json 미변경 |
| 입력 | phase-1(close-proof) · phase-3b3(verifyCommittedEvidenceIntegrity) · phase-2(SuccessorOf — parent_series_id 추가) |
| 산출물 | `scripts/req/lib/reconstruct.ts`(순수 매트릭스) · `scripts/req/req-reconstruct.ts`(CLI) · `bin/dispatch` 등록 · `scripts/req/review-codex.ts`(SuccessorOf.parent_series_id) · 테스트 |
| 선행 phase | phase-3b3 |
| 독립 검증 | `npx vitest run tests/unit/reconstruct.test.ts` · `npm run typecheck` · 실 git |

**Red 먼저**(사용자 필수 테스트):
| # | oracle |
|---|---|
| ⒄ | dry-run은 HEAD·index·워킹트리 불변(write 0) |
| ⒅ | 검증가능 series-terminal 증거(successor lineage+parent_series_id)만 있을 때 reconstructed 행이 durable commit으로 **정확히 한 번** |
| ⒆ | 동일 실행 재시도 → 중복 행/추가 커밋 없음(자연키 멱등) |
| ⒇ | close-proof·manifest·design archive·phase archive 중 하나라도 손상 → 복원 거부 |
| ㉑ | dev-complete close proof 없고 phase manifest만 → **복원 거부**(inventory 합성 안 함) |
| ㉒ | `phase_design_ref`·design archive 증거 합성 시도 → 거부(애초에 그 경로 없음) |
| ㉓ | reconstructed overlay는 intake 기본 상태 규칙 불변(series-terminal은 event 때문이지 overlay 때문 아님) |
| ㉔ | `--run` 전 사람 확인 없으면 write 0 |

**multi-witness 모호성 보정(P1 delta)**:
| # | oracle |
|---|---|
| ㉕ | 같은 series_id + 서로 다른 decided_at successor 2개 → dry-run ambiguity 표시 · `--run --confirm`도 commit 0 / close-proof 0 |
| ㉖ | 같은 series_id + 동일 at successor 2개 → reconstructed 행 1개 · evidence_basis에 두 state 경로 정렬 기록 |
| ㉗ | 서로 다른 series_id successor 2개 → 각 series-terminal 행 독립 복원 |
| ㉘ | 기존 HEAD 행과 후보의 at 또는 resolution 충돌 → fail-closed·write 0(멱등으로 숨기지 않음) |
| ㉙ | 동일한 기존 행 → 재시도 no-op·추가 커밋 0 |

## Phase 4c — 패키징 정합성 (`phase-4c-packaging-surface`)

main 통합 후 CI 9/9 실패 보정(DEC-D3). dispatch에 req:reconstruct 등록했으나 init/migrate/uninstall/smoke의 명령 표면이 역사적 5 서명에서 파생돼 누락 → smoke `=== 5` 하드코딩 실패.

| 항목 | 내용 |
|---|---|
| 책임 계약 | REQ_SCRIPTS는 Stage-A 서명 5(frozen)로 유지 · Stage-B 명령 표면 SSOT=dispatch VERB_MODULES req:* · STAGE_B_REQ_SCRIPTS를 거기서 파생 · init/migrate/uninstall/smoke가 이 표면 사용 · smoke는 개수 아닌 verb별 script 검증 · reconstruct 기능 로직 무변경 |
| 입력 | phase-4/4b(dispatch 등록) |
| 산출물 | `bin/init.ts`(STAGE_B dispatch 파생) · `bin/migrate.ts`(add 신규 verb) · `bin/uninstall.ts`(Stage-A∪B 분류) · `scripts/smoke.mjs`(verb별 검증) · 테스트 |
| 선행 phase | phase-4b |
| 독립 검증 | `pnpm test` · `pnpm run typecheck` · `pnpm run docs:lint` · `pnpm run smoke` · `git diff --check main...HEAD` |

**Red 먼저**(사용자 필수 테스트):
| # | oracle |
|---|---|
| ㉚ | dispatch req:* 집합 === STAGE_B_REQ_SCRIPTS 키 집합 **정확 일치**(미래 verb 자동 검출) |
| ㉛ | fresh init이 req:reconstruct 주입(`commitgate req:reconstruct`) |
| ㉜ | 기존 사용자 정의 req:reconstruct는 init이 미덮어씀(보존) |
| ㉝ | Stage-A → Stage-B migrate가 reconstruct **add** |
| ㉞ | migrate 시 사용자 정의 reconstruct 보존(custom) |
| ㉟ | uninstall이 주입된 reconstruct(`commitgate ...`)는 제거 대상 분류·사용자 정의는 보존 |
| ㊱ | smoke가 tarball 설치에서 **모든** req:* verb의 script 검증(개수 아님) |
| ㊲ | 기존 Stage-A 탐지·호환 테스트 무회귀(REQ_SCRIPTS 서명 불변) |

## 검증 fixture 정책

`44_yammy_sales`는 **읽기전용**. 어떤 파일도 생성·수정·stage·commit·설치하지 않는다. git 동작은 `git init` 임시 저장소로 검증하고 실행 후 삭제.

## 숨은 결합 점검
- phase-1은 순수 — 이후 어느 phase도 요구하지 않는다.
- **phase-2는 phase-1 선행**. ✅ 완료.
- **phase-3a는 phase-1+phase-2 선행**. ✅ 완료.
- **phase-3a2는 phase-3a 선행**(dev-complete 발행·verifier가 있어야 design-bound로 보정). **phase-3b는 phase-3a2 선행**(design-bound 완전성이 있어야 intake gate가 정확히 판정). 이 순서 의존은 실재하므로 정직하게 선언한다.
- **phase-3b2는 phase-3b 선행**(intake·verifier에 phase archive 무결성을 얹는 보정).
- **phase-3b3는 phase-3b2 선행**(phase archive 무결성 위에 design archive 무결성을 대칭으로 얹는 보정).
- **phase-4는 phase-3b3 선행**(reconstruct가 verifyCommittedEvidenceIntegrity로 손상 티켓을 걸러야 하므로). reconstruct 외 기능은 안 섞는다(SuccessorOf.parent_series_id는 reconstruct가 소비할 verifiable 증거 완성이라 범위 내).
- 🔴 **이번 phase는 phase-4(reconstruct)만 구현·리뷰·커밋**한다.
- 🔴 **migration**: REQ-052 자신의 phase-1/2/3a 행은 `phase_design_ref` 부재(보정 전 커밋) → 이 티켓의 durable 완료는 **각 phase 재검토** 전까지 fail-closed(DEC-B5, 요구 #4 의도). reconstruct는 아카이브에 없는 결속값을 합성하지 않으므로 완료 경로가 아니다(r05-delta P1).

## 완료
- 게이트 해당분(unit·typecheck·lint) · 사용자 main 머지(별도 승인).
