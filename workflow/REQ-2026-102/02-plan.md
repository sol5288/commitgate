# REQ-2026-102 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

> **테스트 실행 계층(REQ-2026-100)**: 게이트는 테스트를 **실행하지 않는다**. 아래는 비용을 줄이기 위한 실행 시점 권고다.
> - **phase 진행 중**: 변경한 소스를 import하는 테스트만(빠른 피드백). 예: `grep -rl "<변경한 모듈>" tests/`
> - **통합(main 병합) 직전 1회**: **전체 스위트**. 범위 한정은 이것을 **대체하지 않는다** — 영향 분석은 놓친 회귀를 통과시킨다.

## Phase 1 — legacy 진단 정직성 (`phase-1-legacy-honesty`)

범위(코드 2파일 · 테스트 3파일 · 문서 1파일):

- `req-doctor.ts` — 입력 타입에 `'legacy'` 추가(DEC-2), `exempt` 분리(DEC-3), legacy 사유 문구를 **한 곳에서 생성**해 D2/D3/D11 공유(DEC-4), `main()` 매핑.
- `req-close.ts` — legacy 거부 사유 정정(DEC-5). 없는 명령을 안내하지 않는다.
- `tests/unit/req-doctor.test.ts` — DEC-6 ①면제집합 무변경(FAIL 유지) ②사유 노출 ③면제값 오염 없음 ④`null` 무회귀 ⑤레벨 불변.
- `tests/unit/doctor-terminal-wiring.test.ts` — DEC-6 ⑦ `main()`이 실제 legacy 티켓에서 `'legacy'`를 주입.
- `tests/unit/req-close.test.ts` — DEC-6 ⑥ 문구.
- `CHANGELOG.md` — Unreleased. 채택하지 않은 제안(면제·`--help`)과 그 근거도 적는다.

**런타임 동작 변경 0** — 면제 집합·레벨·조건 불변, 문구만 바뀐다.

Exit(실행 명령):
- `npx tsc --noEmit` → exit 0
- **변경 범위 단위 그린**: `npx vitest run tests/unit/req-doctor.test.ts tests/unit/doctor-terminal-wiring.test.ts tests/unit/req-close.test.ts`
- 변이 검사 2종: ① `'legacy'`를 면제 집합에 넣으면 DEC-6 ①이 실패 ② legacy 사유 문구를 지우면 DEC-6 ②가 실패
- 도그푸딩: 이 저장소의 실제 legacy 티켓에서 사유가 출력되는지 확인
- 전체 스위트는 **통합 직전 1회**
- Codex phase 리뷰 승인

## 완료
- 게이트 해당분(typecheck·해당 시 lint) · **통합 직전 전체 스위트 1회** · 사용자 main 머지(별도 승인).
