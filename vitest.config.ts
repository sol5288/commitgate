import { defineConfig } from 'vitest/config'

// 이 패키지의 req:* 단위 테스트는 순수(DB·네트워크 무의존).
// palm-kiosk-app의 setupFiles(.env·DB 가드)·alias는 불필요 → 최소 config.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    reporters: ['default'],
  },
})
