/**
 * REQ-2026-052 phase-3b — req:new intake gate 실 git 테스트.
 *
 * 🔴 판정 입력은 **HEAD blob만**. 워킹 state.json·워킹트리·미커밋 원장은 절대 보지 않는다.
 * 🔴 스캔은 read-only(git 조회만) — write-tree·commit·state 수정 없음.
 */
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { scanTicketIntake, scanIntake, classifyIntake, listHeadTicketIds } from '../../scripts/req/lib/intake'
import { main as reqNewMain } from '../../scripts/req/req-new'
import { buildManifestEntry, serializeManifestLine } from '../../scripts/req/lib/evidence'
import { serializeCloseProofRow, type CloseProofRow } from '../../scripts/req/lib/close-proof'
import { serializeLedgerRow, type LedgerRow } from '../../scripts/req/lib/review-ledger'

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

// 🔴 DEC-B7: **완전한** design 승인 evidence — design 행 + archive_inventory 전체 + 실제 archive blob(sha 일치).
//    rounds 마지막이 approved(design 행 response_path). 앞 라운드(needs-fix 등)는 inventory에 포함(과거 라운드 감사).
interface DesignRound { round: string; kind: 'approved' | 'needs-fix' }
const designArchiveName = (r: DesignRound): string => `design-${r.round}-${r.kind}.json`
const designArchiveContent = (r: DesignRound): string => JSON.stringify({ design: r.round, kind: r.kind })
const defaultDesignRounds: DesignRound[] = [{ round: 'r01', kind: 'approved' }]

/** design evidence 산출물: manifest 행 + 써야 할 archive blob 목록(sha 일치). */
const designEvidence = (ticketRel: string, designHash: string, rounds: DesignRound[] = defaultDesignRounds): { row: string; archives: Array<{ name: string; content: string }> } => {
  const archives = rounds.map((r) => ({ name: designArchiveName(r), content: designArchiveContent(r) }))
  const approved = rounds[rounds.length - 1]! // 마지막 = 승인본
  const inventory = archives.map((a) => ({ response_path: `${ticketRel}/responses/${a.name}`, sha256: sha256(a.content) }))
  const row = serializeManifestLine(buildManifestEntry(
    { review_kind: 'design', phase_id: null, response_path: `${ticketRel}/responses/${designArchiveName(approved)}`, response_sha256: sha256(designArchiveContent(approved)), review_base_sha: OID, design_hash: designHash, approved_at: ISO } as never,
    { consumedAt: ISO, consumedByCommitSha: OID, userCommitConfirmed: null, archiveInventory: inventory },
  ))
  return { row, archives }
}
// phase 승인 archive의 결정적 내용(pid·round로 고유). DEC-B6: manifest.response_sha256 == 이 내용의 sha256이어야 통과.
const phaseArchiveContent = (pid: string, round: string): string => JSON.stringify({ phase: pid, round, approved: true })
const phaseArchiveName = (pid: string, round: string): string => `${pid}-${round}-approved.json`

// phase manifest 행 — response_sha256을 archive 내용의 실제 sha로 채운다(commitTicket이 그 archive blob을 쓴다).
const phaseRow = (ticketRel: string, pid: string, phaseDesignRef: string | null, round = 'r01'): string =>
  serializeManifestLine(buildManifestEntry(
    { review_kind: 'phase', phase_id: pid, response_path: `${ticketRel}/responses/${phaseArchiveName(pid, round)}`, response_sha256: sha256(phaseArchiveContent(pid, round)), review_base_sha: OID, approved_tree: OID, ...(phaseDesignRef === null ? {} : { phase_design_ref: phaseDesignRef }), approved_at: ISO } as never,
    { consumedAt: ISO, consumedByCommitSha: OID, userCommitConfirmed: null },
  ))

const dcRow = (ticketId: string, inv: string[], designRef: string): string =>
  serializeCloseProofRow({ ticket_id: ticketId, event: 'dev-complete', series_id: null, resolution: null, phase_inventory: [...inv].sort(), design_ref: designRef, at: ISO, reconstructed: false, evidence_basis: null } as CloseProofRow)

const stRow = (ticketId: string, seriesId: string): string =>
  serializeCloseProofRow({ ticket_id: ticketId, event: 'series-terminal', series_id: seriesId, resolution: 'replace', phase_inventory: null, design_ref: null, at: ISO, reconstructed: false, evidence_basis: null } as CloseProofRow)

const ledgerApprovedClose = (ticketId: string): string =>
  serializeLedgerRow({ ticket_id: ticketId, series_id: 'design:-#1', review_kind: 'design', phase_id: null, attempt: 1, event: 'attempt-closed', lifecycle: 'completed', outcome: 'approved', exception_consumed: false, prompt_sha256: 'd'.repeat(64), at: ISO, reconstructed: false } as LedgerRow)

interface PhaseSpec { pid: string; ref: string | null; round?: string }
interface TicketSpec {
  durable?: boolean // 기본 true(marker 심음). false면 legacy.
  designHash?: string // 지정 시 **완전한 design 승인 evidence**(design 행 + inventory + archive blob) 기록.
  designRounds?: DesignRound[] // design archive 라운드(기본 [r01-approved]). 과거 needs-fix 포함 inventory 구성용.
  phases?: PhaseSpec[] // 지정 시 phase manifest 행 추가 + **실제 archive blob**(sha 일치) 기록.
  manifest?: string // raw approvals.jsonl 본문(주입/손상 테스트용 — designHash/phases와 조합 가능).
  close?: string // ticket-close.jsonl 본문
  ledger?: string // review-ledger.jsonl 본문
}

/** repo에 티켓 하나를 커밋(HEAD에 남긴다). design/phase가 있으면 승인 archive blob을 실제로 써서 SHA가 manifest와 일치한다. */
const commitTicket = (repo: string, id: string, spec: TicketSpec): string => {
  const ticketRel = `workflow/${id}`
  const dir = join(repo, 'workflow', id)
  mkdirSync(join(dir, 'responses'), { recursive: true })
  const state: Record<string, unknown> = { id, phase: 'INTAKE', review_series_model_version: 1, phases: [] }
  if (spec.durable !== false) state.evidence_durability_required = true
  writeFileSync(join(dir, 'state.json'), JSON.stringify(state))
  let manifest = ''
  if (spec.designHash) {
    const de = designEvidence(ticketRel, spec.designHash, spec.designRounds) // 🔴 완전한 design evidence
    for (const a of de.archives) writeFileSync(join(dir, 'responses', a.name), a.content) // design archive blob(들)
    manifest += de.row
  }
  for (const ph of spec.phases ?? []) {
    const round = ph.round ?? 'r01'
    writeFileSync(join(dir, 'responses', phaseArchiveName(ph.pid, round)), phaseArchiveContent(ph.pid, round)) // 🔴 실제 archive blob
    manifest += phaseRow(ticketRel, ph.pid, ph.ref, round)
  }
  if (spec.manifest !== undefined) manifest += spec.manifest
  if (manifest) writeFileSync(join(dir, 'responses', 'approvals.jsonl'), manifest)
  if (spec.close !== undefined) writeFileSync(join(dir, 'responses', 'ticket-close.jsonl'), spec.close)
  if (spec.ledger !== undefined) writeFileSync(join(dir, 'responses', 'review-ledger.jsonl'), spec.ledger)
  g(repo, ['add', '-A'])
  g(repo, ['commit', '-qm', `ticket ${id}`])
  return ticketRel
}

/** HEAD에서 임의 archive 파일을 삭제(rm+commit) — HEAD blob 부재 모사. */
const rmArchiveAtHead = (repo: string, id: string, name: string): void => {
  g(repo, ['rm', '-q', `workflow/${id}/responses/${name}`])
  g(repo, ['commit', '-qm', `rm ${name}`])
}
/** HEAD에서 임의 archive 바이트를 변조(sha 불일치) — 내용 교체+commit. */
const tamperFileAtHead = (repo: string, id: string, name: string): void => {
  writeFileSync(join(repo, 'workflow', id, 'responses', name), 'TAMPERED')
  g(repo, ['add', '-A']); g(repo, ['commit', '-qm', `tamper ${name}`])
}
const deleteArchiveAtHead = (repo: string, id: string, pid: string, round = 'r01'): void => rmArchiveAtHead(repo, id, phaseArchiveName(pid, round))
const tamperArchiveAtHead = (repo: string, id: string, pid: string, round = 'r01'): void => tamperFileAtHead(repo, id, phaseArchiveName(pid, round))

const mkRepo = (): string => {
  const repo = mkdtempSync(join(tmpdir(), 'req052-intake-'))
  g(repo, ['init', '-q']); g(repo, ['config', 'user.email', 't@t.t']); g(repo, ['config', 'user.name', 't'])
  // reqNewMain(loadConfig)용 최소 설정 + main 브랜치.
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'x', version: '0.0.0' }))
  writeFileSync(join(repo, 'req.config.json'), JSON.stringify({ ...SETUP_OK, packageManager: 'npm' }))
  g(repo, ['add', '-A']); g(repo, ['commit', '-qm', 'seed'])
  g(repo, ['branch', '-M', 'main'])
  return repo
}

const D1 = 'e'.repeat(64)
const D2 = 'f'.repeat(64)

describe('[REQ-2026-052 phase-3b] req:new intake gate — HEAD durable 증거만(실 git)', () => {
  it('⓺ inventory 전 phase가 현재 design(D2) 결속 + archive 정상·SHA 일치 → dev-complete/pass', () => {
    const repo = mkRepo()
    try {
      const t = commitTicket(repo, 'REQ-2026-001', {
        designHash: D2, phases: [{ pid: 'p1', ref: D2 }, { pid: 'p2', ref: D2 }],
        close: dcRow('REQ-2026-001', ['p1', 'p2'], D2),
      })
      const r = scanTicketIntake(repo, t, 'REQ-2026-001')
      expect(r.baseState).toBe('dev-complete')
      expect(r.verdict).toBe('pass')
    } finally { rmSync(repo, { recursive: true, force: true }) }
  })

  it('⓻ 🔴 D2 design인데 phase evidence는 D1 결속만(archive 정상) → developing/block(corrupt 아님 — 손상과 구분)', () => {
    const repo = mkRepo()
    try {
      const t = commitTicket(repo, 'REQ-2026-001', {
        designHash: D2, phases: [{ pid: 'p1', ref: D1 }, { pid: 'p2', ref: D1 }],
        close: dcRow('REQ-2026-001', ['p1', 'p2'], D1), // 옛 D1 완료 — 현재 design D2와 불일치
      })
      const r = scanTicketIntake(repo, t, 'REQ-2026-001')
      expect(r.baseState).toBe('developing') // archive는 온전하므로 corrupt 아님
      expect(r.verdict).toBe('block')
    } finally { rmSync(repo, { recursive: true, force: true }) }
  })

  it('🔴 ⓸ inventory phase 승인 archive를 HEAD에서 삭제 → corrupt/block', () => {
    const repo = mkRepo()
    try {
      const t = commitTicket(repo, 'REQ-2026-001', {
        designHash: D2, phases: [{ pid: 'p1', ref: D2 }, { pid: 'p2', ref: D2 }],
        close: dcRow('REQ-2026-001', ['p1', 'p2'], D2),
      })
      expect(scanTicketIntake(repo, t, 'REQ-2026-001').baseState).toBe('dev-complete') // 삭제 전엔 통과
      deleteArchiveAtHead(repo, 'REQ-2026-001', 'p1') // 🔴 p1 승인 archive 삭제
      const r = scanTicketIntake(repo, t, 'REQ-2026-001')
      expect(r.baseState).toBe('corrupt')
      expect(r.verdict).toBe('block')
    } finally { rmSync(repo, { recursive: true, force: true }) }
  })

  it('🔴 ⓹ inventory phase archive 바이트 변조(SHA 불일치) → corrupt/block', () => {
    const repo = mkRepo()
    try {
      const t = commitTicket(repo, 'REQ-2026-001', {
        designHash: D2, phases: [{ pid: 'p1', ref: D2 }, { pid: 'p2', ref: D2 }],
        close: dcRow('REQ-2026-001', ['p1', 'p2'], D2),
      })
      tamperArchiveAtHead(repo, 'REQ-2026-001', 'p2') // 🔴 p2 archive 변조 → response_sha256 불일치
      const r = scanTicketIntake(repo, t, 'REQ-2026-001')
      expect(r.baseState).toBe('corrupt')
      expect(r.verdict).toBe('block')
    } finally { rmSync(repo, { recursive: true, force: true }) }
  })

  it('series-terminal → 통과', () => {
    const repo = mkRepo()
    try {
      const t = commitTicket(repo, 'REQ-2026-001', { designHash: D1, close: stRow('REQ-2026-001', 'design:-#1') })
      const r = scanTicketIntake(repo, t, 'REQ-2026-001')
      expect(r.baseState).toBe('series-terminal')
      expect(r.verdict).toBe('pass')
    } finally { rmSync(repo, { recursive: true, force: true }) }
  })

  // ── DEC-B7: design 승인 archive 무결성 ──
  const devCompleteTicket = (repo: string, designRounds?: DesignRound[]): string =>
    commitTicket(repo, 'REQ-2026-001', { designHash: D2, designRounds, phases: [{ pid: 'p1', ref: D2 }, { pid: 'p2', ref: D2 }], close: dcRow('REQ-2026-001', ['p1', 'p2'], D2) })

  it('⒀ design·phase archive 모두 정상 → dev-complete/pass', () => {
    const repo = mkRepo()
    try {
      const t = devCompleteTicket(repo)
      const r = scanTicketIntake(repo, t, 'REQ-2026-001')
      expect(r.baseState).toBe('dev-complete')
      expect(r.verdict).toBe('pass')
    } finally { rmSync(repo, { recursive: true, force: true }) }
  })

  it('🔴 ⑽ 최신 design 승인 archive 삭제 → corrupt/block', () => {
    const repo = mkRepo()
    try {
      const t = devCompleteTicket(repo)
      expect(scanTicketIntake(repo, t, 'REQ-2026-001').baseState).toBe('dev-complete') // 삭제 전
      rmArchiveAtHead(repo, 'REQ-2026-001', 'design-r01-approved.json') // 🔴 최신 design 승인 archive 삭제
      const r = scanTicketIntake(repo, t, 'REQ-2026-001')
      expect(r.baseState).toBe('corrupt')
      expect(r.verdict).toBe('block')
    } finally { rmSync(repo, { recursive: true, force: true }) }
  })

  it('🔴 ⑾ 최신 design 승인 archive SHA 변조 → corrupt/block', () => {
    const repo = mkRepo()
    try {
      const t = devCompleteTicket(repo)
      tamperFileAtHead(repo, 'REQ-2026-001', 'design-r01-approved.json') // 🔴 design archive 변조
      const r = scanTicketIntake(repo, t, 'REQ-2026-001')
      expect(r.baseState).toBe('corrupt')
      expect(r.verdict).toBe('block')
    } finally { rmSync(repo, { recursive: true, force: true }) }
  })

  it('🔴 ⑿ archive_inventory 안의 과거 needs-fix archive 삭제/변조 → corrupt/block', () => {
    const repo = mkRepo()
    try {
      // inventory = [design-r01-needs-fix, design-r02-approved]. 승인본은 r02, 과거 needs-fix r01도 inventory에.
      const rounds: DesignRound[] = [{ round: 'r01', kind: 'needs-fix' }, { round: 'r02', kind: 'approved' }]
      const t = devCompleteTicket(repo, rounds)
      expect(scanTicketIntake(repo, t, 'REQ-2026-001').baseState).toBe('dev-complete') // 손상 전
      tamperFileAtHead(repo, 'REQ-2026-001', 'design-r01-needs-fix.json') // 🔴 과거 needs-fix archive 변조
      expect(scanTicketIntake(repo, t, 'REQ-2026-001').baseState).toBe('corrupt')
    } finally { rmSync(repo, { recursive: true, force: true }) }
  })

  it('🔴 ⒃ series-terminal도 손상된 committed audit evidence면 corrupt(통과 금지)', () => {
    const repo = mkRepo()
    try {
      // series-terminal 티켓이 design 증거를 갖고 있고 그 archive가 변조됨 → 손상 → corrupt(통과 금지).
      const t = commitTicket(repo, 'REQ-2026-001', { designHash: D1, close: stRow('REQ-2026-001', 'design:-#1') })
      expect(scanTicketIntake(repo, t, 'REQ-2026-001').baseState).toBe('series-terminal') // 손상 전엔 통과
      tamperFileAtHead(repo, 'REQ-2026-001', 'design-r01-approved.json') // 🔴 design archive 변조
      const r = scanTicketIntake(repo, t, 'REQ-2026-001')
      expect(r.baseState).toBe('corrupt')
      expect(r.verdict).toBe('block')
    } finally { rmSync(repo, { recursive: true, force: true }) }
  })

  it('legacy(marker 없음) → 차단 안 함(표시만)', () => {
    const repo = mkRepo()
    try {
      const t = commitTicket(repo, 'REQ-2026-001', { durable: false })
      const r = scanTicketIntake(repo, t, 'REQ-2026-001')
      expect(r.baseState).toBe('legacy')
      expect(r.verdict).toBe('legacy')
    } finally { rmSync(repo, { recursive: true, force: true }) }
  })

  it('durable + 증거 없음 → developing 차단', () => {
    const repo = mkRepo()
    try {
      const t = commitTicket(repo, 'REQ-2026-001', {}) // marker만, 증거 없음
      const r = scanTicketIntake(repo, t, 'REQ-2026-001')
      expect(r.baseState).toBe('developing')
      expect(r.verdict).toBe('block')
    } finally { rmSync(repo, { recursive: true, force: true }) }
  })

  it('🔴 ledger 승인 흔적만 있고 committed evidence 불완전(design 미커밋) → needs-recovery 차단', () => {
    const repo = mkRepo()
    try {
      // 🔴 불완전≠손상: design 행 자체가 없다(design evidence 미커밋 — 중단된 durabilize). ledger엔 승인 흔적.
      //    → committedEvidenceComplete=false + ledger approved → needs-recovery(손상 아님이라 corrupt 아님).
      const t = commitTicket(repo, 'REQ-2026-001', {
        ledger: ledgerApprovedClose('REQ-2026-001'), // attempt-closed(approved) 흔적, design 증거 없음
      })
      const r = scanTicketIntake(repo, t, 'REQ-2026-001')
      expect(r.baseState).toBe('needs-recovery')
      expect(r.verdict).toBe('block')
    } finally { rmSync(repo, { recursive: true, force: true }) }
  })

  it('🔴 HEAD manifest 손상(주입 필드) → 차단(corrupt·통과 금지)', () => {
    const repo = mkRepo()
    try {
      const bad = JSON.stringify({ kind: 'phase', phase_id: 'p1', response_path: 'workflow/REQ-2026-001/responses/p1-r01-approved.json', response_sha256: 'c'.repeat(64), review_base_sha: OID, approved_tree: OID, approved_at: ISO, consumed_at: ISO, consumed_by_commit_sha: OID, user_commit_confirmed: null, INJECT: 'evil' }) + '\n'
      const t = commitTicket(repo, 'REQ-2026-001', { manifest: bad, close: dcRow('REQ-2026-001', ['p1'], D1) })
      const r = scanTicketIntake(repo, t, 'REQ-2026-001')
      expect(r.baseState).toBe('corrupt')
      expect(r.verdict).toBe('block')
    } finally { rmSync(repo, { recursive: true, force: true }) }
  })

  it('🔴 HEAD close-proof 손상(자연키 중복) → 차단(corrupt)', () => {
    const repo = mkRepo()
    try {
      const dup = dcRow('REQ-2026-001', ['p1'], D1) + dcRow('REQ-2026-001', ['p1'], D1) // 같은 자연키(design_ref) 2행
      const t = commitTicket(repo, 'REQ-2026-001', { designHash: D1, phases: [{ pid: 'p1', ref: D1 }], close: dup })
      const r = scanTicketIntake(repo, t, 'REQ-2026-001')
      expect(r.baseState).toBe('corrupt')
      expect(r.verdict).toBe('block')
    } finally { rmSync(repo, { recursive: true, force: true }) }
  })

  it('🔴 runtime state가 DONE으로 위조되거나 삭제돼도 HEAD가 developing이면 차단', () => {
    const repo = mkRepo()
    try {
      const t = commitTicket(repo, 'REQ-2026-001', {}) // HEAD=developing
      // 워킹 state.json을 완료로 위조.
      writeFileSync(join(repo, t, 'state.json'), JSON.stringify({ id: 'REQ-2026-001', phase: 'DONE', done: true }))
      expect(scanTicketIntake(repo, t, 'REQ-2026-001').verdict).toBe('block')
      // 워킹 state.json 삭제.
      rmSync(join(repo, t, 'state.json'))
      expect(scanTicketIntake(repo, t, 'REQ-2026-001').verdict).toBe('block')
    } finally { rmSync(repo, { recursive: true, force: true }) }
  })

  it('🔴 스캔은 read-only — HEAD·index·워킹트리 불변', () => {
    const repo = mkRepo()
    try {
      commitTicket(repo, 'REQ-2026-001', { designHash: D2, phases: [{ pid: 'p1', ref: D2 }], close: dcRow('REQ-2026-001', ['p1'], D2) })
      commitTicket(repo, 'REQ-2026-002', {}) // developing
      const head0 = g(repo, ['rev-parse', 'HEAD'])
      const tree0 = g(repo, ['write-tree'])
      const status0 = g(repo, ['status', '--porcelain'])
      const res = scanIntake(repo, 'workflow', (a) => g(repo, a))
      expect(res.blocked.map((t) => t.ticketId)).toEqual(['REQ-2026-002'])
      expect(g(repo, ['rev-parse', 'HEAD'])).toBe(head0) // 새 커밋 없음
      expect(g(repo, ['write-tree'])).toBe(tree0) // index 불변
      expect(g(repo, ['status', '--porcelain'])).toBe(status0) // 워킹트리 불변
    } finally { rmSync(repo, { recursive: true, force: true }) }
  })

  it('scanIntake: 전체 스캔·excludeTicketId(successor 부모 제외)·HEAD tree 목록', () => {
    const repo = mkRepo()
    try {
      commitTicket(repo, 'REQ-2026-001', { designHash: D1, close: stRow('REQ-2026-001', 's1') }) // pass(series-terminal)
      commitTicket(repo, 'REQ-2026-002', {}) // block(developing)
      commitTicket(repo, 'REQ-2026-003', { durable: false }) // legacy
      expect(listHeadTicketIds('workflow', (a) => g(repo, a))).toEqual(['REQ-2026-001', 'REQ-2026-002', 'REQ-2026-003'])
      const all = scanIntake(repo, 'workflow', (a) => g(repo, a))
      expect(all.blocked.map((t) => t.ticketId)).toEqual(['REQ-2026-002'])
      // 부모(REQ-2026-002)를 replace로 종결 중이면 제외 → 차단 없음.
      const excl = scanIntake(repo, 'workflow', (a) => g(repo, a), 'REQ-2026-002')
      expect(excl.blocked).toEqual([])
    } finally { rmSync(repo, { recursive: true, force: true }) }
  })

  it('🔴 e2e: 기존 durable developing 티켓이 있으면 req:new --run이 **생성 전** 차단(브랜치·티켓 미생성)', () => {
    const repo = mkRepo()
    try {
      commitTicket(repo, 'REQ-2026-001', {}) // HEAD=developing(durable·증거 없음)
      const head0 = g(repo, ['rev-parse', 'HEAD'])
      const branches0 = g(repo, ['branch', '--list'])
      // 🔴 열거가 비면(슬래시 버그) 이 티켓을 못 봐 통과해버린다 → 이 기대가 그 회귀를 잡는다.
      expect(() => reqNewMain(['newslug', '--run', '--root', repo])).toThrow(/미종결 durable|developing/)
      // 어떤 write도 없어야 한다: 새 커밋·새 브랜치·새 티켓 디렉터리 없음.
      expect(g(repo, ['rev-parse', 'HEAD'])).toBe(head0)
      expect(g(repo, ['branch', '--list'])).toBe(branches0) // feat/req-* 미생성
      expect(existsSync(join(repo, 'workflow', 'REQ-2026-002'))).toBe(false)
    } finally { rmSync(repo, { recursive: true, force: true }) }
  })

  it('e2e: 기존 티켓이 전부 통과(dev-complete/series-terminal/legacy)면 req:new --run 성공(새 티켓 생성)', () => {
    const repo = mkRepo()
    try {
      commitTicket(repo, 'REQ-2026-001', { designHash: D2, phases: [{ pid: 'p1', ref: D2 }], close: dcRow('REQ-2026-001', ['p1'], D2) }) // dev-complete
      commitTicket(repo, 'REQ-2026-009', { durable: false }) // legacy
      reqNewMain(['newslug', '--run', '--root', repo])
      // 게이트 통과 → 새 feat 브랜치로 이동(연도 무관하게 slug 포함). 브랜치 이동 자체가 생성 성공의 증거.
      expect(g(repo, ['rev-parse', '--abbrev-ref', 'HEAD'])).toMatch(/newslug/)
    } finally { rmSync(repo, { recursive: true, force: true }) }
  })

  it('classifyIntake(순수): 오버레이(reconstructed)는 기본 상태 판정을 바꾸지 않는다', () => {
    // reconstructed:true인 dev-complete → 여전히 pass. reconstructed:true인 developing → 여전히 block.
    const recon = (rows: CloseProofRow[]) => rows.map((r) => ({ ...r, reconstructed: true, evidence_basis: ['x'] }))
    const dc: CloseProofRow = { ticket_id: 'R', event: 'dev-complete', series_id: null, resolution: null, phase_inventory: ['p1'], design_ref: D2, at: ISO, reconstructed: false, evidence_basis: null }
    const passRec = classifyIntake({ ticketId: 'R', ticketRel: 'workflow/R', durabilityRequired: true, manifestText: '{}', manifestProblems: [], closeParsed: { rows: recon([dc]), problems: [] }, evidenceIntegrityProblems: [], ledgerHasApprovedClose: false, committedEvidenceComplete: true, committedDesignRef: D2, evidencedPhaseIds: ['p1'] })
    expect(passRec.baseState).toBe('dev-complete')
    expect(passRec.verdict).toBe('pass')
    expect(passRec.reconstructed).toBe(true)
    const blockRec = classifyIntake({ ticketId: 'R', ticketRel: 'workflow/R', durabilityRequired: true, manifestText: null, manifestProblems: [], closeParsed: { rows: [], problems: [] }, evidenceIntegrityProblems: [], ledgerHasApprovedClose: false, committedEvidenceComplete: false, committedDesignRef: null, evidencedPhaseIds: [] })
    expect(blockRec.baseState).toBe('developing')
    expect(blockRec.verdict).toBe('block')
  })
})
