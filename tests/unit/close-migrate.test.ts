import { describe, it, expect } from 'vitest'
import { planMigrationClose, type MigrationFacts } from '../../scripts/req/lib/close-migrate'
import type { CloseProofRow } from '../../scripts/req/lib/close-proof'

/**
 * `planMigrationClose` 순수 판정(REQ-2026-053·DEC-M3/M7). fs·git 무의존.
 * 기본 facts는 **적격**(legacy 완료·병합 티켓) — 각 테스트가 하나씩 어긋뜨려 거부/no-op를 확인한다.
 */
const DREF = 'd'.repeat(64)
const facts = (over: Partial<MigrationFacts> = {}): MigrationFacts => ({
  ticketId: 'REQ-2026-049',
  ticketRel: 'workflow/REQ-2026-049',
  durabilityRequired: true,
  manifestText: '{"kind":"design"}\n',
  manifestProblems: [],
  closeProblems: [],
  closeRows: [],
  evidenceIntegrityProblems: [],
  committedDesignRef: DREF,
  evidencedPhaseIdsAll: ['phase-1-a', 'phase-2-b'],
  evidencedPhaseIdsBound: [], // 레거시: 현재 design_ref에 결속된 phase 없음
  // 🔴 이 기본 픽스처가 표현하는 것은 **진짜 레거시**다(REQ-2026-072): phase 행에 `phase_design_ref`가
  //    없어 재결속이 불가능하고, 그래서 마이그레이션이 유일한 종결 경로다. 재결속 가능한 티켓의
  //    기대값은 아래 별도 describe에서 고정한다.
  rebindablePhaseIds: [],
  committedPlannedPhaseIds: [], // 레거시 스캐폴드: 커밋된 계획 없음(vacuous)
  integrated: true,
  nowIso: '2026-07-25T05:00:00.000Z',
  evidenceBasis: ['workflow/REQ-2026-049/responses/approvals.jsonl'],
  ...over,
})

const closeRow = (event: CloseProofRow['event'], over: Partial<CloseProofRow> = {}): CloseProofRow => ({
  ticket_id: 'REQ-2026-049',
  event,
  series_id: event === 'series-terminal' ? 'design:-#1' : null,
  resolution: event === 'series-terminal' ? 'replace' : null,
  phase_inventory: event === 'series-terminal' ? null : ['phase-1-a'],
  design_ref: event === 'series-terminal' ? null : DREF,
  at: '2026-07-24T05:00:00.000Z',
  reconstructed: event === 'migrated-complete',
  evidence_basis: event === 'migrated-complete' ? ['x'] : null,
  ...over,
})

describe('[close-migrate] planMigrationClose — 적격 판정', () => {
  it('⑨ 적격(integrated 레거시 완료) → stamp migrated-complete', () => {
    const p = planMigrationClose(facts())
    expect(p.kind).toBe('stamp')
    if (p.kind !== 'stamp') return
    expect(p.row).toEqual({
      ticket_id: 'REQ-2026-049',
      event: 'migrated-complete',
      series_id: null,
      resolution: null,
      phase_inventory: ['phase-1-a', 'phase-2-b'],
      design_ref: DREF,
      at: '2026-07-25T05:00:00.000Z',
      reconstructed: true,
      evidence_basis: ['workflow/REQ-2026-049/responses/approvals.jsonl'],
    })
  })
  it('⑨ phase_inventory는 정렬·중복 제거(원천이 비정렬·중복이어도)', () => {
    const p = planMigrationClose(facts({ evidencedPhaseIdsAll: ['b', 'a', 'a'] }))
    expect(p.kind === 'stamp' && p.row.phase_inventory).toEqual(['a', 'b'])
  })
})

describe('[close-migrate] planMigrationClose — 거부(fail-closed)', () => {
  it('corrupt: manifest 문제 → 거부', () => {
    const p = planMigrationClose(facts({ manifestProblems: ['깨진 행'] }))
    expect(p.kind === 'refuse' && p.reason).toContain('approvals.jsonl 손상')
  })
  it('corrupt: close-proof 문제 → 거부', () => {
    const p = planMigrationClose(facts({ closeProblems: ['깨진 close'] }))
    expect(p.kind === 'refuse' && p.reason).toContain('ticket-close.jsonl 손상')
  })
  it('⑩ 증거 무결성 문제 → 거부', () => {
    const p = planMigrationClose(facts({ evidenceIntegrityProblems: ['archive 부재'] }))
    expect(p.kind === 'refuse' && p.reason).toContain('committed 증거')
  })
  it('durability marker 없음(legacy) → 거부(종결 불필요)', () => {
    const p = planMigrationClose(facts({ durabilityRequired: false }))
    expect(p.kind === 'refuse' && p.reason).toContain('legacy')
  })
  it('⑪ committed design 승인 없음 → 거부', () => {
    const p = planMigrationClose(facts({ committedDesignRef: null }))
    expect(p.kind === 'refuse' && p.reason).toContain('design 승인')
  })
  it('⑫ phase 증거 0 → 거부', () => {
    const p = planMigrationClose(facts({ evidencedPhaseIdsAll: [] }))
    expect(p.kind === 'refuse' && p.reason).toContain('phase 증거가 없다')
  })
  it('⑬ integrated=false(미병합) → 거부(P1-1: 완료·병합 후)', () => {
    const p = planMigrationClose(facts({ integrated: false }))
    expect(p.kind).toBe('refuse')
    expect(p.kind === 'refuse' && p.reason).toContain('본선(mainline)에 병합되지 않음')
  })
  it('⑬c 커밋된 계획 중 증거 없는 phase → 거부(r02 P1: 부분 완료 배제)', () => {
    // committed state.phases=[p1,p2]인데 p2 증거 없음(evidenced=[p1]) → 진행 중/중단 → 거부.
    const p = planMigrationClose(facts({ evidencedPhaseIdsAll: ['phase-1-a'], committedPlannedPhaseIds: ['phase-1-a', 'phase-2-b'] }))
    expect(p.kind).toBe('refuse')
    expect(p.kind === 'refuse' && p.reason).toContain('부분 완료')
  })
  it('커밋된 계획 전부 증거 있으면 통과(계획=[p1,p2] 모두 evidenced)', () => {
    const p = planMigrationClose(facts({ committedPlannedPhaseIds: ['phase-1-a', 'phase-2-b'] }))
    expect(p.kind).toBe('stamp')
  })
  it('⑭ design-bound가 evidenced inventory 전체를 덮음 → 거부(정상 finalize 안내)', () => {
    const p = planMigrationClose(facts({ evidencedPhaseIdsBound: ['phase-1-a', 'phase-2-b'] }))
    expect(p.kind).toBe('refuse')
    expect(p.kind === 'refuse' && p.hint).toContain('req:commit --finalize')
  })
  it('evidence_basis 비어 있음 → 방어 거부', () => {
    const p = planMigrationClose(facts({ evidenceBasis: [] }))
    expect(p.kind === 'refuse' && p.reason).toContain('evidence_basis가 비어 있음')
  })
})

describe('[close-migrate] planMigrationClose — 이미 종결 시 no-op(DEC-M7)', () => {
  it('⑬b migrated-complete 행 존재 → no-op(거부 아님)', () => {
    const p = planMigrationClose(facts({ closeRows: [closeRow('migrated-complete')] }))
    expect(p).toEqual({ kind: 'noop', existingState: 'migrated-complete' })
  })
  it('⑬b **검증된** dev-complete → no-op (inventory가 현재 design_ref에 결속됨)', () => {
    // REQ-2026-072: 행의 존재가 아니라 self-verify가 기준이다. inventory(phase-1-a)가 결속돼 있어야 종결.
    const p = planMigrationClose(facts({ closeRows: [closeRow('dev-complete')], evidencedPhaseIdsBound: ['phase-1-a'] }))
    expect(p).toEqual({ kind: 'noop', existingState: 'dev-complete' })
  })
  it('⑬b series-terminal 행 존재 → no-op', () => {
    const p = planMigrationClose(facts({ closeRows: [closeRow('series-terminal')] }))
    expect(p).toEqual({ kind: 'noop', existingState: 'series-terminal' })
  })
  it('no-op는 다른 거부 조건보다 앞선다(이미 종결이면 통합 불가여도 no-op)', () => {
    // integrated=false여도 이미 종결이면 no-op(재실행 멱등).
    const p = planMigrationClose(facts({ integrated: false, closeRows: [closeRow('migrated-complete')] }))
    expect(p.kind).toBe('noop')
  })
})

/**
 * REQ-2026-072 — **낡은 dev-complete**(설계 재승인으로 옛 design_ref에 남은 행)와 재결속 경로.
 * 소비자 버그리포트(lean_lms REQ-2026-088)가 고정된 시나리오다.
 */
const OLD_DREF = 'a'.repeat(64)

describe('[close-migrate] 낡은 dev-complete·재결속 (REQ-2026-072)', () => {
  it('A1 낡은 dev-complete(옛 design_ref)는 "이미 종결"이 아니다 — no-op으로 삼키지 않는다', () => {
    const p = planMigrationClose(
      facts({
        closeRows: [closeRow('dev-complete', { design_ref: OLD_DREF })],
        evidencedPhaseIdsBound: [],
      }),
    )
    expect(p.kind).not.toBe('noop')
  })

  it('A2 미결속 phase가 전부 재결속 가능 → 거부하고 `req:rebind`를 안내한다(stamp 아님)', () => {
    const p = planMigrationClose(
      facts({
        closeRows: [closeRow('dev-complete', { design_ref: OLD_DREF })],
        rebindablePhaseIds: ['phase-1-a', 'phase-2-b'],
      }),
    )
    expect(p.kind).toBe('refuse')
    if (p.kind !== 'refuse') return
    expect(p.reason).toContain('재결속 가능')
    expect(p.hint).toContain('req:rebind REQ-2026-049 --phase phase-1-a')
    expect(p.hint).toContain('--confirm "rebind REQ-2026-049 phase-1-a"')
  })

  it('A2b dev-complete 행이 아예 없어도 재결속 가능하면 마이그레이션하지 않는다(강한 경로 우선)', () => {
    const p = planMigrationClose(facts({ rebindablePhaseIds: ['phase-1-a', 'phase-2-b'] }))
    expect(p.kind === 'refuse' && p.reason).toContain('재결속 가능')
  })

  it('A3 하나라도 재결속 불가(phase_design_ref 부재)면 마이그레이션으로 진행한다 — 지금 교착인 경로가 열린다', () => {
    const p = planMigrationClose(
      facts({
        closeRows: [closeRow('dev-complete', { design_ref: OLD_DREF })],
        rebindablePhaseIds: ['phase-1-a'], // phase-2-b는 레거시
      }),
    )
    expect(p.kind).toBe('stamp')
    if (p.kind !== 'stamp') return
    expect(p.row.event).toBe('migrated-complete')
    expect(p.row.phase_inventory).toEqual(['phase-1-a', 'phase-2-b'])
  })

  it('낡은 dev-complete여도 손상 가드가 먼저다(fail-closed 순서 불변)', () => {
    const p = planMigrationClose(
      facts({
        closeRows: [closeRow('dev-complete', { design_ref: OLD_DREF })],
        rebindablePhaseIds: ['phase-1-a', 'phase-2-b'],
        evidenceIntegrityProblems: ['archive 부재'],
      }),
    )
    expect(p.kind === 'refuse' && p.reason).toContain('committed 증거')
  })
})
