# REQ-2026-060 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

## Phase 1 — TTY 판정 spike + verb 골격 (`phase-1-tty-detection-and-verb-skeleton`)

범위(설계 DEC-1·DEC-2·DEC-13): `bin/setup.ts` 신규(골격만) · `bin/dispatch.mjs` verb 등록 ·
`tests/unit/setup.test.ts` 신규 + `tests/unit/dispatch.test.ts` 갱신. 코드 4파일.

순서:
1. 🔴 **TTY spike 먼저.** 4조합 실측 — PowerShell / Git Bash(mintty) / `npx commitgate setup` /
   `npm run` 경유에서 `process.stdin.isTTY`·`process.stdout.isTTY` 값을 기록한다.
2. 실측값으로 판정식을 확정한다. **어떤 결과여도 DEC-1(질문 없이 즉시 실패)은 불변**이고, 바뀌는 것은
   "무엇을 TTY로 볼 것인가"뿐이다.
3. `bin/setup.ts`: 판정 → non-TTY면 한 줄 메시지 + exit 1. **`Prompter`를 생성하지 않는다.**
   TTY면 이 phase에서는 "다음 phase에서 구현" 안내만 출력하고 종료(쓰기 0건).
4. dispatch 등록 + `resolveDispatch` 테스트 갱신.
5. **실측값을 커밋 메시지에 남긴다**(설계가 미리 못 박지 않은 값이므로 기록이 근거가 된다).

Exit: typecheck 0 · `npm test` green · non-TTY 즉시 실패 단위 테스트 존재 · Codex phase 리뷰 승인.

## Phase 2 — 순수 코어: 질문·검증·merge (`phase-2-pure-core`)

범위(설계 DEC-3·DEC-4·DEC-6·DEC-7): `bin/setup.ts`의 순수 함수부 + 테스트. 코드 2파일.

순서:
1. `Question`/`Prompter` 타입 + 질문 목록 생성(모델·effort 2개, 현재 값을 `current`로).
2. 답변 검증 — **`CONFIG_SCHEMA`의 해당 서브스키마**를 SSOT로 사용(enum·pattern·null 허용).
   빈 입력 = 현재 값 유지(DEC-11).
3. merge — 건드린 2키만 교체, 나머지 키의 값·순서 보존. 직렬화 `JSON.stringify(_,null,2)+'\n'`, **LF 고정**.
4. merge 결과 AJV 재검증(실패 시 예외 — 쓰기 없음).
5. 테스트: 스크립트된 `Prompter`로 전 경로 구동(IO 없음).

Exit: typecheck 0 · `npm test` green · Codex phase 리뷰 승인.

## Phase 3 — 로그인 실행·재검증 + 원자적 쓰기 (`phase-3-login-and-atomic-write`)

범위(설계 DEC-5·DEC-8·DEC-9·DEC-10): `scripts/req/lib/adapters.ts`(inherit spawn +
`versionProbe`/`authProbe`) · `bin/setup.ts` 배선 · 테스트. 코드 3파일.

순서:
1. `adapters.ts`: inherited-stdio spawn 헬퍼(기존 `safeSpawnSync`는 출력을 캡처하므로 별도) +
   `versionProbe`/`authProbe`. **`authProbe`는 stdout을 읽고** `logged-in`/`logged-out`/`unknown` 3분류.
2. `bin/setup.ts`: DEC-10의 ①~⑦ 배선. 🔴 **쓰기는 ⑦ 한 곳뿐**이고 temp+rename.
3. 🔴 **로그인은 맨 `codex login`만** — `--with-api-key`/`--with-access-token` 금지.
   이미 `logged-in`이면 건너뜀. 실행 후 재검증에서 **`unknown`도 실패**.
4. 테스트: spawn 주입으로 (a) 미설치 (b) 미로그인→로그인 성공 (c) 로그인 실패 (d) `unknown`
   네 경로. **(c)·(d)에서 `req.config.json`이 변경되지 않음**을 검증(수용기준 4).
5. **실측**: Windows에서 `stdio:'inherit'` spawn이 브라우저 플로우를 정상 진행하는지 직접 확인
   (설계 §미측정-3). 이미 로그인된 상태이므로 로그아웃 없이 확인 가능한 범위까지만 주장한다.

Exit: typecheck 0 · `npm test` green · 수용기준 1~5 충족 · Codex phase 리뷰 승인.

## Phase 4 — 문서·계약 (`phase-4-docs-and-contract`)

범위(설계 DEC-12): `AGENTS.template.md` 사람 전용 명령 절 · `docs/quick-start{,.en}.md` ·
`docs/configuration{,.en}.md` · `CHANGELOG.md`. 코드 변경 0.

순서:
1. `AGENTS.template.md`: **"사람 전용 명령"** 절 신설 — 에이전트는 `commitgate setup`을 실행하지 않고
   **사용자에게 실행을 요청**한다. 기존 통제점표(I1/I2/B1)와 개념이 다름을 명시.
2. `docs/quick-start`: 설치 직후 흐름에 setup 추가(한/영 동시).
3. `docs/configuration`: 모델·effort를 손으로 고치는 대신 setup을 쓰는 경로 + **자격증명은 설정에
   넣지 않는다**는 경계 + `req.config.json` 변경이 워킹트리를 더럽힌다는 안내.
4. `CHANGELOG.md`: **앞 phase 구현으로 가는 포인터를 포함**한다 — docs-only phase는 diff-scoped 리뷰가
   "근거 없음"으로 오탐한 전례(REQ-2026-037)가 있어, 변경 근거를 CHANGELOG가 가리키게 한다.
5. 🔴 **비목표를 문서에도 적는다** — setup은 아무것도 강제하지 않으며 강제는 후속 REQ 소관이다.

Exit: `docs:lint` green(remark-validate-links) · typecheck 0 · `npm test` green · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(unit·typecheck·docs:lint) · 사용자 main 통합(별도 승인).
- 🔴 **단독 릴리스 금지**(00-requirement 제약): 원장 감사 REQ(E)와 같은 릴리스로 낸다.
