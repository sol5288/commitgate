/**
 * REQ-2026-149 phase-2 — 파킹 pathspec + series 결속.
 *
 * 🔴 두 결함 다 **조용히 잘못된 것을 한다**: 파킹은 티켓 밖 파일을 커밋에 끌어들이고, replace 는
 *    지정하지 않은 series 를 닫으면서 지정한 것을 닫았다고 보고한다. 순수 판정으로는 안 보인다 —
 *    실제 git 과 실제 상태로 확인한다.
 */
import { describe, it, expect, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nextChoices } from '../../scripts/req/lib/nonconvergence'
import { closeSeriesHumanResolutionById, type WorkflowState } from '../../scripts/req/review-codex'
import { main as reviewExceptionMain } from '../../scripts/req/req-review-exception'
import { packageRoot } from '../../scripts/req/lib/config'

const HR = { decision: 'replace', method: '승인함', decided_at: '2026-08-14T00:00:00Z' } as const

describe('[REQ-2026-149] 🔴 파킹 커밋이 티켓 밖 파일을 끌어들이지 않는다 (실 git)', () => {
  it('이미 staged 인 티켓 밖 비밀 파일이 파킹 커밋에 **없고** staged 로 남는다', () => {
    const repo = mkdtempSync(join(tmpdir(), 'req149p2-'))
    const git = (args: string[]): string =>
      execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: repo, encoding: 'utf8' })
    git(['init', '-q'])
    git(['config', 'user.email', 't@t.t'])
    git(['config', 'user.name', 't'])
    writeFileSync(join(repo, 'seed.txt'), 'seed')
    git(['add', '-A'])
    git(['commit', '-qm', 'baseline'])

    const ticketRel = 'workflow/REQ-2026-149'
    mkdirSync(join(repo, ticketRel, 'responses'), { recursive: true })
    // 티켓 안: untracked 아카이브(파킹이 담아야 할 것)
    writeFileSync(join(repo, ticketRel, 'responses', 'design-r01-needs-fix.json'), '{}')
    writeFileSync(join(repo, ticketRel, '01-design.md'), '# design\n')
    // 티켓 밖: **이미 staged 인** 비밀 파일(파킹이 담으면 안 되는 것)
    writeFileSync(join(repo, 'secrets.env'), 'TOKEN=abcd')
    git(['add', '--', 'secrets.env'])

    // 보고가 내는 파킹 두 줄을 그대로 실행한다.
    const { replace } = nextChoices({
      reqId: 'REQ-2026-149',
      seriesId: 'design:-#1',
      hasOpenAttempt: false,
      ticketDirty: true,
      outsideDirty: ['secrets.env'],
      ticketRel,
      successorSlug: 'x-successor',
      rounds: [],
      hardCap: 8,
      attempt: 9,
    })
    const shell = replace.filter((c) => c.kind === 'shell').map((c) => c.text)
    expect(shell).toHaveLength(2)
    // 🔴 두 번째 줄에 pathspec 이 있어야 한다 — 없으면 staged 인 secrets.env 가 실린다.
    expect(shell[1]).toContain(`-- "${ticketRel}"`)
    for (const line of shell) {
      const m = /^git (add|commit) (.*)$/.exec(line)!
      const argv = (m[2] as string).match(/(?:[^\s"]+|"[^"]*")+/g)!.map((a) => a.replace(/^"|"$/g, ''))
      git([m[1] as string, ...argv])
    }

    const committed = git(['show', '--name-only', '--format=', 'HEAD']).split('\n').map((l) => l.trim()).filter(Boolean)
    // 🔴 티켓 파일은 들어가고
    expect(committed.some((f) => f.startsWith(ticketRel))).toBe(true)
    // 🔴 티켓 밖 비밀 파일은 **들어가지 않는다**
    expect(committed).not.toContain('secrets.env')
    // 🔴 그리고 여전히 staged 로 남는다(사용자가 잃지 않는다)
    expect(git(['diff', '--cached', '--name-only']).trim()).toContain('secrets.env')
    rmSync(repo, { recursive: true, force: true })
  })
})

describe('[REQ-2026-149] 🔴 replace 는 지정한 series_id 만 닫는다', () => {
  const twoOpen = (): WorkflowState =>
    ({
      id: 'REQ-2026-149',
      review_series_model_version: 1,
      review_series: [
        { series_id: 'design:-#1', review_kind: 'design', phase_id: null, attempts: 8, closed_reason: null },
        { series_id: 'design:-#2', review_kind: 'design', phase_id: null, attempts: 1, closed_reason: null },
      ],
    }) as unknown as WorkflowState

  it('같은 (kind, phase) 에 둘이 열려 있어도 지정한 것만 닫힌다', () => {
    const out = closeSeriesHumanResolutionById(twoOpen(), 'design:-#2', HR)
    const series = (out as unknown as { review_series: Record<string, unknown>[] }).review_series
    expect(series[0]!.closed_reason).toBeNull()
    expect(series[1]!.closed_reason).toBe('human-resolution')
  })

  it('🔴 첫 항목을 조용히 고르지 않는다 — 없으면 명시적 throw', () => {
    expect(() => closeSeriesHumanResolutionById(twoOpen(), 'design:-#9', HR)).toThrow(/design:-#9/)
  })

  it('이미 닫힌 series 는 거부', () => {
    const closed = closeSeriesHumanResolutionById(twoOpen(), 'design:-#1', HR)
    expect(() => closeSeriesHumanResolutionById(closed, 'design:-#1', HR)).toThrow(/이미 닫혔다/)
  })

  it('🔴 phase id 에 `#` 이 있어도 원문 대조로 찾는다(REQ-2026-145 계약 유지)', () => {
    const st = {
      review_series: [{ series_id: 'phase:phase#alpha#2', review_kind: 'phase', phase_id: 'phase#alpha', attempts: 1, closed_reason: null }],
    } as unknown as WorkflowState
    const out = closeSeriesHumanResolutionById(st, 'phase:phase#alpha#2', HR)
    expect((out as unknown as { review_series: Record<string, unknown>[] }).review_series[0]!.closed_reason).toBe('human-resolution')
  })

  it('무효한 resolution 은 거부', () => {
    expect(() => closeSeriesHumanResolutionById(twoOpen(), 'design:-#1', { ...HR, method: '' })).toThrow(/형식 무효/)
  })
})

describe('[REQ-2026-149] 🔴 실 CLI e2e — --series 로 지정한 것만 닫힌다', () => {
  it('열린 series 가 둘일 때 두 번째를 지정하면 첫 번째는 그대로다', () => {
    const repo = mkdtempSync(join(tmpdir(), 'req149cli-'))
    const git = (args: string[]): string =>
      execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: repo, encoding: 'utf8' })
    git(['init', '-q'])
    git(['config', 'user.email', 't@t.t'])
    git(['config', 'user.name', 't'])
    writeFileSync(join(repo, 'package.json'), '{"name":"x","version":"0.0.0"}')
    mkdirSync(join(repo, 'workflow'), { recursive: true })
    writeFileSync(
      join(repo, 'workflow', 'machine.schema.json'),
      readFileSync(join(packageRoot(), 'workflow', 'machine.schema.json'), 'utf8'),
    )
    writeFileSync(join(repo, 'req.config.json'), JSON.stringify({ packageManager: 'npm', reviewPersonaPath: null }))
    const ticket = join(repo, 'workflow', 'REQ-2026-001')
    mkdirSync(ticket, { recursive: true })
    writeFileSync(
      join(ticket, 'state.json'),
      JSON.stringify(
        {
          id: 'REQ-2026-001',
          branch: 'feat/req-2026-001-x',
          review_series_model_version: 1,
          review_series: [
            { series_id: 'design:-#1', review_kind: 'design', phase_id: null, attempts: 8, closed_reason: null },
            { series_id: 'design:-#2', review_kind: 'design', phase_id: null, attempts: 1, closed_reason: null },
          ],
        },
        null,
        2,
      ) + '\n',
    )
    git(['add', '-A'])
    git(['commit', '-qm', 'baseline'])

    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    try {
      reviewExceptionMain([
        '2026-001', '--resolve', 'replace', '--series', 'design:-#2',
        '--reason', '두 번째 series 를 대체한다', '--confirm', '팀장 승인 2026-08-14',
        '--run', '--root', repo,
      ])
    } finally {
      spy.mockRestore()
    }
    const st = JSON.parse(readFileSync(join(ticket, 'state.json'), 'utf8')) as {
      review_series: Record<string, unknown>[]
    }
    // 🔴 지정하지 않은 #1 은 열린 채로 남아야 한다.
    expect(st.review_series[0]!.closed_reason).toBeNull()
    expect(st.review_series[1]!.closed_reason).toBe('human-resolution')
    rmSync(repo, { recursive: true, force: true })
  })
})
