# REQ-2026-042 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 8파일 이하 권고. 초과 시
> req:doctor가 D18 WARN(advisory). docs 9파일은 콘텐츠 이동이라 응집적(WARN 감수).

> **검증은 도구 위임(D5)** — 손수 oracle 없음. 검사 범위는 **phase 대상에만** 적용해 041의 phase-범위 모순을 없앤다.

## Phase 1 — docs/ 한국어 신설 (`phase-1-docs-ko`)

범위: `docs/quick-start.md`·`agent-prompt.md`·`workflow.md`·`guarantees.md`·`configuration.md`·`upgrade.md`·
`uninstall.md`·`troubleshooting.md`·`development.md`(한국어) 신설 — 현 README 상세를 **손실 없이 이동**(이동 맵
전수). docs↔docs·docs→저장소 루트 파일 링크는 **상대경로**. + `remark-validate-links`(devDep) 추가·설정, 이
단계 검사 대상은 **docs/ 한국어 파일**(D5-a).

Exit: **remark-validate-links 그린(docs 상대 링크·앵커 깨짐 0)** · Codex phase 리뷰 승인(내용 손실·왜곡 없음).

## Phase 2 — README.md 랜딩 재작성 (`phase-2-readme-ko`)

범위: `README.md`(한)를 D1 랜딩(~100~140줄)으로 재작성. README→docs 링크는 **GitHub 절대 blob URL**(D5-b).
안전 4문구를 D3대로 초반 배치. 중복 상세 제거. `CHANGELOG.md` Unreleased.
+ README docs-URL 검사(D5-b) 스크립트/테스트 + 안전 4문구 존재·위치 테스트(D5-c) 추가.

Exit: remark-validate-links 그린 · **README docs 절대 URL 검사 그린(owner/repo/branch 고정+파일 존재)** ·
**안전 4문구 존재+‘3분 시작’보다 앞 테스트 그린** · package-payload 등 doc 가드 통과 · Codex 승인.

## Phase 3 — 영문 미러 (`phase-3-en`)

범위: `docs/*.en.md`(영) + `README.en.md` 랜딩 재작성. 한↔영 구조 대응. 검사(a·b·c)를 영문에도 적용.

Exit: remark-validate-links 그린(en) · README.en docs-URL 검사 그린 · 안전 4문구(en) 존재+위치 그린 · Codex 승인.

## 완료

- 위 검사·기존 테스트 그린 · Codex 승인 · 사용자 main 머지(별도 통제점).
- 릴리스 0.9.3(tag/publish/release)은 별도 통제점 — 이 REQ 밖.
