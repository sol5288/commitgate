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
| 책임 계약 | 원장 opened가 외부 호출 **전** 커밋된다(captureGitBinding 전) · pre-call 커밋 pathspec·fail-closed · human-resolution/replace가 원장+terminal proof를 함께 커밋 |
| 입력 | phase-1 |
| 산출물 | `review-codex.ts`(흐름 재구성) · `req-new.ts`(successor-of terminal proof) · `scratch.ts`(원장 커밋 경로 허용) · 테스트 |
| 선행 phase | phase-1 |
| 독립 검증 | `npx vitest run tests/unit/req-review-codex.test.ts tests/unit/req-new.test.ts` · `npm run typecheck` |

**Red 먼저**(요구 #1·#2·#3): ⑨ 외부 호출 **전** HEAD에 opened committed(near-e2e — 호출 시점에 이미 durable) ⑩ 호출이 throw해도 opened가 HEAD에 남는다(process 종료 모사) ⑪ pre-call 커밋이 design/phase staged 항목을 인덱스에 보존(afterTree===reviewTree 무회귀) ⑫ replace 종결이 원장+`series-terminal` proof를 커밋 ⑬ pre-call 커밋 실패 → fail-closed(호출 안 함) ⑭ legacy 티켓은 pre-call 커밋 없음(기존 동작).

**핵심 재구성 주의**: recordAttempt+opened 커밋을 `captureGitBinding` 앞으로 옮기되, 예산·terminal·예외 게이트의 순서·의미를 보존한다(R9 base state 계보 유지).

## Phase 3 — dev-complete proof + req:new 게이트 (`phase-3-devcomplete-and-intake-gate`)

| 항목 | 내용 |
|---|---|
| 책임 계약 | req:next가 마지막 phase 증거 완비 시 `dev-complete` proof 커밋(멱등) · req:new가 committed proof 스캔해 미종결 durable 티켓이면 fail-closed |
| 입력 | phase-1 · phase-2 |
| 산출물 | `req-next.ts` · `req-new.ts` · 테스트 · `docs/guarantees.{md,en.md}` |
| 선행 phase | **phase-1 + phase-2**(near-e2e ⑱이 phase-2의 durable 원장을 입력으로 씀) |
| 독립 검증 | `npx vitest run tests/unit/req-next.test.ts tests/unit/req-new.test.ts` · `npm run typecheck` |

**Red 먼저**(요구 #4·#5·#6·#7·#9): ⑮ 정상 흐름 무회귀(design 승인·phase 승인·DONE) ⑯ 마지막 phase 후 `dev-complete` proof가 HEAD에 커밋 ⑰ evidence commit 실패 재시도에 중복 proof 없음 ⑱ scratch state 삭제 후 main에서 req:new → 미종결 durable 감지·fail-closed(실 git) ⑲ legacy 티켓은 req:new 차단 안 함(표시만) ⑳ 기본 상태별 req:new: `developing`·`needs-recovery` 차단 / `dev-complete`·`series-terminal` 허용(순수 판정) · 오버레이(`reconstructed`·`integrated`)는 게이트 무관 · `integrated`는 git-ancestry로 관측(미병합=dev-complete, 병합후=integrated).

## Phase 4 — 재구성 명령 (`phase-4-reconstruct-command`)

| 항목 | 내용 |
|---|---|
| 책임 계약 | `req:reconstruct`가 immutable archive+approvals로 검증가능 사실만 복원·`reconstructed:true`·추정 금지·사람 확인 |
| 입력 | phase-1 |
| 산출물 | `bin/reconstruct.ts` · `bin/dispatch.mjs` 등록 · 테스트 |
| 선행 phase | phase-1 (phase-2/3과 독립) |
| 독립 검증 | `npx vitest run tests/unit/reconstruct.test.ts` · `npm run typecheck` |

**Red 먼저**(요구 #8): ㉑ 아카이브/매니페스트에서 유도한 행에 reconstructed:true+evidence_basis ㉒ 복원 불가 사실은 unknown(추정 안 함) ㉓ dry-run 기본·`--run`+확인 없이 미실행 ㉔ reconstructed 티켓이 원본과 구별된다(파생 상태=`reconstructed`).

## 검증 fixture 정책

`44_yammy_sales`는 **읽기전용**. 어떤 파일도 생성·수정·stage·commit·설치하지 않는다. git 동작은 `git init` 임시 저장소로 검증하고 실행 후 삭제.

## 숨은 결합 점검
- phase-1은 순수 — phase-2/3/4 어느 것도 요구하지 않는다.
- **phase-3은 phase-2를 선행으로 요구한다**(design-r01 P1): 순수 상태-파생·게이트 판정은 phase-1만으로 가능하지만, near-e2e ⑯·⑱이 phase-2가 실제로 만든 durable 원장을 입력으로 쓴다. 독립성을 위장하지 않고 phase-2를 선행으로 선언한다.
- phase-4는 phase-1만 선행. phase-2/3과 독립.

## 완료
- 게이트 해당분(unit·typecheck·lint) · 사용자 main 머지(별도 승인).
