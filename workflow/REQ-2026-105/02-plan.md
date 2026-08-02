# REQ-2026-105 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

> **테스트 실행 계층(REQ-2026-100)**: 게이트는 테스트를 **실행하지 않는다**. 아래는 비용을 줄이기 위한 실행 시점 권고다.
> - **phase 진행 중**: 변경한 소스를 import하는 테스트만(빠른 피드백). 예: `grep -rl "<변경한 모듈>" tests/`
> - **통합(main 병합) 직전 1회**: **전체 스위트**. 범위 한정은 이것을 **대체하지 않는다** — 영향 분석은 놓친 회귀를 통과시킨다.

## Phase 1 — CLI 경계 헬퍼 + 바이트 동일 11곳 (`phase-1-cli-boundary-helper`)

범위(13파일 · `max_files: 15` 선언):

- `scripts/req/lib/cli-boundary.ts`(신규) — `makeRunCli(run, prefix='commitgate')` · `isEntrypoint(moduleUrl)`(DEC-1·2·3)
- `tests/unit/cli-boundary.test.ts`(신규) — 접두어 적용 · 비-Error throw의 `String(err)` · `exitCode=1` · **오류 메시지 고정 문자열 단언**(DEC-5)
- 바이트 동일 11곳 전환: `bin/init.ts` · `scripts/req/{req-close,req-commit,req-confirm,req-doctor,req-new,req-next,req-rebind,req-reconstruct,req-review-exception,review-codex}.ts`
  - 각 파일의 `runCli` 정의 7줄 → `export const runCli = makeRunCli(main)`
  - 각 파일의 `isMain` 선언 → `isEntrypoint(import.meta.url)`
  - 🔴 `req-confirm.ts`·`req-rebind.ts`의 가드 우선 변형도 같은 헬퍼로 수렴한다(DEC-3)
  - 나머지 7개 파일(`bin/{quickstart,uninstall,sync,migrate,check,delivery,setup}.ts`)의 `isMain`은 **phase 2에서** 전환한다 — 18곳 전부가 대상이다(요구 2)

Exit: typecheck 0 · `dispatch` + 전환한 모듈의 테스트 그린 · Codex phase 리뷰 승인.

## Phase 2 — 나머지 7곳 + 미공유 사유 명시 (`phase-2-cli-boundary-variants`)

범위(8파일):

- **`runCli` + `isMain` 둘 다 전환** — `bin/{quickstart,uninstall,sync,migrate}.ts`
  `makeRunCli(argv => runX(parseArgs(argv)), 'commitgate <verb>')`. 🔴 **접두어 문자열을 현재 값 그대로 보존**한다(바뀌면 사용자가 보는 문자열이 바뀐다)
- **`isMain`만 전환**(`runCli`는 유지) — `bin/{check,delivery,setup}.ts`
  🔴 설계 r01 P1: `runCli` 미통합이 `isMain` 미통합으로 번지면 요구 2가 미충족이다. 두 관심사는 별개다.
  각 파일에 **왜 `runCli`는 공유하지 않는지 주석**을 남긴다(DEC-4) — help는 오류가 아닌 제어 흐름이고, `setup.ts`는 async + `deps?`다
- `CHANGELOG.md` — Unreleased 항목. 앞 phase 커밋 SHA 포인터 표를 **처음부터** 넣는다

🔴 **완료 검증(요구 2)**: `grep -rn "const isMain" scripts bin --include="*.ts"`가 **0건**이고, `grep -rlc "isEntrypoint(import.meta.url)" scripts bin --include="*.ts" | wc -l`이 **18**이어야 한다. 두 명령을 phase 종료 시 실행해 결과를 커밋 메시지에 남긴다.

Exit: typecheck 0 · 위 검증 2건 · `dispatch`·`check`·`delivery-verbs`·`sync`·`uninstall`·`migrate`·`quickstart`·`setup` 테스트 그린 · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(typecheck·해당 시 lint) · **통합 직전 전체 스위트 1회** · 사용자 main 머지(별도 승인).
