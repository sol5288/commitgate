import { describe, it, expect } from 'vitest'
import { parseArgs as parseNext } from '../../scripts/req/req-next'
import { parseArgs as parseDoctor } from '../../scripts/req/req-doctor'
import { parseArgs as parseCommit } from '../../scripts/req/req-commit'
import { parseArgs as parseNew } from '../../scripts/req/req-new'

/**
 * REQ-2026-011 phase-4 — POSIX end-of-options `--` 흡수 (D3 / DEC-011-3).
 *
 * npm은 `npm run x -- a`에서 `--`를 **제거하고** 스크립트에 `a`만 넘긴다.
 * pnpm/yarn은 `--`를 **그대로 전달**한다. 그래서 npm 습관대로 `pnpm req:next -- 2026-010`을
 * 치면 파서가 `--`를 옵션으로 오인해 `알 수 없는 옵션: --`로 죽었다.
 *
 * `--`는 옵션이 아니라 "여기부터 위치인자"라는 표준 마커다. 흡수해도 fail-closed는 약해지지 않는다 —
 * 알 수 없는 **옵션**에 대한 throw는 그대로 남는다.
 *
 * ⚠️ `--` 이후 인자도 **계속 옵션으로 파싱한다**(엄격 POSIX처럼 전부 위치인자로 삼키지 않는다).
 * 그러지 않으면 `req:commit 2026-011 -- --run`이 `--run`을 위치인자로 삼켜, 사용자는 커밋했다고
 * 믿지만 조용히 dry-run으로 끝난다. 조용한 실패는 이 도구에서 가장 나쁜 실패다.
 *
 * `review-codex.ts`는 대상이 아니다 — 그 `parseArgs`(:1053)는 매칭되지 않은 `-`-접두 인자를
 * throw 없이 흘려보내므로 `--`가 이미 무해하다.
 */
describe('[parseArgs] bare `--` 는 end-of-options 구분자다 (REQ-2026-011 D3)', () => {
  describe('req:next', () => {
    it('`-- <id>` 를 흡수하고 id를 인식한다', () => {
      expect(parseNext(['--', '2026-011']).reqId).toBe('2026-011')
    })
    it('구분자 뒤 플래그는 여전히 플래그다 (위치인자로 삼키지 않는다)', () => {
      const o = parseNext(['2026-011', '--', '--json'])
      expect(o.reqId).toBe('2026-011')
      expect(o.json).toBe(true)
    })
    it('알 수 없는 옵션은 여전히 throw', () => {
      expect(() => parseNext(['--bogus'])).toThrow(/알 수 없는 옵션/)
    })
    it('지원하지 않는 플래그(--run)는 `--` 뒤에서도 throw', () => {
      // req:next는 읽기 전용이라 --run이 없다. 구분자가 이를 위치인자로 둔갑시키면 안 된다.
      expect(() => parseNext(['2026-011', '--', '--run'])).toThrow(/알 수 없는 옵션/)
    })
  })

  describe('req:doctor', () => {
    it('`-- <id>` 를 흡수하고 id를 인식한다', () => {
      expect(parseDoctor(['--', '2026-011']).reqId).toBe('2026-011')
    })
    it('구분자 뒤 플래그는 여전히 플래그다', () => {
      const o = parseDoctor(['2026-011', '--', '--finalize'])
      expect(o.reqId).toBe('2026-011')
      expect(o.finalize).toBe(true)
    })
    it('알 수 없는 옵션은 여전히 throw', () => {
      expect(() => parseDoctor(['--bogus'])).toThrow(/알 수 없는 옵션/)
    })
    it('지원하지 않는 플래그(--run)는 `--` 뒤에서도 throw', () => {
      expect(() => parseDoctor(['2026-011', '--', '--run'])).toThrow(/알 수 없는 옵션/)
    })
  })

  describe('req:commit', () => {
    it('`-- <id>` 를 흡수하고 id를 인식한다', () => {
      expect(parseCommit(['--', '2026-011']).reqId).toBe('2026-011')
    })
    it('구분자 뒤 `--run` 은 삼켜지지 않는다 (조용한 dry-run 방지)', () => {
      const o = parseCommit(['2026-011', '--', '--run'])
      expect(o.reqId).toBe('2026-011')
      expect(o.run).toBe(true)
    })
    it('알 수 없는 옵션은 여전히 throw', () => {
      expect(() => parseCommit(['--bogus'])).toThrow(/알 수 없는 옵션/)
    })
  })

  describe('req:new', () => {
    it('`-- <slug>` 를 흡수하고 slug를 인식한다', () => {
      expect(parseNew(['--', 'camera-hardfail']).slug).toBe('camera-hardfail')
    })
    it('구분자 뒤 플래그는 여전히 플래그다', () => {
      const o = parseNew(['camera-hardfail', '--', '--run'])
      expect(o.slug).toBe('camera-hardfail')
      expect(o.run).toBe(true)
    })
    it('알 수 없는 옵션은 여전히 throw', () => {
      expect(() => parseNew(['--bogus'])).toThrow(/알 수 없는 옵션/)
    })
  })

  /** npm 사용자의 습관(`-- <id>`)과 pnpm/yarn 사용자의 습관(`<id>`)이 같은 결과를 낸다. */
  it('`-- <id>` 와 `<id>` 는 동등하다 (4개 파서 전부)', () => {
    expect(parseNext(['--', '2026-011'])).toEqual(parseNext(['2026-011']))
    expect(parseDoctor(['--', '2026-011'])).toEqual(parseDoctor(['2026-011']))
    expect(parseCommit(['--', '2026-011'])).toEqual(parseCommit(['2026-011']))
    expect(parseNew(['--', 'camera-hardfail'])).toEqual(parseNew(['camera-hardfail']))
  })

  /** 구분자를 여러 번 줘도 무해하다(멱등). */
  it('`--` 가 반복돼도 무해하다', () => {
    expect(parseNext(['--', '--', '2026-011']).reqId).toBe('2026-011')
  })
})
