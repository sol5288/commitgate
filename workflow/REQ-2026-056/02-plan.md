# REQ-2026-056 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> 두 부분(프롬프트 요약·doctor 진단)은 독립적이라 각 phase가 완결 기능이다. 검증 명령:
> `pnpm run typecheck` · `npx vitest run <해당 테스트>` · (필요 시) `node scripts/smoke.mjs`.

## Phase 1 — lockfile diff 요약 (`phase-1-lockfile-prompt-summary`)

범위: `scripts/req/lib/lockfile-diff.ts`(순수·신규) + `scripts/req/lib/config.ts`(lockfilePromptFull) +
`scripts/req/review-codex.ts`(1줄 배선) + `tests/unit/lockfile-diff.test.ts`.

- `summarizeLockfileDiff(stagedDiff, { full })`: 파일 구획 분할 → lockfile 구획 hunk를 요약(경로·헤더 보존·
  +N/-M·sha256(생략분)) 대체·非lockfile/full은 passthrough·lockfile 없으면 no-op.
- `config.ts`: `lockfilePromptFull?: boolean`(default false) 추가(interface·resolved·schema·defaults).
- `review-codex.ts`: stagedDiff 계산 직후 `summarizeLockfileDiff(…, { full: cfg.lockfilePromptFull })` 배선.

테스트 오라클(`tests/unit/lockfile-diff.test.ts`):
- ① lockfile 구획 → hunk 요약(경로·헤더 보존·+N/-M 정확·sha256 12자리). ② 非lockfile 구획 → 원문 그대로.
- ③ 혼합 diff(package.json + package-lock.json) → package.json 전문·lockfile만 요약.
- ④ opts.full=true → 전체 passthrough(요약 안 함). ⑤ lockfile 없는 diff → 완전 no-op(입력===출력).
- ⑥ binary lockfile("Binary files … differ") → binary 요약. ⑦ pnpm-lock.yaml·yarn.lock·npm-shrinkwrap.json·
  bun.lockb 전부 lockfile로 인식. ⑧ 빈 diff·경로에 lockfile 부분문자열(예: `my-package-lock.json.bak`은 basename
  일치만) 경계.
- ⑨ config: lockfilePromptFull 기본 false·resolved 반영(config 테스트에 1건).

Exit: typecheck0 · 단위 그린 · Codex phase 리뷰 승인.

## Phase 2 — frozen-lockfile doctor D23 (`phase-2-frozen-lockfile-doctor`)

범위: `scripts/req/req-doctor.ts`(lockfileStatus 입력·IO 계산·D23 check) + `tests/unit/req-doctor.test.ts`.

- `DoctorInputs.lockfileStatus?: 'ok'|'missing'|'untracked'|'no-package-json'`(optional additive).
- IO: package.json 없음→no-package-json·PM 기대 lockfile 존재+tracked→ok·없음→missing·untracked→untracked.
- `runChecks` D23: ok/no-package-json/undefined→OK · missing/untracked→**WARN**(FAIL 아님).

테스트 오라클(`tests/unit/req-doctor.test.ts`, runChecks pure):
- ⑩ lockfileStatus='ok' → D23 OK. ⑪ 'missing' → D23 WARN(FAIL 아님·level==='WARN'). ⑫ 'untracked' → WARN.
- ⑬ 'no-package-json'·undefined → OK(점검 불요). ⑭ D23이 전체 doctor를 FAIL로 만들지 않음(WARN 상한 회귀가드).

Exit: typecheck0 · 단위 그린 · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(unit·typecheck·smoke) · 사용자 main 머지(C·D와 함께 마지막·스택 053~056 일괄 별도 승인).
