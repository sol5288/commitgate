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
  // ── REQ-2026-130(0.22 REQ F) 추가 — 2026-08-10 실측에서 fast 잔존 상위였던 실 git **회복·결속**
  //    테스트 3파일. "느리면 전부 이동"이 아니다: 같은 부류 중 secret-scan-wiring(리뷰 직전 게이트
  //    배선·fake reviewer 주입)은 **대표 wiring으로 fast에 남긴다** — fast만 돌려도 리뷰 게이트
  //    배선 회귀는 잡힌다. 아래 3개는 복구/터미널 상태 재구성 성격이라 통합 계층 정의에 맞다.
  'tests/unit/rebind-reentry.test.ts', // ~39,000ms — 티켓 재결속 회복(테스트마다 새 repo·의도적 격리)
  'tests/unit/doctor-stranded-evidence.test.ts', // ~23,000ms — trunk 미도달 증거(D30) 실 git 재구성
  'tests/unit/doctor-terminal-wiring.test.ts', // ~24,000ms — 종결 상태 doctor 배선(rebind 포함)
  // ── 0.22.0 RC 보완 추가 — CAS 병합·ref 표류는 **실 git 없이는 증명할 수 없다**(fake git으로는
  //    update-ref의 compare-and-swap 거부·merge 부모 구조를 흉내 낼 뿐 검증이 되지 않는다).
  //    테스트마다 새 임시 저장소를 만들고 git을 여러 번 스폰한다 → 정의상 통합 계층이다.
  'tests/unit/integration-coordinator.test.ts',
  // ── 0.22.0 2차 보완 — 계층 선택을 **실행해서** 확인하는 가드가 생겼다(`vitest list` 스폰 2회).
  //    구조 검사만 하던 예전 가드는 `extends`의 include 병합을 놓쳐 integration이 전체를 돌게 했다.
  //    자기 자신이 목록에 들어가는 것이 맞다 — 이 파일도 프로세스를 스폰하기 때문이다.
  'tests/unit/test-tiers.test.ts',
]
