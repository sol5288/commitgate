# REQ-2026-164 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **테스트 실행 계층(REQ-2026-100)**: 게이트는 테스트를 **실행하지 않는다**.
> phase 중에는 **변경한 소스를 import 하는 테스트만**, **전체 스위트는 통합 직전 1회**(~17분).

## Phase 1 — 축 등록부 + 정본 문서 (`phase-1-axis-registry`)

범위: `scripts/req/lib/upgrade-axes.ts`(신규) · `docs/upgrade.md` · `docs/upgrade.en.md` ·
`tests/unit/upgrade-axes.test.ts`(신규).

- 등록부에 8축을 담는다: vendored 스키마 · `workflow/.gitignore` · `req:*` 명령 표면 · 관리 블록 ·
  `AGENTS.md` 계약 문구 · **혼합(mixed) 설치** · persona · caret 범위.
  🔴 D19 는 `mixed` 만 WARN 한다(순수 Stage A 는 OK) — 축 이름을 사실에 맞춘다(설계 DEC-4).
- 각 축은 `diagnostics`(`check`|`command`|`none` 판별 합집합)와 `remedy` 를 갖는다.
  caret = `[{kind:'none'}]` · persona = `[{kind:'command', …}]` — **빈 배열은 금지**(설계 DEC-4).
- `UPGRADE_SUMMARY_COMMAND` · `UPGRADE_CANONICAL_DOC` 상수도 여기서 나온다(README 가드의 유일 출처).
- 한/영 `upgrade` 문서에 `<!-- commitgate:upgrade-axes -->` 마커로 감싼 **축 표 한 개**를 추가한다.
- 가드(설계 DEC-2): ① 진단 id **실재**(`D_CHECK_IDS`/`check` 항목) ② 마커 쌍·표 구역 존재
  ③ **축별 행**이 그 축의 `diagnostics` 전부(`check`→id · `command`→명령 · `none`→"진단 없음") +
  `remedy` 핵심 명령을 담음 ④ 등록부의 `diagnostics` 가 **비지 않음** ⑤ 표 행 개수 == 등록부 축 개수.

Exit: typecheck 0 · 신규 테스트 그린 · **변이 검사 3종**(ⓐ 축 추가 후 문서 미갱신 → red ·
ⓑ 등록부의 진단 id 를 다른 실재 id 로 바꿔도 문서 미갱신 → red · ⓒ 축 정보를 표 밖 산문으로 옮기면 → red) ·
`npm run docs:lint` 그린 · Codex phase 리뷰 승인.

## Phase 2 — README 정합 (`phase-2-readme-parity`)

범위: `README.md` · `README.en.md` · 가드 확장.

- 업그레이드 스니펫·명령표를 `UPGRADE_SUMMARY_COMMAND` 와 **같은 문자열**로 맞춘다.
- README 는 절차를 복제하지 않고 요약 + 정본 링크만 둔다(설계 DEC-3).
- README 업그레이드 구역을 `<!-- commitgate:upgrade-summary -->` 마커로 감싼다.
- 가드(설계 DEC-3): 그 구역이 ① `UPGRADE_SUMMARY_COMMAND` 를 그대로 담음 ② 정본 링크를 담음
  ③ **표 문법(`|---`)이 없음** ④ `npx commitgate …` 명령이 **요약 하나뿐**.

Exit: typecheck 0 · 가드 그린 · `npm run docs:lint` 그린 · **변이 검사 4종**(ⓐ 요약 명령을 다른 문자열로 바꾸면 red ·
ⓑ 정본 링크를 지우면 red · ⓒ **마커를 뺀 채** 축 표를 복제하면 red · ⓓ 명령을 하나 더 늘어놓으면 red) · Codex phase 리뷰 승인.

## Phase 3 — CHANGELOG (`phase-3-changelog`)

범위: `CHANGELOG.md` Unreleased.

Exit: Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(typecheck·docs:lint) · **통합 직전 전체 스위트 1회** · 사용자 main 머지(별도 승인).
