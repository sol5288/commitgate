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

  it('🔴 `-u` 를 쓰지 않는다 — untracked 는 브랜치 전환을 따라온다', () => {
    expect(terminalReentryProblem('REQ-2026-149', 'dev-complete')!).not.toContain('stash push -u')
  })

  it('아무것도 쓰지 않았음을 말한다', () => {
    expect(terminalReentryProblem('REQ-2026-149', 'dev-complete')!).toContain('아무것도 쓰지 않았습니다')
  })
})

describe('[REQ-2026-151] 🔴 실 CLI e2e — 차단이 source 커밋 前에 일어난다', () => {
  const gitOf = (repo: string) => (args: string[]): string =>
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: repo, encoding: 'utf8' })

  /** 종결(abandoned) 티켓 + staged 코드 변경. */
  const terminalTicket = (): { repo: string } => {
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
    git(['add', '-A'])
    git(['commit', '-qm', 'baseline'])
    git(['checkout', '-qb', 'feat/req-2026-001-x'])
    // 완료된 티켓에 새 변경을 stage — 이것이 재현 조건이다.
    writeFileSync(join(repo, 'code.ts'), 'export const a = 2\n')
    git(['add', '--', 'code.ts'])
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

    // 안내대로 실행한다.
    git(['stash', 'push', '-m', 'REQ-2026-001 follow-up'])
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

    // 🔴 새 티켓 브랜치에 그 변경이 복원돼 있다.
    expect(git(['branch', '--show-current']).trim()).toMatch(/req-2026-001-followup/)
    expect(readFileSync(join(repo, 'code.ts'), 'utf8')).toContain('= 2')
    rmSync(repo, { recursive: true, force: true })
  }, 90_000)
})
