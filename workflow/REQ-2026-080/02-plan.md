# REQ-2026-080 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

## Phase 1 — 런타임 요구·CI (`phase-1-runtime`)

범위(DEC-3·DEC-4): `package.json` · `.github/workflows/ci.yml` · `.github/workflows/hang-probe.yml`.

순서:
1. `package.json` — `engines.node`를 **`>=20`**으로.
   🔴 `package-lock.json`이 함께 바뀌는지 확인하고, 안 바뀌면 커밋하지 않는다.
2. `ci.yml` — 매트릭스를 **`[20, 22, 24]`**로. 잡 이름 형식은 그대로 둔다
   (`${{ matrix.os }} · node ${{ matrix.node }}`) — 형식까지 바꾸면 설정 갱신 부담이 커진다.
3. `hang-probe.yml` — `node_version` 입력 추가(기본 **22**), `node-version: ${{ inputs.node_version }}`.
   🔴 잡 이름에도 반영해 어떤 버전을 돌렸는지 결과에서 바로 보이게 한다.
4. `npm test` · `npx tsc --noEmit` · `npm run smoke`.

Exit: 로컬 green · 🔴 **CI 9잡 green** — 여기에 **Node 24가 처음 포함**된다(DEC-3).
새 실패가 나오면 **숨기지 않고 보고**한다 · Codex 승인.

## Phase 2 — 문서 (`phase-2-docs`)

범위(DEC-1·DEC-2): 아래 목록.

순서:
1. **준비물·요구 버전**: README ko/en · `docs/quick-start` ko/en — "Node.js 18.17+" → **"Node.js 20+"**.
2. **CI 설명**: `docs/development` ko/en · `docs/RELEASING.md` — 매트릭스 `[20,22,24]`.
3. **`docs/ssot-design/` 01·02·10·README** — "현재 사실" 갱신(DEC-1).
   🔴 **11·13은 건드리지 않는다** — 날짜가 붙은 검수 이력이다.
4. `CHANGELOG.md` — 🔴 **호환성 깨짐**을 앞세우고, DEC-2대로 **"고쳤다"가 아니라
   "지원하지 않는다"**로 쓴다. 교착의 근원 원인은 여전히 미해결임을 함께 적는다.
5. 🔴 **잔존 검사**: `grep`으로 Node 18 요구가 남았는지 훑는다.
   이력 문서(11·13)의 언급은 **남아 있어야 정상**이다 — 잔존 검사에서 그 둘을 제외한다.

Exit: `docs:lint` green · Node 18 요구 잔존 0(이력 제외) · Codex 승인.

## 완료
- 게이트 해당분 · 사용자 main 통합(통제점 승인 필요).
- 🔴 **사용자 조치**: branch protection의 required status checks에서 `… node 18` 제거,
  `… node 24` 추가(DEC-5). 하지 않으면 PR 경로가 없는 체크를 기다린다.
- 🔴 후속 판단: 이 변경은 **호환성 깨짐**이므로 릴리스 자리(0.12.0 등)를 사용자가 정한다.
