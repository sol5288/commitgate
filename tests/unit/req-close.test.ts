/**
 * REQ-2026-053 phase-2 — req:close --migrate 실 git 테스트 (DEC-M).
 *
 * 🔴 HEAD-committed 증거 + integrated(본선 조상)만 근거 · dry-run 기본·--run write · 재실행 no-op ·
 *    close-proof clean 가드 · mainline override 없음. 종결 후 intake가 그 티켓을 'pass'로 본다.
 */
import { describe, it, expect, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main as closeMain, parseArgs, resolveMainline } from '../../scripts/req/req-close'
import { scanTicketIntake } from '../../scripts/req/lib/intake'
import { buildManifestEntry, serializeManifestLine } from '../../scripts/req/lib/evidence'
import { parseCloseProof } from '../../scripts/req/lib/close-proof'
import {
  commitStaleTicket,
  mkRepo as mkRepo072,
  headBlob as headBlob072,
  commitCount as commitCount072,
  D_OLD,
  D_NEW,
  type StaleTicketSpec,
} from './fixtures/stale-devcomplete'

/**
 * REQ-2026-062: 픽스처 repo는 **"setup을 마친 프로젝트"**를 나타낸다.
 * 이 마커가 없으면 setup 게이트가 먼저 막아 이 파일이 검증하려는 다른 단언에 도달하지 못한다.
 * (실제 `commitgate init` 설치본은 grandfather 신호를 4개 갖지만, 이 픽스처들은 최소 repo다.)
 */
const SETUP_OK = { setup: { completedVersion: '0.0.0-test', completedAt: '2026-01-01T00:00:00Z' } }


const g = (repo: string, args: string[]): string =>
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: repo, encoding: 'utf8' }).replace(/\s+$/, '')
const OID = 'b'.repeat(40)
const ISO = '2026-07-24T00:00:00.000Z'
const sha256 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex')
const D1 = 'e'.repeat(64)

const designArchiveContent = JSON.stringify({ design: 'r01', kind: 'approved' })
const designRow = (ticketRel: string, designHash: string): string =>
  serializeManifestLine(
    buildManifestEntry(
      { review_kind: 'design', phase_id: null, response_path: `${ticketRel}/responses/design-r01-approved.json`, response_sha256: sha256(designArchiveContent), review_base_sha: OID, design_hash: designHash, approved_at: ISO } as never,
      { consumedAt: ISO, consumedByCommitSha: OID, userCommitConfirmed: null, archiveInventory: [{ response_path: `${ticketRel}/responses/design-r01-approved.json`, sha256: sha256(designArchiveContent) }] },
    ),
  )
const phaseArchiveContent = (pid: string): string => JSON.stringify({ phase: pid, round: 'r01', approved: true })
const phaseRow = (ticketRel: string, pid: string, ref: string | null): string =>
  serializeManifestLine(
    buildManifestEntry(
      { review_kind: 'phase', phase_id: pid, response_path: `${ticketRel}/responses/${pid}-r01-approved.json`, response_sha256: sha256(phaseArchiveContent(pid)), review_base_sha: OID, approved_tree: OID, ...(ref === null ? {} : { phase_design_ref: ref }), approved_at: ISO } as never,
      { consumedAt: ISO, consumedByCommitSha: OID, userCommitConfirmed: null },
    ),
  )

/** developing durable 티켓: 완전한 design evidence + (기본 unbound) phase evidence + close-proof 없음.
 *  `plannedPhases` 지정 시 커밋된 state.json.phases에 계획을 심는다(r02 P1 부분완료 테스트용). */
const commitDevelopingTicket = (repo: string, id: string, phases: Array<{ pid: string; ref: string | null }>, plannedPhases?: string[]): string => {
  const ticketRel = `workflow/${id}`
  const dir = join(repo, ticketRel)
  mkdirSync(join(dir, 'responses'), { recursive: true })
  const committedPhases = (plannedPhases ?? []).map((pid) => ({ id: pid, approved: true }))
  writeFileSync(join(dir, 'state.json'), JSON.stringify({ id, phase: 'INTAKE', review_series_model_version: 1, phases: committedPhases, evidence_durability_required: true }))
  writeFileSync(join(dir, 'responses', 'design-r01-approved.json'), designArchiveContent)
  let manifest = designRow(ticketRel, D1)
  for (const ph of phases) {
    writeFileSync(join(dir, 'responses', `${ph.pid}-r01-approved.json`), phaseArchiveContent(ph.pid))
    manifest += phaseRow(ticketRel, ph.pid, ph.ref)
  }
  writeFileSync(join(dir, 'responses', 'approvals.jsonl'), manifest)
  g(repo, ['add', '-A'])
  g(repo, ['commit', '-qm', `ticket ${id}`])
  return ticketRel
}

const mkRepo = (): string => {
  const repo = mkdtempSync(join(tmpdir(), 'req053-close-'))
  g(repo, ['init', '-q']); g(repo, ['config', 'user.email', 't@t.t']); g(repo, ['config', 'user.name', 't'])
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'x', version: '0.0.0' }))
  writeFileSync(join(repo, 'req.config.json'), JSON.stringify({ ...SETUP_OK, packageManager: 'npm' }))
  g(repo, ['add', '-A']); g(repo, ['commit', '-qm', 'seed']); g(repo, ['branch', '-M', 'main'])
  return repo
}
const commitCount = (repo: string): number => Number(g(repo, ['rev-list', '--count', 'HEAD']))
const headBlob = (repo: string, rel: string): string | null => { try { return g(repo, ['show', `HEAD:${rel}`]) } catch { return null } }

describe('[REQ-2026-053 phase-2] req:close --migrate (실 git)', () => {
  it('⑮ 적격 developing 티켓 종결 → migrated-complete 커밋 → intake가 pass', () => {
    const repo = mkRepo()
    const t = commitDevelopingTicket(repo, 'REQ-2026-001', [{ pid: 'p1', ref: null }, { pid: 'p2', ref: null }])
    // 종결 전: developing/block
    expect(scanTicketIntake(repo, t, 'REQ-2026-001').verdict).toBe('block')
    closeMain(['2026-001', '--migrate', '--run', '--root', repo])
    const cp = headBlob(repo, `${t}/responses/ticket-close.jsonl`)
    expect(cp).not.toBeNull()
    const rows = parseCloseProof(cp as string).rows
    expect(rows.length).toBe(1)
    expect(rows[0]!.event).toBe('migrated-complete')
    expect(rows[0]!.reconstructed).toBe(true)
    expect(rows[0]!.phase_inventory).toEqual(['p1', 'p2'])
    expect(rows[0]!.design_ref).toBe(D1)
    expect((rows[0]!.evidence_basis ?? []).length).toBeGreaterThan(0)
    // 종결 후: migrated-complete/pass
    const after = scanTicketIntake(repo, t, 'REQ-2026-001')
    expect(after.baseState).toBe('migrated-complete')
    expect(after.verdict).toBe('pass')
  })

  it('⑯ dry-run(--run 없음) → 파일·커밋 무변경', () => {
    const repo = mkRepo()
    const t = commitDevelopingTicket(repo, 'REQ-2026-001', [{ pid: 'p1', ref: null }])
    const before = commitCount(repo)
    closeMain(['2026-001', '--migrate', '--root', repo]) // no --run
    expect(headBlob(repo, `${t}/responses/ticket-close.jsonl`)).toBeNull()
    expect(commitCount(repo)).toBe(before)
  })

  it('⑰ 재실행 no-op: 2회 --run → 커밋 1개(2번째 no-op, 기존 at 보존)', () => {
    const repo = mkRepo()
    const t = commitDevelopingTicket(repo, 'REQ-2026-001', [{ pid: 'p1', ref: null }])
    const before = commitCount(repo)
    closeMain(['2026-001', '--migrate', '--run', '--root', repo])
    const afterFirst = commitCount(repo)
    const firstAt = parseCloseProof(headBlob(repo, `${t}/responses/ticket-close.jsonl`) as string).rows[0]!.at
    closeMain(['2026-001', '--migrate', '--run', '--root', repo]) // 재실행 → no-op
    expect(commitCount(repo)).toBe(afterFirst) // 커밋 증가 없음
    expect(afterFirst).toBe(before + 1) // 첫 실행만 1커밋
    const secondAt = parseCloseProof(headBlob(repo, `${t}/responses/ticket-close.jsonl`) as string).rows[0]!.at
    expect(secondAt).toBe(firstAt) // 기존 at 보존(재작성 아님)
  })

  it('⑱ close-proof 경로 dirty → clean 가드 fail-closed(write 0)', () => {
    const repo = mkRepo()
    const t = commitDevelopingTicket(repo, 'REQ-2026-001', [{ pid: 'p1', ref: null }])
    const before = commitCount(repo)
    // 미커밋 close-proof 파일 생성(HEAD엔 없음).
    writeFileSync(join(repo, t, 'responses', 'ticket-close.jsonl'), '{"uncommitted":true}\n')
    expect(() => closeMain(['2026-001', '--migrate', '--run', '--root', repo])).toThrow(/미커밋 변경/)
    expect(commitCount(repo)).toBe(before) // 커밋 0
  })

  it('⑱b 미병합(mainline 조상 아님) 티켓 → 거부(integrated=false)', () => {
    const repo = mkRepo()
    // 티켓을 feature 브랜치에서만 커밋(main에 없음 → mainline 조상 아님).
    g(repo, ['checkout', '-q', '-b', 'feat/x'])
    const t = commitDevelopingTicket(repo, 'REQ-2026-002', [{ pid: 'p1', ref: null }])
    const before = commitCount(repo)
    expect(() => closeMain(['2026-002', '--migrate', '--run', '--root', repo])).toThrow(/본선.*병합되지 않음/)
    expect(commitCount(repo)).toBe(before)
    void t
  })

  it('⑱c mainline override 없음: --mainline 인자 거부(임의 ref로 integrated 우회 불가)', () => {
    expect(() => parseArgs(['2026-001', '--migrate', '--mainline', 'HEAD'])).toThrow(/알 수 없는 옵션: --mainline/)
  })

  it('⑱c resolveMainline: 신뢰된 ref만 해소(로컬 main 존재)', () => {
    const repo = mkRepo()
    const gitFn = (a: string[]): string => g(repo, a)
    expect(resolveMainline(gitFn)).toBe('main') // origin 없음 → 로컬 main
  })

  it('⑱d (r02 P1) 커밋된 계획에 미증거 phase(부분 완료) → 거부 (integrated여도)', () => {
    const repo = mkRepo()
    // 커밋된 state.phases=[p1,p2]이지만 phase 증거는 p1만 → 진행 중/중단 → 거부(integrated=true여도).
    const t = commitDevelopingTicket(repo, 'REQ-2026-004', [{ pid: 'p1', ref: null }], ['p1', 'p2'])
    const before = commitCount(repo)
    expect(() => closeMain(['2026-004', '--migrate', '--run', '--root', repo])).toThrow(/부분 완료/)
    expect(commitCount(repo)).toBe(before)
    void t
  })

  it('정상 dev-complete 가능(phase가 현재 design에 결속) → 거부(finalize 안내)', () => {
    const repo = mkRepo()
    // phase가 현재 design_ref(D1)에 결속 → 정상 dev-complete 가능 → 마이그레이션 거부.
    const t = commitDevelopingTicket(repo, 'REQ-2026-003', [{ pid: 'p1', ref: D1 }])
    expect(() => closeMain(['2026-003', '--migrate', '--run', '--root', repo])).toThrow(/req:commit --finalize/)
    void t
  })
})

/**
 * REQ-2026-072 — 낡은 `dev-complete`로 갇힌 티켓(소비자 버그리포트 REQ-2026-088의 상태).
 * 🔴 이 describe가 고정하는 것은 **"거짓 no-op이 사라졌다"**와 **"적용 가능한 경로만 안내한다"**이다.
 */
describe('[REQ-2026-072] 낡은 dev-complete — 술어 일치·재결속 안내 (실 git)', () => {
  const staleSpec = (overrides: Partial<StaleTicketSpec> = {}): StaleTicketSpec => ({
    ticketId: 'REQ-2026-088',
    oldPhases: [{ pid: 'phase-0', ref: D_OLD }, { pid: 'phase-1', ref: D_OLD }],
    newPhases: ['phase-3'],
    staleDevComplete: true,
    ...overrides,
  })

  it('A1 낡은 dev-complete 티켓은 intake가 여전히 차단한다(developing) — 전제 확인', () => {
    const repo = mkRepo072()
    const t = commitStaleTicket(repo, staleSpec())
    const scan = scanTicketIntake(repo, t, 'REQ-2026-088')
    expect(scan.baseState).toBe('developing')
    expect(scan.verdict).toBe('block')
  })

  it('🔴 A2 `--migrate`가 "이미 종결" no-op이 아니라 `req:rebind`를 안내하며 거부한다(write 0)', () => {
    const repo = mkRepo072()
    const t = commitStaleTicket(repo, staleSpec())
    const before = commitCount072(repo)
    let message = ''
    try {
      closeMain(['2026-088', '--migrate', '--run', '--root', repo])
      throw new Error('거부되지 않았다')
    } catch (err) {
      message = err instanceof Error ? err.message : String(err)
    }
    expect(message).toContain('재결속 가능')
    expect(message).toContain('req:rebind REQ-2026-088 --phase phase-0')
    expect(message).toContain('--confirm "rebind REQ-2026-088 phase-0"')
    // 🔴 거부는 write 0 — close proof에 새 행이 붙지 않는다(기존 낡은 행만 그대로).
    expect(commitCount072(repo)).toBe(before)
    expect(parseCloseProof(headBlob072(repo, `${t}/responses/ticket-close.jsonl`) as string).rows).toHaveLength(1)
  })

  it('A3 재결속 불가(phase_design_ref 부재)가 섞이면 마이그레이션으로 종결된다 — 교착이 열린다', () => {
    const repo = mkRepo072()
    const t = commitStaleTicket(repo, staleSpec({ oldPhases: [{ pid: 'phase-0', ref: D_OLD }, { pid: 'phase-1', ref: null }] }))
    closeMain(['2026-088', '--migrate', '--run', '--root', repo])
    const rows = parseCloseProof(headBlob072(repo, `${t}/responses/ticket-close.jsonl`) as string).rows
    // 낡은 dev-complete는 보존되고(append-only) migrated-complete가 더해진다.
    expect(rows.map((r) => r.event)).toEqual(['dev-complete', 'migrated-complete'])
    const migrated = rows[1]!
    expect(migrated.reconstructed).toBe(true)
    expect(migrated.phase_inventory).toEqual(['phase-0', 'phase-1', 'phase-3'])
    expect(migrated.design_ref).toBe(D_NEW)
    // 종결됐으므로 intake가 통과시킨다.
    const after = scanTicketIntake(repo, t, 'REQ-2026-088')
    expect(after.baseState).toBe('migrated-complete')
    expect(after.verdict).toBe('pass')
  })

  it('dev-complete가 한 번도 발행되지 않은 티켓도 재결속 가능하면 마이그레이션하지 않는다(REQ-2026-087 유형)', () => {
    const repo = mkRepo072()
    commitStaleTicket(repo, staleSpec({ ticketId: 'REQ-2026-087', staleDevComplete: false }))
    expect(() => closeMain(['2026-087', '--migrate', '--run', '--root', repo])).toThrow(/req:rebind/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// REQ-2026-093 — req:close --abandon (실 git)
//
// 이 명령의 존재 이유: 완료할 수 없는 durable 티켓 **하나**가 `req:new` intake를 통해 저장소의 모든
// 후속 작업을 막는데, 지금까지 그 상태에서 빠져나오는 길이 **완료뿐**이었다.
// 따라서 진짜 오라클은 "행이 써졌는가"가 아니라 **"그 뒤 req:new가 통과하는가"** 다.
// ─────────────────────────────────────────────────────────────────────────────
describe('[REQ-2026-093] req:close --abandon (실 git)', () => {
  const R = '--reason'
  const C = '--confirm'
  const ARGS = [R, '요구가 철회됨', C, 'PM 승인(대화)']

  /** (a) 리뷰 이력이 전혀 없는 durable 티켓 — responses/ 자체가 없다. */
  const commitBareTicket = (repo: string, id: string): string => {
    const ticketRel = `workflow/${id}`
    mkdirSync(join(repo, ticketRel), { recursive: true })
    writeFileSync(
      join(repo, ticketRel, 'state.json'),
      JSON.stringify({ id, phase: 'INTAKE', review_series_model_version: 1, phases: [], evidence_durability_required: true }),
    )
    g(repo, ['add', '-A'])
    g(repo, ['commit', '-qm', `bare ${id}`])
    return ticketRel
  }

  /** (c) 설계 승인만 있고 phase 0개. */
  const commitDesignOnlyTicket = (repo: string, id: string): string => commitDevelopingTicket(repo, id, [])

  const abandonedRows = (repo: string, t: string): ReturnType<typeof parseCloseProof>['rows'] => {
    const cp = headBlob(repo, `${t}/responses/ticket-close.jsonl`)
    return cp === null ? [] : parseCloseProof(cp).rows
  }

  it('🔴 (a) 리뷰 이력 없는 티켓 — 포기 후 intake가 통과한다', () => {
    const repo = mkRepo()
    const t = commitBareTicket(repo, 'REQ-2026-101')
    expect(scanTicketIntake(repo, t, 'REQ-2026-101').verdict).toBe('block')
    closeMain(['2026-101', '--abandon', ...ARGS, '--run', '--root', repo])
    const after = scanTicketIntake(repo, t, 'REQ-2026-101')
    expect(after.baseState).toBe('abandoned')
    expect(after.verdict).toBe('pass')
    expect(after.reason).toContain('포기')
  })

  it('🔴 (b) 모든 phase 승인·일부만 커밋된 티켓(소비자 사례) — 포기 후 intake가 통과한다', () => {
    const repo = mkRepo()
    const t = commitDevelopingTicket(repo, 'REQ-2026-102', [{ pid: 'p1', ref: D1 }, { pid: 'p2', ref: D1 }])
    expect(scanTicketIntake(repo, t, 'REQ-2026-102').verdict).toBe('block')
    closeMain(['2026-102', '--abandon', ...ARGS, '--run', '--root', repo])
    expect(scanTicketIntake(repo, t, 'REQ-2026-102').verdict).toBe('pass')
  })

  it('🔴 (c) 설계 승인만 있고 phase 0개 — 포기 후 intake가 통과한다', () => {
    const repo = mkRepo()
    const t = commitDesignOnlyTicket(repo, 'REQ-2026-103')
    expect(scanTicketIntake(repo, t, 'REQ-2026-103').verdict).toBe('block')
    closeMain(['2026-103', '--abandon', ...ARGS, '--run', '--root', repo])
    expect(scanTicketIntake(repo, t, 'REQ-2026-103').verdict).toBe('pass')
  })

  it('행의 내용 — 사유·승인 문장이 그대로 남고 시각은 도구가 찍는다(원본 행)', () => {
    const repo = mkRepo()
    const t = commitBareTicket(repo, 'REQ-2026-104')
    closeMain(['2026-104', '--abandon', R, '설계 전제가 무너짐', C, 'PM 승인 2026-08-01', '--run', '--root', repo])
    const rows = abandonedRows(repo, t)
    expect(rows.length).toBe(1)
    expect(rows[0]!.event).toBe('abandoned')
    expect(rows[0]!.abandon_reason).toBe('설계 전제가 무너짐')
    expect(rows[0]!.method).toBe('PM 승인 2026-08-01')
    expect(rows[0]!.reconstructed).toBe(false)
    expect(rows[0]!.phase_inventory).toBeNull()
    // 시각은 주입이 아니라 실시계 — 형식만 고정한다(값 고정은 tautology).
    expect(rows[0]!.at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  })

  it('🔴 증거를 건드리지 않는다(DEC-5) — 매니페스트·아카이브 blob 불변 + 커밋 diff가 close-proof 한 경로뿐', () => {
    const repo = mkRepo()
    const t = commitDevelopingTicket(repo, 'REQ-2026-105', [{ pid: 'p1', ref: D1 }])
    const manifestBefore = headBlob(repo, `${t}/responses/approvals.jsonl`)
    const archiveBefore = headBlob(repo, `${t}/responses/p1-r01-approved.json`)
    closeMain(['2026-105', '--abandon', ...ARGS, '--run', '--root', repo])
    expect(headBlob(repo, `${t}/responses/approvals.jsonl`)).toBe(manifestBefore)
    expect(headBlob(repo, `${t}/responses/p1-r01-approved.json`)).toBe(archiveBefore)
    // 포기 커밋이 만진 경로가 정확히 하나여야 한다.
    const touched = g(repo, ['show', '--name-only', '--format=', 'HEAD']).split('\n').map((s) => s.trim()).filter(Boolean)
    expect(touched).toEqual([`${t}/responses/ticket-close.jsonl`])
  })

  it('기본 dry-run — --run 없으면 커밋도 파일도 생기지 않는다', () => {
    const repo = mkRepo()
    const t = commitBareTicket(repo, 'REQ-2026-106')
    const before = commitCount(repo)
    closeMain(['2026-106', '--abandon', ...ARGS, '--root', repo])
    expect(commitCount(repo)).toBe(before)
    expect(existsSync(join(repo, t, 'responses', 'ticket-close.jsonl'))).toBe(false)
    expect(scanTicketIntake(repo, t, 'REQ-2026-106').verdict).toBe('block')
  })

  it('🔴 커밋된 phase가 있으면 경고를 내고, 없으면 내지 않는다(대조군 — 항상 뜨는 문구는 안 읽힌다)', () => {
    const repo = mkRepo()
    const withPhases = commitDevelopingTicket(repo, 'REQ-2026-107', [{ pid: 'p1', ref: D1 }])
    void withPhases
    const bare = commitBareTicket(repo, 'REQ-2026-108')
    void bare
    const logs: string[] = []
    const spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void logs.push(a.join(' ')))
    try {
      closeMain(['2026-107', '--abandon', ...ARGS, '--root', repo])
      const withText = logs.join('\n')
      expect(withText).toContain('이미 커밋된 phase가 1개')
      expect(withText).toContain('지워지지 않고')
      logs.length = 0
      closeMain(['2026-108', '--abandon', ...ARGS, '--root', repo])
      expect(logs.join('\n')).not.toContain('이미 커밋된 phase가')
    } finally {
      spy.mockRestore()
    }
  })

  it('멱등 — 두 번 실행해도 행 1개, 두 번째는 성공 종료', () => {
    const repo = mkRepo()
    const t = commitBareTicket(repo, 'REQ-2026-109')
    closeMain(['2026-109', '--abandon', ...ARGS, '--run', '--root', repo])
    const after1 = commitCount(repo)
    closeMain(['2026-109', '--abandon', ...ARGS, '--run', '--root', repo]) // 재실행
    expect(commitCount(repo)).toBe(after1)
    expect(abandonedRows(repo, t).length).toBe(1)
  })

  it('이미 종결된 티켓(migrated-complete)에는 no-op — 포기 행을 덧붙이지 않는다', () => {
    const repo = mkRepo()
    const t = commitDevelopingTicket(repo, 'REQ-2026-110', [{ pid: 'p1', ref: null }, { pid: 'p2', ref: null }])
    closeMain(['2026-110', '--migrate', '--run', '--root', repo])
    const before = commitCount(repo)
    closeMain(['2026-110', '--abandon', ...ARGS, '--run', '--root', repo])
    expect(commitCount(repo)).toBe(before)
    const rows = abandonedRows(repo, t)
    expect(rows.map((r) => r.event)).toEqual(['migrated-complete'])
  })

  it('🔴 fail-closed 인자 — 사유·승인 문장 부재/공백, 모드 충돌, 모드 부재는 전부 거부하고 아무것도 쓰지 않는다', () => {
    const repo = mkRepo()
    const t = commitBareTicket(repo, 'REQ-2026-111')
    const before = commitCount(repo)
    expect(() => closeMain(['2026-111', '--abandon', C, 'ok', '--run', '--root', repo])).toThrow(/--reason/)
    expect(() => closeMain(['2026-111', '--abandon', R, 'ok', '--run', '--root', repo])).toThrow(/--confirm/)
    expect(() => closeMain(['2026-111', '--abandon', R, '   ', C, 'ok', '--run', '--root', repo])).toThrow(/--reason/)
    expect(() => closeMain(['2026-111', '--abandon', R, 'ok', C, '  ', '--run', '--root', repo])).toThrow(/--confirm/)
    expect(() => closeMain(['2026-111', '--abandon', '--migrate', ...ARGS, '--run', '--root', repo])).toThrow(/함께 쓸 수 없습니다/)
    expect(() => closeMain(['2026-111', '--run', '--root', repo])).toThrow(/모드가 필요합니다/)
    expect(commitCount(repo)).toBe(before)
    expect(existsSync(join(repo, t, 'responses', 'ticket-close.jsonl'))).toBe(false)
  })

  /**
   * REQ-2026-102 — 거부는 그대로지만 **사유가 바뀌었다**.
   *
   * 🔴 이전 문구는 "legacy는 intake를 막지 않으므로 **탈출구가 필요 없습니다**"였다.
   *    REQ-2026-097이 "종결"에 새 효용(doctor 브랜치 축 D2/D3/D11 면제)을 붙이면서 그 결론이
   *    거짓이 됐다 — 끝난 legacy 티켓은 이제 종결 표시가 **필요한데 경로가 없다.**
   *    낡은 문장을 그대로 두면 사용자가 "legacy엔 아무 문제 없다"로 읽는다.
   */
  it('legacy 티켓은 대상이 아니다 — 거부 사유가 남은 갭을 사실대로 알린다', () => {
    const repo = mkRepo()
    const ticketRel = 'workflow/REQ-2026-112'
    mkdirSync(join(repo, ticketRel), { recursive: true })
    writeFileSync(join(repo, ticketRel, 'state.json'), JSON.stringify({ id: 'REQ-2026-112', phase: 'INTAKE' })) // durability 마커 없음
    g(repo, ['add', '-A']); g(repo, ['commit', '-qm', 'legacy'])

    let msg = ''
    try {
      closeMain(['2026-112', '--abandon', ...ARGS, '--run', '--root', repo])
    } catch (e) {
      msg = e instanceof Error ? e.message : String(e)
    }
    expect(msg).toMatch(/legacy/)
    expect(msg).toContain('req:new intake를 막지 않습니다')          // 참인 부분은 유지
    expect(msg).toContain('종결로 표시할 경로는 없습니다')            // 남은 갭을 사실대로
    expect(msg).not.toContain('탈출구가 필요 없습니다')               // 🔴 REQ-097 이후 거짓이 된 결론
  })

  it('close-proof에 미커밋 변경이 있으면 거부(HEAD 기반 쓰기가 덮지 않게)', () => {
    const repo = mkRepo()
    const t = commitBareTicket(repo, 'REQ-2026-113')
    mkdirSync(join(repo, t, 'responses'), { recursive: true })
    writeFileSync(join(repo, t, 'responses', 'ticket-close.jsonl'), '{"x":1}\n')
    expect(() => closeMain(['2026-113', '--abandon', ...ARGS, '--run', '--root', repo])).toThrow(/미커밋 변경/)
  })

  it('parseArgs — 값이 `-`로 시작해도 삼키지 않고, 값 부재는 즉시 거부', () => {
    expect(parseArgs(['2026-1', '--abandon', '--reason', '-이유', '--confirm', '-승인'])).toMatchObject({
      abandon: true, reason: '-이유', confirm: '-승인',
    })
    expect(() => parseArgs(['2026-1', '--abandon', '--reason'])).toThrow(/--reason 값이 필요/)
    expect(() => parseArgs(['2026-1', '--abandon', '--confirm'])).toThrow(/--confirm 값이 필요/)
  })

  it('🔴 parseArgs — 기존 플래그가 그대로 산다(새 분기를 끼워 넣다 `--run`을 떨어뜨린 실수를 고정)', () => {
    // 개발 중 실제로 `--run` 분기를 잃어 `알 수 없는 옵션: --run`이 났다. 기존 migrate 테스트가 잡았지만
    // 파서 자신의 계약으로도 고정해 둔다 — 다음 모드를 더할 때 같은 실수가 조용히 지나가지 않게.
    expect(parseArgs(['2026-1', '--migrate', '--run'])).toMatchObject({ reqId: '2026-1', migrate: true, run: true })
    expect(parseArgs(['2026-1', '--abandon', '--run'])).toMatchObject({ reqId: '2026-1', abandon: true, run: true })
    expect(parseArgs(['2026-1', '--abandon', '--root', '/tmp/x'])).toMatchObject({ abandon: true, root: '/tmp/x' })
  })
})
