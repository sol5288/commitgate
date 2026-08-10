import { describe, it, expect } from 'vitest'
import { planIntegration, decideCiRun, type IntegrationFacts } from '../../scripts/req/lib/merge-gate'

/** REQ-2026-126 phase-2 — MergeGate 순수 코어. */

const okFacts = (over: Partial<IntegrationFacts> = {}): IntegrationFacts => ({
  currentBranch: 'feat/req-2026-999-x',
  trunkBranch: 'main',
  branchPrefix: 'feat/req-',
  worktreeClean: true,
  mergeInProgress: false,
  rebaseInProgress: false,
  trunkExists: true,
  verify: {
    counts: { merge: 1, bookkeeping: 3, approved: 2, unproven: 0 },
    manifestProblems: 0,
    unproven: [],
  },
  ...over,
})

describe('planIntegration — 전제 거부(각 독립)', () => {
  it('전부 충족 → ok + 실행 단계 순서(checkout → merge --no-ff → 감사 로그)', () => {
    const p = planIntegration(okFacts())
    expect(p.ok).toBe(true)
    expect(p.problems).toEqual([])
    expect(p.steps).toHaveLength(3)
    expect(p.steps[0]).toContain('checkout main')
    expect(p.steps[1]).toContain('merge --no-ff feat/req-2026-999-x')
    expect(p.steps[2]).toContain('push는 하지 않습니다')
  })

  it('trunk 위에서 실행 → 거부(자기 병합 금지)', () => {
    const p = planIntegration(okFacts({ currentBranch: 'main' }))
    expect(p.ok).toBe(false)
    expect(p.problems.some((x) => x.includes('자기 병합'))).toBe(true)
  })

  it('branchPrefix 불일치 → 거부', () => {
    const p = planIntegration(okFacts({ currentBranch: 'hotfix/x' }))
    expect(p.ok).toBe(false)
    expect(p.problems.some((x) => x.includes('feature 브랜치가 아닙니다'))).toBe(true)
  })

  it('dirty worktree → 거부 + 자동 stash 없음 명시', () => {
    const p = planIntegration(okFacts({ worktreeClean: false }))
    expect(p.ok).toBe(false)
    expect(p.problems.some((x) => x.includes('자동 stash 하지 않습니다'))).toBe(true)
  })

  it('merge 진행 중 → 단독으로 거부(rebase 무관)', () => {
    const p = planIntegration(okFacts({ mergeInProgress: true }))
    expect(p.ok).toBe(false)
    expect(p.problems.some((x) => x.includes('merge가 있습니다'))).toBe(true)
  })

  it('rebase 진행 중 → 단독으로 거부(merge 무관 — 설계 r02 P1)', () => {
    const p = planIntegration(okFacts({ rebaseInProgress: true }))
    expect(p.ok).toBe(false)
    expect(p.problems.some((x) => x.includes('rebase'))).toBe(true)
  })

  it('trunk null / trunk ref 부재 → 각각 거부', () => {
    expect(planIntegration(okFacts({ trunkBranch: null })).ok).toBe(false)
    const p = planIntegration(okFacts({ trunkExists: false }))
    expect(p.ok).toBe(false)
    expect(p.problems.some((x) => x.includes('로컬에 없습니다'))).toBe(true)
  })

  it('사유는 한 번에 전부 나열된다(두더지잡기 방지)', () => {
    const p = planIntegration(okFacts({ worktreeClean: false, rebaseInProgress: true, currentBranch: 'hotfix/x' }))
    expect(p.problems.length).toBeGreaterThanOrEqual(3)
  })
})

describe('planIntegration — 항상 strict 증거 판정', () => {
  it('미입증 > 0 → 차단 + 각 커밋(sha 8자리·subject) 목록 포함(설계 r03 P1)', () => {
    const p = planIntegration(
      okFacts({
        verify: {
          counts: { merge: 0, bookkeeping: 0, approved: 1, unproven: 2 },
          manifestProblems: 0,
          unproven: [
            { sha: 'a'.repeat(40), subject: 'chore: setup' },
            { sha: 'b'.repeat(40), subject: 'wip' },
          ],
        },
      }),
    )
    expect(p.ok).toBe(false)
    expect(p.steps).toEqual([])
    expect(p.problems.some((x) => x.includes('strict'))).toBe(true)
    expect(p.problems.some((x) => x.includes('aaaaaaaa') && x.includes('chore: setup'))).toBe(true)
    expect(p.problems.some((x) => x.includes('bbbbbbbb') && x.includes('wip'))).toBe(true)
  })

  it('manifest 문제 > 0 → 차단', () => {
    const p = planIntegration(
      okFacts({ verify: { counts: { merge: 0, bookkeeping: 0, approved: 1, unproven: 0 }, manifestProblems: 2, unproven: [] } }),
    )
    expect(p.ok).toBe(false)
    expect(p.problems.some((x) => x.includes('approvals.jsonl'))).toBe(true)
  })

  it('verify 미계산(null) → 차단(추정하지 않는다)', () => {
    expect(planIntegration(okFacts({ verify: null })).ok).toBe(false)
  })
})

describe('decideCiRun — 결정표(설계 DEC-2)', () => {
  it.each([
    // [flag, configured, interactive, expected]
    [true, true, true, 'run'],
    [true, true, false, 'run'],
    [true, false, true, 'fail-no-config'], // 명시 요청인데 config 없음 → 명확 실패
    [true, false, false, 'fail-no-config'],
    [false, true, true, 'skip'], // 명시 생략은 언제나 생략
    [false, false, false, 'skip'],
    [null, true, true, 'ask'], // config 있고 대화형일 때만 질문
    [null, true, false, 'skip'], // 비대화형은 명시 옵션 없이는 절대 실행 안 함
    [null, false, true, 'skip'], // config 없으면 질문 자체를 생략(정상)
    [null, false, false, 'skip'],
  ] as const)('flag=%s configured=%s interactive=%s → %s', (flag, configured, interactive, expected) => {
    expect(decideCiRun({ flag, configured, interactive })).toBe(expected)
  })
})
