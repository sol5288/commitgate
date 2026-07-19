# REQ-2026-042 요구사항

README 전면 개편 — 랜딩 페이지 + docs/ 분리 (검증=도구 위임, REQ-2026-041 대체)

> **REQ-2026-041 대체(replace).** 041은 같은 목표였으나 설계 리뷰가 **손수 명세한 링크-검증 oracle**의
> 정밀도를 7라운드 미수렴으로 지적(URL핀·앵커 slug·안전문구 위치·phase 범위·모든 내부링크…). 042는 그
> **검증을 검증된 도구에 위임**해 그 nitpick 표면을 제거하고, 나머지 설계(이동 맵·구조·이중언어·안전 4문구)는
> 재사용한다. 041 브랜치는 감사 보존.

## 무엇을 / 왜

현재 `README.md`(~620줄)는 제품 소개·온보딩·운영 매뉴얼·제거·안전 계약·개발 현황을 한 화면에 섞어 초점이
흐리다(사용자 지적). **README=랜딩, 상세=`docs/`**로 재구성한다. 목표: **"30초 이해, 3분 시작"**, README 본문
~100~140줄.

## 완료 기준 (검증 가능)

- `README.md`가 랜딩 구조(제품 1줄·핵심 보장 3·3분 시작·작동 방식 1줄·자주 쓰는 명령 3~4·docs 허브·License)로
  재작성되고 ~100~140줄.
- 현 README 상세가 **손실 없이** `docs/`로 이동(아래 이동 맵 전부).
- 🔴 **핵심 안전 4문구가 README 초반에** 남는다: ① 리뷰 없인 커밋 불가 · ② staged diff가 외부(Codex/OpenAI)로
  전송 · ③ git hook 없음(우회 가능) · ④ 애매하면 fail-closed. → 자동 검증(존재 + '3분 시작'보다 앞 위치, 한/영).
- **모든 내부 링크·앵커가 유효**(깨짐 0). → **검증된 markdown 링크/앵커 도구**로 검사(손수 oracle 아님).
- `README.en.md`와 `docs/*.en.md`도 동일 구조(완전 이중언어 — REQ-041 D4 결정 A 계승).

## 제약

- **내용 손실·왜곡 금지**(순수 재배치, 특히 안전·계약 문구). **링크 무결성** 유지.
- **검증은 도구 위임**: 상대 링크·앵커(docs↔docs, docs→저장소 루트 파일 포함)는 **`remark-validate-links`
  등 검증된 도구**(devDep)로. 손수 slug/앵커 oracle을 명세하지 않는다(041 미수렴 원인 제거).
- **`docs/`는 `package.json:files`에 넣지 않는다**(npm tarball 비대화 방지, GitHub 전용). 그래서 **README→docs
  링크는 GitHub 절대 blob URL**이어야 npm 페이지에서도 해소된다(아래 D 참조).
- package-payload 등 기존 doc 가드 통과 유지.

## 비목표

- 내용 개작·최신화(사실 갱신) — 순수 재배치. 코드·런타임 변경 없음. 정적 사이트 생성 도입 없음.

## 콘텐츠 이동 맵 (현재 README.md 섹션 → 목적지) — REQ-041 재사용

| 현재 섹션 | 목적지 |
|---|---|
| 상단 ⚠️ 2경고 + Quick Start · 준비물 | README 랜딩(경고 요약) + `docs/quick-start.md` |
| 에이전트 프롬프트 예시 · 진입점 표 | `docs/agent-prompt.md` |
| req:next 루프·kind표 · 페르소나 · delta 재리뷰 · 설치가 하는 일 · companion · 수동 명령 · 명령어 요약 | `docs/workflow.md` |
| 무엇을 보장/보장하지 않는 것 · 지원 범위 | `docs/guarantees.md`(안전 계약 정본) |
| 업그레이드(0.x) · migrate | `docs/upgrade.md` |
| 제거하려면(전체) | `docs/uninstall.md` |
| FAQ | `docs/troubleshooting.md` |
| 현재 범위(개발·CI·로드맵) | `docs/development.md` |
| 설정(req.config.json) | `docs/configuration.md` |

## 대표 예시

npm/GitHub에서 README를 연 사람이 30초 안에 "무엇을 막아주는지" + 3분 시작을 파악하고, 더 필요하면 docs 허브
링크로 들어간다.
