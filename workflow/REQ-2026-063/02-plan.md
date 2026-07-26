# REQ-2026-063 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

## Phase 1 — stopGate 축 도입 (`phase-1-axis`)

범위(설계 DEC-1~DEC-5): `scripts/req/lib/config.ts` · `workflow/req.config.schema.json` ·
`tests/unit/req-config.test.ts`. 코드 3파일. **소비 지점을 건드리지 않으므로 행동 변화 0.**

순서:
1. `StopGate` 타입(`'phase' | 'req'`) + 양방향 매핑 상수.
2. `CONFIG_SCHEMA.stopGate` + `workflow/req.config.schema.json` **같은 커밋에서** 확장(DEC-4).
   🔴 enum은 **2값만** — `merge`는 동작 없는 선택지라 넣지 않는다(DEC-5).
3. 해소: DEC-3 표대로. `ResolvedConfig`는 `stopGate`와 `phaseCommit`을 **둘 다** 갖는다.
4. 🔴 충돌 검사는 **raw key 명시 여부** 기준(DEC-2). 해소값 비교는 `stopGate`만 쓴 정상 설정을
   오탐해 **새 축을 아무도 못 쓰게** 만든다 — 이 오탐을 회귀 테스트로 고정한다.
5. 테스트: 수용기준 1~5(동일 동작 2건 · legacy 무회귀 · 신축 단독 통과 · 모순 거부).
6. 🔴 **충돌 오류 진단 oracle**(DEC-2b · 수용기준 5): 모순 거부만 단언하면
   `throw new Error('설정 충돌')`짜리 구현도 통과한다. 메시지가 **두 키의 실제 값**과
   **기대 매핑**과 **해결 방법**을 담는지까지 단언한다.

Exit: typecheck 0 · `npm test` green · Codex phase 리뷰 승인.

## Phase 2 — setup 질문 (`phase-2-setup-question`)

범위(설계 DEC-6·DEC-7): `bin/setup.ts` · `tests/unit/setup.test.ts`. 코드 2파일.

순서:
1. `SETUP_KEYS`에 `stopGate` 추가(질문 3개). 검증은 기존 `subSchemaFor` 경로 그대로 —
   enum이 늘면 선택지가 자동으로 따라간다.
2. 🔴 질문 화면에 **"HIGH 위험 티켓은 어느 값에서도 매 phase 확인합니다"**를 명시(DEC-6).
   이 고지가 없으면 `req`를 고른 사용자가 HIGH 티켓에서 멈출 때 도구가 고장 난 것으로 오해한다.
3. `-`(비움) 입력이 거부되는지 확인(DEC-7 — 스키마에 `null`이 없으므로 기존 경로가 자동 거부).
4. 질문 순서·기본값(현재 값 유지)이 기존 두 질문과 같은 규칙을 따르는지 확인.
5. 🔴 **legacy alias 정규화**(DEC-6b): `stopGate`를 기록할 때 **같은 원자적 쓰기에서 `phaseCommit`을 삭제**한다.
   `mergeConfigText`에 삭제 키 목록을 넘기는 형태. `stopGate` 패치가 없으면(Enter 유지) 삭제도 하지 않는다.
6. 🔴 **필수 회귀 테스트**: 기존 `{phaseCommit:{autoApprove:'low-only'}}` 프로젝트에서 setup이 `phase`를
   고른 결과 파일이 **`loadConfig`를 통과**하는지 단언한다. 이 계약이 없으면 setup의 정상 경로가
   phase-1이 만든 충돌 게이트에 스스로 걸려 **프로젝트를 벽돌로 만든다**.

Exit: typecheck 0 · `npm test` green · 수용기준 6 충족 · Codex phase 리뷰 승인.

## Phase 3 — 문서 (`phase-3-docs`)

범위: `docs/configuration{,.en}.md` · `docs/workflow{,.en}.md`(있으면) · `CHANGELOG.md`. 코드 변경 0.

순서:
1. configuration: `stopGate` 표 항목 + `phaseCommit`을 **deprecated alias**로 표기 + 모순 시 거부 규칙.
2. **HIGH는 어느 값에서도 매 phase 확인**을 문서에도 적는다(설정 화면과 같은 문장).
3. CHANGELOG: **앞 phase 구현을 커밋·파일·심볼 단위로** 가리킨다(docs-only phase 오탐 전례).
4. 🔴 `merge`가 아직 없다는 것과 그 이유(delivery set 필요)를 적어, 사용자가 찾다가 없다고 헤매지 않게 한다.

Exit: `docs:lint` green · typecheck 0 · `npm test` green · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(unit·typecheck·docs:lint) · 사용자 main 통합(별도 승인).
- 🔴 **단독 릴리스 금지** — REQ-2026-060~062와 함께 원장 감사 REQ 뒤에 버전을 붙인다.
