# REQ-2026-076 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: 이 REQ는 **워크플로 한 줄 + 문서**라 한 phase다.

## Phase 1 — 잡 타임아웃 · 문서 (`phase-1-job-timeout`)

범위(DEC-1·DEC-2·DEC-3): `.github/workflows/ci.yml` · `docs/development.md`/`.en.md` · `CHANGELOG.md`.

순서:
1. `build` 잡에 `timeout-minutes: 20`을 둔다(스텝별이 아니라 **잡 전체** — DEC-1).
   🔴 값의 근거를 주석으로 남긴다: 실측 최장 windows **7.0분**의 약 3배이며,
   더 낮추면 러너 변동으로 **거짓 red**가 난다는 것.
2. `docs/development.md`/`.en.md`에 적는다:
   - 상한 값과 **왜 그 값인지**
   - 🔴 **두 번째 목적** — 진행 중인 잡은 로그를 받을 수 없고, 타임아웃으로 **종료돼야** 로그가 나온다.
     값을 올리려는 사람이 이 사실을 알아야 한다(DEC-3).
3. `CHANGELOG.md` — 실측으로 적는다(기본 360분 · 관측된 교착 35분+·13.6분+ · 정상 최장 7.0분).

Exit:
- 워크플로 YAML 유효 · 잡 이름 불변(required checks 영향 없음)
- `docs:lint` green
- 🔴 **CI 9잡 green** — 이 변경이 **정상 실행을 죽이지 않는다**는 것이 유일하게 지금 검증 가능한 속성이다.
  "교착을 실제로 잡는다"는 다음 교착 때 관측된다(DEC-4 — 검증되지 않은 상태임을 인정한다).
- Codex 승인

## 완료
- 게이트 해당분 · 사용자 main 통합(통제점 승인 필요).
- 🔴 후속(별도 REQ): macos node 18 `esbuild` 고아 프로세스 근원 원인.
  이 REQ가 만든 **로그 접근성**이 그 조사의 전제다.
