# REQ-2026-004 리뷰 요청

## 배경
실제 프로젝트 주입 중 review-gate의 결정적 무한 재리뷰 루프가 관측됨. 원인·개선을 audit + 리뷰로 검증한 뒤 2개 커밋으로 랜딩(안정화 체크포인트). init CLI UX 개선은 별도 관심사로 분리.

## 변경 요약
- Phase 1: init CLI 안내/UX(`bin/init.ts`·`bin/commitgate.mjs`·`package.json` 0.2.2·init 테스트).
- Phase 2: outcome 분리(`classifyReview`)·종료코드 계약(0/1/2/3)·blocked 회로차단기·`--fresh-thread`·R10(승인+findings 모순)·git maxBuffer 64MiB·hermetic `.cmd` 테스트·schema description.

## 리뷰 포인트
- fail-closed 보존: 미승인이 승인으로 새는 경로가 없는가.
- `classifyReview`/`resolveReviewOutcome`의 outcome↔exit code 매핑 정확성.
- R10 모순 규칙이 정상 승인(findings=[])을 막지 않는가.
- 레거시 phase 경로·기존 아카이브(schema 1.1) 하위호환.
