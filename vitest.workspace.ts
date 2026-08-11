/**
 * 테스트 계층 워크스페이스 (REQ-2026-122 · 0.22.0 2차 보완).
 *
 * 🔴 **`npm test`(`vitest run`)의 의미**: 워크스페이스의 모든 프로젝트를 실행하므로
 *    fast ∪ integration = 전체이고, **두 계층의 교집합은 0**이라 각 고유 파일이 정확히 한 번 돈다.
 *    부분 실행은 opt-in이다: `npm run test:fast` · `npm run test:integration`.
 *
 * 🔴 **`extends`를 쓰지 않는다.** vitest의 config 병합은 `include` 같은 배열을 덮어쓰지 않고
 *    **이어붙인다** — 그래서 예전 integration 프로젝트는 자기 목록에 base의 전체 글롭이 더해져
 *    77파일을 전부 돌았고, `npm test`가 고유 77파일을 138번 실행했다(fast 61 + integration 77).
 *    인프라 값은 `vitest.shared.ts`의 `SHARED_TEST_CONFIG`를 **명시적으로 spread**해 공유한다.
 *
 * 🔴 이 정의는 `tests/unit/test-tiers.test.ts`가 **구조 + 실제 파일 선택 실행**으로 함께 고정한다.
 */
import { defineWorkspace } from 'vitest/config'
import { INTEGRATION_TIER } from './tests/tiers'
import { SHARED_TEST_CONFIG, ALL_TESTS_GLOB } from './vitest.shared'

export default defineWorkspace([
  {
    test: {
      ...SHARED_TEST_CONFIG,
      name: 'fast',
      // 전체에서 통합 계층만 뺀다 = 여집합. exclude를 명시하므로 node_modules도 직접 적는다.
      include: [ALL_TESTS_GLOB],
      exclude: ['**/node_modules/**', ...INTEGRATION_TIER],
    },
  },
  {
    test: {
      ...SHARED_TEST_CONFIG,
      name: 'integration',
      // 목록에 등재된 파일 **뿐**. 글롭이 아니라 명시 목록이라 selection이 결정적이다.
      include: [...INTEGRATION_TIER],
    },
  },
])
