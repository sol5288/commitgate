# REQ-2026-078 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

## Phase 1 — 한국어 랜딩 앞부분 (`phase-1-readme-ko`)

범위(DEC-1~DEC-5): `README.md`의 `## CommitGate란?` · `## 무엇을 보장하고, 무엇은 보장하지 않나`.

순서:
1. 흐름도를 **루프 + 관문** 형태로 다시 그린다(DEC-1).
   - 🔴 되돌아가는 화살표가 **그림 안에** 있을 것 · 폭 80자 이하 · 박스 내부 ASCII 전용.
   - 🔴 사람은 **루프 밖·아래**(DEC-2) — "매 커밋마다 확인"으로 읽히면 안 된다.
   - 명령 이름(`req:*`)을 그림에서 뺀다(DEC-4).
2. 리드 문단을 일상어로 다시 쓴다 — "AI가 고친 코드는 **다른 AI의 검사를 통과해야만** 저장된다".
3. 보장/비보장 표와 경고 2건: **4문구는 바이트 그대로 두고 풀이를 덧붙인다**(DEC-3·DEC-5).
   🔴 경고의 세 사실(전문 전송 · diff 밖 파일도 읽힘 · 우회 가능)이 사라지지 않았는지 확인한다.
4. 🔴 **검증**: `npx vitest run tests/unit/readme-landing.test.ts` 통과.
   테스트를 고쳐야 한다면 4문구를 건드린 것이므로 **설계 위반**이다 — 문서를 되돌린다.
5. 내부 용어 잔존 검사: 앞부분에 `P1`·`stale`·`AWAIT_HUMAN`·`fail-closed`(풀이 없는 단독 등장)·
   `staged tree`·`git add`·`--sandbox`가 남아 있지 않은지 훑는다.

Exit: `readme-landing` 테스트 green · `docs:lint` green · 수용기준 1~5 · Codex 승인.

## Phase 2 — 영문 + CHANGELOG (`phase-2-readme-en`)

범위(DEC-6 준용): `README.en.md` · `CHANGELOG.md`.

순서:
1. phase-1에서 확정한 **그림과 절 구성 그대로** 영문에 적용한다(바이트 동일이 아니라 같은 구조).
   🔴 라벨 길이가 달라 박스 테두리가 어긋나지 않게 폭을 다시 맞춘다.
2. 영문 안전 4문구도 **바이트 그대로** 유지 + 풀이 추가(`readme-landing` 테스트가 양쪽을 본다).
3. CHANGELOG — 🔴 "쉽게 고쳤다"가 아니라 **무엇이 틀렸었는지**를 적는다
   (흐름도가 매 커밋 사람 확인으로 읽혔고, 그건 기본값과 다르다).

Exit: `npm test` green · `docs:lint` green · 한/영 구조 일치 · Codex 승인.

## 완료
- 게이트 해당분 · 사용자 main 통합(통제점 승인 필요).
