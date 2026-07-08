# REQ-2026-004 리뷰 요청

## 리뷰 종류/범위 (중요)
이것은 **`--kind design`(설계 리뷰)** 이다. 권위 아티팩트는 설계 문서 00/01/02이며, **구현 diff는 이 리뷰의 대상이 아니다**(REVIEW_BASE_SHA 기준 diff가 비어 있는 것은 정상 — 설계 리뷰는 코드가 아니라 설계 문서를 심사한다). 구현 코드(`classifyReview` 등의 실제 로직·테스트)는 **후속 phase 리뷰(`--kind phase`)에서 staged diff로 별도 검증**한다.

이 설계 리뷰에서 판단해 줄 것은 **접근(설계 결정)의 타당성**이다:
- 설계가 fail-closed를 보존하는가(미승인→승인으로 새는 설계 경로가 없는가).
- outcome 분리 모델(approved/needs-fix/blocked/invalid)과 종료코드 계약(0/1/2/3)이 무한 재리뷰 루프를 도구 레벨에서 불가능하게 만드는가.
- R10(`commit_approved=yes && findings.length>0` = 모순) 정책이 정상 승인(findings=[])을 막지 않는가.
- schema 1.1 유지·레거시 phase 경로 하위호환 결정이 안전한가.
승인 시 `commit_approved=yes`, `merge_ready=no`(설계 승인은 merge 신호 아님). 설계 자체에 결함이 없으면 findings 없이 승인해 달라.

## 배경
실제 프로젝트 주입 중 review-gate의 결정적 무한 재리뷰 루프(`findings=[] + commit_approved=no`가 `OK`/exit 0으로 보고되며 커밋은 계속 차단)가 관측됨. 원인·개선을 audit + 리뷰로 검증한 뒤 2개 커밋으로 랜딩(안정화 체크포인트).

## 설계 결정 요약 (01-design 참조)
- **outcome 분리**: `classifyReview`가 유효성(result.ok)과 승인을 분리. 미승인+findings 있음→needs-fix(exit 3), 미승인+findings 없음→blocked(exit 2, 재시도 금지), !ok→invalid(exit 1), 승인→exit 0.
- **단일 정본**: `main()`은 `resolveReviewOutcome`을 호출해 outcome→exit code·state를 확정(배선 drift 방지).
- **blocked 회로차단기**: 같은 바인딩 2회 blocked면 codex 호출 전 exit 2. `--fresh-thread`로 마커 초기화+새 스레드 회복.
- **R10(안전)**: 승인은 findings 0건일 때만. 비차단 코멘트용 별도 필드는 후속 REQ.
- **가용성**: git maxBuffer 64MiB(큰 diff ENOBUFS 방지). schema `description` 추가(version 1.1 유지).

## Phase 분해
- Phase 1(init UX) / Phase 2(review-gate). 두 Phase 코드 파일 집합은 서로소. 각 Phase는 후속 `--kind phase` 리뷰로 검증.
