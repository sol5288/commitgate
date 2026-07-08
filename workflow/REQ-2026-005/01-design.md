# REQ-2026-005 설계 — observations(비차단 코멘트 채널)

> design-first. 코드는 아직 없음. 이 문서는 접근(설계 결정)을 심사받기 위한 것.

## 현재 상태(변경 대상)
- `workflow/machine.schema.json`(v1.1): `findings`만 존재. `commit_approved=yes + findings 있음`은 R10에서 invalid(fail-closed).
- `scripts/req/review-codex.ts`: `Verdict`/`Finding` 타입, `classifyReview`(findings 존재 기반 outcome), `printOutcomeDetails`(findings/blocked/errors 표출).

## 핵심 설계 결정
1. **schema에 optional `observations` 추가** — root `required[]`에 넣지 않음(하위호환). `additionalProperties:false`라 properties에 추가해야 유효해짐. items = `{ detail: string, file: string|null }`, `additionalProperties:false`, required `[detail, file]`. **`severity` 없음** → severity 붙은 observation은 AJV가 구조적으로 거부(경계 강제).
2. **분류 로직 불변** — `classifyReview`는 `findings` 존재만 본다(observations는 무시). 따라서 PM 정책 매트릭스가 **추가 분기 없이** 이미 성립:
   - yes+findings=[] → approved / yes+findings → invalid(R10) / no+findings → needs-fix / no+findings=[]+observations → blocked.
   observations는 approval/blocking에 영향 없음(순수 정보).
3. **표출** — `printOutcomeDetails`가 observations를 **비차단 코멘트로 출력**(특히 approved에서도 보이게). 사용자가 승인된 리뷰의 코멘트를 놓치지 않게.
4. **schema version 1.1 유지** — additive optional이라 기존 아카이브 응답과 충돌 없음.

## Phase별 구현 (단일 phase)
- `phase-1-observations`: schema `observations` 추가 + `Observation` 타입 + `Verdict.observations` + `printOutcomeDetails` observations 표출 + 테스트(매트릭스·하위호환·severity 거부) + AGENTS/schema description.

## 변경 파일
`workflow/machine.schema.json`, `scripts/req/review-codex.ts`, `tests/unit/req-review-codex.test.ts`, `AGENTS.template.md`.

## 하위호환·안전
- version 1.1 유지 → 기존 1.1 아카이브(observations 없음) 그대로 유효(required 아님).
- fail-closed 불변: observations는 승인/차단 판정을 바꾸지 않는다. `no+findings=[]+observations`는 여전히 blocked(observations가 findings를 대체하지 않음).
- severity 미허용으로 blocking(findings=severity 有)/non-blocking(observations=severity 無) 경계 유지.
