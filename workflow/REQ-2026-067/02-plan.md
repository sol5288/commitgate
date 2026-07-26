# REQ-2026-067 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할로 검수 면적을 줄인다.

## Phase 1 — 순수 선택 상태기계 (`phase-1-select-core`)

범위(DEC-1·DEC-6·DEC-10): `bin/select-prompt.ts` 신규 · `tests/unit/select-prompt.test.ts` 신규. 코드 2파일.
**IO·raw mode 없음** — 순수 함수만. 행동 변화 0.

순서:
1. 🔴 `Key` 타입과 **증분 파서** `parseKeys(buffer): { keys, rest }`(DEC-1b) — 스트림 단위다.
   고정할 것: `\x1b[A`/`\x1b[B`(↑/↓) · `\x1bOA`/`\x1bOB`(application cursor mode) ·
   `\r`/`\n`(Enter) · `\x03`(Ctrl+C) · 그 외=`other`.
   🔴 **분할 도착이 정상 경로다**: `['\x1b', '[A']`가 이동 1회여야 한다. 청크마다 독립 해석하면
      ↑를 눌렀는데 setup이 중단된다(design r01 P1). 미완성 접두사(`\x1b` · `\x1b[` · `\x1bO`)는
      `rest`로 되돌리고, 접두사가 될 수 없는 바이트는 `other`로 소비해 버퍼가 자라지 않게 한다.
   🔴 **단독 Esc는 취소가 아니다** — 타이머 없이는 시퀀스 시작과 구별할 수 없다. 취소는 Ctrl+C 하나.
2. `applySelectKey(state, key): SelectOutcome` — 순수.
   테스트로 고정: ↑/↓ 이동 · **경계 순환**(0에서 ↑ → 마지막) · Enter=`accept(값)` ·
   Ctrl+C=`cancel` · 알 수 없는 키=`ignore`(상태 불변). Esc 단독은 `cancel`이 **아니다**(DEC-1b).
3. `renderSelect(state, opts): string[]` — 그릴 줄들(순수). 커서 표시·현재 값 표시.
4. `eraseLines(n): string` — DEC-10의 줄 단위 지우기 시퀀스(순수 문자열).

Exit: typecheck 0 · `npm test` green · 수용기준 5 충족 · Codex phase 리뷰 승인.

## Phase 2 — raw mode 어댑터 + Prompter 배선 (`phase-2-adapter`)

범위(DEC-2·DEC-3·DEC-9): `bin/select-prompt.ts`(어댑터 추가) · `bin/setup.ts`(선택 분기·목록 구성) ·
`tests/unit/setup.test.ts`(추가만). 코드 3파일.

순서:
1. `buildSelectItems(q: Question): SelectItem[]`(순수, DEC-6) — `[유지] + [비움?] + enum` 구성과
   각 항목의 **반환 문자열**(`''` / `-` / 값). 🔴 비움 항목은 **스키마가 null을 허용할 때만**.
   `hintFor`와 **같은 근거**를 쓴다 — 두 곳이 갈라지면 화면과 검증이 어긋난다.
   초기 커서는 `유지`(index 0) — Enter만 누르면 아무것도 안 바뀐다(DEC-5·DEC-6).
2. `runSelect(items, io): Promise<string>` — raw mode 어댑터. 얇게.
   🔴 **모든 종료 경로에서 raw mode 해제**(정상·throw·cancel). `try/finally` + 멱등 `close`.
   🔴 Ctrl+C는 `cancel` → setup 전체를 **중단**(부분 저장 없음 — 저장은 ⑦에서만 일어나므로 자동 충족).
3. `createReadlinePrompter`의 `ask`가 `q.choices` 유무로 분기.
   🔴 `setRawMode`가 없으면 **자유 입력으로 degrade**(DEC-9) — 실패시키지 않는다.
4. 🔴 **기존 테스트 케이스를 한 줄도 고치지 않는다**(수용기준 4 — design r01 observation 명확화).
   파일에 **새 케이스를 추가하는 것은 허용**이고, **기존 케이스의 수정·삭제는 금지**다.
   기존 케이스를 고쳐야 통과한다면 `Prompter` seam을 넓힌 것이므로 설계 위반이다 —
   그 사실을 리뷰에 보고하고 되돌린다.

Exit: typecheck 0 · `npm test` green(기존 setup 테스트 **무수정** 통과) · 수용기준 1·2·3·8 · Codex 승인.

## Phase 3 — 배너 · 커밋 안내 · 문서 (`phase-3-banner-docs`)

범위(DEC-7·DEC-8): `bin/setup.ts` · `tests/unit/setup.test.ts` · docs 한/영 · CHANGELOG. 코드 2파일 + docs.

순서:
1. `setupBanner(version)` 순수 함수 + `runSetup`에서 **TTY 판정 이후·첫 질문 이전** 1회 출력.
   🔴 비-TTY 거부 경로에서는 출력 없음(수용기준 6) — 테스트로 고정. ASCII만.
2. `savedMessage`에 `req.config.json` 커밋 안내 추가(DEC-8). 실측 근거(D10/D13)를 문구에 반영.
3. 문서(한/영) + CHANGELOG. `docs/configuration(.en).md`의 setup 절에 방향키 조작 설명.

Exit: `docs:lint` green · typecheck 0 · `npm test` green · 수용기준 6·7 · Codex 승인.

## Phase 4 — 화면 다듬기 (`phase-4-polish`)

범위(DEC-11~DEC-14 신규): `bin/select-prompt.ts` · `bin/setup.ts` · 테스트 2파일. 코드 4파일.

🔴 **동기는 취향이 아니라 결함이다.** 0.10.0 빌드를 소비자 프로젝트에서 실행한 실측 화면:

```
  선택지: none / minimal / low / medium / high / xhigh   <- 메뉴가 보여주는데 중복
  Enter=유지 · '-'=비움(전역 상속)                        <- 메뉴에는 '-' 입력이 없다. 거짓 안내
  ↑/↓ 이동 · Enter 선택 · Ctrl+C 취소                     <- 진짜 안내
```

안내 세 줄 중 둘이 **틀렸거나 중복**이다. 자유 입력용 문구를 메뉴에 그대로 재사용한 탓이다.

순서:
1. 🔴 `hintFor`를 **질문 형태별로 나눈다**(DEC-11) — 메뉴 질문은 `선택지:`·`'-'=비움`·`Enter=유지`를
   내지 않는다. 그 셋은 자유 입력의 조작법이고 메뉴에서는 **거짓말**이다. 남길 것은 현재 값과
   `stopGate`의 HIGH 고지뿐이다.
2. 항목 설명(DEC-12): 값 옆에 한 줄 설명을 붙인다(`merge — 묶음이 끝날 때까지 미룸`).
   설명은 **선택적**이고 없으면 값만 나온다 — enum이 늘어도 깨지지 않는다.
3. 색·강조(DEC-13): 선택 줄 반전, 나머지 흐리게. 🔴 `NO_COLOR`·비-TTY면 **끈다**.
   색 결정은 순수 함수로 두고 테스트한다 — 파이프로 넘길 때 escape가 섞이면 로그가 깨진다.
4. 배너 정리(DEC-14) + 확정 후 남기는 줄을 `질문 → 고른 값` 형태로.
5. 테스트: 렌더 문자열 고정(색 on/off 양쪽) · 안내에 금지 문구가 없는지 · 설명 없는 enum도 정상.

Exit: typecheck 0 · `npm test` green · `docs:lint` green · Codex 승인 · **사용자 육안 확인**.

## 완료
- 게이트 해당분(unit·typecheck·docs:lint) · 사용자 main 머지(별도 승인).
- 🔴 **사람 확인이 필요한 부분**: 실제 방향키 조작감은 CI가 검증할 수 없다(대화형 전용).
  머지 전 사용자에게 터미널 실행을 요청한다.
