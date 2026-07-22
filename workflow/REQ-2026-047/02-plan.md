# REQ-2026-047 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님).

## Phase 1 — 배포 템플릿 수정 + tarball smoke 회귀 가드 (`phase-1-template-and-smoke`)

범위: `templates/workflow.gitignore`에 **앵커형 `/.review-calls.jsonl`** 1행 추가(DEC-1). `scripts/smoke.mjs` 4b(:115-124)를 확장해 packed tarball 설치본에서 `workflow/.review-calls.jsonl`을 생성한 뒤 `git check-ignore`가 성공함을 단언(DEC-2). 템플릿 내용 문자열 단언은 **넣지 않는다**.

**이 phase만으로 신규 `init` 소비자의 P0가 해소된다.**

Exit: 변경 = 위 2파일 · `npm run smoke` 그린(실제 tarball 경로) · eslint 0 · `tsc --noEmit` 0 · 단위 그린 · `req:doctor` PASS · Codex phase 리뷰 승인.

## Phase 2 — `commitgate sync --gitignore` opt-in 백필 (`phase-2-sync-gitignore`)

범위: `bin/sync.ts`에 `--gitignore` 축 추가(DEC-4) — plan/render/apply. **기본 sync 동작 무변경**, additive append 전용(누락된 kit 규칙 행만 말미 추가), 정규화 비교로 **멱등**, 사용자 행 수정·삭제·재정렬 금지, `--apply` 없이는 쓰지 않음.

단위 테스트로 고정: ①누락 행만 append ②이미 존재 시 no-op(중복 없음) ③사용자 커스텀 행·주석 보존 ④`--gitignore` 미지정 시 기존 동작 바이트 동일 ⑤`workflow/.gitignore` 부재 시 처리 ⑥dry-run 쓰기 0건.

Exit: 변경 = `bin/sync.ts` · `tests/unit/sync.test.ts` · eslint 0 · `tsc --noEmit` 0 · 단위 그린 · `req:doctor` PASS · Codex phase 리뷰 승인.

## Phase 3 — doctor D22(WARN) + 인벤토리 표 + 릴리스 준비 (`phase-3-doctor-warn-and-docs`)

범위: doctor **D22**(DEC-5) — repo-root 런타임 스크래치가 ignore도 tracked도 아니면 **WARN**으로 `sync --gitignore --apply` 안내. 🔴 **FAIL 금지**, dev repo(`packageRootDiffers===false`) skip. 단위 테스트로 **레벨이 WARN임을 명시적으로 고정**(FAIL 회귀 차단).

DEC-6 인벤토리 표(생성 위치/ignore 정책/init 배포 자산/sync 소유자/Git 영속 여부) 문서화 + troubleshooting에 "이미 커밋해 tracked가 된 경우 `git rm --cached` 필요" 명시. CHANGELOG + 패치 버전 0.9.6 → **0.9.7**.

> 리뷰 주의: 이 phase는 앞 phase의 런타임을 문서화하므로 diff-scoped 리뷰에서 근거 부재 오탐이 날 수 있다(REQ-2026-037 선례). CHANGELOG·문서에 **구현 phase 포인터**를 함께 적어 해소한다.

Exit: 변경 ≤8파일 · eslint 0 · `tsc --noEmit` 0 · **전체 스위트 그린**(`fileParallelism:false`) · `npm run smoke` 그린 · `req:doctor` PASS · Codex phase 리뷰 승인.

## backfill matrix (phase-2·3 검증 축)

| 축 | 검증 위치 |
|---|---|
| 신규 설치 | phase-1 smoke(tarball → init → check-ignore) |
| 기존 설치 업그레이드 | phase-2 단위(누락 행 append) |
| 사용자 수정 `workflow/.gitignore` | phase-2 단위(커스텀 행·주석 보존, 멱등 no-op) |
| global ignore 존재 환경 | smoke의 기존 hermetic `core.excludesFile` 차단(:102-106) 상속 |

## 완료

- 게이트 해당분(unit·typecheck·lint·smoke) · 사용자 main 머지(별도 승인) · **패치 릴리스 준비까지**. 실제 `npm publish`·tag·GH release는 **사용자 직접**(별도 게이트).
- 비목표: `reviewScratchPaths`/D10 의미론 변경(기각) · 기본 sync 동작 변경 · doctor FAIL화 · **design 증거 finalize 갭(코덱스 P1 — 별도 REQ)** · `main` 하드코드/`trunkBranch` 분리(이후 P2).
