# REQ-2026-002 요구사항 — 크로스플랫폼 CI + `.cmd` 주입 정식 테스트 (#2 + #3)

## 배경
0.1.1의 P1 보안 수정은 `shell:true`를 `cross-spawn` 기반 `safeSpawnSync`로 교체했다. 그러나 (a) 이 경계는 **Windows에서만** 검증됐고(POSIX 미검증), (b) 정식 회귀 테스트는 `node -e`(일반 실행 파일)로 돌아 **실제 공격면인 Windows `.cmd` wrapper 경로**를 회귀 가드에 넣지 못했다. Codex 보안 리뷰의 non-blocking 후속 [#2](https://github.com/sol5288/commitgate/issues/2)·[#3](https://github.com/sol5288/commitgate/issues/3). SSOT 설계=[`docs/follow-ups-design.md`](../../docs/follow-ups-design.md).

## 목표
1. **#3**: `.cmd` 대상 명령 주입 방어를 **Windows-가드 정식 회귀 테스트**로 편입 — codex.cmd/npm.cmd처럼 node recorder를 호출하는 `.cmd` 픽스처 + argv 리터럴 일치 단언.
2. **#2**: **{ubuntu·macos·windows} × {Node 18·20·22}** GitHub Actions 매트릭스에서 install→typecheck→test→pack→**pack tarball 설치 smoke**를 자동 실행. `npm run smoke` 스크립트 신설.

## 범위
- **In**: `.cmd` 정식 테스트 + node recorder 픽스처(phase 1), `npm run smoke`(pack→설치→bin 실행) + `.github/workflows/ci.yml` 매트릭스(phase 2).
- **Out(별도 REQ)**: #1(cross-spawn 버전 하한 진단). Stage B. CI에서의 live Codex 리뷰 자동화(시크릿·2FA 범위 밖). 완전 자동 `npm publish`.

## 수용 기준
- **#3**: windows에서 `.cmd` 주입 테스트 **통과**(injected 파일 미생성 + recorder argv == 원본), 비-Windows에서 **skip**. 기존 `[P1]` `node -e` 테스트와 상보(둘 다 유지).
- **#2**: 3 OS × 3 Node 전부 typecheck 0 · test green · pack 성공 · **tarball 설치본 `commitgate` bin 실행 rc=0**. `npm run smoke`가 로컬에서도 동일 동작.
- 코어 승인 바인딩·`safeSpawnSync` 로직 **무변경**(테스트·CI·스크립트만 추가).
