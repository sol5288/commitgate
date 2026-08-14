# REQ-2026-152 요구

REQ-2026-151 통합 직후 외부 리뷰가 확인한 결함 3건을 고친다. **셋 다 실측으로 재현·확인했다.**

## 결함 1 (P1) — 종결 티켓 안내가 untracked 파일이 있으면 스스로 `req:new` 를 막는다

`req-commit.ts` 의 `terminalReentryProblem` 은 `git stash push -m "…"` 를 안내한다. 이는 untracked
파일을 보관하지 않는다. 그런데 `req:new` 는 **기존 티켓 직계의 도구 산출물만** 예외로 두고 그 밖의
untracked 를 clean-tree 위반으로 거부한다(`req-new.ts` `findReqNewDirtyEntries`).

재현: 종결 티켓에서 코드를 stage 하고 루트에 `notes.txt` 를 둔 뒤 `req:commit --run` → 차단·안내 →
안내대로 `git stash push` → `req:new <id>-followup --run` 이 `?? notes.txt` 로 거부.

🔴 **이 REQ 가 고치려던 결함 부류("안내받은 명령이 그 상황에서 실행 불가")를 그대로 재생산했다.**
REQ-2026-151 설계는 "`-u` 를 쓰지 않는다 — untracked 는 브랜치 전환을 따라온다"고 적었는데, 그것은
**유실 방지**만 본 판단이고 `req:new` 가 untracked 자체를 거부한다는 사실을 보지 못했다.
`tests/unit/terminal-reentry.test.ts` 의 "`-u` 를 쓰지 않는다" 회귀 테스트가 **틀린 동작을 고정**하고 있다.

## 결함 2 (P2) — `consumed_state_sha256` 형식 불량이 "키 없음"으로 강등돼 결속을 우회한다

새 키는 `MANIFEST_KEYS` 허용 목록에만 등록됐고 형식 검사가 없다. 복구 판정은 "문자열이고 빈 값이
아닐 때"만 결속으로 인정하므로, `{"consumed_state_sha256": null}` 인 행은 `consumedStateShaFor()` 가
`null` 을 돌려주고 **판별자 D 를 통째로 건너뛴다**.

정상 코드가 만드는 행은 아니라 P1 은 아니지만, **"키가 있으면 정확히 결속한다"는 계약에 위배**된다.
그리고 하위호환과 충돌하지 않는다 — **키의 부재만** 레거시이고, 키가 있는데 64hex 가 아니면 잘못된
증거다. 같은 저장소의 `phase_design_ref`(REQ-2026-052 DEC-B5)가 이미 그 형태다.

## 결함 3 (P2) — `consumedAtOfRow` 는 도달 가능한데 그 경로의 e2e 오라클이 없다

evidence-finalize 커밋 뒤·`writeState` 전에 중단되면 승인 핀(`approval_evidence`)이 **아직 살아 있어**
checkpoint 분기(`if (!ev)`)를 지나지 않고 `resumeFrom: 'consume'` 으로 간다. 그 경로가
`finalizeEvidenceAndConsume` 을 부르고 `already=true` 분기에서 `consumedAtOfRow` 를 쓴다.

🔴 **REQ-2026-151 의 판단("도달 불가일 수 있다")이 틀렸다.** 삭제 대상이 아니라 **오라클이 없는
살아 있는 코드**다. 지금은 소스 문자열 가드만 있어 `new Date()` 변이가 red 가 되지 않는다.

되돌아오는 손해: 첫 복구가 결속과 다른 state 를 커밋하고, 그 뒤 checkpoint 직전에 다시 중단되면
다음 복구가 `state-mismatch` 로 **영구 차단**된다.

## 범위 밖

- D10 예외 폭 · hardCap · HIGH 확인 · SHA/범위 불일치 — 완화하지 않는다.
- 완료 티켓 reopen 전이 — 여전히 만들지 않는다.
