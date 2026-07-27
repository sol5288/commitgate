/**
 * REQ-2026-072 phase-2 — `req:rebind`의 **재진입**(실 git).
 *
 * 🔴 헤드라인: 재결속은 **두 커밋짜리 절차**(rebind 행 → dev-complete)다. 두 번째가 실패한 뒤 재실행하면
 *    예전에는 "이미 재결속돼 있습니다"로 거부돼 **완료 재판정에 영영 닿지 못했다** — 티켓이 종결되지
 *    않고 `req:new`도 막힌 채로 남았다. 여기서 고정하는 것은 "재실행이 그 상태를 닫는다"이다.
 *
 * 픽스처는 phase-1과 **같은 헬퍼**를 쓰되 각자 자기 저장소를 만든다(테스트 간 실행 순서 의존 없음).
 */
import { describe, it, expect, vi } from 'vitest'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { main as rebindMain } from '../../scripts/req/req-rebind'
import { scanTicketIntake } from '../../scripts/req/lib/intake'
import { parseCloseProof } from '../../scripts/req/lib/close-proof'
import { commitStaleTicket, mkRepo, git, headBlob, D_OLD, type StaleTicketSpec } from './fixtures/stale-devcomplete'

const TICKET_ID = 'REQ-2026-088'
const SHORT = '2026-088'

const spec = (over: Partial<StaleTicketSpec> = {}): StaleTicketSpec => ({
  ticketId: TICKET_ID,
  oldPhases: [{ pid: 'phase-0', ref: D_OLD }, { pid: 'phase-1', ref: D_OLD }],
  newPhases: ['phase-3'],
  staleDevComplete: true,
  ...over,
})

const rebind = (repo: string, phase: string): void =>
  rebindMain([SHORT, '--phase', phase, '--confirm', `rebind ${TICKET_ID} ${phase}`, '--run', '--root', repo])

const closeRows = (repo: string, ticketRel: string): ReturnType<typeof parseCloseProof>['rows'] => {
  const text = headBlob(repo, `${ticketRel}/responses/ticket-close.jsonl`)
  return text === null ? [] : parseCloseProof(text).rows
}

/** 현재 design_ref로 검증되는 dev-complete가 있는가(= 종결됐는가). */
const isClosed = (repo: string, ticketRel: string): boolean =>
  scanTicketIntake(repo, ticketRel, TICKET_ID).baseState === 'dev-complete'

describe('[REQ-2026-072] req:rebind 재진입 (실 git)', () => {
  it('마지막 결속을 채우면 그 자리에서 dev-complete가 발행된다(중간 재결속은 조용히 넘어간다)', () => {
    const repo = mkRepo('req072-rebind-')
    const t = commitStaleTicket(repo, spec())
    expect(isClosed(repo, t)).toBe(false)

    rebind(repo, 'phase-0') // 아직 phase-1이 남음
    expect(isClosed(repo, t)).toBe(false)

    rebind(repo, 'phase-1') // 마지막 결속 → 종결
    expect(isClosed(repo, t)).toBe(true)
    const rows = closeRows(repo, t)
    // append-only: 낡은 행은 보존되고 현재 design_ref의 행이 더해진다.
    expect(rows).toHaveLength(2)
    expect(rows[1]!.event).toBe('dev-complete')
    expect(rows[1]!.phase_inventory).toEqual(['phase-0', 'phase-1', 'phase-3'])
    expect(rows[1]!.reconstructed).toBe(false)
  })

  it('🔴 A4 dev-complete 발행 직전에 중단돼도 재실행이 티켓을 닫는다(재진입)', () => {
    const repo = mkRepo('req072-reentry-')
    const t = commitStaleTicket(repo, spec())
    rebind(repo, 'phase-0')
    rebind(repo, 'phase-1')
    expect(isClosed(repo, t)).toBe(true)

    // 🔴 중단 재현: rebind 행 커밋은 남기고 **dev-complete 커밋만** 되돌린다.
    //    (프로세스가 두 커밋 사이에서 죽은 상태와 같다.)
    git(repo, ['reset', '--hard', '-q', 'HEAD~1'])
    expect(isClosed(repo, t)).toBe(false)
    expect(closeRows(repo, t)).toHaveLength(1) // 낡은 dev-complete만 남았다

    // 예전에는 여기서 "이미 재결속돼 있습니다"로 throw했다 → 영구 교착.
    rebind(repo, 'phase-1')
    expect(isClosed(repo, t)).toBe(true)
    expect(closeRows(repo, t)).toHaveLength(2)
  })

  it('재실행이 rebind 행을 중복으로 남기지 않는다(no-op은 쓰기 없음)', () => {
    const repo = mkRepo('req072-nodup-')
    const t = commitStaleTicket(repo, spec())
    rebind(repo, 'phase-0')
    const manifestAfterFirst = headBlob(repo, `${t}/responses/approvals.jsonl`) as string
    rebind(repo, 'phase-0') // 같은 phase 재실행
    expect(headBlob(repo, `${t}/responses/approvals.jsonl`)).toBe(manifestAfterFirst)
  })

  it('워킹 state.json이 없어도 HEAD 커밋본으로 완료를 판정한다(DEC-4 fallback)', () => {
    const repo = mkRepo('req072-headstate-')
    const t = commitStaleTicket(repo, spec())
    rebind(repo, 'phase-0')
    // 티켓 스크래치 소실 재현 — HEAD에는 state.json이 커밋돼 있다.
    rmSync(join(repo, t, 'state.json'))
    expect(existsSync(join(repo, t, 'state.json'))).toBe(false)

    rebind(repo, 'phase-1')
    expect(isClosed(repo, t)).toBe(true)
  })

  it('🔴 HEAD state의 phases가 비어 있으면 조용히 "미완료"라 하지 않고 판정 불가를 알린다', () => {
    const repo = mkRepo('req072-emptyplan-')
    const t = commitStaleTicket(repo, spec({ plannedPhasesOverride: [] }))
    rmSync(join(repo, t, 'state.json'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      rebind(repo, 'phase-0')
      const msg = warn.mock.calls.map((c) => String(c[0])).join('\n')
      expect(msg).toContain('완료 여부를 판정하지 못했습니다')
      expect(msg).toContain('phase 계획이 비어 있습니다')
    } finally {
      warn.mockRestore()
    }
    // 재결속 기록 자체는 커밋된다(그 사실도 메시지가 말한다).
    expect(headBlob(repo, `${t}/responses/approvals.jsonl`)).toContain('"kind":"rebind"')
    expect(isClosed(repo, t)).toBe(false)
  })

  it('phase_design_ref가 없는 레거시 phase는 여전히 거부한다(재진입 완화가 자격을 넓히지 않는다)', () => {
    const repo = mkRepo('req072-legacy-')
    commitStaleTicket(repo, spec({ oldPhases: [{ pid: 'phase-0', ref: null }] }))
    expect(() => rebind(repo, 'phase-0')).toThrow(/phase_design_ref가 없습니다/)
  })
})
