# REQ-2026-125 리뷰 요청

## 배경

0.21.0 릴리스 검수에서 확인된 소비자 노출 안내 결함 3건의 긴급 정정이다(0.22.0에 포함, 별도 0.21.1 없음).

1. gitignore 백필 안내가 dry-run 명령(`sync --gitignore`, `--apply` 누락)을 제시 — 복사-실행하면 무효.
2. `--github-ci` 옵션·문구가 "실행"으로 읽히지만 구현은 check-runs 1회 조회(dispatch 없음).
3. 0.20/0.21 → 0.22 업그레이드 절차 문서 부재(소비자 3곳 전부 0.20.0·caret가 minor를 안 넘음).

## 변경 요약

- Phase 1: 백필 안내에 `--apply` 반영(런타임 경고·CHANGELOG 0.21.0 안내·troubleshooting 표) +
  줄 단위 동반 규칙 가드(`sync --gitignore` 줄은 같은 줄에 `--apply` 필수, workflow/·tests/ 제외).
- Phase 2: `--check-github-ci` 정식화, 기존 `--github-ci`는 deprecated alias(의미 동일=조회),
  `CI_PROMPT`를 조회 문구로, 축자 인용 문서·help 동반 갱신.
- Phase 3: `docs/upgrade.md`/`.en.md`에 0.22 절(이 시점에 참인 내용만 — 미구현 선서술 금지).

## 리뷰 포인트

- 가드 규칙이 과거 CHANGELOG의 정당한 표기(`sync --gitignore [--apply]`)를 위양성으로 잡지 않는가.
- alias 해석 순서(alias 정규화 후 충돌 검사)가 기존 동시 지정 오류 계약을 보존하는가.
- 하위호환: `VerifyRunRow.ci` 값 4종·exit 계약 불변 확인.
