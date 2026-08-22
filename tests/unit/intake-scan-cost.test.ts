/**
 * REQ-2026-169 phase-2 — `scanIntake` 의 **git 프로세스 계수** 오라클(DEC-7-2) + 열거 동등성(DEC-8).
 *
 * ## 🔴 왜 별도 파일이고, 왜 이렇게 세는가
 *
 * `req-new-intake.test.ts` 의 실 git 케이스는 **정확성**을 고정한다 — 그러나 배치가 통째로 폴백으로
 * 되돌아가도 결과가 같으므로 **전부 녹색이다**(공허한 오라클). 그래서 비용을 따로 고정한다.
 *
 * 그런데 "주입한 deps 가 몇 번 불렸나"를 세는 것도 **똑같이 공허하다**: 주입 지점은 2번만 불리면서
 * `scanTicketIntake` 안의 실물 포트가 티켓마다 `git show` 를 띄워도 그 계수는 2다.
 * 그래서 **실제 git 스폰 자체**를 센다 — intake 경로가 쓰는 두 스폰 통로를 모두 감싼다:
 *
 * | 통로 | 쓰는 곳 |
 * |---|---|
 * | `cross-spawn` 의 `sync` | `intake-batch.listHeadTreeEntries` · `git-batch.readBlobsByOid` |
 * | `node:child_process` 의 `execFileSync` | `evidence-ports` 의 실물 `head*`(= 폴백 경로) |
 *
 * 감싸는 구현은 **실물에 그대로 위임**한다(동작 변경 없음 — 세기만 한다).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

/** 🔴 `vi.mock` 은 호이스팅되므로 로그 배열도 `vi.hoisted` 로 먼저 만든다. */
const { gitSpawns } = vi.hoisted(() => ({ gitSpawns: [] as string[][] }))

/**
 * 🔴 `cross-spawn` 은 CJS(`export =`)라 네임스페이스 모양이 번들러 interop 에 달려 있다.
 *    `default` 가 있으면 그것을, 없으면 네임스페이스 자신을 실물로 본다 — 그리고 **양쪽 모두**
 *    감싼 것으로 되돌려, 어느 import 형태를 쓰는 모듈이든 계수에 잡히게 한다.
 */
vi.mock('cross-spawn', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  const real = (actual.default ?? actual) as { sync: (...a: unknown[]) => unknown }
  const sync = (cmd: string, args?: readonly string[], opts?: unknown): unknown => {
    if (cmd === 'git') gitSpawns.push(['cross-spawn', ...(args ?? [])])
    return real.sync(cmd, args, opts)
  }
  const wrapped = Object.assign(function () { throw new Error('테스트에서 비동기 spawn 은 쓰지 않는다') }, real, { sync })
  return { ...actual, default: wrapped, sync }
})

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return {
    ...actual,
    execFileSync: (cmd: string, args?: readonly string[], opts?: unknown) => {
      if (cmd === 'git') gitSpawns.push(['execFileSync', ...(args ?? [])])
      return (actual.execFileSync as (...a: unknown[]) => unknown)(cmd, args, opts)
    },
  }
})

import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { scanIntake, listHeadTicketIds } from '../../scripts/req/lib/intake'
import { listHeadTreeEntries, ticketIdsFromEntries } from '../../scripts/req/lib/intake-batch'
import { buildManifestEntry, serializeManifestLine } from '../../scripts/req/lib/evidence'
import { serializeCloseProofRow, type CloseProofRow } from '../../scripts/req/lib/close-proof'

const g = (repo: string, args: string[]): string =>
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: repo, encoding: 'utf8' }).replace(/\s+$/, '')

const OID = 'b'.repeat(40)
const ISO = '2026-07-24T00:00:00.000Z'
const DESIGN = 'f'.repeat(64)
const sha256 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex')

/**
 * 🔴 **과거 needs-fix 라운드를 inventory 에 포함**시킨다(design-r02 observation).
 *    `verifyCommittedDesignEvidence` 는 inventory 항목마다 `headBlobSha256` 을 부르므로, 이 라운드가
 *    있어야 옛 구현의 "티켓당 스폰 N개" 가 실제로 재현되고 계수 테스트가 그 계약을 고정한다.
 */
const DESIGN_ROUNDS = [
  { name: 'design-r01-needs-fix.json', body: '{"design":"r01","kind":"needs-fix"}' },
  { name: 'design-r02-approved.json', body: '{"design":"r02","kind":"approved"}' },
]
const PHASES = ['p1', 'p2']
const phaseArchive = (pid: string): { name: string; body: string } => ({
  name: `${pid}-r01-approved.json`,
  body: JSON.stringify({ phase: pid, round: 'r01', approved: true }),
})

/** dev-complete(= pass) 로 판정될 **완전한** 티켓 하나를 커밋한다. */
function commitCompleteTicket(repo: string, id: string, ticketRoot = 'workflow'): void {
  const ticketRel = ticketRoot === '' ? id : `${ticketRoot}/${id}`
  const dir = ticketRoot === '' ? join(repo, id) : join(repo, ticketRoot, id)
  mkdirSync(join(dir, 'responses'), { recursive: true })
  writeFileSync(join(dir, 'state.json'), JSON.stringify({ id, review_series_model_version: 1, phases: [], evidence_durability_required: true }))

  for (const r of DESIGN_ROUNDS) writeFileSync(join(dir, 'responses', r.name), r.body)
  const approved = DESIGN_ROUNDS[DESIGN_ROUNDS.length - 1] as { name: string; body: string }
  const inventory = DESIGN_ROUNDS.map((r) => ({ response_path: `${ticketRel}/responses/${r.name}`, sha256: sha256(r.body) }))
  let manifest = serializeManifestLine(
    buildManifestEntry(
      { review_kind: 'design', phase_id: null, response_path: `${ticketRel}/responses/${approved.name}`, response_sha256: sha256(approved.body), review_base_sha: OID, design_hash: DESIGN, approved_at: ISO } as never,
      { consumedAt: ISO, consumedByCommitSha: OID, userCommitConfirmed: null, archiveInventory: inventory },
    ),
  )
  for (const pid of PHASES) {
    const a = phaseArchive(pid)
    writeFileSync(join(dir, 'responses', a.name), a.body)
    manifest += serializeManifestLine(
      buildManifestEntry(
        { review_kind: 'phase', phase_id: pid, response_path: `${ticketRel}/responses/${a.name}`, response_sha256: sha256(a.body), review_base_sha: OID, approved_tree: OID, phase_design_ref: DESIGN, approved_at: ISO } as never,
        { consumedAt: ISO, consumedByCommitSha: OID, userCommitConfirmed: null },
      ),
    )
  }
  writeFileSync(join(dir, 'responses', 'approvals.jsonl'), manifest)
  writeFileSync(
    join(dir, 'responses', 'ticket-close.jsonl'),
    serializeCloseProofRow({ ticket_id: id, event: 'dev-complete', series_id: null, resolution: null, phase_inventory: [...PHASES].sort(), design_ref: DESIGN, at: ISO, reconstructed: false, evidence_basis: null } as CloseProofRow),
  )
  g(repo, ['add', '-A'])
  g(repo, ['commit', '-qm', `ticket ${id}`])
}

function mkRepo(ticketCount: number, ticketRoot = 'workflow'): string {
  const repo = mkdtempSync(join(tmpdir(), 'cg-intake-cost-'))
  g(repo, ['init', '-q'])
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'x', version: '0.0.0' }))
  g(repo, ['add', '-A'])
  g(repo, ['commit', '-qm', 'seed'])
  g(repo, ['branch', '-M', 'main'])
  for (let i = 1; i <= ticketCount; i++) commitCompleteTicket(repo, `REQ-2026-${String(i).padStart(3, '0')}`, ticketRoot)
  return repo
}

/** durable 인데 증거가 없는 티켓(= developing → block). */
function commitDevelopingTicket(repo: string, id: string, ticketRoot = 'workflow'): void {
  const dir = ticketRoot === '' ? join(repo, id) : join(repo, ticketRoot, id)
  mkdirSync(join(dir, 'responses'), { recursive: true })
  writeFileSync(join(dir, 'state.json'), JSON.stringify({ id, review_series_model_version: 1, phases: [], evidence_durability_required: true }))
  writeFileSync(join(dir, 'responses', '.keep'), '')
  g(repo, ['add', '-A'])
  g(repo, ['commit', '-qm', `developing ${id}`])
}

/** 계수 구간을 명확히 한다 — 픽스처 생성의 git 호출은 세지 않는다. */
function countGitSpawnsDuring<T>(fn: () => T): { result: T; count: number; calls: string[][] } {
  gitSpawns.length = 0
  const result = fn()
  return { result, count: gitSpawns.length, calls: [...gitSpawns] }
}

beforeEach(() => {
  gitSpawns.length = 0
})

describe('[REQ-2026-169 DEC-7-2] scanIntake 는 티켓 수와 무관하게 git 프로세스 2개만 쓴다', () => {
  it('🔴 계수 장치 자체가 살아 있다(감싼 통로가 실제로 관측된다)', () => {
    const repo = mkRepo(1)
    try {
      // 실물 포트가 쓰는 통로(execFileSync)와 배치가 쓰는 통로(cross-spawn)를 각각 태운다.
      const { count: c1 } = countGitSpawnsDuring(() => g(repo, ['rev-parse', 'HEAD']))
      expect(c1).toBe(1)
      const { count: c2 } = countGitSpawnsDuring(() => listHeadTreeEntries(repo, 'workflow'))
      expect(c2).toBe(1)
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  it('🔴 티켓 2개 → 정확히 2회 (열거 1 + 배치 읽기 1)', () => {
    const repo = mkRepo(2)
    try {
      const { result, count, calls } = countGitSpawnsDuring(() => scanIntake(repo, 'workflow'))
      // 스캔이 실제로 판정을 했는지 함께 본다 — 아무것도 안 하고 2회면 그것도 공허하다.
      expect(result.tickets.map((t) => t.baseState)).toEqual(['dev-complete', 'dev-complete'])
      expect(result.blocked).toEqual([])
      expect(count).toBe(2)
      expect(calls.map((c) => c[1])).toEqual(['ls-tree', 'cat-file'])
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  it('🔴 티켓 5개로 늘려도 **여전히 2회** (티켓 수에 비례하지 않는다)', () => {
    const repo = mkRepo(5)
    try {
      const { result, count } = countGitSpawnsDuring(() => scanIntake(repo, 'workflow'))
      expect(result.tickets).toHaveLength(5)
      expect(result.tickets.every((t) => t.baseState === 'dev-complete')).toBe(true)
      expect(count).toBe(2)
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  it('🔴 excludeTicketId 를 써도 2회 (제외는 열거 이후의 순수 필터다)', () => {
    const repo = mkRepo(3)
    try {
      const { result, count } = countGitSpawnsDuring(() => scanIntake(repo, 'workflow', 'REQ-2026-002'))
      expect(result.tickets.map((t) => t.ticketId)).toEqual(['REQ-2026-001', 'REQ-2026-003'])
      expect(count).toBe(2)
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  it('티켓이 하나도 없으면 열거 1회 + 배치 0회(요청 없음) = 1회', () => {
    const repo = mkRepo(0)
    try {
      const { result, count } = countGitSpawnsDuring(() => scanIntake(repo, 'workflow'))
      expect(result.tickets).toEqual([])
      expect(count).toBe(1)
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })
})

describe('[REQ-2026-169 DEC-8] 재귀 열거에서 파생한 티켓 목록 == 기존 `ls-tree -d` 목록', () => {
  it('🔴 동등성을 산문이 아니라 실 git 으로 고정한다', () => {
    const repo = mkRepo(4)
    try {
      const fromRecursive = ticketIdsFromEntries(listHeadTreeEntries(repo, 'workflow'), 'workflow')
      const fromDirListing = listHeadTicketIds('workflow', (a) => g(repo, a))
      expect(fromRecursive).toEqual(fromDirListing)
      expect(fromRecursive).toEqual(['REQ-2026-001', 'REQ-2026-002', 'REQ-2026-003', 'REQ-2026-004'])
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  it('ticketRoot 가 HEAD 에 없으면 양쪽 다 빈 목록', () => {
    const repo = mkRepo(0)
    try {
      expect(ticketIdsFromEntries(listHeadTreeEntries(repo, 'workflow'), 'workflow')).toEqual([])
      expect(listHeadTicketIds('workflow', (a) => g(repo, a))).toEqual([])
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })
})

describe('[REQ-2026-169 phase-2 r01 P1] ticketRoot 가 저장소 루트일 때(`ticketRoot: "."`)', () => {
  /**
   * 🔴 이 조합은 **두 결함이 겹쳐 있던 자리**다.
   *   1. 옛 열거는 pathspec 을 `'/'` 로 만들어 exit 128 → `catch → []` 로 **게이트가 조용히 꺼져** 있었다.
   *   2. 그것을 고치자 이번엔 경로 결합이 `'/REQ-…'`(선행 슬래시)가 되어 배치 뷰에 하나도 적중하지 않았다.
   * 그래서 "열거된다"가 아니라 **"판정이 맞다"** 를 단정한다.
   */
  it('🔴 committed durable 티켓을 실제로 판정한다(뷰 적중 — 증거가 부재로 읽히지 않는다)', () => {
    const repo = mkRepo(2, '')
    try {
      const res = scanIntake(repo, '')
      expect(res.tickets.map((t) => t.ticketId)).toEqual(['REQ-2026-001', 'REQ-2026-002'])
      expect(res.tickets.map((t) => t.ticketRel)).toEqual(['REQ-2026-001', 'REQ-2026-002']) // 선행 슬래시 없음
      // 🔴 핵심: legacy(=증거 못 읽음)도 corrupt 도 아니고 **dev-complete** 여야 한다.
      expect(res.tickets.map((t) => t.baseState)).toEqual(['dev-complete', 'dev-complete'])
      expect(res.blocked).toEqual([])
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  it('🔴 root-level 미종결 티켓을 **차단**한다(게이트가 꺼져 있지 않다)', () => {
    const repo = mkRepo(0, '')
    try {
      commitDevelopingTicket(repo, 'REQ-2026-001', '')
      const res = scanIntake(repo, '')
      expect(res.blocked.map((t) => t.ticketId)).toEqual(['REQ-2026-001'])
      expect(res.blocked[0]?.baseState).toBe('developing')
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  it("`ticketRoot: '.'` 표기도 같은 판정(정규화)", () => {
    const repo = mkRepo(1, '')
    try {
      expect(scanIntake(repo, '.').tickets.map((t) => t.baseState)).toEqual(['dev-complete'])
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  it('repo-root 에서도 git 프로세스는 2회', () => {
    const repo = mkRepo(3, '')
    try {
      const { count } = countGitSpawnsDuring(() => scanIntake(repo, ''))
      expect(count).toBe(2)
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })
})
