import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { parseArgs, runAttest, HelpRequested, type RunDeps } from '../../bin/attest'
import { resolveDispatch } from '../../bin/dispatch.mjs'
import { parseAttestations } from '../../scripts/req/lib/attestations'
import { BOOKKEEPING_TRAILER } from '../../scripts/req/lib/bookkeeping'
import type { GitAdapter } from '../../scripts/req/lib/adapters'

/** REQ-2026-127 phase-2 — attest verb(실 git — 완료 기준 4). */

function mkRepo(): { dir: string; g: (...args: string[]) => string } {
  const dir = mkdtempSync(join(tmpdir(), 'cg-attest-'))
  const g = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
  g('init', '-b', 'main')
  g('config', 'user.email', 'attester@example.com')
  g('config', 'user.name', 'Attester')
  writeFileSync(join(dir, 'a.txt'), 'base\n')
  g('add', '.')
  g('commit', '-m', 'base')
  return { dir, g }
}

function deps(dir: string): RunDeps & { logs: string[] } {
  const logs: string[] = []
  const adapter: GitAdapter = { exec: (args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }) }
  return {
    git: adapter,
    log: (l) => logs.push(l),
    now: () => '2026-08-10T12:00:00.000Z',
    rootAbs: dir,
    ticketRoot: 'workflow',
    logs,
  }
}

describe('parseArgs·dispatch', () => {
  it('sha 위치 인자 + --reason·--run·오류', () => {
    expect(parseArgs(['abc1234', '--reason', 'release'])).toMatchObject({ sha: 'abc1234', reason: 'release', run: false })
    expect(() => parseArgs(['a', 'b'])).toThrow('하나만')
    expect(() => parseArgs(['--reason'])).toThrow()
    expect(() => parseArgs(['-h'])).toThrow(HelpRequested)
  })
  it('dispatch 배선', () => {
    expect(resolveDispatch(['attest', 'abc', '--run'])).toMatchObject({ entry: 'attest.ts', rest: ['abc', '--run'] })
  })
})

describe('runAttest — 실 git', () => {
  it('dry-run: 아무것도 쓰지 않고 행 미리보기만', () => {
    const { dir, g } = mkRepo()
    const d = deps(dir)
    const sha = g('rev-parse', 'HEAD').trim()
    const exit = runAttest({ dir, run: false, sha, reason: 'release 커밋' }, d)
    expect(exit).toBe(0)
    expect(existsSync(join(dir, 'workflow', 'attestations.jsonl'))).toBe(false)
    expect(g('rev-list', '--count', 'HEAD').trim()).toBe('1') // 커밋 없음
    expect(d.logs.some((l) => l.includes('DRY-RUN'))).toBe(true)
  })

  it('--run: 풀 OID·tree·identity 행 append + 그 파일만 담은 부기 커밋(trailer)', () => {
    const { dir, g } = mkRepo()
    const d = deps(dir)
    const shortSha = g('rev-parse', '--short', 'HEAD').trim()
    const fullSha = g('rev-parse', 'HEAD').trim()
    const tree = g('rev-parse', 'HEAD^{tree}').trim()

    const exit = runAttest({ dir, run: true, sha: shortSha, reason: '수동 충돌 정정' }, d)
    expect(exit).toBe(0)

    const { rows, problems } = parseAttestations(readFileSync(join(dir, 'workflow', 'attestations.jsonl'), 'utf8'))
    expect(problems).toBe(0)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ schema_version: 1, sha: fullSha, tree, reason: '수동 충돌 정정', attested_by: 'Attester <attester@example.com>' })

    // 부기 커밋: trailer 포함·attestations.jsonl 한 파일만.
    const msg = g('log', '-1', '--format=%B')
    expect(msg).toContain(BOOKKEEPING_TRAILER)
    const files = g('show', '--name-only', '--format=', 'HEAD').trim().split('\n')
    expect(files).toEqual(['workflow/attestations.jsonl'])
  })

  it('대상 sha 부재·reason 부재 → 실패(기록 없음)', () => {
    const { dir, g } = mkRepo()
    const d = deps(dir)
    expect(() => runAttest({ dir, run: true, sha: 'deadbeef', reason: 'x' }, d)).toThrow('찾을 수 없습니다')
    expect(() => runAttest({ dir, run: true, sha: g('rev-parse', 'HEAD').trim(), reason: null }, d)).toThrow('--reason')
    expect(() => runAttest({ dir, run: true, sha: g('rev-parse', 'HEAD').trim(), reason: '  ' }, d)).toThrow('--reason')
    expect(existsSync(join(dir, 'workflow', 'attestations.jsonl'))).toBe(false)
  })

  it('다른 staged 변경이 있으면 거부(예외 기록에 코드 혼입 방지)', () => {
    const { dir, g } = mkRepo()
    const d = deps(dir)
    writeFileSync(join(dir, 'b.txt'), 'code\n')
    g('add', 'b.txt')
    expect(() => runAttest({ dir, run: true, sha: g('rev-parse', 'HEAD~0').trim(), reason: 'x' }, d)).toThrow('먼저 커밋')
  })

  it('중복 attest는 append(감사 보존 — 행 2개)', () => {
    const { dir, g } = mkRepo()
    const d = deps(dir)
    const sha = g('rev-parse', 'HEAD').trim()
    runAttest({ dir, run: true, sha, reason: '1차' }, d)
    runAttest({ dir, run: true, sha, reason: '2차(정정)' }, d)
    const { rows } = parseAttestations(readFileSync(join(dir, 'workflow', 'attestations.jsonl'), 'utf8'))
    expect(rows).toHaveLength(2)
  })
})
