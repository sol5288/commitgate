import { describe, it, expect } from 'vitest'
import { parseArgs, confirmSentence, planRebind } from '../../scripts/req/req-rebind'
import { resolveDispatch, VERB_MODULES } from '../../bin/dispatch.mjs'
import { STAGE_B_REQ_VERBS, STAGE_B_REQ_SCRIPTS } from '../../bin/init'

/**
 * REQ-2026-069 phase-2 — `req:rebind` verb.
 *
 * 🔴 헤드라인: **재결속은 판단을 대신하지 않는다.** "이 설계 변경이 그 phase의 검수를 무효화하는가"는
 *    도구가 알 수 없으므로 확인 문구 없이는 아무 일도 일어나지 않고, 대상은 **현재 승인된 설계**로만 묶인다.
 */

const D1 = '1'.repeat(64)
const D2 = '2'.repeat(64)
const TICKET = 'workflow/REQ-2026-001'
const iso = '2026-07-27T00:00:00.000Z'

const phaseRow = (pid: string, designRef?: string) =>
  JSON.stringify({
    kind: 'phase',
    phase_id: pid,
    response_path: `${TICKET}/responses/${pid}-r01-approved.json`,
    response_sha256: 'a'.repeat(64),
    review_base_sha: 'b'.repeat(40),
    approved_tree: 'c'.repeat(40),
    ...(designRef ? { phase_design_ref: designRef } : {}),
    approved_at: iso,
    consumed_at: iso,
    consumed_by_commit_sha: 'd'.repeat(40),
    user_commit_confirmed: null,
  })

const designRow = (h: string) =>
  JSON.stringify({
    kind: 'design',
    phase_id: null,
    response_path: `${TICKET}/responses/design-r01-approved.json`,
    response_sha256: 'a'.repeat(64),
    review_base_sha: 'b'.repeat(40),
    design_hash: h,
    approved_at: iso,
    consumed_at: iso,
    consumed_by_commit_sha: 'd'.repeat(40),
    user_commit_confirmed: null,
  })

const rebindRow = (pid: string, from: string, to: string) =>
  JSON.stringify({
    kind: 'rebind',
    phase_id: pid,
    from_design_ref: from,
    to_design_ref: to,
    confirmation: `rebind REQ-2026-001 ${pid}`,
    confirmed_at: iso,
  })

const lines = (...rows: string[]) => rows.join('\n') + '\n'

describe('[req:rebind] parseArgs — fail-closed', () => {
  it('REQ·phase·확인 문구를 읽는다', () => {
    const o = parseArgs(['2026-069', '--phase', 'p1', '--confirm', 'rebind REQ-2026-069 p1', '--run'])
    expect(o).toEqual({ reqId: '2026-069', phase: 'p1', confirm: 'rebind REQ-2026-069 p1', root: null, run: true })
  })

  /** 🔴 값 자리에 온 옵션을 값으로 삼키면 사용자가 의도한 인자가 조용히 사라진다. */
  it('🔴 --phase 가 다음 옵션을 값으로 삼키지 않는다', () => {
    expect(() => parseArgs(['2026-069', '--phase', '--run'])).toThrow('--phase')
  })

  it('알 수 없는 옵션은 조용히 무시하지 않는다', () => {
    expect(() => parseArgs(['2026-069', '--force'])).toThrow('알 수 없는 옵션')
  })

  /** 확인 문구는 `-`로 시작할 수도 있으므로 그 자리에서만 접두 검사를 하지 않는다. */
  it('--confirm 값은 대시로 시작해도 받는다', () => {
    expect(parseArgs(['x', '--confirm', '-weird']).confirm).toBe('-weird')
  })
})

describe('[req:rebind] confirmSentence — 대상마다 다르다', () => {
  /** 🔴 고정 문구면 복사-붙여넣기로 엉뚱한 phase 를 재결속한다. */
  it('🔴 REQ·phase 가 다르면 문구도 다르다', () => {
    expect(confirmSentence('REQ-2026-069', 'p1')).not.toBe(confirmSentence('REQ-2026-069', 'p2'))
    expect(confirmSentence('REQ-2026-069', 'p1')).not.toBe(confirmSentence('REQ-2026-070', 'p1'))
  })
})

describe('[req:rebind] planRebind — 자격 판정(순수)', () => {
  it('옛 해시에 묶인 phase 는 재결속 대상이다', () => {
    const m = lines(designRow(D1), phaseRow('p1', D1), designRow(D2))
    expect(planRebind(m, 'p1')).toEqual({ ok: true, from: D1, to: D2 })
  })

  it('이미 현재 설계에 결속됐으면 거부(불필요한 행을 남기지 않는다)', () => {
    const m = lines(designRow(D2), phaseRow('p1', D2))
    const r = planRebind(m, 'p1')
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toContain('이미 현재 설계')
  })

  it('이미 재결속됐으면 거부(중복 행 금지)', () => {
    const m = lines(designRow(D1), phaseRow('p1', D1), designRow(D2), rebindRow('p1', D1, D2))
    const r = planRebind(m, 'p1')
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toContain('이미 재결속')
  })

  it('대상 phase 승인 행이 없으면 거부', () => {
    expect(planRebind(lines(designRow(D2)), 'p1').ok).toBe(false)
  })

  /** 🔴 승인된 설계가 없으면 묶을 대상이 없다 — 승인되지 않은 설계로 phase 를 묶으면 안 된다. */
  it('🔴 커밋된 design 승인이 없으면 거부', () => {
    const r = planRebind(lines(phaseRow('p1', D1)), 'p1')
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toContain('design 승인')
  })

  /** phase_design_ref 자체가 없는 레거시 승인은 재결속 대상이 아니다 — 무엇에서 옮기는지 알 수 없다. */
  it('phase_design_ref 가 없는 레거시 승인은 거부하고 --migrate 를 가리킨다', () => {
    const m = lines(designRow(D2), phaseRow('p1'))
    const r = planRebind(m, 'p1')
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.hint).toContain('migrate')
  })
})

/**
 * 🔴 verb 등록은 **두 곳**이 맞아야 한다. `VERB_MODULES` 만 하면 소비자 프로젝트의 `package.json` 에
 *    `req:rebind` 스크립트가 주입되지 않아 `npm run req:rebind` 가 없다.
 */
describe('[req:rebind] verb 등록', () => {
  it('dispatch 가 모듈로 보낸다', () => {
    expect(resolveDispatch(['req:rebind', '2026-069'])).toEqual({
      entry: VERB_MODULES['req:rebind'],
      rest: ['2026-069'],
    })
  })

  it('🔴 Stage B 주입 목록에도 들어간다', () => {
    expect(STAGE_B_REQ_VERBS).toContain('req:rebind')
    expect(STAGE_B_REQ_SCRIPTS['req:rebind']).toBe('commitgate req:rebind')
  })
})
