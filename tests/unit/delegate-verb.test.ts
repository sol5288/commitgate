import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import {
  DEFAULT_TTL_HOURS,
  MAX_TTL_HOURS,
  expiryOf,
  issueProblem,
  revokeProblem,
  normalizeReqId,
  parseArgs,
  parseScopeArg,
  runDelegate,
  type Opts,
  type RunDeps,
} from '../../scripts/req/req-delegate'
import { resolveDispatch, VERB_MODULES } from '../../bin/dispatch.mjs'
import { STAGE_B_REQ_VERBS, STAGE_B_REQ_SCRIPTS } from '../../bin/init'
import { DELEGATION_LEDGER_REL, parseDelegationLedger, type DelegationIssued } from '../../scripts/req/lib/delegation'
import { BOOKKEEPING_TRAILER } from '../../scripts/req/lib/bookkeeping'
import type { GitAdapter } from '../../scripts/req/lib/adapters'

/**
 * REQ-2026-140 phase-3 — `req:delegate`(실 git).
 *
 * 🔴 **이 verb 가 만드는 것은 권한**이다. 그래서 오라클은 "명령이 성공했는가"가 아니라
 *    **원장에 무엇이 적혔는가**다 — 특히 세 권한 플래그가 정확히 반영되는지.
 */

function mkRepo(): { dir: string; g: (...args: string[]) => string } {
  const dir = mkdtempSync(join(tmpdir(), 'cg-delegate-'))
  const g = (...args: string[]): string => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
  g('init', '-b', 'main')
  g('config', 'user.email', 'd@example.com')
  g('config', 'user.name', 'Delegator')
  writeFileSync(join(dir, 'a.txt'), 'base\n')
  g('add', '.')
  g('commit', '-m', 'base')
  g('checkout', '-b', 'feat/x')
  writeFileSync(join(dir, 'b.txt'), 'work\n')
  g('add', '.')
  g('commit', '-m', 'work')
  return { dir, g }
}

function deps(dir: string, over: Partial<RunDeps> = {}): RunDeps & { logs: string[] } {
  const logs: string[] = []
  const git: GitAdapter = { exec: (args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }) }
  return {
    rootAbs: dir,
    ticketRoot: 'workflow',
    trunkBranch: 'main',
    git,
    now: () => '2026-08-13T00:00:00.000Z',
    newId: () => 'ID-0001',
    log: (l) => logs.push(l),
    logs,
    ...over,
  }
}

const OPTS = (over: Partial<Opts> = {}): Opts => ({
  mode: 'issue',
  scope: { kind: 'ticket', req_id: 'REQ-2026-140' },
  source: 'feat/x',
  sentence: '통합을 사전 위임합니다',
  allowPush: false,
  allowBypass: false,
  allowAttested: false,
  highRisk: false,
  ttlHours: DEFAULT_TTL_HOURS,
  revokeId: null,
  reason: null,
  root: null,
  run: true,
  ...over,
})

const readRows = (dir: string): DelegationIssued[] => {
  const p = parseDelegationLedger(readFileSync(join(dir, DELEGATION_LEDGER_REL), 'utf8'))
  expect(p.problems).toEqual([])
  return p.rows.filter((r): r is DelegationIssued => r.kind === 'issued')
}

describe('[REQ-2026-140] parseArgs — fail-closed', () => {
  it('scope 는 접두를 요구한다(추측하지 않는다)', () => {
    expect(parseScopeArg('ticket:2026-140')).toEqual({ kind: 'ticket', req_id: 'REQ-2026-140' })
    expect(parseScopeArg('delivery:0.23.0')).toEqual({ kind: 'delivery', slug: '0.23.0' })
    expect(() => parseScopeArg('2026-140')).toThrow('--scope')
    expect(() => parseScopeArg('ticket:')).toThrow('--scope')
  })

  it('REQ 접두는 있어도 없어도 같은 정규형이 된다', () => {
    expect(normalizeReqId('2026-140')).toBe('REQ-2026-140')
    expect(normalizeReqId('REQ-2026-140')).toBe('REQ-2026-140')
  })

  /** 🔴 자유 텍스트 자리가 플래그를 삼키면 사용자가 요청하지 않은 조합이 성립한다(REQ-2026-129 교훈). */
  it('🔴 --sentence·--reason 값 자리의 알려진 옵션은 값이 아니라 누락이다', () => {
    for (const flag of ['--sentence', '--reason', '--scope', '--source']) {
      expect(() => parseArgs([flag, '--run']), `${flag} --run`).toThrow('옵션')
    }
    // 대조군: 알려지지 않은 대시 문자열은 값이다(승인 문장은 `-`로 시작할 수 있다).
    expect(parseArgs(['--sentence', '-승인합니다']).sentence).toBe('-승인합니다')
  })

  it('세 권한 플래그가 독립으로 읽힌다', () => {
    expect(parseArgs([])).toMatchObject({ allowPush: false, allowBypass: false, highRisk: false })
    expect(parseArgs(['--allow-push'])).toMatchObject({ allowPush: true, allowBypass: false })
    expect(parseArgs(['--allow-bypass'])).toMatchObject({ allowPush: false, allowBypass: true })
    expect(parseArgs(['--high-risk'])).toMatchObject({ highRisk: true })
  })

  it(`🔴 --ttl-hours 는 1~${MAX_TTL_HOURS} 정수만(무기한 위임 금지)`, () => {
    expect(parseArgs(['--ttl-hours', '1']).ttlHours).toBe(1)
    expect(parseArgs([]).ttlHours).toBe(DEFAULT_TTL_HOURS)
    for (const bad of ['0', '-1', '1.5', 'x', String(MAX_TTL_HOURS + 1)])
      expect(() => parseArgs(['--ttl-hours', bad]), bad).toThrow('--ttl-hours')
  })

  it('모드는 하나다', () => {
    expect(parseArgs(['--status']).mode).toBe('status')
    expect(parseArgs(['--revoke', 'X']).mode).toBe('revoke')
    expect(parseArgs([]).mode).toBe('issue')
    expect(() => parseArgs(['--status', '--revoke', 'X'])).toThrow('함께')
  })

  it('알 수 없는 인자는 조용히 무시하지 않는다', () => {
    expect(() => parseArgs(['--force'])).toThrow('알 수 없는 인자')
  })
})

describe('[REQ-2026-140] issueProblem — 근거 없는 위임은 발급하지 않는다', () => {
  it('scope·source·sentence 가 전부 필요하다', () => {
    expect(issueProblem(OPTS())).toBeNull()
    expect(issueProblem(OPTS({ scope: null }))).toContain('--scope')
    expect(issueProblem(OPTS({ source: null }))).toContain('--source')
    expect(issueProblem(OPTS({ sentence: null }))).toContain('--sentence')
  })

  /** 🔴 공백만 있는 문장은 근거가 아니다. */
  it('🔴 빈 문장·공백 문장은 거부한다', () => {
    expect(issueProblem(OPTS({ sentence: '' }))).toContain('--sentence')
    expect(issueProblem(OPTS({ sentence: '   ' }))).toContain('--sentence')
  })
})

/**
 * 🔴 phase-3 리뷰 r01 P1 — **철회에도 사유가 필수다.** help 는 `--reason "<사유>"` 를 필수로 적고
 *    있었는데 코드는 없어도 통과시켜, 원장에 **누가 왜 권한을 거둬들였는지 알 수 없는 행**이 남았다.
 *    발급에만 근거를 요구하고 철회는 비워 두면 감사가 반쪽이다.
 */
describe('[REQ-2026-140] revokeProblem — 근거 없는 철회는 기록하지 않는다', () => {
  it('id 와 사유가 모두 필요하다', () => {
    expect(revokeProblem(OPTS({ mode: 'revoke', revokeId: 'ID-0001', reason: '기준선 변경' }))).toBeNull()
    expect(revokeProblem(OPTS({ mode: 'revoke', revokeId: null, reason: 'r' }))).toContain('--revoke')
  })

  it('🔴 사유 부재·공백은 거부한다', () => {
    for (const reason of [null, '', '   ']) {
      expect(revokeProblem(OPTS({ mode: 'revoke', revokeId: 'ID-0001', reason })), String(reason)).toContain('--reason')
    }
  })

  it('🔴 실행 경로에서도 막힌다(원장에 빈 사유 행이 남지 않는다)', () => {
    const { dir } = mkRepo()
    runDelegate(OPTS(), deps(dir))
    const before = readFileSync(join(dir, DELEGATION_LEDGER_REL), 'utf8')
    expect(() => runDelegate(OPTS({ mode: 'revoke', revokeId: 'ID-0001', reason: null }), deps(dir))).toThrow('--reason')
    expect(readFileSync(join(dir, DELEGATION_LEDGER_REL), 'utf8')).toBe(before)
  })
})

describe('[REQ-2026-140] 발급 — 실 git', () => {
  it('DRY-RUN 은 원장을 만들지 않는다', () => {
    const { dir } = mkRepo()
    const d = deps(dir)
    runDelegate(OPTS({ run: false }), d)
    expect(existsSync(join(dir, DELEGATION_LEDGER_REL))).toBe(false)
    expect(d.logs.join('\n')).toContain('DRY-RUN')
  })

  /** 🔴 DEC-5a — 플래그 없이 발급하면 local_merge 만 참이다. */
  it('🔴 기본 발급은 local_merge=true · push/bypass=false', () => {
    const { dir } = mkRepo()
    runDelegate(OPTS(), deps(dir))
    const [row] = readRows(dir)
    expect(row?.permissions).toEqual({ local_merge: true, origin_push: false, bypass_protection: false })
    expect(row?.high_risk_ack).toBe(false)
  })

  it('🔴 권한 플래그가 정확히 그 축만 켠다', () => {
    const { dir } = mkRepo()
    runDelegate(OPTS({ allowPush: true }), deps(dir))
    expect(readRows(dir)[0]?.permissions).toEqual({ local_merge: true, origin_push: true, bypass_protection: false })

    const { dir: dir2 } = mkRepo()
    runDelegate(OPTS({ allowBypass: true, highRisk: true }), deps(dir2))
    const r2 = readRows(dir2)[0]
    expect(r2?.permissions).toEqual({ local_merge: true, origin_push: false, bypass_protection: true })
    expect(r2?.high_risk_ack).toBe(true)
  })

  /** 🔴 시각·SHA·만료는 **도구가 읽는다** — 사람이 적을 자리가 없다(REQ-2026-019). */
  it('🔴 두 SHA 를 실제 ref 에서 읽고 만료를 계산한다', () => {
    const { dir, g } = mkRepo()
    /**
     * 🔴 **발급 커밋이 소스 브랜치 tip 을 움직인다.** 그래서 기대값은 실행 **전** SHA 다.
     *    phase-4 는 이 부기 커밋이 병합 범위에 들어온다는 사실을 다뤄야 한다 — 귀속(DEC-4a) 대상이 된다.
     */
    const trunkBefore = g('rev-parse', 'main^{commit}').trim()
    const sourceBefore = g('rev-parse', 'feat/x^{commit}').trim()
    runDelegate(OPTS({ ttlHours: 3 }), deps(dir))
    const row = readRows(dir)[0] as DelegationIssued
    expect(row.trunk_sha).toBe(trunkBefore)
    expect(row.base_sha).toBe(sourceBefore)
    expect(g('rev-parse', 'feat/x^{commit}').trim()).not.toBe(sourceBefore) // 실제로 움직였다
    expect(row.trunk_branch).toBe('main')
    expect(row.source_branch).toBe('feat/x')
    expect(row.at).toBe('2026-08-13T00:00:00.000Z')
    expect(row.expires_at).toBe('2026-08-13T03:00:00.000Z')
  })

  it('승인 문장은 그대로 남는다(앞뒤 공백만 정리)', () => {
    const { dir } = mkRepo()
    runDelegate(OPTS({ sentence: '  이 REQ 의 통합을 위임합니다  ' }), deps(dir))
    expect(readRows(dir)[0]?.approval_sentence).toBe('이 REQ 의 통합을 위임합니다')
  })

  it('원장을 부기 커밋한다(워킹트리가 clean 하게 남는다)', () => {
    const { dir, g } = mkRepo()
    runDelegate(OPTS(), deps(dir))
    expect(g('status', '--porcelain').trim()).toBe('')
    expect(g('log', '-1', '--pretty=%B')).toContain(BOOKKEEPING_TRAILER)
    expect(g('log', '-1', '--pretty=%s')).toContain('사전 위임 발급')
  })

  /** 🔴 부기 커밋에 코드가 섞이면 그 커밋이 무엇인지 사후에 알 수 없다. */
  it('🔴 다른 staged 변경이 있으면 거부한다', () => {
    const { dir, g } = mkRepo()
    writeFileSync(join(dir, 'c.txt'), 'x\n')
    g('add', 'c.txt')
    expect(() => runDelegate(OPTS(), deps(dir))).toThrow('c.txt')
  })

  it('trunkBranch 가 없으면 발급하지 않는다', () => {
    const { dir } = mkRepo()
    expect(() => runDelegate(OPTS(), deps(dir, { trunkBranch: null }))).toThrow('trunkBranch')
  })
})

describe('[REQ-2026-140] 철회·조회 왕복', () => {
  it('발급 → status(active) → 철회 → status(revoked)', () => {
    const { dir } = mkRepo()
    runDelegate(OPTS(), deps(dir))

    const s1 = deps(dir)
    runDelegate(OPTS({ mode: 'status', run: false }), s1)
    expect(s1.logs.join('\n')).toContain('[active]')
    expect(s1.logs.join('\n')).toContain('ID-0001')

    runDelegate(OPTS({ mode: 'revoke', revokeId: 'ID-0001', reason: '기준선이 바뀜' }), deps(dir))

    const s2 = deps(dir)
    runDelegate(OPTS({ mode: 'status', run: false }), s2)
    expect(s2.logs.join('\n')).toContain('[revoked ]')
    expect(s2.logs.join('\n')).not.toContain('[active]')
  })

  it('🔴 없는 id·이미 철회된 id 는 거부한다', () => {
    const { dir } = mkRepo()
    expect(() => runDelegate(OPTS({ mode: 'revoke', revokeId: 'NOPE', reason: 'r' }), deps(dir))).toThrow('없는 id')
    runDelegate(OPTS(), deps(dir))
    runDelegate(OPTS({ mode: 'revoke', revokeId: 'ID-0001', reason: 'r' }), deps(dir))
    expect(() => runDelegate(OPTS({ mode: 'revoke', revokeId: 'ID-0001', reason: 'r' }), deps(dir))).toThrow('이미')
  })

  it('원장이 없으면 status 는 조용히 "없음"이다', () => {
    const { dir } = mkRepo()
    const d = deps(dir)
    runDelegate(OPTS({ mode: 'status', run: false }), d)
    expect(d.logs.join('\n')).toContain('없습니다')
  })

  /** 🔴 손상 원장에서 철회를 허용하면 손상 상태로 권한을 조작하게 된다. */
  it('🔴 원장이 손상되면 철회를 거부한다', () => {
    const { dir } = mkRepo()
    mkdirSync(join(dir, 'workflow'), { recursive: true })
    writeFileSync(join(dir, DELEGATION_LEDGER_REL), '{oops\n')
    expect(() => runDelegate(OPTS({ mode: 'revoke', revokeId: 'ID-0001', reason: 'r' }), deps(dir))).toThrow('손상')
  })
})

describe('[REQ-2026-140] expiryOf', () => {
  it('시간 단위로 더한다', () => {
    expect(expiryOf('2026-08-13T00:00:00.000Z', 12)).toBe('2026-08-13T12:00:00.000Z')
  })

  it('🔴 instant 가 아니면 throw(문자열 산술을 하지 않는다)', () => {
    expect(() => expiryOf('now', 1)).toThrow('ISO instant')
  })
})

describe('[REQ-2026-140] verb 등록', () => {
  it('dispatch 가 모듈로 보낸다', () => {
    expect(resolveDispatch(['req:delegate', '--status'])).toEqual({
      entry: VERB_MODULES['req:delegate'],
      rest: ['--status'],
    })
  })

  /** 🔴 파생이 끊기면 소비자 프로젝트에 `npm run req:delegate` 자체가 없다. */
  it('🔴 Stage B 주입 목록에 따라온다', () => {
    expect(STAGE_B_REQ_VERBS).toContain('req:delegate')
    expect(STAGE_B_REQ_SCRIPTS['req:delegate']).toBe('commitgate req:delegate')
  })
})
