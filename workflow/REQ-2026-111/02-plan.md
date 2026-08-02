# REQ-2026-111 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

> **테스트 실행 계층(REQ-2026-100)**: 게이트는 테스트를 **실행하지 않는다**. 아래는 비용을 줄이기 위한 실행 시점 권고다.
> - **phase 진행 중**: 변경한 소스를 import하는 테스트만(빠른 피드백). 예: `grep -rl "<변경한 모듈>" tests/`
> - **통합(main 병합) 직전 1회**: **전체 스위트**. 범위 한정은 이것을 **대체하지 않는다** — 영향 분석은 놓친 회귀를 통과시킨다.

## Phase 1 — doctor 실행 로그 배선 (`phase-1-doctor-run-log`)

**책임 계약**: `req:doctor` 실행 1회가 `workflow/.doctor-runs.jsonl`에 판정 요약 1행을 남긴다.
그 기록의 성공·실패는 doctor 판정에 영향을 주지 않는다.

**입력**: 현재 `main()`의 `checks`(= `runChecks(inp)` 반환값)와 `state.id`.
**산출물**: 위 로그 파일 + gitignore 3표면 + 테스트.
**선행 phase**: 없음(단일 phase).

**범위 (5파일 — 8파일 권고 안)**

| 파일 | 변경 |
|---|---|
| `scripts/req/req-doctor.ts` | `DOCTOR_RUN_LOG_REL` · `DoctorRunRow` · `buildDoctorRunRow`(순수·export) · `appendDoctorRun`(예외 삼킴) · `main()` 1줄 배선 · D22 목록에 상수 추가 |
| `.gitignore` | `workflow/.doctor-runs.jsonl` 추가 |
| `templates/workflow.gitignore` | 동일 규칙 추가 |
| `tests/unit/doctor-run-log.test.ts` (신규) | AC-1~AC-5 |
| `CHANGELOG.md` | Unreleased 항목 |

**stage 범위**: 위 5개 파일만. `workflow/REQ-2026-111/state.json`·`responses/`는 **스테이징하지 않는다**.

**공개 seam과 실패해야 할 동작**

| # | seam | 실패해야 하는 구현 |
|---|---|---|
| AC-1 | `main([SHORT, '--root', repo])` 실행 후 로그 파일 | 빌더만 만들고 `main()`에서 호출하지 않음 → 파일 없음 → 실패 |
| AC-2 | 같은 로그 행의 `nonok` | non-OK를 빠뜨리거나 level을 잘못 담음 → 실패 |
| AC-3 | 쓰기 불가 상태의 `main()` 출력·exit | `appendDoctorRun`이 예외를 새게 함 → doctor가 죽음 → 실패 |
| AC-4 | 두 gitignore 파일의 내용 | 한쪽만 넣음 → 실패(**변이 검사**로 확인) |
| AC-5 | D22에 전달되는 스크래치 목록 | 상수를 목록에 안 넣음 → 실패 |

**검증 명령** (추측하지 않는다 — `package.json`의 scripts + `req.config.json`의 `packageManager: npm`)

```
npx tsc --noEmit
npx vitest run tests/unit/doctor-run-log.test.ts tests/unit/req-doctor.test.ts tests/unit/doctor-terminal-wiring.test.ts
```

역의존 확인: `grep -rl "req-doctor" tests/` 결과 중 위 파일들이 대상이다.

**비목표(이 phase에서 하지 않는 것)**

- 판정 로직·메시지·level 변경
- 로그를 읽어 분석하는 명령
- 회전·상한
- 체크별 "평가됨" 기록(설계 DEC-3)

**Exit**: typecheck 0 · 위 검증 명령 그린 · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(typecheck·해당 시 lint) · **통합 직전 전체 스위트 1회** · 사용자 main 머지(별도 승인).
