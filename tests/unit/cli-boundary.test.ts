import { describe, it, expect, vi, afterEach } from 'vitest'
import { pathToFileURL } from 'node:url'
import { makeRunCli, isEntrypoint } from '../../scripts/req/lib/cli-boundary'

/**
 * REQ-2026-105 phase-1 — CLI 경계 헬퍼.
 *
 * 이 REQ의 계약은 **"오류 메시지 문자열과 exit code가 불변"**이다(18개 CLI가 복제하던 것을 한 곳으로
 * 모으는 것이 전부이므로). 따라서 오라클도 문자열이어야 한다 — 형태만 보는 정규식으로는 접두어가
 * 바뀌는 회귀를 못 잡는다.
 */
describe('[REQ-2026-105] makeRunCli — 예외를 한 줄 + exit 1로', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    process.exitCode = undefined
  })

  it('정상 경로: run을 argv 그대로 부르고 exitCode를 건드리지 않는다', () => {
    const seen: string[][] = []
    makeRunCli((argv) => { seen.push(argv) })(['a', '--b'])
    expect(seen).toEqual([['a', '--b']])
    expect(process.exitCode).toBeUndefined()
  })

  it('🔴 Error throw → `commitgate: <message>` **정확히** 이 문자열 + exitCode=1', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    makeRunCli(() => { throw new Error('설계 승인이 필요하다') })([])
    expect(err).toHaveBeenCalledWith('commitgate: 설계 승인이 필요하다')
    expect(process.exitCode).toBe(1)
  })

  it('🔴 접두어를 주면 그것을 쓴다 — verb별 문자열이 보존되어야 한다', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    makeRunCli(() => { throw new Error('boom') }, 'commitgate sync')([])
    expect(err).toHaveBeenCalledWith('commitgate sync: boom')
  })

  it('비-Error throw는 String(err)로 직렬화한다(기존 동작 보존)', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    makeRunCli(() => { throw 'plain string' })([])
    expect(err).toHaveBeenCalledWith('commitgate: plain string')
    expect(process.exitCode).toBe(1)
  })

  it('🔴 스택트레이스를 노출하지 않는다 — message만 나간다', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    makeRunCli(() => { throw new Error('짧은 메시지') })([])
    const printed = String(err.mock.calls[0]?.[0] ?? '')
    expect(printed).not.toMatch(/\n\s+at /) // "    at fn (file:line)" 형태가 없다
    expect(printed.split('\n')).toHaveLength(1)
  })
})

describe('[REQ-2026-105] isEntrypoint — 직접 실행 판정', () => {
  const origArgv1 = process.argv[1]
  afterEach(() => { process.argv[1] = origArgv1 as string })

  it('argv[1]이 이 모듈을 가리키면 true', () => {
    process.argv[1] = 'D:/x/y/req-doctor.ts'
    expect(isEntrypoint(pathToFileURL('D:/x/y/req-doctor.ts').href)).toBe(true)
  })

  it('다른 파일이 엔트리면 false(import된 경우)', () => {
    process.argv[1] = 'D:/x/y/other.ts'
    expect(isEntrypoint(pathToFileURL('D:/x/y/req-doctor.ts').href)).toBe(false)
  })

  /**
   * 🔴 통합 전 두 표현식이 갈리던 지점(DEC-3). 가드가 먼저라 `pathToFileURL('')`을 **평가하지 않는다** —
   *    결과(false)는 옛 형태와 같지만, 그 결과를 미문서화 동작에 의존해 얻지 않는다.
   */
  it('🔴 argv[1]이 없으면 pathToFileURL을 평가하지 않고 false', () => {
    delete (process.argv as unknown as Record<number, string>)[1]
    process.argv.length = 1
    expect(isEntrypoint('file:///whatever.ts')).toBe(false)
  })
})
