import { describe, it, expect } from 'vitest'
import {
  classifyCommit,
  consumedShasFromManifests,
  verifyRange,
  computeExit,
  type CommitMeta,
} from '../../scripts/req/lib/verify-range'
import { BOOKKEEPING_TRAILER } from '../../scripts/req/lib/bookkeeping'

const SHA_A = 'a'.repeat(40)
const SHA_B = 'b'.repeat(40)
const SHA_C = 'c'.repeat(40)
const SHA_D = 'd'.repeat(40)

function commit(over: Partial<CommitMeta>): CommitMeta {
  return { sha: SHA_A, parentCount: 1, subject: 'feat: x', message: 'feat: x', ...over }
}

/** approvals.jsonl 한 행(필수 키만 — 분류가 읽는 것은 consumed_by_commit_sha뿐). */
function manifestRow(consumedBy: string): string {
  return JSON.stringify({ kind: 'phase', phase_id: 'p1', consumed_by_commit_sha: consumedBy })
}

describe('consumedShasFromManifests', () => {
  it('여러 manifest에서 consumed_by_commit_sha 집합을 뽑는다(빈 줄 무시)', () => {
    const r = consumedShasFromManifests([`${manifestRow(SHA_A)}\n\n${manifestRow(SHA_B)}\n`, manifestRow(SHA_C)])
    expect(r.shas).toEqual(new Set([SHA_A, SHA_B, SHA_C]))
    expect(r.problems).toBe(0)
  })

  it('JSON 파싱 실패 행은 건너뛰되 problems로 센다 — 손상 하나가 전체를 죽이지 않는다(DEC-2)', () => {
    const r = consumedShasFromManifests([`not-json\n${manifestRow(SHA_A)}\n`])
    expect(r.shas).toEqual(new Set([SHA_A]))
    expect(r.problems).toBe(1)
  })

  it('consumed_by_commit_sha 키가 있는데 OID가 아니면 problems — 키가 없는 행(rebind 등)은 소비 행이 아니므로 조용히 통과', () => {
    const rebindRow = JSON.stringify({ kind: 'rebind', phase_id: 'p1', to_design_ref: 'x' }) // 실재하는 행 유형(REQ-2026-069)
    const r = consumedShasFromManifests([`${rebindRow}\n${JSON.stringify({ consumed_by_commit_sha: 'zzz' })}\n`])
    expect(r.shas.size).toBe(0)
    expect(r.problems).toBe(1)
  })
})

describe('classifyCommit — 판정 순서 merge → bookkeeping → approved → unproven (DEC-2)', () => {
  const consumed = new Set([SHA_B])

  it('부모 2개 이상이면 merge — trailer·승인 소비보다 앞선다', () => {
    const c = commit({ sha: SHA_B, parentCount: 2, message: `merge\n\n${BOOKKEEPING_TRAILER}` })
    expect(classifyCommit(c, consumed)).toBe('merge')
  })

  it('trailer 줄이 있으면 bookkeeping — 승인 소비 집합에 있어도 bookkeeping이 이긴다', () => {
    const c = commit({ sha: SHA_B, message: `chore(REQ-x): ledger\n\n${BOOKKEEPING_TRAILER}` })
    expect(classifyCommit(c, consumed)).toBe('bookkeeping')
  })

  it('trailer는 줄 단위 일치다 — 본문 산문에 섞인 언급은 부기가 아니다', () => {
    const c = commit({ sha: SHA_C, message: `docs: ${BOOKKEEPING_TRAILER} 를 설명한다` })
    expect(classifyCommit(c, new Set())).toBe('unproven')
  })

  it('승인 소비 집합에 있으면 approved', () => {
    expect(classifyCommit(commit({ sha: SHA_B }), consumed)).toBe('approved')
  })

  it('어디에도 없으면 unproven', () => {
    expect(classifyCommit(commit({ sha: SHA_D }), consumed)).toBe('unproven')
  })
})

describe('verifyRange', () => {
  it('4범주 counts와 미입증 목록을 산출한다', () => {
    const commits: CommitMeta[] = [
      commit({ sha: SHA_A, parentCount: 2, subject: 'Merge branch' }),
      commit({ sha: SHA_B, subject: 'chore: ledger', message: `chore: ledger\n\n${BOOKKEEPING_TRAILER}` }),
      commit({ sha: SHA_C, subject: 'feat: approved work' }),
      commit({ sha: SHA_D, subject: 'chore: commitgate setup' }),
    ]
    const report = verifyRange({ commits, manifestContents: [manifestRow(SHA_C)] })
    expect(report.counts).toEqual({ merge: 1, bookkeeping: 1, approved: 1, unproven: 1 })
    expect(report.unproven).toEqual([{ sha: SHA_D, subject: 'chore: commitgate setup' }])
    expect(report.manifestProblems).toBe(0)
    expect(report.entries).toHaveLength(4)
  })

  it('빈 범위도 정상 수행이다(전 범주 0) — 검증 생략과 구별된다(완료 기준 8)', () => {
    const report = verifyRange({ commits: [], manifestContents: [] })
    expect(report.counts).toEqual({ merge: 0, bookkeeping: 0, approved: 0, unproven: 0 })
    expect(report.unproven).toEqual([])
  })
})

describe('computeExit — exit 계약(DEC-1·DEC-7)', () => {
  it('미입증이 있어도 기본은 0(보고 우선)', () => {
    expect(computeExit({ unprovenCount: 3, strict: false, ci: 'skipped-default' })).toBe(0)
  })
  it('--strict이고 미입증>0이면 1', () => {
    expect(computeExit({ unprovenCount: 1, strict: true, ci: 'skipped-default' })).toBe(1)
  })
  it('--strict이어도 미입증 0이면 0', () => {
    expect(computeExit({ unprovenCount: 0, strict: true, ci: 'skipped-explicit' })).toBe(0)
  })
  it('명시 요청한 CI 확인 실패는 strict와 무관하게 1(정책 12 — 실패를 조용히 무시하지 않는다)', () => {
    expect(computeExit({ unprovenCount: 0, strict: false, ci: 'checked-fail' })).toBe(1)
  })
  it('CI 확인 성공은 0', () => {
    expect(computeExit({ unprovenCount: 0, strict: false, ci: 'checked-ok' })).toBe(0)
  })
})
