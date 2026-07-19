# REQ-2026-040 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일
> 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님).

## Phase 1 — 순수 주입 lib (`phase-1-inject-lib`)

범위(≤3 파일, Test-First — 이 REQ의 subtle한 핵심):
1. **Red** — `tests/unit/`에 주입 lib 테스트:
   - `extractQuickstartBlock`: 템플릿에서 마커 포함 블록 추출(부재 시 null).
   - `injectQuickstart` 케이스: (a) 마커 없음 → 첫 heading 뒤 삽입(`inserted`), (b) 마커 있고 동일 →
     `noop`(줄바꿈 정규화 후), (c) 마커 있고 다름 → in-place 치환(`updated`), (d) 블록 밖 내용 바이트 보존,
     (e) heading 없는 파일 → 맨 앞 삽입.
2. **Green** — `bin/quickstart.ts`(또는 lib 모듈)에 두 순수 함수 구현.

Exit: `eslint 0` · `tsc --noEmit 0` · 단위 그린 · Codex phase 리뷰 승인.

## Phase 2 — verb + dispatch + doctor D21 + docs (`phase-2-verb-doctor`)

범위(≤6 파일):
1. **Red** — 통합 테스트:
   - `quickstart` verb: temp repo에 기존 CLAUDE.md(블록 없음) → plan은 쓰기 0건, `--apply`면 블록 주입·
     나머지 보존, 재실행 noop. AGENTS.md 계약 마커 有→주입/無→skip. 부재 파일 미접촉.
     `targetRoot===PACKAGE_ROOT` 거부. symlink dest 거부(confinement).
   - doctor D21: 기존 CLAUDE.md 블록 부재 → WARN(FAIL 아님). dev/dogfood skip.
2. **Green**:
   - `bin/quickstart.ts` — `runQuickstart`(plan/apply)·`parseArgs`·`runCli`(동기), `statWritableDest`·
     packageRoot 거부·`assertGitWorkTree` 재사용.
   - `bin/dispatch.mjs` — `quickstart` verb 등록.
   - `scripts/req/req-doctor.ts` — D21 WARN(부재 판정=마커, dev/dogfood skip).
3. `README.md`·`README.en.md` 업그레이드/명령 절에 `quickstart` 추가 + `CHANGELOG.md` Unreleased.

Exit: `eslint 0` · `tsc --noEmit 0` · 단위·통합 그린 · Codex phase 리뷰 승인.

## 완료

- 게이트 해당분(unit·typecheck·lint) 그린 · Codex 승인 · 사용자 main 머지(별도 통합 통제점).
- 릴리스(tag/publish/release)는 별도 통제점 — 이 REQ 밖.
