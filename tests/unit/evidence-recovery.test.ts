/**
 * REQ-2026-142 phase-2 — 복구 판정(순수).
 *
 * 🔴 이 스위트의 두 축: ① 거부 사유가 **전부 실제 입력으로 발화**한다(등록부가 장식이 아니다)
 *    ② 허용 집합은 **부분집합**이라 중단 지점에 따라 일부만 더러워도 통과한다(과잉 조임 금지).
 */
import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import {
  planEvidenceRecovery,
  RECOVERY_BLOCKED_REASONS,
  RECOVERY_GUIDANCE,
  type RecoveryFacts,
} from '../../scripts/req/lib/evidence-recovery'
import { buildPinnedInventory, canonicalInventoryForm } from '../../scripts/req/lib/evidence'
import type { ApprovalEvidence, PinnedInventoryItem } from '../../scripts/req/lib/review-types'

const hashUtf8 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex')
const H = (n: number): string => String(n).padStart(64, '0')

const T = 'workflow/REQ-2026-142'
const R01 = `${T}/responses/phase-phase-1-x-r01-needs-fix.json`
const R02 = `${T}/responses/phase-phase-1-x-r02-approved.json`
const TREE = 'a'.repeat(40)
const SRC = 'b'.repeat(40)

const ITEMS: PinnedInventoryItem[] = [
  { response_path: R01, sha256: H(1) },
  { response_path: R02, sha256: H(2) },
]
const PIN = buildPinnedInventory(ITEMS, 'phase', 'phase-1-x', R02, hashUtf8)

const EV: ApprovalEvidence = {
  response_path: R02,
  response_sha256: H(2),
  review_kind: 'phase',
  phase_id: 'phase-1-x',
  review_base_sha: 'c'.repeat(40),
  approved_tree: TREE,
  codex_thread_id: 't',
  machine_schema_version: '1.0.0',
  status: 'STEP_COMPLETE',
  commit_approved: 'yes',
  approved_at: '2026-08-14T00:00:00Z',
  archive_inventory: PIN,
}

const manifestLine = (over: Record<string, unknown> = {}): string =>
  `${JSON.stringify({
    kind: 'phase',
    phase_id: 'phase-1-x',
    response_path: R02,
    response_sha256: H(2),
    review_base_sha: 'c'.repeat(40),
    approved_tree: TREE,
    approved_at: '2026-08-14T00:00:00Z',
    consumed_at: '2026-08-14T00:01:00Z',
    consumed_by_commit_sha: SRC,
    user_commit_confirmed: null,
    archive_inventory: ITEMS,
    ...over,
  })}\n`

const facts = (over: Partial<RecoveryFacts> = {}): RecoveryFacts => ({
  ticketRel: T,
  commitAllowed: true,
  approvedDiffHash: TREE,
  approvalEvidence: EV,
  source: { sha: SRC, tree: TREE },
  headManifest: '',
  dirtyPaths: [R02, `${T}/responses/approvals.jsonl`],
  archiveSha: (p) => ITEMS.find((i) => i.response_path === p)?.sha256 ?? null,
  hashUtf8,
  ...over,
})

describe('등록부', () => {
  it('🔴 모든 사유에 안내가 있다(사유를 늘리면 안내가 강제된다)', () => {
    for (const r of RECOVERY_BLOCKED_REASONS) expect(RECOVERY_GUIDANCE[r]?.length ?? 0).toBeGreaterThan(10)
    expect(Object.keys(RECOVERY_GUIDANCE).sort()).toEqual([...RECOVERY_BLOCKED_REASONS].sort())
  })
})

describe('Ready — 정상 복구', () => {
  it('증거 미커밋 → evidence 부터 재개', () => {
    const p = planEvidenceRecovery(facts())
    expect(p.kind).toBe('ready')
    if (p.kind !== 'ready') return
    expect(p.resumeFrom).toBe('evidence')
    expect(p.allowlist).toContain(R01)
    expect(p.allowlist).toContain(R02)
    expect(p.allowlist).toContain(`${T}/responses/approvals.jsonl`)
    expect(p.allowlist).toContain(`${T}/state.json`)
  })

  it('HEAD 에 소비 행 있음 → consume 부터 재개', () => {
    const p = planEvidenceRecovery(facts({ headManifest: manifestLine() }))
    expect(p.kind === 'ready' && p.resumeFrom).toBe('consume')
  })

  it('🔴 허용 집합은 부분집합 — 매니페스트만 더러워도 Ready', () => {
    const p = planEvidenceRecovery(facts({ dirtyPaths: [`${T}/responses/approvals.jsonl`] }))
    expect(p.kind).toBe('ready')
  })

  it('🔴 아무것도 안 더러워도 Ready(멱등 재실행 — 할 일 없음으로 수렴)', () => {
    expect(planEvidenceRecovery(facts({ dirtyPaths: [] })).kind).toBe('ready')
  })

  it('원장·state 만 더러워도 Ready', () => {
    const p = planEvidenceRecovery(facts({ dirtyPaths: [`${T}/responses/review-ledger.jsonl`, `${T}/state.json`] }))
    expect(p.kind).toBe('ready')
  })

  it('needs-fix 라운드가 목록에 있어야 정상 복구가 된다(REQ-141 r06 회귀)', () => {
    const p = planEvidenceRecovery(facts({ dirtyPaths: [R01, R02] }))
    expect(p.kind).toBe('ready')
  })

  it('경로 구분자가 역슬래시여도 정규화한다', () => {
    const p = planEvidenceRecovery(facts({ dirtyPaths: [R02.replace(/\//g, '\\')] }))
    expect(p.kind).toBe('ready')
  })
})

describe('DEC-3a — 핀 없음의 두 뜻', () => {
  it('🔴 소비 후 state 만 미커밋 + HEAD 증거 있음 → checkpoint 재개', () => {
    const p = planEvidenceRecovery(
      facts({ approvalEvidence: null, commitAllowed: false, dirtyPaths: [`${T}/state.json`], headManifest: manifestLine() }),
    )
    expect(p.kind).toBe('ready')
    if (p.kind !== 'ready') return
    expect(p.resumeFrom).toBe('checkpoint')
    expect(p.allowlist).toEqual([`${T}/state.json`])
  })

  it('🔴 같은 상태라도 HEAD 에 증거가 없으면 거부 — "안 만들었다"와 구별된다', () => {
    const p = planEvidenceRecovery(
      facts({ approvalEvidence: null, commitAllowed: false, dirtyPaths: [`${T}/state.json`], headManifest: '' }),
    )
    expect(p.kind === 'blocked' && p.reason).toBe('not-a-recovery')
  })

  it('핀 없음 + state 외 변경 → 거부', () => {
    const p = planEvidenceRecovery(
      facts({ approvalEvidence: null, dirtyPaths: [`${T}/state.json`, R02], headManifest: manifestLine() }),
    )
    expect(p.kind === 'blocked' && p.reason).toBe('not-a-recovery')
  })

  it('핀 없음 + 더러운 것 없음 → 거부(복구할 게 없다)', () => {
    const p = planEvidenceRecovery(facts({ approvalEvidence: null, dirtyPaths: [], headManifest: manifestLine() }))
    expect(p.kind === 'blocked' && p.reason).toBe('not-a-recovery')
  })
})

describe('Blocked — 사유별 발화', () => {
  it('not-a-recovery: commit_allowed 아님', () => {
    expect(planEvidenceRecovery(facts({ commitAllowed: false })).kind).toBe('blocked')
  })

  it('not-a-recovery: source 미해소', () => {
    const p = planEvidenceRecovery(facts({ source: null }))
    expect(p.kind === 'blocked' && p.reason).toBe('not-a-recovery')
  })

  it('🔴 tree-mismatch: source tree 가 승인과 다르다', () => {
    const p = planEvidenceRecovery(facts({ source: { sha: SRC, tree: 'd'.repeat(40) } }))
    expect(p.kind === 'blocked' && p.reason).toBe('tree-mismatch')
  })

  it('tree-mismatch: approved_diff_hash 없음', () => {
    const p = planEvidenceRecovery(facts({ approvedDiffHash: null }))
    expect(p.kind === 'blocked' && p.reason).toBe('tree-mismatch')
  })

  it('🔴 inventory-absent: 옛 승인(핀 없음)은 열지 않는다', () => {
    const { archive_inventory: _drop, ...legacy } = EV
    const p = planEvidenceRecovery(facts({ approvalEvidence: legacy }))
    expect(p.kind === 'blocked' && p.reason).toBe('inventory-absent')
  })

  it('🔴 pin-divergent: state 핀과 HEAD 매니페스트 인벤토리가 다르다', () => {
    const p = planEvidenceRecovery(facts({ headManifest: manifestLine({ archive_inventory: [ITEMS[1]] }) }))
    expect(p.kind === 'blocked' && p.reason).toBe('pin-divergent')
  })

  it('🔴 inventory-tampered: 목록이 핀 해시와 안 맞는다', () => {
    const bad = { ...EV, archive_inventory: { ...PIN, inventory_sha256: H(9) } }
    const p = planEvidenceRecovery(facts({ approvalEvidence: bad }))
    expect(p.kind === 'blocked' && p.reason).toBe('inventory-tampered')
  })

  it('🔴 inventory-tampered: 항목을 몰래 끼워 넣으면 잡힌다', () => {
    const injected = [...ITEMS, { response_path: `${T}/responses/phase-phase-1-x-r99-approved.json`, sha256: H(9) }]
    const bad = { ...EV, archive_inventory: { ...PIN, items: injected } }
    const p = planEvidenceRecovery(facts({ approvalEvidence: bad }))
    expect(p.kind === 'blocked' && p.reason).toBe('inventory-tampered')
  })

  it('🔴 archive-mismatch: 파일 내용이 승인 시점과 다르다', () => {
    const p = planEvidenceRecovery(facts({ archiveSha: (pth) => (pth === R01 ? H(8) : H(2)) }))
    expect(p.kind === 'blocked' && p.reason).toBe('archive-mismatch')
  })

  it('🔴 archive-mismatch: 파일이 사라졌다', () => {
    const p = planEvidenceRecovery(facts({ archiveSha: (pth) => (pth === R01 ? null : H(2)) }))
    expect(p.kind === 'blocked' && p.reason).toBe('archive-mismatch')
  })

  it('🔴 inventory-unbound: 승인 응답이 목록 밖', () => {
    const other = buildPinnedInventory([ITEMS[0]!], 'phase', 'phase-1-x', R01, hashUtf8)
    const p = planEvidenceRecovery(facts({ approvalEvidence: { ...EV, archive_inventory: other } }))
    expect(p.kind === 'blocked' && p.reason).toBe('inventory-unbound')
  })

  it('🔴 inventory-unbound: 다른 승인의 핀을 갖다 붙였다(kind/phase 결속)', () => {
    const alien = buildPinnedInventory(ITEMS, 'design', null, R02, hashUtf8)
    const p = planEvidenceRecovery(facts({ approvalEvidence: { ...EV, archive_inventory: alien } }))
    expect(p.kind === 'blocked' && p.reason).toBe('inventory-unbound')
  })

  it('🔴 foreign-files: 소스 파일이 하나만 더러워도 거부', () => {
    const p = planEvidenceRecovery(facts({ dirtyPaths: [R02, 'scripts/req/req-commit.ts'] }))
    expect(p.kind === 'blocked' && p.reason).toBe('foreign-files')
  })

  it('🔴 foreign-files: 다른 티켓의 responses 도 거부', () => {
    const p = planEvidenceRecovery(facts({ dirtyPaths: ['workflow/REQ-2026-999/responses/approvals.jsonl'] }))
    expect(p.kind === 'blocked' && p.reason).toBe('foreign-files')
  })

  it('🔴 foreign-files: 인벤토리에 없는 아카이브 파일은 통과하지 못한다(주입 구멍 차단)', () => {
    const p = planEvidenceRecovery(facts({ dirtyPaths: [`${T}/responses/phase-phase-1-x-r99-approved.json`] }))
    expect(p.kind === 'blocked' && p.reason).toBe('foreign-files')
  })

  it('🔴 foreign-files: 티켓 설계 문서도 허용 범위 밖이다(증거 파일만 만진다)', () => {
    const p = planEvidenceRecovery(facts({ dirtyPaths: [`${T}/01-design.md`] }))
    expect(p.kind === 'blocked' && p.reason).toBe('foreign-files')
  })
})

describe('허용 목록의 모양', () => {
  it('허용 목록은 전부 이 티켓 안이다', () => {
    const p = planEvidenceRecovery(facts())
    if (p.kind !== 'ready') throw new Error('ready 여야 한다')
    for (const a of p.allowlist) expect(a.startsWith(`${T}/`)).toBe(true)
  })

  it('HEAD 행만 있고 state 핀이 없어도 그 목록으로 판정한다(durable 우선)', () => {
    const { archive_inventory: _drop, ...noPin } = EV
    const p = planEvidenceRecovery(facts({ approvalEvidence: noPin, headManifest: manifestLine() }))
    expect(p.kind).toBe('ready')
    if (p.kind !== 'ready') return
    expect(p.allowlist).toContain(R01)
    expect(canonicalInventoryForm(ITEMS)).toBe(canonicalInventoryForm([...ITEMS].reverse()))
  })
})
