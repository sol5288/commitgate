/**
 * `commitgate verify-range` CLI — 완료 기준 10개 시나리오(00-requirement)를 fake 포트로 고정한다.
 * 🔴 실제 GitHub API·gh CLI·네트워크를 호출하지 않는다(완료 기준 10) — `GithubCiPort`는 전부 fake다.
 */
import { describe, it, expect } from 'vitest'
import {
  parseArgs,
  HelpRequested,
  decideCiMode,
  ciModeFromAnswer,
  judgeCheckRunsPayload,
  createGhCiAdapter,
  runVerifyRange,
  collectCommits,
  CI_PROMPT,
  type Opts,
  type RunDeps,
  type GithubCiPort,
  type VerifyRunRow,
} from '../../bin/verify-range'
import { BOOKKEEPING_TRAILER } from '../../scripts/req/lib/bookkeeping'
import type { GitAdapter } from '../../scripts/req/lib/adapters'

const TRUNK = 'main'
const BASE_SHA = '1'.repeat(40)
const HEAD_SHA = '2'.repeat(40)
const SRC_SHA = '3'.repeat(40)
const BOOK_SHA = '4'.repeat(40)
const UNKNOWN_SHA = '5'.repeat(40)

/**
 * fake git — `runVerifyRange`가 실제로 내리는 호출만 응답한다. 모르는 호출은 throw(fail-closed:
 * 새 git 의존이 생기면 테스트가 즉시 드러낸다).
 */
function fakeGit(over?: { logOut?: string; lsTreeOut?: string; manifest?: string; checkIgnoreOk?: boolean }): GitAdapter {
  const logOut =
    over?.logOut ??
    [
      `${SRC_SHA}\x1f${BASE_SHA}\x1ffeat: approved work\n본문\x00\n`,
      `${BOOK_SHA}\x1f${BASE_SHA}\x1fchore(REQ-x): ledger\n\n${BOOKKEEPING_TRAILER}\x00\n`,
      `${UNKNOWN_SHA}\x1f${BASE_SHA}\x1fchore: commitgate setup\x00\n`,
    ].join('')
  const lsTreeOut = over?.lsTreeOut ?? 'workflow/REQ-2026-001/responses/approvals.jsonl'
  const manifest = over?.manifest ?? `${JSON.stringify({ kind: 'phase', consumed_by_commit_sha: SRC_SHA })}\n`
  return {
    exec(args: string[]): string {
      const cmd = args[0]
      if (cmd === 'rev-parse') return args[2]?.startsWith('HEAD') ? `${HEAD_SHA}\n` : `${args[2]?.replace(/\^\{commit\}$/, '')}\n`
      if (cmd === 'merge-base') return `${BASE_SHA}\n`
      if (cmd === 'log') return logOut
      if (cmd === 'ls-tree') return `${lsTreeOut}\n`
      if (cmd === 'show') return manifest
      if (cmd === 'check-ignore') {
        if (over?.checkIgnoreOk === false) throw new Error('not ignored')
        return ''
      }
      throw new Error(`fakeGit: 예상 밖 호출 ${args.join(' ')}`)
    },
  }
}

/** 호출 횟수를 세는 fake CI 포트. */
function fakeCi(ok = true): GithubCiPort & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    check(sha: string) {
      calls.push(sha)
      return ok ? { ok: true, detail: 'green' } : { ok: false, detail: 'red' }
    },
  }
}

function makeDeps(over?: Partial<RunDeps> & { ci?: GithubCiPort & { calls: string[] } }): RunDeps & {
  ci: GithubCiPort & { calls: string[] }
  logs: string[]
  rows: VerifyRunRow[]
  asked: string[]
} {
  const logs: string[] = []
  const rows: VerifyRunRow[] = []
  const asked: string[] = []
  const ci = over?.ci ?? fakeCi()
  return {
    git: over?.git ?? fakeGit(),
    ci,
    ask: over?.ask ?? (async (q) => (asked.push(q), '')),
    interactive: over?.interactive ?? false,
    appendLog: over?.appendLog ?? ((row) => rows.push(row)),
    log: (l) => logs.push(l),
    now: () => '2026-08-09T00:00:00.000Z',
    trunkBranch: over?.trunkBranch === undefined ? TRUNK : over.trunkBranch,
    ticketRoot: 'workflow',
    logs,
    rows,
    asked,
  }
}

function opts(over?: Partial<Opts>): Opts {
  return { dir: '.', json: false, strict: false, base: null, head: null, githubCi: null, ...over }
}

describe('완료 기준 1~6·9 — CI opt-in 기본값과 플래그', () => {
  it('1: 대화형·Enter → CI 미호출, 로컬 검증은 수행(생략은 정상 표기)', async () => {
    const deps = makeDeps({ interactive: true, ask: async () => '' })
    const r = await runVerifyRange(opts(), deps)
    expect(deps.ci.calls).toHaveLength(0)
    expect(r.ci).toBe('skipped-default')
    expect(r.report.entries).toHaveLength(3) // 로컬 검증은 항상 수행됐다
    expect(r.exit).toBe(0)
    expect(deps.logs.some((l) => l.includes('생략(정상'))).toBe(true)
  })

  it('2: 대화형 n → 미호출(명시 생략으로 기록)', async () => {
    const deps = makeDeps({ interactive: true, ask: async () => 'n' })
    const r = await runVerifyRange(opts(), deps)
    expect(deps.ci.calls).toHaveLength(0)
    expect(r.ci).toBe('skipped-explicit')
  })

  it('3: 대화형 y → 어댑터 정확히 1회 호출(질문 문구는 정책 고정 문구)', async () => {
    const asked: string[] = []
    const deps = makeDeps({
      interactive: true,
      ask: async (q) => {
        asked.push(q)
        return 'y'
      },
    })
    const r = await runVerifyRange(opts(), deps)
    expect(deps.ci.calls).toEqual([HEAD_SHA])
    expect(r.ci).toBe('checked-ok')
    expect(asked[0]).toBe(CI_PROMPT)
    expect(CI_PROMPT).toContain('[y/N]')
    expect(CI_PROMPT).toContain('비용 또는 사용량')
  })

  it('4: 비대화형·옵션 없음 → 미호출·질문도 없음(기본 생략)', async () => {
    const deps = makeDeps({ interactive: false })
    const r = await runVerifyRange(opts(), deps)
    expect(deps.ci.calls).toHaveLength(0)
    expect(deps.asked).toHaveLength(0)
    expect(r.ci).toBe('skipped-default')
  })

  it('5: --github-ci → 호출(비대화형이어도 — 명시 opt-in)', async () => {
    const deps = makeDeps({ interactive: false })
    const r = await runVerifyRange(opts({ githubCi: true }), deps)
    expect(deps.ci.calls).toHaveLength(1)
    expect(r.ci).toBe('checked-ok')
  })

  it('6: --no-github-ci → 미호출·질문 없음(대화형이어도)', async () => {
    const deps = makeDeps({ interactive: true })
    const r = await runVerifyRange(opts({ githubCi: false }), deps)
    expect(deps.ci.calls).toHaveLength(0)
    expect(deps.asked).toHaveLength(0)
    expect(r.ci).toBe('skipped-explicit')
  })

  it('9: 생략 경로는 fake git 외 어떤 포트도 건드리지 않는다 — gh·인증 없는 환경과 동형', async () => {
    // ci.check가 호출되면 위 4·6이 실패한다. 이 테스트는 그 불변식의 의미를 문서화한다:
    // 기본 경로에서 GithubCiPort는 **생성만 되고 사용되지 않으므로** gh 부재는 영향이 없다.
    const deps = makeDeps({ interactive: false })
    await runVerifyRange(opts(), deps)
    expect(deps.ci.calls).toHaveLength(0)
  })
})

describe('완료 기준 7·8 — 요청 실패·로컬 검증 불변', () => {
  it('7: --github-ci인데 확인 실패 → exit 1 + 실패 문구(조용히 무시하지 않는다)', async () => {
    const deps = makeDeps({ ci: fakeCi(false) })
    const r = await runVerifyRange(opts({ githubCi: true }), deps)
    expect(r.ci).toBe('checked-fail')
    expect(r.exit).toBe(1)
    expect(deps.logs.some((l) => l.includes('확인 실패'))).toBe(true)
  })

  it('8: CI 생략 실행도 4범주 분류·미입증 목록을 산출한다', async () => {
    const deps = makeDeps()
    const r = await runVerifyRange(opts(), deps)
    expect(r.report.counts).toEqual({ merge: 0, bookkeeping: 1, approved: 1, unproven: 1 })
    expect(r.report.unproven).toEqual([{ sha: UNKNOWN_SHA, subject: 'chore: commitgate setup' }])
  })
})

describe('exit·감사 로그 계약(설계 DEC-1·DEC-5)', () => {
  it('미입증>0이어도 기본 exit 0, --strict면 exit 1', async () => {
    expect((await runVerifyRange(opts(), makeDeps())).exit).toBe(0)
    expect((await runVerifyRange(opts({ strict: true }), makeDeps())).exit).toBe(1)
  })

  it('감사 로그 1행: SHA·개수·CI 선택만 담긴다(커밋 메시지 없음)', async () => {
    const deps = makeDeps()
    await runVerifyRange(opts(), deps)
    expect(deps.rows).toHaveLength(1)
    const row = deps.rows[0]
    expect(row).toEqual({
      at: '2026-08-09T00:00:00.000Z',
      base: BASE_SHA,
      head: HEAD_SHA,
      counts: { merge: 0, bookkeeping: 1, approved: 1, unproven: 1 },
      manifest_problems: 0,
      strict: false,
      ci: 'skipped-default',
      exit: 0,
    })
    expect(JSON.stringify(row)).not.toContain('commitgate setup') // 메시지 본문 미기록
  })

  it('로그 쓰기 실패는 경고만 — 판정·exit 불변(관측이 게이트를 바꾸면 안 된다)', async () => {
    const deps = makeDeps({
      appendLog: () => {
        throw new Error('disk full')
      },
    })
    const r = await runVerifyRange(opts(), deps)
    expect(r.exit).toBe(0)
    expect(deps.logs.some((l) => l.includes('감사 로그 기록 실패'))).toBe(true)
  })

  it('trunkBranch=null이고 --base 없음 → 사용 오류', async () => {
    await expect(runVerifyRange(opts(), makeDeps({ trunkBranch: null }))).rejects.toThrow('--base')
  })
})

describe('parseArgs — fail-closed', () => {
  it('--github-ci 와 --no-github-ci 동시 지정은 오류(순서 무관)', () => {
    expect(() => parseArgs(['--github-ci', '--no-github-ci'])).toThrow()
    expect(() => parseArgs(['--no-github-ci', '--github-ci'])).toThrow()
  })
  it('값 자리에 온 옵션을 값으로 삼키지 않는다', () => {
    expect(() => parseArgs(['--base', '--json'])).toThrow()
  })
  it('알 수 없는 옵션은 오류, --help는 HelpRequested', () => {
    expect(() => parseArgs(['--nope'])).toThrow('알 수 없는 옵션')
    expect(() => parseArgs(['-h'])).toThrow(HelpRequested)
  })
})

describe('decideCiMode / ciModeFromAnswer (설계 DEC-4)', () => {
  it('플래그 > 질문 > 기본 생략 · --json은 질문하지 않는다', () => {
    expect(decideCiMode({ githubCi: true, json: false }, true)).toBe('check')
    expect(decideCiMode({ githubCi: false, json: false }, true)).toBe('skip-explicit')
    expect(decideCiMode({ githubCi: null, json: true }, true)).toBe('skip-default')
    expect(decideCiMode({ githubCi: null, json: false }, false)).toBe('skip-default')
    expect(decideCiMode({ githubCi: null, json: false }, true)).toBe('ask')
  })
  it('y/Y만 실행 — 그 외 전부 생략(기본 No)', () => {
    expect(ciModeFromAnswer('y')).toBe('check')
    expect(ciModeFromAnswer(' Y ')).toBe('check')
    expect(ciModeFromAnswer('n')).toBe('skip-explicit')
    expect(ciModeFromAnswer('')).toBe('skip-default')
    expect(ciModeFromAnswer('yes?')).toBe('skip-default')
  })
})

describe('judgeCheckRunsPayload — 부분 결과를 성공으로 판정하지 않는다(설계 리뷰 r01 P1)', () => {
  const run = (conclusion: string, status = 'completed', name = 'ci') => ({ name, status, conclusion })

  it('수신 전부 success인데 total_count가 더 크면 fail', () => {
    const payload = { total_count: 31, check_runs: Array.from({ length: 30 }, () => run('success')) }
    const r = judgeCheckRunsPayload(payload)
    expect(r.ok).toBe(false)
    expect(r.detail).toContain('부분 결과')
  })
  it('check-run 0건 → fail(push 전이거나 CI 미구성)', () => {
    expect(judgeCheckRunsPayload({ total_count: 0, check_runs: [] }).ok).toBe(false)
  })
  it('전부 completed+success/neutral/skipped → ok', () => {
    const payload = { total_count: 3, check_runs: [run('success'), run('neutral'), run('skipped')] }
    expect(judgeCheckRunsPayload(payload).ok).toBe(true)
  })
  it('failure·미완료가 하나라도 있으면 fail', () => {
    expect(judgeCheckRunsPayload({ total_count: 2, check_runs: [run('success'), run('failure')] }).ok).toBe(false)
    expect(judgeCheckRunsPayload({ total_count: 1, check_runs: [run('success', 'in_progress')] }).ok).toBe(false)
  })
  it('형식이 다르면 fail(확인 불가를 성공으로 눙치지 않는다)', () => {
    expect(judgeCheckRunsPayload(null).ok).toBe(false)
    expect(judgeCheckRunsPayload({ check_runs: [] }).ok).toBe(false)
  })
})

describe('createGhCiAdapter — spawn 주입(완료 기준 10: 실 gh 무호출)', () => {
  it('gh 호출 실패(미설치 등) → fail에 사유 포함', () => {
    const adapter = createGhCiAdapter('.', () => {
      throw new Error('spawn gh ENOENT')
    })
    const r = adapter.check(HEAD_SHA)
    expect(r.ok).toBe(false)
    expect(r.detail).toContain('ENOENT')
  })
  it('정상 응답이면 판정으로 위임하고, per_page=100 단일 조회다(폴링 없음)', () => {
    const calls: string[][] = []
    const adapter = createGhCiAdapter('.', ((file: string, args: readonly string[]) => {
      calls.push([file, ...args])
      return JSON.stringify({ total_count: 1, check_runs: [{ name: 'ci', status: 'completed', conclusion: 'success' }] })
    }) as never)
    expect(adapter.check(HEAD_SHA).ok).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0]![0]).toBe('gh')
    expect(calls[0]!.join(' ')).toContain('per_page=100')
  })
  it('JSON 파싱 불가 응답 → fail', () => {
    const adapter = createGhCiAdapter('.', (() => 'not-json') as never)
    expect(adapter.check(HEAD_SHA).ok).toBe(false)
  })
})

describe('collectCommits — %x00 레코드 파싱', () => {
  it('SHA·부모 수·subject·message를 복원한다(root 커밋 parents="" 포함)', () => {
    const git = fakeGit({
      logOut: `${SRC_SHA}\x1f${BASE_SHA} ${UNKNOWN_SHA}\x1fMerge branch\x00\n${BOOK_SHA}\x1f\x1froot commit\n\n본문\x00\n`,
    })
    const commits = collectCommits(git, BASE_SHA, HEAD_SHA)
    expect(commits).toHaveLength(2)
    expect(commits[0]).toMatchObject({ sha: SRC_SHA, parentCount: 2, subject: 'Merge branch' })
    expect(commits[1]).toMatchObject({ sha: BOOK_SHA, parentCount: 0, subject: 'root commit' })
    expect(commits[1]!.message).toContain('본문')
  })
})
