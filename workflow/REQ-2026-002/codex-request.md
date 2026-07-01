# REQ-2026-002 리뷰 요청 — 크로스플랫폼 CI + `.cmd` 주입 정식 테스트 (설계)

## 배경
P1 보안 수정(0.1.1, `safeSpawnSync`)이 Windows에서만 검증됐고, 실제 공격면인 `.cmd` wrapper 경로가 정식 회귀 가드에 없다. Codex 보안 리뷰 non-blocking 후속 #2·#3을 한 REQ로 처리. 코어 무변경(테스트·CI·스크립트만 추가).

## 변경 요약
- **#3(phase 1)**: `.cmd`가 node recorder를 호출하는 Windows-가드 정식 테스트. 단언=주입 부작용 파일 미생성 + recorder argv == 원본(리터럴). stdout 파싱 안 함.
- **#2(phase 2)**: `npm run smoke`(pack tarball 설치 후 bin 실행) + GitHub Actions 매트릭스(3 OS × Node 18/20/22).

## R1 반영(재리뷰 대상)
design R1 NEEDS_FIX 2건 반영:
- **P2**: CI matrix runner 라벨을 정식명 `ubuntu-latest`·`macos-latest`·`windows-latest`로 명시(약칭 무효).
- **P3**: `.cmd` 테스트를 `safeSpawnSync(..., { cwd: tmpDir })`로 cwd 고정 + 주입 출력 대상을 tmpDir 하위 절대경로로 지정 → 부작용 검사·정리 결정성 확보.

## 리뷰 포인트 (design)
1. **#3 픽스처·단언 설계**가 실제 wrapper(codex.cmd/npm.cmd) 경로를 올바르게 재현하는가. `.cmd`→`node recorder %*`+argv 비교가 주입 회귀를 확실히 잡는가(shell:true 재도입 시 red).
2. **#2 smoke가 진짜 배포본 검증인가**: `node bin/...`(로컬 소스) 아니라 `npm pack` tarball 설치본의 bin 실행으로 정의됐는가. smoke.mjs를 Node로(크로스플랫폼) 두는 판단.
3. **CI 경계**가 정직한가: live Codex는 CI 미실행, 리뷰 로직은 FakeReviewerAdapter 유닛이 커버 — 이 분리가 타당한가.
4. **범위**: #1을 별도 REQ로 분리, 코어 무변경 유지가 맞는가.
