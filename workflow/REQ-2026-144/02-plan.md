# REQ-2026-144 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님).

> **테스트 실행 계층(REQ-2026-100)**: 게이트는 테스트를 **실행하지 않는다**.
> - **phase 진행 중**: 변경 영역 테스트 + `tests/unit/dispatch.test.ts` + 정책 구조 가드.
> - **통합 직전 1회**: **전체 스위트**(`npm test`) + `verify-range --strict`.

🔴 **선행**: 설계 승인 직후 `state.json` 의 `phases[]` 에 아래 **세** id 를 선언한다.

```
phase-1-nonconvergence-analyzer · phase-2-resolve-replace-verb · phase-3-hardcap-report-wiring
```

## Phase 1 — 비수렴 분석기 (`phase-1-nonconvergence-analyzer`)

범위: `scripts/req/lib/nonconvergence.ts` — 원장 행 + 라운드별 verdict 를 입력으로 받는 **순수** 함수.
반복 축 추출(DEC-2) · 세 갈래 분해안(DEC-3) · 선택지 문구(DEC-4) · 보고 문자열 조립.

Exit:
- 🔴 **결정론**: 같은 입력이면 같은 문자열. 입력 배열 순서를 뒤집어도 결과가 같다.
- 🔴 반복 축은 **2라운드 이상**만. 1회 등장은 담기지 않는다.
- 🔴 **세 갈래가 각각 다른 문구**를 낸다(축 0개 / 1개 / 2개 이상) — 하나로 뭉뚱그리지 않는다.
- 파손된 라운드 하나는 **건너뛰고 나머지로** 보고를 만든다(전부 버리지 않는다).
- 🔴 선택지에 **hardCap 증액이 없다**(고정 문자열 부재 검사).
- 🔴 선택지는 **상태에서 계산**된다 — 열린 stale attempt 가 없으면 `--close-stale` 을 제시하지 않는다.
- 🔴 REQ id·series id·**대체 slug** 는 실제 값이 박히고, 사람이 채울 자리는 **따옴표 안**의 사유·승인 문장뿐이다.
- 🔴 **출력에 `<` 가 없다**(고정 문자 부재 검사 — PowerShell 리디렉션으로 명령이 죽는다, 설계 r02 P1).
- 🔴 **모든 명령 줄이 `npx commitgate ` 로 시작하고 `--run` 으로 끝난다**(설계 r03 P1 — 접두 없으면 셸이
  못 찾고 `--run` 없으면 dry-run 이라 아무 일도 안 일어난다).
- 🔴 갈래 2개 + 선행 최대 1줄 = **명령 4줄 이하** — 요구사항 제약·DEC-6 과 **같은 값**이다(r04 P1 정정).
- 🔴 아카이브는 **워킹트리**에서 읽는다(커밋된 사본이 없는 것이 정상 — DEC-1 정정본). 없는 라운드는 건너뛴다.
- 🔴 slug 산출: 부모 branch 접두 제거 → `-successor`. 벗길 수 없으면 `req-<번호>-successor` 로 떨어진다.
- 계약 스위트: `npx vitest run tests/unit/nonconvergence.test.ts tests/unit/dispatch.test.ts`
- Codex 승인.

## Phase 2 — replace 결정 기록 표면 (`phase-2-resolve-replace-verb`)

범위: `req:review-exception <REQ> --resolve replace --series <series_id> --reason "…" --confirm "…" --run`.
내부는 기존 `closeSeriesHumanResolution` 을 부른다(새 판정 로직 없음 — 배선만).

Exit:
- 🔴 **`req:new --successor-of` 가 실제로 성공**한다(이 verb 실행 **직후**, 다른 조작 없이).
  배선 끊김은 순수 테스트가 못 잡으므로 **실제 진입점을 두 번 연속 구동**해 확인한다.
- 🔴 **실행 후 워킹트리가 clean 이다** — `--resolve` 가 state 변경을 커밋하지 않으면 `req:new` 의
  clean-worktree 검사에서 막힌다(설계 r05 P1). `git status --porcelain` 이 비어야 한다.
- 🔴 `--reason`·`--confirm` 이 없으면 발급하지 않는다(`--close-stale` 과 동형).
- 🔴 `--resolve` 는 `replace` 만 받는다. 다른 값은 거부한다.
- 🔴 **`--series` 필수** — 대상을 짐작하지 않는다. design·phase 가 동시에 열린 티켓에서 지정한 쪽만 종결됨을 확인한다.
- 🔴 열린 series 가 없으면 거부한다(종결 대상 부재 — 기존 함수 계약 그대로).
- 멱등: 이미 종결된 series 에 다시 실행하면 안전하게 거부·no-op 한다.
- 계약 스위트 + `npx vitest run tests/unit/req-review-exception.test.ts tests/unit/dispatch.test.ts`
- Codex 승인.

## Phase 3 — 배선 (`phase-3-hardcap-report-wiring`)

범위: `review-codex.ts` 의 `hard-blocked` 분기가 보고를 실어 throw · 실패 시 **원문 fallback** ·
`req:next` 한 줄 안내 · `docs/workflow*.md` · CHANGELOG.

Exit:
- 🔴 **보고 생성이 실패해도 `hard-blocked` 는 여전히 throw** 한다(무회귀 오라클 — 주입 실패로 실증).
- 🔴 `checkReviewBudget` 판정은 **한 글자도 바뀌지 않는다**(구조 가드).
- 🔴 발화 지점이 **하나**임을 소스 가드로 고정 — `req:next` 는 보고를 복제하지 않는다.
- 원장·아카이브가 없는 티켓에서도 차단이 정상 동작한다.
- 계약 스위트 + `npx vitest run tests/unit/req-next.test.ts tests/unit/req-review-codex.test.ts`
- Codex 승인.

## 완료
- 게이트 해당분 · **통합 직전 전체 스위트 1회 + `verify-range --strict`**.
- 🔴 통합은 `stopGate: "auto"` 이므로 **사전 위임이 필요**하다 — 사람 승인 문장을 받아
  `req:delegate --scope ticket:REQ-2026-144 --source <branch> --sentence "<문장>" --run`.
  `--allow-push`·`--allow-bypass` 는 주지 않는다(원격은 계속 별도 승인).
