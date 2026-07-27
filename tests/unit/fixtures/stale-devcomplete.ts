/**
 * REQ-2026-072 — **낡은 `dev-complete`** 상태를 실 git 저장소로 구성하는 공용 픽스처.
 *
 * 소비자 버그리포트(lean_lms REQ-2026-088)가 겪은 상태 그대로다:
 * 모든 phase를 끝내 `dev-complete`가 발행된 뒤, 결함이 나와 phase를 하나 더 붙이면서 설계를 재승인해
 * **앞선 phase의 결속이 끊기고 close proof만 옛 `design_ref`를 담은 채 낡은** 상태.
 *
 * 🔴 phase-1(`req:close`)과 phase-2(`req:rebind`)가 **각자 이 함수를 호출**한다 — 한 테스트가 다른
 *    테스트의 실행 결과에 기대면 독립 검증 계약이 깨진다(design-r02 observation).
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildManifestEntry, serializeManifestLine } from '../../../scripts/req/lib/evidence'
import { serializeCloseProofRow, type CloseProofRow } from '../../../scripts/req/lib/close-proof'

/** 픽스처 repo는 "setup을 마친 프로젝트"를 나타낸다(setup 게이트가 먼저 막지 않도록). */
const SETUP_OK = { setup: { completedVersion: '0.0.0-test', completedAt: '2026-01-01T00:00:00Z' } }

const OID = 'b'.repeat(40)
const ISO = '2026-07-24T00:00:00.000Z'
const sha256 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex')

/** 옛 설계 승인(재승인 전) / 현재 설계 승인(재승인 후). */
export const D_OLD = 'e'.repeat(64)
export const D_NEW = 'f'.repeat(64)

export const git = (repo: string, args: string[]): string =>
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: repo, encoding: 'utf8' }).replace(/\s+$/, '')

const designArchive = (round: string): string => JSON.stringify({ design: round, kind: 'approved' })
const phaseArchive = (pid: string): string => JSON.stringify({ phase: pid, round: 'r01', approved: true })

const designRow = (ticketRel: string, round: string, designHash: string, inventoryRounds: string[]): string =>
  serializeManifestLine(
    buildManifestEntry(
      {
        review_kind: 'design',
        phase_id: null,
        response_path: `${ticketRel}/responses/design-${round}-approved.json`,
        response_sha256: sha256(designArchive(round)),
        review_base_sha: OID,
        design_hash: designHash,
        approved_at: ISO,
      } as never,
      {
        consumedAt: ISO,
        consumedByCommitSha: OID,
        userCommitConfirmed: null,
        // 🔴 인벤토리는 **그 시점까지의 design 아카이브 전량**이다(실제 발행 경로와 같게).
        archiveInventory: inventoryRounds.map((r) => ({
          response_path: `${ticketRel}/responses/design-${r}-approved.json`,
          sha256: sha256(designArchive(r)),
        })),
      },
    ),
  )

const phaseRow = (ticketRel: string, pid: string, ref: string | null): string =>
  serializeManifestLine(
    buildManifestEntry(
      {
        review_kind: 'phase',
        phase_id: pid,
        response_path: `${ticketRel}/responses/${pid}-r01-approved.json`,
        response_sha256: sha256(phaseArchive(pid)),
        review_base_sha: OID,
        approved_tree: OID,
        ...(ref === null ? {} : { phase_design_ref: ref }),
        approved_at: ISO,
      } as never,
      { consumedAt: ISO, consumedByCommitSha: OID, userCommitConfirmed: null },
    ),
  )

export const mkRepo = (prefix = 'req072-'): string => {
  const repo = mkdtempSync(join(tmpdir(), prefix))
  git(repo, ['init', '-q'])
  git(repo, ['config', 'user.email', 't@t.t'])
  git(repo, ['config', 'user.name', 't'])
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'x', version: '0.0.0' }))
  writeFileSync(join(repo, 'req.config.json'), JSON.stringify({ ...SETUP_OK, packageManager: 'npm' }))
  git(repo, ['add', '-A'])
  git(repo, ['commit', '-qm', 'seed'])
  git(repo, ['branch', '-M', 'main'])
  return repo
}

export interface StaleTicketSpec {
  ticketId: string
  /** `dev-complete`가 발행됐던 시점의 phase들(옛 design_ref에 결속). `ref:null`이면 레거시(재결속 불가). */
  oldPhases: Array<{ pid: string; ref: string | null }>
  /** 설계 재승인 뒤 추가된 phase들(현재 design_ref에 결속). */
  newPhases: string[]
  /** close proof에 낡은 `dev-complete` 행을 넣을지(false면 "한 번도 발행되지 않은" 인접 사례). */
  staleDevComplete: boolean
}

/**
 * 낡은 `dev-complete` 티켓을 커밋한다(HEAD·main 기준 — `integrated`가 성립한다).
 * @returns 티켓의 repo-상대 경로.
 */
export function commitStaleTicket(repo: string, spec: StaleTicketSpec): string {
  const ticketRel = `workflow/${spec.ticketId}`
  const dir = join(repo, ticketRel)
  mkdirSync(join(dir, 'responses'), { recursive: true })

  const plannedPhases = [...spec.oldPhases.map((p) => p.pid), ...spec.newPhases]
  writeFileSync(
    join(dir, 'state.json'),
    JSON.stringify({
      id: spec.ticketId,
      phase: 'INTAKE',
      review_series_model_version: 1,
      phases: plannedPhases.map((id) => ({ id, approved: true })),
      evidence_durability_required: true,
    }),
  )

  for (const round of ['r01', 'r02']) writeFileSync(join(dir, 'responses', `design-${round}-approved.json`), designArchive(round))
  let manifest = designRow(ticketRel, 'r01', D_OLD, ['r01'])
  for (const ph of spec.oldPhases) {
    writeFileSync(join(dir, 'responses', `${ph.pid}-r01-approved.json`), phaseArchive(ph.pid))
    manifest += phaseRow(ticketRel, ph.pid, ph.ref)
  }
  // 설계 재승인 — 이 시점부터 앞선 phase의 결속이 끊긴다.
  manifest += designRow(ticketRel, 'r02', D_NEW, ['r01', 'r02'])
  for (const pid of spec.newPhases) {
    writeFileSync(join(dir, 'responses', `${pid}-r01-approved.json`), phaseArchive(pid))
    manifest += phaseRow(ticketRel, pid, D_NEW)
  }
  writeFileSync(join(dir, 'responses', 'approvals.jsonl'), manifest)

  if (spec.staleDevComplete) {
    const row: CloseProofRow = {
      ticket_id: spec.ticketId,
      event: 'dev-complete',
      series_id: null,
      resolution: null,
      phase_inventory: [...spec.oldPhases.map((p) => p.pid)].sort(),
      design_ref: D_OLD, // 🔴 옛 design_ref — 이것이 "낡음"의 정의다.
      at: ISO,
      reconstructed: false,
      evidence_basis: null,
    }
    writeFileSync(join(dir, 'responses', 'ticket-close.jsonl'), serializeCloseProofRow(row))
  }

  git(repo, ['add', '-A'])
  git(repo, ['commit', '-qm', `ticket ${spec.ticketId}`])
  return ticketRel
}

export const headBlob = (repo: string, rel: string): string | null => {
  try {
    return git(repo, ['show', `HEAD:${rel}`])
  } catch {
    return null
  }
}

export const commitCount = (repo: string): number => Number(git(repo, ['rev-list', '--count', 'HEAD']))
