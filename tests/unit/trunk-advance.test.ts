import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import {
  authorizeTrunkAdvance,
  authorizedMergeShas,
  firstParentAuthorizationProblem,
  parseFirstParentChain,
} from '../../scripts/req/lib/trunk-advance'
import { readBlobsAtRef } from '../../scripts/req/lib/git-batch'
import { delegationVerdict, type DelegationRow, type DelegationCheckInput } from '../../scripts/req/lib/delegation'
import type { GitAdapter } from '../../scripts/req/lib/adapters'

/**
 * REQ-2026-173 — **인가된 trunk 이동**.
 *
 * 🔴 이 완화는 게이트를 여는 것이라 오라클이 두 방향이어야 한다:
 *    ① 인가된 이동이 **통과한다**(그게 이 REQ 의 목적)
 *    ② 인가되지 않은 것은 **여전히 막힌다**(그게 이 REQ 의 안전)
 */

const TRUNK = 'a'.repeat(40)
const MOVED = 'b'.repeat(40)

// ───────────────────────────── 무회귀 기본값 ──

describe('[REQ-2026-173] `trunkAdvance` 미제공 = 종전 거부(무회귀)', () => {
  const base = (over: Partial<DelegationCheckInput> = {}): DelegationCheckInput => ({
    ledgerText: JSON.stringify({
      kind: 'issued',
      id: 'ID-1',
      at: '2026-08-22T00:00:00.000Z',
      scope: { kind: 'ticket', req_id: 'REQ-2026-001' },
      trunk_branch: 'main',
      trunk_sha: TRUNK,
      source_branch: 'feat/req-2026-001-x',
      base_sha: 'c'.repeat(40),
      expires_at: '2026-08-22T12:00:00.000Z',
      permissions: { local_merge: true, origin_push: false, bypass_protection: false },
      high_risk_ack: false,
      attested_ack: false,
      approval_sentence: '승인',
    }),
    scope: { kind: 'ticket', req_id: 'REQ-2026-001' },
    now: '2026-08-22T01:00:00.000Z',
    trunkBranch: 'main',
    trunkSha: MOVED, // 🔴 움직였다
    sourceBranch: 'feat/req-2026-001-x',
    requested: { local_merge: true, origin_push: false, bypass_protection: false },
    riskLevel: 'LOW',
    budgetHardCapReached: false,
    reviewInconclusive: false,
    evidenceOk: true,
    rangeAttribution: { tickets: ['REQ-2026-001'], unattributable: 0, unattributableAttested: 0, deliveries: [] },
    deliveryMembers: null,
    compositionChanged: false,
    ...over,
  })

  it('🔴 계산하지 않았으면(=undefined) 거부한다 — "모른다"를 "괜찮다"로 읽지 않는다', () => {
    const v = delegationVerdict(base())
    expect(v.ok).toBe(false)
    if (v.ok) return
    expect(v.reason).toBe('trunk-moved')
  })

  it('🔴 인가되지 않았다고 판정되면 사유가 함께 나온다', () => {
    const v = delegationVerdict(base({ trunkAdvance: { authorized: false, reason: '손으로 민 커밋 1건' } }))
    expect(v.ok).toBe(false)
    if (v.ok) return
    expect(v.reason).toBe('trunk-moved')
    expect(v.detail).toContain('손으로 민 커밋 1건')
  })

  it('인가됐으면 이 축을 통과한다(다른 축은 그대로 판정된다)', () => {
    const v = delegationVerdict(base({ trunkAdvance: { authorized: true, mergeShas: ['m'.repeat(40)], addedCommits: 3 } }))
    expect(v.ok, JSON.stringify(v)).toBe(true)
  })

  it('🔴 인가돼도 **다른 축은 그대로 막는다**(이 축만 완화된다)', () => {
    const v = delegationVerdict(
      base({ trunkAdvance: { authorized: true, mergeShas: ['m'.repeat(40)], addedCommits: 3 }, riskLevel: 'HIGH' }),
    )
    expect(v.ok).toBe(false)
    if (v.ok) return
    expect(v.reason).toBe('high-risk-unacked')
  })
})

// ───────────────────────────── authorizedMergeShas(순수) ──

describe('[REQ-2026-173] authorizedMergeShas — issued 결속', () => {
  const issued = (id: string, trunkBranch: string): DelegationRow => ({
    kind: 'issued',
    id,
    at: '2026-08-22T00:00:00.000Z',
    scope: { kind: 'ticket', req_id: 'REQ-2026-001' },
    trunk_branch: trunkBranch,
    trunk_sha: 'z'.repeat(40),
    source_branch: 'feat/x',
    base_sha: 'y'.repeat(40),
    expires_at: '2026-08-22T12:00:00.000Z',
    permissions: { local_merge: true, origin_push: false, bypass_protection: false },
    high_risk_ack: false,
    attested_ack: false,
    approval_sentence: '승인',
  })
  const executed = (id: string, mergeSha: string | null): DelegationRow => ({
    kind: 'executed',
    id,
    at: '2026-08-22T00:00:00.000Z',
    merge_sha: mergeSha,
    performed: { local_merge: true, origin_push: false, bypass_protection: false },
    detail: '',
  })

  it('이 trunk 로 발급된 위임의 merge_sha 만 모은다', () => {
    const rows = [issued('A', 'main'), executed('A', 'm1')]
    expect([...authorizedMergeShas(rows, 'main')]).toEqual(['m1'])
  })

  /** 🔴 **교차-branch 우회 차단**(phase-1 r03 P1). */
  it('🔴 다른 trunk 로 발급된 위임의 병합은 인가로 세지 않는다', () => {
    const rows = [issued('R', 'release'), executed('R', 'm1')]
    expect([...authorizedMergeShas(rows, 'main')]).toEqual([])
  })

  it('🔴 issued 가 없는 executed 는 인가로 세지 않는다(고아 행)', () => {
    expect([...authorizedMergeShas([executed('X', 'm1')], 'main')]).toEqual([])
  })

  it('🔴 병합하지 못한 executed(merge_sha=null)는 세지 않는다', () => {
    const rows = [issued('A', 'main'), executed('A', null)]
    expect([...authorizedMergeShas(rows, 'main')]).toEqual([])
  })
})

// ───────────────────────────── 실 git ──

function g(dir: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
}

/**
 * trunk 에 **부기 커밋**(티켓 경로 + trailer) 하나를 담은 feature 를 만들어 `--no-ff` 로 병합한다.
 *
 * 🔴 경로가 `ticketRoot` 밖이면 분류기가 `invalid-evidence` 로 본다 — trailer 만 달고 아무 경로나
 *    바꾸는 것을 막는 기존 규칙이다(픽스처를 처음 그렇게 만들었다가 잡혔다).
 */
function mergeFeature(dir: string, name: string): string {
  const slug = name.replace(/\//g, '_')
  g(dir, 'checkout', '-q', '-b', name)
  mkdirSync(join(dir, 'workflow', 'REQ-2026-001'), { recursive: true })
  writeFileSync(join(dir, 'workflow', 'REQ-2026-001', `${slug}.txt`), 'work\n')
  g(dir, 'add', '.')
  g(dir, 'commit', '-q', '-m', `chore: work ${name}\n\nCommitGate-Bookkeeping: true`)
  g(dir, 'checkout', '-q', 'main')
  g(dir, 'merge', '-q', '--no-ff', '-m', `merge ${name}`, name)
  return g(dir, 'rev-parse', 'HEAD').trim()
}

function mkRepo(): { dir: string; ports: Parameters<typeof authorizeTrunkAdvance>[0] } {
  const dir = mkdtempSync(join(tmpdir(), 'cg-trunkadv-'))
  g(dir, 'init', '-q', '-b', 'main')
  g(dir, 'config', 'user.email', 't@example.com')
  g(dir, 'config', 'user.name', 'T')
  writeFileSync(join(dir, 'base.txt'), 'base\n')
  g(dir, 'add', '.')
  g(dir, 'commit', '-q', '-m', 'base')
  const git: GitAdapter = { exec: (args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }) }
  return { dir, ports: { git, readBlobs: (ref, paths) => readBlobsAtRef(dir, ref, paths), ticketRoot: 'workflow' } }
}

/**
 * 🔴 executed 는 **그 issued 와 짝**이어야 인가로 센다(phase-1 r03 P1) — 그렇지 않으면 다른 trunk
 *    대상 위임의 병합이 이 trunk 의 이동을 인가한다. 그래서 헬퍼가 두 행을 함께 만든다.
 */
let rowSeq = 0
const executedRow = (mergeSha: string, trunkBranch = 'main'): DelegationRow[] => {
  const id = `ID-${++rowSeq}`
  return [
    {
      kind: 'issued',
      id,
      at: '2026-08-22T00:00:00.000Z',
      scope: { kind: 'ticket', req_id: 'REQ-2026-001' },
      trunk_branch: trunkBranch,
      trunk_sha: 'z'.repeat(40),
      source_branch: 'feat/x',
      base_sha: 'y'.repeat(40),
      expires_at: '2026-08-22T12:00:00.000Z',
      permissions: { local_merge: true, origin_push: false, bypass_protection: false },
      high_risk_ack: false,
      attested_ack: false,
      approval_sentence: '승인',
    },
    {
      kind: 'executed',
      id,
      at: '2026-08-22T00:00:00.000Z',
      merge_sha: mergeSha,
      performed: { local_merge: true, origin_push: false, bypass_protection: false },
      detail: '',
    },
  ]
}

describe('[REQ-2026-173] authorizeTrunkAdvance (실 git)', () => {
  it('움직이지 않았으면 자명하게 인가', () => {
    const { dir, ports } = mkRepo()
    const head = g(dir, 'rev-parse', 'HEAD').trim()
    expect(authorizeTrunkAdvance(ports, [], head, head, 'main')).toEqual({ authorized: true, mergeShas: [], addedCommits: 0 })
  })

  /** 🔴 **이 REQ 의 목적** — 앞 REQ 통합이 뒤 REQ 의 위임을 무효화하지 않는다. */
  it('🔴 인가된 병합만으로 움직였으면 통과한다', () => {
    const { dir, ports } = mkRepo()
    const from = g(dir, 'rev-parse', 'HEAD').trim()
    const m1 = mergeFeature(dir, 'feat/one')
    const to = g(dir, 'rev-parse', 'HEAD').trim()
    const v = authorizeTrunkAdvance(ports, executedRow(m1), from, to, 'main')
    expect(v.authorized, JSON.stringify(v)).toBe(true)
    if (!v.authorized) return
    expect(v.mergeShas).toEqual([m1])
  })

  it('🔴 병합 2건도 전부 인가돼 있으면 통과한다(순차 통합)', () => {
    const { dir, ports } = mkRepo()
    const from = g(dir, 'rev-parse', 'HEAD').trim()
    const m1 = mergeFeature(dir, 'feat/one')
    const m2 = mergeFeature(dir, 'feat/two')
    const to = g(dir, 'rev-parse', 'HEAD').trim()
    expect(authorizeTrunkAdvance(ports, [...executedRow(m1), ...executedRow(m2)], from, to, 'main').authorized).toBe(true)
  })

  /**
   * 🔴 **전체 범위 대조(조건 1)만이 잡는 경우**(phase-1 r02 observation).
   *    미인가 머지가 인가된 머지의 **side-parent 이력 안**에 있으면 first-parent 사슬에는 나타나지 않는다.
   *    그래서 사슬 검사로는 못 잡고, 범위 전체의 머지 sha 대조가 필요하다 — 두 검사가 **다른 것을 막는다**.
   */
  it('🔴 인가된 병합이 데려온 이력 안의 미인가 머지도 거부한다(범위 대조 단독)', () => {
    const { dir, ports } = mkRepo()
    const from = g(dir, 'rev-parse', 'HEAD').trim()
    // feature 안에서 또 다른 브랜치를 병합해 **사슬 밖** 머지를 만든다.
    g(dir, 'checkout', '-q', '-b', 'feat/outer')
    mkdirSync(join(dir, 'workflow', 'REQ-2026-001'), { recursive: true })
    writeFileSync(join(dir, 'workflow', 'REQ-2026-001', 'outer.txt'), 'o\n')
    g(dir, 'add', '.')
    g(dir, 'commit', '-q', '-m', 'chore: outer\n\nCommitGate-Bookkeeping: true')
    g(dir, 'checkout', '-q', '-b', 'feat/inner')
    writeFileSync(join(dir, 'workflow', 'REQ-2026-001', 'inner.txt'), 'i\n')
    g(dir, 'add', '.')
    g(dir, 'commit', '-q', '-m', 'chore: inner\n\nCommitGate-Bookkeeping: true')
    g(dir, 'checkout', '-q', 'feat/outer')
    g(dir, 'merge', '-q', '--no-ff', '-m', 'merge inner', 'feat/inner')
    const innerMerge = g(dir, 'rev-parse', 'HEAD').trim()
    g(dir, 'checkout', '-q', 'main')
    g(dir, 'merge', '-q', '--no-ff', '-m', 'merge outer', 'feat/outer')
    const outerMerge = g(dir, 'rev-parse', 'HEAD').trim()
    const to = outerMerge

    // 사슬에는 outerMerge 만 있다(innerMerge 는 side-parent 이력).
    const chain = parseFirstParentChain(g(dir, 'rev-list', '--first-parent', '--parents', `${from}..${to}`))
    expect(chain.map((c) => c.sha)).toEqual([outerMerge])

    const v = authorizeTrunkAdvance(ports, executedRow(outerMerge), from, to, 'main')
    expect(v.authorized, '사슬 밖 미인가 머지가 통과했다').toBe(false)
    if (v.authorized) return
    expect(v.reason).toContain(innerMerge.slice(0, 8))
  })

  /** 🔴 **이 REQ 의 안전** — 인가되지 않은 것은 여전히 막힌다. */
  it('🔴 원장에 없는 병합이 섞이면 거부한다', () => {
    const { dir, ports } = mkRepo()
    const from = g(dir, 'rev-parse', 'HEAD').trim()
    const m1 = mergeFeature(dir, 'feat/one')
    const m2 = mergeFeature(dir, 'feat/two')
    const to = g(dir, 'rev-parse', 'HEAD').trim()
    const v = authorizeTrunkAdvance(ports, executedRow(m1), from, to, 'main') // m2 미인가
    expect(v.authorized).toBe(false)
    if (v.authorized) return
    expect(v.reason).toContain(m2.slice(0, 8))
  })

  /**
   * 🔴 **조건 2(`unproven`)만 겨냥한다.** 아래 "손으로 민 커밋" 테스트는 병합이 아예 없어서
   *    조건 1에도 걸린다 — 그래서 조건 2를 지워도 red 가 되지 않는다(변이 검사로 확인했다).
   *    여기서는 **인가된 병합이 있는 채로** 미입증 커밋을 얹어 조건 2 단독으로 걸리게 한다.
   */
  it('🔴 인가된 병합이 있어도 미입증 커밋이 섞이면 거부한다(조건 2 단독)', () => {
    const { dir, ports } = mkRepo()
    const from = g(dir, 'rev-parse', 'HEAD').trim()
    const m1 = mergeFeature(dir, 'feat/one')
    writeFileSync(join(dir, 'hand.txt'), 'x\n')
    g(dir, 'add', '.')
    g(dir, 'commit', '-q', '-m', 'hand-pushed after merge')
    const to = g(dir, 'rev-parse', 'HEAD').trim()
    const v = authorizeTrunkAdvance(ports, executedRow(m1), from, to, 'main')
    expect(v.authorized).toBe(false)
    if (v.authorized) return
    expect(v.reason, '조건 2(미입증)로 걸려야 한다').toContain('미입증')
  })

  it('🔴 손으로 민 커밋(부기 표식 없음)이 있으면 거부한다', () => {
    const { dir, ports } = mkRepo()
    const from = g(dir, 'rev-parse', 'HEAD').trim()
    writeFileSync(join(dir, 'hand.txt'), 'x\n')
    g(dir, 'add', '.')
    g(dir, 'commit', '-q', '-m', 'hand-pushed')
    const to = g(dir, 'rev-parse', 'HEAD').trim()
    const v = authorizeTrunkAdvance(ports, [], from, to, 'main')
    expect(v.authorized).toBe(false)
    if (v.authorized) return
    expect(v.reason).toMatch(/미입증|인가된 병합이 하나도 없다/)
  })

  /**
   * 🔴 부기 커밋만으로 움직인 경우도 거부한다 — 증거 분류는 통과하지만
   *    "인가된 병합만으로 움직였다"는 주장이 거짓이 된다.
   */
  it('🔴 부기만으로 움직였으면 거부한다(인가된 병합이 없다)', () => {
    const { dir, ports } = mkRepo()
    const from = g(dir, 'rev-parse', 'HEAD').trim()
    mkdirSync(join(dir, 'workflow', 'REQ-2026-001'), { recursive: true })
    writeFileSync(join(dir, 'workflow', 'REQ-2026-001', 'note.txt'), 'x\n')
    g(dir, 'add', '.')
    g(dir, 'commit', '-q', '-m', 'chore: bookkeeping\n\nCommitGate-Bookkeeping: true')
    const to = g(dir, 'rev-parse', 'HEAD').trim()
    const v = authorizeTrunkAdvance(ports, [], from, to, 'main')
    expect(v.authorized).toBe(false)
    if (v.authorized) return
    // 🔴 사슬 검사가 먼저 잡는다(인가된 병합의 수행 기록이 아니다). 어느 쪽이든 **거부**가 계약이다.
    expect(v.reason).toMatch(/수행 기록도 아닌|인가된 병합이 하나도 없다/)
  })

  /**
   * 🔴 **사슬 검사가 실제로 배선됐는가.** 순수 테스트는 판정 함수를 직접 부르므로 호출을 지워도 green 이고,
   *    "trunk 로 직접 올린 커밋" e2e 는 그 커밋이 조건 2(미입증/손상)에도 걸려 **대신 잡힌다** —
   *    둘 다 배선을 고정하지 못한다(변이 검사로 확인했다). 그래서 호출 자체를 관측한다.
   *
   *    (조건 2 를 통과하면서 사슬에만 걸리는 실 git 조합은 `approved` 커밋을 trunk 에 직접 올리는 것인데,
   *     그러려면 승인 증거 픽스처가 필요하다 — 그 조합은 위 순수 테스트가 정확히 재현한다.)
   */
  it('🔴 first-parent 사슬을 실제로 조회한다(배선 고정)', () => {
    const { dir, ports } = mkRepo()
    const from = g(dir, 'rev-parse', 'HEAD').trim()
    const m1 = mergeFeature(dir, 'feat/one')
    const to = g(dir, 'rev-parse', 'HEAD').trim()
    const calls: string[][] = []
    const spied: typeof ports = {
      ...ports,
      git: {
        exec: (args) => {
          calls.push([...args])
          return ports.git.exec(args)
        },
      },
    }
    expect(authorizeTrunkAdvance(spied, executedRow(m1), from, to, 'main').authorized).toBe(true)
    expect(
      calls.some((a) => a[0] === 'rev-list' && a.includes('--first-parent')),
      'first-parent 사슬을 조회하지 않았다 — 사슬 검사가 배선되지 않았다',
    ).toBe(true)
  })

  /**
   * 🔴 **교차-branch fast-forward 우회**(phase-1 r03 P1 재현).
   *
   *    `release` 대상 위임으로 정상 통합한 결과를 `main` 이 `--ff-only` 로 따라가면,
   *    범위에는 인가된 머지와 그 부기만 있고 증거도 온전하다. 결속이 없으면 **통과한다** —
   *    그러나 `main` 의 이동은 아무도 인가하지 않았다.
   */
  it('🔴 다른 trunk 대상 위임의 병합으로 main 이 움직이면 거부한다', () => {
    const { dir, ports } = mkRepo()
    const from = g(dir, 'rev-parse', 'HEAD').trim()
    g(dir, 'checkout', '-q', '-b', 'release')
    // release 에서 정상 통합 모양(머지 + 수행 기록 부기)을 만든다.
    g(dir, 'checkout', '-q', '-b', 'feat/rel')
    mkdirSync(join(dir, 'workflow', 'REQ-2026-001'), { recursive: true })
    writeFileSync(join(dir, 'workflow', 'REQ-2026-001', 'rel.txt'), 'r\n')
    g(dir, 'add', '.')
    g(dir, 'commit', '-q', '-m', 'chore: rel\n\nCommitGate-Bookkeeping: true')
    g(dir, 'checkout', '-q', 'release')
    g(dir, 'merge', '-q', '--no-ff', '-m', 'merge feat/rel', 'feat/rel')
    const relMerge = g(dir, 'rev-parse', 'HEAD').trim()
    writeFileSync(join(dir, 'workflow', 'REQ-2026-001', 'exec.txt'), 'e\n')
    g(dir, 'add', '.')
    g(dir, 'commit', '-q', '-m', 'chore: 수행 기록\n\nCommitGate-Bookkeeping: true')
    // main 이 release 를 그대로 따라간다.
    g(dir, 'checkout', '-q', 'main')
    g(dir, 'merge', '-q', '--ff-only', 'release')
    const to = g(dir, 'rev-parse', 'HEAD').trim()

    // 위임은 **release** 대상으로 발급됐다.
    const rows = executedRow(relMerge, 'release')
    const v = authorizeTrunkAdvance(ports, rows, from, to, 'main')
    expect(v.authorized, 'release 대상 위임이 main 이동을 인가했다 — 권한 범위 우회').toBe(false)

    // 🔴 같은 병합이라도 **main 대상 위임**이면 인가된다(과잉 차단이 아님을 함께 고정).
    const okRows = executedRow(relMerge, 'main')
    expect(authorizeTrunkAdvance(ports, okRows, from, to, 'main').authorized).toBe(true)
  })

  it('🔴 범위를 읽지 못하면 거부한다(판정 불가 = 거부)', () => {
    const { dir, ports } = mkRepo()
    const from = g(dir, 'rev-parse', 'HEAD').trim()
    const v = authorizeTrunkAdvance(ports, [], from, 'NO-SUCH-REF', 'main')
    expect(v.authorized).toBe(false)
  })
})

/**
 * REQ-2026-173 phase-1 r01 P1 — **범위 분류만으로는 부족하다**.
 *
 * 🔴 재현(리뷰어): T0 에서 위임 발급 → A 를 정상 통합(인가된 M1) → 그 뒤 **trunk 에서 직접**
 *    다른 REQ 의 `req:commit` 을 돌려 승인 증거가 있는 source 커밋 C 와 부기 B 가 얹힌다.
 *    `T0..HEAD` 는 unproven/attested 0 이고 머지도 M1 뿐이라 옛 판정은 **통과**했다.
 *    그러나 C 는 M1 이 데려온 것도, 이 위임이 인가한 것도 아니다.
 *
 * 🔴 실제 `approved` 커밋을 만들려면 승인 증거 픽스처가 필요하므로, 여기서는 **판정 함수를 직접**
 *    태운다 — 분류를 주입해 그 조합을 정확히 재현한다(실 git 조합은 아래 e2e 가 덮는다).
 */
describe('[REQ-2026-173] firstParentAuthorizationProblem — trunk 사슬 검사(순수)', () => {
  const M1 = 'm'.repeat(40)
  const B = 'b'.repeat(40)
  const C = 'c'.repeat(40)
  const authorized = new Set([M1])
  /** 사슬은 최신순이다(rev-list 순서). `integrate` 는 병합 뒤 부기를 정확히 하나 얹는다. */
  const node = (sha: string, firstParent: string | null) => ({ sha, firstParent })

  it('인가된 머지 + 그 수행 기록이면 통과', () => {
    expect(
      firstParentAuthorizationProblem([node(B, M1), node(M1, 'base')], authorized, (sha) =>
        sha === B ? 'bookkeeping' : 'merge',
      ),
    ).toBeNull()
  })

  /** 🔴 **리뷰어가 지목한 조합 ①** — 정상 병합 뒤 trunk 에 직접 올라온 approved 커밋. */
  it('🔴 trunk 사슬의 approved 커밋을 거부한다(인가된 병합이 데려온 것이 아니다)', () => {
    // 실제 순서(rev-list 최신순): M1 병합 → B(수행 기록) → C(사람이 trunk 에서 직접 커밋)
    const problem = firstParentAuthorizationProblem(
      [node(C, B), node(B, M1), node(M1, 'base')],
      authorized,
      (sha) => (sha === B ? 'bookkeeping' : sha === C ? 'approved' : 'merge'),
    )
    expect(problem, `기대: 거부 · 실제: ${String(problem)}`).not.toBeNull()
    expect(problem).toContain(C.slice(0, 8))
    expect(problem).toContain('approved')
  })

  /**
   * 🔴 **리뷰어가 지목한 조합 ②** — trunk 에서 무관한 `req:delegate` 를 돌려 만든 원장 부기.
   *    분류는 `bookkeeping` 이지만 **인가된 병합의 수행 기록이 아니다**(첫 부모가 그 병합이 아니다).
   *    위임 행 추가는 **권한 부여**라 이것이 통과하면 안 된다.
   */
  it('🔴 인가된 병합의 수행 기록이 아닌 부기는 거부한다', () => {
    const B1 = 'e'.repeat(40) // M1 의 수행 기록(정상)
    const B2 = 'f'.repeat(40) // 무관한 req:delegate 부기
    const problem = firstParentAuthorizationProblem(
      [node(B2, B1), node(B1, M1), node(M1, 'base')],
      authorized,
      (sha) => (sha === M1 ? 'merge' : 'bookkeeping'),
    )
    expect(problem, `기대: 거부 · 실제: ${String(problem)}`).not.toBeNull()
    expect(problem).toContain(B2.slice(0, 8))
  })

  it('🔴 인가되지 않은 머지도 사슬에서 거부된다', () => {
    const M2 = 'd'.repeat(40)
    expect(firstParentAuthorizationProblem([node(M2, 'base')], authorized, () => 'merge')).not.toBeNull()
  })

  it('🔴 분류를 모르는 커밋도 거부한다(모르면 막는다)', () => {
    expect(firstParentAuthorizationProblem([node(C, M1)], authorized, () => null)).toContain('미상')
  })

  it('🔴 첫 부모를 모르는 부기도 거부한다(귀속 불가)', () => {
    expect(firstParentAuthorizationProblem([node(B, null)], authorized, () => 'bookkeeping')).not.toBeNull()
  })

  it('빈 사슬은 문제 없음(움직이지 않았다)', () => {
    expect(firstParentAuthorizationProblem([], authorized, () => null)).toBeNull()
  })
})

describe('[REQ-2026-173] parseFirstParentChain(순수)', () => {
  it('`<sha> <parent…>` 를 첫 부모까지 읽는다', () => {
    const out = ['aaa bbb ccc', 'bbb ddd', 'ddd'].join('\n')
    expect(parseFirstParentChain(out)).toEqual([
      { sha: 'aaa', firstParent: 'bbb' },
      { sha: 'bbb', firstParent: 'ddd' },
      { sha: 'ddd', firstParent: null },
    ])
  })

  it('빈 출력 → 빈 사슬', () => {
    expect(parseFirstParentChain('')).toEqual([])
  })
})

/**
 * 🔴 실 git 로도 같은 사실을 고정한다 — 사슬 위의 **비-부기 커밋**은 병합이 정상이어도 거부된다.
 *    (`approved` 분류는 승인 증거가 필요해 위 순수 테스트가 덮고, 여기서는 사슬 규칙이
 *     실제 git 그래프에서 작동하는지를 본다.)
 */
describe('[REQ-2026-173] trunk 사슬 규칙 (실 git)', () => {
  it('🔴 인가된 병합 뒤에 trunk 로 직접 올린 커밋이 있으면 거부한다', () => {
    const { dir, ports } = mkRepo()
    const from = g(dir, 'rev-parse', 'HEAD').trim()
    const m1 = mergeFeature(dir, 'feat/one')
    // trunk 에 직접 — 부기 표식은 있지만 티켓 경로 밖이라 부기로 분류되지 않는다.
    writeFileSync(join(dir, 'direct.txt'), 'x\n')
    g(dir, 'add', '.')
    g(dir, 'commit', '-q', '-m', 'chore: direct on trunk\n\nCommitGate-Bookkeeping: true')
    const to = g(dir, 'rev-parse', 'HEAD').trim()
    const v = authorizeTrunkAdvance(ports, executedRow(m1), from, to, 'main')
    expect(v.authorized).toBe(false)
  })
})
