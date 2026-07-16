# REQ-2026-017 설계 — 원자적 재검수-예약 / 상한 코어

> 정본 결정은 각 DEC-017-N. 본 문서는 현행 코드/구조에 어떻게 반영할지 기록한다.
> **plan-lint는 이 REQ에 없다**(별도 후속 REQ). 범위는 원자적 상한 코어뿐.

## §1. 문제 근거 (REQ-2026-016 잔여)

- **count 경계 모호(016 P2#2)**: "count 3 도달→외부 미호출"과 "비승인 outcome마다 +1(호출 후에만 발생)"이 충돌 — 호출 전에 막으면 3에 도달할 수도 없다.
- **동시성 우회(016 P2#3)**: `count`를 outcome **후** `writeState`로 기록하는 read→call→write 흐름은 원자적이지 않다. 같은 ticket/target에서 `--run`을 병렬로 시작하면 모두 count=0을 읽고 preflight 통과·외부 호출·각자 count=1 기록(마지막 쓰기가 덮음) → 상한 우회.

교정 축: **count를 outcome 후 기록이 아니라 외부 호출 前 "예약(pending)"으로 소비**하고, ticket lock으로 예약을 직렬화한다. 그러면 경계(§3)와 동시성(§4)이 동시에 닫힌다.

---

## §2. review series + count (016 승계) — DEC-017-1

state `review_series[target] = { series_no, count, last_needs_fix_snapshot }` (target = `"design"` | `"phase:<id>"`).
- count는 **미승인 series 예약 수**(§3에서 예약으로 증가). 문서 hash·amendment 이름·명령 인자 **무관**.
- 승인 시 `series_no++`, `count=0`, `snapshot=null`. 승인만 새 series를 연다(명시 재개 미구현).
- `last_review`(compare_hash 신선도)는 보존. 상한 판정은 `review_series.count`가 정본.

---

## §3. 원자적 예약 모델 (ticket lock + pending_review_attempt) — DEC-017-2

### 3.1 두 저장 경계: runtime lock vs versioned state (PM 확정 — 모순 해소)

**둘은 서로 다른 저장소다. 이전의 "pending이 worktree/staged에 안 나타난다"는 표현은 삭제한다** — `pending_review_attempt`는 versioned `state.json` 필드이므로 worktree에 있다.

- **runtime lock (worktree 밖, epoch 포함)**: `<git-common-dir>/commitgate/review-locks/<ticket-id>-<lock_epoch>.lock`. **working tree·staged tree·review prompt·design hash·clean-tree 검사에 절대 나타나지 않는다.** `<ticket>/.review.lock`은 사용하지 않음. common-dir 실패 → temp fallback 없이 **fail-closed**. `review-codex`·`req:doctor` 동일 경로 규칙 결정론 계산(common-dir는 worktree 공유). **각 실행은 자신이 획득한 epoch 경로만 unlock 대상으로 한다**(이후 recovery/다른 run이 만든 새 epoch lock을 삭제할 수 없음).
- **versioned operational state (state.json 필드)**: `review_series`·`pending_review_attempt`·`escalation`·`last_review`·`lock_epoch`는 `workflow/REQ-*/state.json`의 **운영 필드**다.
  - `pending_review_attempt = { target, series_no, run_id, lock_epoch, state_revision, base_binding, started_at } | null`. `run_id`=이 실행 고유 ID, `lock_epoch`=현재 lock 세대(recovery마다 +1), `state_revision`=예약 시점 state 판(fencing 토큰).
  - 이들은 worktree에 있는 **도구 소유 필드**이며, **도구가 소유하고 허용하는 명시적 state mutation**으로 정의한다(현행 review-codex가 state.json을 review scratch로 취급하는 정책과 동일 — 사후 무수정 검증에서 state.json은 이미 예외). "worktree에 안 나타남"이 아니라 **"허용된 운영 필드 mutation"**이 정확한 규정이다.
- **후보 설계 내용과 분리**: 후보 설계 hash·prompt·승인 binding은 **00/01/02 설계 문서 + 기존 binding 규칙**에서 계산한다. state.json 운영 필드(`review_series`·`pending_review_attempt`·`escalation`·`last_review`)는 **후보 설계 내용으로 취급하지 않는다** → 운영 필드가 바뀌어도 design_hash·prompt는 불변.

### 3.2 한 번의 `--run` 흐름 (외부 호출 경로) — clean-tree → lock → pending → 호출 → 확정 → unlock
0. **clean-tree 검사(기존 D10, lock·pending 前)**: 워킹트리가 staged+scratch(state.json 포함)뿐인지 **먼저** 확인(현행 그대로). 아니면 fail-closed.
1. **lock_epoch 읽기 + lock 획득 — 원자적 exclusive create**: 현재 state `lock_epoch`(부재=0)로 `…/<ticket-id>-<lock_epoch>.lock`을 `O_EXCL` create. lock 내용 = `{ ticket_id, target, series_no, run_id, lock_epoch, pid, started_at }`. 이미 존재하면 → **fail-closed**("리뷰 진행 중이거나 이전 호출이 비정상 종료됨 — human recovery"). **자동 대기·재시도·stale 판정 없음.**
2. **pending 검사(정본 = state.json)**: state.json `pending_review_attempt`가 이미 있으면 → **fail-closed**(lock 유무와 무관, §5).
3. **상한 preflight**: `count >= reReviewLimit`이면 외부 호출 없이 **escalation 재확인**(§4)·lock 해제·종료(예약 안 함, count 미증가).
4. **base_binding 캡처 + 예약(state.json 원자 write)**: `base_binding` 캡처 → `pending_review_attempt = {…, run_id, lock_epoch, state_revision:R}` 기록 + `count += 1` + `state_revision`을 R로 기록(fencing 토큰)을 **temp → flush/fsync → atomic rename**로. count는 여기서 한 번 소비.
5. **외부 Codex 호출**.
6. **확정 전 base_binding 재검(§3.4)**: 현재 후보 binding ≠ `base_binding`이면 fail-closed.
7. **완료 확정 — fencing CAS(run_id·lock_epoch·state_revision 일치할 때만)**: state를 다시 읽어 현재 `pending.run_id == 내 run_id` AND `pending.lock_epoch == 내 lock_epoch` AND `state_revision == R`이 **모두 일치할 때만** 확정(원자 rename)한다. **하나라도 불일치면 state를 쓰지 않고 fail-closed**(내가 recovery로 무효화된 지연 실행 = 남의 pending/count를 덮지 않음).
   - **승인** → `pending` 해제, series 전환(`series_no++`, `count=0`, `snapshot=null`), `state_revision`++.
   - **비승인** → `pending` 해제(예약 확정, count 재증가 없음), NEEDS_FIX면 snapshot 갱신, `count==limit`이면 즉시 escalation, `state_revision`++.
8. **lock 해제 — 자기 epoch 경로만·state 확정 뒤에만.** 내 `lock_epoch` 경로의 lock만 삭제(다른 epoch lock 불가침).

**실행 중 허용 변경 = state.json 운영 필드 + 명시 review scratch**: `--run` 중 도구가 변경하는 것은 (a) **state.json 운영 필드**(`review_series`·`pending_review_attempt`·`escalation`·`last_review`·`lock_epoch`), (b) **명시 review scratch** — **정확히**: `<ticket>/.review-preview.txt`, `<ticket>/codex-response.json`, `<ticket>/responses/` 아카이브(현행 `reviewScratchPaths`/`isAllowedResponsesScratch` 정책과 일치). 이 scratch는 **untracked/runtime 산출물**이며 **staged-tree·design hash·review prompt·승인 binding에 미포함**. 그 밖의 **source/design/staged 파일 변화는 fail-closed**(리뷰어 무수정 검증 = 현행 D10 사후 계약 유지). D10 사후 검증은 실행 전후를 비교해 **"운영 필드 + 명시 scratch"만 허용**한다.

**dry-run 순수성**: `--dry-run`은 **preview scratch 생성만** 허용하고 **state·count·pending·lock을 전혀 변경하지 않는다**.

**부분 실패 규칙(원자성)**:
- lock 획득 **전** 실패 → lock 없음.
- lock 후 **pending 기록 전** 실패 → **lock 해제**(예약 없음 = clean).
- pending 기록 **후** 중단 → state.json pending이 **정본**으로 남음 → 다음 실행 fail-closed(§5). 자동 stale/삭제/재시도 미구현.

> 핵심: count는 4단계(예약)에서 **한 번만** 증가, 7단계는 확정/해제만(재증가 없음) → 016 P2#1(정확히 1회)·P2#2(경계)·P2#3(동시성) 동시 해소.

### 3.4 base_binding ↔ 운영 state 분리 (PM 확정)
- `base_binding` = **lock 획득 뒤·pending 기록 전**의 후보 설계 binding — **00/01/02 설계 문서 + 기존 binding 규칙**에서 계산.
- state.json 운영 필드(`review_series`·`pending_review_attempt`·`escalation`·`last_review`)는 **후보 설계 내용이 아니다** → 운영 필드만 달라져도 후보 설계 binding·design_hash·prompt는 불변.
- 외부 응답 확정 전 후보 설계 binding이 `base_binding`과 불일치(= 00/01/02가 리뷰 중 바뀜)하면 **fail-closed**. 운영 필드 변경은 이 불일치를 유발하지 않는다.
- 이 규칙은 기존 **staged-tree/D9/D10/D13**을 약화하지 않는다(그 위에 예약-바인딩 정합만 추가).

### 3.3 count 경계 정본 (016 P2#2 종결)
- **3에 도달시키는 호출**: `count=2`에서 preflight 통과(2<3) → 예약 `count=3` → **외부 호출 발생** → 비승인 확정 → `count==3` → **그 실행에서 즉시 escalation**.
- **이미 count=3인 다음 호출**: preflight(3단계)에서 `count>=3` → **외부 호출 없이** escalation 재확인·종료(예약 없음).
- 즉 **예약은 `count < limit`일 때만** 허용(도달시키는 호출 포함), **`count == limit` 이후 호출은 preflight 차단**.

---

## §4. terminal escalation + snapshot (016 승계) — DEC-017-3

- `count == reReviewLimit` 확정 시 즉시 state `escalation = { target, series_no, count, open_findings, reason, at, resolved:false }`.
- **`open_findings` 정본** = 해당 series `last_needs_fix_snapshot.findings`. INVALID/BLOCKED가 이후 덮어도 재현. 유효 needs-fix 전무면 `open_findings:[]` + `reason`(마지막 비승인 사유, 생성 금지).
- **재확인(§3.2-3)**: 이미 escalation이 있으면 외부 호출 없이 동일 상태 재확인·exit 구분(`blocked` 계열 exit 2 + terminal 메시지).
- auto resume·재검수·예외 미구현.
- **escalation 단일 객체 유지(r01 observation 처리)**: 이 REQ에서 `escalation`은 **단일 객체**로 둔다 — ticket lock + terminal 정책상 **동시에 활성인 review target은 하나뿐**이고, 대상은 escalation 내부 `target` 필드로 식별된다. **복수 target escalation 보존은 후속 확장으로만 기록**(§9)하고 구현 범위에 넣지 않는다.

---

## §5. 비정상 상태 처리 (dangling lock/pending) + req:doctor — DEC-017-4

- **crash 정본 = state.json `pending_review_attempt`**: 확정 전 crash면 pending이 state.json에 남는다. **lock 파일이 없어도** 다음 실행은 **pending으로 fail-closed**. 반대로 **lock만 남고 pending 없는 경우도 fail-closed**. 둘 중 하나라도 dangling이면 진행 금지.
- **자동 복구 금지**: lock·pending 어느 쪽이 남아도 **자동 삭제·자동 stale 판정·자동 재시도하지 않는다.**
- **`req:doctor`**: epoch 포함 lock 경로(§3.1 규칙 동일 계산)와 state.json `pending_review_attempt`의 dangling을 **진단만** 하고 "human recovery 필요" 표기(신규 체크). 자동 정리 안 함.

### 5.1 안전한 human recovery + 지연된 실행 A 차단 (finding r01#1 마감, PM 지시)
지연된(죽지 않은) 이전 실행 A가 recovery 후 돌아와 새 실행 B를 오염시키는 경합을 **fencing**으로 막는다.
- **recovery 전제**: 사람이 **기존 실행 프로세스의 종료 또는 실행 배제를 확인한 뒤에만** recovery 허용(문서화된 절차). PID/외부 호출 상태 확인.
- **recovery 동작**: `lock_epoch += 1`, dangling lock/pending 제거, **이전 `run_id`·`count`·사유를 감사 기록으로 남긴다.** **count를 감소·초기화하지 않는다**(series 리셋 없음 — 상한 보존).
- **fencing 효과**: recovery로 `lock_epoch`가 증가하면,
  - 지연된 A의 **확정 CAS(§3.2-7)**는 `pending.lock_epoch`/`run_id`/`state_revision` 불일치로 **state를 못 쓴다**(A의 오래된 스냅샷이 B의 pending/count를 덮지 못함).
  - A의 **unlock(§3.2-8)**은 **자기 epoch 경로만** 대상이라 B가 새 epoch로 만든 lock을 삭제할 수 없다.
  - 따라서 recovery 후 A가 응답을 받아도 **결과 확정·state 덮어쓰기·B lock 해제 전부 불가** → 외부 호출 중복·상한 우회 없음.
- **자동 recovery·자동 lock 삭제·자동 재시도는 계속 금지.** `req:doctor`는 진단만.
- 이유: 외부 호출 후 확정 전 상태(crash 또는 지연)에서 그 호출 결과를 도구가 알 수 없다 — 안전 우선 fail-closed + fencing.

---

## §6. container 단위 legacy fail-closed (016 승계) — DEC-017-5

- `review_series` 부재 + `last_review` 전무 → 전 target fresh 초기화.
- `review_series` 부재 + `last_review` 하나라도 존재 → design/phase 구분 없이 전 target **fail-closed**(human escalation). "다른 target이니 fresh" 추론 금지. target별 migration/resume은 후속.

---

## §7. 변경 파일 (예정)

- `scripts/req/review-codex.ts` (lock 획득/해제·`pending_review_attempt` 예약/확정·count 경계·escalation·dangling fail-closed).
- `scripts/req/lib/ticket-lock.ts` (신규 — `…/<ticket-id>-<lock_epoch>.lock` 경로(epoch 포함) 결정론 계산·원자적 exclusive create·**자기 epoch 경로만 unlock**·common-dir 실패 fail-closed) + fencing CAS 헬퍼(run_id·lock_epoch·state_revision 일치 확인).
- `scripts/req/req-doctor.ts` (dangling lock/pending 진단·human recovery 표기).
- `scripts/req/req-next.ts` (count·상한 잔여·escalation·pending 상태 표기 — 최소).
- `workflow/req.config.schema.json` (`reviewLoop.reReviewLimit` optional), `req.config.json.sample`.
- `README.md`/`README.en.md`/`AGENTS.template.md`/`CHANGELOG.md`.
- **미변경**: `plan-lint`(이 REQ에 없음), `req-commit.ts`, `machine.schema.json`(reviewer contract 불변).

## §8. 하위호환·안전 불변식 (약화 금지)

- **현행 reviewer contract 불변**: finding 있으면 기존 보수적 차단 그대로.
- **상한 우회 불가**: count는 lock 하에 예약으로 소비 → hash·이름·재실행·**동시성**으로 우회 불가.
- **중단 안전**: dangling lock/pending은 fail-closed + human recovery(자동 복구 없음).
- **lock 격리(worktree 밖)**: lock은 `<git-common-dir>/commitgate/review-locks/` 하위 → **clean-tree/staged-tree/review prompt/design hash에 안 나타남.** common-dir 없으면 temp fallback 없이 fail-closed.
- **state는 versioned, 도구 소유 운영 mutation**: `state.json` 운영 필드(`review_series`·`pending_review_attempt`·`escalation`·`last_review`)는 worktree에 있으나 **도구가 소유·허용하는 명시적 mutation**(현행 state.json = review scratch 예외와 동일). 후보 설계 binding에 영향 없음.
- **legacy 보수**: 이력 있으면 전 target fail-closed.
- 기존 승인 바인딩(staged-tree·`approved_diff_hash`·D9/D10/D13)·리뷰어 무수정 유지 — 예약·확정 흐름이 이를 **우회·무시하지 않고** 그 위에 `base_binding` 정합만 추가. **plan-lint 없음** → 검수 표면 최소, 016 P1(하위호환) 재현 안 함.

## §9. 명시적 제외 범위 (후속 REQ)

**plan-lint 전체**(req:new 템플릿 meta·기존 티켓 opt-in/migration·활성화 시점·L2+확장) · P2 비차단 · reviewer persona/machine schema v2 · findings ledger · phase-start/commit gate · region/amendment · legacy evidence inventory/adapter · Stage B · auto resume/retry/lock 해제 · **복수 target escalation 보존**(이 REQ는 단일 객체, §4). 근거: REQ-2026-016 2/2 terminal escalation(P1 plan-lint 하위호환 + P2 경계/원자성).

## §10. 테스트 계획

- **count-not-reset (최우선)**: 리뷰 사이 문서 수정 → 같은 series count 승계(hash 무관).
- **경계 정본(P2#2)**: count=2→예약3→외부 호출 발생→비승인→즉시 escalation / 이미 count=3→외부 미호출·escalation 재확인·count 미증가.
- **원자성/동시성(P2#3)**: 병렬 `--run` — 둘째는 lock 획득 실패로 fail-closed(외부 호출 1회만·count 정확히 1회 증가) / read-modify-write 경합에서 상한 우회 없음.
- **중단 안전(부분 실패 각 지점)**: lock 획득 직후 중단 / pending 기록 직후 중단 / 외부 호출 후 확정 전 중단 → **각각 다음 호출 fail-closed** / lock 획득 **전** 실패는 lock 남기지 않음 / lock 후 pending 전 실패는 lock 해제 / req:doctor dangling 진단·자동 정리 안 함.
- **lock 격리·경로 결정론**: lock 파일이 **worktree clean/staged-tree/review prompt에 안 나타남** / 같은 repo의 **복수 worktree에서 동일 ticket → 동일 lock 경로 계산**(common-dir 공유) / common-dir 실패 → fail-closed(temp fallback 없음).
- **base_binding 재검(§3.4)**: 리뷰 중 후보 binding이 `base_binding`과 달라지면 **응답 확정 fail-closed** / **state 운영 필드만 달라져도 후보 설계 binding은 불변** / **00/01/02 변경은 base_binding 불일치로 fail-closed**.
- **dry-run 순수성**: `--dry-run`이 **preview 외 state.json·count·pending·lock을 전혀 변경하지 않음**.
- **scratch 허용 집합 + D10 사후**: 기존 review scratch(`.review-preview.txt`·`codex-response.json`·`responses/`) 허용 통과 / 미등록 scratch·source/design/staged 변경 각각 **D10 사후 fail-closed** / 기존 **D9/D10/D13 예약·확정 흐름에서도 유지**.
- **fencing/CAS(r01#1)**: A 예약 → human recovery(`lock_epoch`++·count 보존) → B 예약 → **지연된 A의 확정/pending 해제/B lock 해제 시도 모두 fail-closed, B state/lock 불변** / run_id·lock_epoch·state_revision 중 하나라도 불일치면 확정 불가 / **recovery가 count 감소·series 초기화 안 함**.
- **crash 정본(state.json pending)**: pending 남은 crash → **lock 유무 무관 fail-closed** / **lock만 남고 pending 없어도** fail-closed.
- **예약 1회**: 승인/비승인 확정이 count를 재증가시키지 않음(7단계).
- **legacy container**: 이력 전무=fresh / design 이력만 있어도 첫 phase fail-closed.
- **escalation snapshot**: needs-fix→invalid/blocked→count3 finding 보존 / 무 needs-fix=[]+사유.
- **plan-lint 부재**: 이 REQ 코드·문서에 plan-lint 없음(회귀로 명시).
- **회귀(기존 흐름)**: 현행 design/phase 승인·거부·D9/D10/D13·증거 무수정 그대로.
