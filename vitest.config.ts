import { defineConfig } from 'vitest/config'
import { SHARED_TEST_CONFIG, ALL_TESTS_GLOB } from './vitest.shared'

/**
 * 단일 프로젝트 실행용 base config(`npx vitest run <file>` 등).
 *
 * 🔴 인프라 값은 `vitest.shared.ts`가 SSOT다 — 여기에 값을 직접 적지 않는다.
 * 🔴 `vitest.workspace.ts`의 두 프로젝트는 이 파일을 **`extends` 하지 않는다**.
 *    상속하면 vitest가 `include` 배열을 이어붙여 계층 분리가 무너진다(상세는 vitest.shared.ts).
 *    두 프로젝트도 같은 `SHARED_TEST_CONFIG`를 import해서 쓴다.
 */
export default defineConfig({
  test: {
    ...SHARED_TEST_CONFIG,
    include: [ALL_TESTS_GLOB],
  },
})
