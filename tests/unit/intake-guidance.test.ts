/**
 * REQ-2026-072 phase-3 — `req:new` 차단 메시지가 **적용 가능한** 복구 경로를 낸다(DEC-5).
 *
 * 🔴 헤드라인: 예전에는 설계 재승인으로 갇힌 티켓의 사용자가 안내받은 명령 3개를 차례로 시도해
 *    전부 거부당했다. 여기서 고정하는 것은 ① 재결속 가능하면 `req:rebind`를 준다 ② **레거시가 섞이면
 *    rebind를 주지 않고** `--migrate`를 준다 ③ 이 축의 문제가 아니면 기존 문구가 그대로다 —
 *    그리고 ④ 그 판단이 `req:close --migrate`와 **같은 결론**이라는 것이다.
 */
import { describe, it, expect } from 'vitest'
import { classifyIntake, type IntakeFacts } from '../../scripts/req/lib/intake'
import { renderIntakeSummary } from '../../scripts/req/req-new'
import { planMigrationClose, type MigrationFacts } from '../../scripts/req/lib/close-migrate'
import type { CloseProofRow } from '../../scripts/req/lib/close-proof'

const D_OLD = 'a'.repeat(64)
const D_NEW = 'b'.repeat(64)
const ISO = '2026-07-27T00:00:00.000Z'

const staleRow: CloseProofRow = {
  ticket_id: 'REQ-2026-088',
  event: 'dev-complete',
  series_id: null,
  resolution: null,
  phase_inventory: ['phase-0', 'phase-1'],
  design_ref: D_OLD, // 낡음
  at: ISO,
  reconstructed: false,
  evidence_basis: null,
}

const facts = (over: Partial<IntakeFacts> = {}): IntakeFacts => ({
  ticketId: 'REQ-2026-088',
  ticketRel: 'workflow/REQ-2026-088',
  durabilityRequired: true,
  manifestText: '{"kind":"design"}\n',
  manifestProblems: [],
  closeParsed: { rows: [staleRow], problems: [] },
  evidenceIntegrityProblems: [],
  ledgerHasApprovedClose: false,
  committedEvidenceComplete: false,
  committedDesignRef: D_NEW,
  evidencedPhaseIds: ['phase-3'], // 현재 설계에 결속된 것
  evidencedPhaseIdsAll: ['phase-0', 'phase-1', 'phase-3'],
  rebindablePhaseIds: ['phase-0', 'phase-1'],
  ...over,
})

describe('[REQ-2026-072] intake 복구 안내', () => {
  it('낡은 dev-complete + 전부 재결속 가능 → phase별 `req:rebind` 명령을 낸다', () => {
    const r = classifyIntake(facts())
    expect(r.verdict).toBe('block')
    expect(r.hints.join('\n')).toContain('req:rebind REQ-2026-088 --phase phase-0 --confirm "rebind REQ-2026-088 phase-0" --run')
    expect(r.hints.join('\n')).toContain('--phase phase-1')
  })

  it('🔴 레거시(phase_design_ref 부재)가 섞이면 rebind를 주지 않고 `--migrate`를 준다', () => {
    const r = classifyIntake(facts({ rebindablePhaseIds: ['phase-0'] })) // phase-1은 레거시
    expect(r.hints.join('\n')).toContain('req:close REQ-2026-088 --migrate --run')
    expect(r.hints.join('\n')).not.toContain('req:rebind')
  })

  it('미결속 phase가 없는 평범한 developing 티켓은 안내가 붙지 않는다(기존 문구 유지)', () => {
    const r = classifyIntake(
      facts({ closeParsed: { rows: [], problems: [] }, evidencedPhaseIdsAll: ['phase-3'], rebindablePhaseIds: [] }),
    )
    expect(r.baseState).toBe('developing')
    expect(r.hints).toEqual([])
  })

  it('통과(pass)·legacy 티켓에는 안내를 붙이지 않는다', () => {
    const passing = classifyIntake(
      facts({
        closeParsed: { rows: [{ ...staleRow, design_ref: D_NEW, phase_inventory: ['phase-3'] }], problems: [] },
      }),
    )
    expect(passing.verdict).toBe('pass')
    expect(passing.hints).toEqual([])
    expect(classifyIntake(facts({ durabilityRequired: false })).hints).toEqual([])
  })

  it('손상(corrupt) 차단은 복구 안내 축이 아니다 — 안내 없이 손상 사유만', () => {
    const r = classifyIntake(facts({ manifestProblems: ['깨진 행'] }))
    expect(r.baseState).toBe('corrupt')
    expect(r.hints).toEqual([])
  })

  it('renderIntakeSummary가 안내를 티켓 줄 아래에 함께 출력한다', () => {
    const out = renderIntakeSummary([classifyIntake(facts())])
    expect(out).toContain('REQ-2026-088: developing')
    expect(out).toContain('req:rebind REQ-2026-088 --phase phase-0')
  })

  /**
   * 🔴 이 REQ의 근본 결함은 **두 판정자가 다른 말을 한 것**이다. 같은 티켓 상태에서 intake 안내와
   *    `req:close --migrate`의 결론이 갈리면 그 결함이 다른 얼굴로 돌아온다.
   */
  it('🔴 intake 안내와 `--migrate` 판정이 같은 명령을 가리킨다', () => {
    const mig = (rebindable: string[]): MigrationFacts => ({
      ticketId: 'REQ-2026-088',
      ticketRel: 'workflow/REQ-2026-088',
      durabilityRequired: true,
      manifestText: '{"kind":"design"}\n',
      manifestProblems: [],
      closeProblems: [],
      closeRows: [staleRow],
      evidenceIntegrityProblems: [],
      committedDesignRef: D_NEW,
      evidencedPhaseIdsAll: ['phase-0', 'phase-1', 'phase-3'],
      evidencedPhaseIdsBound: ['phase-3'],
      rebindablePhaseIds: rebindable,
      committedPlannedPhaseIds: [],
      integrated: true,
      nowIso: ISO,
      evidenceBasis: ['workflow/REQ-2026-088/responses/approvals.jsonl'],
    })

    // ① 전부 재결속 가능: intake는 rebind를 권하고, migrate는 거부하며 같은 명령을 가리킨다.
    const bothRebindable = ['phase-0', 'phase-1']
    const planA = planMigrationClose(mig(bothRebindable))
    expect(planA.kind).toBe('refuse')
    expect(planA.kind === 'refuse' && planA.hint).toContain('req:rebind REQ-2026-088 --phase phase-0')
    expect(classifyIntake(facts({ rebindablePhaseIds: bothRebindable })).hints.join('\n')).toContain('req:rebind REQ-2026-088 --phase phase-0')

    // ② 레거시 혼재: intake는 migrate를 권하고, migrate는 실제로 stamp한다.
    const planB = planMigrationClose(mig(['phase-0']))
    expect(planB.kind).toBe('stamp')
    expect(classifyIntake(facts({ rebindablePhaseIds: ['phase-0'] })).hints.join('\n')).toContain('--migrate')
  })
})
