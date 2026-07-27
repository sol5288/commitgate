# REQ-2026-072 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

> 🔴 **분해 원칙(r02 P1)**: 판정을 바꾸는 순수 모듈과 그 판정에 사실을 공급하는 배선은 **같은 phase**에
> 있다. 나누면 그 사이 커밋에서 판정기가 거짓 사실(빈 배열)로 돌아 `--migrate`가 사람 확인을 요구해야 할
> 티켓을 stamp한다 — 매 커밋이 그 자체로 올바라야 한다는 계약을 깬다.

## Phase 1 — 종결 술어 SSOT + 마이그레이션 분기 (`phase-1-terminal-parity`)

범위(순수 판정 + 그 판정에 필요한 배선까지 **한 커밋**):
- `lib/close-proof.ts`: `verifiedTerminalEvent()` 신설(DEC-1). `deriveBaseState`가 위임 — **판정 불변**.
- `lib/close-migrate.ts`: noop 술어를 `verifiedTerminalEvent`로 교체. `MigrationFacts.rebindablePhaseIds`
  추가 + "전부 rebindable이면 refuse+안내 / 일부라도 불가면 기존 흐름"(DEC-2).
- `lib/evidence.ts`: 미결속 phase를 **rebindable / legacy-unrebindable**로 나누는 helper
  (`req-close.ts`와 `scanTicketIntake`가 공용 — phase 3이 이것을 재사용한다).
- `lib/close-proof.ts`: **복구 안내 생성기**(DEC-5) — `close-migrate`의 refuse 문구와 phase 3의 intake
  `hints`가 같은 함수를 쓴다.
- `req-close.ts`: 그 helper로 `rebindablePhaseIds`를 계산해 `MigrationFacts`에 전달. **새 판정과 같은
  커밋**이라 판정기가 빈 사실로 도는 중간 상태가 없다.
- 단위 테스트: ① 낡은 dev-complete → 검증된 terminal 없음 ② 전부 rebindable → refuse에 `req:rebind`
  포함 ③ 일부 레거시(`phase_design_ref` 부재) → stamp 도달 ④ 정상 dev-complete → 여전히 noop
  ⑤ series-terminal·migrated-complete 우선순위 불변 ⑥ 안내 생성기: 세 구성(없음/전부 rebindable/
  레거시 포함)이 DEC-5 표와 일치하고, **레거시 포함 구성에서 `req:rebind`를 제시하지 않는다**.
- 실 git e2e **리그레션 픽스처**(상태 구성은 **재사용 가능한 test util**로 빼서 phase 2가 각자 호출한다):
  ⑦ 낡은 dev-complete + 새 design_ref phase 상태를 실제 커밋으로 구성 → `req:new` 차단 확인
  ⑧ `--migrate`가 no-op이 아니라 **rebind 안내로 거부**
  ⑨ 대조군: `phase_design_ref` 부재 행이 섞이면 **stamp로 진행**(지금 교착인 경로가 열린다).

🔴 **양방향 실측(exit 조건)**: 이 저장소 HEAD의 모든 `workflow/REQ-*` 티켓에 옛 술어와 새 술어를 나란히
적용해 판정이 갈리는 티켓 수·방향을 기록한다(일회용 스크립트, 커밋하지 않음). 결과를 phase 커밋 메시지와
리뷰 요청에 남긴다. 예상 밖 결과면 설계로 되돌아간다(REQ-2026-066 교훈).

Exit: eslint0·typecheck0 · 단위·e2e 그린 · 실측 기록 · Codex phase 리뷰 승인.

## Phase 2 — `req:rebind` 재진입 (`phase-2-rebind-reentry`)

범위:
- `req-rebind.ts`: `RebindPlan` 3-kind 재편(DEC-3) — `noop`은 rebind 쓰기만 건너뛰고 완료 재판정까지 진행.
- inventory 원천: 워킹 `state.json` 우선, 부재 시 HEAD `state.json` fallback(DEC-4). 둘 다 없으면
  무엇이 없어 판정 불가인지 밝히고 실패.
- e2e(**자립 픽스처** — Phase 1의 실행 결과가 아니라 Phase 1이 남긴 test util을 호출해 상태를 스스로
  만든다): ① rebind ×N 후 종결 ② **마지막 rebind 커밋 직후 dev-complete 발행을 건너뛴 상태를 만들고
  재실행 → 종결**(A4) ③ 워킹 `state.json` 삭제 후에도 재판정 성립 ④ HEAD state의 `phases`가 빈
  배열이면 "완료 재판정 못 함"을 **명시적으로 보고**(DEC-4의 조용한 오답 방지).

Exit: eslint0·typecheck0 · 단위·e2e 그린 · Codex phase 리뷰 승인.

## Phase 3 — intake 안내 (`phase-3-intake-guidance`)

범위:
- `lib/intake.ts`: `IntakeFacts`에 `evidencedPhaseIdsAll`·`rebindablePhaseIds` 추가(`scanTicketIntake`가
  이미 읽는 HEAD 매니페스트에서 계산 — Phase 1의 helper 재사용), `IntakeTicketResult.hints` 신설,
  `classifyIntake`가 Phase 1의 **안내 생성기**로 채움(DEC-5).
- `req-new.ts`: `renderIntakeSummary`가 `hints`를 렌더. 기존 문구는 유지하고 **덧붙인다**.
- 테스트: ① 전부 rebindable → 출력에 `req:rebind <REQ> --phase <미결속 id>` 포함 ② **레거시 포함 →
  rebind가 아니라 `req:close --migrate` 안내**(r01 P1) ③ 일반 `developing`(미결속 없음) → 문구 무변경
  ④ intake 안내와 `req:close --migrate`의 refuse 문구가 같은 구성에서 **같은 명령을 가리킨다**.

Exit: eslint0·typecheck0 · 단위 그린 · Codex phase 리뷰 승인.

## Phase 4 — 문서 (`phase-4-docs`)

범위:
- `docs/workflow.md`·`docs/workflow.en.md`: `req:rebind` 절에 "낡은 dev-complete로 갇힌 티켓"과
  `--migrate`와의 경계(어느 쪽이 언제 적용되는가)를 추가.
- `CHANGELOG.md` Unreleased: 이 REQ + **미배포 REQ-2026-069(`req:rebind`)** 항목이 함께 있는지 확인.
- 소비자 회신용 요약(리포트 원인 (c) 정정·제안 B 기각 사유 포함) — 문서 본문이 아니라 CHANGELOG·docs로
  드러나는 선에서.

Exit: docs 링크 검증 그린 · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(unit·typecheck·lint) · 사용자 main 머지(별도 승인).
- 🔴 릴리스(0.11.0)는 이 REQ의 완료 조건이 아니라 **후속 통제점**이다.
