# REQ-2026-047 요구사항 — review-call 로그 배포 gitignore 누락 수정 (P0)

## 무엇을 / 왜

REQ-2026-025가 도입한 review-call 측정 로그 `workflow/.review-calls.jsonl`의 ignore 패턴이 **개발 저장소 자신의 root `.gitignore`(:16)에만** 들어가고, **소비자에게 배포되는 `templates/workflow.gitignore`에는 누락**됐다(`git log -S '.review-calls.jsonl' -- templates/workflow.gitignore` = 공집합; 템플릿 최종수정 `3003d36`가 REQ-025의 `c164208`보다 앞섬).

그 결과 `commitgate init`한 소비자가 리뷰를 **1회라도** 돌리면 로그가 `??`로 남아 **`req:doctor` D10이 FAIL**하고, `req:commit`이 doctor를 하드 게이트로 spawn하므로 **모든 커밋이 차단**된다. npm이 `.gitignore` 이름을 tarball에서 제외하므로 root ignore는 소비자에 전달되지 않으며, 개발 저장소는 그 root ignore가 파일을 숨겨 **도그푸딩이 구조적으로 이 결함을 못 본다**.

실측: 소비자 hermes(0.9.6)가 `workflow/.gitignore`에 `/.review-calls.jsonl`을 수동 보강해 우회 중. 코덱스 판정 = **확정·P0·즉시 수정 + 패치 릴리스**.

**경계 한 줄**: 이 REQ는 **배포 자산의 ignore 누락**을 고친다. D10의 스크래치 의미론은 바꾸지 않는다.

## 완료 기준 (검증 가능)

1. `templates/workflow.gitignore`가 `workflow/.review-calls.jsonl`을 무시한다. 패턴은 **앵커형 `/.review-calls.jsonl`** 이다 — root `.gitignore`의 `workflow/.review-calls.jsonl` 형태를 복사하지 않는다(중첩 gitignore에서 `workflow/workflow/…`를 찾아 무효).
2. 회귀 가드가 **문자열 비교가 아니라** 실제 소비자 경로로 고정된다: **packed tarball → 실제 `init` → `git check-ignore workflow/.review-calls.jsonl`**. 기존 `scripts/smoke.mjs`의 같은 경로를 확장한다.
3. `reviewScratchPaths`는 **변경하지 않는다**. 이 로그를 D10 스크래치에 넣으면 배포 ignore 누락 자체를 D10이 숨긴다.
4. 기존 설치본 백필: **기본 `sync` 동작을 바꾸지 않고**, 명시적 opt-in `commitgate sync --gitignore --apply`가 **누락된 kit 규칙 행만 멱등 append**한다. 사용자 정책 행을 덮거나 재정렬하지 않으며, 이미 존재하면 no-op.
5. doctor가 "해당 경로가 실질적으로 ignore되지 않아 다음 review 뒤 D10을 막는다"를 **WARN**으로 알린다. **절대 FAIL이 아니다.**
6. 런타임 생성 파일 인벤토리 표(생성 위치 / ignore 정책 / init 배포 자산 / sync 소유자 / Git 영속 여부)가 문서화되고, 실제 packed-consumer 검사로 고정된다.
7. backfill matrix가 검증된다: 신규 설치 · 기존 설치 업그레이드 · **사용자 수정** `workflow/.gitignore` · global ignore 존재 환경.
8. `eslint` 0 · `tsc --noEmit` 0 · 단위 테스트 그린 · `req:doctor` PASS · 각 phase Codex 리뷰 승인.

## 범위 (MVP)

- 배포 템플릿 1행 추가 + tarball smoke 회귀 가드.
- `commitgate sync --gitignore --apply` opt-in 백필.
- doctor WARN(신규 D22) + 런타임 생성 파일 인벤토리 문서 + CHANGELOG.
- 패치 릴리스 준비(버전·CHANGELOG). 실제 publish는 사용자 직접.

## 비목표 (경계)

- **`reviewScratchPaths`/D10 의미론 변경** — 명시적으로 기각됨(§완료기준 3).
- **기본 `sync` 동작 변경** — opt-in 플래그로만.
- **doctor를 FAIL로 만드는 어떤 변경** — 소비자 커밋 벽돌화 금지.
- **design 증거 finalize 갭**(코덱스 P1) — 별도 REQ.
- `main` 하드코드 / `trunkBranch` 분리 — 이번 범위 제외(이후 P2 검토).
- npm publish 실행 자체(사용자 직접).

## 근거·불변식

- 템플릿은 **seed-once**(부재 시에만 생성, `--force`로도 미덮어씀, init D12) → 템플릿 수정은 **신규 init만** 구제하고 기존 설치본은 백필이 필요하다. 이 비대칭이 §완료기준 4의 존재 이유다.
- 소비자 커밋을 막는 게이트를 **새로 만들지 않는다**. 이 드리프트는 이미 하드 D10 FAIL로 발현 중이므로, 신규 진단의 역할은 차단이 아니라 **불투명한 D10 메시지를 행동 가능한 안내로 번역**하는 것이다(D19/D20/D21의 WARN 상한 선례와 동일 근거).
