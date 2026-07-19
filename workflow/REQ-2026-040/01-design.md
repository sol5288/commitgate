# REQ-2026-040 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

- `templates/CLAUDE.template.md`·`AGENTS.template.md` — quickstart 블록 SSOT(마커
  `<!-- commitgate:quickstart -->`…`<!-- /commitgate:quickstart -->`). 두 블록은 바이트 동일(REQ-039).
- `bin/init.ts` — CLAUDE.md/AGENTS.md는 **부재 시에만** 생성(seed-once). confinement=`statWritableDest`.
- `bin/sync.ts` — **whole-file copy** 모델(`copyFileSync` + sha 비교). AssetStatus/plan/apply 구조 +
  packageRoot 거부 + `assertGitWorkTree`. **블록 병합 아님**.
- `scripts/req/req-doctor.ts` — D2~D20. D20=자산 skew content-hash WARN, dev/dogfood skip.
- `bin/dispatch.mjs` — verb 라우팅(init/sync/migrate/uninstall).

## 핵심 설계 결정

### D1. 명령 = **새 verb `commitgate quickstart`** (sync 확장 아님)
sync는 whole-file copy 모델이라 **블록 병합과 메커니즘이 다르다**(copyFileSync vs read-merge-write).
sync에 병합 경로를 끼우면 정체성이 흐려진다. 별도 verb로 분리한다:
- `commitgate quickstart [--dir <repo>]` — plan(dry-run, 기본).
- `commitgate quickstart --apply` — 주입.
- `bin/dispatch.mjs`에 등록. sync의 CLI/guard 관례(동기 `runCli`, packageRoot 거부, `assertGitWorkTree`) 재사용.
- **대안(기각)**: `sync --quickstart`. 사용자 선택지 "sync 주입"의 정신(opt-in 멱등 주입)은 충족하되,
  copy축과 merge축을 한 명령에 섞지 않는다. doctor WARN·README가 이 verb를 가리킨다.

### D2. 주입 알고리즘 (순수 함수)
- `extractQuickstartBlock(templateBody)` → 마커 포함 SSOT 블록(패키지의 `templates/CLAUDE.template.md`에서).
- `injectQuickstart(fileContent, block)` → `{ content, action: 'noop'|'updated'|'inserted' }`:
  - 마커 쌍 존재 & (줄바꿈 정규화 후) 동일 → **noop**.
  - 마커 쌍 존재 & 다름 → 그 영역만 block으로 **in-place 치환**(updated). 블록 밖 불변.
  - 마커 없음 → **삽입**(inserted). 위치 규칙(계획에 명시):
    - 최상단이 top-level `# heading`이면 그 **바로 뒤**(제목이 첫 줄 유지) — `insertAt: 'after-heading'`.
    - 제목이 **없으면 파일 맨 앞**에 삽입(user 결정 — 거부·맨 뒤 아님) — `insertAt: 'top'`.
    - 앞뒤 빈 줄로 분리. `insertAt`을 반환해 plan이 위치를 보여 준다.
  - 블록 밖 내용은 바이트 보존. 줄바꿈은 REQ-039 교훈대로 정규화 후 비교(멱등 판정 안정).

### D3. 대상 파일 + AGENTS 계약 조건
- `CLAUDE.md`: 존재하면 대상.
- `AGENTS.md`: **`<!-- commitgate:contract -->` 마커가 있을 때만** 대상. 없으면 skip(계약 아님).
- 부재 파일: 미접촉(init 소관).

### D4. 안전 (confinement·guard 재사용)
- 모든 쓰기 dest는 `statWritableDest(targetRoot, rel)` 경유(symlink-escape 거부, 재구현 금지).
- `targetRoot===PACKAGE_ROOT` 하드 거부(canonical 비교 — sync와 동일).
- plan by default, `--apply`에서만 write. apply 직전 confinement 재검증(TOCTOU 최소화).
- 쓰기는 read→merge→`writeFileSync`(copy 아님). 마커 밖 보존을 테스트로 고정.

### D5. doctor D21 (WARN)
- 소비 repo의 `CLAUDE.md`(존재) 또는 `AGENTS.md`(존재 & 계약 마커)에서 quickstart 블록 부재 → **WARN** +
  `commitgate quickstart --apply` 안내.
- **FAIL 아님**. dev/dogfood(`packageRoot===config root`)는 D20처럼 skip(이 repo엔 root CLAUDE/AGENTS.md 없음).
- 블록 존재 판정은 마커만 본다(내용 최신성은 verb의 몫 — doctor는 부재만).

### D6. plan(dry-run) 출력 계약
`commitgate quickstart`(--apply 없음)는 **아무것도 쓰지 않고**(user 안전장치), 파일별로 보여 준다:
- 대상 경로(`CLAUDE.md`·`AGENTS.md`)와 **작업 종류**: `noop`(이미 최신) / `replace`(블록 상이 → in-place
  치환) / `insert`(블록 없음 → 삽입) / `skip`(부재·계약마커 없는 AGENTS.md 등, **사유 표기**).
- `insert`면 **삽입 위치**(`# 제목 뒤` | `파일 맨 앞`)를 함께.
- 하단에 **"--apply 전에는 쓰지 않는다"** 명시 + 적용 명령 안내. `--apply`면 쓴 파일 목록·`git diff` 안내.
- 최소 계약 = **경로 + 작업 종류 + (insert 시)위치**. 가능하면 변경 블록 diff까지. `sync`의 `renderPlan`
  관례(shell 연산자 미사용·glyph·plan/apply 분기)를 재사용한다.

## Phase별 구현

- **phase-1**: 순수 주입 lib(`extractQuickstartBlock`·`injectQuickstart`) + 단위 테스트.
- **phase-2**: `quickstart` verb(plan/apply·confinement·packageRoot 거부) + dispatch 등록 + doctor D21 WARN
  + README 업그레이드 절 + CHANGELOG + 통합 테스트(temp dir). 상세는 02-plan.

## 변경 파일

- `bin/quickstart.ts` (신규 — verb + 순수 lib, 또는 lib 분리)
- `bin/dispatch.mjs` (verb 등록)
- `scripts/req/req-doctor.ts` (D21 WARN)
- `tests/unit/…` (주입 lib 단위 + verb/doctor 통합)
- `README.md`·`README.en.md` (업그레이드/명령 절에 `quickstart`)
- `CHANGELOG.md` (Unreleased)

## 하위호환·안전

- **순수 추가**(신규 verb + WARN-only D-check). 기존 명령·동작·게이트 무변경. 기존 설치본 무영향.
- opt-in: 아무것도 자동으로 쓰지 않는다. plan이 기본.
- 관리-블록 경계로 seed-once 규율 유지 — 유저 내용 불가침.
- risk HIGH: 소비 repo의 유저 파일에 쓰는 런타임이므로 매 phase 사람 확인.
