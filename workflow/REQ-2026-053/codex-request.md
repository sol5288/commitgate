# REQ-2026-053 리뷰 요청 — durable close-proof 마이그레이션 (`req:close`)

## 배경

REQ-2026-052(B2)의 `req:new` intake 게이트가 close-proof/`phase_design_ref` 결속 regime **이전에** 완료된
durable 티켓(REQ-049·050·051·052)을 영구 `developing`으로 분류해 **새 REQ 생성을 잠갔다**. `--finalize`·
`--reconstruct`·bypass 모두 적용 불가(00-requirement 실측 근거). 이 REQ는 그 마이그레이션 갭을 메운다.

## 변경 요약

- 새 close-proof 이벤트/기본 상태 `migrated-complete`(DEC-M1) — dev-complete를 흉내 내지 않는 정직한 별도
  종결. deriveBaseState는 dev-complete **아래**, needs-recovery **위**로 우선순위 부여, 비차단.
- 새 명령 `req:close <REQ> --migrate [--run]`(DEC-M3~M5) — HEAD-committed 증거만으로 자격 6항 판정,
  적격이면 `migrated-complete` 행을 dry-run 기본/`--run` pathspec 커밋으로 durable화. 순수 planner
  (`lib/close-migrate.ts`) + CLI(`req-close.ts`) 분리.
- dispatch VERB_MODULES에 `req:close` 등록 → P4c Stage-B 표면 자동 반영(init/migrate/uninstall/smoke 파생).

> r01 P1 2건 반영: (P1-1) 완료성 증명을 **integrated(mainline 조상)**로 — per-ticket 증거만으로 구별 불가한
> "완료 vs 진행 중"을 병합 여부로 가른다(DEC-M3.7). (P1-2) 재실행은 **command-level no-op**(DEC-M7).

## 리뷰 포인트

1. **감사 정직성(DEC-M2)**: `migrated-complete`가 self-verifying dev-complete로 오인될 여지가 없는가?
   `reconstructed:true` 강제 + evidence_basis 필수 + 별도 event로 충분히 구별되는가?
2. **부분완료 우회 방지(DEC-M3.7, P1-1·r02 P1)**: integrated(mainline 조상) 검사가 미병합 진행-중 티켓을
   확실히 배제하는가? mainline이 **운영자 입력 없이** 신뢰된 ref(origin/HEAD→origin/main→로컬 main)로만
   해소되고, 임의 ref override가 불가능한가? integrated를 **command precondition**으로만 쓰고
   deriveBaseState 순수성은 지키는 경계가 맞는가?
3. **강한 경로 우회 방지(DEC-M3.6)**: design-bound phase가 evidenced inventory 전체를 덮으면 마이그레이션 거부
   → 정상 finalize 유도가 실제로 "dev-complete 가능 티켓"을 배제하는가?
4. **재실행 계약(DEC-M7, P1-2)**: 이미 terminal close면 성공 no-op(기존 `at` 보존·conflict/거부 아님)이 명확한가?
5. **손상 티켓 보호(DEC-M3.2/3.5)**: 증거 무결성 실패·needs-recovery·corrupt에 완료 스탬프가 찍히지 않는가?
6. **HEAD-only·데이터 손실 방지(DEC-M4)**: 워킹 state 미참조, close-proof clean 가드가 미커밋 close-proof를
   덮지 않는가? pathspec 커밋이 staged 코드를 건드리지 않는가?
7. **하위호환(DEC-M6)**: additive event가 기존 close-proof 파싱을 깨지 않는가? 릴리스 관용(구 리더 fail-closed)
   서술이 정확한가?
