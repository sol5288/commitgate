# REQ-2026-047 설계 — review-call 로그 배포 gitignore 누락 수정 (P0)

> 정본: 코덱스 판정·지시(확정·P0). 본 문서는 그 지시를 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

- **`templates/workflow.gitignore`** — 비주석 3행뿐: `/REQ-*/codex-response.json`, `/REQ-*/.review-preview.txt`, `/REQ-*/.codex-*.tmp`. `init`이 `KIT_GITIGNORE = {src:'templates/workflow.gitignore', dest:'workflow/.gitignore'}`로 복사하며 **seed-once**(부재 시에만 생성, `--force`로도 미덮어씀 — 설계 D12).
- **`.gitignore:16`** — `workflow/.review-calls.jsonl`. **개발 저장소 전용**이며 npm이 `.gitignore` 이름을 tarball에서 제외하므로 소비자에 배포되지 않는다.
- **`scripts/req/review-codex.ts:549·656-660·2082`** — `REVIEW_CALL_LOG_REL='workflow/.review-calls.jsonl'`, `appendReviewCallLog(cfg.root, …)`가 **소비자 저장소 루트**에 리뷰마다 append(실패는 삼킴, R8).
- **`scripts/req/lib/scratch.ts:32`** — `reviewScratchPaths`는 티켓 스코프 3경로만. 이 로그는 repo-root라 매칭되지 않아 **오직 gitignore만이 D10에서 숨길 수 있다**.
- **`scripts/smoke.mjs` 4b(:115-124)** — packed tarball → 실제 `init` → `workflow/.gitignore` 존재 확인 → `git check-ignore -q -- workflow/REQ-2026-001/codex-response.json`. :102-106에서 전역 `core.excludesFile`을 차단해 **hermetic**(전역 ignore가 kit 규칙 누락을 가리지 못하게 — phase-2 리뷰 P3).
- **`bin/sync.ts`(269줄)** — `planSync(targetRoot, cfg, persona)` → `SyncPlan`(자산 단위 `AssetStatus`), `parseArgs`가 `--apply`/`--dry-run`/`--persona`/`--dir` 처리. 기본은 dry-run(쓰기 0건).
- **`scripts/req/req-doctor.ts`** — 현재 체크 D2·D3·D5·D6·D9·D10·D11·D13·D15·D16·D17·D18·D19·D20·D21. D19/D20/D21은 **WARN 상한**(FAIL이면 소비자 커밋 벽돌).

## 핵심 설계 결정

### DEC-1 — 패턴은 앵커형 `/.review-calls.jsonl` (정본)
`templates/workflow.gitignore`에 **`/.review-calls.jsonl`** 1행 추가. root `.gitignore`의 `workflow/.review-calls.jsonl` 형태를 **복사하지 않는다** — 이 파일은 `workflow/`에 설치되는 **중첩 gitignore**라 패턴이 그 디렉터리 기준 상대경로이고, root 형태는 `workflow/workflow/…`를 찾아 **무효**다(파일 자신의 헤더 경고와 동일 함정, `git check-ignore` 실측으로 확인). 기존 `/REQ-*/…` 앵커 관례와도 일치.

### DEC-2 — 회귀 가드는 tarball smoke 확장(문자열 비교 금지)
템플릿 **내용을 문자열로 단언하지 않는다**. gitignore 시맨틱을 재구현하면 DEC-1의 함정(root 형태)을 통과시켜 버릴 수 있다. 대신 **이미 존재하는 소비자 경로**인 `scripts/smoke.mjs` 4b를 확장한다: 실제 `init` 산출물에서 `workflow/.review-calls.jsonl`을 만든 뒤 **`git check-ignore`가 성공하는지** 단언. :102-106의 hermetic 전역-ignore 차단을 그대로 상속하므로 "global ignore 환경" 축이 함께 고정된다. `npm pack`의 dot-basename 제외처럼 **tgz 설치본에서만 드러나는 축**이 이 경로의 존재 이유다.

### DEC-3 — `reviewScratchPaths` 무변경 (명시적 기각)
이 로그를 D10 스크래치 허용목록에 넣지 **않는다**. 넣으면 D10이 배포 ignore 누락 자체를 숨겨, 같은 결함이 다음에 발생해도 아무도 모른다. D10의 스크래치 의미론은 이 REQ에서 **바이트 단위로 불변**이다.

### DEC-4 — 백필은 기본 sync 무변경 + opt-in `--gitignore`
`workflow/.gitignore`는 seed-once라 템플릿 수정만으론 **기존 설치본이 구제되지 않는다**. 그러나 이 파일은 git 관례상 **사용자 소유**이므로:
- **기본 `sync` 동작을 바꾸지 않는다.** 새 축은 명시적 opt-in `commitgate sync --gitignore [--apply]`에서만 동작한다(기존 `--persona`와 동형).
- 동작은 **additive append 전용**: kit 템플릿의 비주석 규칙 행 중 **대상 파일에 없는 행만** 말미에 덧붙인다. 기존 행을 수정·삭제·재정렬하지 **않는다**.
- 🔴 **존재 판정은 Git ignore 의미론을 보존한다 — 앞 공백을 제거하지 않는다.** gitignore(5)에서 **후행 공백은 무시되지만(백슬래시 이스케이프 제외) 앞 공백은 패턴의 일부**다. 따라서 정규화는 **후행 `\r`과 후행 공백만** 제거한 뒤 **정확 일치**로 판정하고, 앞 공백이 붙은 행(` /.review-calls.jsonl`)은 kit 규칙과 **다른 패턴**이므로 **누락으로 판정해 정확한 kit 규칙을 append**한다.
  - 근거(design r01 P1): 트림 비교로 판정하면 사용자가 앞 공백 행을 둔 소비자에서 "이미 존재"로 오판해 append를 건너뛰지만, Git은 그 파일을 ignore하지 않아 다음 review 뒤 **D10 FAIL이 그대로 재발**한다 — 완료기준(사용자 수정 gitignore 지원)·backfill matrix에 정면으로 반한다.
  - 방향은 **fail-safe**: 과(過)append는 무해(정확한 규칙이 추가되어 ignore가 성립)하고, 미(未)append는 P0 재발이다. 애매하면 append한다.
- **멱등**: 위 판정으로 동일 규칙이 이미 있으면 no-op — hermes처럼 **정확한 형태로** 수동 보강한 소비자는 중복 행이 생기지 않는다.
- **대상 파일 부재 시**: "모든 kit 규칙이 누락된 상태"로 취급해 **kit 템플릿 전체로 생성**한다(`--apply`에서만). init의 seed 동작과 일관되며, "누락 행만 append"의 경계 사례일 뿐 별도 의미론이 아니다.
- 기본 dry-run 유지 — `--apply` 없이는 쓰지 않는다.

### DEC-5 — doctor 신규 **D22는 WARN 전용** (FAIL 절대 금지)
"repo-root 런타임 스크래치 경로가 실질적으로 ignore되지도 tracked되지도 않음 → 다음 review 뒤 D10이 커밋을 막는다"를 **WARN**으로 알리고 `commitgate sync --gitignore --apply`를 안내한다.
🔴 **절대 FAIL이 아니다** — `req:commit`이 doctor를 exit≠0에 throw하는 하드 게이트로 spawn하므로 FAIL이면 소비자 커밋이 벽돌이 된다(D19:425-428·D20:443-447·D21의 동일 근거). 또한 이 드리프트는 **이미** 하드 D10 FAIL로 발현 중이므로 신규 진단이 차단을 **만드는 것이 아니라**, 불투명한 `D10: unstaged/untracked workflow/.review-calls.jsonl`을 행동 가능한 안내로 **번역**하는 역할이다. D20/D21과 동일하게 dev repo/dogfood(`packageRootDiffers===false`)에서는 skip.

### DEC-6 — 인벤토리 표는 문서 + smoke로 고정
런타임 생성 파일 전수를 **생성 위치 / ignore 정책 / init 배포 자산 / sync 소유자 / Git 영속 여부** 5열 표로 문서화한다(docs). 표가 프로즈로만 남으면 다시 드리프트하므로, **repo-root 스크래치 축은 DEC-2의 smoke 단언으로 실측 고정**한다(현재 축 = `workflow/.review-calls.jsonl` 1건).

**유지 규칙(인벤토리 문서에 명시)**: 새 repo-root 런타임 생성 파일을 이 표에 추가할 때는 **대응하는 packed-consumer smoke 단언(`git check-ignore`)도 함께 추가**해야 한다. smoke는 경로별 단언이라 자동으로 새 파일을 덮지 않는다 — 이 한계를 표 옆에 명문화해 드리프트 방지 의도를 코드가 아니라 문서에서 붙잡는다.

## Phase별 구현

- **phase-1-template-and-smoke** — DEC-1 + DEC-2. 템플릿 1행 + smoke 4b 확장. **이것만으로 신규 init 소비자의 P0가 해소**된다.
- **phase-2-sync-gitignore** — DEC-4. `bin/sync.ts`에 `--gitignore` 축(plan/render/apply) + 단위 테스트(멱등·사용자 행 보존·누락 행만 append·기본 동작 불변).
- **phase-3-doctor-warn-and-docs** — DEC-5 + DEC-6. doctor D22(WARN) + 테스트, 인벤토리 표 문서, CHANGELOG, 패치 버전(0.9.6 → 0.9.7).

## 변경 파일

| Phase | 파일 |
|---|---|
| 1 | `templates/workflow.gitignore` · `scripts/smoke.mjs` |
| 2 | `bin/sync.ts` · `tests/unit/sync.test.ts` |
| 3 | `scripts/req/req-doctor.ts` · `tests/unit/req-doctor.test.ts` · `docs/*`(인벤토리 표·troubleshooting) · `CHANGELOG.md` · `package.json`(버전) |

각 phase 코드 변경 ≤8파일(D18 권고 충족).

## 하위호환·안전

- **템플릿 추가는 신규 init에만 영향** — seed-once라 기존 소비자의 `workflow/.gitignore`를 건드리지 않는다. 기존 설치본은 phase-2의 opt-in 백필로만 바뀐다.
- **기본 `sync` 동작 불변** → 현재 sync를 쓰는 소비자에게 영향 0. 새 동작은 `--gitignore`를 명시해야만 발동.
- **D10/`reviewScratchPaths` 의미론 불변**(DEC-3) → 클린트리 판정에 변화 없음.
- **신규 D22는 WARN 상한** → 어떤 소비자 커밋도 차단하지 않는다. dev repo에서는 skip.
- 이미 수동 보강한 소비자(hermes)는 DEC-4 멱등성으로 **중복 행 없이 no-op**.
- 이미 로그를 커밋해 tracked가 된 소비자는 ignore 행만으론 해소되지 않는다(`git rm --cached` 필요) — troubleshooting 문서에 명시(코드 변경 아님).
