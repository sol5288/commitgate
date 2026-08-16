/**
 * REQ-2026-161 phase-4 — `req:doctor` D33 **배선** e2e(실 git).
 *
 * 🔴 **왜 순수 테스트로 부족한가**: `runChecks`에 `packageScripts`를 손으로 넣는 테스트는 `main()`이
 *    그 값을 **읽어 주입하는 배선**이 끊겨도 통과한다. 이 저장소는 그 함정을 세 번 연속 밟았다
 *    (REQ-2026-096~099). 그래서 여기서는 실제 진입점 `main()`을 돌려 출력을 본다 —
 *    `packageScripts: readPackageScripts(cfg.root)` 한 줄을 지우면 이 파일이 red 다.
 *
 * 🔴 **D19 와 나란히 본다.** 실측에서 결함을 가린 것이 바로 `OK D19: Stage B` 였다.
 *    같은 실행에서 D19 는 OK, D33 은 WARN 이어야 두 체크가 서로를 가리지 않음이 증명된다.
 */
import { describe, it, expect, vi } from 'vitest'
import { writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { main as doctorMain } from '../../scripts/req/req-doctor'
import { expectedReqScripts } from '../../scripts/req/lib/command-surface'
import { commitStaleTicket, mkRepo, git, D_OLD, type StaleTicketSpec } from './fixtures/stale-devcomplete'

const TICKET_ID = 'REQ-2026-088'
const SHORT = '2026-088'

const spec: StaleTicketSpec = {
  ticketId: TICKET_ID,
  oldPhases: [{ pid: 'phase-0', ref: D_OLD }],
  newPhases: ['phase-3'],
  staleDevComplete: true,
}

/** `main()`을 돌리고 `[req:doctor] …` 줄들을 수집한다(process.exit은 삼킨다). */
const runDoctorLines = (repo: string): string[] => {
  const lines: string[] = []
  const log = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void lines.push(a.join(' ')))
  const err = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  const exit = vi.spyOn(process, 'exit').mockImplementation(((): never => undefined as never))
  try {
    doctorMain([SHORT, '--root', repo])
  } finally {
    log.mockRestore()
    err.mockRestore()
    exit.mockRestore()
  }
  return lines
}

const lineFor = (lines: string[], id: string): string =>
  lines.find((l) => l.includes(`] OK ${id}:`) || l.includes(`] FAIL ${id}:`) || l.includes(`] WARN ${id}:`)) ?? ''

/** Stage B 형태의 `req:*` 를 심되, `omit` 에 준 verb 는 뺀다(= 업그레이드로 늘어난 verb 가 없는 설치본). */
function seedScripts(repo: string, omit: string[]): void {
  const all = expectedReqScripts()
  const scripts: Record<string, string> = { build: 'vite build' }
  for (const [k, v] of Object.entries(all)) if (!omit.includes(k)) scripts[k] = v
  const p = join(repo, 'package.json')
  const pkg = JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>
  writeFileSync(p, JSON.stringify({ ...pkg, scripts }, null, 2) + '\n')
  git(repo, ['add', '-A'])
  git(repo, ['commit', '-qm', 'seed scripts'])
}

describe('[REQ-2026-161] req:doctor main() 배선 — D33 명령 표면 skew (실 git)', () => {
  it('🔴 누락 verb 가 있는 설치본에서 D33 이 WARN 으로 그 이름을 말한다', () => {
    const repo = mkRepo('req161-doctor-skew-')
    commitStaleTicket(repo, spec)
    seedScripts(repo, ['req:delegate', 'req:repolicy'])
    const line = lineFor(runDoctorLines(repo), 'D33')
    expect(line).toContain('WARN D33:')
    expect(line).toContain('req:delegate')
    expect(line).toContain('req:repolicy')
    expect(line).toContain('sync --apply --scripts')
  })

  it('🔴 같은 실행에서 D19 는 OK 다 — 설치 "모드"는 정상이고 "표면"만 부족하다', () => {
    const repo = mkRepo('req161-doctor-d19-')
    commitStaleTicket(repo, spec)
    seedScripts(repo, ['req:delegate'])
    const lines = runDoctorLines(repo)
    expect(lineFor(lines, 'D19')).toContain('OK D19:')
    expect(lineFor(lines, 'D19')).toContain('Stage B')
    expect(lineFor(lines, 'D33')).toContain('WARN D33:')
  })

  it('전부 갖춘 설치본에서는 D33 이 OK 다(과잉 경보 아님)', () => {
    const repo = mkRepo('req161-doctor-full-')
    commitStaleTicket(repo, spec)
    seedScripts(repo, [])
    const line = lineFor(runDoctorLines(repo), 'D33')
    expect(line).toContain('OK D33:')
    expect(line).toContain('일치')
  })

  it('scripts 가 없는 package.json 은 "부족"이 아니라 점검 불요다', () => {
    const repo = mkRepo('req161-doctor-noscripts-')
    commitStaleTicket(repo, spec) // 픽스처 package.json 에는 scripts 가 없다
    const line = lineFor(runDoctorLines(repo), 'D33')
    expect(line).toContain('OK D33:')
    expect(line).toContain('읽지 못함')
  })
})

/**
 * REQ-2026-163 phase-3 — D34 **배선** e2e(실 git).
 *
 * 🔴 `runChecks` 에 `orphanSeries` 를 손으로 넣는 테스트는 `main()` 이 `orphanPhaseSeries(state)` 로
 *    계산해 주입하는 배선이 끊겨도 통과한다. 실제 진입점을 돌려 출력을 본다.
 */
describe('[REQ-2026-163] req:doctor main() 배선 — D34 orphan series (실 git)', () => {
  /** 티켓 state 의 phases·review_series 를 바꿔 orphan 을 만든다. */
  function withSeries(repo: string, ticketRel: string, phases: string[], series: unknown[]): void {
    const p = join(repo, ticketRel, 'state.json')
    const st = JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>
    writeFileSync(p, JSON.stringify({ ...st, phases: phases.map((id) => ({ id })), review_series: series }))
  }

  it('🔴 개명으로 남은 orphan 을 D34 가 WARN 으로 말한다(해소 명령 포함)', () => {
    const repo = mkRepo('req163-doctor-orphan-')
    const ticketRel = commitStaleTicket(repo, spec)
    withSeries(repo, ticketRel, ['phase-3'], [
      { series_id: 'phase:phase-2-check-c6#1', review_kind: 'phase', phase_id: 'phase-2-check-c6', attempts: 2, closed_reason: null },
    ])
    const line = lineFor(runDoctorLines(repo), 'D34')
    expect(line).toContain('WARN D34:')
    expect(line).toContain('phase:phase-2-check-c6#1')
    expect(line).toContain('--close-orphan')
  })

  it('살아 있는 phase 의 열린 series 는 D34 대상이 아니다(과잉 경보 아님)', () => {
    const repo = mkRepo('req163-doctor-live-')
    const ticketRel = commitStaleTicket(repo, spec)
    withSeries(repo, ticketRel, ['live'], [
      { series_id: 'phase:live#1', review_kind: 'phase', phase_id: 'live', attempts: 1, closed_reason: null },
    ])
    expect(lineFor(runDoctorLines(repo), 'D34')).toContain('OK D34:')
  })
})
