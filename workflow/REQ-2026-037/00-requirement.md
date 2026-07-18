# REQ-2026-037 요구사항

LOW phase 자동 커밋 opt-in — 매 phase 정지 제거, 병합 전 단일 확인

## 무엇을

`req:next`가 Codex 승인 phase마다 `AWAIT_HUMAN`으로 멈추는 것을, **opt-in 설정 하에서 LOW 리스크 티켓의
phase는 자동으로 커밋**하도록 바꾼다. 사람 확인은 **feature→main 병합 직전 한 번**으로 모은다.
HIGH 리스크는 지금처럼 매 phase 확인을 유지한다.

## 왜

- 지금 `req:next`는 `commit_allowed===true`면 **risk와 무관하게 무조건** `AWAIT_HUMAN`을 낸다
  ([req-next.ts:480-487](../../scripts/req/req-next.ts)). 그래서 phase가 5개면 사람이 5번 멈춰 `req:commit --run`을
  승인해야 한다.
- 그런데 계약([AGENTS.template.md](../../AGENTS.template.md) §4)은 **HIGH일 때만** 사람 확인을 요구한다. 즉 도구가
  자기 계약보다 엄격하다. LOW를 자동화하면 도구가 계약에 정렬된다.
- **CommitGate의 실제 보장은 "Codex 리뷰 승인 없이는 커밋 불가"이지 "사람 승인 없이는 커밋 불가"가 아니다.**
  Codex 리뷰 게이트(`commit_allowed`는 STEP_COMPLETE·findings=[]에서만 참)와 커밋시점 doctor 재검증
  (D6/D9/D16)은 **무변경**이므로 fail-closed 보장은 그대로다. 제거되는 것은 LOW phase의 *사람 정지*뿐이다.

## 제약

- **기존 사용자 무회귀(opt-in)**: 설정 부재 또는 `never`면 **현행 동작과 100% 동일**(매 phase 정지). 배포된
  안전도구가 업그레이드만으로 더 관대해지지 않는다.
- **HIGH 백스톱 무변경**: `req:commit`의 HIGH 게이트(`userConfirmGate`, [req-commit.ts:239-247](../../scripts/req/req-commit.ts))는
  손대지 않는다. HIGH는 어느 정책에서도 `user_commit_confirmed` 없이 커밋되지 않는다.
- **정합성 게이트 무변경**: terminal series·리뷰예산 escalation(G3)·legacy 채택·BLOCKED 우선순위는 전부 보존.
- **설정 SSOT 정합**: `lib/config.ts`의 인라인 `CONFIG_SCHEMA`와 설치용 [req.config.schema.json](../../workflow/req.config.schema.json)은
  byte-정합(드리프트 가드 [req-config.test.ts](../../tests/unit/req-config.test.ts)).
- **비목표(이 REQ 아님)**: ① HIGH 자동 커밋·정책 `"all"`(HIGH+Gate B livelock·타임스탬프 위조 유인 →
  REQ-2026-019 실패 재발 → 폐기) ② phase별 리스크 상향 신호(LOW 티켓의 고위험 phase 감지) — 별도 후속 REQ
  ③ push/merge 물리적 차단(CommitGate는 협조 게이트) ④ `user_commit_confirmed` 실시계 손기록 도구.

## 완료 기준 (R)

- **R1** — 설정 `phaseCommit.autoApprove: "never" | "low-only"` 신설. 기본값 `never`. 부재 시 `never`로 해소.
  잘못된 값은 loadConfig가 fail-closed throw(enum).
- **R2** — `commit_allowed===true`일 때:
  - `risk_level==='LOW'`(정확 일치) **AND** 정책 `low-only` **AND** staged 변경 존재 → `RUN` **실행 가능한**
    `req:commit --run -m "<메시지>"` (자동 커밋).
  - 그 외(정책 `never`, `risk_level`이 `LOW`가 아님·누락·불명, staged 없음) → `AWAIT_HUMAN`(현행).
    **fail-closed: "HIGH가 아님"이 "자동 커밋 안전"을 의미하지 않는다 — `LOW` 정확 일치만 자동.**
- **R3** — HIGH(`risk_level==='HIGH'`)는 정책과 무관하게 커밋 통제점에서 `AWAIT_HUMAN` 유지. `req:commit`의
  Gate B(HIGH 백스톱) 무변경.
- **R4** — 복구 가드: `commit_allowed===true`인데 staged가 비었으면(부분 커밋/finalize 대기) 자동 커밋 RUN을
  내지 않고 `AWAIT_HUMAN`으로 `req:commit --finalize --run` 복구를 안내한다. 자동 루프가
  `'staged 변경 없음'`으로 무한 재시도하지 않는다.
- **R5** — 병합 단일 게이트: 정책 `low-only`에서 모든 phase가 소비되면, 종단을 조용한 `DONE`이 아니라
  `AWAIT_HUMAN`("feature→main 통합 통제점")으로 표출한다. 정책 `never`는 `DONE` 유지(무회귀).
- **R6** — 문서·SSOT 정렬: AGENTS.template §4, README(ko/en) 루프·통제점·config표, SSOT
  [07 상태기계 C](../../docs/ssot-design/07-business-rules-and-state-machines.md) S1 노드·
  [04 통제점표](../../docs/ssot-design/04-user-roles-and-permissions.md), CHANGELOG Unreleased.
- **R7** — dogfood: 이 저장소 [req.config.json](../../req.config.json)에 `phaseCommit.autoApprove: "low-only"` 설정.
  (이 티켓은 HIGH라 자기 자신은 자동 커밋되지 않는다 — 무회귀.)
- **R8** — 무회귀 증명: `never`(및 미설정) + LOW + `commit_allowed` → 현행과 동일한 `AWAIT_HUMAN`
  (controlPoint `req:commit --run 직전`·approvalSentence `req:commit --run 승인`). BLOCKED 우선순위·정합성
  게이트 테스트 유지.
