# REQ-2026-014 리뷰 요청 (phase-4-repro-pm)

## 배경

설계는 design-r21에서 findings 0건 승인됐다. Phase 1(dispatch `95d94b8`)·Phase 2(Stage B init `46b740e`)·
Phase 3(migrate/uninstall `e141ac3`)는 각각 findings 0건으로 승인·커밋됐다.

이 phase는 **설치 모드 진단(doctor D19)** 하나만 추가한다. 지원 경계(pnpm/yarn·PnP·workspace·lockfile 권고)는
**문서로 확정**하며 Phase 5(README)에서 반영한다 — 코드는 이 검사 1건뿐이다.

## 변경 요약 (staged diff = 2파일)

**`scripts/req/req-doctor.ts`** — doctor **D19** 신설(현재 구현 최대가 D18. `D1/D4/D4a/D7/D7b/D8/D12/D14`는 예약 결번이라 재사용하지 않았다):

- **`classifyInstallMode(scripts)`** 순수 export — `req:*` **값의 형태만** 본다:
  `stage-a`(`tsx scripts/req/*.ts`) / `stage-b`(`commitgate <verb>`) / `mixed`(둘 공존) / `none` / `custom`.
  **manifest·lockfile·node_modules·버전에 의존하지 않는다.**
- 🔴 **level 상한은 WARN — 절대 FAIL이 아니다.** **CommitGate 자신의 `package.json`이 Stage A 형태**이고
  (개발 repo가 자기 스크립트를 직접 실행하므로 정상), `req:commit`이 이 doctor를 **exit≠0에 throw하는 하드 게이트로 spawn**한다.
  FAIL이면 **이 저장소 자신의 커밋과 정당한 Stage A 소비자 전원의 커밋이 영구 차단**된다.
  Stage A는 결함이 아니라 지원되는 설치 형태다 → **mixed만 WARN**.
- 🔴 **`bin/init.ts`를 import하지 않는다**(레이어 역전 방지). init.ts는 cross-spawn·semver·git spawn을 끌고 오는
  ~1250줄 설치 CLI다. 그래서 바이트 일치(`REQ_SCRIPTS`)가 아니라 **shape**로 판정한다 — 요구(R7)도 "script 형태를 기준으로"다.
  **migrate와의 비대칭은 의도적이다**: migrate의 전환은 **쓰기**라 바이트 정확 일치를 요구하고(사용자 값 미덮어씀),
  이 진단은 **읽기 전용 advisory**라 shape로 충분하다.
- `DoctorInputs.reqScripts?`는 **optional**(required면 `req-doctor.test.ts`의 `const base: DoctorInputs = {…}` 리터럴이 즉시 tsc 오류).
  `undefined`=미조회 / `null`=없음·파손 / object=파싱 결과. 셋 다 **모든 경로에서 정확히 1개 Check를 push**한다.
- IO는 `main()`에서만(`runChecks`는 순수 계약). package.json 읽기에 **`stripBom` 적용** — BOM'd package.json은
  이 플랫폼에서 실제로 발생하는 실패다(PowerShell `Set-Content -Encoding UTF8`). 읽기 실패는 **throw하지 않고 null**
  (읽기 전용 advisory가 무관한 이유로 커밋 게이트를 죽이면 안 된다).
- D19 블록은 **D17 뒤 `return c` 앞에 append** — 중간값에 의존하지 않아 위 블록을 흔들지 않는다.

**`tests/unit/req-doctor.test.ts`** — 신규 17건.

## 검증 결과 (리뷰 샌드박스는 read-only라 vitest를 못 돌리므로 이쪽 증거를 제시한다)

- `npm run typecheck` → 0
- `npm test` → **17파일 / 925 테스트 전부 통과**(Phase 3 시점 908 + 신규 17).
- **이 저장소 자신의 `npm run req:doctor -- 2026-014` 실측**:
  `OK D19: 설치 모드: Stage A(vendored — scripts/req/** 를 직접 실행)(req:* 스크립트 형태 기준)` — **OK다(FAIL 아님)**.
  즉 위 "자기 차단" 지뢰가 실재했고 해체됐음이 실측으로 확인된다.
- "어떤 입력에도 D19가 FAIL을 만들지 않는다"를 전수 테스트로 고정했다(기존 D18 advisory 블록과 같은 패턴).

## 리뷰 포인트 (하한이지 상한이 아님)

1. **WARN 상한이 옳은가** — Stage A를 OK로 두는 것이 R7(혼합 설치 방지)을 약화시키는가?
   (혼합 설치의 **강제 지점**은 Phase 2의 init D19 fail-closed이고, 이 검사는 **진단**이다. 그 역할 분담이 타당한가?)
2. **shape 판정이 정상 경로에서 오분류하는가** — `custom` vs `mixed` 경계(Stage A/B가 **공존**해야 mixed),
   부분 집합 판정, 파일명이 다른 Stage A 형태.
3. **SSOT 드리프트 위험을 감수할 만한가** — `REQ_SCRIPT_KEYS`를 `bin/init.ts`에서 import하지 않고 이름만 복제했다.
   레이어 역전 회피가 그 값어치를 하는가? (드리프트가 나도 advisory라 게이트를 깨지 않는다.)
4. **optional 필드·null 처리가 기존 호출부를 깨지 않는가** — legacy 2-arg 호출, package.json 파손, BOM.
5. **읽기 전용 계약** — `readReqScripts`가 throw하지 않는 것이 옳은가, 아니면 파손을 감춰 정보를 잃는가?

## 이 리뷰에 요청하는 규율

[00-requirement.md](00-requirement.md) §4의 비목표(manifest·provenance·lockfile 파서·버전 드리프트 탐지·
realpath 동일성·PnP preflight/WARN·nested workspace 전 형태)를 이번 범위로 되돌리는 지적은 `observations`로 부탁한다.
설계는 doctor 검사를 **설치 모드 1건**으로 명시 축소했고, 버전 드리프트·PnP WARN은 backlog(D20/D21 예약)다.
**Phase 5로 명시 배정된 것**(README ko/en, CLI help, packed-tarball smoke, 지원 경계 문서화)도 이 phase의 결함이 아니다.

이 프로젝트는 **하나의 활성 worktree와 협조적 작업자**만 지원한다.

**차단(`findings`)은 P1 — 정상 사용 경로에서 재현되는 요구 위반·데이터 손상·보안 구멍·fail-closed 우회 — 만.**
각 P1에는 **해당 인수 기준·재현 경로·실패 결과**를 함께 적어 달라. 그 외는 `observations`로.
