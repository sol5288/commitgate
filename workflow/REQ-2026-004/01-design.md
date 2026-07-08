# REQ-2026-004 설계 — review-gate 안정화 + init UX 분리 랜딩

> 정본 결정은 각 DEC/코드 주석. 본 문서는 안정화 체크포인트로서 이미 작성된 변경을 어떻게 2개 커밋으로 게이트 통과시키는지 기록.

## 현재 상태(변경 대상)
- `scripts/req/review-codex.ts`: 리뷰 응답의 **유효성(result.ok)** 과 **승인(commit_allowed/design_approved)** 이 분리돼 있지 않아, `STEP_COMPLETE + commit_approved=no + findings=[]`가 `OK`/exit 0으로 보고되며 무한 재리뷰 루프를 유발.
- `scripts/req/lib/adapters.ts`: git 러너가 Node 기본 1MiB maxBuffer.
- `workflow/machine.schema.json`: `commit_approved`에 design/phase 의미 설명 부재(design 리뷰 `no` 편향 유발).
- `bin/init.ts`·`bin/commitgate.mjs`: init CLI 안내/UX(별개 관심사).

## 핵심 설계 결정
1. **outcome 분리(`classifyReview`)** — `approved|needs-fix|blocked|invalid`. findings 존재 기반: 미승인이면 findings 있으면 needs-fix, 없으면 결정적 `blocked`. `invalid ⟺ !result.ok`.
2. **종료코드 계약** — 0/1/2/3. `main()`은 단일 정본 `resolveReviewOutcome`을 호출(배선 drift 방지). exit 0 = 승인만.
3. **blocked 회로차단기** — 같은 바인딩에서 blocked 2회 누적 시 codex 호출 전 exit 2. `--fresh-thread`로 마커 초기화 + 새 스레드(고착 resume 회복).
4. **R10(안전)** — `commit_approved=yes && findings.length>0`은 모순(fail-closed). 승인은 findings 0건일 때만. (비차단 코멘트용 별도 필드는 후속 REQ.)
5. **git maxBuffer 64MiB** — codex 경로와 정합, 큰 diff ENOBUFS 방지.
6. **hermetic 테스트** — `.cmd` 픽스처를 repo 내부 `.tmp/`(gitignored) + `.cjs`로. `process.execPath` 절대경로.
7. schema `description` 추가(version 1.1 유지).

## Phase별 구현
- **Phase 1 (init UX)**: `bin/init.ts`, `bin/commitgate.mjs`, `package.json`(0.2.2), `tests/unit/init.test.ts`.
- **Phase 2 (review-gate)**: `scripts/req/review-codex.ts`, `scripts/req/lib/adapters.ts`, `workflow/machine.schema.json`, `.gitignore`, `AGENTS.template.md`, `README.md`, `README.en.md`, review 관련 테스트 3종.

## 변경 파일
위 Phase별 목록 참조. 두 Phase의 코드 파일 집합은 서로소(README/AGENTS 문서는 Phase 2에 포함).

## 하위호환·안전
- schema 1.1 유지 → 기존 아카이브 호환.
- 레거시(phases[] 빈) 경로 불변: phase 리뷰는 design 승인 없이도 동작.
- fail-closed 보존: 어떤 경로도 미승인을 승인으로 바꾸지 않음.
