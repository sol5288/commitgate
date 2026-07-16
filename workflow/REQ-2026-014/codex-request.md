# REQ-2026-014 리뷰 요청 (phase-3-uninstall-migrate)

## 배경

설계는 design-r21에서 findings 0건 승인됐다(축소 범위 — [00-requirement.md](00-requirement.md) §4가 비목표를 명시 열거).
Phase 1(dispatch, `95d94b8`)·Phase 2(Stage B init, `46b740e`)는 각각 findings 0건으로 승인·커밋됐다.

이 phase는 **비파괴 전환 경로**를 완성한다: `commitgate migrate` 신설 + verb 등록 + uninstall의 Stage B 런타임 제거 안내.

## 변경 요약 (staged diff = 6파일)

**신규 `bin/migrate.ts`** — 계약은 하나다: `package.json`의 `req:*` 중 **현재 값이 정확히 Stage A 주입값인 키만**
`commitgate <verb>`로 바꾼다.

- **기본 dry-run**(쓰기 0건). `--apply`에서만 **`package.json` 한 파일**을 쓴다 → 다중 파일 rollback 프레임워크 불필요(D11 제거와 일관).
- **비파괴**: `scripts/req/**`·schema·persona·config·진입점·`workflow/REQ-*` 증거를 **삭제하지 않는다**. 안내만 한다.
- **사용자 정의 값 미덮어씀**: 바이트 정확 일치가 아니면 보존 + 수동 조치 안내.
- **`--apply` 전 `devDependencies.commitgate` 키 존재만 확인**(init D14와 같은 축소 규칙 — 값 형태 검증 없음).
- **동기(sync) 구현**: launcher가 `runCli`를 await하지 않는다(기존 7개 runCli 전부 sync `void`) — async면 promise가 버려져 exit code가 소실된다.
- **대상 root는 `--dir`(기본 cwd)로만 해소** — `resolveRoot`는 config 부재 시 **패키지 자신의 root**를 반환하므로,
  package.json을 쓰는 이 명령이 그 fallback을 타면 CommitGate 자신의 package.json을 재작성한다. init/uninstall과 같은 방식.
- exact-match 판정은 `REQ_SCRIPTS`를 `./init`에서 직접 import(= `bin/uninstall.ts:295`의 `cur === injected`와 같은 계약, SSOT 1개).

**`bin/dispatch.mjs`** — `migrate` verb 1줄 등록(파일 생성과 **동시**).
**`tests/unit/dispatch.test.ts`** — Phase 1이 심어 둔 **의도된 tripwire**(`'migrate' in VERB_MODULES === false`)를 등록과 함께 갱신.
Phase 1 회귀가 아니라 Phase 1이 설계한 전이다. 오타 fail-closed 커버리지는 `migrat`로 유지.

**`bin/uninstall.ts`** — Stage B 안내 조정만. **삭제 기능을 추가하지 않았다.**
- `facts.commitgateDevDependency`(선언값 표시, 진단용) 추가 → 선언이 있으면 `npm uninstall -D commitgate` 안내, 없으면 "Stage B 런타임 아님" 표시.
- 🔴 **안내는 문자열 출력만 — npm을 spawn하지 않는다.** 파일 헤더가 그 절을 선언하지만 **테스트로 고정돼 있지 않았고**,
  런타임 제거 안내를 다루는 이 phase가 바로 spawn 유혹이 생기는 지점이라 **구조적 불변식 테스트를 추가**했다
  (`child_process` import 금지 + `execFileSync`/`execSync`/`spawnSync`/`spawn(` 부재). `spawn`·`exec` 단어 자체는
  금지하지 않는다 — 주석·`cross-spawn` 문자열·GitAdapter의 `git.exec`가 정당하게 쓴다).
- vendored `scripts/req/**` 분류 로직은 **유지**한다 — uninstall의 실제 대상이 기존 Stage A 프로젝트다.

## 검증 결과 (리뷰 샌드박스는 read-only라 vitest를 못 돌리므로 이쪽 증거를 제시한다)

- `npm run typecheck` → 0
- `npm test` → **17파일 / 908 테스트 전부 통과**(Phase 2 시점 879 + 신규 29).
- **실제 CLI end-to-end 확인**(테스트가 아니라 진짜 dispatch 경유, `node bin/commitgate.mjs migrate`):
  Stage A fixture(`req:new`=Stage A값 · `req:doctor`="echo MY-CUSTOM" · `build`="tsc" · vendored `scripts/req/`)에서
  → dry-run: 쓰기 0건 · `--apply`: `req:new`만 전환, `req:doctor`·`build`·vendored 파일 전부 보존 · `migrat`: fail-closed.
- migrate 비파괴 회귀는 **전후 sha256 snapshot 전수 비교**로 고정했다(바뀐 파일 = `package.json` 하나, 삭제 0건).

## 리뷰 포인트 (하한이지 상한이 아님)

1. **exact-match 전환이 실제로 사용자 값을 보호하는가** — 한 글자 차이(`REQ_SCRIPTS 값 + " "`)도 custom으로 판정하는가?
   정상 경로에서 사용자 script를 덮어쓰는 경로가 남아 있는가?
2. **비파괴 계약이 코드로 성립하는가** — `bin/migrate.ts`에 삭제 API가 없는가? snapshot 회귀가 그것을 실제로 증명하는가?
3. **`--dir`만 쓰는 결정이 옳은가** — `resolveRoot` fallback(패키지 root 반환)을 피하려는 것이다. `--dir` 없이 cwd 기본이
   Stage B 정상 경로를 막지 않는가?
4. **uninstall의 읽기 전용 불변식이 여전히 성립하는가** — 새 안내가 실행으로 새지 않는가? 새 `commitgateDevDependency`
   facts가 삭제 근거로 오용될 여지가 있는가?
5. **dispatch tripwire 갱신이 Phase 1 계약을 훼손하지 않는가** — `migrate` 등록 외에 라우팅 규칙(D3)이 바뀌지 않았는가?

## 이 리뷰에 요청하는 규율

[00-requirement.md](00-requirement.md) §4의 비목표(manifest·provenance·lockfile 파서·버전 완전 일치·realpath 동일성·
자동 재실행·failure injection·PnP 완전 지원·nested workspace 전 형태)를 이번 범위로 되돌리는 지적은 `observations`로 부탁한다.
**Phase 4~5로 명시 배정된 것**(doctor 설치모드 진단 D19, README/CLI help, packed-tarball smoke)도 이 phase의 결함이 아니다.

이 프로젝트는 **하나의 활성 worktree와 협조적 작업자**만 지원한다. transactional backend가 있어야 가능한 절대 보장을 근거로 차단하지 마라.

**차단(`findings`)은 P1 — 정상 사용 경로에서 재현되는 요구 위반·데이터 손상·보안 구멍·fail-closed 우회 — 만.**
각 P1에는 **해당 인수 기준·재현 경로·실패 결과**를 함께 적어 달라. 그 외는 `observations`로.
