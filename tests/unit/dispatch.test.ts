import { describe, it, expect } from 'vitest'
import { resolveDispatch, VERB_MODULES } from '../../bin/dispatch.mjs'

/**
 * REQ-2026-014 Phase 1 — bin verb dispatch(설계 D3).
 *
 * launcher는 알려진 verb를 해당 모듈로 보내고(verb 토큰 소비), init 옵션(`-` 시작)·verb 없음은 init에
 * argv 전체를 넘긴다(하위호환: `npx commitgate --dry-run`). 그 외 비-옵션 토큰은 fail-closed(`unknown`).
 *
 * `migrate`는 **Phase 3에서 `bin/migrate.ts` 생성과 동시에 등록**됐다. Phase 1의 "미등록 → unknown" 단언은
 * 그때까지 깨진 import를 노출하지 않기 위한 **의도된 tripwire**였고, 등록과 함께 이 파일에서 갱신됐다.
 */
describe('[dispatch] resolveDispatch — 알려진 req:* verb 라우팅(verb 토큰 소비)', () => {
  const cases: Array<[string, string]> = [
    ['req:new', '../scripts/req/req-new.ts'],
    ['req:next', '../scripts/req/req-next.ts'],
    ['req:review-codex', '../scripts/req/review-codex.ts'],
    ['req:doctor', '../scripts/req/req-doctor.ts'],
    ['req:commit', '../scripts/req/req-commit.ts'],
  ]
  for (const [verb, entry] of cases) {
    it(`${verb} → ${entry} (인자 통과)`, () => {
      const d = resolveDispatch([verb, 'foo', '--run'])
      expect(d).toEqual({ entry, rest: ['foo', '--run'] })
    })
  }

  it('uninstall / init verb 라우팅(토큰 소비)', () => {
    expect(resolveDispatch(['uninstall', '--dir', 'x'])).toEqual({ entry: 'uninstall.ts', rest: ['--dir', 'x'] })
    expect(resolveDispatch(['init', '--strict'])).toEqual({ entry: 'init.ts', rest: ['--strict'] })
  })

  it('migrate verb 라우팅 — Phase 3에서 파일 생성과 동시에 등록(인자 통과)', () => {
    expect('migrate' in VERB_MODULES).toBe(true)
    expect(resolveDispatch(['migrate'])).toEqual({ entry: 'migrate.ts', rest: [] })
    expect(resolveDispatch(['migrate', '--apply', '--dir', 'x'])).toEqual({
      entry: 'migrate.ts',
      rest: ['--apply', '--dir', 'x'],
    })
  })

  it('verb 뒤 bare `--`는 그대로 전달된다(스트립은 각 스크립트 parseArgs의 몫)', () => {
    expect(resolveDispatch(['req:next', '--', '2026-014'])).toEqual({
      entry: '../scripts/req/req-next.ts',
      rest: ['--', '2026-014'],
    })
  })
})

describe('[dispatch] init 라우팅 — 옵션 선행/verb 없음은 init에 argv 전체(D3, 하위호환)', () => {
  for (const opt of ['--dry-run', '--dir', '--strict', '--force', '--no-agent-entrypoints', '-h']) {
    it(`${opt} 선행 → init.ts 에 argv 전체 전달(verb 미소비)`, () => {
      const argv = opt === '--dir' ? ['--dir', 'target'] : [opt]
      expect(resolveDispatch(argv)).toEqual({ entry: 'init.ts', rest: argv })
    })
  }

  it('인자 없음 → init.ts (기존 `npx commitgate` 하위호환)', () => {
    expect(resolveDispatch([])).toEqual({ entry: 'init.ts', rest: [] })
  })
})

describe('[dispatch] fail-closed — 비-옵션 미지 토큰', () => {
  it('알 수 없는 명령은 unknown으로 표시(호출부가 exit 1)', () => {
    expect(resolveDispatch(['bogus'])).toEqual({ unknown: 'bogus' })
  })

  it('오타난 migrate도 조용히 init으로 가지 않는다', () => {
    expect(resolveDispatch(['migrat', '--apply'])).toEqual({ unknown: 'migrat' })
  })

  it('오타난 req 접두 명령도 조용히 init으로 가지 않는다', () => {
    expect(resolveDispatch(['req:doctorr'])).toEqual({ unknown: 'req:doctorr' })
  })
})
