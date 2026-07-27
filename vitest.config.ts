import { defineConfig } from 'vitest/config'

// 이 패키지의 req:* 단위 테스트는 순수(DB·네트워크 무의존).
// palm-kiosk-app의 setupFiles(.env·DB 가드)·alias는 불필요 → 최소 config.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    reporters: ['default'],
    // REQ-2026-049: 전역/시스템 git config 차단. 테스트가 만드는 저장소는 **repo-local identity**로만
    // 커밋해야 한다 — 전역에 기대면 로컬은 통과하고 CI(전역 identity 없는 러너)에서만 터진다.
    setupFiles: ['tests/setup/git-hermetic.ts'],
    // REQ-2026-044: init/uninstall/migrate 테스트는 임시 repo에서 `commitgate` 프로세스를 스폰한다.
    // 그때 파일 병렬을 **기본값(= CPU 코어 수만큼 동시)**으로 두면 스폰들이 겹쳐, 리소스가 빠듯한
    // 러너(CI macos·node18·로컬 Windows)에서 `npm test`가 hang한다(어서션 실패가 아니라 교착).
    //
    // REQ-2026-075: 그 해결이 `fileParallelism: false`(병렬 0)였는데, **그 사이의 값**이 시도되지 않았다.
    // hang 조건은 `동시 워커 수 × 워커당 스폰`이고 **워커 상한이 그 곱을 묶는다.**
    // GitHub 러너는 4 vCPU이므로 그 **절반**에서 멈춘다 — 코어 수에 닿으면 위 hang 조건으로 되돌아간다.
    //
    // 실측(2026-07-27 · 로컬 12코어 win32 · 47파일 2237 tests):
    //   fileParallelism:false  507초 · maxWorkers:2  310초(1.64×) — 둘 다 pass, hang 없음.
    //
    // 🔴 되돌리려면 이 두 줄을 지우고 `fileParallelism: false`로 복귀하면 현행 동작과 정확히 같아진다.
    maxWorkers: 2,
    minWorkers: 1,
  },
})
