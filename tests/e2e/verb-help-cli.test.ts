import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { VERB_MODULES } from '../../bin/dispatch.mjs'
import { REQ_VERB_HELP } from '../../scripts/req/lib/verb-help'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const BIN = join(REPO_ROOT, 'bin', 'commitgate.mjs')
const REQ_VERBS: string[] = Object.keys(VERB_MODULES).filter((v) => v.startsWith('req:'))

/**
 * REQ-2026-166 DEC-2 — **G2, 실제 진입점 e2e**.
 *
 * 🔴 **왜 spawn 인가**: 이 REQ 를 낳은 자체 감사는 `node bin/dispatch.mjs` 로 verb 를 호출했다. 그것은
 *    디스패치 **순수 로직 모듈**이라 아무것도 실행하지 않고 조용히 exit 0 을 낸다 — 그래서 "11개가
 *    거부한다"를 "3개"로 잘못 읽었다. 진입점이 아닌 것을 돌리면 결론이 뒤집힌다.
 *
 * 🔴 소스 가드로는 exit code 를 증명할 수 없다. `helpGate` 호출이 있어도 그 앞의 게이트가 먼저 죽으면
 *    사용자에게는 여전히 오류다 — 그 순서를 보는 것은 실행뿐이다.
 *
 * 🔴 **CommitGate 설치가 아닌 임시 디렉터리에서 돌린다.** 거기서라면 정상 실행 경로는 setup 게이트에
 *    막힌다 — 그런데도 exit 0 이 나온다는 것은 사용법이 **모든 게이트보다 앞**이라는 뜻이다.
 */
describe('[verb-help] G2 — 실제 CLI 가 사용법을 낸다', () => {
  const runHelp = (verb: string, flag: string, cwd: string) =>
    spawnSync(process.execPath, [BIN, verb, flag], { encoding: 'utf8', cwd, timeout: 120_000 })

  let dir = ''
  const withTemp = <T>(f: (d: string) => T): T => {
    dir = mkdtempSync(join(tmpdir(), 'cg166-help-'))
    try {
      return f(dir)
    } finally {
      rmSync(dir, { recursive: true, force: true })
      dir = ''
    }
  }

  it('🔴 오라클이 공허하지 않다 — 검사 대상 verb 가 실재한다', () => {
    expect(REQ_VERBS.length).toBeGreaterThan(10)
  })

  it.each(REQ_VERBS)('%s — --help 와 -h 가 exit 0 + 사용법', { timeout: 180_000 }, (verb) => {
    withTemp((cwd) => {
      for (const flag of ['--help', '-h']) {
        const r = runHelp(verb, flag, cwd)
        const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
        expect(r.status, `${verb} ${flag} → ${out}`).toBe(0)
        expect(out, `${verb} ${flag}`).toContain(verb)
        expect(out, `${verb} ${flag}`).toContain('사용법:')
        // 🔴 게이트 오류가 섞이면 "사용법이 가장 앞"이라는 계약이 깨진 것이다.
        expect(out, `${verb} ${flag}`).not.toContain('알 수 없는 옵션')
        for (const o of REQ_VERB_HELP[verb]!.options) expect(out, `${verb} ${o.flag}`).toContain(o.flag)
      }
    })
  })

  it('🔴 앵커: 사용법이 아닌 알 수 없는 옵션은 여전히 거부된다(전부 exit 0 이 된 것이 아니다)', () => {
    withTemp((cwd) => {
      const r = runHelp('req:new', '--__상존하지_않는_플래그__', cwd)
      const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
      expect(r.status, out).not.toBe(0)
      expect(out).toContain('알 수 없는 옵션')
    })
  })
})
