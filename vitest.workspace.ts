/**
 * 테스트 계층 워크스페이스 (REQ-2026-122).
 *
 * 🔴 **`npm test`(`vitest run`)의 의미는 바뀌지 않는다** — 워크스페이스의 모든 프로젝트를 실행하므로
 *    fast ∪ integration = 전체다(집합 동일성은 `tests/unit/test-tiers.test.ts`가 추가로 고정).
 *    부분 실행은 opt-in이다: `npm run test:fast` · `npm run test:integration`.
 * 🔴 워커·타임아웃 등 인프라 값은 `extends`로 `vitest.config.ts`에서 상속한다 — 값 이원화 금지.
 */
import { defineWorkspace } from 'vitest/config'
import { INTEGRATION_TIER } from './tests/tiers'

export default defineWorkspace([
  {
    extends: './vitest.config.ts',
    test: {
      name: 'fast',
      exclude: ['**/node_modules/**', ...INTEGRATION_TIER],
    },
  },
  {
    extends: './vitest.config.ts',
    test: {
      name: 'integration',
      include: [...INTEGRATION_TIER],
    },
  },
])
