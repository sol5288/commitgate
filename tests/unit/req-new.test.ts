import { describe, it, expect } from 'vitest'
import { validateSlug, nextReqId, branchName, buildInitialState, parseArgs } from '../../scripts/req/req-new'

describe('req:new — slug 검증', () => {
  it('kebab-case 허용', () => {
    expect(() => validateSlug('camera-hardfail')).not.toThrow()
    expect(() => validateSlug('a1-b2-c3')).not.toThrow()
  })
  it('대문자/공백/언더스코어/선후행 하이픈 거부', () => {
    expect(() => validateSlug('Camera')).toThrow()
    expect(() => validateSlug('a b')).toThrow()
    expect(() => validateSlug('a_b')).toThrow()
    expect(() => validateSlug('-x')).toThrow()
    expect(() => validateSlug('x-')).toThrow()
  })
})

describe('req:new — REQ id 채번(nextReqId)', () => {
  it('빈 목록이면 001', () => {
    expect(nextReqId(2026, [])).toBe('REQ-2026-001')
  })
  it('같은 연도 max+1, 3자리 zero-pad', () => {
    expect(nextReqId(2026, ['REQ-2026-001', 'REQ-2026-004', 'REQ-2025-009'])).toBe('REQ-2026-005')
  })
  it('다른 연도는 무시', () => {
    expect(nextReqId(2026, ['REQ-2025-099'])).toBe('REQ-2026-001')
  })
})

describe('req:new — 인자 파싱(parseArgs) fail-closed', () => {
  it('정상: slug + --risk HIGH + --run', () => {
    const o = parseArgs(['camera', '--risk', 'HIGH', '--run'])
    expect(o.slug).toBe('camera')
    expect(o.risk).toBe('HIGH')
    expect(o.run).toBe(true)
  })
  it('--risk 오타(HGIH)는 즉시 throw(조용한 LOW fallback 금지)', () => {
    expect(() => parseArgs(['camera', '--risk', 'HGIH'])).toThrow(/--risk/)
  })
  it('--risk 값 누락은 throw', () => {
    expect(() => parseArgs(['camera', '--risk'])).toThrow(/--risk/)
  })
  it('--title 값 누락은 throw', () => {
    expect(() => parseArgs(['camera', '--title'])).toThrow(/--title/)
  })
  it('알 수 없는 옵션은 throw', () => {
    expect(() => parseArgs(['camera', '--nope'])).toThrow(/알 수 없는/)
  })
  it('[P2] --root 수용(config 탐색 루트 주입)', () => {
    expect(parseArgs(['camera', '--root', '/some/dir']).root).toBe('/some/dir')
    expect(parseArgs(['camera']).root).toBe(null)
  })
  it('[P2] --root 값 누락은 throw', () => {
    expect(() => parseArgs(['camera', '--root'])).toThrow(/--root/)
  })
})

describe('req:new — 브랜치명/초기 state', () => {
  it('branchName (기본 prefix=feat/req- → behavior-preserving)', () => {
    expect(branchName('REQ-2026-001', 'camera-hardfail', 'feat/req-')).toBe('feat/req-2026-001-camera-hardfail')
  })
  it('[P2] branchName: config branchPrefix override', () => {
    expect(branchName('REQ-2026-001', 'camera-hardfail', 'feature/REQ-')).toBe('feature/REQ-2026-001-camera-hardfail')
  })
  it('buildInitialState 기본값(BOM 없는 writeState로 기록될 객체)', () => {
    const s = buildInitialState('REQ-2026-001', 'feat/req-2026-001-x', 'LOW')
    expect(s.id).toBe('REQ-2026-001')
    expect(s.phase).toBe('INTAKE')
    expect(s.commit_allowed).toBe(false)
    expect(s.risk_level).toBe('LOW')
    expect(s.approved_diff_hash).toBe(null)
  })

  it('[Phase2] buildInitialState: DEC-WF-027 design/phase 상태 필드 초기화', () => {
    const s = buildInitialState('REQ-2026-001', 'feat/req-2026-001-x', 'LOW')
    expect(s.design_approved).toBe(false)
    expect(s.design_approved_hash).toBe(null)
    expect(s.current_phase).toBe(null)
    expect(s.phases).toEqual([])
  })

  it('[REQ-016 A1] buildInitialState: 신규 REQ는 approval_evidence_required=true stamp(grandfathering 트리거)', () => {
    const s = buildInitialState('REQ-2026-001', 'feat/req-2026-001-x', 'LOW')
    expect(s.approval_evidence_required).toBe(true)
  })
})
