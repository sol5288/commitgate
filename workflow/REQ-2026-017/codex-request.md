# REQ-2026-017 설계 리뷰 요청 (--kind design)

## 배경
REQ-2026-016(재검수 안전 코어)가 라이브 2/2 소진·terminal escalation 후, PM이 재분할(B)했다. 이 REQ = **A 트랙 = 원자적 상한 코어**만. plan-lint는 별도 후속 REQ(B)로 완전 분리한다(016 P1 하위호환은 그 REQ 소관).

## 변경 요약 (설계 범위 — 아직 구현 없음, 문서 검수)
- **원자적 예약(§3, DEC-017-2)**: 외부 Codex 호출 前 ticket lock 획득 + `pending_review_attempt`를 state에 원자적 기록(= count 예약). 승인=해제·series 전환, 비승인=예약 확정(count 재증가 없음). 016 P2#2(경계)·P2#3(동시성)을 예약 모델로 동시 해소.
- **count 경계 정본(§3.3)**: count<limit면 예약(도달시키는 호출 발생·즉시 escalation), count==limit이면 preflight 차단·외부 미호출.
- **중단 안전(§5, DEC-017-4)**: dangling lock/pending은 자동 재시도·자동 정리 없이 fail-closed, req:doctor 진단·human recovery 표기.
- **legacy container(§6)·escalation snapshot(§4)**: 016 승계.

**명시 제외(§9)**: plan-lint 전체, P2 비차단, reviewer schema v2, ledger, phase-start/commit gate, region/amendment, legacy evidence adapter, Stage B, auto resume/retry.

## PM lock·binding·state 경계 확정 (재검증 요청)
- **두 저장소 분리(§3.1, 모순 해소)**: **runtime lock**만 worktree 밖(`<git-common-dir>/commitgate/review-locks/<ticket-id>.lock`, common-dir 실패=fail-closed). **`pending_review_attempt`·`review_series`·`escalation`·`last_review`는 versioned `state.json` 운영 필드**(worktree에 있음) — "worktree에 안 나타남"이 아니라 **도구 소유·허용 운영 mutation**(현행 state.json=review scratch 예외와 동일).
- **순서(§3.2)**: **clean-tree(D10) → lock → pending 검사 → base_binding+예약(state.json 원자 write) → 외부 호출 → base_binding 재검 → 확정(원자 rename) → unlock(확정 뒤에만)**. `--run` 중 허용 변경 = state.json 운영 필드뿐, 그 외 파일/비운영 필드 변경 fail-closed. **dry-run은 lock·state 전혀 안 바꿈**.
- **binding 분리(§3.4)**: 후보 설계 binding은 00/01/02+기존 규칙에서 계산 — state.json 운영 필드는 후보 설계 내용 아님(운영 필드 변경해도 design_hash 불변). 확정 전 후보≠base_binding이면 fail-closed. **staged-tree/D9/D10/D13 우회·무시 없음**.
- **crash 정본(§5)**: state.json `pending_review_attempt`가 정본 — lock 없어도 pending 남으면 fail-closed / lock만 남고 pending 없어도 fail-closed. 자동 정리·재시도 없음, req:doctor 진단만.

## r01 finding 마감 (재검증 요청)
- **r01#1 fencing/CAS(§3.1·§3.2-7·§5.1)**: pending에 `run_id`·`lock_epoch`·`state_revision`, lock 경로에 epoch 포함. 확정·해제·escalation은 이 셋이 자기 것과 일치할 때만(CAS), 불일치=state 미기록 fail-closed. unlock은 자기 epoch만. human recovery는 프로세스 배제 확인 후·`lock_epoch`++·count 보존·감사 기록. **지연된 A가 recovery 후 돌아와도 B의 pending/count/lock을 못 덮는가?** atomic rename만으론 부족한 조건부 갱신을 CAS로 막았는가?
- **r01#2 scratch 허용 집합(§3.2)**: `--run` 허용 변경 = 운영 필드 + **명시 review scratch**(`.review-preview.txt`·`codex-response.json`·`responses/`, 현행 `reviewScratchPaths`/`isAllowedResponsesScratch` 일치). D10 사후가 이 집합만 허용·그 외 source/design/staged fail-closed. dry-run은 preview만. 정상 리뷰가 실패하지 않고 규칙과 구현이 일치하는가?
- **observation 처리(§4)**: escalation은 이 REQ에서 단일 객체 유지(동시 활성 target 하나·내부 target 필드로 식별), 복수 target은 §9 후속.

## 리뷰 포인트 (집중 검토 요청)
1. **원자성(§3)**: 외부 호출 前 lock+pending 원자 기록이 동시 `--run`의 상한 우회(각자 count=0 읽고 이중 호출)를 실제로 막는가? lock 획득 실패 시 fail-closed가 맞고, 자동 대기·재시도가 없는가? lock 경로가 clean-tree 정책과 격리됐는가?
2. **count 경계(§3.3)**: "3에 도달시키는 호출은 발생·즉시 escalation" vs "이미 3이면 preflight 차단"이 예약 모델에서 모순 없이 성립하는가? 예약이 정확히 한 번만 count를 소비하고 확정이 재증가하지 않는가?
3. **중단 안전(§5)**: 외부 호출 후 완료 기록 전 crash로 pending이 남으면, 다음 호출이 자동 재시도 없이 fail-closed 하고 doctor가 진단만 하는 설계가 안전한가? 자동 복구가 상한 우회·중복 호출을 낳지 않도록 막았는가?
4. **legacy container(§6)**: `last_review` 있으면 전 target fail-closed(보수)가 유지되는가?
5. **범위 절제**: plan-lint가 이 REQ에 **전혀 없고**, reviewer contract·machine.schema·req-commit 미변경인가? 016처럼 표면이 다시 넓어지지 않았는가?
6. 누락된 위험(예: lock 구현의 이식성 — Windows/NFS, lock 파일 경로가 review clean-tree/scratch 정책과 충돌하지 않는지), phase 순서 의존성.
