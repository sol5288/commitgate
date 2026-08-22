import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { resolveNext, type NextInput } from '../../scripts/req/req-next'
import {
  terminalReentryProblem,
  computeTerminalReentry,
} from '../../scripts/req/lib/terminal-reentry'

/**
 * REQ-2026-175 — **`req:next` 가 `req:commit` 이 거부할 명령을 지시하지 않는다**.
 *
 * 🔴 실제로 겪은 결함: `req:next` 가 `RUN`(계약상 "묻지 말고 실행")으로 `req:commit --run` 을
 *    지시했고, 그대로 실행하니 `req:commit` 이 **종결 재진입**으로 거부했다.
 *    한 도구가 지시한 명령을 다른 도구가 거부한다 — `req:next` 계약의 근거가 무너지는 자리다.
 *
 * 🔴 오라클은 **문자열 동일성**이다: 안내가 거부 문구와 같아야 "같은 생성기·같은 입력"이 증명된다.
 */

const REQ = 'REQ-2026-175'
const BRANCH = 'feat/req-2026-175-next-commit-parity'

/** 살아 있는 승인 + 종단 전제를 갖춘 입력(네 갈래 중 하나에 반드시 도달한다). */
const liveApproval = (over: Partial<NextInput> = {}, stateOver: Record<string, unknown> = {}): NextInput =>
  ({
    target: { kind: 'req', reqId: '2026-175' },
    packageManager: 'npm',
    state: {
      id: REQ,
      branch: BRANCH,
      risk_level: 'LOW',
      commit_allowed: true,
      phases: [{ id: 'p1', title: 'p1', status: 'approved' }],
      review_series_model_version: 1,
      design_approved: true,
      design_approved_hash: 'd'.repeat(64),
      ...stateOver,
    },
    currentDesignHash: 'd'.repeat(64),
    stopGate: 'auto',
    phaseCommitAutoApprove: 'low-only',
    completesReq: false,
    worktreeReviewClean: true,
    hasStagedChanges: true,
    designDocsInIndex: true,
    reviewBudget: { autoBudget: 5, hardCap: 8, onSoftLimit: 'auto' },
    deliveryGate: null,
    ...over,
  }) as unknown as NextInput

describe('[REQ-2026-175] 종결 티켓에서 req:commit 을 지시하지 않는다', () => {
  for (const baseState of ['dev-complete', 'migrated-complete', 'abandoned'] as const) {
    it(`🔴 ${baseState} → BLOCKED (req:commit 미지시)`, () => {
      const reentry = terminalReentryProblem(REQ, baseState)
      const a = resolveNext(liveApproval({ terminalReentry: () => reentry }))
      expect(a.kind, JSON.stringify(a)).toBe('BLOCKED')
      expect(a.command ?? '').not.toContain('req:commit')
      // 🔴 같은 생성기·같은 입력 — 문자열이 같아야 한다.
      expect(a.detail).toBe(reentry)
    })
  }

  /**
   * 🔴 **`series-terminal` 은 막지 않는다.** `terminalReentryProblem` 이 그 상태를 차단하지 않으므로
   *    (series 종결이지 티켓 완료가 아니다 — 대체 REQ 흐름이 지난다) 안내도 막으면 안 된다.
   */
  it('🔴 series-terminal 은 막지 않는다(거부 쪽과 대칭)', () => {
    expect(terminalReentryProblem(REQ, 'series-terminal')).toBeNull()
    const a = resolveNext(liveApproval({ terminalReentry: () => terminalReentryProblem(REQ, 'series-terminal') }))
    expect(a.kind).not.toBe('BLOCKED')
    expect(a.command ?? '').toContain('req:commit')
  })

  it('developing 도 막지 않는다', () => {
    const a = resolveNext(liveApproval({ terminalReentry: () => terminalReentryProblem(REQ, 'developing') }))
    expect(a.command ?? '').toContain('req:commit')
  })

  /** 🔴 **판정 불가는 종전 동작**(DEC-3) — 여기는 안내 지점이지 차단 지점이 아니다. */
  it('🔴 공급자가 없으면 종전 동작(무회귀)', () => {
    const a = resolveNext(liveApproval())
    expect(a.kind).not.toBe('BLOCKED')
    expect(a.command ?? '').toContain('req:commit')
  })

  it('🔴 판정 불가(null)면 종전 동작', () => {
    const a = resolveNext(liveApproval({ terminalReentry: () => null }))
    expect(a.command ?? '').toContain('req:commit')
  })

  /** 🔴 HIGH 갈래(`req:confirm`)도 막힌다 — 확인만 받고 막히면 사람의 승인이 낭비된다. */
  it('🔴 HIGH + 확인 요구 갈래도 막힌다', () => {
    const reentry = terminalReentryProblem(REQ, 'dev-complete')
    const a = resolveNext(
      liveApproval({ terminalReentry: () => reentry, stopGate: 'phase', completesReq: true }, { risk_level: 'HIGH' }),
    )
    expect(a.kind, JSON.stringify(a)).toBe('BLOCKED')
    expect(a.command ?? '').not.toContain('req:confirm')
  })

  /** 🔴 **지연**: 종결이 아니어도 한 번만 부르고, 살아 있는 승인이 없으면 아예 부르지 않는다. */
  it('🔴 살아 있는 승인이 없으면 공급자를 부르지 않는다(비용 0)', () => {
    const spy = vi.fn((): string | null => null)
    resolveNext(liveApproval({ terminalReentry: spy }, { commit_allowed: false }))
    expect(spy).not.toHaveBeenCalled()
  })
})

// ───────────────────────────── 실 git: 같은 입력 증명 ──

function g(dir: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
}

/** 종결(dev-complete) 티켓 하나를 커밋한 저장소. */
function terminalRepo(): { dir: string; ticketRel: string } {
  const dir = mkdtempSync(join(tmpdir(), 'cg-reentry-'))
  g(dir, 'init', '-q', '-b', 'main')
  g(dir, 'config', 'user.email', 't@example.com')
  g(dir, 'config', 'user.name', 'T')
  const ticketRel = `workflow/${REQ}`
  mkdirSync(join(dir, ticketRel, 'responses'), { recursive: true })
  // durability marker 없음 → legacy → 종결 아님. 여기서는 **문구 동일성**만 보므로 상태는 무관하다.
  writeFileSync(join(dir, ticketRel, 'state.json'), JSON.stringify({ id: REQ, phases: [] }))
  writeFileSync(join(dir, '.gitignore'), 'node_modules/\n')
  g(dir, 'add', '.')
  g(dir, 'commit', '-qm', 'base')
  return { dir, ticketRel }
}

const portsOf = (dir: string, ticketRel: string) => ({
  root: dir,
  ticketRel,
  reqId: REQ,
  git: (args: string[]): string => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }),
})

describe('[REQ-2026-175] computeTerminalReentry — 입력 획득까지 공유', () => {
  it('종결이 아니면 null(legacy 티켓)', () => {
    const { dir, ticketRel } = terminalRepo()
    expect(computeTerminalReentry(portsOf(dir, ticketRel))).toBeNull()
  })

  /**
   * 🔴 **`narrowing` 변형**(design-r01 P1). ignore 범위를 **좁히는** 미커밋 `.gitignore` 가 있으면
   *    `req:commit` 은 **명령열을 내지 않는다** — `req:next` 도 같아야 한다.
   *    `baseState` 만 넘기는 설계였다면 여기서 *"stash 하고 진행하라"* 는 실행 불가 안내가 나왔다.
   */
  it('🔴 narrowing 이면 stash 명령열을 내지 않는다', () => {
    // 순수 함수로 직접 확인한다(상태 조합을 실 저장소로 만들 필요가 없다).
    const withNarrowing = terminalReentryProblem(REQ, 'dev-complete', ['.gitignore'], ['.gitignore'])
    expect(withNarrowing).not.toBeNull()
    expect(withNarrowing).not.toContain('git stash')
    expect(withNarrowing).toContain('좁힐 수 있습니다')
  })

  it('안전한 미커밋 .gitignore 면 먼저 커밋하라는 줄이 붙는다', () => {
    const safe = terminalReentryProblem(REQ, 'dev-complete', ['.gitignore'], [])
    expect(safe).toContain('.gitignore')
    expect(safe).toContain('git stash')
  })

  it('미커밋 .gitignore 가 없으면 stash 명령열만 낸다', () => {
    const plain = terminalReentryProblem(REQ, 'dev-complete')
    expect(plain).toContain('git stash')
    expect(plain).toContain('req:new')
  })
})

/**
 * 🔴 **호출부 고정**. 위 테스트들은 공급자를 손으로 주입하므로 `main()` 이 배선을 잊어도 green 이다 —
 *    이 저장소가 이번 작업에서만 다섯 번 만든 사각지대다.
 */
describe('[REQ-2026-175] main() 배선', () => {
  it('🔴 main() 이 terminalReentry 를 공급한다', () => {
    const src = readFileSync(join(import.meta.dirname, '..', '..', 'scripts', 'req', 'req-next.ts'), 'utf8')
    expect(src, 'main 이 종결 검사를 배선하지 않는다').toContain('terminalReentry: () =>')
    expect(src).toContain('computeTerminalReentry({')
  })

  it('🔴 req:commit 도 같은 함수를 쓴다(두 곳이 갈라지지 않는다)', () => {
    const src = readFileSync(join(import.meta.dirname, '..', '..', 'scripts', 'req', 'req-commit.ts'), 'utf8')
    expect(src).toContain('computeTerminalReentry({')
  })
})
