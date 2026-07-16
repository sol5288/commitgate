/**
 * commitgate bin verb dispatch — 순수 결정 로직(부작용 없음, 테스트 가능).
 *
 * `bin/commitgate.mjs`(register tsx·동적 import 부작용 포함)와 `tests/unit/dispatch.test.ts`가 공유한다.
 * 설계 D3(REQ-2026-014 Stage B):
 *   - 알려진 verb → 해당 모듈(verb 토큰 소비).
 *   - argv 없음 **또는 첫 인자가 `-` 옵션** → init에 argv 전체 전달(하위호환: `npx commitgate --dry-run` 등).
 *   - 그 외 비-옵션 미지 토큰 → `unknown`(호출부가 fail-closed).
 *
 * `migrate`는 **파일 생성과 동시에**(Phase 3) 등록했다. Phase 1이 미리 등록하지 않은 이유는, 등록만 하고 모듈이 없으면
 * 깨진 동적 import가 raw unhandled rejection으로 터지기 때문이다(`unknown` 분기의 친절한 1줄 오류가 낫다).
 */

/** verb → 대상 모듈(binDir 기준 상대). req:* 는 패키지의 scripts/req/*.ts 에서 실행(Stage B: 대상 프로젝트에 복사하지 않음). */
export const VERB_MODULES = {
  'req:new': '../scripts/req/req-new.ts',
  'req:next': '../scripts/req/req-next.ts',
  'req:review-codex': '../scripts/req/review-codex.ts',
  'req:doctor': '../scripts/req/req-doctor.ts',
  'req:commit': '../scripts/req/req-commit.ts',
  uninstall: 'uninstall.ts',
  migrate: 'migrate.ts',
  init: 'init.ts',
}

/**
 * argv → { entry, rest } 또는 { unknown }.
 * @param {string[]} argv  process.argv.slice(2)
 * @returns {{ entry: string, rest: string[] } | { unknown: string }}
 */
export function resolveDispatch(argv) {
  const verb = argv[0]
  // verb 없음 / init 옵션(`-`로 시작) → init에 argv 전체 전달(D3).
  if (verb === undefined || verb.startsWith('-')) return { entry: 'init.ts', rest: argv }
  if (Object.prototype.hasOwnProperty.call(VERB_MODULES, verb)) return { entry: VERB_MODULES[verb], rest: argv.slice(1) }
  // 비-옵션 미지 토큰: 호출부가 fail-closed 처리(오타를 조용히 init으로 보내지 않는다).
  return { unknown: verb }
}
