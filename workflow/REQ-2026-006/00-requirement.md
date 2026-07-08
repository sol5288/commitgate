# REQ-2026-006 요구사항 — resume sandbox (R9)

## 무엇을
Codex phase 리뷰의 **resume 라운드에도 read-only 샌드박스**를 강제한다. 현재 어댑터는 exec(1라운드)에만 `--sandbox read-only`를 붙이고 resume에는 붙이지 않아, read-only 리뷰어 불변식이 첫 라운드에만 성립한다(안전 갭).

## 왜
resume 라운드에서 리뷰어가 기본(쓰기 가능) 정책으로 돌면 repo 밖($HOME/tmp/네트워크)에 부수효과를 낼 수 있고, 사후 검사(git write-tree·worktree)는 repo 내부 net 변경만 잡는다.

## Spike 결과 (2026-07-09, codex-cli 0.141.0) — 선행 확인 완료
- `codex exec resume <thread> --sandbox read-only` → **거부**: `error: unexpected argument '--sandbox' found`. resume는 `-s/--sandbox` 플래그를 받지 않는다(exec만 받음). 기존 "0차 실측: resume은 --sandbox 미수용" 주석이 현행에도 유효.
- **대안 발견**: `codex exec resume <thread> -c sandbox_mode="read-only"` → **수용**(`turn.completed`, exit 0). resume는 `-c/--config` 오버라이드를 받으며, sandbox mode 값은 `read-only | workspace-write | danger-full-access`.
- 결론: **R9의 목표(resume read-only)는 플래그가 아니라 `-c sandbox_mode="read-only"`로 달성 가능** → 구현 대상(문서화 제한 아님).

## 남은 검증(구현 phase에서)
- `-c sandbox_mode="read-only"`가 **수용을 넘어 실제로 쓰기를 차단**하는지 행동 검증(리뷰어가 repo 밖 쓰기 시도 → 차단 확인). accepted ≠ enforced 이므로 필요.

## 완료 기준
- resume 경로가 `-c sandbox_mode="read-only"`로 read-only 강제.
- 어댑터 테스트를 resume에 sandbox 강제 반영하도록 갱신([req-adapters.test.ts](../../tests/unit/req-adapters.test.ts)의 "resume: --sandbox 없음" 고정을 교체).
- vitest·tsc·design/phase CommitGate 승인.
