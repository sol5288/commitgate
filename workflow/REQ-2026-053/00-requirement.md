# REQ-2026-053 요구사항

durable close-proof 마이그레이션 — `req:close` (레거시 완료 티켓 종결)

## 문제

REQ-2026-052(B2)가 `req:new`에 intake 게이트(DEC-C)를 넣었다. 게이트는 HEAD-committed durable 증거만으로
각 기존 티켓의 기본 상태를 파생해, **미종결(developing/needs-recovery)** durable 티켓이 하나라도 있으면
새 REQ 생성을 fail-closed로 막는다.

그런데 close-proof 아티팩트(`ticket-close.jsonl`)와 `phase_design_ref` 결속은 B2 **도중에** 도입됐다. 그
이전에 완료·병합된 durable 티켓(REQ-2026-049·050·051)과 재승인 이력이 뒤섞인 052는 다음 이유로 **영구
developing**이다:

- dev-complete는 self-verifying이라 `phase_design_ref`가 **현재 design_ref에 결속된** phase 증거를 요구한다.
  레거시 티켓의 phase 행에는 그 결속이 없다(도입 前 완료).
- `req:commit --finalize`는 pending 마커·orphaned HEAD source가 있어야 동작한다 — 이미 완전 커밋된
  과거 티켓엔 "복구할 미완 작업 없음"으로 적용되지 않는다(실측 확인).
- `req:reconstruct`는 `series-terminal(replace)`만 재구성한다 — 이 완료 티켓들엔 해당 없음.
- `req:new`에 bypass 플래그·intake 비활성 config 없음.

결과: **CommitGate 저장소에서 새 REQ를 만들 수 없다**(워크플로 잠금). 이는 B2 배포가 남긴 마이그레이션 갭이다.

## 목표

과거에 워크플로를 정상 통과해 완료됐으나 close-proof/design 결속 regime **이전**이라 dev-complete로 자기증명될
수 없는 durable 티켓을, 운영자가 완료를 확인(attest)하고 **감사 가능하게 종결**하는 경로를 제공한다.

- 새 명령 `req:close <REQ> --migrate [--run]` — HEAD-committed 증거만으로 자격을 판정하고, 자격이 되면
  `migrated-complete` close-proof 행을 durable하게 남긴다.
- intake 게이트가 `migrated-complete`를 **비차단** 종결 상태로 인식한다.
- 자격 미달(증거 손상/부재·이미 종결·정상 dev-complete 가능)이면 fail-closed로 거부하고 올바른 경로를 안내한다.

## 비목표

- code/main 변경 없음(이 REQ는 워크플로 원장 아티팩트만 다룬다).
- dev-complete self-verify 완화 없음 — 신규 티켓은 여전히 강한 design-bound 경로를 강제한다.
- successor 없는 임의 terminate·리뷰 예산·리뷰호출 lifecycle은 이 REQ 범위 밖(후속 C/D/E).

## 완료 기준

- `req:close --migrate --run`으로 REQ-049·050·051·052를 종결하면 `req:new`가 다시 성공한다.
- 게이트·close-proof·intake 단위/실git 테스트 그린 · typecheck 0 · lint 0 · smoke 그린(신규 verb 자동 검출).
