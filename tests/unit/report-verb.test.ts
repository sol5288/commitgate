/**
 * `commitgate report` verb(REQ-2026-124 phase-2) — 부재 repo·json 파생·인자 fail-closed.
 */
import { describe, it, expect, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs, HelpRequested, collectReport, renderHuman, renderJson, runCli } from '../../bin/report'

/** 최소 hermetic repo(로그 없음 — 부재 경계). */
const emptyRepo = (): string => {
  const repo = mkdtempSync(join(tmpdir(), 'cg-report-'))
  const git = (args: string[]): string =>
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: repo, encoding: 'utf8' })
  git(['init', '-q'])
  git(['config', 'user.email', 't@t.t'])
  git(['config', 'user.name', 't'])
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'x', version: '0.0.0' }))
  git(['add', '-A'])
  git(['commit', '-qm', 'init'])
  return repo
}

describe('[REQ-2026-124] report verb', () => {
  it('parseArgs — fail-closed(값 자리 옵션·미지 옵션·help)', () => {
    expect(() => parseArgs(['--dir'])).toThrow('--dir')
    expect(() => parseArgs(['--nope'])).toThrow('알 수 없는 옵션')
    expect(() => parseArgs(['-h'])).toThrow(HelpRequested)
    expect(parseArgs(['--json']).json).toBe(true)
  })

  it('로그가 하나도 없는 repo → 전 섹션 부재·runCli exit 0(완료 기준 2)', () => {
    const repo = emptyRepo()
    try {
      const r = collectReport(repo)
      expect(r.doctor).toBeUndefined()
      expect(r.review).toBeUndefined()
      expect(r.ci).toBeUndefined()
      // evidence는 trunk(main) 존재 + 커밋 0범위라 counts 전부 0으로 나올 수 있다 — 부재 표기는 로그 축만 본다.
      expect(renderHuman(r)).toContain('데이터 없음')
      const codes: (number | undefined)[] = []
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((c?: number) => void codes.push(c)) as never)
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      try {
        runCli(['--dir', repo])
        expect(process.exitCode ?? 0).toBe(0)
      } finally {
        exitSpy.mockRestore()
        logSpy.mockRestore()
        process.exitCode = 0
      }
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  it('--json과 사람용 출력이 같은 Report에서 파생된다(완료 기준 3)', () => {
    const repo = emptyRepo()
    try {
      mkdirSync(join(repo, 'workflow'), { recursive: true })
      writeFileSync(
        join(repo, 'workflow', '.verify-runs.jsonl'),
        JSON.stringify({ at: 't', base: 'b', head: 'h', counts: { merge: 0, bookkeeping: 0, approved: 0, unproven: 0 }, manifest_problems: 0, strict: false, ci: 'skipped-default', exit: 0 }) + '\n',
      )
      const r = collectReport(repo)
      const parsed = JSON.parse(renderJson(r)) as typeof r
      expect(parsed.ci).toEqual(r.ci) // 같은 객체의 직렬화
      expect(renderHuman(r)).toContain('skipped-default 1') // 사람용도 같은 값
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })
})
