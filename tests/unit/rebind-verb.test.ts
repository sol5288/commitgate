import { describe, it, expect } from 'vitest'
import { parseArgs, confirmSentence, planRebind } from '../../scripts/req/req-rebind'
import { resolveDispatch, VERB_MODULES } from '../../bin/dispatch.mjs'
import { STAGE_B_REQ_VERBS, STAGE_B_REQ_SCRIPTS } from '../../bin/init'
import { computeDevCompleteProof } from '../../scripts/req/req-commit'

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
 * verb 등록은 `VERB_MODULES` **한 곳**이다 — `STAGE_B_REQ_VERBS` 는 거기서 `req:` 접두를 필터해
 * **파생**된다(`bin/init.ts:189`). 그래도 그 파생이 살아 있다는 것을 여기서 고정한다:
 * 🔴 파생이 끊기면 소비자 프로젝트의 `package.json` 에 스크립트가 주입되지 않아
 *    `npm run req:rebind` 자체가 없다.
 * **실측(2026-07-27)**: 임시 repo 에 devDependency 를 선언하고 `init` 을 돌리니 주입됐다(req:* 9개).
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

/**
 * REQ-2026-069 phase-4 — 재결속 뒤 완료 재판정(DEC-8).
 *
 * 🔴 이 phase 의 근거는 **자체 검증**이다. phase-1~3 을 이 REQ 자신에게 적용해 보니 결속은 고쳐졌는데
 *    `ticket-close.jsonl` 이 없고 `req:new` 가 여전히 막혔다 — 해결하려던 문제가 그대로 남았다.
 *    로컬 2116 tests 와 Codex 리뷰 5회가 이걸 잡지 못했다. 순수 모델과 verb 는 각각 옳았고,
 *    **둘을 이은 뒤의 전체 흐름**에 구멍이 있었다.
 *
 * 여기서는 그 흐름의 판정부(`computeDevCompleteProof` 재사용)를 고정한다 — IO 배선은 verb 가 하고,
 * 판정이 갈라지지 않는다는 것이 핵심이다.
 */
describe('[req:rebind] 재결속 뒤 완료 재판정', () => {
  const inventory = ['p1', 'p2']

  /** 재결속 전: p1 이 옛 해시라 산입되지 않아 완료가 아니다. */
  it('재결속 전에는 완료가 아니다', () => {
    const m = lines(designRow(D1), phaseRow('p1', D1), designRow(D2), phaseRow('p2', D2))
    const proof = computeDevCompleteProof({
      ticketId: 'REQ-2026-001',
      phaseIds: inventory,
      reviewKind: 'phase',
      manifestContent: m,
      nowIso: '2026-07-27T00:00:00.000Z',
    })
    expect(proof).toBeNull()
  })

  /** 🔴 재결속이 마지막 결속을 채우면 완료가 된다 — 이게 없으면 결속만 고쳐지고 티켓은 막힌 채다. */
  it('🔴 재결속으로 마지막 결속이 채워지면 완료가 된다', () => {
    const m = lines(designRow(D1), phaseRow('p1', D1), designRow(D2), phaseRow('p2', D2), rebindRow('p1', D1, D2))
    const proof = computeDevCompleteProof({
      ticketId: 'REQ-2026-001',
      phaseIds: inventory,
      reviewKind: 'phase',
      manifestContent: m,
      nowIso: '2026-07-27T00:00:00.000Z',
    })
    expect(proof).not.toBeNull()
    expect(proof!.event).toBe('dev-complete')
    expect(proof!.phase_inventory).toEqual(inventory)
    expect(proof!.design_ref).toBe(D2)
  })

  /** 🔴 남은 phase 가 있는 중간 재결속은 정상이다 — 그때 완료를 내면 안 된다. */
  it('🔴 남은 phase 가 있으면 재결속해도 완료가 아니다', () => {
    const m = lines(designRow(D1), phaseRow('p1', D1), designRow(D2), rebindRow('p1', D1, D2))
    const proof = computeDevCompleteProof({
      ticketId: 'REQ-2026-001',
      phaseIds: inventory, // p2 는 아직 승인 전
      reviewKind: 'phase',
      manifestContent: m,
      nowIso: '2026-07-27T00:00:00.000Z',
    })
    expect(proof).toBeNull()
  })
})
