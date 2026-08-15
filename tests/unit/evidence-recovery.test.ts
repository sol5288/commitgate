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
  consumedKeysAddedByHead,
  consumedKeysInState,
  consumedStateShaFor,
} from '../../scripts/req/lib/evidence-recovery'
import { consumedAtOfRow } from '../../scripts/req/req-commit'
import { findUnstagedOrUntracked } from '../../scripts/req/review-codex'
import { parseStatusZ } from '../../scripts/req/lib/porcelain'
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
  parentManifest: '',
  headStateText: null,
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

  /**
   * 🔴 **계약이 뒤집혔다**(REQ-2026-155 DEC-2). 여기 있던 "역슬래시여도 정규화한다"는 **틀린 동작을
   *    고정**하고 있었다 — D10 은 raw 경로를 비교하므로, plan 만 정규화하면 판정이 갈려
   *    "plan 은 ready 인데 실제 `--finalize` 는 D10 에 막히는" 교착이 생긴다.
   *    지우지 않고 반대 계약으로 남긴다.
   */
  it('🔴 역슬래시 경로를 정규화하지 않는다 — D10 과 판정이 갈리면 안 된다', () => {
    const p = planEvidenceRecovery(facts({ dirtyPaths: [R02.replace(/\//g, '\\')] }))
    expect(p.kind).toBe('blocked')
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

describe('[REQ-2026-150] 🔴 checkpoint 복구는 "이 소비의 증거"를 요구한다', () => {
  const T2 = 'workflow/REQ-2026-142'
  const stateRel = `${T2}/state.json`
  const consumed = (sha = SRC, phase = 'phase-1-x') =>
    JSON.stringify({ consumed_approvals: [{ consumed_by_commit_sha: sha, phase_id: phase, approval_consumed_at: '2026-08-14T00:01:00Z' }] })
  const cp = (over: Partial<RecoveryFacts> = {}) =>
    planEvidenceRecovery(facts({ approvalEvidence: null, commitAllowed: false, dirtyPaths: [stateRel], ...over }))

  it('🔴 정상 crash window — HEAD 가 방금 추가한 소비 행 + HEAD state 미기록 → Ready', () => {
    const p = cp({ headManifest: manifestLine(), parentManifest: '', headStateText: null })
    expect(p.kind).toBe('ready')
    if (p.kind === 'ready') expect(p.resumeFrom).toBe('checkpoint')
  })

  it('🔴 완료된 티켓 — HEAD^ 에도 같은 행이 있으면 거부(HEAD 가 추가한 것이 아니다)', () => {
    const p = cp({ headManifest: manifestLine(), parentManifest: manifestLine(), headStateText: consumed() })
    expect(p.kind === 'blocked' && p.reason).toBe('not-a-recovery')
    if (p.kind === 'blocked') expect(p.detail).toContain('evidence-finalize')
  })

  it('🔴 `approval_consumed_at` 만 변조해도 거부 — 시각은 동일성 키가 아니다', () => {
    const tampered = JSON.stringify({
      consumed_approvals: [{ consumed_by_commit_sha: SRC, phase_id: 'phase-1-x', approval_consumed_at: '2099-01-01T00:00:00Z' }],
    })
    const p = cp({ headManifest: manifestLine(), parentManifest: manifestLine(), headStateText: tampered })
    expect(p.kind === 'blocked' && p.reason).toBe('not-a-recovery')
  })

  it('🔴 legacy 티켓 — HEAD state 에 consumed_approvals 가 없어도 A 가 막는다', () => {
    // 옛 행만 있고 HEAD 가 추가한 것이 없다.
    const p = cp({ headManifest: manifestLine(), parentManifest: manifestLine(), headStateText: '{}' })
    expect(p.kind === 'blocked' && p.reason).toBe('not-a-recovery')
  })

  it('🔴 첫 phase 의 첫 소비는 통과한다(consumed_approvals 부재 = 빈 배열)', () => {
    const p = cp({ headManifest: manifestLine(), parentManifest: '', headStateText: '{"id":"REQ-2026-142"}' })
    expect(p.kind).toBe('ready')
  })

  it('HEAD state 에 이미 기록됐으면 거부(checkpoint 는 끝났다)', () => {
    const p = cp({ headManifest: manifestLine(), parentManifest: '', headStateText: consumed() })
    expect(p.kind === 'blocked' && p.reason).toBe('not-a-recovery')
    if (p.kind === 'blocked') expect(p.detail).toContain('이미 기록')
  })

  it('파손된 HEAD state 는 "기록 없음"으로 보고 A 가 판정의 무게를 진다', () => {
    expect(cp({ headManifest: manifestLine(), parentManifest: '', headStateText: '{ not json' }).kind).toBe('ready')
    expect(cp({ headManifest: manifestLine(), parentManifest: manifestLine(), headStateText: '{ not json' }).kind).toBe('blocked')
  })
})

describe('[REQ-2026-150] 판별자 헬퍼', () => {
  it('consumedKeysAddedByHead — HEAD 가 추가한 것만', () => {
    const a = JSON.stringify({ kind: 'phase', phase_id: 'p1', consumed_by_commit_sha: 'aaa' })
    const b = JSON.stringify({ kind: 'phase', phase_id: 'p2', consumed_by_commit_sha: 'bbb' })
    expect(consumedKeysAddedByHead(`${a}\n${b}\n`, `${a}\n`)).toEqual(['bbb#p2'])
    expect(consumedKeysAddedByHead(`${a}\n`, `${a}\n`)).toEqual([])
  })

  it('🔴 동일성 키에 시각이 없다', () => {
    const mk = (at: string) => JSON.stringify({ phase_id: 'p1', consumed_by_commit_sha: 'aaa', approval_consumed_at: at })
    expect(consumedKeysAddedByHead(`${mk('A')}\n`, `${mk('B')}\n`)).toEqual([])
  })

  it('consumedKeysInState — 부재·파손을 빈 배열로', () => {
    expect(consumedKeysInState(null)).toEqual([])
    expect(consumedKeysInState('{}')).toEqual([])
    expect(consumedKeysInState('{ bad')).toEqual([])
    expect(consumedKeysInState(JSON.stringify({ consumed_approvals: [{ consumed_by_commit_sha: 'x', phase_id: 'p' }] }))).toEqual(['x#p'])
  })
})

describe('[REQ-2026-151] 🔴 판별자 D — 소비 state 결속', () => {
  const T3 = 'workflow/REQ-2026-142'
  const stateRel3 = `${T3}/state.json`
  const STATE_SHA = 'e'.repeat(64)
  const boundLine = (sha: string | null) =>
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
      ...(sha === null ? {} : { consumed_state_sha256: sha }),
    })}\n`
  const cp = (over: Partial<RecoveryFacts> = {}) =>
    planEvidenceRecovery(
      facts({
        approvalEvidence: null,
        commitAllowed: false,
        dirtyPaths: [stateRel3],
        parentManifest: '',
        headStateText: null,
        ...over,
      }),
    )

  it('🔴 결속이 있고 워킹 state 가 일치하면 Ready', () => {
    const p = cp({ headManifest: boundLine(STATE_SHA), archiveSha: () => STATE_SHA })
    expect(p.kind).toBe('ready')
  })

  it('🔴 워킹 state 를 고치면 거부된다 — 임의 변경이 checkpoint 에 실리지 않는다', () => {
    const p = cp({ headManifest: boundLine(STATE_SHA), archiveSha: () => 'f'.repeat(64) })
    expect(p.kind === 'blocked' && p.reason).toBe('state-mismatch')
  })

  it('🔴 state.json 을 읽을 수 없으면 거부', () => {
    const p = cp({ headManifest: boundLine(STATE_SHA), archiveSha: () => null })
    expect(p.kind === 'blocked' && p.reason).toBe('state-mismatch')
  })

  it('🔴 결속이 없는 옛 행은 D 를 건너뛴다(하위호환 — 옛 crash window 를 막지 않는다)', () => {
    const p = cp({ headManifest: boundLine(null), archiveSha: () => 'f'.repeat(64) })
    expect(p.kind).toBe('ready')
  })

  /**
   * 🔴 REQ-2026-152 DEC-3: **형식 불량은 레거시가 아니다.** 강등하면 워킹 state 를 대조하지 않고
   *    `ready` 를 돌려줘 판별자 D 가 통째로 우회된다 — 이 분기가 그것을 막는다.
   *
   * 🔴 `validateManifest`(DEC-2)가 이미 막는데도 여기서 또 보는 이유: 이 판정은 `req:doctor` 에서도
   *    불리고, 그 경로가 매니페스트 검증을 거쳤다고 **가정하지 않는다**(REQ-2026-094 교훈).
   */
  it('🔴 형식 불량 결속은 state-mismatch — absent 로 강등돼 통과하지 않는다', () => {
    for (const bad of ['null', '0', '""', `"${'e'.repeat(63)}"`, `"g${'e'.repeat(63)}"`]) {
      const line = boundLine(STATE_SHA).replace(`"${STATE_SHA}"`, bad)
      // 워킹 state 가 무엇이든(일치해도) 거부한다 — 근거 자체가 잘못됐다.
      const p = cp({ headManifest: line, archiveSha: () => STATE_SHA })
      expect(p.kind === 'blocked' && p.reason, bad).toBe('state-mismatch')
    }
  })

  it('consumedStateShaFor — 대응하는 행에서만 읽는다', () => {
    expect(consumedStateShaFor(boundLine(STATE_SHA), [`${SRC}#phase-1-x`])).toEqual({ kind: 'bound', sha: STATE_SHA })
    expect(consumedStateShaFor(boundLine(STATE_SHA), ['other#p'])).toEqual({ kind: 'absent' })
    expect(consumedStateShaFor(boundLine(null), [`${SRC}#phase-1-x`])).toEqual({ kind: 'absent' })
  })
})

/**
 * 🔴 REQ-2026-152 DEC-3 — 형식 불량을 **레거시로 강등하지 않는다**.
 *
 * 등록만 하고 검증하지 않으면 `{"consumed_state_sha256": null}` 이 "결속 없음"으로 읽혀 판별자 D 를
 * 통째로 우회한다. 키의 **부재만** 레거시다.
 */
describe('[REQ-2026-152] consumedStateShaFor — 세 갈래', () => {
  const T4 = 'workflow/REQ-2026-142'
  const line = (v: unknown, omit = false) => {
    const row: Record<string, unknown> = {
      kind: 'phase',
      phase_id: 'phase-1-x',
      response_path: `${T4}/responses/phase-phase-1-x-r02-approved.json`,
      response_sha256: H(2),
      review_base_sha: 'c'.repeat(40),
      approved_tree: TREE,
      approved_at: '2026-08-14T00:00:00Z',
      consumed_at: '2026-08-14T00:01:00Z',
      consumed_by_commit_sha: SRC,
      user_commit_confirmed: null,
    }
    if (!omit) row.consumed_state_sha256 = v
    return `${JSON.stringify(row)}\n`
  }
  const keys = [`${SRC}#phase-1-x`]

  it('🔴 키 부재만 absent 다 — 레거시 무회귀', () => {
    expect(consumedStateShaFor(line(null, true), keys)).toEqual({ kind: 'absent' })
  })

  /**
   * 🔴 REQ-2026-154(결함 4): **소문자로 정규화해 돌려준다.** `SHA256_RE` 는 대소문자를 받는데
   *    비교 상대인 `createHash(...).digest('hex')` 는 항상 소문자다 — 그대로 돌려주면 "유효하다고
   *    받아 놓고 비교에서 막는" 모순이 된다.
   */
  it('🔴 64hex 는 bound — 대문자도 받되 **소문자로 정규화**해 돌려준다', () => {
    expect(consumedStateShaFor(line('e'.repeat(64)), keys)).toEqual({ kind: 'bound', sha: 'e'.repeat(64) })
    expect(consumedStateShaFor(line('E'.repeat(64)), keys)).toEqual({ kind: 'bound', sha: 'e'.repeat(64) })
    expect(consumedStateShaFor(line(`AbCd${'e'.repeat(60)}`), keys)).toEqual({
      kind: 'bound',
      sha: `abcd${'e'.repeat(60)}`,
    })
  })

  it('🔴 대문자 결속이 정상 복구를 막지 않는다(checkpoint 판정)', () => {
    const upper = 'E'.repeat(64)
    const p = planEvidenceRecovery(
      facts({
        approvalEvidence: null,
        commitAllowed: false,
        dirtyPaths: ['workflow/REQ-2026-142/state.json'],
        parentManifest: '',
        headStateText: null,
        headManifest: line(upper),
        archiveSha: () => 'e'.repeat(64),
      }),
    )
    expect(p.kind).toBe('ready')
  })

  it('🔴 형식 불량은 전부 malformed — absent 로 강등되지 않는다', () => {
    for (const bad of [null, 0, 123, '', 'e'.repeat(63), 'e'.repeat(65), `g${'e'.repeat(63)}`, true, ['e'.repeat(64)], {}])
      expect(consumedStateShaFor(line(bad), keys), JSON.stringify(bad)).toMatchObject({ kind: 'malformed' })
  })

  it('🔴 `undefined` 를 명시한 행도 malformed 다 — 키가 있으면 값을 요구한다', () => {
    // JSON 에는 undefined 가 없으므로 직접 만든 줄로 확인한다(JSON.stringify 는 키를 지운다).
    const raw = line('e'.repeat(64)).replace(`"${'e'.repeat(64)}"`, 'null')
    expect(consumedStateShaFor(raw, keys)).toMatchObject({ kind: 'malformed' })
  })
})

describe('[REQ-2026-151] consumedAtOfRow — 멱등 skip 이 소비 시각을 다시 쓴다', () => {
  /**
   * 🔴 **범위 고지**: 이 헬퍼가 실제로 바이트를 좌우하는 창(`resumeFrom: 'consume'`)의 **CLI e2e 는
   *    만들지 않았다** — 승인 핀·인벤토리·tree 일치까지 갖춘 fixture 가 필요하다. 여기서는 순수
   *    동작만 고정하고, 호출부는 `evidence-recovery-wiring.test.ts` 의 소스 가드가 잡는다.
   *    (checkpoint 창은 `finalizeEvidenceAndConsume` 을 아예 부르지 않아 이 헬퍼를 지나지 않는다.)
   */
  const ev = { review_kind: 'phase' as const, phase_id: 'p1', response_sha256: H(3) }
  const row = (over: Record<string, unknown> = {}) =>
    `${JSON.stringify({
      kind: 'phase',
      phase_id: 'p1',
      response_path: R02,
      response_sha256: H(3),
      review_base_sha: 'c'.repeat(40),
      approved_tree: TREE,
      approved_at: '2026-08-14T00:00:00Z',
      consumed_at: '2026-08-14T00:01:00Z',
      consumed_by_commit_sha: SRC,
      user_commit_confirmed: null,
      ...over,
    })}\n`

  it('🔴 대응하는 행의 consumed_at 을 돌려준다', () => {
    expect(consumedAtOfRow(row(), SRC, ev)).toBe('2026-08-14T00:01:00Z')
  })

  it('🔴 결속 요소가 하나라도 다르면 null — 남의 행 시각을 갖다 쓰지 않는다', () => {
    expect(consumedAtOfRow(row(), 'f'.repeat(40), ev)).toBeNull()
    expect(consumedAtOfRow(row({ phase_id: 'p2' }), SRC, ev)).toBeNull()
    expect(consumedAtOfRow(row({ response_sha256: H(9) }), SRC, ev)).toBeNull()
    expect(consumedAtOfRow(row({ kind: 'design', phase_id: null }), SRC, ev)).toBeNull()
  })

  it('빈 매니페스트는 null(정상 경로가 새 시각을 잡는다)', () => {
    expect(consumedAtOfRow('', SRC, ev)).toBeNull()
  })
})

/**
 * 🔴 REQ-2026-155 DEC-2 — **복구 plan 과 D10 의 판정이 갈리지 않는다.**
 *
 * plan 만 경로를 정규화하면 "plan 은 ready 인데 실제 `--finalize` 는 D10 에 막히는" 교착이 생긴다.
 * 도구가 복구 가능하다고 판정한 명령이 실행 불가인 것 — 이 저장소가 반복해 밟은 부류다.
 */
describe('[REQ-2026-155] 🔴 plan 과 D10 이 같은 판정을 낸다', () => {
  const BS = String.fromCharCode(92)
  const zOf = (p: string): ReturnType<typeof parseStatusZ> => parseStatusZ(` M ${p}\u0000`)

  for (const [label, path] of [
    ['정상 POSIX 경로', R02],
    ['리터럴 역슬래시 경로', R02.replace(/\//g, BS)],
  ] as [string, string][]) {
    it(`🔴 ${label} — plan 이 ready 면 D10 도 통과, blocked 면 D10 도 차단`, () => {
      const plan = planEvidenceRecovery(facts({ dirtyPaths: [path] }))
      const allowlist = plan.kind === 'ready' ? plan.allowlist : []
      const dirty = findUnstagedOrUntracked(zOf(path), [], T, allowlist)
      // 🔴 두 판정이 **같은 방향**이어야 한다. 갈리는 순간 안내한 명령이 실행 불가다.
      expect(plan.kind === 'ready', `${label}: plan=${plan.kind} · D10 dirty=${dirty.length}`).toBe(dirty.length === 0)
    })
  }
})
