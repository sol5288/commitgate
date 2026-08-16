import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { planCloseOrphan, parseArgs } from '../../scripts/req/req-review-exception'
import { closeSeriesOrphaned, type WorkflowState } from '../../scripts/req/review-codex'
import { RESERVED_HUMAN_PLACEHOLDERS } from '../../scripts/req/lib/placeholders'
import {
  verifiedTerminalEvent,
  deriveBaseState,
  closeProofRowProblems,
  appendCloseProofRow,
  serializeCloseProofRow,
  parseCloseProof,
  type CloseProofRow,
} from '../../scripts/req/lib/close-proof'

/**
 * REQ-2026-163 phase-2 — orphan series 기록 종결(`--close-orphan`).
 *
 * 🔴 헤드라인 단언 셋:
 *   1. **살아 있는 phase 의 series 는 거부한다** — 닫아 주면 필요한 리뷰를 건너뛰는 길이 된다.
 *   2. **`orphaned` proof 는 티켓 종결이 아니다** — 그러지 않으면 진행 중인 티켓이 종결로 보여
 *      doctor 의 종결 면제(D2·D3·D11)가 잘못 붙는다(설계 DEC-3b).
 *   3. **재실행은 수렴한다** — 이미 닫혔으면 쓰지 않고 그 사실을 말한다(거부가 아니다).
 */

const SERIES = 'phase:phase-2-check-c6#1'

const stateWith = (over: Partial<WorkflowState> = {}): WorkflowState =>
  ({
    id: 'REQ-2026-161',
    phases: [{ id: 'phase-3-check-c6' }],
    review_series: [
      { series_id: SERIES, review_kind: 'phase', phase_id: 'phase-2-check-c6', attempts: 2, closed_reason: null },
      { series_id: 'phase:phase-3-check-c6#1', review_kind: 'phase', phase_id: 'phase-3-check-c6', attempts: 1, closed_reason: 'approved' },
    ],
    ...over,
  }) as unknown as WorkflowState

const REASON = 'phase 순서 정정으로 phase-3-check-c6 가 대체함'

describe('[close-orphan] planCloseOrphan — 무엇을 닫아 주고 무엇을 거부하나', () => {
  it('orphan 이면 닫는다(사라진 phase id 를 함께 낸다)', () => {
    expect(planCloseOrphan(stateWith(), SERIES, REASON)).toEqual({
      kind: 'close',
      seriesId: SERIES,
      phaseId: 'phase-2-check-c6',
    })
  })

  it('🔴 phases[] 에 살아 있는 phase 의 series 는 거부한다 — 리뷰 우회 경로가 되면 안 된다', () => {
    const live = stateWith({
      phases: [{ id: 'live' }],
      review_series: [{ series_id: 'phase:live#1', review_kind: 'phase', phase_id: 'live', closed_reason: null }],
    } as never)
    const p = planCloseOrphan(live, 'phase:live#1', REASON)
    expect(p.kind).toBe('refuse')
    expect(p.kind === 'refuse' && p.reason).toContain('orphan 이 아닙니다')
  })

  it('🔴 이미 닫힌 series 는 수렴한다(거부가 아니다) — 재실행이 이 명령의 교착을 만들면 안 된다', () => {
    const closed = stateWith({
      review_series: [{ series_id: SERIES, review_kind: 'phase', phase_id: 'phase-2-check-c6', closed_reason: 'orphaned' }],
    } as never)
    const p = planCloseOrphan(closed, SERIES, REASON)
    expect(p.kind).toBe('noop')
    expect(p.kind === 'noop' && p.detail).toContain('이미 종결됨')
  })

  it('없는 series 는 거부하고 D34 를 가리킨다', () => {
    const p = planCloseOrphan(stateWith(), 'phase:nope#1', REASON)
    expect(p.kind).toBe('refuse')
    expect(p.kind === 'refuse' && p.hint).toContain('D34')
  })

  it('🔴 --reason 이 비었거나 도구가 안내에 넣은 자리표시자면 거부한다', () => {
    // 🔴 자리표시자 목록은 **정본에서 가져온다**(손으로 적으면 목록이 늘 때 이 검사가 조용히 샌다).
    for (const bad of ['', '   ', ...RESERVED_HUMAN_PLACEHOLDERS]) {
      expect(planCloseOrphan(stateWith(), SERIES, bad).kind, JSON.stringify(bad)).toBe('refuse')
    }
    expect(RESERVED_HUMAN_PLACEHOLDERS.length).toBeGreaterThan(3) // 오라클이 공허하지 않음을 고정
  })

  it('--close-orphan 을 파싱한다(값 누락·옵션 삼킴 거부)', () => {
    expect(parseArgs(['2026-161', '--close-orphan', SERIES]).closeOrphan).toBe(SERIES)
    expect(() => parseArgs(['2026-161', '--close-orphan'])).toThrow('series_id')
    expect(() => parseArgs(['2026-161', '--close-orphan', '--run'])).toThrow('series_id')
  })
})

describe('[close-orphan] closeSeriesOrphaned — 상태 전이', () => {
  it('closed_reason 을 orphaned 로 바꾼다(다른 series 는 불변)', () => {
    const { next, changed } = closeSeriesOrphaned(stateWith(), SERIES)
    expect(changed).toBe(true)
    const rows = (next.review_series ?? []) as { series_id: string; closed_reason: unknown }[]
    expect(rows.find((r) => r.series_id === SERIES)?.closed_reason).toBe('orphaned')
    expect(rows.find((r) => r.series_id === 'phase:phase-3-check-c6#1')?.closed_reason).toBe('approved')
  })

  it('🔴 멱등 — 이미 닫혔으면 changed=false 이고 state 를 새로 만들지 않는다', () => {
    const once = closeSeriesOrphaned(stateWith(), SERIES).next
    const twice = closeSeriesOrphaned(once, SERIES)
    expect(twice.changed).toBe(false)
    expect(twice.next).toBe(once)
  })

  it('🔴 사람 결정 기록(human_resolution)을 남기지 않는다 — 사람이 결정한 것이 아니다', () => {
    const { next } = closeSeriesOrphaned(stateWith(), SERIES)
    const row = ((next.review_series ?? []) as unknown as Record<string, unknown>[]).find((r) => r.series_id === SERIES)
    expect(row).not.toHaveProperty('human_resolution')
  })
})

// ───────────────────────────────── close-proof 계약 ──

const orphanRow = (over: Partial<CloseProofRow> = {}): CloseProofRow => ({
  ticket_id: 'REQ-2026-161',
  event: 'series-terminal',
  series_id: SERIES,
  resolution: 'orphaned',
  phase_inventory: null,
  design_ref: null,
  at: '2026-08-17T00:00:00.000Z',
  reconstructed: false,
  evidence_basis: null,
  orphan_reason: REASON,
  ...over,
})

describe('[close-orphan] close-proof — durable 기록', () => {
  it('orphaned 행이 유효하다(등록부에 resolution·선택키가 등재됨)', () => {
    expect(closeProofRowProblems(orphanRow())).toEqual([])
  })

  it('🔴 사유가 durable 하다 — 직렬화·재파싱으로 살아남는다', () => {
    const parsed = parseCloseProof(serializeCloseProofRow(orphanRow()) + '\n')
    expect(parsed.problems).toEqual([])
    expect(parsed.rows[0]?.orphan_reason).toBe(REASON)
  })

  it('🔴 `orphan_reason` 이 없는 기존 행도 그대로 유효하다 — 업그레이드가 완료 티켓을 corrupt 로 만들지 않는다', () => {
    const legacy = { ...orphanRow({ resolution: 'replace' }) } as Record<string, unknown>
    delete legacy.orphan_reason
    expect(closeProofRowProblems(legacy)).toEqual([])
  })

  it('같은 자연키 재추가는 duplicate(멱등)', () => {
    const first = appendCloseProofRow('', orphanRow())
    expect(first.outcome).toBe('appended')
    expect(appendCloseProofRow(first.content, orphanRow()).outcome).toBe('duplicate')
  })
})

// ───────────────────────────────── baseState (DEC-3b) ──

const terminalInput = (rows: CloseProofRow[]) => ({
  closeProofRows: rows,
  durabilityRequired: true,
  ledgerHasApprovedClose: false,
  committedEvidenceComplete: false,
  manifestRows: [],
  phaseInventory: null,
  designRef: null,
})

describe('[close-orphan] 🔴 orphaned proof 는 티켓 종결이 아니다 (DEC-3b)', () => {
  it('developing 티켓: orphan 종결 후에도 baseState 가 developing 이다 — 종결 면제가 붙지 않는다', () => {
    const input = terminalInput([orphanRow()])
    expect(verifiedTerminalEvent(input as never)).toBeNull()
    expect(deriveBaseState(input as never)).toBe('developing')
  })

  it('🔴 사람 결정(replace·human-resolution)의 의미는 불변이다 — 그것들은 티켓 종결이 맞다', () => {
    for (const r of ['replace', 'human-resolution'] as const) {
      const input = terminalInput([orphanRow({ resolution: r })])
      expect(verifiedTerminalEvent(input as never), r).toBe('series-terminal')
    }
  })

  it('🔴 orphaned 와 사람 결정이 섞여 있으면 사람 결정이 이긴다(orphaned 가 가리지 않는다)', () => {
    const input = terminalInput([orphanRow(), orphanRow({ series_id: 'phase:other#1', resolution: 'replace' })])
    expect(verifiedTerminalEvent(input as never)).toBe('series-terminal')
  })

  /**
   * 🔴 **orphan 행은 무해하다** — dev-complete fixture 를 손으로 정확히 구성하는 대신, 같은 입력에
   *    orphan 행만 **더했을 때 판정이 그대로인지**를 본다. 오라클이 `isDevCompleteVerified` 의 내부
   *    조건에 의존하지 않아 그 계약이 바뀌어도 이 단언의 의미가 유지된다.
   */
  it('🔴 orphan 행을 더해도 baseState 가 달라지지 않는다(후퇴·승격 둘 다 없음)', () => {
    const bases: CloseProofRow[][] = [
      [], // developing
      [{ ...orphanRow({ series_id: null, resolution: null }), event: 'abandoned', abandon_reason: 'x', method: 'y' }],
      [orphanRow({ series_id: null, resolution: null, event: 'migrated-complete', phase_inventory: ['p1'], design_ref: 'D1' })],
      [orphanRow({ series_id: 'phase:other#1', resolution: 'replace' })],
    ]
    for (const rows of bases) {
      const without = deriveBaseState(terminalInput(rows) as never)
      const withOrphan = deriveBaseState(terminalInput([...rows, orphanRow()]) as never)
      expect(withOrphan, JSON.stringify(rows.map((r) => r.event + ':' + String(r.resolution)))).toBe(without)
    }
  })
})

/**
 * 🔴 **`--run` 이 close-proof 를 실제로 커밋하는가**(phase-2 r01 P1).
 *
 * `commitStateCheckpoint` 는 설계상 `state.json` 만 pathspec 으로 담는다. proof 를 디스크에만 쓰면
 * 워킹트리에 남아 다음 정리에서 사라지고, durable 기록과 `orphan_reason` 감사 근거가 유실된다.
 * 순수 판정 테스트로는 이 누락을 못 잡으므로 **실 git 으로 커밋 포함 여부**를 본다.
 */
describe('[close-orphan] --run 배선 — proof·state 가 HEAD 에 남는다 (실 git)', () => {
  const tmps: string[] = []
  afterEach(() => {
    while (tmps.length) rmSync(tmps.pop() as string, { recursive: true, force: true })
  })

  const g = (repo: string, args: string[]): string => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()

  function repoWithOrphan(): { repo: string; ticketRel: string } {
    const repo = mkdtempSync(join(tmpdir(), 'cg-orphan-'))
    tmps.push(repo)
    g(repo, ['init', '-q', '.'])
    g(repo, ['config', 'user.email', 't@t.t'])
    g(repo, ['config', 'user.name', 't'])
    writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'x', version: '0.0.0' }))
    writeFileSync(
      join(repo, 'req.config.json'),
      JSON.stringify({ packageManager: 'npm', setup: { completedVersion: '0.23.1', completedAt: '2026-08-16T00:00:00.000Z' } }),
    )
    const ticketRel = 'workflow/REQ-2026-161'
    mkdirSync(join(repo, ticketRel, 'responses'), { recursive: true })
    writeFileSync(join(repo, ticketRel, 'state.json'), JSON.stringify(stateWith(), null, 2) + '\n')
    g(repo, ['add', '-A'])
    g(repo, ['commit', '-qm', 'seed'])
    return { repo, ticketRel }
  }

  it('🔴 close-proof 와 state.json 이 둘 다 HEAD 에 커밋된다(워킹트리에 남지 않는다)', () => {
    const { repo, ticketRel } = repoWithOrphan()
    execFileSync(
      process.execPath,
      [
        join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs'),
        join(process.cwd(), 'scripts', 'req', 'req-review-exception.ts'),
        '2026-161',
        '--close-orphan',
        SERIES,
        '--reason',
        REASON,
        '--run',
        '--root',
        repo,
      ],
      { encoding: 'utf8', stdio: 'pipe' },
    )

    // 🔴 워킹트리가 깨끗하다 = 쓴 것을 전부 커밋했다.
    expect(g(repo, ['status', '--porcelain'])).toBe('')

    const proofRel = `${ticketRel}/responses/ticket-close.jsonl`
    const proof = g(repo, ['show', `HEAD:${proofRel}`])
    const rows = parseCloseProof(proof + '\n')
    expect(rows.problems).toEqual([])
    const row = rows.rows.find((r) => r.series_id === SERIES)
    expect(row?.resolution).toBe('orphaned')
    expect(row?.orphan_reason).toBe(REASON) // 🔴 사유가 durable 하다

    const st = JSON.parse(g(repo, ['show', `HEAD:${ticketRel}/state.json`])) as {
      review_series: { series_id: string; closed_reason: unknown }[]
    }
    expect(st.review_series.find((r) => r.series_id === SERIES)?.closed_reason).toBe('orphaned')
  })
})
