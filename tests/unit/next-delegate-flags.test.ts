/**
 * REQ-2026-172 phase-3 — `req:next` 의 위임 안내가 **범위가 요구하는 플래그를 전부** 담는다.
 *
 * 🔴 왜 필요한가: 안내는 `--high-risk` 만 붙였고 `--allow-attested` 는 알려 주지 않았다. 범위에
 *    `attested` 커밋이 있으면 안내대로 실행해도 `req:delegate` 가 거부한다 —
 *    **안내대로 하면 막히는** 상태이고, 이 저장소가 반복해 데인 결함이다.
 *
 * 🔴 그리고 사유는 **하나씩** 나오므로, 하나 알려 주고 재발급하게 하면 왕복이 줄지 않는다.
 *    그래서 오라클은 "플래그가 있는가"가 아니라 **"필요한 것이 전부 있는가"** 다.
 */
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import {
  terminalIntegrationAction,
  delegationAckProvider,
  probeDelegationAcks,
  type NextInput,
  type AckProbe,
  type ProbeConfig,
} from '../../scripts/req/req-next'

const BRANCH = 'feat/req-2026-172-delegate-preflight'

const autoInput = (over: Partial<NextInput> = {}, stateOver: Record<string, unknown> = {}): NextInput =>
  ({
    target: { kind: 'id', id: 'REQ-2026-172' },
    packageManager: 'npm',
    state: {
      id: 'REQ-2026-172',
      branch: BRANCH,
      risk_level: 'LOW',
      phases: [{ id: 'p1', title: 'p1', status: 'approved' }],
      review_series_model_version: 1,
      ...stateOver,
    },
    stopGate: 'auto',
    phaseCommitAutoApprove: 'low-only',
    completesReq: true,
    worktreeReviewClean: true,
    designApproved: true,
    ...over,
  }) as unknown as NextInput

const acks = (attestedAck: boolean, highRiskAck: boolean): AckProbe => ({ kind: 'acks', acks: { attestedAck, highRiskAck } })

const act = (over: Partial<NextInput>, stateOver: Record<string, unknown> = {}) =>
  terminalIntegrationAction(autoInput(over, stateOver))

describe('[REQ-2026-172] auto 종단 위임 안내의 플래그', () => {
  it('공급자가 없으면 옛 동작 그대로(무회귀)', () => {
    const a = act({})
    expect(a.command).toContain('req:delegate')
    expect(a.command).not.toContain('--allow-attested')
  })

  it('범위가 깨끗하면 추가 플래그를 붙이지 않는다', () => {
    const a = act({ requiredDelegationAcks: () => acks(false, false) })
    expect(a.command).not.toContain('--allow-attested')
    expect(a.command).not.toContain('--high-risk')
  })

  it('🔴 attested-only 범위 → 안내가 --allow-attested 를 담는다', () => {
    const a = act({ requiredDelegationAcks: () => acks(true, false) })
    expect(a.command).toContain('--allow-attested')
  })

  /** 🔴 **이 케이스가 phase-3 의 존재 이유다** — 하나씩 알려 주면 왕복이 줄지 않는다. */
  it('🔴 HIGH + attested-only → **두 플래그를 한 번에** 담는다', () => {
    const a = act({ requiredDelegationAcks: () => acks(true, true) }, { risk_level: 'HIGH' })
    expect(a.command).toContain('--allow-attested')
    expect(a.command).toContain('--high-risk')
  })

  it('HIGH 티켓은 공급자가 알려 주지 않아도 --high-risk 를 유지한다(기존 계약)', () => {
    const a = act({ requiredDelegationAcks: () => acks(false, false) }, { risk_level: 'HIGH' })
    expect(a.command).toContain('--high-risk')
  })

  it('🔴 판정 불가면 **추측하지 않고** 그 사실을 말한다', () => {
    const a = act({ requiredDelegationAcks: () => ({ kind: 'unknown', reason: '범위를 읽지 못했다' }) })
    expect(a.command).toContain('req:delegate') // 명령 자체는 낸다(옛 동작)
    expect(a.command).not.toContain('--allow-attested') // 🔴 없는 근거로 플래그를 붙이지 않는다
    expect((a.diagnostics ?? []).join('\n')).toContain('판정하지 못했다')
  })

  it('🔴 열리지 않는 범위면 **명령을 만들지 않는다**(실행하면 거부당할 명령을 주지 않는다)', () => {
    const a = act({
      requiredDelegationAcks: () => ({ kind: 'blocked', detail: 'scope-out-of-range: 다른 티켓이 범위에 있다' }),
    })
    expect(a.command).toBeUndefined()
    expect((a.diagnostics ?? []).join('\n')).toContain('통합이 열리지 않는다')
  })
})

describe('[REQ-2026-172] 공급자는 지연 호출된다(값싼 경로의 비용 0)', () => {
  it('🔴 auto 종단에서는 **정확히 한 번** 호출된다', () => {
    const spy = vi.fn((): AckProbe => acks(false, false))
    terminalIntegrationAction(autoInput({ requiredDelegationAcks: spy }))
    expect(spy).toHaveBeenCalledTimes(1)
  })

  /**
   * 🔴 `merge` 종단은 위임을 쓰지 않는다 — 그 경로가 범위 수집(git log + blob 배치)을 하면
   *    값싼 명령이 비싸진다. 공급자가 **불리지 않아야** 한다.
   */
  it('🔴 auto 가 아닌 종단에서는 호출되지 않는다', () => {
    const spy = vi.fn((): AckProbe => acks(false, false))
    terminalIntegrationAction(autoInput({ stopGate: 'merge', requiredDelegationAcks: spy }))
    expect(spy).not.toHaveBeenCalled()
  })
})

/**
 * 🔴 **배선 검증**(REQ-2026-172 phase-3). 위 테스트들은 공급자를 손으로 주입하므로,
 *    `main()` 이 그것을 넘기지 않아도 전부 green 이다 — 변이 검사로 실제 확인했다.
 *    그래서 "줄 것인가" 규칙을 함수로 빼서 **그 규칙 자체**를 단정한다.
 */
describe('[REQ-2026-172] 공급자 배선 규칙', () => {
  const cfg: ProbeConfig = {
    root: '/nowhere',
    ticketRoot: 'workflow',
    trunkBranch: 'main',
    branchPrefix: 'feat/req-',
    reviewBudget: { hardCap: 8 },
  }
  const state = { id: 'REQ-2026-172', branch: BRANCH } as unknown as Parameters<typeof delegationAckProvider>[2]
  const roGit = (): string => {
    throw new Error('불려서는 안 된다')
  }

  it('🔴 auto 면 공급자를 준다', () => {
    expect(typeof delegationAckProvider('auto', cfg, state, roGit)).toBe('function')
  })

  it('🔴 auto 가 아니면 주지 않는다(값싼 경로의 비용 0)', () => {
    for (const sg of ['phase', 'req', 'merge'] as const)
      expect(delegationAckProvider(sg, cfg, state, roGit), sg).toBeUndefined()
  })

  /** 🔴 **지연**이다 — 공급자를 만드는 것만으로는 git 을 부르지 않는다(roGit 이 throw 한다). */
  it('🔴 공급자를 만드는 것만으로는 아무 비용도 들지 않는다', () => {
    expect(() => delegationAckProvider('auto', cfg, state, roGit)).not.toThrow()
  })

  /**
   * 🔴 **호출 지점을 고정한다.** 규칙 함수가 있어도 `main()` 이 부르지 않으면 죽은 코드다.
   *    (동작 e2e 가 정본이지만, auto 종단 상태를 만드는 비용이 커서 여기서는 호출 지점을 고정한다 —
   *     한계를 알고 쓰는 가드다.)
   */
  it('🔴 main() 이 규칙 함수를 통해 배선한다', () => {
    const src = readFileSync(join(import.meta.dirname, '..', '..', 'scripts', 'req', 'req-next.ts'), 'utf8')
    expect(src, 'main 이 공급자 규칙을 쓰지 않는다').toContain('requiredDelegationAcks: delegationAckProvider(')
  })
})

/**
 * 🔴 판정 자체는 **실 git** 으로 태운다 — 순수 단정만으로는 "읽지 못했다" 경로가 검증되지 않는다.
 */
describe('[REQ-2026-172] probeDelegationAcks (실 git)', () => {
  function mkRepo(): string {
    const dir = mkdtempSync(join(tmpdir(), 'cg-probe-'))
    const g = (...a: string[]): string => execFileSync('git', a, { cwd: dir, encoding: 'utf8' })
    g('init', '-b', 'main')
    g('config', 'user.email', 'p@example.com')
    g('config', 'user.name', 'Prober')
    writeFileSync(join(dir, 'a.txt'), 'base\n')
    g('add', '.')
    g('commit', '-m', 'base')
    return dir
  }
  const cfgFor = (dir: string): ProbeConfig => ({
    root: dir,
    ticketRoot: 'workflow',
    trunkBranch: 'main',
    branchPrefix: 'feat/req-',
    reviewBudget: { hardCap: 8 },
  })
  const gitOf = (dir: string) => (args: string[]): string => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })

  it('🔴 브랜치 이름에서 대상을 판정할 수 없으면 unknown(추측하지 않는다)', () => {
    const dir = mkRepo()
    const st = { id: 'REQ-2026-001', branch: 'wip/whatever' } as unknown as Parameters<typeof probeDelegationAcks>[1]
    const r = probeDelegationAcks(cfgFor(dir), st, gitOf(dir))
    expect(r.kind).toBe('unknown')
  })

  it('🔴 branch 가 비면 unknown', () => {
    const dir = mkRepo()
    const st = { id: 'REQ-2026-001', branch: '' } as unknown as Parameters<typeof probeDelegationAcks>[1]
    expect(probeDelegationAcks(cfgFor(dir), st, gitOf(dir)).kind).toBe('unknown')
  })

  /**
   * 🔴 **사실 수집이 실패한 경로**를 태운다. `delivery/<slug>` 브랜치인데 그 묶음 레코드가 없으면
   *    `collectPreflightFacts` 가 `unavailable` 을 낸다 — 그때 **빈 acks 로 흘리면 안 된다**.
   *    빈 acks 는 "필요한 플래그가 없다"는 **적극적 주장**이고, 모르는 것을 안다고 말하는 것이다.
   */
  it('🔴 사실을 수집하지 못하면 unknown 이다(빈 acks 로 흘리지 않는다)', () => {
    const dir = mkRepo()
    const g = (...a: string[]): string => execFileSync('git', a, { cwd: dir, encoding: 'utf8' })
    g('checkout', '-b', 'delivery/nosuch')
    writeFileSync(join(dir, 'b.txt'), 'x\n')
    g('add', '.')
    g('commit', '-m', 'work')
    const st = { id: 'REQ-2026-001', branch: 'delivery/nosuch' } as unknown as Parameters<typeof probeDelegationAcks>[1]
    const r = probeDelegationAcks(cfgFor(dir), st, gitOf(dir))
    expect(r.kind, `기대: unknown · 실제: ${JSON.stringify(r)}`).toBe('unknown')
  })

  it('🔴 SHA 를 읽지 못하면 unknown(빈 acks 로 넘기지 않는다)', () => {
    const dir = mkRepo()
    const st = { id: 'REQ-2026-001', branch: 'feat/req-2026-001-x' } as unknown as Parameters<typeof probeDelegationAcks>[1]
    // 그 브랜치는 존재하지 않는다 → rev-parse 실패
    const r = probeDelegationAcks(cfgFor(dir), st, gitOf(dir))
    expect(r.kind).toBe('unknown')
  })
})

/**
 * REQ-2026-173 phase-3 — **이미 유효한 위임이 있으면 또 묻지 않는다**.
 *
 * 🔴 지금까지 `auto` 종단은 위임의 존재와 무관하게 **무조건 "발급하라"** 고 안내했다. 그 안내는
 *    두 가지로 잘못된다:
 *      ① 사람이 **이미 준 승인**을 또 받는다 — `auto` 를 고른 이유가 사라진다.
 *      ② 안내대로 발급하면 유효 위임이 둘이 되어 `ambiguous-active` 로 **막힌다**.
 *    trunk 이동이 인가되기 시작하면(REQ-2026-173) 이 상황이 **정상 경로**가 된다.
 */
describe('[REQ-2026-173] 유효한 위임이 이미 있으면 발급을 권하지 않는다', () => {
  const alreadyValid = (id = 'D-1234abcd'): AckProbe => ({ kind: 'already-valid', delegationId: id })

  it('🔴 AWAIT_HUMAN 이 아니라 RUN 이다(사람 개입이 사라진다)', () => {
    const a = act({ requiredDelegationAcks: () => alreadyValid() })
    expect(a.kind).toBe('RUN')
  })

  it('🔴 다음 명령은 **발급이 아니라 통합**이다', () => {
    const a = act({ requiredDelegationAcks: () => alreadyValid() })
    expect(a.command).toContain('integrate')
    expect(a.command, '발급을 권하면 ambiguous-active 로 막힌다').not.toContain('req:delegate')
  })

  it('어느 위임이 덮는지 말한다(추적 가능성)', () => {
    const a = act({ requiredDelegationAcks: () => alreadyValid('D-abcd1234') })
    expect(a.detail).toContain('D-abcd12')
  })

  it('🔴 게이트가 사라지지 않는다는 것을 안내가 말한다', () => {
    const a = act({ requiredDelegationAcks: () => alreadyValid() })
    expect(a.detail).toContain('다시 검증')
  })

  it('공급자가 already-valid 를 내지 않으면 종전대로 발급 안내다(무회귀)', () => {
    const a = act({ requiredDelegationAcks: () => acks(false, false) })
    expect(a.kind).toBe('AWAIT_HUMAN')
    expect(a.command).toContain('req:delegate')
  })
})

/**
 * 🔴 **`already-valid` 판정 자체를 실 git 으로 태운다**. 위 테스트들은 공급자를 손으로 주입하므로
 *    `probeDelegationAcks` 가 그 분기를 내지 않아도 전부 green 이다(변이 검사로 확인했다).
 */
describe('[REQ-2026-173] probeDelegationAcks — already-valid (실 git)', () => {
  const TICKET = 'REQ-2026-001'
  const FEAT = 'feat/req-2026-001-x'

  function repoWithValidDelegation(): { dir: string; state: Parameters<typeof probeDelegationAcks>[1] } {
    const dir = mkdtempSync(join(tmpdir(), 'cg-alreadyvalid-'))
    const gg = (...a: string[]): string => execFileSync('git', a, { cwd: dir, encoding: 'utf8' })
    gg('init', '-q', '-b', 'main')
    gg('config', 'user.email', 'p@example.com')
    gg('config', 'user.name', 'P')
    mkdirSync(join(dir, 'workflow', TICKET, 'responses'), { recursive: true })
    writeFileSync(
      join(dir, 'workflow', TICKET, 'state.json'),
      JSON.stringify({ id: TICKET, risk_level: 'LOW', review_series: [] }),
    )
    gg('add', '.')
    gg('commit', '-q', '-m', 'base')
    const trunkSha = gg('rev-parse', 'HEAD').trim()

    // feature 에 부기 커밋 하나 — 범위 귀속이 이 티켓 하나가 된다.
    gg('checkout', '-q', '-b', FEAT)
    writeFileSync(join(dir, 'workflow', TICKET, 'responses', 'note.txt'), 'n\n')
    gg('add', '.')
    gg('commit', '-q', '-m', 'chore: work\n\nCommitGate-Bookkeeping: true')

    // 🔴 유효한 위임을 원장에 둔다(발급 시점 trunk = 현재 main).
    const row = {
      kind: 'issued',
      id: 'D-VALID-1',
      at: '2026-08-22T00:00:00.000Z',
      scope: { kind: 'ticket', req_id: TICKET },
      trunk_branch: 'main',
      trunk_sha: trunkSha,
      source_branch: FEAT,
      base_sha: gg('rev-parse', 'HEAD').trim(),
      expires_at: '2126-01-01T00:00:00.000Z',
      permissions: { local_merge: true, origin_push: false, bypass_protection: false },
      high_risk_ack: false,
      attested_ack: false,
      approval_sentence: '통합을 사전 위임합니다',
    }
    writeFileSync(join(dir, 'workflow', 'delegations.jsonl'), JSON.stringify(row) + '\n')

    const state = { id: TICKET, branch: FEAT } as unknown as Parameters<typeof probeDelegationAcks>[1]
    return { dir, state }
  }

  const cfgOf = (dir: string): ProbeConfig => ({
    root: dir,
    ticketRoot: 'workflow',
    trunkBranch: 'main',
    branchPrefix: 'feat/req-',
    reviewBudget: { hardCap: 8 },
  })
  const gitOf2 = (dir: string) => (args: string[]): string => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })

  it('🔴 유효한 위임이 있으면 already-valid 를 낸다(발급을 권하지 않는다)', () => {
    const { dir, state } = repoWithValidDelegation()
    const r = probeDelegationAcks(cfgOf(dir), state, gitOf2(dir))
    expect(r.kind, `기대: already-valid · 실제: ${JSON.stringify(r)}`).toBe('already-valid')
    if (r.kind !== 'already-valid') return
    expect(r.delegationId).toBe('D-VALID-1')
  })

  it('🔴 위임이 없으면 already-valid 가 아니다(종전 경로)', () => {
    const { dir, state } = repoWithValidDelegation()
    writeFileSync(join(dir, 'workflow', 'delegations.jsonl'), '')
    expect(probeDelegationAcks(cfgOf(dir), state, gitOf2(dir)).kind).not.toBe('already-valid')
  })
})
