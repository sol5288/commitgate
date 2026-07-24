/**
 * REQ-2026-052 phase-4 — req:reconstruct 실 git 테스트 (복원 가능성 매트릭스 DEC-D2).
 *
 * 🔴 HEAD-committed immutable evidence만 · dev-complete 절대 합성 안 함 · series-terminal(replace)은 successor
 *    lineage(parent_series_id)로만 · 손상 티켓 fail-closed · dry-run 기본·--run+--confirm 후 write·자연키 멱등.
 */
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main as reconstructMain, parseArgs, collectSuccessorEvidence } from '../../scripts/req/req-reconstruct'
import { planReconstruction } from '../../scripts/req/lib/reconstruct'
import { scanTicketIntake } from '../../scripts/req/lib/intake'
import { serializeManifestLine, buildManifestEntry } from '../../scripts/req/lib/evidence'
import { serializeCloseProofRow, type CloseProofRow } from '../../scripts/req/lib/close-proof'

const g = (repo: string, args: string[]): string =>
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: repo, encoding: 'utf8' }).replace(/\s+$/, '')
const OID = 'b'.repeat(40)
const ISO = '2026-07-24T00:00:00.000Z'
const sha256 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex')

const mkRepo = (): string => {
  const repo = mkdtempSync(join(tmpdir(), 'req052-recon-'))
  g(repo, ['init', '-q']); g(repo, ['config', 'user.email', 't@t.t']); g(repo, ['config', 'user.name', 't'])
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'x', version: '0.0.0' }))
  writeFileSync(join(repo, 'req.config.json'), JSON.stringify({ packageManager: 'npm' }))
  g(repo, ['add', '-A']); g(repo, ['commit', '-qm', 'seed']); g(repo, ['branch', '-M', 'main'])
  return repo
}

/** 부모 티켓: durability marker + (선택) manifest/close-proof/phase archive. */
const commitTicket = (repo: string, id: string, spec: { marker?: boolean; manifest?: string; close?: string; phaseArchive?: { name: string; content: string } } = {}): void => {
  const dir = join(repo, 'workflow', id)
  mkdirSync(join(dir, 'responses'), { recursive: true })
  const state: Record<string, unknown> = { id, phase: 'INTAKE', review_series_model_version: 1, phases: [] }
  if (spec.marker !== false) state.evidence_durability_required = true
  writeFileSync(join(dir, 'state.json'), JSON.stringify(state))
  if (spec.manifest !== undefined) writeFileSync(join(dir, 'responses', 'approvals.jsonl'), spec.manifest)
  if (spec.close !== undefined) writeFileSync(join(dir, 'responses', 'ticket-close.jsonl'), spec.close)
  if (spec.phaseArchive) writeFileSync(join(dir, 'responses', spec.phaseArchive.name), spec.phaseArchive.content)
  g(repo, ['add', '-A']); g(repo, ['commit', '-qm', `ticket ${id}`])
}

/** successor 티켓: successor_of(parent_series_id 포함/미포함). */
const commitSuccessor = (repo: string, id: string, so: Record<string, unknown>): void => {
  const dir = join(repo, 'workflow', id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'state.json'), JSON.stringify({ id, phase: 'INTAKE', review_series_model_version: 1, phases: [], evidence_durability_required: true, successor_of: so }))
  g(repo, ['add', '-A']); g(repo, ['commit', '-qm', `successor ${id}`])
}

const replaceResolution = { decision: 'replace', method: '사람이 대체 승인함', decided_at: ISO }
const validSuccessorOf = (parentReqId: string, seriesId: string): Record<string, unknown> =>
  ({ req_id: parentReqId, parent_attempts_total: 3, parent_replace_resolution: replaceResolution, recorded_at: ISO, parent_series_id: seriesId })

const phaseRow = (ticketRel: string, pid: string, sha: string): string =>
  serializeManifestLine(buildManifestEntry(
    { review_kind: 'phase', phase_id: pid, response_path: `${ticketRel}/responses/${pid}-r01-approved.json`, response_sha256: sha, review_base_sha: OID, approved_tree: OID, phase_design_ref: 'd'.repeat(64), approved_at: ISO } as never,
    { consumedAt: ISO, consumedByCommitSha: OID, userCommitConfirmed: null },
  ))
const dcRow = (ticketId: string, inv: string[], ref: string): string =>
  serializeCloseProofRow({ ticket_id: ticketId, event: 'dev-complete', series_id: null, resolution: null, phase_inventory: [...inv].sort(), design_ref: ref, at: ISO, reconstructed: false, evidence_basis: null } as CloseProofRow)

const headBlob = (repo: string, rel: string): string | null => { try { return g(repo, ['show', `HEAD:${rel}`]) } catch { return null } }
const cpRows = (repo: string, id: string): CloseProofRow[] => {
  const t = headBlob(repo, `workflow/${id}/responses/ticket-close.jsonl`)
  return t ? t.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as CloseProofRow) : []
}

describe('[REQ-2026-052 phase-4] req:reconstruct (실 git·DEC-D2)', () => {
  const PARENT = 'REQ-2026-001'
  const SUCC = 'REQ-2026-002'

  it('⒅ 검증가능 series-terminal 증거(successor lineage)만 → reconstructed 행이 durable commit으로 정확히 한 번', () => {
    const repo = mkRepo()
    try {
      commitTicket(repo, PARENT, {}) // 대체된 부모(증거 없음 — 무결성 통과, close-proof 없음)
      commitSuccessor(repo, SUCC, validSuccessorOf(PARENT, 'design:-#1'))
      const head0 = g(repo, ['rev-parse', 'HEAD'])
      reconstructMain([PARENT, '--run', '--confirm', '--root', repo])
      const rows = cpRows(repo, PARENT)
      expect(rows.length).toBe(1)
      expect(rows[0]).toMatchObject({ ticket_id: PARENT, event: 'series-terminal', series_id: 'design:-#1', resolution: 'replace', reconstructed: true })
      expect(rows[0]!.evidence_basis).toEqual([`workflow/${SUCC}/state.json`])
      expect(g(repo, ['rev-parse', 'HEAD'])).not.toBe(head0) // 정확히 새 커밋 1개
      expect(g(repo, ['rev-list', '--count', `${head0}..HEAD`])).toBe('1')
    } finally { rmSync(repo, { recursive: true, force: true }) }
  })

  it('⒄ dry-run은 HEAD·index·워킹트리 불변(write 0)', () => {
    const repo = mkRepo()
    try {
      commitTicket(repo, PARENT, {})
      commitSuccessor(repo, SUCC, validSuccessorOf(PARENT, 'design:-#1'))
      const head0 = g(repo, ['rev-parse', 'HEAD']); const tree0 = g(repo, ['write-tree']); const st0 = g(repo, ['status', '--porcelain'])
      reconstructMain([PARENT, '--root', repo]) // dry-run
      expect(g(repo, ['rev-parse', 'HEAD'])).toBe(head0)
      expect(g(repo, ['write-tree'])).toBe(tree0)
      expect(g(repo, ['status', '--porcelain'])).toBe(st0)
      expect(cpRows(repo, PARENT).length).toBe(0)
    } finally { rmSync(repo, { recursive: true, force: true }) }
  })

  it('㉔ --run 이지만 --confirm 없음 → write 0', () => {
    const repo = mkRepo()
    try {
      commitTicket(repo, PARENT, {})
      commitSuccessor(repo, SUCC, validSuccessorOf(PARENT, 'design:-#1'))
      const head0 = g(repo, ['rev-parse', 'HEAD'])
      reconstructMain([PARENT, '--run', '--root', repo]) // confirm 없음
      expect(g(repo, ['rev-parse', 'HEAD'])).toBe(head0)
      expect(cpRows(repo, PARENT).length).toBe(0)
    } finally { rmSync(repo, { recursive: true, force: true }) }
  })

  it('⒆ 동일 실행 재시도 → 중복 행/추가 커밋 없음(자연키 멱등)', () => {
    const repo = mkRepo()
    try {
      commitTicket(repo, PARENT, {})
      commitSuccessor(repo, SUCC, validSuccessorOf(PARENT, 'design:-#1'))
      reconstructMain([PARENT, '--run', '--confirm', '--root', repo])
      const headAfter1 = g(repo, ['rev-parse', 'HEAD'])
      reconstructMain([PARENT, '--run', '--confirm', '--root', repo]) // 재시도
      expect(g(repo, ['rev-parse', 'HEAD'])).toBe(headAfter1) // 추가 커밋 없음
      expect(cpRows(repo, PARENT).length).toBe(1) // 중복 없음
    } finally { rmSync(repo, { recursive: true, force: true }) }
  })

  it('⒇ committed 증거 손상(phase archive 부재) → 복원 거부(fail-closed)', () => {
    const repo = mkRepo()
    try {
      // phase manifest 행은 있으나 archive blob 없음 → verifyCommittedEvidenceIntegrity 실패.
      const t = `workflow/${PARENT}`
      commitTicket(repo, PARENT, { manifest: phaseRow(t, 'p1', sha256('x')) }) // p1 archive 미기록
      commitSuccessor(repo, SUCC, validSuccessorOf(PARENT, 'design:-#1'))
      const head0 = g(repo, ['rev-parse', 'HEAD'])
      expect(() => reconstructMain([PARENT, '--run', '--confirm', '--root', repo])).toThrow(/증거 손상|복원 거부/)
      expect(g(repo, ['rev-parse', 'HEAD'])).toBe(head0) // write 0
    } finally { rmSync(repo, { recursive: true, force: true }) }
  })

  it('㉑ dev-complete close proof 없고 phase manifest만 → 복원 거부(inventory 합성 안 함·no-op)', () => {
    const repo = mkRepo()
    try {
      const t = `workflow/${PARENT}`
      commitTicket(repo, PARENT, { manifest: phaseRow(t, 'p1', sha256('a1')), phaseArchive: { name: 'p1-r01-approved.json', content: 'a1' } }) // archive 정상
      // successor 없음 → series-terminal 후보도 없음.
      const head0 = g(repo, ['rev-parse', 'HEAD'])
      reconstructMain([PARENT, '--run', '--confirm', '--root', repo])
      expect(g(repo, ['rev-parse', 'HEAD'])).toBe(head0) // no-op(write 0) — dev-complete 절대 합성 안 함
      expect(cpRows(repo, PARENT).length).toBe(0)
    } finally { rmSync(repo, { recursive: true, force: true }) }
  })

  it('㉒ reconstruct는 manifest/archive를 건드리지 않는다(phase_design_ref·design archive 합성 경로 없음)', () => {
    const repo = mkRepo()
    try {
      commitTicket(repo, PARENT, {})
      commitSuccessor(repo, SUCC, validSuccessorOf(PARENT, 'design:-#1'))
      reconstructMain([PARENT, '--run', '--confirm', '--root', repo])
      // 마지막 커밋은 close-proof만 담는다(approvals.jsonl·archive 미변경).
      const changed = g(repo, ['show', '--name-only', '--format=', 'HEAD']).split('\n').filter(Boolean)
      expect(changed).toEqual([`workflow/${PARENT}/responses/ticket-close.jsonl`])
    } finally { rmSync(repo, { recursive: true, force: true }) }
  })

  it('㉓ reconstructed overlay는 intake 기본 상태 규칙 불변(series-terminal event로 pass·overlay는 표시만)', () => {
    const repo = mkRepo()
    try {
      commitTicket(repo, PARENT, {}) // 복원 전: durable·close-proof 없음 → developing(block)
      commitSuccessor(repo, SUCC, validSuccessorOf(PARENT, 'design:-#1'))
      expect(scanTicketIntake(repo, `workflow/${PARENT}`, PARENT).baseState).toBe('developing')
      reconstructMain([PARENT, '--run', '--confirm', '--root', repo])
      const r = scanTicketIntake(repo, `workflow/${PARENT}`, PARENT)
      expect(r.baseState).toBe('series-terminal') // event 때문이지 overlay 때문이 아니다
      expect(r.verdict).toBe('pass')
      expect(r.reconstructed).toBe(true) // overlay 표시만
    } finally { rmSync(repo, { recursive: true, force: true }) }
  })

  it('🔴 P1: 대상 close-proof에 미커밋 행이 있으면 복원 거부(fail-closed·미커밋 증거 미손실)', () => {
    const repo = mkRepo()
    try {
      commitTicket(repo, PARENT, {}) // HEAD close-proof 없음
      commitSuccessor(repo, SUCC, validSuccessorOf(PARENT, 'design:-#1'))
      // 🔴 사용자가 close-proof에 **미커밋** 행을 써 둔 상태(다른 series의 손기록 등).
      const userRow = serializeCloseProofRow({ ticket_id: PARENT, event: 'series-terminal', series_id: 'design:-#9', resolution: 'human-resolution', phase_inventory: null, design_ref: null, at: ISO, reconstructed: false, evidence_basis: null } as CloseProofRow)
      writeFileSync(join(repo, 'workflow', PARENT, 'responses', 'ticket-close.jsonl'), userRow)
      const head0 = g(repo, ['rev-parse', 'HEAD'])
      expect(() => reconstructMain([PARENT, '--run', '--confirm', '--root', repo])).toThrow(/미커밋 변경|fail-closed|덮어쓸/)
      expect(g(repo, ['rev-parse', 'HEAD'])).toBe(head0) // write 0
      // 🔴 미커밋 사용자 행이 그대로 남아 있다(손실 없음).
      const onDisk = readFileSync(join(repo, 'workflow', PARENT, 'responses', 'ticket-close.jsonl'), 'utf8')
      expect(onDisk).toContain('design:-#9') // 사용자 행 보존
    } finally { rmSync(repo, { recursive: true, force: true }) }
  })

  it('구식 successor_of(parent_series_id 없음) → 복원 불가(수집 안 함·no-op)', () => {
    const repo = mkRepo()
    try {
      commitTicket(repo, PARENT, {})
      const old = { req_id: PARENT, parent_attempts_total: 3, parent_replace_resolution: replaceResolution, recorded_at: ISO } // parent_series_id 없음
      commitSuccessor(repo, SUCC, old)
      const head0 = g(repo, ['rev-parse', 'HEAD'])
      reconstructMain([PARENT, '--run', '--confirm', '--root', repo])
      expect(g(repo, ['rev-parse', 'HEAD'])).toBe(head0) // 복원 불가 → no-op
    } finally { rmSync(repo, { recursive: true, force: true }) }
  })

  it('collectSuccessorEvidence: 유효 replace lineage만 수집(비-replace·구식·형식무효 제외)', () => {
    const repo = mkRepo()
    try {
      commitTicket(repo, PARENT, {})
      commitSuccessor(repo, 'REQ-2026-002', validSuccessorOf(PARENT, 'design:-#1')) // 유효
      commitSuccessor(repo, 'REQ-2026-003', { req_id: 'REQ-2026-999', parent_replace_resolution: replaceResolution, parent_series_id: 'x' }) // 다른 부모
      commitSuccessor(repo, 'REQ-2026-004', { req_id: PARENT, parent_replace_resolution: { decision: 'terminate', method: 'm', decided_at: ISO }, parent_series_id: 'y' }) // terminate
      const ev = collectSuccessorEvidence('workflow', PARENT, (a) => g(repo, a))
      expect(ev.map((e) => e.successorTicketId)).toEqual(['REQ-2026-002'])
      expect(ev[0]!.parentSeriesId).toBe('design:-#1')
    } finally { rmSync(repo, { recursive: true, force: true }) }
  })
})

describe('[REQ-2026-052 phase-4] planReconstruction (순수·DEC-D2)', () => {
  const ev = (sid: string, at = ISO): { successorTicketId: string; successorStatePath: string; parentSeriesId: string; at: string } =>
    ({ successorTicketId: 'REQ-2026-002', successorStatePath: 'workflow/REQ-2026-002/state.json', parentSeriesId: sid, at })

  it('유효 successor → series-terminal 후보(reconstructed:true·evidence_basis)', () => {
    const p = planReconstruction({ ticketId: 'REQ-2026-001', existingRows: [], successors: [ev('design:-#1')] })
    expect(p.candidates.length).toBe(1)
    expect(p.candidates[0]!.row).toMatchObject({ event: 'series-terminal', series_id: 'design:-#1', resolution: 'replace', reconstructed: true, phase_inventory: null, design_ref: null })
    expect(p.candidates[0]!.evidenceBasis).toEqual(['workflow/REQ-2026-002/state.json'])
  })
  it('🔴 dev-complete는 절대 후보에 없다(합성 금지) — successor 있어도 series-terminal만', () => {
    const p = planReconstruction({ ticketId: 'REQ-2026-001', existingRows: [], successors: [ev('design:-#1')] })
    expect(p.candidates.every((c) => c.row.event === 'series-terminal')).toBe(true)
  })
  it('parentSeriesId/at 미결정 → 복원 불가(refusal)', () => {
    const p = planReconstruction({ ticketId: 'REQ-2026-001', existingRows: [], successors: [ev('', ISO)] })
    expect(p.candidates.length).toBe(0)
    expect(p.refusals.some((r) => /미결정|모호/.test(r))).toBe(true)
  })
  it('기존 series-terminal 행 존재 → 복원 불필요(refusal·중복 없음)', () => {
    const existing: CloseProofRow = { ticket_id: 'REQ-2026-001', event: 'series-terminal', series_id: 'design:-#1', resolution: 'replace', phase_inventory: null, design_ref: null, at: ISO, reconstructed: false, evidence_basis: null }
    const p = planReconstruction({ ticketId: 'REQ-2026-001', existingRows: [existing], successors: [ev('design:-#1')] })
    expect(p.candidates.length).toBe(0)
    expect(p.refusals.some((r) => /이미.*존재/.test(r))).toBe(true)
  })
  it('parseArgs: reqId·--run·--confirm·--root', () => {
    expect(parseArgs(['2026-001', '--run', '--confirm'])).toMatchObject({ reqId: '2026-001', run: true, confirm: true })
    expect(parseArgs(['2026-001'])).toMatchObject({ run: false, confirm: false })
    expect(() => parseArgs(['--bad'])).toThrow(/알 수 없는 옵션/)
  })
})
