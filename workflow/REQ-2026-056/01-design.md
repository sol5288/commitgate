# REQ-2026-056 설계 — lockfile 프롬프트 요약 + frozen-lockfile doctor

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

- `scripts/req/review-codex.ts`:
  - `stagedDiff = git(['diff', '--cached'])`(~2156) → `buildPromptFor`(~2177) → `assemblePrompt`가
    `blocks.push('# 권위 아티팩트 = staged diff …\n${stagedDiff}')`(~190)로 프롬프트에 **전문** 삽입.
  - 측정 로그(REQ-2026-045): `assembledPromptSha256`·`promptBytes`는 **실제 전송 프롬프트**를 해시/측정.
    ledger `attempt-closed.prompt_sha256`도 전송 프롬프트 해시. → 요약분이 "전송된 것"이면 이 해시들은 자동 정합.
  - 🔴 **바인딩**은 `reviewTree = git write-tree`(전체 index)·`approved_diff_hash` — stagedDiff 문자열과 무관.
    프롬프트 요약은 바인딩을 **바꾸지 않는다**.
- `scripts/req/lib/config.ts`: optional 필드 + resolved config(defaults). `packageManager`(npm/pnpm/yarn/bun).
- `scripts/req/req-doctor.ts`: `DoctorInputs`(**optional 필드** — 테스트 base 리터럴 보호) + 순수 `runChecks(inp)`.
  D19~D22가 **WARN 상한**(req:commit이 doctor를 하드 게이트로 spawn하므로 FAIL 금지).

## 핵심 설계 결정

### DEC-E1 — lockfile diff 요약(순수) `lib/lockfile-diff.ts`

`summarizeLockfileDiff(stagedDiff: string, opts: { full: boolean }): string`(순수):

- `stagedDiff`를 파일 구획(`diff --git a/<p> b/<p>` 경계)으로 나눈다.
- 각 구획의 경로 basename이 **lockfile**(`package-lock.json`·`pnpm-lock.yaml`·`yarn.lock`·`npm-shrinkwrap.json`·
  `bun.lockb`)이면(그리고 `!opts.full`):
  - 구획 **헤더(`diff --git`·`index`·`---`/`+++`/`new file` 등)는 보존**(파일이 바뀐 사실·rename/삭제 신호 유지).
  - **hunk 본문(`@@`~)만** 한 줄 요약으로 대체: `# lockfile 전문 생략(요약 모드) — +N/-M lines · sha256(생략분)=<12>
    · 전문: config lockfilePromptFull:true`. binary("Binary files … differ")면 "binary lockfile 변경"으로.
  - `N/M` = 그 구획 hunk의 `+`/`-`(단, `+++`/`---` 제외) 줄 수. `sha256(생략분)` = 대체한 hunk 텍스트 해시
    (감사 시 생략분 대조 가능 — 내용은 안 담고 fingerprint만).
- lockfile 아닌 구획·`opts.full` → **원문 그대로**(passthrough). lockfile 없는 diff면 완전 no-op(무회귀).

### DEC-E2 — 프롬프트 배선 + config opt-in

- `config.ts`: `lockfilePromptFull?: boolean`(default **false** = 요약). resolved에 포함.
- `review-codex.ts`: `stagedDiff` 계산 직후 `stagedDiff = summarizeLockfileDiff(stagedDiff, { full: cfg.lockfilePromptFull })`.
  이후 흐름(buildPromptFor·assemblePrompt·측정 로그·ledger prompt_sha256) 전부 **요약된(=전송된) 프롬프트** 기준 →
  프롬프트 파생 해시는 자동 정합. 바인딩(reviewTree)은 불변.
- 🔴 **바인딩 불변 재확인**: 요약은 `git diff --cached` **문자열**만 바꾼다. `reviewTree`·`approved_diff_hash`·
  사후 tamper 검증(afterTree===reviewTree)은 index 기준이라 무영향. 승인은 여전히 **전체 lockfile을 결속**한다.

### DEC-E3 — doctor D23: frozen-lockfile 위생(WARN 상한)

- 입력(IO 계산·optional): `lockfileStatus?: 'ok' | 'missing' | 'untracked' | 'no-package-json'`.
  - package.json 없음 → `no-package-json`(점검 불요·OK).
  - PM(`cfg.packageManager`)의 기대 lockfile(npm→package-lock.json·pnpm→pnpm-lock.yaml·yarn→yarn.lock·
    bun→bun.lockb) 존재 + git-tracked(`git ls-files --error-unmatch`) → `ok`.
  - 파일 없음 → `missing`. 있으나 untracked → `untracked`.
- 순수 `runChecks`에 **D23** 추가: `ok`/`no-package-json`/undefined → OK. `missing`/`untracked` → **WARN**
  ("재현 가능한 설치(`<pm> ci`/`--frozen-lockfile`) 불가 — lockfile을 커밋하세요"). 🔴 **FAIL 금지**(D19~D22 근거 동일).
- lockfile ↔ package.json **동기 검사는 안 한다**(PM 실행 없이 신뢰 불가 — 비목표). 존재·tracked 위생만.

### DEC-E4 — 안전·하위호환

- 요약은 **프롬프트 전용**(binding·측정정합 불변). config·doctor 입력 필드는 **optional additive**(기존 config·
  doctor 테스트 base 무회귀). lockfile 없는 프로젝트·기존 near-e2e(byte-identical) 테스트는 요약이 no-op이라 무영향.
- doctor WARN 상한(하드 게이트 안 됨).

## Phase별 구현

- **Phase 1 — lockfile diff 요약**(`phase-1-lockfile-prompt-summary`): `lib/lockfile-diff.ts`(순수
  summarizeLockfileDiff) + `config.ts`(lockfilePromptFull) + `review-codex.ts`(1줄 배선) + 단위 테스트.
- **Phase 2 — doctor D23**(`phase-2-frozen-lockfile-doctor`): `req-doctor.ts`(lockfileStatus 입력·계산·D23 check)
  + 단위 테스트(runChecks pure).

## 변경 파일

- `scripts/req/lib/lockfile-diff.ts`(P1·신규) · `scripts/req/lib/config.ts`(P1) · `scripts/req/review-codex.ts`(P1)
  · `tests/unit/lockfile-diff.test.ts`(P1)
- `scripts/req/req-doctor.ts`(P2) · `tests/unit/req-doctor.test.ts`(P2)

## 하위호환·안전

- 프롬프트 요약은 프롬프트만·바인딩 불변. config/doctor 입력은 optional additive. WARN 상한.
- main 통합은 C·D와 함께 마지막 사용자 확인(스택 053~056 일괄).
