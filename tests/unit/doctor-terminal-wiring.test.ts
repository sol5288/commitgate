/**
 * REQ-2026-097 phase-1 — `req:doctor` **배선** e2e(실 git).
 *
 * 🔴 왜 순수 테스트로 부족한가: `runChecks`에 `ticketTerminalEvent`를 손으로 넣는 테스트는 `main()`이
 *    그 값을 **계산해 주입하는 배선**이 끊겨도 통과한다(REQ-2026-083 교훈 — 빌더 직접호출 가드는
 *    배선끊김을 못 잡는다). 그래서 여기서는 실제 진입점 `main()`을 돌려 출력을 본다.
 *
 * 재현 조건은 소비자 리포트 그대로다: 티켓이 종결됐고, 병합 후 `main`에 있으며, feature 브랜치는 없다.
 */
import { describe, it, expect, vi } from 'vitest'
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { main as doctorMain } from '../../scripts/req/req-doctor'
import { main as rebindMain } from '../../scripts/req/req-rebind'
import { scanTicketIntake } from '../../scripts/req/lib/intake'
import { commitStaleTicket, mkRepo, git, D_OLD, type StaleTicketSpec } from './fixtures/stale-devcomplete'

const TICKET_ID = 'REQ-2026-088'
const SHORT = '2026-088'
/** 종결 뒤 지워진 feature 브랜치 — D2(불일치)·D3(부재)를 동시에 성립시킨다. */
const GONE_BRANCH = 'feat/req-2026-088-gone'

const spec: StaleTicketSpec = {
  ticketId: TICKET_ID,
  oldPhases: [{ pid: 'phase-0', ref: D_OLD }],
  newPhases: ['phase-3'],
  staleDevComplete: true,
}

/** 종결된 티켓 + main 체크아웃 + 없는 feature 브랜치 상태의 저장소를 만든다. */
const closedRepo = (): { repo: string; ticketRel: string } => {
  const repo = mkRepo('req097-doctor-')
  const ticketRel = commitStaleTicket(repo, spec)
  rebindMain([SHORT, '--phase', 'phase-0', '--confirm', `rebind ${TICKET_ID} phase-0`, '--run', '--root', repo])
  expect(scanTicketIntake(repo, ticketRel, TICKET_ID).baseState).toBe('dev-complete')
  // 워킹 state.json에 지워진 브랜치를 적는다 — runChecks가 읽는 것은 워킹 state다(HEAD 종결 판정과 별개 축).
  const statePath = join(repo, ticketRel, 'state.json')
  const st = JSON.parse(readFileSync(statePath, 'utf8')) as Record<string, unknown>
  writeFileSync(statePath, JSON.stringify({ ...st, branch: GONE_BRANCH }))
  return { repo, ticketRel }
}

/** `main()`을 돌리고 `[req:doctor] <LEVEL> <ID>: <msg>` 줄들을 수집한다(process.exit은 삼킨다). */
const runDoctorLines = (repo: string): string[] => {
  const lines: string[] = []
  const log = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void lines.push(a.join(' ')))
  const exit = vi.spyOn(process, 'exit').mockImplementation(((): never => undefined as never))
  try {
    doctorMain([SHORT, '--root', repo])
  } finally {
    log.mockRestore()
    exit.mockRestore()
  }
  return lines
}

const lineFor = (lines: string[], id: string): string => lines.find((l) => l.includes(`] OK ${id}:`) || l.includes(`] FAIL ${id}:`) || l.includes(`] WARN ${id}:`)) ?? ''

describe('[REQ-2026-097] req:doctor main() 배선 — 종결 티켓의 브랜치 축 (실 git)', () => {
  it('종결 티켓 + main + 브랜치 삭제에서 D2·D3·D11이 면제된다(사유에 이벤트 포함)', () => {
    const { repo } = closedRepo()
    const lines = runDoctorLines(repo)
    for (const id of ['D2', 'D3', 'D11']) {
      const line = lineFor(lines, id)
      expect(line, id).toContain(`OK ${id}:`)
      expect(line, id).toContain('종결 티켓(dev-complete)')
    }
  })

  it('🔴 종결되지 않은 티켓에서는 같은 조건이 여전히 FAIL이다 — 면제가 배선을 타고 새지 않는다', () => {
    const repo = mkRepo('req097-doctor-open-')
    const ticketRel = commitStaleTicket(repo, spec) // 재결속 없음 → 낡은 dev-complete는 검증되지 않는다
    expect(scanTicketIntake(repo, ticketRel, TICKET_ID).baseState).not.toBe('dev-complete')
    const statePath = join(repo, ticketRel, 'state.json')
    const st = JSON.parse(readFileSync(statePath, 'utf8')) as Record<string, unknown>
    writeFileSync(statePath, JSON.stringify({ ...st, branch: GONE_BRANCH }))

    const lines = runDoctorLines(repo)
    for (const id of ['D2', 'D3', 'D11']) {
      const line = lineFor(lines, id)
      expect(line, id).toContain(`FAIL ${id}:`)
      expect(line, id).not.toContain('종결 티켓')
    }
  })
})

/**
 * REQ-2026-102 — `main()`이 **legacy를 별도 값으로 주입**하는지(배선).
 *
 * 🔴 순수 테스트는 이 배선을 못 잡는다 — `runChecks`에 `'legacy'`를 손으로 넣는 테스트는
 *    `main()`이 그 값을 계산해 넘기지 않아도(=`null`로 떨어져도) 통과한다. REQ-097·100·101에서
 *    3연속 실증된 패턴이라 실제 진입점을 돌린다.
 */
describe('[REQ-2026-102] req:doctor main() 배선 — legacy 티켓의 사유 (실 git)', () => {
  it('durability marker 없는 티켓에서 D2/D3가 FAIL이면서 legacy 사유를 단다', () => {
    const repo = mkRepo('req102-doctor-legacy-')
    const ticketRel = 'workflow/REQ-2026-088'
    mkdirSync(join(repo, ticketRel, 'responses'), { recursive: true })
    // durability marker(`evidence_durability_required`) 없음 = intake legacy.
    writeFileSync(
      join(repo, ticketRel, 'state.json'),
      JSON.stringify({ id: TICKET_ID, phase: 'INTAKE', branch: GONE_BRANCH, phases: [] }),
    )
    git(repo, ['add', '-A'])
    git(repo, ['commit', '-qm', 'legacy ticket'])
    expect(scanTicketIntake(repo, ticketRel, TICKET_ID).baseState).toBe('legacy')

    const lines = runDoctorLines(repo)
    for (const id of ['D2', 'D3']) {
      const line = lineFor(lines, id)
      expect(line, id).toContain(`FAIL ${id}:`)          // 🔴 면제되지 않는다
      expect(line, id).toContain('legacy 티켓')            // 사유가 배선을 타고 나온다
      expect(line, id).toContain('해소할 수단이 없습니다')
    }
  })
})
