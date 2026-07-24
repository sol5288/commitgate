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

## Phase 3b — req:new intake gate (`phase-3b-intake-gate`)

| 항목 | 내용 |
|---|---|
| 책임 계약 | req:new가 HEAD-committed proof/evidence만으로 티켓 스캔·기본 상태 파생 · `developing`/`needs-recovery`면 fail-closed(이유+복구) · legacy 표시만 · runtime state 미사용 |
| 입력 | phase-3a(self-verifying dev-complete) |
| 산출물 | `scripts/req/req-new.ts`(intake scan·게이트) · 테스트 · `docs/guarantees.{md,en.md}` |
| 선행 phase | phase-3a |
| 독립 검증 | `npx vitest run tests/unit/req-new.test.ts` · `npm run typecheck` · 임시 git 저장소 |

**Red 먼저**(요구 #4·#6·#7·#9):
| # | oracle |
|---|---|
| ㊴ | 정상 흐름 무회귀(dev-complete 티켓 있으면 req:new 허용) |
| ㊵ | scratch state 삭제 후 main에서 req:new → 미종결 durable(developing/needs-recovery) 감지·fail-closed(실 git·HEAD proof만) |
| ㊶ | legacy 티켓은 req:new 차단 안 함(표시만) |
| ㊷ | 기본 상태별 req:new: `developing`·`needs-recovery` 차단 / `dev-complete`·`series-terminal` 허용 |
| ㊸ | AWAIT_HUMAN·통합 대기·DONE 각각 HEAD proof만으로 허용/차단 판정 |

## Phase 4 — 재구성 명령 (`phase-4-reconstruct-command`)

| 항목 | 내용 |
|---|---|
| 책임 계약 | `req:reconstruct`가 immutable archive+approvals로 검증가능 사실만 복원·`reconstructed:true`·추정 금지·사람 확인 |
| 입력 | phase-1 |
| 산출물 | `bin/reconstruct.ts` · `bin/dispatch.mjs` 등록 · 테스트 |
| 선행 phase | phase-1 · **phase-3b 완료 후 별도 진행**(사용자 지시) |
| 독립 검증 | `npx vitest run tests/unit/reconstruct.test.ts` · `npm run typecheck` |

**Red 먼저**(요구 #8): ㉑ 아카이브/매니페스트에서 유도한 행에 reconstructed:true+evidence_basis ㉒ 복원 불가 사실은 unknown(추정 안 함) ㉓ dry-run 기본·`--run`+확인 없이 미실행 ㉔ reconstructed 티켓이 원본과 구별된다(파생 상태=`reconstructed`).

## 검증 fixture 정책

`44_yammy_sales`는 **읽기전용**. 어떤 파일도 생성·수정·stage·commit·설치하지 않는다. git 동작은 `git init` 임시 저장소로 검증하고 실행 후 삭제.

## 숨은 결합 점검
- phase-1은 순수 — 이후 어느 phase도 요구하지 않는다.
- **phase-2는 phase-1 선행**. ✅ 완료.
- **phase-3a는 phase-1+phase-2 선행**(발행이 durable ledger·evidence 경로 위에 얹힌다). **phase-3b는 phase-3a 선행**(self-verifying dev-complete proof가 있어야 intake gate가 판정 가능). 이 순서 의존은 실재하므로 정직하게 선언한다.
- phase-4는 phase-1 선행이나, **사용자 지시로 phase-3b 완료 후 별도 진행**.
- 🔴 **이번 delta는 phase-3a만 구현·리뷰·커밋**한다. phase-3b·phase-4는 phase-3a 완료 보고 후.

## 완료
- 게이트 해당분(unit·typecheck·lint) · 사용자 main 머지(별도 승인).
