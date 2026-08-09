import { describe, it, expect } from 'vitest'
import { planPhaseIds, autoFullReviewReason, type AutoFullInput } from '../../scripts/req/lib/full-review'

const PLAN_A = `# 계획

## Phase 1 — 코어 (\`phase-1-core\`)
범위: …

## Phase 2 — 배선 (\`phase-2-wiring\`)
범위: … 본문에서 \`phase-9-mentioned\` 를 언급만 한다.
`

function inp(over: Partial<AutoFullInput>): AutoFullInput {
  return {
    baselineState: 'valid',
    delta: { changed: ['design'], unchanged: ['requirement', 'plan'] },
    baselinePlanBody: PLAN_A,
    currentPlanBody: PLAN_A,
    ...over,
  }
}

describe('planPhaseIds — 헤딩 선언만 센다', () => {
  it('## 헤딩 줄의 백틱 phase id 집합을 뽑는다(본문 언급 제외)', () => {
    expect(planPhaseIds(PLAN_A)).toEqual(new Set(['phase-1-core', 'phase-2-wiring']))
  })
  it('빈 본문 → 빈 집합', () => {
    expect(planPhaseIds('')).toEqual(new Set())
  })
})

describe('autoFullReviewReason — 결정적 판정(설계 DEC-1)', () => {
  it('baseline 부재 → no-baseline (기록용 — 동작은 원래 full)', () => {
    expect(autoFullReviewReason(inp({ baselineState: 'absent', delta: null, baselinePlanBody: null }))).toBe('no-baseline')
  })
  it('baseline 손상 → invalid-baseline', () => {
    expect(autoFullReviewReason(inp({ baselineState: 'invalid', delta: null, baselinePlanBody: null }))).toBe('invalid-baseline')
  })
  it('전 문서 변경 → all-docs-changed (완료 기준 1)', () => {
    expect(
      autoFullReviewReason(inp({ delta: { changed: ['requirement', 'design', 'plan'], unchanged: [] } })),
    ).toBe('all-docs-changed')
  })
  it('phase 집합 변경(추가) → phase-structure-changed (완료 기준 2)', () => {
    const current = `${PLAN_A}\n## Phase 3 — 신규 (\`phase-3-new\`)\n`
    expect(autoFullReviewReason(inp({ currentPlanBody: current }))).toBe('phase-structure-changed')
  })
  it('phase 집합 변경(삭제·개명) → phase-structure-changed', () => {
    const removed = `# 계획\n\n## Phase 1 — 코어 (\`phase-1-core\`)\n`
    const renamed = PLAN_A.replace('phase-2-wiring', 'phase-2-renamed')
    expect(autoFullReviewReason(inp({ currentPlanBody: removed }))).toBe('phase-structure-changed')
    expect(autoFullReviewReason(inp({ currentPlanBody: renamed }))).toBe('phase-structure-changed')
  })
  it('일부 변경 + 집합 동일 → null(델타 유지 — 과잉 full 전환은 비용 회귀다, 완료 기준 3)', () => {
    expect(autoFullReviewReason(inp({}))).toBeNull()
  })
  it('변경 0(baseline==current)도 null — 델타 게이트는 기존대로 hasDesignBaseline', () => {
    expect(autoFullReviewReason(inp({ delta: { changed: [], unchanged: ['requirement', 'design', 'plan'] } }))).toBeNull()
  })
  it('baseline plan 읽기 실패(null) → 구조 비교 건너뜀 — 모르는 것으로 강제 전환하지 않는다(DEC-1)', () => {
    const current = `${PLAN_A}\n## Phase 3 — 신규 (\`phase-3-new\`)\n`
    expect(autoFullReviewReason(inp({ baselinePlanBody: null, currentPlanBody: current }))).toBeNull()
  })
  it('방어: valid인데 delta null → invalid-baseline(정상 경로 도달 불가·fail-safe 방향은 full)', () => {
    expect(autoFullReviewReason(inp({ delta: null }))).toBe('invalid-baseline')
  })
})
