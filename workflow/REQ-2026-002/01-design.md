# REQ-2026-002 설계 — 크로스플랫폼 CI + `.cmd` 주입 정식 테스트

> SSOT 설계=[`docs/follow-ups-design.md`](../../docs/follow-ups-design.md) §2·§3(보정판). 본 문서는 그 결정을 코드/CI에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)
- P1 경계: `scripts/req/lib/adapters.ts`(`safeSpawnSync`)·`req-commit.ts`(`runDoctor`) — **무변경**(테스트 대상).
- 현행 P1 테스트: `tests/unit/req-adapters.test.ts`(`[P1] safeSpawnSync`) — `node -e`(일반 exec). `.cmd` 경로 미커버.
- CI: **없음**. 모든 검증이 Windows 로컬 1회성.

## 핵심 설계 결정

### #3 — `.cmd` 정식 테스트 (phase 1)
- **D-A1 플랫폼 가드**: vitest에서 `process.platform === 'win32'`일 때만 실행(`it`), 아니면 `it.skip`(비-Windows는 skip=통과 집계). `describe`에 가드.
- **D-A2 픽스처는 실제 wrapper 동형**: `echo ARGV=%*`는 `%*` 재확장으로 취약·부적합 → codex.cmd/npm.cmd처럼 `.cmd`가 **node recorder**를 호출: `@echo off` + `node "%~dp0recorder.js" %*`. `recorder.js`는 `process.argv.slice(2)`를 **JSON 파일로 기록**.
- **D-A3 cwd·부작용 경로 결정성(design R1 P3)**: `safeSpawnSync(tempCmd, args, { cwd: tmpDir })`로 **cwd를 임시 dir에 고정**하고, 주입 시도 인자의 출력 대상은 **tmpDir 하위 절대경로**로 준다(예: `x & echo INJECTED> <tmpDir>\\injected.txt`). 이래야 부작용 파일이 repo/test cwd로 새지 않고 검사·정리가 결정적이다.
- **D-A4 단언은 2가지만**: (1) tmpDir의 주입 부작용 파일(`injected.txt`) **미생성**, (2) recorder argv == **원본 인자 배열**(리터럴). ⚠️ **stdout의 `INJECTED` 부재는 단언하지 않음**(인자에 리터럴 `INJECTED`가 들어있는 게 정상 — "원문 도착"과 충돌).
- **D-A5 임시자원 정리**: `mkdtempSync` + `finally`/`afterEach`로 tmpDir(=`.cmd`·recorder·출력 파일) 정리.
- **D-A6 상보성**: 기존 `node -e` 테스트(전 OS·일반 경로)와 `.cmd` 테스트(Windows·wrapper 경로)를 **둘 다 유지**.

### #2 — 크로스플랫폼 CI (phase 2)
- **D-B1 `npm run smoke`(신설) = pack tarball 기반**(로컬 소스 실행 아님): ① `npm pack` → `commitgate-<v>.tgz` ② 임시 target(`git init`+`git config user.*`+`npm init -y`) ③ `npm i -D <abs>/commitgate-<v>.tgz` ④ `npx commitgate --dry-run` **rc=0** ⑤(선택) 실제 init 후 파일·스크립트·주입 devDeps 검증. Node로 구현(크로스플랫폼; bash 금지 — Windows 러너 호환).
- **D-B2 워크플로** `.github/workflows/ci.yml`: trigger=push(main)·PR·tag `v*`. matrix `os:[ubuntu-latest, macos-latest, windows-latest] × node:[18, 20, 22]`(정식 GitHub-hosted runner 라벨 — `ubuntu`/`macos` 약칭은 유효 라벨 아님). steps: checkout→setup-node→`npm ci`→`npm run typecheck`→`npm test`→`npm run smoke`.
- **D-B3 CI 경계(정직)**: `req:review-codex`/`req:commit`는 live Codex+인증 필요 → CI 미실행. 리뷰 **로직**은 `createFakeReviewerAdapter` 유닛이 전 OS에서 커버. 못 잡는 건 live Codex 왕복뿐.
- **D-B4 배포 게이트(문서)**: README/RELEASING에 "전 플랫폼 CI green 후에만 `npm publish`" 명문화. 완전 자동 publish는 2FA로 불가(사람 최종 실행).

## Phase별 구현
- **Phase 1 (#3)**: `tests/unit/req-adapters-cmd.test.ts`(신규, Windows-가드) + recorder 픽스처(테스트가 임시 생성 or `tests/fixtures/`). 검증: windows 통과·비-win skip, 기존 유닛 무손상.
- **Phase 2 (#2)**: `scripts/smoke.mjs`(신규, pack→설치→bin dry-run) + `package.json` `"smoke"` 스크립트 + `.github/workflows/ci.yml`. 검증: 로컬 `npm run smoke` rc=0, CI 매트릭스 green(푸시 후 확인).

## 변경 파일
- 신규: `tests/unit/req-adapters-cmd.test.ts`, (recorder 픽스처), `scripts/smoke.mjs`, `.github/workflows/ci.yml`.
- 수정: `package.json`(`scripts.smoke`), README/문서(배포 게이트 1줄).
- **무변경**: `adapters.ts`·`req-commit.ts`·`init.ts` 등 코어.

## 하위호환·안전
- 코어(safeSpawnSync·승인 바인딩) 무변경 — 테스트/CI/스크립트만 추가.
- `.cmd` 테스트는 플랫폼 가드라 비-Windows CI/로컬에서 실패 아님(skip).
- smoke는 임시 dir에서만 동작(레포·전역 오염 없음). tarball은 임시 생성 후 정리.
- 비목표: #1(버전 하한)·Stage B·live Codex CI.
