# REQ-2026-126 리뷰 요청

## 배경

0.22.0의 핵심 축 — 통합 직전 절차(clean·strict 증거 검증·CI 선택·사람 확인·로컬 merge)를 소유하는
`commitgate integrate` seam과, GitHub CI **실행**(workflow_dispatch)의 명시 opt-in 경로.
확정 정책: GitHub CI는 기본 실행하지 않는다. 조회(`--check-github-ci`, REQ-125)와 실행
(`--run-github-ci`, 이 REQ)은 이름·의미에서 분리된다. `delivery integrate`(feature→delivery 브랜치)
와는 층이 다르다(이 verb는 feature→trunk).

## 변경 요약

- Phase 1: config `githubCi{workflow, timeoutMinutes}`(additive) + CI 실행 포트
  (dispatch→시각·event·ref 필터 식별→폴링, 다중 후보는 오연결 대신 식별 불가 실패, fake 포트).
- Phase 2: MergeGate 순수 코어 — planIntegration(전제 거부·항상-strict 증거 판정)·decideCiRun.
- Phase 3: `bin/integrate.ts` verb(기본 dry-run·`--run`+최종 [y/N]·충돌 abort 복구·push 없음) +
  감사 로그 `.integrate-runs.jsonl`(유지 규칙 3종).
- Phase 4: 문서(ko/en)·CHANGELOG.

## 리뷰 포인트

- run 식별 규칙(createdSince·event·ref, 다중 후보 실패)이 오연결을 막으면서 정상 케이스를 막지 않는가.
- 실패 복구 경로(merge --abort → 원래 브랜치 복귀)가 자동 reset/stash 금지 원칙과 정합인가.
- 테스트가 실제 gh·네트워크에 절대 닿지 않는 구조인가(fake 주입 seam).
- 비목표 경계(PR/push/HIGH 확인 이전/attestation)가 설계에 새지 않았는가.
