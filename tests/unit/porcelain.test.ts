import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, renameSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  parseStatusZ,
  entryPaths,
  isRenameOrCopy,
  isUntracked,
  formatStatusEntry,
  STATUS_Z_ARGS,
} from '../../scripts/req/lib/porcelain'

/** `-z` 원문 조립: 각 필드 뒤에 NUL. */
const z = (...fields: string[]): string => fields.map((f) => `${f}\0`).join('')

describe('parseStatusZ — 기본 형식', () => {
  it('빈 출력(클린 트리)은 빈 배열', () => {
    expect(parseStatusZ('')).toEqual([])
  })

  it('단일 untracked 레코드', () => {
    expect(parseStatusZ(z('?? src/new.ts'))).toEqual([{ index: '?', worktree: '?', path: 'src/new.ts' }])
  })

  it('X/Y 코드를 각각 분리한다(선행 공백 보존)', () => {
    const [a, b, c] = parseStatusZ(z(' M a.ts', 'M  b.ts', 'MM c.ts'))
    expect([a?.index, a?.worktree]).toEqual([' ', 'M'])
    expect([b?.index, b?.worktree]).toEqual(['M', ' '])
    expect([c?.index, c?.worktree]).toEqual(['M', 'M'])
  })

  it('여러 레코드를 순서대로 분해한다', () => {
    expect(parseStatusZ(z(' M a.ts', '?? b.ts')).map((e) => e.path)).toEqual(['a.ts', 'b.ts'])
  })
})

describe('parseStatusZ — 경로를 정규화하지 않는다 (옛 statusPaths의 버그)', () => {
  it('역슬래시는 파일명의 일부다 — `a\\b.txt`를 `a/b.txt`로 뭉개지 않는다', () => {
    // 옛 `statusPaths`는 `body.replace(/\\/g,'/')`로 이것을 `a/b.txt`로 만들었다.
    expect(parseStatusZ(z('?? a\\b.txt'))).toEqual([{ index: '?', worktree: '?', path: 'a\\b.txt' }])
  })

  it('경로에 든 ` -> `를 rename delimiter로 오인하지 않는다', () => {
    expect(parseStatusZ(z('?? a -> b.txt'))[0]?.path).toBe('a -> b.txt')
  })

  it('공백·비-ASCII·따옴표를 인용 없이 원문 그대로 준다', () => {
    const paths = parseStatusZ(z('?? notes today.txt', '?? 한글.txt', '?? q"uote.txt')).map((e) => e.path)
    expect(paths).toEqual(['notes today.txt', '한글.txt', 'q"uote.txt'])
  })

  it('경로 끝의 공백을 보존한다', () => {
    expect(parseStatusZ(z('?? trailing '))[0]?.path).toBe('trailing ')
  })
})

describe('parseStatusZ — rename/copy는 X·Y 양쪽에서 origPath를 소비한다 (설계 D11-1)', () => {
  it('X열 rename(`R `) — `-z`는 NEW가 먼저다', () => {
    expect(parseStatusZ(z('R  new.ts', 'old.ts'))).toEqual([
      { index: 'R', worktree: ' ', path: 'new.ts', origPath: 'old.ts' },
    ])
  })

  it('Y열 rename(` R`) — X만 검사하면 old.ts가 독립 레코드로 새어 나간다', () => {
    expect(parseStatusZ(z(' R new.ts', 'old.ts'))).toEqual([
      { index: ' ', worktree: 'R', path: 'new.ts', origPath: 'old.ts' },
    ])
  })

  it('X=R, Y=M (`RM`)', () => {
    expect(parseStatusZ(z('RM new.ts', 'old.ts'))).toEqual([
      { index: 'R', worktree: 'M', path: 'new.ts', origPath: 'old.ts' },
    ])
  })

  it('Y열 copy(` C`)', () => {
    expect(parseStatusZ(z(' C new.ts', 'old.ts'))).toEqual([
      { index: ' ', worktree: 'C', path: 'new.ts', origPath: 'old.ts' },
    ])
  })

  it('rename 뒤의 다음 레코드를 origPath로 잘못 먹지 않는다', () => {
    expect(parseStatusZ(z('R  new.ts', 'old.ts', '?? other.ts'))).toEqual([
      { index: 'R', worktree: ' ', path: 'new.ts', origPath: 'old.ts' },
      { index: '?', worktree: '?', path: 'other.ts' },
    ])
  })

  it('isRenameOrCopy는 두 열을 모두 본다', () => {
    expect(isRenameOrCopy('R', ' ')).toBe(true)
    expect(isRenameOrCopy(' ', 'R')).toBe(true)
    expect(isRenameOrCopy('C', ' ')).toBe(true)
    expect(isRenameOrCopy(' ', 'C')).toBe(true)
    expect(isRenameOrCopy('M', 'M')).toBe(false)
    expect(isRenameOrCopy('?', '?')).toBe(false)
  })
})

describe('parseStatusZ — fail-closed', () => {
  it('rename 레코드에 origPath가 없으면 throw(truncated)', () => {
    expect(() => parseStatusZ(z('R  new.ts'))).toThrow(/원본 경로가 없다|truncated/)
  })

  it('Y열 rename의 origPath 누락도 throw', () => {
    expect(() => parseStatusZ(z(' R new.ts'))).toThrow(/원본 경로가 없다|truncated/)
  })

  it('origPath가 빈 문자열이면 throw', () => {
    expect(() => parseStatusZ('R  new.ts\0\0')).toThrow(/원본 경로가 없다|truncated/)
  })

  it('XY 뒤에 공백이 없으면 throw', () => {
    expect(() => parseStatusZ(z('??src/x.ts'))).toThrow(/레코드 형식 오류/)
  })

  it('경로가 비면 throw', () => {
    expect(() => parseStatusZ(z('?? '))).toThrow(/레코드 형식 오류/)
  })

  it('undefined를 흘려보내지 않는다 — 어떤 입력에도 entry.path는 string', () => {
    for (const e of parseStatusZ(z('R  a', 'b', ' M c', '?? d'))) expect(typeof e.path).toBe('string')
  })
})

describe('entryPaths / isUntracked / formatStatusEntry', () => {
  it('rename은 [OLD, NEW] 순서 — 옛 statusPaths 시맨틱 보존', () => {
    expect(entryPaths({ index: 'R', worktree: ' ', path: 'new.ts', origPath: 'old.ts' })).toEqual(['old.ts', 'new.ts'])
  })

  it('비-rename은 경로 하나', () => {
    expect(entryPaths({ index: '?', worktree: '?', path: 'a.ts' })).toEqual(['a.ts'])
  })

  it('isUntracked는 X=Y=? 만 참', () => {
    expect(isUntracked({ index: '?', worktree: '?', path: 'a' })).toBe(true)
    expect(isUntracked({ index: ' ', worktree: 'M', path: 'a' })).toBe(false)
    expect(isUntracked({ index: 'M', worktree: ' ', path: 'a' })).toBe(false)
  })

  it('formatStatusEntry는 rename을 `old -> new`로 되돌린다', () => {
    expect(formatStatusEntry({ index: 'R', worktree: ' ', path: 'new.ts', origPath: 'old.ts' })).toBe(
      'R  old.ts -> new.ts',
    )
    expect(formatStatusEntry({ index: ' ', worktree: 'M', path: 'a.ts' })).toBe(' M a.ts')
  })
})

// ─────────────────────────────────────────────────────────────── 실제 git ──
// `-z` 출력 형식(인용 없음 · NEW 먼저 · Y열 rename)은 **git의 계약**이다.
// git 버전이 이 가정을 깨면 여기서 즉시 실패해야 한다 — 위의 문자열 테스트는 그것을 잡지 못한다.

const git = (dir: string, args: string[]): string =>
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: dir, encoding: 'utf8' })

function tmpRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cg-porcelain-'))
  git(dir, ['init', '-q'])
  // REQ-2026-049: repo-local identity. 인라인 `-c`는 그 호출에만 적용돼 **피시험 코드의 커밋**을 보호하지 못한다.
  git(dir, ['config', 'user.email', 't@t.t'])
  git(dir, ['config', 'user.name', 't'])
  return dir
}

describe('실제 git — `-z` 형식 가정 고정', () => {
  it('STATUS_Z_ARGS가 실제로 도는 인자다', () => {
    const dir = tmpRepo()
    try {
      expect(() => git(dir, [...STATUS_Z_ARGS])).not.toThrow()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('X열 rename(`git mv`) → `R  NEW\\0OLD\\0`', () => {
    const dir = tmpRepo()
    try {
      writeFileSync(join(dir, 'a.txt'), 'lorem ipsum dolor sit amet\n'.repeat(40))
      git(dir, ['add', '-A'])
      git(dir, ['commit', '-qm', 'init'])
      git(dir, ['mv', 'a.txt', 'b.txt'])

      const [e, ...rest] = parseStatusZ(git(dir, [...STATUS_Z_ARGS]))
      expect(rest).toEqual([])
      expect(e).toEqual({ index: 'R', worktree: ' ', path: 'b.txt', origPath: 'a.txt' })
      expect(entryPaths(e!)).toEqual(['a.txt', 'b.txt'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('Y열 rename(`mv` + `git add -N`) → ` R NEW\\0OLD\\0` — X만 보면 OLD가 새어 나간다', () => {
    const dir = tmpRepo()
    try {
      writeFileSync(join(dir, 'a.txt'), 'lorem ipsum dolor sit amet\n'.repeat(40))
      git(dir, ['add', '-A'])
      git(dir, ['commit', '-qm', 'init'])
      renameSync(join(dir, 'a.txt'), join(dir, 'c.txt'))
      git(dir, ['add', '-N', 'c.txt'])

      const entries = parseStatusZ(git(dir, [...STATUS_Z_ARGS]))
      expect(entries).toEqual([{ index: ' ', worktree: 'R', path: 'c.txt', origPath: 'a.txt' }])
      // 회귀의 핵심: OLD 경로가 별도 엔트리로 새어 나가면 안 된다.
      expect(entries.map((x) => x.path)).not.toContain('a.txt')
      expect(entryPaths(entries[0]!)).toEqual(['a.txt', 'c.txt'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('`-z`는 quotePath=true에서도 공백·비-ASCII 경로를 인용하지 않는다', () => {
    const dir = tmpRepo()
    try {
      git(dir, ['config', 'core.quotePath', 'true'])
      writeFileSync(join(dir, 'notes today.txt'), 'x')
      writeFileSync(join(dir, '한글.txt'), 'x')

      const paths = parseStatusZ(git(dir, [...STATUS_Z_ARGS])).map((e) => e.path).sort()
      expect(paths).toEqual(['notes today.txt', '한글.txt'].sort())
      expect(paths.some((p) => p.startsWith('"'))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('클린 트리는 빈 배열(후행 NUL이 빈 엔트리를 만들지 않는다)', () => {
    const dir = tmpRepo()
    try {
      writeFileSync(join(dir, 'a.txt'), 'x')
      git(dir, ['add', '-A'])
      git(dir, ['commit', '-qm', 'init'])
      expect(parseStatusZ(git(dir, [...STATUS_Z_ARGS]))).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
