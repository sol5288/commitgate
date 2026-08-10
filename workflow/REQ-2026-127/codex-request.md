# REQ-2026-127 리뷰 요청

## 배경

verify-range의 분류가 표시자 매칭(consumed SHA 존재·trailer 줄·부모 수)이라 강한 증명이 아니다.
0.22.0에서 심층 검증(스키마·아카이브 실재·해시 일치·중복 소비·trailer 경로·evil merge)과
정당한 예외의 명시 승인(attestation)을 추가한다. integrate(REQ-126)는 코어 공유로 자동 소비한다.

## 변경 요약

- Phase 1: 6범주(`approved|bookkeeping|merge|attested|invalid-evidence|unproven`) 분류 코어 —
  evidence.ts `validateManifest` 재사용(사본 금지), cat-file --batch blob 리더(N+1 금지·REQ-128 재사용),
  attestations 파서. 검증 불가(blob 읽기 실패·state 부재)는 invalid 단정 대신 축소 표기.
- Phase 2: `commitgate attest <sha> --reason` — append-only 커밋 기록(sha·tree·이유·시각·로컬 주체).
- Phase 3: CLI 수집 확장·strict(invalid+unproven 실패·attested 통과)·integrate/merge-gate 결속·문서.

## 리뷰 포인트

- 분류 단계 순서(merge-cc → trailer경로 → 심층 approved → attested → unproven)가 구제 불가 원칙
  (invalid는 attest로 면제 불가)과 정합인가.
- 검증 축소 경로(위양성 방지)가 게이트 강도를 몰래 깎지 않는가(notes 표기 계약).
- 프로세스 수 상한(배치 1회·merge당 --cc 1회)이 회귀 오라클로 고정되는가.
