import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import {
  parseArgs,
  HelpRequested,
  runIntegrate,
  executeIntegration,
  makeAppendLog,
  isYes,
  CI_RUN_PROMPT,
  finalMergePrompt,
  INTEGRATE_RUN_LOG_REL,
  type Opts,
  type RunDeps,
  type IntegrateRunRow,
} from '../../bin/integrate'
import { resolveDispatch } from '../../bin/dispatch.mjs'
import { createFakeCiRunPort, type RunInfo } from '../../scripts/req/lib/github-ci-run'
import { BOOKKEEPING_TRAILER } from '../../scripts/req/lib/bookkeeping'
import type { GitAdapter } from '../../scripts/req/lib/adapters'

/**
 * REQ-2026-126 phase-3 — integrate verb.
 * 🔴 실제 gh·네트워크 호출 없음 — CI는 fake 포트, git은 fake(충돌 복구 1건만 실 git).
 */

const BASE = '1'.repeat(40)
const HEAD = '2'.repeat(40)
const SRC = '3'.repeat(40)

function fakeGit(over?: {
  branch?: string
  porcelain?: string
  logOut?: string
  manifest?: string
  trunkMissing?: boolean
  checkIgnoreOk?: boolean
}): GitAdapter & { calls: string[][] } {
  const calls: string[][] = []
  const logOut =
    over?.logOut ??
    [
      `${SRC}\x1f${BASE}\x1ffeat: approved work\x00\n`,
      `${HEAD}\x1f${SRC}\x1fchore(REQ-x): ledger\n\n${BOOKKEEPING_TRAILER}\x00\n`,
    ].join('')
  return {
    calls,
    exec(args: string[]): string {
      calls.push(args)
      const cmd = args[0]
      if (cmd === 'rev-parse') {
        if (args[1] === '--abbrev-ref') return `${over?.branch ?? 'feat/req-2026-999-x'}\n`
        if (args[2]?.startsWith('refs/heads/')) {
          if (over?.trunkMissing) throw new Error('unknown ref')
          return `${BASE}\n`
        }
        return `${HEAD}\n`
      }
      if (cmd === 'status') return `${over?.porcelain ?? ''}\n`
      if (cmd === 'merge-base') return `${BASE}\n`
      if (cmd === 'log') return logOut
      if (cmd === 'ls-tree') return 'workflow/REQ-2026-001/responses/approvals.jsonl\n'
      if (cmd === 'show') return over?.manifest ?? `${JSON.stringify({ kind: 'phase', consumed_by_commit_sha: SRC })}\n`
      if (cmd === 'check-ignore') {
        if (over?.checkIgnoreOk === false) throw new Error('not ignored')
        return ''
      }
      if (cmd === 'checkout' || cmd === 'merge') return ''
      throw new Error(`fakeGit: 예상 밖 호출 ${args.join(' ')}`)
    },
  }
}

const run = (over: Partial<RunInfo>): RunInfo => ({
  id: 1,
  status: 'completed',
  conclusion: 'success',
  created_at: '2026-08-10T00:00:01.000Z',
  head_sha: HEAD,
  ...over,
})

function makeDeps(over?: Partial<RunDeps> & { git?: ReturnType<typeof fakeGit> }) {
  const logs: string[] = []
  const rows: IntegrateRunRow[] = []
  const asked: string[] = []
  const git = over?.git ?? fakeGit()
  let t = Date.parse('2026-08-10T00:00:00.000Z')
  const deps: RunDeps & { git: ReturnType<typeof fakeGit>; logs: string[]; rows: IntegrateRunRow[]; asked: string[] } = {
    git,
    ciPort: over?.ciPort ?? createFakeCiRunPort({ remoteSha: HEAD, listBatches: [[run({})]], runStates: [run({})] }),
    ask: over?.ask ?? (async (q) => (asked.push(q), '')),
    interactive: over?.interactive ?? false,
    appendLog: (row) => rows.push(row),
    log: (l) => logs.push(l),
    now: () => new Date(t).toISOString(),
    nowMs: () => t,
    sleep: async (ms) => {
      t += ms
    },
    trunkBranch: over?.trunkBranch === undefined ? 'main' : over.trunkBranch,
    branchPrefix: 'feat/req-',
    ticketRoot: 'workflow',
    githubCi: over?.githubCi === undefined ? null : over.githubCi,
    gitStateExists: over?.gitStateExists ?? (() => false),
    logs,
    rows,
    asked,
  }
  return deps
}

const opts = (over?: Partial<Opts>): Opts => ({ dir: '.', run: false, runGithubCi: null, ...over })

describe('parseArgs·dispatch 배선', () => {
  it('fail-closed 파싱 + alias 충돌', () => {
    expect(parseArgs(['--run'])).toMatchObject({ run: true, runGithubCi: null })
    expect(parseArgs(['--run-github-ci'])).toMatchObject({ runGithubCi: true })
    expect(parseArgs(['--no-github-ci'])).toMatchObject({ runGithubCi: false })
    expect(() => parseArgs(['--run-github-ci', '--no-github-ci'])).toThrow()
    expect(() => parseArgs(['--nope'])).toThrow('알 수 없는 옵션')
    expect(() => parseArgs(['-h'])).toThrow(HelpRequested)
  })
  it('dispatch가 integrate를 bin 모듈로 해석한다', () => {
    expect(resolveDispatch(['integrate', '--run'])).toMatchObject({ entry: 'integrate.ts', rest: ['--run'] })
  })
})

describe('dry-run(기본) — 병합하지 않는다', () => {
  it('전제 통과 → 계획 렌더·merge/checkout 미호출·exit 0·감사 로그 1행(ci: null)', async () => {
    const deps = makeDeps()
    const r = await runIntegrate(opts(), deps)
    expect(r.exit).toBe(0)
    expect(r.merged).toBe(false)
    expect(deps.logs.some((l) => l.includes('DRY-RUN'))).toBe(true)
    expect(deps.git.calls.some((c) => c[0] === 'merge' || c[0] === 'checkout')).toBe(false)
    // phase-3 r01 P1: 기본(dry-run) 실행도 1실행 1행이다 — ci는 null(실행 안 함).
    expect(deps.rows).toHaveLength(1)
    expect(deps.rows[0]).toMatchObject({ ci: null, merged: false, exit: 0 })
  })

  it('감사 로그 append가 throw해도 결과·exit가 보존된다(phase-3 r01 P1)', async () => {
    const deps = makeDeps()
    deps.appendLog = () => {
      throw new Error('EACCES: read-only')
    }
    const r = await runIntegrate(opts({ run: true }), deps)
    expect(r.merged).toBe(true) // 병합은 이미 완료 — 로그 실패가 성공을 실패로 바꾸면 안 된다
    expect(r.exit).toBe(0)
    expect(deps.logs.some((l) => l.includes('감사 로그 기록 실패'))).toBe(true)
  })

  it('미입증 존재 → 차단(목록 렌더)·exit 1·로그 1행', async () => {
    const deps = makeDeps({
      git: fakeGit({ logOut: `${SRC}\x1f${BASE}\x1fwip: unproven\x00\n`, manifest: '{}\n' }),
    })
    const r = await runIntegrate(opts({ run: true }), deps)
    expect(r.exit).toBe(1)
    expect(r.merged).toBe(false)
    expect(deps.logs.some((l) => l.includes('strict'))).toBe(true)
    expect(deps.logs.some((l) => l.includes(SRC.slice(0, 8)))).toBe(true)
    expect(deps.rows).toHaveLength(1)
    expect(deps.rows[0]).toMatchObject({ merged: false, exit: 1, ci: null })
  })
})

describe('CI 실행 opt-in(설계 DEC-2·DEC-3)', () => {
  it('config 없음·비대화형 → 질문 없이 생략(정상)·병합 진행', async () => {
    const deps = makeDeps()
    const r = await runIntegrate(opts({ run: true }), deps)
    expect(deps.asked).toHaveLength(0)
    expect(deps.logs.some((l) => l.includes('실행 생략(정상'))).toBe(true)
    expect(r.merged).toBe(true)
    expect(deps.rows[0]).toMatchObject({ ci: 'skipped', merged: true, exit: 0 })
  })

  it('--run-github-ci + config 없음 → 명확 실패·병합 없음', async () => {
    const deps = makeDeps()
    const r = await runIntegrate(opts({ run: true, runGithubCi: true }), deps)
    expect(r.exit).toBe(1)
    expect(r.merged).toBe(false)
    expect(deps.logs.some((l) => l.includes('githubCi 설정이 없습니다'))).toBe(true)
    expect(deps.git.calls.some((c) => c[0] === 'merge')).toBe(false)
  })

  it('--run-github-ci + config + fake green → run id·conclusion 로그·병합', async () => {
    const deps = makeDeps({ githubCi: { workflow: 'ci.yml', timeoutMinutes: 30 } })
    const r = await runIntegrate(opts({ run: true, runGithubCi: true }), deps)
    expect(r.merged).toBe(true)
    expect(deps.rows[0]).toMatchObject({ ci: 'run-ok', ci_run_id: 1, ci_conclusion: 'success', merged: true })
  })

  it('CI red → 통합 중단(병합 없음)·감사 로그에 결과 보존', async () => {
    const deps = makeDeps({
      githubCi: { workflow: 'ci.yml', timeoutMinutes: 30 },
      ciPort: createFakeCiRunPort({
        remoteSha: HEAD,
        listBatches: [[run({ id: 4, status: 'queued', conclusion: null })]],
        runStates: [run({ id: 4, conclusion: 'failure' })],
      }),
    })
    const r = await runIntegrate(opts({ run: true, runGithubCi: true }), deps)
    expect(r.exit).toBe(1)
    expect(r.merged).toBe(false)
    expect(deps.git.calls.some((c) => c[0] === 'merge')).toBe(false)
    expect(deps.rows[0]).toMatchObject({ ci: 'run-fail', ci_run_id: 4, ci_conclusion: 'failure', exit: 1 })
  })

  it('대화형 + config → CI 질문(고정 문구)·n이면 생략, 최종 확인 y면 병합', async () => {
    const answers = ['n', 'y'] // CI 질문 → n, 최종 확인 → y
    const asked: string[] = []
    const deps = makeDeps({
      interactive: true,
      githubCi: { workflow: 'ci.yml', timeoutMinutes: 30 },
      ask: async (q) => {
        asked.push(q)
        return answers.shift() ?? ''
      },
    })
    const r = await runIntegrate(opts({ run: true }), deps)
    expect(asked[0]).toBe(CI_RUN_PROMPT)
    expect(CI_RUN_PROMPT).toContain('실행하시겠습니까')
    expect(CI_RUN_PROMPT).toContain('사용량 또는 비용')
    expect(asked[1]).toBe(finalMergePrompt('feat/req-2026-999-x', 'main'))
    expect(r.merged).toBe(true)
    expect(deps.rows[0]).toMatchObject({ ci: 'skipped', merged: true })
  })

  it('대화형 최종 확인 기본 No(Enter) → 병합하지 않는다', async () => {
    const deps = makeDeps({ interactive: true, ask: async () => '' })
    const r = await runIntegrate(opts({ run: true }), deps)
    expect(r.merged).toBe(false)
    expect(r.exit).toBe(0) // 사용자 취소는 실패가 아니다
    expect(deps.git.calls.some((c) => c[0] === 'merge')).toBe(false)
  })
})

describe('감사 로그(설계 DEC-6)', () => {
  it('gitignore 미대상이면 기록 생략 + sync --apply --gitignore 안내', () => {
    const warns: string[] = []
    const git = fakeGit({ checkIgnoreOk: false })
    const dir = mkdtempSync(join(tmpdir(), 'cg-int-'))
    const append = makeAppendLog(dir, git, (l) => warns.push(l))
    append({} as IntegrateRunRow)
    expect(warns[0]).toContain('sync --apply --gitignore')
  })

  it('행에 CI 출력 본문·커밋 메시지가 없다(필드 화이트리스트)', async () => {
    const deps = makeDeps()
    await runIntegrate(opts({ run: true }), deps)
    const row = deps.rows[0] as IntegrateRunRow
    expect(Object.keys(row).sort()).toEqual(
      ['at', 'base', 'ci', 'ci_conclusion', 'ci_run_id', 'counts', 'exit', 'feature', 'head', 'manifest_problems', 'merge_sha', 'merged', 'trunk'].sort(),
    )
  })
})

describe('executeIntegration — 실 git 충돌 복구(완료 기준 5)', () => {
  function realGit(cwd: string) {
    return (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' })
  }

  it('충돌 병합 → abort·원래 브랜치 복귀·worktree clean', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cg-conflict-'))
    const g = realGit(dir)
    g('init', '-b', 'main')
    g('config', 'user.email', 't@t')
    g('config', 'user.name', 't')
    writeFileSync(join(dir, 'a.txt'), 'base\n')
    g('add', '.')
    g('commit', '-m', 'base')
    g('checkout', '-b', 'feat/req-x')
    writeFileSync(join(dir, 'a.txt'), 'feature\n')
    g('add', '.')
    g('commit', '-m', 'feature')
    g('checkout', 'main')
    writeFileSync(join(dir, 'a.txt'), 'trunk\n')
    g('add', '.')
    g('commit', '-m', 'trunk')
    g('checkout', 'feat/req-x')

    const adapter: GitAdapter = { exec: (args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }) }
    const r = executeIntegration(adapter, 'main', 'feat/req-x')
    expect(r.merged).toBe(false)
    expect(r.detail).toContain('원상 복구')
    expect(g('rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('feat/req-x')
    expect(g('status', '--porcelain').trim()).toBe('')
  })

  it('정상 병합 → merge 커밋 SHA 반환·trunk 위', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cg-merge-'))
    const g = realGit(dir)
    g('init', '-b', 'main')
    g('config', 'user.email', 't@t')
    g('config', 'user.name', 't')
    writeFileSync(join(dir, 'a.txt'), 'base\n')
    g('add', '.')
    g('commit', '-m', 'base')
    g('checkout', '-b', 'feat/req-x')
    writeFileSync(join(dir, 'b.txt'), 'feature\n')
    g('add', '.')
    g('commit', '-m', 'feature')

    const adapter: GitAdapter = { exec: (args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }) }
    const r = executeIntegration(adapter, 'main', 'feat/req-x')
    expect(r.merged).toBe(true)
    expect(r.mergeSha).toMatch(/^[0-9a-f]{40}$/)
    expect(g('rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('main')
    expect(r.detail).toContain('push는 하지 않았습니다')
  })
})

describe('isYes — 기본 No', () => {
  it('y/Y만 긍정', () => {
    expect(isYes('y')).toBe(true)
    expect(isYes(' Y ')).toBe(true)
    expect(isYes('')).toBe(false)
    expect(isYes('yes')).toBe(false)
    expect(isYes('n')).toBe(false)
  })
})

describe('로그 경로 상수', () => {
  it('workflow/.integrate-runs.jsonl — 템플릿 앵커·smoke 단언과 짝', () => {
    expect(INTEGRATE_RUN_LOG_REL).toBe('workflow/.integrate-runs.jsonl')
  })
})
