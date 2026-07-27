# REQ-2026-073 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

## Phase 1 — 거짓 보장 제거 + 회귀 가드 (`phase-1-false-guarantees`)

범위(DEC-1·DEC-3): `docs/configuration.md`/`.en.md` · `docs/workflow.md`/`.en.md` · 테스트 1종.

순서:
1. `workflow.md`/`.en.md`의 앞쪽 인용 블록(28~33 / 30~34)에서 거짓 두 문장을 뺀다.
   - "기본값은 매 phase 커밋 전에 멈춘다" → 기본값은 **`req`**.
   - "HIGH 티켓은 정책과 무관하게 매 phase 확인" → **삭제**하고 정본 절로 보낸다.
   - 🔴 그 자리에 남기는 것은 **한 문장 + 링크**다(DEC-1). 설명을 복제하면 또 갈라진다.
2. `configuration.md`/`.en.md` 15·16행의 거짓 절을 실제 계약으로 바꾼다.
   - `stopGate` 값의 뜻은 **여기 유지**(설정 참조표) · 확인 지점 상세는 정본 링크.
   - `phaseCommit` alias 행에서도 "HIGH는 어느 값에서도 매 phase" 제거.
   - 🔴 `"all"` 값이 없다는 설명의 **이유가 바뀐다**: 예전엔 "HIGH livelock 방지"였는데
     이제 HIGH도 자동 커밋되므로 그 근거는 성립하지 않는다. `stopGate`가 의미 축이라
     alias에 새 값을 늘리지 않는다는 이유로 고친다.
3. `tests/unit/docs-stale-claims.test.ts` — 되살아나면 안 되는 **고정 문장 목록**(한/영)이
   문서 어디에도 없음을 확인한다.
   - 🔴 스캐너가 아니다(DEC-3). 리터럴 목록 + 영문 대응. 새 결함을 발명하지 않는다.
   - 🔴 **이 테스트가 실제로 무언가를 잡는지 확인한다**: 목록의 문장을 문서에 되돌려 넣으면
     실패해야 한다(변이 검사 — REQ-071 phase-4에서 동어반복 테스트로 P1을 맞은 직후다).

Exit: `npm test` green · `docs:lint` green · 수용기준 1·2 · Codex 승인.

## Phase 2 — README 시작 절차·`stopGate` 소개 (`phase-2-readme`)

범위(DEC-4): `README.md` · `README.en.md`.

순서:
1. "3분 시작"을 **install → init → setup** 3단계로 만든다.
   🔴 setup을 건너뛰면 `req:new`가 **막힌다**는 사실과, **사람이 터미널에서 직접** 실행한다는
   제약(대화형 전용 — 에이전트가 실행하면 즉시 종료)을 함께 적는다.
2. `stopGate` 선택을 **한 문장 + 링크**로 소개하고 기본값 `req`의 뜻을 말한다.
   랜딩에 표를 넣지 않는다(DEC-4 — 표는 `workflow.md` 정본에 있다).
3. 자주 쓰는 명령표에 `req:confirm` **하나만** 추가한다.
4. 🔴 docs 링크는 **절대 blob URL**(D5-b) — 상대 링크는 npm 페이지에서 깨지고 `docs:lint`가 못 잡는다.

Exit: `docs:lint` green · 수용기준 3·4 · Codex 승인.

## Phase 3 — setup 문답·보장 계약·에이전트 가이드 (`phase-3-guides`)

범위: `docs/quick-start` · `docs/guarantees` · `docs/agent-prompt` 각 ko/en (6파일) · CHANGELOG.

순서:
1. quick-start: setup이 **무엇을 묻는지** — 3문항(`reviewModel`·`reviewReasoningEffort`·`stopGate`) ·
   ↑/↓ 선택 + Enter 확정 + Ctrl+C 취소 · 기본값 `gpt-5.6-terra` / `medium` / `req` ·
   모델 3종(`sol`·`terra`·`luna`)과 "직접 입력" 항목.
2. guarantees: **보장**에 "HIGH 위험 티켓은 `stopGate`가 정한 지점에서 사람 확인을 요구한다"를 넣고,
   🔴 **보장하지 않는 것**에 "매 phase 확인 백스톱은 **더 이상 없다**"와
   되돌리는 법(`stopGate: "phase"`)을 적는다(DEC-2).
3. agent-prompt: `setup`은 **사람 전용 명령** — 에이전트는 실행하지 않고 사용자에게 요청한다.
   `req:confirm`도 같은 성격(사람의 판단을 기록하는 명령)임을 적는다.
4. CHANGELOG에 문서 갱신을 적되, **안전 속성 완화의 문서 반영**임을 앞세운다.

Exit: `docs:lint` green · 수용기준 5·6·7·8 · Codex 승인.

## 완료
- 게이트 해당분 · 사용자 main 통합(통제점 승인 필요 — 이 세션의 이전 사전승인은 REQ-071 브랜치에 한정됐다).
