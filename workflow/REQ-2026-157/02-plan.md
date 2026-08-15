# REQ-2026-157 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고.
> 🔴 이 REQ 는 문서 8종 + 테스트 1개다. 축이 하나(=문서가 코드를 정확히 말하게 한다)이므로
> `max_files` 를 선언해 한 phase 로 간다.

> **테스트 실행 계층(REQ-2026-100)**: 게이트는 테스트를 **실행하지 않는다**.
> - **phase 진행 중**: 변경 영역 테스트 + `tests/unit/dispatch.test.ts` + `npm run docs:lint`.
> - **통합 직전 1회**: **전체 스위트**(`npm test`) + `bin/verify-range.ts --base main --head HEAD --strict`.

🔴 **선행**: 설계 승인 직후 `state.json` 의 `phases[]` 에 아래 id 를 선언한다.

```
phase-1-setup-docs-parity
```

## Phase 1 — setup 문서 정합 (`phase-1-setup-docs-parity`)

범위: 문서 8종(한/영 4쌍) + 회귀 가드 1개.

Exit — **사실 정정 5건**(전부 실측 근거가 요구 문서에 있다):
- 🔴 README(한/영)가 setup 질문을 **네 개**라고 말한다. 3단계 한 줄 설명에도 **리뷰 예산**이 들어간다.
- 🔴 quick-start(한/영)의 setup 질문 표가 **4행**이고, `stopGate` 선택지에 **`auto`** 가 있다.
- 🔴 quick-start(한/영)의 비용 고지가 "6~8회는 사람 예외 **필요**"라고 단정하지 않는다 —
  DEC-3 의 조건문 형식(기본값 / `auto` / **`hardCap` 백스톱**)을 쓴다.
- 🔴 guarantees(한/영)의 예산 보장이 같은 조건문 형식을 쓴다. **보장 문서에 설정 종속을 절대
  규칙처럼 적지 않는다.**
- 🔴 agent-prompt(한/영)의 setup 설명에 **리뷰 예산 정책**이 들어간다.

Exit — **초보자 기준**:
- 🔴 두 축(`stopGate`=안전 · `onSoftLimit`=비용)을 **구분해 설명**한다. quick-start 에 표로 둔다.
- 🔴 `auto` 옆에 **"리뷰 승인과 사람 확인은 그대로 — 바뀌는 것은 돈뿐"** 이라는 취지의 한 줄이 있다.
  (setup 프롬프트가 이미 "(비용 통제 — 안전 게이트가 아닙니다)"라고 말한다 — 문서도 같은 말을 한다.)
- 🔴 무엇을 고르면 무엇이 달라지는지를 **먼저** 말하고 설정 키는 괄호로 준다.

Exit — **중복 금지·정본**:
- 🔴 setup 4문항의 **상세 표는 quick-start 한 곳**에만 둔다. README·guarantees·agent-prompt 는
  한 줄 요약 + 링크다. (같은 표를 복제해서 갈라진 것이 이번 결함의 원인이다.)

Exit — **회귀 가드**(`tests/unit/setup-docs-parity.test.ts`):
- 🔴 **소스가 정본**이다: `buildQuestions(...)` 의 개수 ↔ quick-start(한/영) 표 행 수.
  `CONFIG_SCHEMA` 의 `stopGate` enum ↔ quick-start(한/영)가 나열한 선택지.
  🔴 문서끼리 비교하지 않는다 — 그러면 둘 다 틀린 채로 통과한다.
- 🔴 **표 행만 센다**(마크다운 표는 구조가 고정적이다). 산문을 정규식으로 파싱하지 않는다 —
  그 파서가 다음 결함이 된다(REQ-2026-041: 손수 검증 oracle 은 바닥이 없다).
- 🔴 **한/영이 같은 개수·같은 선택지 집합**을 말한다.
- 🔴 **변이 검사 3건**: ① quick-start 표에서 행 하나를 지우면 red ② `auto` 를 선택지에서 빼면 red
  ③ 영문판만 고치면 red(한쪽만 갱신하는 실수를 잡는다).

Exit — **무회귀**:
- 🔴 `npm run docs:lint`(remark-validate-links) 통과. README→docs 링크는 **절대 blob URL**(D5-b),
  docs 끼리는 상대 경로.
- 🔴 기존 문서 테스트(`docs-*`·`readme-*`)가 그대로 통과한다.
- 🔴 **코드·기본값·선택지는 한 줄도 바꾸지 않는다** — `git diff --stat` 에 `scripts/`·`bin/` 이 없다.

- 계약 스위트: `npx vitest run tests/unit/setup-docs-parity.test.ts tests/unit/dispatch.test.ts` +
  기존 문서 스위트 + `npm run docs:lint`
- Codex 승인.

## 완료
- 게이트 해당분 · **통합 직전 전체 스위트 1회 + `verify-range --strict`** · CHANGELOG.
- 🔴 CHANGELOG 는 **문서가 틀렸던 기간**을 감추지 않는다 — `onSoftLimit` 도입(REQ-2026-132) 이후
  설치·빠른 시작·보장 문서가 옛 3문항/수동 예외 전제를 유지했다.
- 통합은 `stopGate: "auto"` 다. 사전 위임 또는 `[B1]` direct push 를 사람이 승인한다.
