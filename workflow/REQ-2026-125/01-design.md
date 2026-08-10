# REQ-2026-125 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

| 사실 | 위치 | 확인 |
|---|---|---|
| gitignore 백필 경고가 `--apply` 없는 명령 제시(dry-run이라 무효) | `bin/verify-range.ts:368` | 실측 |
| 0.21.0 업그레이드 안내 2곳 동일 결함 | `CHANGELOG.md:17`·`:76` | 실측 |
| 인벤토리 표 "sync 소유자" 열이 `sync --gitignore` 표기 | `docs/troubleshooting.md:236-239`·`.en.md:232-235` | 실측 |
| doctor D22 안내는 `--gitignore --apply`로 이미 올바름(표면 간 불일치) | `scripts/req/req-doctor.ts:820-826` | 실측 |
| `--github-ci`는 check-runs 1회 조회뿐 — dispatch 없음 | `bin/verify-range.ts:114-130` | 실측 |
| `CI_PROMPT`가 "실행하시겠습니까? 비용 또는 사용량…" | `bin/verify-range.ts:135` | 실측 |
| 문서가 그 문구를 축자 인용 | `docs/workflow.md:75`·`.en.md:78` | 실측 |
| 테스트가 CI_PROMPT 내용 단언 | `tests/unit/verify-range-cli.test.ts:134-136` | 실측 |
| upgrade 문서에 0.22 절 없음(마지막 절은 0.20 이하) | `docs/upgrade.md`·`.en.md` | 실측 |

## 핵심 설계 결정

### DEC-1 · 백필 안내 가드는 "줄 단위 동반" 규칙 (도구 위임 아닌 고정 규칙 최소형)

순수 함수 `syncGuidanceViolations(lines: string[]): number[]` — `sync --gitignore`를 포함하면서
같은 줄에 `--apply`가 없는 줄 번호를 반환. 스캔 대상은 고정 목록:
`bin/**/*.ts` · `scripts/**/*.ts` · `docs/**/*.md`(재귀 — `ssot-design/` 포함, 양언어) ·
`README.md`/`README.en.md` · `templates/**` · `CHANGELOG.md`. **`workflow/`·`node_modules/`·`tests/` 제외**
(티켓 문서는 감사 기록, 테스트는 위반 문자열을 fixture로 쓸 수 있어야 함).
과거 CHANGELOG의 `sync --gitignore [--apply]`는 같은 줄에 `--apply`가 있어 통과 —
사전 확인으로 기존 트리 위양성 0건을 보장한다.
일반 문서 스캐너로 키우지 않는다(REQ-2026-044 폐기 전례) — 규칙 하나·패턴 하나.

### DEC-2 · CI 옵션 어휘: `check`(조회) / `run`(실행 — 후속 REQ) 접두

- 정식: `--check-github-ci` / `--no-check-github-ci`. 내부 의미는 기존과 동일(조회 opt-in).
- alias: `--github-ci` → `--check-github-ci` 취급, `--no-github-ci` → `--no-check-github-ci` 취급.
  **둘 다** 사용 시 stderr deprecation 1줄을 낸다
  (`⚠️ --github-ci/--no-github-ci 는 --check-github-ci/--no-check-github-ci 로 이름이 바뀌었습니다(동작 동일 — 기존 결과 조회). 다음 릴리스에서 제거될 수 있습니다`).
  충돌 검사(긍정+부정 동시 지정 throw)는 alias 해석 **후** 수행.
- `CI_PROMPT` → `'기존 GitHub CI 결과를 조회하시겠습니까? 워크플로를 실행하지 않습니다(GitHub API 조회 1회). [y/N] '`
- `VerifyRunRow.ci` 값 4종 불변(로그 하위호환). `parseArgs` 반환 필드명 `githubCi`도 내부라 유지.
- 실행 축(`--run-github-ci`)은 이 REQ에서 만들지 않는다 — 이름만 예약(충돌 없는 어휘 확정).

### DEC-3 · upgrade 0.22 절은 "이 시점에 참인 것"만

`docs/upgrade.md` "버전별 주의사항" 최상단에 `### 0.20/0.21 → 0.22` 절 신설(en 동일).
내용: caret 특성 → 권장 명령 4줄(`npm install -D commitgate@^0.22.0` → `sync --apply --gitignore`
→ `check` → `report`) → lockfile 동반 갱신 확인 → 0.21.0 유래 변경(secretScan 기본 block ·
D31 WARN 전용 · `.verify-runs.jsonl` 신설·gitignored) → GitHub CI는 선택(기본 미실행·조회도 opt-in)
→ 기존 로그 하위호환(스키마 additive) → rollback(`npm install -D commitgate@0.20.0`, 자산 미접촉 —
새 로그 파일은 구버전이 무시) → 소비자 파일 자동 덮어쓰기 없음(sync/quickstart는 opt-in·관리 블록만).
0.22 신설 기능의 서술은 각 후속 REQ가 자기 절에 덧붙인다(미구현 선서술 금지).

## Phase별 구현

**Phase 1 (`phase-1-sync-apply-guidance`)** — `bin/verify-range.ts:368` 문자열 정정 ·
`CHANGELOG.md` 0.21.0 안내 2곳 정정 · troubleshooting 표 8행 정정(ko/en) ·
`scripts/req/lib/sync-guidance.ts` 신규(순수 규칙) + `tests/unit/sync-guidance-claims.test.ts`
(규칙 단위 테스트 양방향 + 실제 트리 스캔 0건).

**Phase 2 (`phase-2-ci-query-terms`)** — `bin/verify-range.ts` 옵션 alias·CI_PROMPT·help·헤더 주석 ·
`bin/init.ts` HELP_TEXT 1행 · `docs/workflow.md`/`.en.md` 인용부 · `docs/ssot-design/14` 옵션명 갱신 ·
`tests/unit/verify-range-cli.test.ts` 갱신(+alias·deprecation 테스트).

**Phase 3 (`phase-3-upgrade-docs`)** — `docs/upgrade.md`/`.en.md` 0.22 절 · `CHANGELOG.md` Unreleased 항목.

## 변경 파일

| 파일 | 변경 | phase |
|---|---|---|
| `bin/verify-range.ts` | 경고 문자열(1) · 옵션/문구/help(2) | 1·2 |
| `CHANGELOG.md` | 0.21.0 안내 정정(1) · Unreleased(3) | 1·3 |
| `docs/troubleshooting.md`/`.en.md` | 표 정정 | 1 |
| `scripts/req/lib/sync-guidance.ts` | 신규 — 순수 규칙 | 1 |
| `tests/unit/sync-guidance-claims.test.ts` | 신규 — 가드 | 1 |
| `bin/init.ts` | HELP_TEXT 1행 | 2 |
| `docs/workflow.md`/`.en.md` | 인용부·옵션명 | 2 |
| `docs/ssot-design/14-product-strategy-and-roadmap.md` | 옵션명 1행 | 2 |
| `tests/unit/verify-range-cli.test.ts` | 프롬프트·alias 단언 | 2 |
| `docs/upgrade.md`/`.en.md` | 0.22 절 | 3 |

## 테스트 oracle (완료 기준 ↔ 검증)

| 완료 기준 | 오라클 | 잡는 결함 |
|---|---|---|
| 1·2 | `syncGuidanceViolations` 단위(위반 문자열→검출·`[--apply]` 줄→통과) + 실제 트리 스캔 0건 | `--apply` 없는 안내 재등장 |
| 3 | parseArgs: `--check-github-ci`→true·`--github-ci`→true+deprecation·`--no-github-ci`→false+deprecation·동시 지정 throw(alias 교차 포함) | 조용한 의미 변경·alias 누락·부정형 무안내 |
| 4 | CI_PROMPT에 `'조회'`·`'실행하지 않'` 포함, `'[y/N]'` 유지 | 실행 오해 문구 회귀 |
| 5 | `docs:lint` 통과(링크) + upgrade 절 존재는 문서 리뷰로 확인 | 링크 깨짐 |

## 하위호환·안전

- alias 유지로 기존 스크립트 무중단. 로그 스키마·exit 계약 불변.
- 문서·문자열 변경만이므로 revert로 완전 복구.
