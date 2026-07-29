/**
 * REQ-2026-085 phase-2 — 부기 커밋 표식(DEC-6·7).
 *
 * 🔴 이 파일의 핵심은 **문서에 적힌 읽기 명령이 실제로 동작하는가**다. 상수만 단언하면 tautology이므로
 *    실 git repo에 부기 커밋과 코드 커밋을 섞어 만들고 그 명령을 그대로 돌린다.
 */
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, readFileSync, mkdirSync } from 'node:fs'
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

describe('[REQ-2026-085 DEC-6] 리뷰 루프 커밋 자리가 헬퍼를 통과한다(정적)', () => {
  const src = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8')

  it('고빈도 4개 자리가 bookkeepingMessage를 쓴다', () => {
    // 이 phase의 적용 대상. 저빈도 lifecycle 자리는 phase-3에서 전수 스캔한다.
    for (const rel of [
      'scripts/req/review-codex.ts',
      'scripts/req/req-commit.ts',
      'scripts/req/lib/state-checkpoint.ts',
      'scripts/req/lib/evidence.ts',
    ]) {
      expect(src(rel), `${rel}이 헬퍼를 import해야 한다`).toContain('bookkeepingMessage')
    }
  })

  it('🔴 pre-call 원장 커밋은 여전히 pathspec 커밋이다(범위 불변)', () => {
    const s = src('scripts/req/review-codex.ts')
    // `precallCommitLedgerRow`가 `'--', ledgerRel`로 경로를 한정하는 구조를 유지하는지 고정.
    const fn = s.slice(s.indexOf('export function precallCommitLedgerRow'))
    expect(fn.slice(0, 900)).toContain("'--', // 🔴 pathspec 커밋")
    expect(fn.slice(0, 900)).toContain('ledgerRel,')
  })
})
