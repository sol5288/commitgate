/**
 * REQ-2026-085 phase-2 — 부기 커밋 표식(DEC-6·7).
 *
 * 🔴 이 파일의 핵심은 **문서에 적힌 읽기 명령이 실제로 동작하는가**다. 상수만 단언하면 tautology이므로
 *    실 git repo에 부기 커밋과 코드 커밋을 섞어 만들고 그 명령을 그대로 돌린다.
 */
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, readFileSync, mkdirSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  BOOKKEEPING_TRAILER,
  BOOKKEEPING_LOG_EXCLUDE_ARGS,
  BOOKKEEPING_LOG_EXCLUDE_CMD,
  bookkeepingMessage,
} from '../../scripts/req/lib/bookkeeping'
import { commitStateCheckpoint, serializeState } from '../../scripts/req/lib/state-checkpoint'

const gitOf = (repo: string) => (args: string[]): string =>
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: repo, encoding: 'utf8' })

const mkRepo = (): { repo: string; git: (a: string[]) => string } => {
  const repo = mkdtempSync(join(tmpdir(), 'req085-bk-'))
  const git = gitOf(repo)
  git(['init', '-q'])
  git(['config', 'user.email', 't@t.t'])
  git(['config', 'user.name', 't'])
  writeFileSync(join(repo, 'seed.txt'), 'seed\n')
  git(['add', '-A'])
  git(['commit', '-qm', 'seed'])
  return { repo, git }
}

describe('[REQ-2026-085] bookkeepingMessage(순수)', () => {
  it('subject + 빈 줄 + trailer 형태', () => {
    expect(bookkeepingMessage('chore(REQ-2026-085): state checkpoint — x')).toBe(
      `chore(REQ-2026-085): state checkpoint — x\n\n${BOOKKEEPING_TRAILER}`,
    )
  })

  it('subject를 바꾸지 않는다 — 첫 줄은 입력 그대로', () => {
    const subject = 'chore(REQ-2026-085): ledger attempt-opened design:-#1 #2'
    expect(bookkeepingMessage(subject).split('\n')[0]).toBe(subject)
  })

  it('trailer는 마지막 줄이고 줄 시작에 온다(로그 필터의 `^` 앵커 전제)', () => {
    const lines = bookkeepingMessage('subject').split('\n')
    expect(lines[lines.length - 1]).toBe(BOOKKEEPING_TRAILER)
    expect(lines[1]).toBe('') // trailer 앞은 반드시 빈 줄(git trailer 규약)
  })
})

describe('[REQ-2026-085 DEC-7] 문서에 적힌 읽기 명령이 실제로 코드 커밋만 남긴다', () => {
  it('부기 커밋은 제외되고 코드 커밋만 나온다(실 git)', () => {
    const { repo, git } = mkRepo()
    try {
      // 부기 2건 + 코드 2건을 섞어 만든다.
      writeFileSync(join(repo, 'a.txt'), 'a\n')
      git(['add', '-A'])
      git(['commit', '-m', bookkeepingMessage('chore(REQ-2026-085): ledger attempt-opened design:-#1 #1')])

      writeFileSync(join(repo, 'b.txt'), 'b\n')
      git(['add', '-A'])
      git(['commit', '-m', 'feat(x): 실제 코드 변경'])

      writeFileSync(join(repo, 'c.txt'), 'c\n')
      git(['add', '-A'])
      git(['commit', '-m', bookkeepingMessage('chore(REQ-2026-085): state checkpoint — phase 소비')])

      writeFileSync(join(repo, 'd.txt'), 'd\n')
      git(['add', '-A'])
      // 🔴 사람이 손으로 쓴 `chore(REQ-…)` — subject 규약으로 걸렀다면 이것도 사라진다. trailer라 남아야 한다.
      git(['commit', '-m', 'chore(REQ-2026-085): 사람이 직접 정리한 커밋'])

      const out = git(['log', '--oneline', ...BOOKKEEPING_LOG_EXCLUDE_ARGS])
      expect(out).toContain('feat(x): 실제 코드 변경')
      expect(out).toContain('사람이 직접 정리한 커밋')
      expect(out).not.toContain('ledger attempt-opened')
      expect(out).not.toContain('state checkpoint')
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  it('문서 문구(BOOKKEEPING_LOG_EXCLUDE_CMD)와 인자 배열이 같은 정의를 가리킨다', () => {
    // 문서에 붙여넣는 문자열과 테스트가 실행하는 인자가 갈라지면 문서가 거짓이 된다.
    expect(BOOKKEEPING_LOG_EXCLUDE_CMD).toBe(`git log --oneline ${BOOKKEEPING_LOG_EXCLUDE_ARGS.join(' ')}`)
    expect(BOOKKEEPING_LOG_EXCLUDE_ARGS).toContain(`--grep=^${BOOKKEEPING_TRAILER}`)
  })
})

describe('[REQ-2026-085 DEC-6] state checkpoint 실 커밋 — 표식은 붙고 범위는 그대로', () => {
  const setup = (): { repo: string; git: (a: string[]) => string; ticketRel: string } => {
    const { repo, git } = mkRepo()
    const ticketRel = 'workflow/REQ-2026-001'
    mkdirSync(join(repo, 'workflow', 'REQ-2026-001'), { recursive: true })
    return { repo, git, ticketRel }
  }

  it('부기 trailer가 실린다', () => {
    const { repo, git, ticketRel } = setup()
    try {
      const state = { id: 'REQ-2026-001', current_phase: null }
      writeFileSync(join(repo, ticketRel, 'state.json'), serializeState(state))
      expect(commitStateCheckpoint({ root: repo, ticketRel, ticketId: 'REQ-2026-001', state, reason: 'design 승인', gitFn: git })).toBe(true)
      const msg = git(['log', '-1', '--format=%B'])
      expect(msg).toContain('chore(REQ-2026-001): state checkpoint — design 승인')
      expect(msg).toContain(BOOKKEEPING_TRAILER)
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  it('🔴 커밋 경로·개수가 그대로다 — 표식이 커밋 범위를 넓히지 않는다', () => {
    const { repo, git, ticketRel } = setup()
    try {
      const state = { id: 'REQ-2026-001', current_phase: null }
      writeFileSync(join(repo, ticketRel, 'state.json'), serializeState(state))
      // 무관한 파일을 stage해 둔다 — pathspec 커밋이면 인덱스에 그대로 남아야 한다.
      writeFileSync(join(repo, 'unrelated.txt'), 'x\n')
      git(['add', '--', 'unrelated.txt'])

      const before = git(['rev-list', '--count', 'HEAD']).trim()
      commitStateCheckpoint({ root: repo, ticketRel, ticketId: 'REQ-2026-001', state, reason: 'phase 소비', gitFn: git })
      const after = git(['rev-list', '--count', 'HEAD']).trim()

      expect(Number(after) - Number(before)).toBe(1) // 커밋 1개(표식이 커밋을 늘리지 않는다)
      const files = git(['show', '--name-only', '--format=', 'HEAD']).trim().split('\n').filter(Boolean)
      expect(files).toEqual([`${ticketRel}/state.json`]) // 오직 state.json
      expect(git(['diff', '--cached', '--name-only']).trim()).toBe('unrelated.txt') // staged는 그대로 남음
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  it('멱등 no-op은 여전히 커밋을 만들지 않는다(표식이 멱등을 깨지 않는다)', () => {
    const { repo, git, ticketRel } = setup()
    try {
      const state = { id: 'REQ-2026-001', current_phase: null }
      writeFileSync(join(repo, ticketRel, 'state.json'), serializeState(state))
      commitStateCheckpoint({ root: repo, ticketRel, ticketId: 'REQ-2026-001', state, reason: 'r1', gitFn: git })
      const before = git(['rev-list', '--count', 'HEAD']).trim()
      expect(commitStateCheckpoint({ root: repo, ticketRel, ticketId: 'REQ-2026-001', state, reason: 'r2', gitFn: git })).toBe(false)
      expect(git(['rev-list', '--count', 'HEAD']).trim()).toBe(before)
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })
})

describe('[REQ-2026-085 DEC-6] 도구가 만드는 커밋 자리 전수 스캔(구조적)', () => {
  const src = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8')

  /**
   * 🔴 **"파일에 문자열이 있는가"가 아니라 "각 `commit -m` 자리의 인자가 무엇인가"를 본다**(phase-2 리뷰 관측).
   * 파일 단위 문자열 검사는 새 커밋 자리가 헬퍼를 우회해도 통과한다 — 그 우회가 정확히 이 규약의 실패 모드다.
   */
  /**
   * `'-m',` 바로 뒤의 **메시지 인자 표현식만** 떼어낸다.
   *
   * 🔴 줄 끝까지 잘라 쓰면(초기 구현) `opts.message]`처럼 뒤따르는 구문이 섞여, 무관한 서식 변경으로
   *    예외 대조가 깨진다(phase-3 r02 P1이 지적한 취약점). 괄호·문자열 깊이를 세어 top-level `,` 또는 `]`
   *    에서 끊는다 — 그래야 `arg`가 표현식 그 자체다.
   */
  const extractArg = (text: string): string => {
    let i = 0
    for (;;) {
      while (i < text.length && /\s/.test(text[i] as string)) i++
      if (text.startsWith('//', i)) {
        while (i < text.length && text[i] !== '\n') i++
        continue
      }
      break
    }
    const start = i
    let depth = 0
    let quote: string | null = null
    for (; i < text.length; i++) {
      const c = text[i] as string
      if (quote !== null) {
        if (c === '\\') i++
        else if (c === quote) quote = null
        continue
      }
      if (c === "'" || c === '"' || c === '`') quote = c
      else if (c === '(' || c === '[' || c === '{') depth++
      else if (c === ')' || c === '}') depth--
      else if (c === ']') {
        if (depth === 0) break
        depth--
      } else if (c === ',' && depth === 0) break
    }
    return text.slice(start, i).trim()
  }

  const scanCommitSites = (): Array<{ file: string; line: number; arg: string }> => {
    const files: string[] = []
    const walk = (d: string): void => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = `${d}/${e.name}`
        if (e.isDirectory()) walk(p)
        else if (e.name.endsWith('.ts')) files.push(p)
      }
    }
    walk('scripts/req')
    walk('bin')
    const out: Array<{ file: string; line: number; arg: string }> = []
    for (const f of files) {
      const s = src(f)
      const re = /'commit',\s*'-m',/g
      let m: RegExpExecArray | null
      while ((m = re.exec(s))) {
        out.push({ file: f, line: s.slice(0, m.index).split('\n').length, arg: extractArg(s.slice(m.index + m[0].length)) })
      }
    }
    return out
  }

  /**
   * 헬퍼를 **의도적으로** 거치지 않는 자리. 새 자리가 생기면 이 목록에 근거와 함께 올려야 통과한다 —
   * 즉 "빠뜨림"과 "의도적 예외"가 구별된다.
   */
  const INTENTIONAL_EXCEPTIONS: Record<string, string> = {
    // 사용자의 **소스 커밋 메시지**다. 부기가 아니라 코드 커밋이므로 표식이 붙으면 안 된다.
    'scripts/req/req-commit.ts': 'opts.message',
    // 범용 포트 — 메시지는 호출부(lib/evidence.ts)가 이미 감싸서 넘긴다. 여기서 또 감싸면 이중 trailer.
    'scripts/req/lib/evidence-ports.ts': 'message',
  }

  it('🔴 모든 커밋 자리가 bookkeepingMessage를 통과하거나 명시적 예외다', () => {
    const sites = scanCommitSites()
    // 스캐너가 실제로 무언가를 찾았는지 먼저 고정 — 0건이면 이 테스트는 아무것도 지키지 않는다.
    expect(sites.length).toBeGreaterThanOrEqual(13)

    const violations = sites.filter((s) => {
      if (s.arg.startsWith('bookkeepingMessage(')) return false
      return INTENTIONAL_EXCEPTIONS[s.file] !== s.arg
    })
    expect(violations.map((v) => `${v.file}:${v.line} → ${v.arg}`)).toEqual([])
  })

  it('추출기가 뒤따르는 구문을 섞지 않는다(예외 대조가 서식에 흔들리지 않는다)', () => {
    // r02 P1 대응: 같은 인자를 여러 서식으로 써도 arg는 표현식 그 자체여야 한다.
    const sites = scanCommitSites()
    for (const s of sites) {
      expect(s.arg, `${s.file}:${s.line}`).not.toMatch(/[\]}]\s*\)?\s*$/)
      expect(s.arg, `${s.file}:${s.line}`).not.toContain("'--'")
    }
    // 실제로 뒤에 `]`가 붙는 자리(`… , opts.message]`)와 뒤에 `, '--', …`가 붙는 자리 둘 다 표본에 있다.
    expect(sites.some((s) => s.arg === 'opts.message')).toBe(true)
    expect(sites.some((s) => s.arg.startsWith('bookkeepingMessage(') && s.arg.endsWith(')'))).toBe(true)
  })

  it('예외 목록이 실제로 존재하는 자리를 가리킨다(죽은 예외 금지)', () => {
    const sites = scanCommitSites()
    for (const [file, arg] of Object.entries(INTENTIONAL_EXCEPTIONS)) {
      expect(sites.some((s) => s.file === file && s.arg === arg), `${file}의 예외가 더 이상 존재하지 않는다`).toBe(true)
    }
  })

  it('🔴 pre-call 원장 커밋은 여전히 pathspec 커밋이다(범위 불변)', () => {
    const s = src('scripts/req/review-codex.ts')
    // `precallCommitLedgerRow`가 `'--', ledgerRel`로 경로를 한정하는 구조를 유지하는지 고정.
    const fn = s.slice(s.indexOf('export function precallCommitLedgerRow'))
    expect(fn.slice(0, 1200)).toContain("'--', // 🔴 pathspec 커밋")
    expect(fn.slice(0, 1200)).toContain('ledgerRel,')
  })
})
