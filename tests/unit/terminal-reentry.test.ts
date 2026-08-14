/**
 * REQ-2026-151 phase-1 — 종결 티켓 재진입 차단.
 *
 * 🔴 지금까지는 **되돌릴 수 없는 것(source 커밋)을 먼저 하고 나서** 막았다. 그 뒤엔
 *    `approvals.jsonl` 이 더러워 D10 이 모든 `req:commit`·`--finalize` 를 막았고 나가는 길이 없었다.
 *    이 저장소가 실제로 밟았다(REQ-2026-149 회귀 수정을 완결 티켓에 덧붙이다가).
 */
import { describe, it, expect } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { packageRoot } from '../../scripts/req/lib/config'
import { terminalReentryProblem } from '../../scripts/req/req-commit'
import { shellSafeArg } from '../../scripts/req/lib/shell-safe'

describe('[REQ-2026-151] terminalReentryProblem (순수)', () => {
  it('🔴 완료 계열은 전부 차단한다', () => {
    for (const s of ['dev-complete', 'migrated-complete', 'abandoned'])
      expect(terminalReentryProblem('REQ-2026-149', s), s).not.toBeNull()
  })

  it('🔴 series-terminal 은 차단하지 않는다 — 대체 REQ 흐름이 그 상태를 지난다', () => {
    expect(terminalReentryProblem('REQ-2026-149', 'series-terminal')).toBeNull()
  })

  it('진행 중·legacy·판독 실패는 차단하지 않는다', () => {
    for (const s of ['developing', 'needs-recovery', 'corrupt', 'legacy', null])
      expect(terminalReentryProblem('REQ-2026-149', s), String(s)).toBeNull()
  })

  it('🔴 안내가 세 줄을 순서대로 준다 — 한 줄만 내면 clean-tree 로 막힌다', () => {
    const msg = terminalReentryProblem('REQ-2026-149', 'dev-complete')!
    expect(msg).toContain('git stash push')
    expect(msg).toContain('npx commitgate req:new req-2026-149-followup --run')
    expect(msg).toContain('git stash pop')
    expect(msg.indexOf('git stash push')).toBeLessThan(msg.indexOf('req:new'))
    expect(msg.indexOf('req:new')).toBeLessThan(msg.indexOf('git stash pop'))
  })

  it('🔴 꺾쇠 자리표시자가 없고 slug 는 산출된다', () => {
    const msg = terminalReentryProblem('REQ-2026-149', 'dev-complete')!
    expect(msg).not.toContain('<')
    expect(shellSafeArg('req-2026-149-followup')).toBe(true)
  })

  /**
   * 🔴 REQ-2026-152: **계약이 뒤집혔다.** 여기 있던 "`-u` 를 쓰지 않는다" 는 **틀린 동작을 고정**하고
   *    있었다 — `req:new` 가 일반 untracked 를 clean-tree 위반으로 거부하므로, 보관하지 않으면 안내
   *    두 번째 줄이 그 자리에서 실패한다. 지우지 않고 반대 계약으로 남긴다.
   */
  it('🔴 untracked 를 함께 보관한다 — 안 하면 다음 줄의 req:new 가 거부된다', () => {
    expect(terminalReentryProblem('REQ-2026-149', 'dev-complete')!).toContain('stash push --include-untracked')
  })

  it('🔴 `--all` 은 쓰지 않는다 — ignored(node_modules·.env)까지 stash 로 들어간다', () => {
    const msg = terminalReentryProblem('REQ-2026-149', 'dev-complete')!
    expect(msg).not.toContain('--all')
    expect(msg).not.toContain('stash push -a')
  })

  it('아무것도 쓰지 않았음을 말한다', () => {
    expect(terminalReentryProblem('REQ-2026-149', 'dev-complete')!).toContain('아무것도 쓰지 않았습니다')
  })
})

describe('[REQ-2026-152] DEC-1a — 미커밋 .gitignore 줄 (순수)', () => {
  const msg = (ig: string[]) => terminalReentryProblem('REQ-2026-149', 'dev-complete', ig)!

  it('🔴 목록이 비면 그 줄을 내지 않는다 — 내면 "커밋할 것이 없다"로 실패한다', () => {
    expect(msg([])).not.toContain('git add --')
    expect(msg([])).not.toContain('chore: .gitignore')
  })

  it('🔴 목록이 있으면 add·commit 두 줄을 stash 보다 앞에 낸다', () => {
    const m = msg(['.gitignore'])
    expect(m).toContain('git add -- ".gitignore"')
    expect(m).toContain('git commit -m "chore: .gitignore" -- ".gitignore"')
    // 🔴 순서가 뒤집히면 stash 가 규칙을 먼저 되돌린다.
    expect(m.indexOf('git add --')).toBeLessThan(m.indexOf('git stash push'))
    expect(m.indexOf('git commit -m "chore: .gitignore"')).toBeLessThan(m.indexOf('git stash push'))
  })

  it('🔴 `-i`/`--include` 를 쓰지 않는다 — untracked 를 못 만들고 인덱스 전체를 쓸어간다', () => {
    const m = msg(['.gitignore'])
    expect(m).not.toContain('--include ')
    expect(m).not.toContain('commit -i')
  })

  it('🔴 중첩 경로를 모두 낸다 — glob 이 아니라 실제 경로다', () => {
    const m = msg(['.gitignore', 'packages/app/.gitignore'])
    expect(m).toContain('git add -- ".gitignore" "packages/app/.gitignore"')
    expect(m).not.toContain('**/.gitignore')
    expect(m).not.toContain('*.gitignore')
  })

  /**
   * 🔴 phase-1 r02 P1: `SAFE_ARG_RE` 는 `#` 를 허용하지만 그것은 **큰따옴표 안에서** 안전하다는
   *    뜻이다. 맨몸으로 내면 bash·PowerShell 이 주석으로 읽어 `git add --` 가 pathspec 없이 돌고,
   *    이어지는 `commit` 이 staged 전체를 커밋할 위험이 있다.
   */
  it('🔴 `#` 로 시작하는 경로도 인용해서 낸다 — 맨몸이면 셸이 주석으로 먹는다', () => {
    const m = msg(['#config/.gitignore'])
    expect(m).toContain('"#config/.gitignore"')
    expect(m).not.toContain('-- #config/.gitignore')
  })

  it('🔴 모든 안전 경로를 인용한다 — 인용 없는 pathspec 이 남지 않는다', () => {
    const m = msg(['a/.gitignore', 'b/.gitignore'])
    const add = m.split('\n').find((l) => l.includes('git add --'))!
    // `--` 뒤의 토큰은 전부 큰따옴표로 감싸여 있어야 한다.
    for (const tok of add.slice(add.indexOf('--') + 2).trim().split(' '))
      expect(tok, tok).toMatch(/^".*"$/)
  })

  /**
   * 🔴 phase-1 r03 P1: add·commit 만 숨기고 stash·req:new·pop 을 그대로 내면, **그 세 줄만
   *    실행했을 때** stash 가 규칙을 되돌려 이 절이 막으려던 노출이 그대로 일어난다.
   *    안전하지 않으면 **명령열 전체**를 내지 않는다.
   */
  it('🔴 셸 안전하지 않은 경로가 있으면 명령열 전체를 내지 않는다(반쪽 명령열 금지)', () => {
    const m = msg(['packages/my app/.gitignore'])
    for (const cmd of ['git add --', 'git commit -m "chore: .gitignore"', 'git stash push', 'npx commitgate', 'git stash pop'])
      expect(m, cmd).not.toContain(cmd)
    // 🔴 실행 가능한 줄이 **하나도** 없다 — 산문에서 명령 이름을 언급하는 것과 다르다.
    for (const line of m.split('\n')) expect(line.trim(), line).not.toMatch(/^(git|npx|npm|pnpm|yarn)\s/)
    // 대신 데이터로 보여 주고, 되돌아오는 길을 준다.
    expect(m).toContain('packages/my app/.gitignore')
    expect(m).toContain('미커밋 .gitignore 를 커밋')
    expect(m).toContain('다시 실행')
    expect(m).toContain('아무것도 쓰지 않았습니다')
  })

  it('🔴 하나라도 안전하지 않으면 전부 데이터로 — 안전한 것만 골라 반쪽 명령을 만들지 않는다', () => {
    const m = msg(['.gitignore', 'packages/my app/.gitignore'])
    expect(m).not.toContain('git add --')
    expect(m).not.toContain('git stash push')
  })

  it('실패하면 멈추라고 말한다 — add 뒤 commit 이 실패하면 staged 로 남는다', () => {
    expect(msg(['.gitignore'])).toContain('실패하면 멈추십시오')
  })
})

/**
 * 🔴 phase-1 r02 P1: `-z` porcelain 이 준 경로가 정본이다. Unix 에서 역슬래시는 **파일명의 일부**라
 *    `/` 로 바꾸면 존재하지 않는 경로를 안내하게 되고 첫 명령부터 실패한다.
 */
describe('[REQ-2026-152] 🔴 경로를 정규화하지 않는다', () => {
  const src = readFileSync(join(process.cwd(), 'scripts/req/req-commit.ts'), 'utf8')

  it('수집 파이프라인에 역슬래시 치환이 없다', () => {
    const i = src.indexOf('let dirtyGitignores')
    const j = src.indexOf('const reentry =', i)
    expect(src.slice(i, j)).not.toContain(".replace(/\\\\/g, '/')")
  })

  it('역슬래시가 든 경로가 그대로 안내에 나온다', () => {
    const p = 'a\\b/.gitignore'
    const m = terminalReentryProblem('REQ-2026-149', 'dev-complete', [p])!
    expect(m).toContain(p)
    expect(m).not.toContain('a/b/.gitignore')
  })
})

describe('[REQ-2026-152] 🔴 배선 가드 — 호출부가 사실을 실제로 넘긴다', () => {
  const src = readFileSync(join(process.cwd(), 'scripts/req/req-commit.ts'), 'utf8')

  it('terminalReentryProblem 이 3번째 인자를 받는다(계산만 하고 안 넘기는 끊김 방지)', () => {
    expect(src).toMatch(/terminalReentryProblem\(String\(state\.id \?\? ''\), baseState, dirtyGitignores, narrowing\)/)
  })

  it('🔴 목록이 모든 깊이의 .gitignore 를 본다 — 루트만 보면 중첩을 놓친다', () => {
    expect(src).toMatch(/p === '\.gitignore' \|\| p\.endsWith\('\/\.gitignore'\)/)
  })

  it('🔴 읽기 실패는 차단하지 않는다(빈 목록으로 떨어진다)', () => {
    const i = src.indexOf('let dirtyGitignores')
    const j = src.indexOf('const reentry =', i)
    expect(src.slice(i, j)).toMatch(/catch \{\s*\n\s*dirtyGitignores = \[\]/)
  })
})

describe('[REQ-2026-151] 🔴 실 CLI e2e — 차단이 source 커밋 前에 일어난다', () => {
  const gitOf = (repo: string) => (args: string[]): string =>
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: repo, encoding: 'utf8' })

  /** 종결(abandoned) 티켓 + staged 코드 변경. */
  const terminalTicket = (opts: { gitignore?: string } = {}): { repo: string } => {
    const repo = mkdtempSync(join(tmpdir(), 'req151-'))
    const git = gitOf(repo)
    git(['init', '-q'])
    git(['config', 'user.email', 't@t.t'])
    git(['config', 'user.name', 't'])
    const tsx = join(packageRoot(), 'node_modules', 'tsx', 'dist', 'cli.mjs').split('\\').join('/')
    const doctorTs = join(packageRoot(), 'scripts', 'req', 'req-doctor.ts').split('\\').join('/')
    writeFileSync(
      join(repo, 'package.json'),
      JSON.stringify({ name: 'x', version: '0.0.0', scripts: { 'req:doctor': `node ${tsx} ${doctorTs}` } }),
    )
    mkdirSync(join(repo, 'workflow', 'REQ-2026-001', 'responses'), { recursive: true })
    writeFileSync(
      join(repo, 'workflow', 'machine.schema.json'),
      readFileSync(join(packageRoot(), 'workflow', 'machine.schema.json'), 'utf8'),
    )
    writeFileSync(join(repo, 'workflow', '.gitignore'), '/.review-calls.jsonl\n/.doctor-runs.jsonl\n')
    writeFileSync(join(repo, 'req.config.json'), JSON.stringify({ packageManager: 'npm', reviewPersonaPath: null }))
    const ticket = join(repo, 'workflow', 'REQ-2026-001')
    writeFileSync(
      join(ticket, 'state.json'),
      `${JSON.stringify({ id: 'REQ-2026-001', branch: 'feat/req-2026-001-x', phases: [], consumed_approvals: [], approval_evidence_required: true, evidence_durability_required: true, review_series_model_version: 1 }, null, 2)}\n`,
    )
    /**
     * 🔴 **`abandoned`** 로 만든다. 차단 대상은 `dev-complete`·`migrated-complete`·`abandoned` 로 같지만,
     *    `dev-complete` 는 self-verifying 이라 매니페스트의 design·phase 행과 아카이브 blob 무결성까지
     *    맞아야 그 상태로 읽힌다(아니면 `developing`). 티켓 단위 사건인 `abandoned` 가 **같은 차단을
     *    훨씬 적은 fixture 로** 구동한다.
     */
    writeFileSync(
      join(ticket, 'responses', 'ticket-close.jsonl'),
      `${JSON.stringify({
        ticket_id: 'REQ-2026-001',
        event: 'abandoned',
        series_id: null,
        resolution: null,
        phase_inventory: null,
        design_ref: null,
        at: '2026-08-14T00:00:00Z',
        reconstructed: false,
        // 🔴 키는 필수이고 원본 행(reconstructed:false)에서는 `null` 이다(빈 배열이 아니다).
        evidence_basis: null,
        abandon_reason: '요구가 철회됨',
        method: 'PM 승인 2026-08-14',
      })}\n`,
    )
    writeFileSync(join(repo, 'code.ts'), 'export const a = 1\n')
    // 🔴 REQ-2026-154: HEAD 에 루트 `.gitignore` 를 둘 수 있다(완화 판정의 기준선).
    if (opts.gitignore !== undefined) writeFileSync(join(repo, '.gitignore'), opts.gitignore)
    git(['add', '-A'])
    git(['commit', '-qm', 'baseline'])
    git(['checkout', '-qb', 'feat/req-2026-001-x'])
    // 완료된 티켓에 새 변경을 stage — 이것이 재현 조건이다.
    writeFileSync(join(repo, 'code.ts'), 'export const a = 2\n')
    git(['add', '--', 'code.ts'])
    /**
     * 🔴 REQ-2026-152: **일반 untracked 파일**을 함께 둔다. 이것이 없어서 REQ-2026-151 의 e2e 가
     *    통과했고, 안내 두 번째 줄(`req:new`)이 실제로는 거부된다는 사실을 놓쳤다.
     */
    writeFileSync(join(repo, 'notes.txt'), 'follow-up 메모\n')
    return { repo }
  }

  const runCommit = (repo: string) =>
    spawnSync(
      process.execPath,
      [
        join(packageRoot(), 'node_modules', 'tsx', 'dist', 'cli.mjs'),
        join(packageRoot(), 'scripts', 'req', 'req-commit.ts'),
        '2026-001', '--run', '-m', 'fix: follow-up', '--root', repo,
      ],
      { cwd: repo, encoding: 'utf8' },
    )

  it('🔴 HEAD·커밋 수 불변 + 새 더러움 없음 — 되돌릴 수 없는 것을 만들지 않는다', () => {
    const { repo } = terminalTicket()
    const git = gitOf(repo)
    const headBefore = git(['rev-parse', 'HEAD']).trim()
    const countBefore = Number(git(['rev-list', '--count', 'HEAD']).trim())
    const dirtyBefore = git(['status', '--porcelain']).trim()

    const res = runCommit(repo)

    expect(res.status).not.toBe(0)
    expect(git(['rev-parse', 'HEAD']).trim()).toBe(headBefore)
    expect(Number(git(['rev-list', '--count', 'HEAD']).trim())).toBe(countBefore)
    // 🔴 approvals.jsonl·아카이브·state 에 새 더러움이 생기지 않았다(= 이후 D10 이 막지 않는다).
    expect(git(['status', '--porcelain']).trim()).toBe(dirtyBefore)
    rmSync(repo, { recursive: true, force: true })
  }, 60_000)

  it('🔴 안내한 세 줄이 실제로 이어진다 — stash → req:new → pop', () => {
    const { repo } = terminalTicket()
    const git = gitOf(repo)
    const res = runCommit(repo)
    const msg = `${res.stdout}${res.stderr}`
    expect(msg).toContain('git stash push')

    /**
     * 🔴 REQ-2026-152: **안내에서 인자를 뽑아 실행한다.** 손으로 다시 쓰면 안내와 테스트가 갈라져
     *    "안내가 실행 가능한가"를 아예 묻지 않게 된다 — REQ-2026-151 의 e2e 가 그랬다.
     */
    const stashLine = msg.split('\n').map((l) => l.trim()).find((l) => l.startsWith('git stash push'))
    expect(stashLine, '안내에 stash 줄이 없다').toBeTruthy()
    const flags = stashLine!.slice('git stash push'.length, stashLine!.indexOf('-m')).trim()
    git(['stash', 'push', ...(flags ? flags.split(/\s+/) : []), '-m', 'REQ-2026-001 follow-up'])
    // 🔴 세 줄이 이어지려면 이 시점에 워킹트리가 정말 clean 이어야 한다 — `req:new` 의 요구다.
    //    보관에서 빠진 파일이 하나라도 있으면 다음 줄이 그 자리에서 거부된다.
    expect(git(['status', '--porcelain']).trim()).toBe('')
    const nw = spawnSync(
      process.execPath,
      [
        join(packageRoot(), 'node_modules', 'tsx', 'dist', 'cli.mjs'),
        join(packageRoot(), 'scripts', 'req', 'req-new.ts'),
        'req-2026-001-followup', '--run', '--root', repo,
      ],
      { cwd: repo, encoding: 'utf8' },
    )
    expect(nw.status, `${nw.stdout}\n${nw.stderr}`).toBe(0)
    git(['stash', 'pop'])

    // 🔴 새 티켓 브랜치에 그 변경이 복원돼 있다 — tracked 와 untracked **둘 다**.
    expect(git(['branch', '--show-current']).trim()).toMatch(/req-2026-001-followup/)
    expect(readFileSync(join(repo, 'code.ts'), 'utf8')).toContain('= 2')
    expect(readFileSync(join(repo, 'notes.txt'), 'utf8')).toContain('follow-up 메모')
    rmSync(repo, { recursive: true, force: true })
  }, 90_000)

  /**
   * 🔴 REQ-2026-152 DEC-1a — **stash 가 ignore 규칙을 되돌리는** 경우. 안내 전체를 그대로 실행해
   *    끝까지 성공하는지 본다. 루트와 중첩을 **둘 다** 본다(설계 r02 P1: 루트만 보면 중첩을 놓친다).
   */
  for (const [label, dir] of [
    ['루트 .gitignore', ''],
    ['중첩 .gitignore', 'packages/app'],
  ] as [string, string][]) {
    it(`🔴 미커밋 ${label} + ignored 디렉터리가 있어도 안내 전체가 성공한다`, () => {
      const { repo } = terminalTicket()
      const git = gitOf(repo)
      const base = dir ? join(repo, dir) : repo
      mkdirSync(join(base, 'node_modules'), { recursive: true })
      writeFileSync(join(base, '.gitignore'), 'node_modules/\n')
      writeFileSync(join(base, 'node_modules', 'a.js'), 'junk\n')

      const res = runCommit(repo)
      const msg = `${res.stdout}${res.stderr}`
      expect(res.status).not.toBe(0)

      // 🔴 안내에 적힌 명령 줄들을 **읽어서** 순서대로 실행한다.
      const lines = msg.split('\n').map((l) => l.trim())
      const igRel = dir ? `${dir}/.gitignore` : '.gitignore'
      expect(lines).toContain(`git add -- "${igRel}"`)
      git(['add', '--', igRel])
      git(['commit', '-m', 'chore: .gitignore', '--', igRel])

      const stashLine = lines.find((l) => l.startsWith('git stash push'))!
      const flags = stashLine.slice('git stash push'.length, stashLine.indexOf('-m')).trim()
      git(['stash', 'push', ...(flags ? flags.split(/\s+/) : []), '-m', 'REQ-2026-001 follow-up'])

      // 🔴 여기서 clean 이 아니면 다음 줄의 req:new 가 거부된다 — 이것이 이 e2e 의 핵심 오라클이다.
      expect(git(['status', '--porcelain']).trim()).toBe('')

      const nw = spawnSync(
        process.execPath,
        [
          join(packageRoot(), 'node_modules', 'tsx', 'dist', 'cli.mjs'),
          join(packageRoot(), 'scripts', 'req', 'req-new.ts'),
          'req-2026-001-followup', '--run', '--root', repo,
        ],
        { cwd: repo, encoding: 'utf8' },
      )
      expect(nw.status, `${nw.stdout}\n${nw.stderr}`).toBe(0)
      git(['stash', 'pop'])

      expect(git(['branch', '--show-current']).trim()).toMatch(/req-2026-001-followup/)
      expect(readFileSync(join(repo, 'code.ts'), 'utf8')).toContain('= 2')
      rmSync(repo, { recursive: true, force: true })
    }, 90_000)
  }

  /**
   * 🔴 REQ-2026-154 DEC-3 — ignore 범위가 **좁아질 수 있는** 변경에는 자동 명령을 내지 않는다.
   *
   * REQ-2026-152 의 안내는 종류를 구분하지 않아, 완화를 커밋시켜 새 티켓 브랜치에 영구히 남겼다
   * (실측: pop 뒤 `?? node_modules/` 가 남아 다음 리뷰가 D10 에서 막힌다).
   */
  for (const [label, headIgnore, workIgnore] of [
    ['규칙 삭제', 'node_modules/\n', '\n'],
    ['파일 삭제', 'node_modules/\n', null],
    ['`!` 삽입', '*.log\n', '*.log\n!keep.log\n'],
    // 🔴 줄 집합은 같고 **순서만** 뒤집혔다 — 집합 비교로는 못 잡는다(설계 r02 P1).
    ['순서 재배치', '!keep.log\n*.log\n', '*.log\n!keep.log\n'],
  ] as [string, string, string | null][]) {
    it(`🔴 ${label} 은 자동 명령을 내지 않고 사람에게 넘긴다`, () => {
      const { repo } = terminalTicket({ gitignore: headIgnore })
      const git = gitOf(repo)
      if (workIgnore === null) rmSync(join(repo, '.gitignore'))
      else writeFileSync(join(repo, '.gitignore'), workIgnore)

      const res = runCommit(repo)
      const msg = `${res.stdout}${res.stderr}`

      expect(res.status).not.toBe(0)
      expect(msg).toContain('ignore 범위를 **좁힐 수 있습니다**')
      expect(msg).toContain('.gitignore')
      expect(msg).toContain('직접')
      // 🔴 명령열 **전체**를 내지 않는다 — 남은 셋만 실행해도 같은 노출이 일어난다.
      for (const line of msg.split('\n')) expect(line.trim(), line).not.toMatch(/^(git|npx|npm|pnpm|yarn)\s/)
      expect(msg).toContain('아무것도 쓰지 않았습니다')
      // 🔴 그리고 실제로 아무것도 쓰지 않았다.
      expect(git(['status', '--porcelain']).trim()).not.toBe('')
      rmSync(repo, { recursive: true, force: true })
    }, 60_000)
  }

  it('🔴 비-부정 줄만 추가하면 종전대로 자동 명령을 낸다(무회귀)', () => {
    const { repo } = terminalTicket({ gitignore: '*.log\n' })
    writeFileSync(join(repo, '.gitignore'), '*.log\nnode_modules/\n')
    const msg = `${runCommit(repo).stdout}${runCommit(repo).stderr}`
    expect(msg).toContain('git add -- ".gitignore"')
    expect(msg).toContain('git stash push --include-untracked')
    rmSync(repo, { recursive: true, force: true })
  }, 60_000)
})
