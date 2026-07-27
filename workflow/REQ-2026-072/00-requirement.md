# REQ-2026-072 요구사항 — 종결 술어 일치·재결속 재진입

## 배경

소비자 프로젝트(lean_lms, commitgate `0.9.9`)에서 버그리포트가 접수됐다. 티켓 REQ-2026-088이
**완료·병합됐는데도 영구히 `developing`으로 판정**되어 `req:new`가 차단되고, 지원되는 복구 명령
3개(`req:close --migrate`·`req:commit --finalize`·`req:reconstruct`)가 **전부 거부**해 감사 로그를
손으로 고치는 것 말고는 탈출구가 없었다.

발생 조건은 흔하다: **phase를 다 끝낸 뒤 통합 검증에서 결함이 나와 phase를 하나 더 붙이면서
`02-plan.md`를 고쳐 설계가 재승인된 경우.** 앞선 phase는 옛 `design_ref`에 묶인 채 남고, 이미 발행된
`dev-complete` 행은 그 옛 `design_ref`를 담은 채 낡는다.

## 조사로 확정된 사실

| # | 사실 | 근거 |
|---|---|---|
| F1 | `deriveBaseState`는 **현재 `design_ref`에 맞는 dev-complete 행**만 골라 재검증한다 | `lib/close-proof.ts:283-291` |
| F2 | `planMigrationClose`는 **dev-complete 행의 존재**만 보고 성공 no-op을 낸다 | `lib/close-migrate.ts:85-88` |
| F3 | F1·F2가 **같은 개념에 다른 술어**를 써서 "미종결"과 "이미 종결"이 서로를 막는다 | 위 두 곳 |
| F4 | 재발행이 안 되는 이유는 자연키 멱등이 **아니다** — 자연키엔 이미 `design_ref`가 있다 | `close-proof.ts:103-109` |
| F5 | 진짜 이유는 `computeDevCompleteProof`가 design-bound 완전성(DEC-B5) 실패로 null을 낸 것 | `req-commit.ts:418-421` |
| F6 | 근본 원인은 REQ-2026-069 `req:rebind`가 이미 해결했다(사람 확인형 재결속) — 다만 **미배포**(`v0.10.0`에 없음) | `req-rebind.ts` · `git merge-base --is-ancestor 2ef6627 v0.10.0` → false |
| F7 | 그 `req:rebind`는 **재진입이 불가능**하다: rebind 행 커밋 뒤 dev-complete 발행이 실패하면, 재실행이 "이미 재결속됨"으로 **완료 재판정 전에** throw | `req-rebind.ts:92-93`·`112-113`·`159-194` |
| F8 | `req:new` 차단 메시지는 이 상태에서 **실패하는 명령만** 안내한다 | `req-new.ts:85-89` |

## 요구

1. **R1 — 술어 일치.** "이미 종결"을 판정하는 술어는 저장소에 **하나만** 존재한다. `deriveBaseState`와
   `planMigrationClose`가 같은 함수를 쓴다. 낡은 dev-complete 행은 "종결"로 읽히지 않는다.
2. **R2 — 막다른 길 제거.** 낡은 dev-complete로 갇힌 티켓은 **적용 가능한 복구 경로를 안내받는다.**
   재결속으로 정상 종결이 가능하면 마이그레이션은 **거부하고 `req:rebind`를 가리킨다** — 거짓 no-op이
   아니라. 재결속이 불가능한 진짜 레거시만 마이그레이션으로 진행한다.
3. **R3 — 재결속 재진입.** `req:rebind`가 중단됐다 재실행돼도 완료 판정에 도달한다. "이미 재결속됨"은
   실패가 아니라 no-op이며, 그 뒤의 완료 재판정을 막지 않는다.
4. **R4 — 안내 정확성.** `req:new` 차단 메시지는 파생 상태에 **실제로 적용 가능한** 명령을 제시한다.

## 수용 기준

- **A1** `deriveBaseState`가 `dev-complete`로 보지 않는 close proof를 `req:close --migrate`가 "이미 종결"로
  no-op 하지 않는다.
- **A2** 낡은 dev-complete + 재결속 가능한 phase → `--migrate`가 **거부하고 `req:rebind`를 안내**한다.
- **A3** 낡은 dev-complete + `phase_design_ref` 없는 레거시 phase → `--migrate`가 **정상 stamp**한다
  (지금 완전 교착인 상태가 열린다).
- **A4** `req:rebind`를 마지막 phase 재결속 직후 강제 중단한 뒤 재실행하면 **티켓이 종결된다**.
- **A5** `req:new` 차단 출력이 낡은 dev-complete 상태를 식별하고 `req:rebind` 명령줄을 제시한다.
- **A6** 기존 계약 무회귀: REQ-2026-052/053의 dev-complete·마이그레이션 e2e, REQ-2026-069 재결속 e2e.

## 범위 밖

- **자연키 변경**(리포트 제안 B) — F4로 기각. 재발행을 막는 것은 키가 아니다.
- **설계 재승인 시 자동 재결속**(리포트 제안 C 원안) — DEC-B5를 파기하고, "이 설계 변경이 그 phase의
  검수를 무효화하는가"라는 사람의 판단을 도구가 대신하게 된다. REQ-2026-069의 결정을 뒤집지 않는다.
- 배포(0.11.0 릴리스)는 이 REQ의 산출이 아니라 **후속 통제점**이다.
