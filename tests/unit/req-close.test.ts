/**
 * REQ-2026-053 phase-2 — req:close --migrate 실 git 테스트 (DEC-M).
 *
 * 🔴 HEAD-committed 증거 + integrated(본선 조상)만 근거 · dry-run 기본·--run write · 재실행 no-op ·
 *    close-proof clean 가드 · mainline override 없음. 종결 후 intake가 그 티켓을 'pass'로 본다.
 */
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main as closeMain, parseArgs, resolveMainline } from '../../scripts/req/req-close'
import { scanTicketIntake } from '../../scripts/req/lib/intake'
import { buildManifestEntry, serializeManifestLine } from '../../scripts/req/lib/evidence'
import { parseCloseProof } from '../../scripts/req/lib/close-proof'

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
