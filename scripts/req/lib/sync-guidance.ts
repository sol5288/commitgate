/**
 * sync 백필 안내 가드(REQ-2026-125 DEC-1) — 순수 규칙.
 *
 * `sync`의 기본은 dry-run이므로, gitignore 백필을 안내하는 문장이 `--apply` 없는 명령을 제시하면
 * 소비자가 복사-실행해도 아무 파일도 바뀌지 않는다(0.21.0에서 실제 배포된 결함). 규칙은 의도적으로
 * 줄 단위다: `sync --gitignore`를 포함하는 줄은 같은 줄에 `--apply`도 포함해야 한다. 과거 CHANGELOG의
 * `sync --gitignore [--apply]` 같은 정당한 표기는 같은 줄에 `--apply`가 있어 통과한다.
 *
 * 🔴 일반 문서 스캐너로 키우지 말 것 — 손수 명세한 검증 오라클은 nitpick 바닥이 없다(REQ-2026-044 폐기 전례).
 */
export const SYNC_GITIGNORE_PATTERN = 'sync --gitignore'

/** 위반한 줄 번호(1-기반)를 반환. `--apply`가 같은 줄에 있으면 통과. */
export function syncGuidanceViolations(lines: readonly string[]): number[] {
  const out: number[] = []
  lines.forEach((line, i) => {
    if (line.includes(SYNC_GITIGNORE_PATTERN) && !line.includes('--apply')) out.push(i + 1)
  })
  return out
}
