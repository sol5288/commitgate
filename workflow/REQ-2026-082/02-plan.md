# REQ-2026-082 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

## Phase 1 — `--help` ↔ dispatch 정합 (`phase-1-cli-help`)

범위 (DEC-7):
- `bin/init.ts` 도움말 — 사용법 블록에 `setup`·`check`·`sync`·`quickstart`·`delivery` 등록.
- 같은 파일 "설치 후" 순서에 **setup 삽입** — 현재 순서는 setup 없이 `req:new`로 가서 막힌다.
- `tests/unit/init.test.ts` — `VERB_MODULES`의 비-`req:` 키가 전부 도움말에 등장함을 단언(교차 검증).

Exit: eslint0·typecheck0 · 단위 그린 · Codex phase 리뷰 승인.

## Phase 2 — 랜딩 README 개편 ko/en (`phase-2-readme`)

범위 (DEC-1~6 · DEC-8 · DEC-10~12):
- 준비물 표 Codex CLI 행에 **비용·로그인** 사실 (DEC-1).
- 리뷰 상한(자동 5 / 예외 6~8 / 9부터 차단)을 다이어그램 근처에 (DEC-1 후반).
- **승인 문장 실물** 한 턴 예시 (DEC-2).
- 설치 커밋 **실행 블록 3줄 + 금지 이유** (DEC-3).
- 시작 조건 → **행동**(`git init`·`npm init -y`) (DEC-4).
- **막혔을 때** 절 신설 — `check` 1차 도구 + 흔한 실패 3종 (DEC-5).
- 명령표를 `req:*` / `npx commitgate <verb>` **두 표로** 분리 (DEC-6).
- **용어 접이식 사전** (DEC-8).
- `check` **실측 출력** 블록 (DEC-10).
- 상단 **3갈래 바로가기** · **Node 20+ 배지** · ASCII 다이어그램 세로 압축 (DEC-11).
- 제거 계획 미리보기 한 줄 (DEC-12).

🔴 불변식: 안전 4문구 바이트·위치, 보장/비보장 표와 경고 2건의 설치 前 배치, docs 절대 blob URL (DEC-9).

Exit: `npm run docs:lint` 그린 · `readme-landing` 테스트 그린 · 단위 그린 · Codex phase 리뷰 승인.

## Phase 3 — docs 정합 (`phase-3-docs-sync`)

범위:
- `docs/quick-start.md`/`.en.md` 준비물 표 — 랜딩과 **같은 비용 진술**(문서 skew 방지).
- `CHANGELOG.md` Unreleased.

Exit: `docs:lint` 그린 · 단위 그린 · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(unit·typecheck·lint) · 사용자 main 머지(별도 승인).
