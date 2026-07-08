# REQ-2026-006 설계 — resume read-only via `-c sandbox_mode` (R9)

> spike 완료(00-requirement 참조). 이 문서는 구현 접근. **PM 승인 후 구현 phase 진행**(spike-first).

## 현재 상태(변경 대상)
- [adapters.ts](../../scripts/req/lib/adapters.ts) `createCodexReviewerAdapter.review`:
  - exec(1라운드): `['exec','--json','--sandbox','read-only','--output-schema',…]`
  - resume: `['exec','resume',<id>,'--json','--output-schema',…]` — **sandbox 미강제**.
- [req-adapters.test.ts](../../tests/unit/req-adapters.test.ts): "resume: --sandbox 없음"을 **고정**(현 동작 보증) → 변경 필요.

## 핵심 설계 결정
1. resume 경로에 `-c sandbox_mode="read-only"`를 추가한다(플래그 `--sandbox`는 resume에서 거부됨 — spike 확인). exec 경로는 현행 `--sandbox read-only` 유지(수용됨).
2. **행동 검증 선행**: 구현 전, `-c sandbox_mode="read-only"` resume이 실제로 repo 밖 쓰기를 차단하는지 라이브로 1회 확인(accepted≠enforced). 차단 확인되면 반영, 아니면 문서화 제한으로 강등.
3. 테스트: "resume에 sandbox 미강제" 고정 테스트를 "resume이 `-c sandbox_mode=read-only`를 포함"으로 교체.

## Phase별 구현 (단일 phase)
- `phase-1-resume-sandbox`: adapters.ts resume args에 `-c sandbox_mode="read-only"` 추가 + 어댑터 테스트 갱신 + 주석(0차 실측 노트) 갱신.

## 변경 파일
`scripts/req/lib/adapters.ts`, `tests/unit/req-adapters.test.ts`.

## 하위호환·안전
- exec 경로 불변. resume에 read-only 추가 = 리뷰어 권한 **축소**(안전 강화)라 기존 승인 로직·바인딩에 영향 없음.
- fail-closed: `-c`가 codex 버전에서 거부되면 resume 자체가 실패 → 리뷰 실패(fail-closed). spike에서 현행 수용 확인했으나 CLI 버전 회귀 대비 주석.
