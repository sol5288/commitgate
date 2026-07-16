# REQ-2026-014 리뷰 요청 (phase-2-init-runtime)

## 배경

Stage B 전환의 **핵심 phase**다. 설계는 design-r21에서 findings 0건으로 승인됐다(축소 범위 — [00-requirement.md](00-requirement.md) §4가 비목표를 명시 열거).
Phase 1(dispatch/runCli)은 이미 승인·커밋(`95d94b8`)됐고 이 diff는 그것을 건드리지 않는다.

이 phase는 `bin/init.ts`를 **Stage A(vendored scaffold) → Stage B(런타임 패키지)** 로 바꾼다.

## 변경 요약 (staged diff = 4파일)

**`bin/init.ts`** — 동작 변경 4가지:

1. **무복사(R3)**: `scripts/req/**` 복사 루프 제거. 실행 코드는 `node_modules/commitgate`에만 있다.
   `KIT_SOURCE_DIR_REL` 상수는 남는다(`detectStageA`·`bin/uninstall.ts`의 Stage A 분류가 쓴다).
   `package.json` `files[]`의 `scripts/req`도 그대로 둔다 — **복사 축과 tarball 축은 다른 축**이고, 패키지 자신의 bin이 그리로 dispatch한다.
2. **무주입(R3)**: `REQ_DEV_DEPS`(tsx·ajv·cross-spawn) 주입 루프 제거. Apply에서 `pkg.devDependencies` **재대입도 제거**
   (재대입하면 devDependencies가 없던 package.json에 빈 `{}`가 생긴다). `REQ_DEV_DEPS` 상수는 uninstall이 쓰므로 남긴다.
3. **`STAGE_B_REQ_SCRIPTS` 주입(R1/R2)**: `req:* = commitgate <verb>`. 키 집합은 `REQ_SCRIPTS`에서 파생.
   주입 규칙 `if (!(k in scripts))`는 **기존 코드 그대로** — 사용자 정의 `req:*` 미덮어씀은 신규 로직이 아니라 기존 동작이다(회귀 테스트로 고정).
4. **Stage B 전제 2종을 preflight에 추가(순서가 계약)**:
   - `detectStageA`(D19): `req:*` 값이 정확히 `REQ_SCRIPTS` 값이거나 `scripts/req/**` 존재 → fail-closed + migrate 안내.
   - `commitgateDeclared`(D14): `devDependencies.commitgate` **키 존재만** 확인 → 없으면 fail-closed + 선행 설치 안내.

**테스트 3파일** — 픽스처 전환 + 신규 검증:
- 픽스처 기본 pkg에 `devDependencies.commitgate` 병합(없으면 D14가 `runInit` 90곳을 전부 throw). `devDependencies`가
  비-객체인 모양 검증 테스트는 **병합하지 않는다**(그 테스트의 의도 보존).
- `uninstall.test.ts`: 신규 `installStageA()` 시더 — Stage B init이 vendoring을 멈췄으므로, **vendored 파일 분류를 검증하는
  5개 테스트**는 Stage A 레이아웃을 직접 시드한다. `bin/uninstall.ts` **소스는 이 phase에서 건드리지 않는다**(Phase 3 범위).
  시더는 Stage A의 미덮어씀 의미를 정확히 재현한다(Stage B가 방금 심은 값만 되돌리고 사용자 값은 보존).
- **vacuity trap 해소**: 부분 설치를 `existsSync('scripts/req/req-new.ts')===false`로 증명하던 단언은 Stage B에서
  **성공 경로에도 참**이라 공허해진다. `snapshot()` 전수 비교 또는 Stage B가 실제로 쓰는 경로로 재-앵커했다.

## 검증 결과(리뷰 샌드박스는 read-only라 vitest를 못 돌리므로 이쪽 증거를 제시한다)

- `npm run typecheck` → 0
- `npm test` → **16 파일 / 879 테스트 전부 통과**(기준선 869 + 신규 10). Phase 1 `dispatch.test.ts` 17건 무변경 통과.
- 보안 회귀 세트 **무변경 통과**: symlink/confinement 4 · zero-write snapshot 4 · gitignore preflight 6 · `--strict`/`--dry-run`/`--force`/`--dir`.

## 리뷰 포인트 (하한이지 상한이 아님)

1. **D19 → D14 순서가 코드에서 실제로 보장되는가** — design r20 P1이 잡은 결함이다. Stage A 설치본에는
   `devDependencies.commitgate`가 없으므로(`REQ_DEV_DEPS`에 commitgate가 없다), 순서가 뒤집히면 Stage A 사용자가
   migrate 안내에 영원히 도달하지 못한다. 순서 회귀 테스트가 그것을 실제로 고정하는가?
2. **D14가 키 존재만 보는 것이 옳은가** — `npm i -D <tgz>`는 `"commitgate": "file:...tgz"`를 쓴다.
   값을 semver range로 검증하면 Phase 5 packed-tarball smoke가 스스로 실패한다. 이 완화가 정상 경로에 구멍을 만드는가?
   ((b)node_modules 존재·(c)realpath 동일성 제거로 **수용한 위험**은 [01-design.md](01-design.md) §5.1-1a에 표로 명시했다 — 비목표다.)
3. **D19 감지 조건에 정상 경로 누락이 있는가** — 정확한 `REQ_SCRIPTS` 값 **또는** `scripts/req/**` 존재.
   조용한 혼합 설치(vendored 런타임이 계속 도는데 사용자는 Stage B라 믿는 상태)를 실제로 막는가?
4. **무주입 전환이 기존 계약을 깨지 않는가** — `pkg.devDependencies` 재대입 제거, `lockfileRel`이 여전히 산출물인 것
   (근거가 "init 뒤 install"에서 "D14가 요구하는 init 앞 install"로 옮겨졌다), `crossSpawnBelowFloor`를 건드리지 않은 것
   (대상에 cross-spawn이 없으면 자동 무동작 — Stage B 재검토는 backlog).
5. **테스트가 실제로 증명하는가, 공허하지 않은가** — 특히 재-앵커한 단언들과 `installStageA` 시더가
   Stage A 레이아웃을 정확히 재현하는지(바이트 동일 판정이 성립해야 planner 분류 테스트가 유효하다).

## 이 리뷰에 요청하는 규율

이 티켓은 **범위 확장으로 30라운드 비수렴**했고, 그 축소안이 design-r21로 승인됐다.
[00-requirement.md](00-requirement.md) §4의 비목표(manifest·provenance·lockfile 파서·버전 완전 일치·realpath 동일성·
자동 재실행·failure injection·PnP 완전 지원)를 이번 범위로 되돌리는 지적은 `observations`로 부탁한다.
**Phase 3~5로 명시 배정된 것**(migrate 구현, uninstall의 Stage B 안내 조정, doctor 설치모드 진단, 문서·smoke)도 이 phase의 결함이 아니다.

이 프로젝트는 **하나의 활성 worktree와 협조적 작업자**만 지원한다. transactional backend가 있어야 가능한 절대 보장을 근거로 차단하지 마라.

**차단(`findings`)은 P1 — 정상 사용 경로에서 재현되는 요구 위반·데이터 손상·보안 구멍·fail-closed 우회 — 만.**
각 P1에는 **해당 인수 기준·재현 경로·실패 결과**를 함께 적어 달라. 그 외는 `observations`로.
