# REQ-2026-014 리뷰 요청 (phase-5-docs-smoke) — 마지막 phase

## 배경

Stage B 전환의 마지막 phase다. 설계는 design-r21 승인(findings 0건), Phase 1~4는 각각 findings 0건으로 승인·커밋됐다
(`95d94b8` dispatch · `46b740e` Stage B init · `e141ac3` migrate/uninstall · `ef59904` doctor D19).

이 phase는 **문서를 구현과 일치시키고**, packed tarball로 **Stage B 인수 기준을 실증**한다.

## 변경 요약 (staged diff = 4파일)

**`scripts/smoke.mjs`** — 기존 하네스에 **추가만** 했다(새 하네스 없음). 이미 `npm pack` → 임시 git target →
`npm i -D <tgz>` → 실제 init → uninstall 을 하던 흐름의 **실제 init 뒤, uninstall 앞**에 Stage B 증명을 넣었다:

- (a) **무복사**: 대상에 `scripts/req/` 부재.
- (b) **무주입**: 대상 `package.json`의 devDependencies/dependencies에 `tsx`·`ajv`·`cross-spawn` 부재.
  (사용자가 설치한 `devDependencies.commitgate` 선언은 남아 있어야 한다 — init D14 전제.)
- (c) **`req:*` = `commitgate <verb>`**: 검증 목록을 하드코딩하지 않고 **`bin/dispatch.mjs`의 `VERB_MODULES`에서 파생**
  (`req:` 접두 필터) → SSOT 1개. verb가 누락되면 smoke가 잡는다.
- (d) **실제 dispatch 도달 증명**: `npm run req:doctor` → **exit≠0 + req-doctor 자신의 사용법 오류**를 단언한다.
  > ⚠️ 이것은 "doctor가 통과한다"가 아니라 **"dispatch가 도달한다"** 는 증명이다. **fresh·티켓 없는 대상에서 rc=0으로
  > 끝나는 `req:*` verb는 하나도 없다**(new=clean tree 필요, next/doctor=티켓 필요, commit=승인 필요, review-codex=live Codex 필요).
  > 그래서 성공 종료가 아니라 **도달**로 증명한다. 이 한 번이 사슬 전체를 덮는다: npm script → `.bin/commitgate` 해소 →
  > launcher가 tsx 등록 → **패키지 안의** `scripts/req/req-doctor.ts`로 라우팅 → 그 모듈의 `parseArgs` 실행.
  > 판별력: 미등록 verb면 launcher의 "알 수 없는 명령", bin 해소 실패면 npm의 "not found" — 셋은 서로 다른 메시지다.
- **uninstall 읽기 전용**: 실행 전후 대상 tree snapshot 동일 단언.
- **migrate 비파괴**: **별도 Stage A 시드 대상**에서 dry-run 무부작용 + `--apply` exact-match 전환·사용자 값·vendored 파일 보존.
  (기존 fresh 대상에 겹쳐 쓰지 않는다 — Stage A 서명이 생기면 init D19가 발동해 다른 것을 검증하게 된다.)
- 🔴 **npm 캐시 격리**: 기존 smoke의 `npm pack`/`npm install`/`npx`가 **개발자의 실제 npm 캐시를 건드리고 있었다**.
  이 저장소 규약(REQ-2026-009)은 격리된 `npm_config_cache`를 요구한다 — 이 파일을 수정하는 김에 일회용 캐시를 주입하고 finally에서 지운다.
- 기존 단언(`workflow/.gitignore` 존재 + check-ignore 효과)은 Stage A 비의존이라 **그대로 뒀다**.
- **vitest에 넣지 않았다**: `vitest.config.ts`에 testTimeout이 없어 기본 5000ms이고 `npm pack`+`npm install`은 초과한다.
  smoke는 이미 `npm test` 밖 + CI 별도 스텝이다.

**`bin/init.ts`(help만)** — 선행 `npm install -D commitgate` 명시, `migrate` verb 추가, "설치하는 것/하지 않는 것" 명시,
`--strict` 설명을 실제 동작(cross-spawn 전용이 아님)에 맞춤.

**`README.md` / `README.en.md`** — 2단계 설치(`npm i -D commitgate` → `npx commitgate init`)와 "왜 두 단계인가",
설치 표에서 `scripts/req/`·devDeps 제거 + **"설치하지 않는 것"** 표 신설, `migrate` 절 신설, **지원 범위** 표
(npm 완전지원 / pnpm·yarn node_modules linker / **Yarn PnP 미지원** / workspace root만) + lockfile 커밋 권고,
제거 절에 `npm uninstall -D commitgate` 추가, 명령어 요약 갱신, "현재 범위"를 런타임 패키지 모델로 정정
(기존 "Stage A: vendored scaffold 모델" 문장은 이제 거짓이었다).

## 검증 결과

- `npm run typecheck` → 0
- `npm test` → **17파일 / 925 전부 통과**(Phase 4와 동일 — 이 phase는 문서·smoke라 unit 증감 없음).
- `npm run smoke` → **rc=0**. 실제 packed tarball 설치본에서 위 (a)~(d)·uninstall 읽기 전용·migrate 비파괴가 전부 통과한다.
- CLI help 실측(`node bin/commitgate.mjs --help`, `... migrate --help`)이 구현과 일치.

## 리뷰 포인트 (하한이지 상한이 아님)

1. **(d) 도달 증명이 정당한 검증인가** — rc≠0을 기대하는 단언이 "통과했다"로 오해될 여지가 없는가?
   세 오류 메시지(모듈 사용법 / launcher 미지 verb / npm not found)가 실제로 구분되는가?
   더 나은 방식이 이번 범위에서 가능한가?(티켓 fixture 생성은 git 신원·커밋·브랜치를 smoke에 얹어야 해 backlog로 뒀다)
2. **smoke가 Stage B 인수 기준을 실제로 덮는가** — R1/R2/R3/R4/R5 중 빠진 것이 있는가?
   (c)의 VERB_MODULES 파생이 하드코딩보다 나은가, 아니면 dispatch 변경 시 smoke가 조용히 약해지는가?
2. **문서가 구현과 일치하는가** — 특히 `--strict` 설명, "설치하지 않는 것" 표, 지원 범위 표(PnP 미지원 선언),
   `migrate` 절. 사용자가 README대로 했을 때 실제로 동작하는가?
3. **npm 캐시 격리가 올바른가** — `npm_config_cache` 주입이 모든 npm/npx 호출에 걸리는가?
4. **migrate smoke가 별도 대상을 쓰는 것이 옳은가** — 기존 fresh 대상 재사용이 왜 안 되는지(init D19 발동) 판단이 맞는가?

## 이 리뷰에 요청하는 규율

[00-requirement.md](00-requirement.md) §4의 비목표(manifest·provenance·lockfile 파서·버전 드리프트 탐지·
realpath 동일성·PnP 완전 지원·nested workspace 전 형태·failure injection)를 되돌리는 지적은 `observations`로 부탁한다.
**SSOT 문서 동기화**(`docs/ssot-design/`의 `D2~D18` 문자열 등)는 이 저장소 관례상 **티켓 종료 후 별도 `docs(ssot):` 커밋**이며
([02-plan.md](02-plan.md) "티켓 종료 후 후속" 참조 — REQ-2026-018도 finalize 뒤에 했다) 이 phase의 결함이 아니다.

이 프로젝트는 **하나의 활성 worktree와 협조적 작업자**만 지원한다.

**차단(`findings`)은 P1 — 정상 사용 경로에서 재현되는 요구 위반·데이터 손상·보안 구멍·fail-closed 우회 — 만.**
각 P1에는 **해당 인수 기준·재현 경로·실패 결과**를 함께 적어 달라. 그 외는 `observations`로.
