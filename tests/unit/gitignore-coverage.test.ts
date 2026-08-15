/**
 * REQ-2026-154 phase-2 — `.gitignore` 변경이 ignore 범위를 좁힐 수 있는가(순수).
 *
 * 🔴 이 판정의 출력은 **"자동 명령을 낼지 말지"뿐**이다. 무엇을 할지는 사람이 정한다.
 *    그래서 **애매하면 좁아질 수 있다고 본다** — 틀리는 쪽이 안전하다.
 */
import { describe, it, expect } from 'vitest'
import { preservesCoverage, isNegation, narrowingPaths } from '../../scripts/req/lib/gitignore-coverage'

describe('[REQ-2026-154] isNegation', () => {
  it('🔴 **첫 글자**가 `!` 일 때만 부정이다', () => {
    for (const s of ['!keep.log', '!*.log  ']) expect(isNegation(s), s).toBe(true)
  })

  /**
   * 🔴 **계약이 뒤집혔다**(REQ-2026-155 결함 4). 여기 있던 "앞뒤 공백 무시"는 **틀린 동작을
   *    고정**하고 있었다. gitignore 는 **후행** 공백만 버리고 선행 공백은 패턴의 일부다 —
   *    `git check-ignore -v` 실측: `*.log` + ` !keep.log` 에서 `keep.log` 는 여전히 ignored 다.
   */
  it('🔴 선행 공백이 있으면 부정이 아니다 — 실측으로 확인했다', () => {
    for (const s of [' !keep.log', '  !keep.log']) expect(isNegation(s), s).toBe(false)
  })

  it('그 밖은 부정이 아니다 — 이스케이프한 `\\!` 는 리터럴이다', () => {
    for (const s of ['*.log', '# !keep.log', '\\!literal', '', '  ']) expect(isNegation(s), s).toBe(false)
  })
})

describe('[REQ-2026-154] preservesCoverage — 순서 보존 부분수열', () => {
  it('비-부정 줄만 뒤에 더하면 안전', () => {
    expect(preservesCoverage('*.log\n', '*.log\nnode_modules/\n')).toBe(true)
  })

  it('🔴 비-부정 줄을 **중간에 끼워 넣어도** 안전', () => {
    expect(preservesCoverage('a\nb\n', 'a\nX\nb\n')).toBe(true)
  })

  it('신규 파일(HEAD 없음)에 비-부정 줄만 있으면 안전', () => {
    expect(preservesCoverage('', 'node_modules/\n')).toBe(true)
  })

  it('🔴 신규 파일이라도 `!` 줄이 있으면 불안전 — 부모 규칙을 부정한다', () => {
    expect(preservesCoverage('', '!keep.log\n')).toBe(false)
  })

  it('🔴 HEAD 의 줄이 사라지면 불안전', () => {
    expect(preservesCoverage('*.log\nnode_modules/\n', 'node_modules/\n')).toBe(false)
  })

  it('🔴 `!` 줄을 삽입하면 불안전', () => {
    expect(preservesCoverage('*.log\n', '*.log\n!keep.log\n')).toBe(false)
  })

  /**
   * 🔴 **집합 비교로는 못 잡는 것**(설계 r02 P1). gitignore 는 마지막에 일치한 패턴이 이긴다 —
   *    줄 집합이 같아도 순서가 뒤집히면 `keep.log` 가 드러난다.
   */
  it('🔴 순서 재배치는 불안전 — 줄 집합은 같다', () => {
    const head = '!keep.log\n*.log\n'
    const work = '*.log\n!keep.log\n'
    expect(new Set(head.split('\n'))).toEqual(new Set(work.split('\n'))) // 집합은 동일
    expect(preservesCoverage(head, work)).toBe(false)
  })

  it('무변경은 안전', () => {
    expect(preservesCoverage('*.log\n!keep.log\n', '*.log\n!keep.log\n')).toBe(true)
  })

  it('🔴 줄바꿈만 다른 것은 안전(CRLF/LF 정규화)', () => {
    expect(preservesCoverage('*.log\nnode_modules/\n', '*.log\r\nnode_modules/\r\n')).toBe(true)
  })
})

describe('[REQ-2026-154] narrowingPaths', () => {
  it('안전한 것은 빠지고 불안전한 것만 남는다', () => {
    expect(
      narrowingPaths([
        { path: 'a/.gitignore', head: '*.log\n', work: '*.log\nnode_modules/\n' },
        { path: 'b/.gitignore', head: '*.log\n', work: '!keep.log\n*.log\n' },
      ]),
    ).toEqual(['b/.gitignore'])
  })

  it('🔴 파일 삭제는 불안전 — 그 파일의 규칙이 통째로 사라진다', () => {
    expect(narrowingPaths([{ path: '.gitignore', head: '*.log\n', work: null }])).toEqual(['.gitignore'])
  })

  it('신규 파일에 비-부정 줄만 있으면 안전', () => {
    expect(narrowingPaths([{ path: 'p/.gitignore', head: null, work: 'node_modules/\n' }])).toEqual([])
  })
})

describe('[REQ-2026-154] 🔴 소스 가드 — 패턴 의미를 해석하지 않는다', () => {
  it('와일드카드·디렉터리 접미를 해석하는 코드가 없다', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const src = readFileSync(join(process.cwd(), 'scripts/req/lib/gitignore-coverage.ts'), 'utf8')
    // 이 모듈이 보는 것은 **순서와 부정 여부**뿐이다. 패턴 매칭을 시도하면 부정 하나에 반대로 안내한다.
    for (const forbidden of ['minimatch', 'fnmatch', 'globToRegExp', '\\*\\*'])
      expect(src, forbidden).not.toContain(forbidden)
  })
})
