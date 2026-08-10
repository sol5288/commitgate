import { describe, it, expect } from 'vitest'
import { computeExit } from '../../scripts/req/lib/verify-range'
import { BOOKKEEPING_TRAILER } from '../../scripts/req/lib/bookkeeping'

const SHA_A = 'a'.repeat(40)
const SHA_B = 'b'.repeat(40)
const SHA_C = 'c'.repeat(40)
const SHA_D = 'd'.repeat(40)

// ═══════════════════════════ 심층 검증 (REQ-2026-127 phase-1) ═══════════════════════════
import { verifyRangeDeep, type DeepCommitMeta, type DeepVerifyInput } from '../../scripts/req/lib/verify-range'

const TICKET = 'workflow/REQ-2026-001'
const RESP = `${TICKET}/responses/phase-1-r01-approved.json`
const SHA256_OK = 'f'.repeat(64)
const TREE_A = '9'.repeat(40)

function deepCommit(over: Partial<DeepCommitMeta>): DeepCommitMeta {
  return { sha: SHA_A, parentCount: 1, subject: 'feat: x', message: 'feat: x', changedPaths: ['src/a.ts'], ccPaths: [], ...over }
}

/** validateManifest를 통과하는 유효 phase 소비 행. */
function validRow(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    kind: 'phase',
    phase_id: 'phase-1',
    response_path: RESP,
    response_sha256: SHA256_OK,
    review_base_sha: SHA_B,
    approved_tree: SHA_C,
    approved_at: '2026-08-10T00:00:00.000Z',
    consumed_at: '2026-08-10T00:00:01.000Z',
    consumed_by_commit_sha: SHA_A,
    user_commit_confirmed: null,
    ...over,
  })
}

function deepInput(over: Partial<DeepVerifyInput> = {}): DeepVerifyInput {
  return {
    commits: [deepCommit({})],
    manifests: [{ path: `${TICKET}/responses/approvals.jsonl`, content: `${validRow()}\n` }],
    ticketRoot: 'workflow',
    statePhases: new Map([[TICKET, ['phase-1']]]),
    attestations: [],
    attestationProblems: 0,
    commitTrees: new Map([[SHA_A, TREE_A]]),
    archiveSha256: new Map([[RESP, SHA256_OK]]),
    ...over,
  }
}

describe('verifyRangeDeep — 심층 approved(완료 기준 1)', () => {
  it('유효 행 + 아카이브 실재·해시 일치 → approved', () => {
    const r = verifyRangeDeep(deepInput())
    expect(r.entries[0]?.category).toBe('approved')
    expect(r.invalid).toEqual([])
    expect(r.verificationNotes).toEqual([])
  })

  it('행 스키마 위반(response_sha256 형식) → invalid-evidence + 문제 목록', () => {
    const r = verifyRangeDeep(
      deepInput({ manifests: [{ path: `${TICKET}/responses/approvals.jsonl`, content: `${validRow({ response_sha256: 'short' })}\n` }] }),
    )
    // 스키마 위반 행은 소비 행 수집 단계(관대)는 통과하고 심층 검증에서 걸린다.
    expect(r.entries[0]?.category).toBe('invalid-evidence')
    expect(r.invalid[0]?.problems.some((p) => p.includes('response_sha256'))).toBe(true)
  })

  it('아카이브가 head tree에 없음 → invalid-evidence', () => {
    const r = verifyRangeDeep(deepInput({ archiveSha256: new Map() }))
    expect(r.entries[0]?.category).toBe('invalid-evidence')
    expect(r.invalid[0]?.problems[0]).toContain('head tree에 없습니다')
  })

  it('아카이브 SHA-256 불일치 → invalid-evidence', () => {
    const r = verifyRangeDeep(deepInput({ archiveSha256: new Map([[RESP, 'e'.repeat(64)]]) }))
    expect(r.entries[0]?.category).toBe('invalid-evidence')
    expect(r.invalid[0]?.problems[0]).toContain('SHA-256 불일치')
  })

  it('같은 SHA 소비 행 2개(중복 소비) → invalid-evidence', () => {
    const content = `${validRow()}\n${validRow({ response_path: `${TICKET}/responses/phase-2-r01-approved.json`, phase_id: 'phase-2' })}\n`
    const r = verifyRangeDeep(
      deepInput({ manifests: [{ path: `${TICKET}/responses/approvals.jsonl`, content }], statePhases: new Map([[TICKET, ['phase-1', 'phase-2']]]) }),
    )
    expect(r.entries[0]?.category).toBe('invalid-evidence')
    expect(r.invalid[0]?.problems[0]).toContain('중복 소비')
  })

  it('blob 읽기 실패(null) → 손상 단정 대신 unproven + note(failure mode)', () => {
    const r = verifyRangeDeep(deepInput({ archiveSha256: new Map([[RESP, null]]) }))
    expect(r.entries[0]?.category).toBe('unproven')
    expect(r.unproven[0]?.note).toContain('검증 불가')
    expect(r.invalid).toEqual([])
  })

  it('state phases 부재 → phase_id 검사 축소 + verificationNotes 표기(위양성 없음)', () => {
    const r = verifyRangeDeep(deepInput({ statePhases: new Map() }))
    expect(r.entries[0]?.category).toBe('approved')
    expect(r.verificationNotes.some((n) => n.includes('검증 축소') && n.includes(TICKET))).toBe(true)
  })
})

describe('verifyRangeDeep — bookkeeping 경로 검증(완료 기준 2)', () => {
  const trailerMsg = `chore: ledger\n\n${BOOKKEEPING_TRAILER}`

  it('trailer + ticketRoot 하위만 변경 → bookkeeping', () => {
    const r = verifyRangeDeep(
      deepInput({ commits: [deepCommit({ sha: SHA_D, message: trailerMsg, changedPaths: [`${TICKET}/responses/review-ledger.jsonl`] })] }),
    )
    expect(r.entries[0]?.category).toBe('bookkeeping')
  })

  it('trailer + 사용자 코드 혼입 → invalid-evidence(경로 표시)', () => {
    const r = verifyRangeDeep(
      deepInput({ commits: [deepCommit({ sha: SHA_D, message: trailerMsg, changedPaths: [`${TICKET}/state.json`, 'src/payment.ts'] })] }),
    )
    expect(r.entries[0]?.category).toBe('invalid-evidence')
    expect(r.invalid[0]?.problems[0]).toContain('src/payment.ts')
  })
})

describe('verifyRangeDeep — merge·attestation(완료 기준 3)', () => {
  const att = { schema_version: 1 as const, sha: SHA_A, tree: TREE_A, reason: 'release 커밋', attested_at: '2026-08-10T00:00:00.000Z', attested_by: 't <t@t>' }

  it('cc 산출 없는 merge → merge', () => {
    const r = verifyRangeDeep(deepInput({ commits: [deepCommit({ parentCount: 2, changedPaths: [], ccPaths: [] })], manifests: [] }))
    expect(r.entries[0]?.category).toBe('merge')
  })

  it('cc 산출 있는 merge → unproven + attest 안내 note', () => {
    const r = verifyRangeDeep(deepInput({ commits: [deepCommit({ parentCount: 2, ccPaths: ['src/a.ts'] })], manifests: [] }))
    expect(r.entries[0]?.category).toBe('unproven')
    expect(r.unproven[0]?.note).toContain('attest')
  })

  it('cc 산출 있는 merge + 유효 attestation → attested', () => {
    const r = verifyRangeDeep(
      deepInput({ commits: [deepCommit({ parentCount: 2, ccPaths: ['src/a.ts'] })], manifests: [], attestations: [att] }),
    )
    expect(r.entries[0]?.category).toBe('attested')
  })

  it('일반 미입증 커밋 + 유효 attestation → attested / tree 불일치는 무효 + note', () => {
    const ok = verifyRangeDeep(deepInput({ manifests: [], attestations: [att] }))
    expect(ok.entries[0]?.category).toBe('attested')
    const bad = verifyRangeDeep(deepInput({ manifests: [], attestations: [{ ...att, tree: '8'.repeat(40) }] }))
    expect(bad.entries[0]?.category).toBe('unproven')
    expect(bad.verificationNotes.some((n) => n.includes('attestation 무효'))).toBe(true)
  })

  it('invalid-evidence는 attestation으로 구제되지 않는다(구제 불가 원칙)', () => {
    const r = verifyRangeDeep(deepInput({ archiveSha256: new Map([[RESP, 'e'.repeat(64)]]), attestations: [att] }))
    expect(r.entries[0]?.category).toBe('invalid-evidence')
  })
})

describe('computeExit — invalid 계상(REQ-2026-127 R3)', () => {
  it('strict에서 invalid만 있어도 1, attested는 비계상, invalidCount 생략은 구계약과 동일', () => {
    expect(computeExit({ unprovenCount: 0, invalidCount: 1, strict: true, ci: 'skipped-default' })).toBe(1)
    expect(computeExit({ unprovenCount: 0, invalidCount: 0, strict: true, ci: 'skipped-default' })).toBe(0)
    expect(computeExit({ unprovenCount: 0, strict: true, ci: 'skipped-default' })).toBe(0)
    expect(computeExit({ unprovenCount: 1, strict: false, ci: 'skipped-default' })).toBe(0)
  })
})
