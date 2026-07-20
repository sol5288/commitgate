import { defineConfig } from 'vitest/config'

// 이 패키지의 req:* 단위 테스트는 순수(DB·네트워크 무의존).
// palm-kiosk-app의 setupFiles(.env·DB 가드)·alias는 불필요 → 최소 config.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    reporters: ['default'],
    // REQ-2026-044: init/uninstall/migrate 테스트는 임시 repo에서 `commitgate` 프로세스를 스폰한다.
    // 전체 스위트를 파일 병렬로 돌리면 이 스폰들이 겹쳐, 리소스가 빠듯한 러너(CI macos·node18·로컬 Windows)에서
    // `npm test`가 hang한다(어서션 실패가 아니라 교착). 파일을 **직렬** 실행해 그 hang을 제거한다 — 약간 느리지만 결정적.
    fileParallelism: false,
  },
})
