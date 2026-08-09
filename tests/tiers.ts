/**
 * 테스트 계층 목록의 SSOT (REQ-2026-122).
 *
 * **통합 계층** = 임시 저장소를 만들고 git/`commitgate` 프로세스를 스폰하는 테스트 파일.
 * 2026-08-10 실측(로컬 win32·maxWorkers 2·63파일·테스트 시간 합 1,449,954ms)에서
 * 아래 12파일이 **전체 테스트 시간의 91.2%**를 차지했다 — 분류 기준은 취향이 아니라 이 측정이다.
 *
 * 🔴 `vitest.workspace.ts`(fast/integration 프로젝트)와 `tests/unit/test-tiers.test.ts`(실재성·
 *    집합 동일성 가드)가 이 목록을 import한다 — 목록·정의·가드가 같은 원천을 본다.
 * 🔴 파일을 이동·개명하지 않는다(git 이력·역의존 grep 보존) — 분류는 목록으로만 한다.
 *    파일이 사라지면 가드가 red다(조용한 부패 금지). 비중이 변하면 재측정 후 갱신한다(측정일 명시).
 */
export const INTEGRATION_TIER: readonly string[] = [
  'tests/unit/init.test.ts', // 450,741ms
  'tests/unit/uninstall.test.ts', // 234,392ms
  'tests/unit/req-review-codex.test.ts', // 195,939ms
  'tests/unit/delivery-verbs.test.ts', // 151,233ms
  'tests/unit/req-close.test.ts', // 54,645ms
  'tests/unit/review-lifecycle-wiring.test.ts', // 53,415ms
  'tests/unit/req-new-intake.test.ts', // 51,689ms
  'tests/unit/reconstruct.test.ts', // 34,002ms
  'tests/unit/req-new.test.ts', // 28,797ms
  'tests/unit/doctor-retired-claims.test.ts', // 26,428ms
  'tests/unit/req-next.test.ts', // 22,161ms
  'tests/unit/req-commit.test.ts', // 19,199ms
]
